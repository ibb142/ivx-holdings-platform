import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  Alert,
  Share} from "react-native";
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  Globe,
  Server,
  Database,
  MessageCircle,
  Monitor,
  Radio,
  GitBranch,
  Zap,
  Clock,
  Play,
  FileText,
  Shield,
  ChevronRight,
  ExternalLink,
  Cloud,
  HardDrive,
  Copy,
  Download,
  History,
  Timer,
  Wifi,
  WifiOff,
  SignalHigh,
  SignalLow,
  SignalZero} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  runFullEvidenceCheck,
  runSingleEvidenceCheck,
  loadEvidenceHistory,
  exportReportJSON,
  exportReportCompact,
  isEvidenceComplete,
  buildProofReport,
  type LiveEvidenceReport,
  type EvidenceStatus,
  type EvidenceFinalStatus,
  type DataFreshness,
  type StreamEvent,
  type GitHubEvidenceResult,
  type RenderEvidenceResult,
  type RenderDeployHistoryEntry,
  type HealthEvidenceResult,
  type ChatEvidenceResult,
  type SupabaseEvidenceResult,
  type FrontendEvidenceResult,
  type EvidenceHistoryEntry} from '@/lib/live-evidence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_PADDING = 16;
const CARD_GAP = 10;
const AUTO_REFRESH_MS = 60_000; // 60 seconds

const STATUS_CONFIG: Record<EvidenceStatus, { icon: typeof CheckCircle; color: string; label: string }> = {
  ok: { icon: CheckCircle, color: '#00C48C', label: 'OK' },
  fail: { icon: XCircle, color: '#FF4D4D', label: 'FAIL' },
  checking: { icon: Activity, color: '#F59E0B', label: 'CHECKING' },
  skipped: { icon: AlertTriangle, color: '#6366F1', label: 'SKIPPED' }};

const FINAL_STATUS_CONFIG: Record<EvidenceFinalStatus, { color: string; bg: string }> = {
  COMPLETE: { color: '#00C48C', bg: 'rgba(34,197,94,0.12)' },
  BLOCKED: { color: '#FF4D4D', bg: 'rgba(239,68,68,0.12)' },
  'LOCAL ONLY': { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  UNVERIFIED: { color: '#6366F1', bg: 'rgba(99,102,241,0.12)' }};

const FRESHNESS_CONFIG: Record<DataFreshness, { icon: typeof SignalHigh; color: string; label: string; bg: string }> = {
  LIVE: { icon: SignalHigh, color: '#00C48C', label: 'LIVE', bg: 'rgba(34,197,94,0.12)' },
  STALE: { icon: SignalLow, color: '#F59E0B', label: 'STALE', bg: 'rgba(245,158,11,0.12)' },
  FAILED: { icon: SignalZero, color: '#FF4D4D', label: 'FAILED', bg: 'rgba(239,68,68,0.12)' }};

const TOOL_ICONS: Record<string, typeof Activity> = {
  GitHub: GitBranch,
  Render: Cloud,
  Health: Activity,
  Chat: MessageCircle,
  Supabase: Database,
  Frontend: Monitor};

const TOOL_COLORS: Record<string, string> = {
  GitHub: '#F0F6FC',
  Render: '#8B5CF6',
  Health: '#00C48C',
  Chat: '#4A90D9',
  Supabase: '#00C48C',
  Frontend: '#06B6D4'};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: EvidenceStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <View style={[statusBadgeStyles.badge, { backgroundColor: cfg.color + '1A' }]}>
      <Icon size={10} color={cfg.color} strokeWidth={3} />
      <Text style={[statusBadgeStyles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const statusBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10},
  label: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const}});

function FreshnessBadge({ freshness }: { freshness: DataFreshness }) {
  const cfg = FRESHNESS_CONFIG[freshness];
  const Icon = cfg.icon;
  return (
    <View style={[freshnessBadgeStyles.badge, { backgroundColor: cfg.bg }]}>
      <Icon size={12} color={cfg.color} strokeWidth={2.5} />
      <Text style={[freshnessBadgeStyles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const freshnessBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8},
  label: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const}});

