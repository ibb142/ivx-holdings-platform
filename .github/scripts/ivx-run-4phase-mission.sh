#!/usr/bin/env bash
set -euo pipefail
: "${PHASE:?PHASE is required}"
: "${SYSTEM_KEY:?SYSTEM_KEY is required}"
: "${API_BASE:?API_BASE is required}"
: "${MISSION_FILE:?MISSION_FILE is required}"
mkdir -p /tmp/ivx-4phase
: > "/tmp/ivx-4phase/phase-${PHASE}.jsonl"

while IFS= read -r task; do
  number=$(jq -r '.agentNumber' <<<"$task")
  item=$(jq -r '.item' <<<"$task")
  path=$(jq -r '.path' <<<"$task")
  action=$(jq -r '.action' <<<"$task")
  agent_line=$(awk -F '\t' -v n="$number" '$1 == n {print; exit}' /tmp/agents.tsv)
  test -n "$agent_line"
  agent_id=$(cut -f2 <<<"$agent_line")
  agent_name=$(cut -f3- <<<"$agent_line")
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "PHASE_${PHASE}_AGENT_START number=$number id=$agent_id item=$item path=$path"

  contract="/tmp/ivx-4phase/contract-${number}.json"
  output="/tmp/ivx-4phase/run-${number}.json"
  contract_http=$(curl -sS --max-time 25 -o "$contract" -w '%{http_code}' "${API_BASE}/api/ivx/agents/${agent_id}/contract" || true)
  if [ "$contract_http" = 200 ]; then
    task_type=$(jq -r '.contract.allowedTaskTypes[0] // "audit"' "$contract")
    task_id="fullapp-p${PHASE}-agent-${number}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
    body=$(jq -nc --arg taskType "$task_type" --arg token "$SYSTEM_KEY" --arg programId 'IVX-FULL-APP-4PHASE-112-2026-08-21' --argjson phase "$PHASE" --argjson agentNumber "$number" --arg item "$item" --arg path "$path" --arg action "$action" --arg sourceSha "$LIVE_SHA" --arg taskId "$task_id" '{taskType:$taskType,ownerApprovalToken:$token,payload:{programId:$programId,phase:$phase,agentNumber:$agentNumber,item:$item,path:$path,action:$action,sourceSha:$sourceSha,__taskId:$taskId,__workflow:"IVX 112 Full App 4-Phase Mission",realExecutionOnly:true,simulatedSuccessAllowed:false,certificationRequired:true,realFundsAllowed:false}}')
    run_http=$(curl -sS --retry 1 --retry-delay 1 --max-time 120 -o "$output" -w '%{http_code}' -X POST "${API_BASE}/api/ivx/agents/${agent_id}/run" -H 'Content-Type: application/json' -H "x-ivx-owner-key: ${SYSTEM_KEY}" --data "$body" || true)
    ok=false
    if [ "$run_http" = 200 ]; then ok=$(jq -r '.ok // false' "$output" 2>/dev/null || echo false); fi
    final_status=$(jq -r '.runRecord.finalStatus // "request_failed"' "$output" 2>/dev/null || echo request_failed)
    source_reference=$(jq -r '.runRecord.sourceReference // empty' "$output" 2>/dev/null || true)
    tool_result_id=$(jq -r '.runRecord.toolResultId // empty' "$output" 2>/dev/null || true)
    commit_sha=$(jq -r '.runRecord.commitSha // empty' "$output" 2>/dev/null || true)
    error=$(jq -r '.error // .runRecord.error // empty' "$output" 2>/dev/null || true)
  else
    task_type=''; task_id=''; run_http='0'; ok=false; final_status='contract_failed'; source_reference=''; tool_result_id=''; commit_sha=''; error="contract_http_${contract_http}"
  fi
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -nc --argjson agentNumber "$number" --argjson phase "$PHASE" --arg agentId "$agent_id" --arg agentName "$agent_name" --arg item "$item" --arg path "$path" --arg action "$action" --arg taskType "$task_type" --arg taskId "$task_id" --arg startedAt "$started_at" --arg finishedAt "$finished_at" --arg contractHttp "$contract_http" --arg runHttp "$run_http" --argjson ok "$ok" --arg finalStatus "$final_status" --arg sourceReference "$source_reference" --arg toolResultId "$tool_result_id" --arg commitSha "$commit_sha" --arg error "$error" '{agentNumber:$agentNumber,phase:$phase,agentId:$agentId,agentName:$agentName,item:$item,path:$path,action:$action,taskType:$taskType,taskId:$taskId,startedAt:$startedAt,finishedAt:$finishedAt,contractHttp:$contractHttp,runHttp:$runHttp,ok:$ok,finalStatus:$finalStatus,sourceReference:$sourceReference,toolResultId:$toolResultId,commitSha:$commitSha,error:$error}' >> "/tmp/ivx-4phase/phase-${PHASE}.jsonl"
  echo "PHASE_${PHASE}_AGENT_FINISH number=$number id=$agent_id ok=$ok status=$final_status"
done < <(jq -c --argjson phase "$PHASE" '.tasks[] | select(.phase == $phase) | sort_by(.agentNumber)' "$MISSION_FILE")

jq -s 'sort_by(.agentNumber)' "/tmp/ivx-4phase/phase-${PHASE}.jsonl" > "/tmp/ivx-4phase/phase-${PHASE}.json"
test "$(jq 'length' "/tmp/ivx-4phase/phase-${PHASE}.json")" = 28
