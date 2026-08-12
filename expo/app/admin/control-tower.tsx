import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  RefreshControl} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Command,
  Cpu,
  GitBranch,
  Layers3,
  Network,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Timer,
  Users,
  Waypoints,
  Workflow} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import {
  getIVXOwnerAIConfigAudit,
  type IVXOwnerAIConfigAudit} from '@/lib/ivx-supabase-client';
import {
  buildNerveCenterSnapshot,
  type ArchitectureNodeRecord,
  type ChatRoomRecord,
  type CommandRecord,
  type DependencyRecord,
  type FunnelStageRecord,
  type HealthState,
  type IncidentRecord,
  type ModuleRecord,
  type NerveCenterSnapshot,
  type RecommendationRecord,
  type RiskModuleRecord,
  type TrafficSourceRecord} from '@/lib/control-tower/nerve-center-intelligence';
import { useLiveIntelligenceSnapshot } from '@/lib/control-tower/use-live-intelligence';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import type { LiveIntelligenceSnapshot } from '@/lib/control-tower/live-intelligence';

type TabId = 'nerve' | 'traffic' | 'funnel' | 'risk' | 'chat' | 'blueprint';
type AuditTone = 'pass' | 'warn' | 'blocked';

type EnvironmentAuditSummary = {
  environment: string;
  configuredUrl: string;
  configSource: string;
  explicitProductionPin: string;
  activeBaseUrl: string;
  activeHost: string;
  activeEndpoint: string;
  directApiBaseUrl: string;
  directApiHost: string;
  ownerAiHealthUrl: string;
  ownerRoute53AuditUrl: string;
  appApiHealthUrl: string;
  appApiRoute53AuditUrl: string;
  canonicalBaseUrl: string;
  activeFallbackUrl: string;
  routingAuditState: string;
  fallbackUsed: string;
  whyFallbackSelected: string;
  selectionReason: string;
  workflowTrace: string[];
  mismatchWarnings: string[];
  productionGuardText: string;
  productionGuardBlocked: boolean;
  topBannerMessage: string;
  tone: AuditTone;
};

const TABS: Array<{ id: TabId; label: string; icon: typeof Brain }> = [
  { id: 'nerve', label: 'Nerve', icon: Brain },
  { id: 'traffic', label: 'Traffic', icon: Waypoints },
  { id: 'funnel', label: 'Funnel', icon: Workflow },
  { id: 'risk', label: 'Risk', icon: ShieldAlert },
  { id: 'chat', label: 'Chat', icon: Radio },
  { id: 'blueprint', label: 'Blueprint', icon: GitBranch },
];

function getHealthColor(state: HealthState): string {
  if (state === 'critical') return '#FF4D6D';
  if (state === 'warning') return '#FFB84D';
  return '#32D583';
}

function formatPct(value: number): string {
  return `${value}%`;
}

function scoreTone(score: number): string {
  if (score >= 80) return '#FF4D6D';
  if (score >= 55) return '#FFB84D';
  return '#32D583';
}

function getAuditToneColor(tone: AuditTone): string {
  if (tone === 'blocked') return '#FF4D6D';
  if (tone === 'warn') return '#FFB84D';
  return '#32D583';
}

function buildEnvironmentAuditSummary(audit: IVXOwnerAIConfigAudit): EnvironmentAuditSummary {
  const configuredUrl = audit.configuredBaseUrl ?? 'unconfigured';
  const activeFallbackUrl = audit.fallbackUsed
    ? (audit.activeBaseUrl ?? audit.devFallbackBaseUrl ?? 'unconfigured')
    : 'not-active';
  const routingAuditState = audit.blocksRemoteRequests
    ? 'guard_blocked'
    : audit.mismatchWarnings.length > 0
      ? 'split_host_path'
      : audit.fallbackUsed
        ? 'dev_fallback_active'
        : audit.productionReady
          ? 'live'
          : 'explicit_non_production';
  const tone: AuditTone = audit.blocksRemoteRequests
    ? 'blocked'
    : audit.mismatchWarnings.length > 0 || audit.fallbackUsed
      ? 'warn'
      : 'pass';
  const productionGuardText = audit.blocksRemoteRequests
    ? `blocked — ${audit.configurationError ?? 'Owner AI production routing is invalid.'}`
    : audit.currentEnvironment === 'production'
      ? 'pass — production routing is explicitly set by EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL'
      : 'pass — development routing policy allows explicit or fallback routing';
  const topBannerMessage = audit.blocksRemoteRequests
    ? audit.configurationError ?? 'Production guard blocked Owner AI routing.'
    : audit.mismatchWarnings.length > 0
      ? `Split host path detected. ${audit.mismatchWarnings[0]}`
      : audit.fallbackUsed
        ? `Development fallback active. ${audit.fallbackReason ?? audit.selectionReason}`
        : `Routing live. ${audit.selectionReason}`;

  return {
    environment: audit.currentEnvironment,
    configuredUrl,
    configSource: audit.configuredFrom ?? (audit.fallbackUsed ? 'EXPO_PUBLIC_PROJECT_ID derived dev fallback' : 'unconfigured'),
    explicitProductionPin: audit.explicitProductionPinApplied
      ? `yes — ${audit.configuredBaseUrl ?? audit.canonicalBaseUrl}`
      : 'no',
    activeBaseUrl: audit.activeBaseUrl ?? 'blocked',
    activeHost: audit.activeHost ?? 'unconfigured',
    activeEndpoint: audit.activeEndpoint ?? 'unconfigured',
    directApiBaseUrl: audit.directApiBaseUrl ?? 'unconfigured',
    directApiHost: audit.directApiHost ?? 'unconfigured',
    ownerAiHealthUrl: audit.healthCheckUrl ?? 'unconfigured',
    ownerRoute53AuditUrl: audit.route53AuditUrl ?? 'unconfigured',
    appApiHealthUrl: audit.appApiHealthCheckUrl ?? 'unconfigured',
    appApiRoute53AuditUrl: audit.appApiRoute53AuditUrl ?? 'unconfigured',
    canonicalBaseUrl: audit.canonicalBaseUrl,
    activeFallbackUrl,
    routingAuditState,
    fallbackUsed: audit.fallbackUsed ? 'yes' : 'no',
    whyFallbackSelected: audit.fallbackReason ?? (audit.fallbackUsed ? audit.selectionReason : 'Fallback not selected.'),
    selectionReason: audit.selectionReason,
    workflowTrace: audit.workflowTrace,
    mismatchWarnings: audit.mismatchWarnings,
    productionGuardText,
    productionGuardBlocked: audit.blocksRemoteRequests,
    topBannerMessage,
    tone};
}