function ToolCard({
  tool,
  icon,
  color,
  status,
  children}: {
  tool: string;
  icon: typeof Activity;
  color: string;
  status: EvidenceStatus;
  children: React.ReactNode;
}) {
  const Icon = icon;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'checking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [status, pulseAnim]);

  return (
    <View style={toolCardStyles.card}>
      <View style={toolCardStyles.header}>
        <View style={toolCardStyles.titleRow}>
          <Animated.View style={[toolCardStyles.iconBox, { backgroundColor: color + '18', opacity: status === 'checking' ? pulseAnim : 1 }]}>
            <Icon size={16} color={color} strokeWidth={2.2} />
          </Animated.View>
          <Text style={toolCardStyles.toolName}>{tool}</Text>
        </View>
        <StatusBadge status={status} />
      </View>
      {children}
    </View>
  );
}

const toolCardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: Colors.surfaceBorder,
    padding: CARD_PADDING,
    marginBottom: CARD_GAP},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'},
  toolName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text}});

function EvidenceRow({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  if (!value && value !== '0') return null;
  return (
    <View style={evidenceRowStyles.row}>
      <Text style={evidenceRowStyles.label}>{label}</Text>
      <Text
        style={[
          evidenceRowStyles.value,
          mono && evidenceRowStyles.mono,
          color ? { color } : undefined,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const evidenceRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4},
  label: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1},
  value: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    flex: 1.5,
    textAlign: 'right' as const},
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    color: Colors.gold}});

function MatchBadge({ matches }: { matches: boolean }) {
  return (
    <View
      style={[
        matchBadgeStyles.badge,
        { backgroundColor: matches ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' },
      ]}
    >
      {matches ? (
        <CheckCircle size={10} color="#00C48C" strokeWidth={3} />
      ) : (
        <XCircle size={10} color="#FF4D4D" strokeWidth={3} />
      )}
      <Text
        style={[
          matchBadgeStyles.text,
          { color: matches ? '#00C48C' : '#FF4D4D' },
        ]}
      >
        {matches ? 'MATCH' : 'MISMATCH'}
      </Text>
    </View>
  );
}

const matchBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start'},
  text: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.4}});

function StreamLogItem({ event }: { event: StreamEvent }) {
  const iconColor =
    event.phase === 'error' ? '#FF4D4D' :
    event.phase === 'completed' ? '#00C48C' :
    '#F59E0B';

  const ToolIcon = TOOL_ICONS[event.tool] || Activity;

  return (
    <View style={streamLogStyles.row}>
      <View style={[streamLogStyles.dot, { backgroundColor: iconColor }]} />
      <ToolIcon size={12} color={TOOL_COLORS[event.tool] || Colors.textTertiary} strokeWidth={2} />
      <View style={streamLogStyles.textCol}>
        <Text style={streamLogStyles.message} numberOfLines={2}>
          {event.message}
        </Text>
        {event.detail ? (
          <Text style={streamLogStyles.detail} numberOfLines={1}>
            {event.detail}
          </Text>
        ) : null}
      </View>
      <Text style={streamLogStyles.time}>
        {new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })}
      </Text>
    </View>
  );
}

const streamLogStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder},
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5},
  textCol: {
    flex: 1},
  message: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15},
  detail: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 1},
  time: {
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 1}});

