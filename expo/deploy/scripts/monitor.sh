#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Production Monitoring Dashboard
# Continuous monitoring with alerts
# Usage: ./deploy/scripts/monitor.sh [--once] [--interval 30]
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-ivx-holdings-cluster}"
ECS_SERVICE="${ECS_SERVICE:-ivx-holdings-api-service}"
API_URL="${API_URL:-https://api.ivxholding.com}"
INTERVAL="${INTERVAL:-30}"
RUN_ONCE=false
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

for arg in "$@"; do
  case $arg in
    --once)       RUN_ONCE=true ;;
    --interval)   shift; INTERVAL="${1:-30}" ;;
    --interval=*) INTERVAL="${arg#*=}" ;;
    --url=*)      API_URL="${arg#*=}" ;;
    --webhook=*)  ALERT_WEBHOOK="${arg#*=}" ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo -e "${RED}aws CLI not found${NC}"; exit 1; }

send_alert() {
  local level="$1"
  local message="$2"
  local timestamp
  timestamp=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

  if [ "$level" = "critical" ]; then
    echo -e "${RED}[ALERT] $message${NC}"
  else
    echo -e "${YELLOW}[WARN] $message${NC}"
  fi

  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -sf -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"[$level] IVX Holdings: $message\",\"timestamp\":\"$timestamp\"}" \
      >/dev/null 2>&1 || true
  fi
}

check_health() {
  local url="$1"
  local response
  local status

  response=$(curl -sf --max-time 10 "$url/health" 2>/dev/null || echo '{"status":"unreachable"}')
  status=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "parse_error")

  if [ "$status" = "healthy" ]; then
    echo -e "  ${GREEN}API:${NC} healthy"
    return 0
  else
    echo -e "  ${RED}API:${NC} $status"
    send_alert "critical" "API health check failed: $status ($url)"
    return 1
  fi
}

check_ecs() {
  local service_info
  service_info=$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" \
    --query 'services[0]' \
    --output json 2>/dev/null || echo "{}")

  if [ "$service_info" = "{}" ] || [ "$service_info" = "null" ]; then
    echo -e "  ${RED}ECS:${NC} Service not found"
    send_alert "critical" "ECS service not found: $ECS_SERVICE"
    return 1
  fi

  local status running desired
  status=$(echo "$service_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  running=$(echo "$service_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runningCount',0))" 2>/dev/null)
  desired=$(echo "$service_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('desiredCount',0))" 2>/dev/null)

  if [ "$status" = "ACTIVE" ] && [ "$running" = "$desired" ]; then
    echo -e "  ${GREEN}ECS:${NC} $running/$desired tasks running"
  elif [ "$running" != "$desired" ]; then
    echo -e "  ${YELLOW}ECS:${NC} $running/$desired tasks (scaling)"
    send_alert "warning" "ECS tasks: $running/$desired running"
  else
    echo -e "  ${RED}ECS:${NC} $status ($running/$desired)"
    send_alert "critical" "ECS status: $status ($running/$desired tasks)"
  fi
}

check_errors() {
  local error_count
  error_count=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ApplicationELB" \
    --metric-name "HTTPCode_Target_5XX_Count" \
    --dimensions "Name=LoadBalancer,Value=$(aws elbv2 describe-load-balancers \
      --names "${APP_NAME}-alb" \
      --region "$AWS_REGION" \
      --query 'LoadBalancers[0].LoadBalancerArn' \
      --output text 2>/dev/null | sed 's|.*loadbalancer/||')" \
    --start-time "$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-5M '+%Y-%m-%dT%H:%M:%SZ')" \
    --end-time "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --period 300 \
    --statistics Sum \
    --region "$AWS_REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "N/A")

  if [ "$error_count" = "None" ] || [ "$error_count" = "N/A" ]; then
    echo -e "  ${GREEN}5xx:${NC} 0 errors (last 5m)"
  elif [ "$error_count" = "0" ] || [ "$error_count" = "0.0" ]; then
    echo -e "  ${GREEN}5xx:${NC} 0 errors (last 5m)"
  else
    echo -e "  ${RED}5xx:${NC} $error_count errors (last 5m)"
    send_alert "critical" "$error_count 5xx errors in last 5 minutes"
  fi
}

check_cpu_memory() {
  local cpu_util
  cpu_util=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ECS" \
    --metric-name "CPUUtilization" \
    --dimensions "Name=ClusterName,Value=$ECS_CLUSTER" "Name=ServiceName,Value=$ECS_SERVICE" \
    --start-time "$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-5M '+%Y-%m-%dT%H:%M:%SZ')" \
    --end-time "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --period 300 \
    --statistics Average \
    --region "$AWS_REGION" \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "N/A")

  local mem_util
  mem_util=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ECS" \
    --metric-name "MemoryUtilization" \
    --dimensions "Name=ClusterName,Value=$ECS_CLUSTER" "Name=ServiceName,Value=$ECS_SERVICE" \
    --start-time "$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-5M '+%Y-%m-%dT%H:%M:%SZ')" \
    --end-time "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --period 300 \
    --statistics Average \
    --region "$AWS_REGION" \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "N/A")

  if [ "$cpu_util" != "N/A" ] && [ "$cpu_util" != "None" ]; then
    local cpu_int
    cpu_int=$(printf "%.0f" "$cpu_util" 2>/dev/null || echo "0")
    if [ "$cpu_int" -gt 80 ]; then
      echo -e "  ${RED}CPU:${NC} ${cpu_int}%"
      send_alert "warning" "High CPU utilization: ${cpu_int}%"
    elif [ "$cpu_int" -gt 60 ]; then
      echo -e "  ${YELLOW}CPU:${NC} ${cpu_int}%"
    else
      echo -e "  ${GREEN}CPU:${NC} ${cpu_int}%"
    fi
  else
    echo -e "  ${CYAN}CPU:${NC} N/A"
  fi

  if [ "$mem_util" != "N/A" ] && [ "$mem_util" != "None" ]; then
    local mem_int
    mem_int=$(printf "%.0f" "$mem_util" 2>/dev/null || echo "0")
    if [ "$mem_int" -gt 85 ]; then
      echo -e "  ${RED}MEM:${NC} ${mem_int}%"
      send_alert "warning" "High memory utilization: ${mem_int}%"
    elif [ "$mem_int" -gt 70 ]; then
      echo -e "  ${YELLOW}MEM:${NC} ${mem_int}%"
    else
      echo -e "  ${GREEN}MEM:${NC} ${mem_int}%"
    fi
  else
    echo -e "  ${CYAN}MEM:${NC} N/A"
  fi
}

run_check() {
  local timestamp
  timestamp=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

  echo ""
  echo -e "${BOLD}━━━ IVX Holdings Monitor — $timestamp ━━━${NC}"
  echo ""

  check_health "$API_URL"
  check_ecs
  check_errors
  check_cpu_memory

  echo ""
  echo -e "  ${CYAN}Next check in ${INTERVAL}s${NC}"
}

echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}  IVX Holdings — Production Monitor${NC}"
echo -e "${BOLD}${BLUE}  API:      $API_URL${NC}"
echo -e "${BOLD}${BLUE}  Cluster:  $ECS_CLUSTER${NC}"
echo -e "${BOLD}${BLUE}  Interval: ${INTERVAL}s${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$RUN_ONCE" = "true" ]; then
  run_check
else
  while true; do
    run_check
    sleep "$INTERVAL"
  done
fi