const LiveDot = memo(function LiveDot({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.35, duration: 1100, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);

  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.liveDotHalo, { backgroundColor: color, opacity: anim }]} />
      <View style={[styles.liveDotCore, { backgroundColor: color }]} />
    </View>
  );
});

const MetricTile = memo(function MetricTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
});

const SectionCard = memo(function SectionCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {renderSafeViewChildren(children)}
    </View>
  );
});

const AuditField = memo(function AuditField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.auditField}>
      <Text style={styles.auditFieldLabel}>{label}</Text>
      <Text style={styles.auditFieldValue}>{value}</Text>
    </View>
  );
});

const RecommendationRow = memo(function RecommendationRow({ item }: { item: RecommendationRecord }) {
  const tone = item.severity === 'critical' ? '#FF4D6D' : item.severity === 'high' ? '#FFB84D' : '#76A9FF';

  return (
    <View style={[styles.recommendationRow, { borderColor: `${tone}33` }]} testID={`recommendation-${item.id}`}>
      <View style={styles.recommendationTop}>
        <View style={styles.rowStart}>
          <LiveDot color={tone} />
          <Text style={styles.recommendationTarget}>{item.targetModuleId.replace(/_/g, ' ')}</Text>
        </View>
        <Text style={[styles.recommendationSeverity, { color: tone }]}>{item.commandType.toUpperCase()}</Text>
      </View>
      <Text style={styles.recommendationReason}>{item.reason}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>confidence {Math.round(item.confidence * 100)}%</Text>
        <Text style={styles.metaText}>blast radius {item.blastRadius}</Text>
      </View>
      <Text style={styles.commandText}>{item.command}</Text>
    </View>
  );
});