function HistoryEntryRow({ entry }: { entry: EvidenceHistoryEntry }) {
  const cfg = FINAL_STATUS_CONFIG[entry.finalStatus];
  return (
    <View style={historyRowStyles.row}>
      <View style={[historyRowStyles.statusDot, { backgroundColor: cfg.color }]} />
      <View style={historyRowStyles.content}>
        <Text style={historyRowStyles.time}>
          {new Date(entry.timestamp).toLocaleString()}
        </Text>
        {entry.commitSha ? (
          <Text style={historyRowStyles.commit} numberOfLines={1}>
            Commit: {entry.commitSha.slice(0, 8)}
          </Text>
        ) : null}
        <View style={historyRowStyles.results}>
          <View style={[historyRowStyles.miniBadge, { backgroundColor: entry.healthResult === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
            <Activity size={8} color={entry.healthResult === 'ok' ? '#00C48C' : '#FF4D4D'} strokeWidth={3} />
            <Text style={[historyRowStyles.miniText, { color: entry.healthResult === 'ok' ? '#00C48C' : '#FF4D4D' }]}>Health</Text>
          </View>
          <View style={[historyRowStyles.miniBadge, { backgroundColor: entry.chatResult === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
            <MessageCircle size={8} color={entry.chatResult === 'ok' ? '#00C48C' : '#FF4D4D'} strokeWidth={3} />
            <Text style={[historyRowStyles.miniText, { color: entry.chatResult === 'ok' ? '#00C48C' : '#FF4D4D' }]}>Chat</Text>
          </View>
          <View style={[historyRowStyles.miniBadge, { backgroundColor: entry.supabaseResult === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
            <Database size={8} color={entry.supabaseResult === 'ok' ? '#00C48C' : '#FF4D4D'} strokeWidth={3} />
            <Text style={[historyRowStyles.miniText, { color: entry.supabaseResult === 'ok' ? '#00C48C' : '#FF4D4D' }]}>DB</Text>
          </View>
        </View>
      </View>
      <View style={[historyRowStyles.finalBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[historyRowStyles.finalText, { color: cfg.color }]}>{entry.finalStatus}</Text>
      </View>
    </View>
  );
}

const historyRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder},
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  content: {
    flex: 1},
  time: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  commit: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 2},
  results: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4},
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4},
  miniText: {
    fontSize: 9,
    fontWeight: '700' as const},
  finalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  finalText: {
    fontSize: 10,
    fontWeight: '800' as const}});

function DeployHistoryRow({ entry }: { entry: RenderDeployHistoryEntry }) {
  const statusColor = entry.status === 'live' || entry.status === 'successful' ? '#00C48C'
    : entry.status === 'failed' ? '#FF4D4D'
    : '#F59E0B';
  return (
    <View style={deployRowStyles.row}>
      <View style={[deployRowStyles.statusDot, { backgroundColor: statusColor }]} />
      <View style={deployRowStyles.content}>
        <Text style={deployRowStyles.deployId} numberOfLines={1}>{entry.deployId.slice(0, 12)}</Text>
        <Text style={deployRowStyles.meta}>
          {entry.commitSha.slice(0, 8)} · {entry.durationMs > 0 ? `${(entry.durationMs / 1000).toFixed(1)}s` : 'N/A'}
        </Text>
      </View>
      <Text style={[deployRowStyles.status, { color: statusColor }]}>{entry.status}</Text>
      <Text style={deployRowStyles.time}>
        {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false }) : ''}
      </Text>
    </View>
  );
}

const deployRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6},
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  content: { flex: 1 },
  deployId: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' })},
  meta: { fontSize: 9, color: Colors.textTertiary, marginTop: 1 },
  status: { fontSize: 10, fontWeight: '700' as const },
  time: { fontSize: 9, color: Colors.textTertiary }});

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  variant}: {
  label: string;
  icon: typeof RefreshCw;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'export';
}) {
  const Icon = icon;
  const isPrimary = variant === 'primary';
  const isExport = variant === 'export';
  return (
    <TouchableOpacity
      style={[
        actionButtonStyles.button,
        isPrimary ? actionButtonStyles.primary : isExport ? actionButtonStyles.export : actionButtonStyles.secondary,
        disabled && actionButtonStyles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Icon size={14} color={isPrimary ? '#000' : isExport ? '#00C48C' : Colors.gold} strokeWidth={2.2} />
      <Text
        style={[
          actionButtonStyles.label,
          { color: isPrimary ? '#000' : isExport ? '#00C48C' : Colors.gold },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const actionButtonStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    flex: 1,
    minHeight: 44},
  primary: { backgroundColor: Colors.gold },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.gold + '50'},
  export: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#00C48C50'},
  disabled: { opacity: 0.4 },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.3 }});

function SectionHeader({ icon: Icon, title }: { icon: typeof Shield; title: string }) {
  return (
    <View style={sectionHeaderStyles.row}>
      <Icon size={16} color={Colors.gold} strokeWidth={2} />
      <Text style={sectionHeaderStyles.title}>{title}</Text>
    </View>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.gold,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const}});

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function LiveEvidenceDashboard() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [report, setReport] = useState<LiveEvidenceReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingTool, setCheckingTool] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [showStream, setShowStream] = useState(true);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [history, setHistory] = useState<EvidenceHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDeployHistory, setShowDeployHistory] = useState(false);

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    setStreamEvents((prev) => {
      const next = [...prev, event];
      if (next.length > 100) return next.slice(-100);
      return next;
    });
  }, []);

  const runAllChecks = useCallback(async () => {
    setChecking(true);
    setStreamEvents([]);
    setReport(null);

    try {
      const result = await runFullEvidenceCheck({}, handleStreamEvent);
      setReport(result);
      const now = new Date().toISOString();
      setLastCheckTime(now);
    } catch (err) {
      console.warn('[LiveEvidence] Full check failed:', err);
    } finally {
      setChecking(false);
      setCheckingTool(null);
    }
  }, [handleStreamEvent]);

  const runToolCheck = useCallback(async (tool: 'github' | 'render' | 'health' | 'chat' | 'supabase' | 'frontend') => {
    setCheckingTool(tool);
    try {
      const result = await runSingleEvidenceCheck(tool, handleStreamEvent);
      setReport(result);
      const now = new Date().toISOString();
      setLastCheckTime(now);
    } catch (err) {
      console.warn('[LiveEvidence] Tool check failed:', tool, err);
    } finally {
      setCheckingTool(null);
    }
  }, [handleStreamEvent]);

  // Load evidence history on mount
  useEffect(() => {
    loadEvidenceHistory().then(setHistory).catch(() => {});
  }, []);

  // Auto-run on mount
  useEffect(() => {
    runAllChecks();
  }, [runAllChecks]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      runAllChecks().then(() => {
        loadEvidenceHistory().then(setHistory).catch(() => {});
      });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, runAllChecks]);

  // Export handlers
  const handleExportJSON = useCallback(async () => {
    if (!report) return;
    const json = exportReportJSON(report);
    try {
      await Clipboard.setStringAsync(json);
      Alert.alert('Exported', 'Proof report JSON copied to clipboard.');
    } catch {
      // Share fallback
      try {
        await Share.share({ message: json });
      } catch {
        Alert.alert('Export Error', 'Could not export the report.');
      }
    }
  }, [report]);

  const handleCopyReport = useCallback(async () => {
    if (!report) return;
    const text = exportReportCompact(report);
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', 'Proof report copied to clipboard.');
    } catch {
      Alert.alert('Copy Error', 'Could not copy to clipboard.');
    }
  }, [report]);

  const finalStatusConfig = report ? FINAL_STATUS_CONFIG[report.finalStatus] : null;
  const freshness = report?.freshness ?? 'FAILED';

  // --- Render sections --- //

  const renderCommitMatchSection = () => {
    if (!report) return null;
    const { github, render, health } = report;

    return (
      <View style={commitMatchStyles.section}>
        <SectionHeader icon={GitBranch} title="COMMIT MATCH" />
        <View style={commitMatchStyles.card}>
          <View style={commitMatchStyles.shaRow}>
            <View style={commitMatchStyles.shaBlock}>
              <Text style={commitMatchStyles.shaLabel}>GitHub</Text>
              <Text style={commitMatchStyles.shaValue} numberOfLines={1}>
                {github.commitShort || github.latestCommitSha.slice(0, 8) || 'N/A'}
              </Text>
            </View>
            <View style={commitMatchStyles.arrowCol}>
              <View style={commitMatchStyles.arrowLine} />
            </View>
            <View style={commitMatchStyles.shaBlock}>
              <Text style={commitMatchStyles.shaLabel}>Live (/health)</Text>
              <Text style={commitMatchStyles.shaValue} numberOfLines={1}>
                {health.liveCommitSha.slice(0, 8) || 'N/A'}
              </Text>
            </View>
            <View style={commitMatchStyles.arrowCol}>
              <View style={commitMatchStyles.arrowLine} />
            </View>
            <View style={commitMatchStyles.shaBlock}>
              <Text style={commitMatchStyles.shaLabel}>Render</Text>
              <Text style={commitMatchStyles.shaValue} numberOfLines={1}>
                {render.deployedCommitSha.slice(0, 8) || 'N/A'}
              </Text>
            </View>
          </View>
          <View style={commitMatchStyles.matchRow}>
            <MatchBadge matches={render.commitMatch} />
            <Text style={commitMatchStyles.matchHint}>
              {render.commitMatch
                ? 'All commit SHAs match across GitHub, live backend, and Render.'
                : 'Commit SHAs differ — a deploy may be pending.'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderMonitorSection = () => {
    if (!report) return null;

    const { github, render, health, chat, supabase, frontend } = report;

    return (
      <View style={monitorStyles.section}>
        <View style={monitorStyles.headerRow}>
          <View style={monitorStyles.titleGroup}>
            <Shield size={18} color={Colors.gold} strokeWidth={2} />
            <Text style={monitorStyles.sectionTitle}>LIVE DEPLOYMENT EVIDENCE</Text>
          </View>
          <View style={monitorStyles.statusRow}>
            <FreshnessBadge freshness={freshness} />
            {finalStatusConfig && (
              <View style={[monitorStyles.finalBadge, { backgroundColor: finalStatusConfig.bg }]}>
                <Text style={[monitorStyles.finalBadgeText, { color: finalStatusConfig.color }]}>
                  {report.finalStatus}
                </Text>
              </View>
            )}
          </View>
        </View>

        {lastCheckTime ? (
          <View style={monitorStyles.lastCheckRow}>
            <Clock size={10} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={monitorStyles.lastCheck}>
              Last checked: {new Date(lastCheckTime).toLocaleString()}
            </Text>
            {autoRefresh && (
              <Text style={monitorStyles.autoRefreshLabel}>· auto-refresh 60s</Text>
            )}
          </View>
        ) : null}

        {/* GitHub Evidence */}
        <ToolCard tool="GitHub" icon={GitBranch} color={TOOL_COLORS.GitHub} status={github.status}>
          {github.status !== 'skipped' && (
            <>
              <EvidenceRow label="Repository" value={github.repo} mono />
              <EvidenceRow label="Branch" value={github.branch} mono />
              <EvidenceRow label="Latest Commit SHA" value={github.latestCommitSha.slice(0, 8)} mono />
              <EvidenceRow label="Commit Timestamp" value={github.commitTimestamp ? new Date(github.commitTimestamp).toLocaleString() : ''} />
              {github.error ? <Text style={monitorStyles.errorText}>{github.error}</Text> : null}
            </>
          )}
        </ToolCard>

        {/* Render Evidence */}
        <ToolCard tool="Render" icon={Cloud} color={TOOL_COLORS.Render} status={render.status}>
          {render.status !== 'skipped' && (
            <>
              <EvidenceRow label="Service" value={render.service} />
              <EvidenceRow label="Deploy ID" value={render.deployId.slice(0, 20)} mono />
              <EvidenceRow label="Deploy Status" value={render.deployStatus} />
              <EvidenceRow label="Deployed Commit" value={render.deployedCommitSha.slice(0, 8)} mono />
              <EvidenceRow label="Deploy Timestamp" value={render.deployTimestamp ? new Date(render.deployTimestamp).toLocaleString() : ''} />
              <View style={monitorStyles.matchLabel}>
                <Text style={evidenceRowStyles.label}>Commit Match</Text>
                <MatchBadge matches={render.commitMatch} />
              </View>
              {render.error ? <Text style={monitorStyles.errorText}>{render.error}</Text> : null}

              {/* Deploy History subsection */}
              {render.deployHistory.length > 0 && (
                <View style={monitorStyles.deployHistoryContainer}>
                  <TouchableOpacity
                    style={monitorStyles.deployHistoryToggle}
                    onPress={() => setShowDeployHistory(!showDeployHistory)}
                    activeOpacity={0.7}
                  >
                    <Text style={monitorStyles.deployHistoryTitle}>
                      Deploy History ({render.deployHistory.length})
                    </Text>
                    <ChevronRight
                      size={14}
                      color={Colors.textTertiary}
                      strokeWidth={2}
                      style={{ transform: [{ rotate: showDeployHistory ? '90deg' : '0deg' }] }}
                    />
                  </TouchableOpacity>
                  {showDeployHistory &&
                    render.deployHistory.slice(0, 10).map((entry, i) => (
                      <DeployHistoryRow key={entry.deployId || String(i)} entry={entry} />
                    ))}
                </View>
              )}
            </>
          )}
        </ToolCard>

        {/* Health Evidence */}
        <ToolCard tool="Health" icon={Activity} color={TOOL_COLORS.Health} status={health.status}>
          {health.status !== 'skipped' && (
            <>
              <EvidenceRow label="HTTP Status" value={String(health.httpStatus)} color={health.httpStatus === 200 ? '#00C48C' : '#FF4D4D'} />
              <EvidenceRow label="Response Time" value={`${health.responseTimeMs}ms`} />
              <EvidenceRow label="Uptime" value={health.uptime} />
              <EvidenceRow label="Live Commit SHA" value={health.liveCommitSha.slice(0, 8)} mono />
              {health.lastFailedCheck && (
                <EvidenceRow label="Last Failed" value={new Date(health.lastFailedCheck).toLocaleString()} />
              )}
              {health.error ? <Text style={monitorStyles.errorText}>{health.error}</Text> : null}
              {health.responseBody && Object.keys(health.responseBody).length > 0 && (
                <View style={monitorStyles.responseBodyBox}>
                  <Text style={monitorStyles.responseBodyText} numberOfLines={5}>
                    {JSON.stringify(health.responseBody, null, 0).slice(0, 500)}
                  </Text>
                </View>
              )}
            </>
          )}
        </ToolCard>

        {/* Chat Evidence */}
        <ToolCard tool="Chat" icon={MessageCircle} color={TOOL_COLORS.Chat} status={chat.status}>
          {chat.status !== 'skipped' && (
            <>
              <EvidenceRow label="Conversation" value={chat.conversationId} mono />
              <EvidenceRow label="Messages Sent" value={String(chat.messageIds.length)} />
              <EvidenceRow label="Assistant Replied" value={chat.assistantReplied ? 'YES' : 'NO'} />
              <EvidenceRow label="Message Saved" value={chat.messageSaved ? 'YES' : 'NO'} />
              <EvidenceRow label="Persisted on Reload" value={chat.messagePersistedAfterReload ? 'YES' : 'NO'} />
              {chat.proofMessages.length > 0 && (
                <View style={monitorStyles.proofMsgs}>
                  {chat.proofMessages.map((m) => (
                    <Text key={m.id} style={monitorStyles.proofMsg} numberOfLines={2}>
                      [{m.role}] {m.id.slice(0, 8)}: {m.text.slice(0, 80)}
                    </Text>
                  ))}
                </View>
              )}
              {chat.error ? <Text style={monitorStyles.errorText}>{chat.error}</Text> : null}
            </>
          )}
        </ToolCard>

        {/* Supabase Evidence */}
        <ToolCard tool="Supabase" icon={Database} color={TOOL_COLORS.Supabase} status={supabase.status}>
          {supabase.status !== 'skipped' && (
            <>
              <EvidenceRow label="Connection" value={supabase.connectionOk ? 'OK' : 'FAIL'} />
              <EvidenceRow label="Tables Found" value={String(supabase.tables.length)} />
              <EvidenceRow label="Members" value={String(supabase.membersCount)} />
              <EvidenceRow label="Waitlist" value={String(supabase.waitlistCount)} />
              <EvidenceRow label="Chat Conversations" value={String(supabase.chatConversationsCount)} />
              <EvidenceRow label="Chat Messages" value={String(supabase.chatMessagesCount)} />
              <EvidenceRow label="Insert Works" value={supabase.insertWorks ? 'YES' : 'NO'} />
              <EvidenceRow label="Read Works" value={supabase.readWorks ? 'YES' : 'NO'} />
              <EvidenceRow label="RLS" value={supabase.rlsEnabled ? 'ENABLED' : 'DISABLED'} />
              <EvidenceRow label="Auth Status" value={supabase.authStatus} />
              {supabase.lastInsertReadTest && (
                <EvidenceRow label="Last Read Test" value={new Date(supabase.lastInsertReadTest).toLocaleString()} />
              )}
              {supabase.tables.length > 0 && (
                <Text style={monitorStyles.tablesList} numberOfLines={3}>
                  Tables: {supabase.tables.slice(0, 10).join(', ')}
                  {supabase.tables.length > 10 ? ` +${supabase.tables.length - 10} more` : ''}
                </Text>
              )}
              {supabase.error ? <Text style={monitorStyles.errorText}>{supabase.error}</Text> : null}
            </>
          )}
        </ToolCard>

        {/* Frontend Evidence */}
        <ToolCard tool="Frontend" icon={Monitor} color={TOOL_COLORS.Frontend} status={frontend.status}>
          {frontend.status !== 'skipped' && (
            <>
              <EvidenceRow label="Chat Room Loads" value={frontend.chatRoomLoads ? 'YES' : 'NO'} />
              <EvidenceRow label="Owner Chat Works" value={frontend.ownerChatWorks ? 'YES' : 'NO'} />
              <EvidenceRow label="Monitor Loads" value={frontend.monitorLoads ? 'YES' : 'NO'} />
              <EvidenceRow label="No TypeError" value={frontend.noTypeError ? 'YES' : 'NO'} />
              {frontend.error ? <Text style={monitorStyles.errorText}>{frontend.error}</Text> : null}
            </>
          )}
        </ToolCard>

        {/* Errors and Blockers */}
        {report.errors.length > 0 && (
          <View style={monitorStyles.alertBox}>
            <XCircle size={14} color="#FF4D4D" strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={monitorStyles.alertTitle}>
                ERRORS ({report.errors.length})
              </Text>
              {report.errors.map((e, i) => (
                <Text key={i} style={monitorStyles.alertText} numberOfLines={2}>{e}</Text>
              ))}
            </View>
          </View>
        )}

        {report.blockers.length > 0 && (
          <View style={[monitorStyles.alertBox, { borderColor: '#F59E0B40' }]}>
            <AlertTriangle size={14} color="#F59E0B" strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={[monitorStyles.alertTitle, { color: '#F59E0B' }]}>
                BLOCKERS ({report.blockers.length})
              </Text>
              {report.blockers.map((b, i) => (
                <Text key={i} style={monitorStyles.alertText} numberOfLines={2}>{b}</Text>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderHistorySection = () => (
    <View style={historySectionStyles.section}>
      <TouchableOpacity
        style={historySectionStyles.toggle}
        onPress={() => setShowHistory(!showHistory)}
        activeOpacity={0.7}
      >
        <SectionHeader icon={History} title="EVIDENCE HISTORY" />
        <View style={historySectionStyles.countBadge}>
          <Text style={historySectionStyles.countText}>{history.length}</Text>
        </View>
      </TouchableOpacity>
      {showHistory && (
        <View style={historySectionStyles.container}>
          {history.length === 0 ? (
            <View style={historySectionStyles.empty}>
              <Clock size={20} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={historySectionStyles.emptyText}>
                No evidence runs yet. Run a check to populate history.
              </Text>
            </View>
          ) : (
            history.slice(0, 20).map((entry, i) => (
              <HistoryEntryRow key={entry.timestamp + i} entry={entry} />
            ))
          )}
        </View>
      )}
    </View>
  );

  const renderStreamSection = () => (
    <View style={streamSectionStyles.section}>
      <TouchableOpacity
        style={streamSectionStyles.toggle}
        onPress={() => setShowStream(!showStream)}
        activeOpacity={0.7}
      >
        <View style={streamSectionStyles.titleGroup}>
          <Radio size={16} color={Colors.gold} strokeWidth={2} />
          <Text style={streamSectionStyles.sectionTitle}>STREAM EVIDENCE LOGS</Text>
        </View>
        <View style={streamSectionStyles.streamCount}>
          <Text style={streamSectionStyles.countText}>{streamEvents.length}</Text>
        </View>
      </TouchableOpacity>

      {showStream && (
        <View style={streamSectionStyles.logContainer}>
          {streamEvents.length === 0 ? (
            <View style={streamSectionStyles.emptyState}>
              <Clock size={20} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={streamSectionStyles.emptyText}>
                {checking ? 'Running evidence checks...' : 'No events yet. Run a check to see live logs.'}
              </Text>
            </View>
          ) : (
            streamEvents.map((event) => (
              <StreamLogItem key={event.id} event={event} />
            ))
          )}
        </View>
      )}
    </View>
  );

  const renderLiveWorkSection = () => (
    <View style={liveWorkStyles.section}>
      <SectionHeader icon={Play} title="LIVE WORK ACTIONS" />

      {/* Primary */}
      <View style={liveWorkStyles.buttonRow}>
        <ActionButton
          label="Run Full Evidence Check"
          icon={RefreshCw}
          onPress={runAllChecks}
          disabled={checking}
          variant="primary"
        />
      </View>

      {/* Row 1: verify + deploy */}
      <View style={liveWorkStyles.buttonGrid}>
        <ActionButton
          label="Verify GitHub"
          icon={GitBranch}
          onPress={() => runToolCheck('github')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
        <ActionButton
          label="Verify Render"
          icon={Cloud}
          onPress={() => runToolCheck('render')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
      </View>

      {/* Row 2: chat + supabase */}
      <View style={liveWorkStyles.buttonGrid}>
        <ActionButton
          label="Test Chat Room"
          icon={MessageCircle}
          onPress={() => runToolCheck('chat')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
        <ActionButton
          label="Test Supabase"
          icon={Database}
          onPress={() => runToolCheck('supabase')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
      </View>

      {/* Row 3: health + frontend */}
      <View style={liveWorkStyles.buttonGrid}>
        <ActionButton
          label="Verify Health"
          icon={Activity}
          onPress={() => runToolCheck('health')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
        <ActionButton
          label="Verify Frontend"
          icon={Monitor}
          onPress={() => runToolCheck('frontend')}
          disabled={checkingTool !== null}
          variant="secondary"
        />
      </View>

      {/* Export row */}
      <View style={liveWorkStyles.buttonGrid}>
        <ActionButton
          label="Export JSON"
          icon={Download}
          onPress={handleExportJSON}
          disabled={!report}
          variant="export"
        />
        <ActionButton
          label="Copy Report"
          icon={Copy}
          onPress={handleCopyReport}
          disabled={!report}
          variant="export"
        />
      </View>

      {/* Auto-refresh toggle */}
      <View style={liveWorkStyles.buttonRow}>
        <TouchableOpacity
          style={[
            actionButtonStyles.button,
            actionButtonStyles.secondary,
            { flex: 0, paddingHorizontal: 20 },
          ]}
          onPress={() => setAutoRefresh(!autoRefresh)}
          activeOpacity={0.7}
        >
          <Timer size={14} color={autoRefresh ? '#00C48C' : Colors.textTertiary} strokeWidth={2.2} />
          <Text style={[actionButtonStyles.label, { color: autoRefresh ? '#00C48C' : Colors.textTertiary }]}>
            Auto-Refresh: {autoRefresh ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      {checking && (
        <View style={liveWorkStyles.checkingBanner}>
          <ShimmerIndicator size="small" color={Colors.gold} />
          <Text style={liveWorkStyles.checkingText}>
            {checkingTool ? `Checking ${checkingTool}...` : 'Running full evidence check...'}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={screenStyles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={screenStyles.header}>
        <TouchableOpacity
          style={screenStyles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={Colors.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={screenStyles.headerCenter}>
          <Text style={screenStyles.headerTitle}>Live Evidence</Text>
          <Text style={screenStyles.headerSubtitle}>IVX Deployment Dashboard</Text>
        </View>
        <TouchableOpacity
          style={screenStyles.refreshButton}
          onPress={runAllChecks}
          disabled={checking}
          activeOpacity={0.7}
        >
          <RefreshCw size={18} color={Colors.gold} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={screenStyles.scroll}
        contentContainerStyle={screenStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderCommitMatchSection()}
        {renderMonitorSection()}
        {renderHistorySection()}
        {renderStreamSection()}
        {renderLiveWorkSection()}

        <View style={screenStyles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const screenStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated},
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  headerSubtitle: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated},
  scroll: { flex: 1 },
  scrollContent: { padding: CARD_PADDING, paddingTop: 12 },
  footer: { height: 40 }});

const commitMatchStyles = StyleSheet.create({
  section: { marginBottom: 16 },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: Colors.surfaceBorder,
    padding: CARD_PADDING},
  shaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10},
  shaBlock: {
    flex: 1,
    alignItems: 'center'},
  shaLabel: { fontSize: 9, color: Colors.textTertiary, marginBottom: 4, letterSpacing: 0.5 },
  shaValue: {
    fontSize: 11,
    color: Colors.gold,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontWeight: '700' as const},
  arrowCol: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center'},
  arrowLine: {
    width: 16,
    height: 1.5,
    backgroundColor: Colors.surfaceBorder},
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  matchHint: {
    fontSize: 10,
    color: Colors.textTertiary,
    flex: 1,
    lineHeight: 14}});

const monitorStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 8},
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.gold,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const},
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  finalBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  finalBadgeText: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.5 },
  lastCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
    paddingLeft: 26},
  lastCheck: { fontSize: 11, color: Colors.textTertiary },
  autoRefreshLabel: { fontSize: 10, color: '#00C48C', fontWeight: '600' as const },
  matchLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4},
  errorText: {
    fontSize: 11,
    color: '#FF4D4D',
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' })},
  deployHistoryContainer: { marginTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.surfaceBorder, paddingTop: 8 },
  deployHistoryToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4},
  deployHistoryTitle: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  responseBodyBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: Colors.background,
    borderRadius: 6},
  responseBodyText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 14},
  proofMsgs: { marginTop: 6, padding: 8, backgroundColor: Colors.background, borderRadius: 6 },
  proofMsg: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 14,
    marginBottom: 2},
  tablesList: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 14},
  alertBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 0.5,
    borderColor: '#FF4D4D40',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8},
  alertTitle: { fontSize: 11, fontWeight: '700' as const, color: '#FF4D4D', marginBottom: 4 },
  alertText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 14}});

const historySectionStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  toggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  countBadge: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 12},
  countText: { fontSize: 11, fontWeight: '700' as const, color: Colors.gold },
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.surfaceBorder,
    padding: 10,
    maxHeight: 280},
  empty: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  emptyText: { fontSize: 12, color: Colors.textTertiary }});

const streamSectionStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  toggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.gold,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const},
  streamCount: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3},
  countText: { fontSize: 11, fontWeight: '700' as const, color: Colors.gold },
  logContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.surfaceBorder,
    padding: 10,
    maxHeight: 300},
  emptyState: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  emptyText: { fontSize: 12, color: Colors.textTertiary }});

const liveWorkStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  buttonRow: { marginBottom: 8, alignItems: 'center' },
  buttonGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  checkingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    marginTop: 8},
  checkingText: { fontSize: 13, color: Colors.gold, fontWeight: '600' as const }});