const NerveTab = memo(function NerveTab({ snapshot, live }: { snapshot: NerveCenterSnapshot; live: LiveIntelligenceSnapshot }) {
  const criticalModules = snapshot.modules.filter((item) => item.health !== 'stable');

  return (
    <View style={styles.tabBody}>
      <View style={[styles.hero, { borderColor: `${getHealthColor(snapshot.globalStatus)}44` }]}>
        <View style={styles.heroTop}>
          <View style={styles.rowStart}>
            <LiveDot color={getHealthColor(snapshot.globalStatus)} />
            <Text style={[styles.heroState, { color: getHealthColor(snapshot.globalStatus) }]}>{snapshot.globalStatus.toUpperCase()}</Text>
          </View>
          <Text style={styles.heroTime}>{new Date(snapshot.asOf).toLocaleTimeString()}</Text>
        </View>
        <Text style={styles.heroTitle}>Nerve Center</Text>
        <Text style={styles.heroSubtitle}>Mission-control state for software health, routing degradation, runtime risk, and operator actionability.</Text>
        <View style={styles.metricsGrid}>
          <MetricTile label="Active incidents" value={String(snapshot.activeIncidentsCount)} tone="#FF4D6D" />
          <MetricTile label="Online modules" value={String(snapshot.onlineModulesCount)} />
          <MetricTile label="Auth vs anon" value={`${snapshot.authSessions}/${snapshot.anonSessions}`} tone="#76A9FF" />
          <MetricTile label="Alerts in progress" value={String(snapshot.alertsInProgress)} tone="#FFB84D" />
          <MetricTile label="Heal attempts" value={String(snapshot.healActionsAttempted)} tone="#32D583" />
          <MetricTile label="Approvals" value={String(snapshot.approvals.length)} tone="#B692F6" />
        </View>
      </View>

      <SectionCard title="Live module occupancy" right={<Text style={styles.sectionHint}>operator load map</Text>}>
        <View style={styles.panelGrid}>
          {snapshot.modules.map((module) => (
            <View key={module.id} style={[styles.modulePanel, { borderColor: `${getHealthColor(module.health)}33` }]} testID={`module-${module.id}`}>
              <View style={styles.modulePanelTop}>
                <Text style={styles.moduleName}>{module.name}</Text>
                <Text style={[styles.moduleStatus, { color: getHealthColor(module.health) }]}>{module.status}</Text>
              </View>
              <Text style={styles.moduleValue}>{module.occupancy}</Text>
              <Text style={styles.moduleMeta}>latency {module.latencyMs}ms · err {module.errorRate}%</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Live module telemetry" right={<Text style={styles.sectionHint}>real traffic + conversion state</Text>}>
        <View style={styles.panelGrid}>
          {live.moduleMetrics.slice(0, 8).map((module) => {
            const tone = module.healthStatus === 'critical' ? '#FF4D6D' : module.healthStatus === 'degraded' ? '#FFB84D' : '#32D583';
            return (
              <View key={module.moduleId} style={[styles.modulePanel, { borderColor: `${tone}33` }]} testID={`live-module-${module.moduleId}`}>
                <View style={styles.modulePanelTop}>
                  <Text style={styles.moduleName}>{module.moduleId.replace(/_/g, ' ')}</Text>
                  <Text style={[styles.moduleStatus, { color: tone }]}>{module.healthStatus}</Text>
                </View>
                <Text style={styles.moduleValue}>{module.activeUsers}</Text>
                <Text style={styles.moduleMeta}>sessions {module.sessionsInProgress} · CTA {module.ctaActions} · done {module.conversionsCompleted}</Text>
              </View>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard title="Recommended actions" right={<Text style={styles.sectionHint}>ranked by impact</Text>}>
        {snapshot.recommendations.map((item) => (
          <RecommendationRow key={item.id} item={item} />
        ))}
      </SectionCard>

      <SectionCard title="Approval-required actions" right={<Text style={styles.sectionHint}>owner gate</Text>}>
        {snapshot.approvals.map((approval) => (
          <View key={approval.id} style={styles.approvalRow}>
            <View style={styles.rowStart}>
              <ShieldAlert size={14} color="#B692F6" />
              <Text style={styles.approvalTitle}>{approval.title}</Text>
            </View>
            <Text style={styles.approvalReason}>{approval.reason}</Text>
            <Text style={styles.commandText}>{approval.command}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="System hot path" right={<Text style={styles.sectionHint}>where it fails next</Text>}>
        {criticalModules.map((module) => (
          <View key={module.id} style={styles.pathRow}>
            <View style={styles.pathRowMain}>
              <Text style={styles.pathName}>{module.name}</Text>
              <Text style={[styles.pathState, { color: getHealthColor(module.health) }]}>{module.health}</Text>
            </View>
            <Text style={styles.pathReason}>{module.explanation}</Text>
            <Text style={styles.pathImpact}>Downstream: {module.downstreamModules.join(' → ') || 'none'}</Text>
          </View>
        ))}
      </SectionCard>
    </View>
  );
});

const TrafficTab = memo(function TrafficTab({ sources, live }: { sources: TrafficSourceRecord[]; live: LiveIntelligenceSnapshot }) {
  const topSource = useMemo(() => [...sources].sort((a, b) => b.qualityScore - a.qualityScore)[0], [sources]);
  const topIntent = useMemo(() => [...sources].sort((a, b) => b.count - a.count)[0]?.detectedIntent ?? 'unknown', [sources]);
  const auth = sources.reduce((sum, item) => sum + item.authSessions, 0);
  const anon = sources.reduce((sum, item) => sum + item.anonSessions, 0);

  return (
    <View style={styles.tabBody}>
      <SectionCard title="Origin intelligence" right={<Text style={styles.sectionHint}>source quality + routing</Text>}>
        <View style={styles.metricsGrid}>
          <MetricTile label="Active sources" value={String(sources.length)} />
          <MetricTile label="Top source" value={topSource?.name ?? '--'} tone="#76A9FF" />
          <MetricTile label="Top intent" value={topIntent} tone="#32D583" />
          <MetricTile label="Auth / anon" value={`${auth}/${anon}`} tone="#FFB84D" />
        </View>
      </SectionCard>

      <SectionCard title="Real attribution intelligence" right={<Text style={styles.sectionHint}>live source quality</Text>}>
        {live.sourceMetrics.slice(0, 6).map((source) => (
          <View key={source.source} style={styles.flowCard}>
            <View style={styles.flowHead}>
              <Text style={styles.flowTitle}>{source.source}</Text>
              <Text style={[styles.flowHealth, { color: source.qualityScore >= 70 ? '#32D583' : source.qualityScore >= 45 ? '#FFB84D' : '#FF4D6D' }]}>{source.qualityScore}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>live {source.activeUsers}</Text>
              <Text style={styles.metaText}>sessions {source.totalSessions}</Text>
              <Text style={styles.metaText}>conv {source.conversions}</Text>
            </View>
            <Text style={styles.metaText}>investor quality {source.investorQualityScore} · low intent {source.lowIntentRate}% · drop {source.dropOffRate}%</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Likely investors" right={<Text style={styles.sectionHint}>per-user readiness</Text>}>
        {live.likelyToInvestProfiles.map((profile) => (
          <View key={profile.id} style={styles.approvalRow}>
            <View style={styles.rowStart}>
              <Users size={14} color="#76A9FF" />
              <Text style={styles.approvalTitle}>{profile.userId ?? profile.anonId.slice(0, 8)}</Text>
            </View>
            <Text style={styles.approvalReason}>{profile.predictedInvestorInterestCategory} · {profile.preferredTicketSize} · {profile.likelyRiskAppetite}</Text>
            <Text style={styles.metaText}>intent {profile.intentScore} · convert {profile.predictedConversionScore} · source {profile.lastSource}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Source → entry → modules" right={<Text style={styles.sectionHint}>flow map</Text>}>
        {sources.map((source) => {
          const tone = source.health === 'suspicious' ? '#FF4D6D' : source.health === 'degraded' ? '#FFB84D' : '#32D583';
          return (
            <View key={source.id} style={[styles.flowCard, { borderColor: `${tone}33` }]} testID={`source-${source.id}`}>
              <View style={styles.flowHead}>
                <View style={styles.rowStart}>
                  <LiveDot color={tone} />
                  <Text style={styles.flowTitle}>{source.name}</Text>
                </View>
                <Text style={[styles.flowHealth, { color: tone }]}>{source.health.toUpperCase()}</Text>
              </View>
              <View style={styles.flowMetaGrid}>
                <Text style={styles.metaText}>quality {source.qualityScore}</Text>
                <Text style={styles.metaText}>count {source.count}</Text>
                <Text style={styles.metaText}>intent {source.detectedIntent}</Text>
              </View>
              <View style={styles.flowPath}>
                <Text style={styles.pathPill}>{source.name}</Text>
                <ArrowRight size={12} color={Colors.textTertiary} />
                <Text style={styles.pathPill}>{source.entryPoint}</Text>
                {source.destinationModules.map((module) => (
                  <React.Fragment key={`${source.id}-${module}`}>
                    <ArrowRight size={12} color={Colors.textTertiary} />
                    <Text style={styles.pathPill}>{module}</Text>
                  </React.Fragment>
                ))}
              </View>
              {source.anomalyFlag ? <Text style={styles.anomalyText}>anomaly: {source.anomalyFlag}</Text> : null}
            </View>
          );
        })}
      </SectionCard>
    </View>
  );
});

const FunnelStageRow = memo(function FunnelStageRow({ stage }: { stage: FunnelStageRecord }) {
  const tone = stage.failureReason ? '#FFB84D' : '#32D583';
  return (
    <View style={styles.funnelStageRow}>
      <View style={styles.funnelStageTop}>
        <Text style={styles.funnelStageName}>{stage.name}</Text>
        <Text style={styles.funnelStageCount}>{stage.count}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>5m {stage.delta5m >= 0 ? '+' : ''}{stage.delta5m}</Text>
        <Text style={styles.metaText}>1h {stage.delta1h >= 0 ? '+' : ''}{stage.delta1h}</Text>
        <Text style={styles.metaText}>conv {formatPct(stage.conversionRate)}</Text>
        <Text style={[styles.metaText, { color: tone }]}>drop {formatPct(stage.dropOffRate)}</Text>
      </View>
      {stage.failureReason ? <Text style={styles.stageReason}>{stage.failureReason}</Text> : null}
      <Text style={styles.stageImpact}>Impacted: {stage.impactedModules.join(', ')}</Text>
    </View>
  );
});

const FunnelTab = memo(function FunnelTab({ snapshot, live }: { snapshot: NerveCenterSnapshot; live: LiveIntelligenceSnapshot }) {
  return (
    <View style={styles.tabBody}>
      <SectionCard title="Failure-aware conversion funnel" right={<Text style={styles.sectionHint}>causal leakage</Text>}>
        {snapshot.funnel.map((stage) => (
          <FunnelStageRow key={stage.id} stage={stage} />
        ))}
      </SectionCard>

      <SectionCard title="Live funnel map" right={<Text style={styles.sectionHint}>source → convert</Text>}>
        {live.funnelMetrics.map((stage) => (
          <View key={stage.step} style={styles.funnelStageRow}>
            <View style={styles.funnelStageTop}>
              <Text style={styles.funnelStageName}>{stage.step}</Text>
              <Text style={styles.funnelStageCount}>{stage.count}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>conv {stage.conversionRate}%</Text>
              <Text style={styles.metaText}>drop {stage.dropRate}%</Text>
              <Text style={styles.metaText}>{stage.impactedModules.join(' · ')}</Text>
            </View>
            {stage.reason ? <Text style={styles.stageReason}>{stage.reason}</Text> : null}
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Drop-off analysis" right={<Text style={styles.sectionHint}>debug next</Text>}>
        <Text style={styles.dropTitle}>Largest drop-off: {snapshot.dropOffAnalysis.largestDropOffPoint}</Text>
        <Text style={styles.dropBody}>{snapshot.dropOffAnalysis.probableCause}</Text>
        <Text style={styles.dropMeta}>Impacted APIs: {snapshot.dropOffAnalysis.impactedApis.join(' · ')}</Text>
        <Text style={styles.dropMeta}>Impacted modules: {snapshot.dropOffAnalysis.impactedModules.join(' · ')}</Text>
        <Text style={styles.commandText}>{snapshot.dropOffAnalysis.recommendedDebugCommand}</Text>
        {snapshot.dropOffAnalysis.logicAnomaly ? <Text style={styles.logicAlert}>logic anomaly: {snapshot.dropOffAnalysis.logicAnomaly}</Text> : null}
      </SectionCard>
    </View>
  );
});

const RiskRow = memo(function RiskRow({ risk }: { risk: RiskModuleRecord }) {
  const tone = scoreTone(risk.riskScore);
  return (
    <View style={[styles.riskRow, { borderColor: `${tone}33` }]} testID={`risk-${risk.moduleId}`}>
      <View style={styles.riskRowTop}>
        <Text style={styles.riskModule}>{risk.moduleId.replace(/_/g, ' ')}</Text>
        <Text style={[styles.riskScore, { color: tone }]}>{risk.riskScore}</Text>
      </View>
      <Text style={styles.riskExplanation}>{risk.whyStableOrAtRisk}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>driver {risk.primaryRiskDriver}</Text>
        <Text style={styles.metaText}>conf {Math.round(risk.confidence * 100)}%</Text>
        <Text style={styles.metaText}>dep {risk.dependencySensitivity}</Text>
      </View>
      <Text style={styles.riskChange}>Changed: {risk.recentChange}</Text>
      <Text style={styles.commandText}>{risk.suggestedIntervention}</Text>
    </View>
  );
});

const RiskTab = memo(function RiskTab({ risks, incidents, live }: { risks: RiskModuleRecord[]; incidents: IncidentRecord[]; live: LiveIntelligenceSnapshot }) {
  return (
    <View style={styles.tabBody}>
      <SectionCard title="Predictive risk engine" right={<Text style={styles.sectionHint}>0–100 by module</Text>}>
        {risks.map((risk) => (
          <RiskRow key={risk.moduleId} risk={risk} />
        ))}
      </SectionCard>

      <SectionCard title="Investors at risk of stall" right={<Text style={styles.sectionHint}>follow-up now</Text>}>
        {live.stalledProfiles.map((profile) => (
          <View key={profile.id} style={styles.riskRow}>
            <View style={styles.riskRowTop}>
              <Text style={styles.riskModule}>{profile.userId ?? profile.anonId.slice(0, 8)}</Text>
              <Text style={[styles.riskScore, { color: scoreTone(profile.intentScore) }]}>{profile.intentScore}</Text>
            </View>
            <Text style={styles.riskExplanation}>source {profile.lastSource} · viewed {profile.dealsViewed.length} deals · started {profile.investmentsStarted} investment flows</Text>
            <Text style={styles.commandText}>{profile.avgTimeToInvestMs ? `avg time to invest ${(profile.avgTimeToInvestMs / 60000).toFixed(1)}m` : 'needs follow-up before first investment completion'}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Emergent incidents" right={<Text style={styles.sectionHint}>open clusters</Text>}>
        {incidents.map((incident) => {
          const tone = incident.severity === 'critical' ? '#FF4D6D' : incident.severity === 'high' ? '#FFB84D' : '#76A9FF';
          return (
            <View key={incident.id} style={styles.incidentRow}>
              <View style={styles.rowStart}>
                <AlertTriangle size={14} color={tone} />
                <Text style={styles.incidentTitle}>{incident.title}</Text>
              </View>
              <Text style={styles.incidentReason}>{incident.reason}</Text>
              <Text style={styles.metaText}>blast radius {incident.blastRadius} · actionability {incident.actionability}</Text>
            </View>
          );
        })}
      </SectionCard>
    </View>
  );
});

const ChatTab = memo(function ChatTab({ rooms, live }: { rooms: ChatRoomRecord[]; live: LiveIntelligenceSnapshot }) {
  return (
    <View style={styles.tabBody}>
      <SectionCard title="Operator control state" right={<Text style={styles.sectionHint}>stuck + waiting</Text>}>
        <View style={styles.metricsGrid}>
          <MetricTile label="Waiting users" value={String(live.operator.waitingUsers)} tone="#76A9FF" />
          <MetricTile label="Stuck users" value={String(live.operator.stuckUsers)} tone="#FFB84D" />
          <MetricTile label="Failed convos" value={String(live.operator.failedConversations)} tone="#FF4D6D" />
          <MetricTile label="Fallback" value={live.operator.fallbackTransportState} tone={live.operator.fallbackTransportState === 'healthy' ? '#32D583' : '#FFB84D'} />
        </View>
      </SectionCard>

      <SectionCard title="Operator communications layer" right={<Text style={styles.sectionHint}>runtime + escalation</Text>}>
        {rooms.map((room) => {
          const tone = room.roomStatus === 'critical' ? '#FF4D6D' : room.roomStatus === 'degraded' ? '#FFB84D' : room.roomStatus === 'idle' ? '#76A9FF' : '#32D583';
          return (
            <View key={room.id} style={[styles.chatCard, { borderColor: `${tone}33` }]} testID={`chat-room-${room.id}`}>
              <View style={styles.chatHeader}>
                <View style={styles.rowStart}>
                  <LiveDot color={tone} />
                  <Text style={styles.chatRoomName}>{room.name}</Text>
                </View>
                <Text style={[styles.chatState, { color: tone }]}>{room.roomStatus}</Text>
              </View>
              <View style={styles.metricsGrid}>
                <MetricTile label="Users" value={String(room.activeUsers)} />
                <MetricTile label="Typing" value={String(room.typingUsers)} />
                <MetricTile label="Stuck" value={String(room.stuckConversations)} tone="#FFB84D" />
                <MetricTile label="Failed" value={String(room.failedMessages)} tone="#FF4D6D" />
              </View>
              <Text style={styles.chatProof}>{room.proof}</Text>
              <Text style={styles.chatMeta}>last write {room.lastWrite} · transport {room.realtimeTransportStatus} · delivery {room.messageDeliveryHealth}</Text>
              {room.incidentWithoutOperator ? <Text style={styles.logicAlert}>incident active while room is inactive</Text> : null}
              {room.escalationGap ? <Text style={styles.logicAlert}>escalation required but no operator presence</Text> : null}
            </View>
          );
        })}
      </SectionCard>
    </View>
  );
});

const BlueprintNode = memo(function BlueprintNode({ node }: { node: ArchitectureNodeRecord }) {
  const tone = getHealthColor(node.healthState);
  return (
    <View style={[styles.blueprintNode, { borderColor: `${tone}33` }]}>
      <View style={styles.blueprintTop}>
        <Text style={styles.blueprintName}>{node.name}</Text>
        <Text style={[styles.blueprintStatus, { color: tone }]}>{node.criticalPathStatus}</Text>
      </View>
      <Text style={styles.blueprintMeta}>{node.layer} · {node.latencyMs}ms</Text>
      <Text style={styles.blueprintIssue}>root issue: {node.rootIssue}</Text>
      <Text style={styles.blueprintImpact}>downstream: {node.affectedDownstreamSystems.join(' → ') || 'none'}</Text>
      <Text style={styles.commandText}>{node.recommendedRecoveryCommand}</Text>
    </View>
  );
});

const BlueprintTab = memo(function BlueprintTab({ nodes, dependencies, commands }: { nodes: ArchitectureNodeRecord[]; dependencies: DependencyRecord[]; commands: CommandRecord[] }) {
  return (
    <View style={styles.tabBody}>
      <SectionCard title="System blueprint" right={<Text style={styles.sectionHint}>live architecture audit map</Text>}>
        {nodes.map((node) => (
          <BlueprintNode key={node.id} node={node} />
        ))}
      </SectionCard>

      <SectionCard title="Meaningful connections" right={<Text style={styles.sectionHint}>dependency links</Text>}>
        {dependencies.map((dependency) => (
          <View key={dependency.id} style={styles.connectionRow}>
            <Text style={styles.connectionText}>{dependency.from}</Text>
            <ChevronRight size={12} color={dependency.degraded ? '#FF4D6D' : Colors.textTertiary} />
            <Text style={styles.connectionText}>{dependency.to}</Text>
            <Text style={[styles.connectionType, dependency.degraded ? { color: '#FF4D6D' } : null]}>{dependency.type}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Command layer" right={<Text style={styles.sectionHint}>specific operator actions</Text>}>
        {commands.map((command) => (
          <View key={command.id} style={styles.commandRow}>
            <View style={styles.rowStart}>
              <Command size={14} color="#76A9FF" />
              <Text style={styles.commandTitle}>{command.title}</Text>
            </View>
            <Text style={styles.commandReason}>{command.reason}</Text>
            <Text style={styles.commandText}>{command.command}</Text>
          </View>
        ))}
      </SectionCard>
    </View>
  );
});

function renderTab(tab: TabId, snapshot: NerveCenterSnapshot, live: LiveIntelligenceSnapshot) {
  if (tab === 'traffic') return <TrafficTab sources={snapshot.trafficSources} live={live} />;
  if (tab === 'funnel') return <FunnelTab snapshot={snapshot} live={live} />;
  if (tab === 'risk') return <RiskTab risks={snapshot.riskModules} incidents={snapshot.incidents} live={live} />;
  if (tab === 'chat') return <ChatTab rooms={snapshot.chatRooms} live={live} />;
  if (tab === 'blueprint') return <BlueprintTab nodes={snapshot.architectureNodes} dependencies={snapshot.dependencies} commands={snapshot.commands} />;
  return <NerveTab snapshot={snapshot} live={live} />;
}

export default function ControlTowerScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('nerve');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [snapshot, setSnapshot] = useState<NerveCenterSnapshot>(() => buildNerveCenterSnapshot());
  const liveSnapshot = useLiveIntelligenceSnapshot();
  const ownerAIConfigAudit = useMemo<IVXOwnerAIConfigAudit>(() => getIVXOwnerAIConfigAudit(), [snapshot.asOf, liveSnapshot.totalLiveUsers]);

  const refreshSnapshot = () => {
    console.log('[NerveCenter] Refreshing operational snapshot');
    setSnapshot(buildNerveCenterSnapshot());
  };

  const onRefresh = () => {
    setRefreshing(true);
    refreshSnapshot();
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      refreshSnapshot();
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  const severityCopy = useMemo(() => {
    return snapshot.globalStatus === 'critical'
      ? 'Critical software risk is concentrated in lead capture, handoff integrity, and owner-room transport.'
      : snapshot.globalStatus === 'warning'
        ? 'Several modules need operator action, but automated containment is holding the blast radius.'
        : 'System is stable with fresh proofs across the critical path.';
  }, [snapshot.globalStatus]);
  const environmentAudit = useMemo<EnvironmentAuditSummary>(() => buildEnvironmentAuditSummary(ownerAIConfigAudit), [ownerAIConfigAudit]);
  const auditToneColor = useMemo<string>(() => getAuditToneColor(environmentAudit.tone), [environmentAudit.tone]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="nerve-back-button">
            <ArrowLeft size={18} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>Runtime intelligence cockpit</Text>
            <Text style={styles.headerTitle}>Nerve Center</Text>
            <Text style={styles.headerSubtitle}>{severityCopy}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/autonomous-dashboard' as never)}
            style={[styles.refreshButton, { backgroundColor: 'rgba(0,230,118,0.15)', borderColor: '#00E676', borderWidth: 1 }]}
            testID="nerve-autonomous-live-work-btn"
          >
            <Cpu size={16} color="#00E676" />
          </TouchableOpacity>
          <TouchableOpacity onPress={refreshSnapshot} style={styles.refreshButton} testID="nerve-refresh-button">
            <RefreshCw size={16} color="#76A9FF" />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#76A9FF" />}
        >
          <View style={[styles.topStatusBanner, { borderColor: `${auditToneColor}33`, backgroundColor: `${auditToneColor}14` }]} testID="nerve-top-status-banner">
            <View style={styles.signalRow}>
              <LiveDot color={auditToneColor} />
              <Text style={[styles.signalText, { color: auditToneColor }]}>{environmentAudit.routingAuditState.replace(/_/g, ' ').toUpperCase()}</Text>
            </View>
            <Text style={styles.topStatusBannerTitle}>Owner AI routing and environment audit</Text>
            <Text style={styles.topStatusBannerBody}>{environmentAudit.topBannerMessage}</Text>
          </View>

          {environmentAudit.productionGuardBlocked ? (
            <View style={styles.productionGuardCard} testID="nerve-production-guard-block">
              <Text style={styles.productionGuardEyebrow}>Production guard block</Text>
              <Text style={styles.productionGuardTitle}>Remote Owner AI routing is blocked</Text>
              <Text style={styles.productionGuardBody}>{ownerAIConfigAudit.configurationError ?? 'Production configuration is invalid for Owner AI routing.'}</Text>
              <View style={styles.auditGrid}>
                <AuditField label="Environment" value={environmentAudit.environment} />
                <AuditField label="Configured URL" value={environmentAudit.configuredUrl} />
                <AuditField label="Routing state" value={environmentAudit.routingAuditState} />
                <AuditField label="Config source" value={environmentAudit.configSource} />
              </View>
            </View>
          ) : null}

          <SectionCard title="Environment audit" right={<Text style={styles.sectionHint}>live routing + fallback</Text>}>
            <View style={styles.auditGrid} testID="nerve-environment-audit-panel">
              <AuditField label="Environment" value={environmentAudit.environment} />
              <AuditField label="Routing / audit state" value={environmentAudit.routingAuditState} />
              <AuditField label="Configured URL" value={environmentAudit.configuredUrl} />
              <AuditField label="Config source" value={environmentAudit.configSource} />
              <AuditField label="Explicit production pin" value={environmentAudit.explicitProductionPin} />
              <AuditField label="Active base URL" value={environmentAudit.activeBaseUrl} />
              <AuditField label="Active host" value={environmentAudit.activeHost} />
              <AuditField label="Active endpoint" value={environmentAudit.activeEndpoint} />
              <AuditField label="App API base URL" value={environmentAudit.directApiBaseUrl} />
              <AuditField label="App API host" value={environmentAudit.directApiHost} />
              <AuditField label="Owner health URL" value={environmentAudit.ownerAiHealthUrl} />
              <AuditField label="Owner Route53 audit URL" value={environmentAudit.ownerRoute53AuditUrl} />
              <AuditField label="App API health URL" value={environmentAudit.appApiHealthUrl} />
              <AuditField label="App API Route53 audit URL" value={environmentAudit.appApiRoute53AuditUrl} />
              <AuditField label="Canonical base URL" value={environmentAudit.canonicalBaseUrl} />
              <AuditField label="Active fallback URL" value={environmentAudit.activeFallbackUrl} />
              <AuditField label="Fallback used" value={environmentAudit.fallbackUsed} />
              <AuditField label="Production guard" value={environmentAudit.productionGuardText} />
            </View>
            <View style={styles.auditNarrativeCard}>
              <Text style={styles.auditNarrativeTitle}>Why fallback was selected</Text>
              <Text style={styles.auditNarrativeBody}>{environmentAudit.whyFallbackSelected}</Text>
            </View>
            <View style={styles.auditNarrativeCard}>
              <Text style={styles.auditNarrativeTitle}>Selection reason</Text>
              <Text style={styles.auditNarrativeBody}>{environmentAudit.selectionReason}</Text>
            </View>
            {environmentAudit.mismatchWarnings.length > 0 ? (
              <View style={styles.auditNarrativeCard} testID="nerve-environment-mismatch-card">
                <Text style={styles.auditNarrativeTitle}>Broken host warnings</Text>
                {environmentAudit.mismatchWarnings.map((warning, index) => (
                  <Text key={`${warning}-${index}`} style={styles.auditNarrativeBody}>{`• ${warning}`}</Text>
                ))}
              </View>
            ) : null}
            <View style={styles.auditNarrativeCard} testID="nerve-environment-trace-card">
              <Text style={styles.auditNarrativeTitle}>Broken host trace</Text>
              {environmentAudit.workflowTrace.map((step, index) => (
                <Text key={`${step}-${index}`} style={styles.auditNarrativeBody}>{`${index + 1}. ${step}`}</Text>
              ))}
            </View>
          </SectionCard>

          <View style={styles.bannerRow}>
            <View style={styles.bannerLeft}>
              <View style={styles.signalRow}>
                <LiveDot color={getHealthColor(snapshot.globalStatus)} />
                <Text style={[styles.signalText, { color: getHealthColor(snapshot.globalStatus) }]}>{snapshot.globalStatus.toUpperCase()}</Text>
              </View>
              <Text style={styles.bannerTitle}>Real-time audit, trace, predict, escalate.</Text>
            </View>
            <View style={styles.bannerBadges}>
              <View style={styles.bannerBadge}><Cpu size={12} color="#76A9FF" /><Text style={styles.bannerBadgeText}>{liveSnapshot.moduleMetrics.length || snapshot.modules.length} modules</Text></View>
              <View style={styles.bannerBadge}><Timer size={12} color="#FFB84D" /><Text style={styles.bannerBadgeText}>{liveSnapshot.totalLiveUsers} live users</Text></View>
              <View style={styles.bannerBadge}><Bot size={12} color="#B692F6" /><Text style={styles.bannerBadgeText}>{liveSnapshot.stalledProfiles.length} stalled</Text></View>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRail}>
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = item.id === tab;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setTab(item.id)}
                  style={[styles.tabChip, active ? styles.tabChipActive : null]}
                  testID={`tab-${item.id}`}
                >
                  <Icon size={14} color={active ? '#0A101B' : Colors.textSecondary} />
                  <Text style={[styles.tabChipText, active ? styles.tabChipTextActive : null]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {renderTab(tab, snapshot, liveSnapshot)}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#04070C'},
  safeArea: {
    flex: 1},
  backgroundGlowTop: {
    position: 'absolute',
    top: -120,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(118,169,255,0.08)'},
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -140,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(182,146,246,0.08)'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8},
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'},
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(118,169,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(118,169,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCopy: {
    flex: 1},
  headerEyebrow: {
    color: '#76A9FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase'},
  headerTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 2},
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3},
  content: {
    paddingHorizontal: 20,
    paddingBottom: 120},
  topStatusBanner: {
    marginTop: 8,
    marginBottom: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8},
  topStatusBannerTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800'},
  topStatusBannerBody: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  productionGuardCard: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,77,109,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,109,0.28)',
    gap: 10},
  productionGuardEyebrow: {
    color: '#FF8AA0',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8},
  productionGuardTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800'},
  productionGuardBody: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  auditGrid: {
    gap: 10},
  auditField: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4},
  auditFieldLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6},
  auditFieldValue: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700'},
  auditNarrativeCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 5},
  auditNarrativeTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700'},
  auditNarrativeBody: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  bannerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
    marginBottom: 14},
  bannerLeft: {
    flex: 1},
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  signalText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8},
  bannerTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: 8,
    maxWidth: 260},
  bannerBadges: {
    width: 120,
    gap: 8},
  bannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  bannerBadgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700'},
  tabRail: {
    gap: 10,
    paddingBottom: 8},
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  tabChipActive: {
    backgroundColor: '#89D3FF',
    borderColor: '#89D3FF'},
  tabChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'},
  tabChipTextActive: {
    color: '#0A101B'},
  tabBody: {
    gap: 14,
    marginTop: 10},
  hero: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(9,15,24,0.94)',
    borderWidth: 1},
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  heroState: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8},
  heroTime: {
    color: Colors.textTertiary,
    fontSize: 11},
  heroTitle: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 12},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8},
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14},
  metricTile: {
    minWidth: '31%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  metricValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800'},
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6},
  sectionCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(8,12,19,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700'},
  sectionHint: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6},
  panelGrid: {
    gap: 10},
  modulePanel: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1},
  modulePanelTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  moduleName: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  moduleStatus: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'},
  moduleValue: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 10},
  moduleMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 4},
  recommendationRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    gap: 8},
  recommendationTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  recommendationTarget: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize'},
  recommendationSeverity: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7},
  recommendationReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  rowStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  metaText: {
    color: Colors.textTertiary,
    fontSize: 11},
  commandText: {
    color: '#89D3FF',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700'},
  approvalRow: {
    gap: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(182,146,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(182,146,246,0.18)'},
  approvalTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  approvalReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  pathRow: {
    gap: 5,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  pathRowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  pathName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  pathState: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'},
  pathReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  pathImpact: {
    color: '#76A9FF',
    fontSize: 11},
  flowCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    gap: 8},
  flowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  flowTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  flowHealth: {
    fontSize: 11,
    fontWeight: '800'},
  flowMetaGrid: {
    gap: 4},
  flowPath: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6},
  pathPill: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)'},
  anomalyText: {
    color: '#FF4D6D',
    fontSize: 12,
    fontWeight: '700'},
  funnelStageRow: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 6},
  funnelStageTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  funnelStageName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  funnelStageCount: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800'},
  stageReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  stageImpact: {
    color: '#76A9FF',
    fontSize: 11},
  dropTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700'},
  dropBody: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  dropMeta: {
    color: Colors.textTertiary,
    fontSize: 11},
  logicAlert: {
    color: '#FF4D6D',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18},
  riskRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    gap: 7},
  riskRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  riskModule: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize'},
  riskScore: {
    fontSize: 22,
    fontWeight: '800'},
  riskExplanation: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  riskChange: {
    color: '#B692F6',
    fontSize: 11},
  incidentRow: {
    gap: 5,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  incidentTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  incidentReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  chatCard: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    gap: 10},
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  chatRoomName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  chatState: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'},
  chatProof: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  chatMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 17},
  blueprintNode: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    gap: 7},
  blueprintTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8},
  blueprintName: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  blueprintStatus: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'},
  blueprintMeta: {
    color: Colors.textTertiary,
    fontSize: 11},
  blueprintIssue: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  blueprintImpact: {
    color: '#76A9FF',
    fontSize: 11},
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  connectionText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700'},
  connectionType: {
    marginLeft: 'auto',
    color: Colors.textTertiary,
    fontSize: 11,
    textTransform: 'lowercase'},
  commandRow: {
    gap: 5,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  commandTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  commandReason: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  liveDotWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center'},
  liveDotHalo: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7},
  liveDotCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5}});
