import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Activity,
  Boxes,
  ClipboardCopy,
  Cpu,
  Database,
  Gauge,
  MemoryStick,
  MousePointerClick,
  RotateCcw,
  ServerCrash,
  ServerCog,
  ShieldAlert,
  Sparkles,
  Timer,
  TriangleAlert,
  Zap} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ivxDiagnostics, type DiagnosticsSnapshot } from '@/src/modules/ivx-developer/diagnosticsStore';
import { ivxAIWatchdog, type WatchdogSnapshot } from '@/src/modules/ivx-owner-ai/services/ivxAIWatchdog';
import { getMetricsSnapshot, type MetricsSnapshot, type LatencyStats, type SuccessStats } from '@/src/modules/ivx-developer/metricsService';
import { getIVXBuildInfo, type IVXBuildInfo } from '@/constants/build-info';

/** Frame-rate sampling target. Devices may run at 60 or 120Hz; we cap reporting at 120. */
const TARGET_FPS = 60;
const FPS_WINDOW_MS = 1000;
const DROPPED_FRAME_MS = 1000 / TARGET_FPS * 1.5; // > ~25ms ≈ dropped at 60fps

interface FpsSample {
  fps: number;
  jsFps: number;
  worstFrameMs: number;
  droppedFrames: number;
}

interface MemorySample {
  usedMb: number | null;
  totalMb: number | null;
  limitMb: number | null;
  available: boolean;
}

function readMemorySample(): MemorySample {
  try {
    const perf = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } } }).performance;
    const mem = perf?.memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') {
      const toMb = (b?: number): number | null => (typeof b === 'number' ? Math.round((b / (1024 * 1024)) * 10) / 10 : null);
      return {
        usedMb: toMb(mem.usedJSHeapSize),
        totalMb: toMb(mem.totalJSHeapSize),
        limitMb: toMb(mem.jsHeapSizeLimit),
        available: true};
    }
  } catch {
    // ignore
  }
  return { usedMb: null, totalMb: null, limitMb: null, available: false };
}

/**
 * Live FPS / JS-FPS sampler. In React Native, requestAnimationFrame runs on the
 * JS thread, so frame deltas directly reflect JS-thread responsiveness:
 * - fps      = frames rendered in the last 1s window (achieved frame rate).
 * - jsFps    = 1000 / worst frame delta in the window (worst-case jank signal).
 * - dropped  = frames slower than ~1.5× the target frame budget.
 */
function useFpsSampler(active: boolean): FpsSample {
  const [sample, setSample] = useState<FpsSample>({ fps: 0, jsFps: 0, worstFrameMs: 0, droppedFrames: 0 });
  const frameTimesRef = useRef<number[]>([]);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastReportRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    let mounted = true;

    const tick = (ts: number): void => {
      if (!mounted) return;
      const last = lastTsRef.current;
      if (last !== null) {
        const delta = ts - last;
        if (delta > 0 && delta < 2000) {
          frameTimesRef.current.push(delta);
        }
      }
      lastTsRef.current = ts;

      // Trim to a rolling ~1s window by total elapsed time.
      let total = 0;
      const times = frameTimesRef.current;
      for (let i = times.length - 1; i >= 0; i -= 1) {
        total += times[i];
        if (total > FPS_WINDOW_MS) {
          frameTimesRef.current = times.slice(i);
          break;
        }
      }

      if (ts - lastReportRef.current >= 250) {
        lastReportRef.current = ts;
        const window = frameTimesRef.current;
        if (window.length > 0) {
          const sum = window.reduce((a, b) => a + b, 0);
          const fps = Math.min(120, Math.round((window.length / sum) * 1000));
          const worst = Math.max(...window);
          const jsFps = Math.min(120, Math.round(1000 / worst));
          const dropped = window.filter((d) => d > DROPPED_FRAME_MS).length;
          setSample({ fps, jsFps, worstFrameMs: Math.round(worst * 10) / 10, droppedFrames: dropped });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      frameTimesRef.current = [];
      lastTsRef.current = null;
    };
  }, [active]);

  return sample;
}

function useDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>(() => ivxDiagnostics.getSnapshot());
  useEffect(() => {
    const unsub = ivxDiagnostics.subscribe(setSnapshot);
    return () => unsub();
  }, []);
  return snapshot;
}

function useWatchdogSnapshot(): WatchdogSnapshot {
  const [snapshot, setSnapshot] = useState<WatchdogSnapshot>(() => ivxAIWatchdog.getSnapshot());
  useEffect(() => {
    void ivxAIWatchdog.hydrate();
    const unsub = ivxAIWatchdog.subscribe(setSnapshot);
    return () => unsub();
  }, []);
  return snapshot;
}

function fpsColor(fps: number): string {
  if (fps >= 55) return Colors.success;
  if (fps >= 40) return Colors.warning;
  return Colors.error;
}

type MetricsState = {
  status: 'loading' | 'ready' | 'error';
  data: MetricsSnapshot | null;
  error: string | null;
  lastUpdatedAt: string | null;
};

const METRICS_POLL_MS = 15000;

/** Poll the owner-gated metrics endpoint. Honest error state on auth/network failure. */
function useMetricsSnapshot(): { state: MetricsState; refresh: () => void } {
  const [state, setState] = useState<MetricsState>({ status: 'loading', data: null, error: null, lastUpdatedAt: null });
  const mountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const data = await getMetricsSnapshot();
      if (!mountedRef.current) return;
      setState({ status: 'ready', data, error: null, lastUpdatedAt: new Date().toISOString() });
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        status: 'error',
        data: prev.data,
        error: error instanceof Error ? error.message : 'Failed to load metrics.',
        lastUpdatedAt: prev.lastUpdatedAt}));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const id = setInterval(() => void load(), METRICS_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  return { state, refresh: () => void load() };
}

function latencyColor(ms: number | null): string {
  if (ms === null) return Colors.textTertiary;
  if (ms <= 800) return Colors.success;
  if (ms <= 2500) return Colors.warning;
  return Colors.error;
}

function rateColor(rate: number | null): string {
  if (rate === null) return Colors.textTertiary;
  if (rate >= 99) return Colors.success;
  if (rate >= 90) return Colors.warning;
  return Colors.error;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${ms}ms`;
}

function fmtRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

function LatencyMetricRow({ icon, label, stats }: { icon: React.ReactNode; label: string; stats: { last24h: LatencyStats; lifetime: LatencyStats } }) {
  return (
    <View style={styles.opMetricRow} testID={`ivx-diagnostics-opmetric-${label}`}>
      <View style={styles.opMetricHead}>
        <View style={styles.opMetricIcon}>{icon}</View>
        <Text style={styles.opMetricLabel}>{label}</Text>
      </View>
      <View style={styles.opMetricWindows}>
        <View style={styles.opMetricWindow}>
          <Text style={styles.opMetricWindowLabel}>24h</Text>
          <Text style={[styles.opMetricValue, { color: latencyColor(stats.last24h.avgMs) }]}>{fmtMs(stats.last24h.avgMs)}</Text>
          <Text style={styles.opMetricSub}>p95 {fmtMs(stats.last24h.p95Ms)} · n={stats.last24h.count}</Text>
        </View>
        <View style={styles.opMetricWindow}>
          <Text style={styles.opMetricWindowLabel}>Lifetime</Text>
          <Text style={[styles.opMetricValue, { color: latencyColor(stats.lifetime.avgMs) }]}>{fmtMs(stats.lifetime.avgMs)}</Text>
          <Text style={styles.opMetricSub}>p95 {fmtMs(stats.lifetime.p95Ms)} · n={stats.lifetime.count}</Text>
        </View>
      </View>
    </View>
  );
}

function RateMetricRow({ icon, label, stats }: { icon: React.ReactNode; label: string; stats: { last24h: SuccessStats; lifetime: SuccessStats } }) {
  return (
    <View style={styles.opMetricRow} testID={`ivx-diagnostics-opmetric-${label}`}>
      <View style={styles.opMetricHead}>
        <View style={styles.opMetricIcon}>{icon}</View>
        <Text style={styles.opMetricLabel}>{label}</Text>
      </View>
      <View style={styles.opMetricWindows}>
        <View style={styles.opMetricWindow}>
          <Text style={styles.opMetricWindowLabel}>24h</Text>
          <Text style={[styles.opMetricValue, { color: rateColor(stats.last24h.successRate) }]}>{fmtRate(stats.last24h.successRate)}</Text>
          <Text style={styles.opMetricSub}>{stats.last24h.success}/{stats.last24h.total} ok</Text>
        </View>
        <View style={styles.opMetricWindow}>
          <Text style={styles.opMetricWindowLabel}>Lifetime</Text>
          <Text style={[styles.opMetricValue, { color: rateColor(stats.lifetime.successRate) }]}>{fmtRate(stats.lifetime.successRate)}</Text>
          <Text style={styles.opMetricSub}>{stats.lifetime.success}/{stats.lifetime.total} ok</Text>
        </View>
      </View>
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  tone,
  hint}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <View style={styles.metricCard} testID={`ivx-diagnostics-metric-${label}`}>
      <View style={styles.metricHeader}>
        <View style={styles.metricIcon}>{icon}</View>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <View style={styles.metricValueRow}>
        <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
        {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      </View>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  );
}

/** Render the bundle identity so the owner can confirm a fresh (non-stale) bundle on reload. */
function BuildMarkerCard({ build }: { build: IVXBuildInfo }) {
  const bootedClock = useMemo(() => {
    try {
      return new Date(build.bundleBootEpochMs).toLocaleString();
    } catch {
      return String(build.bundleBootEpochMs);
    }
  }, [build.bundleBootEpochMs]);
  return (
    <View style={styles.buildCard} testID="ivx-diagnostics-build-marker">
      <View style={styles.buildHeaderRow}>
        <Boxes size={15} color={Colors.primary} />
        <Text style={styles.buildTitle}>Frontend bundle marker</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>Build marker</Text>
        <Text style={styles.buildValue} testID="ivx-diagnostics-build-marker-value">{build.buildMarker}</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>Bundle timestamp</Text>
        <Text style={styles.buildValue}>{build.buildTimestamp}</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>Watchdog patch</Text>
        <Text style={styles.buildValue}>{build.watchdogPatchVersion}</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>Frontend deploy</Text>
        <Text style={styles.buildValue}>{build.frontendDeployMarker}</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>App version · commit</Text>
        <Text style={styles.buildValue}>{build.appVersion} · {build.commitShort}</Text>
      </View>
      <View style={styles.buildRow}>
        <Text style={styles.buildLabel}>Bundle booted</Text>
        <Text style={styles.buildValue}>{bootedClock}</Text>
      </View>
      <Text style={styles.buildHint}>If this marker matches the build you shipped, the device is running the latest bundle (not a stale cache).</Text>
    </View>
  );
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function DiagnosticsContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const fps = useFpsSampler(true);
  const diag = useDiagnosticsSnapshot();
  const watchdog = useWatchdogSnapshot();
  const build = useMemo<IVXBuildInfo>(() => getIVXBuildInfo(), []);
  const { state: metricsState, refresh: refreshMetrics } = useMetricsSnapshot();
  const [memory, setMemory] = useState<MemorySample>(() => readMemorySample());
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const id = setInterval(() => setMemory(readMemorySample()), 1000);
    return () => clearInterval(id);
  }, []);

  const watchdogEvents = useMemo(() => {
    const finalized = watchdog.finalized.length;
    const active = watchdog.active.length;
    const blocked = watchdog.finalized.filter((r) => r.finalStatus === 'BLOCKED' || r.finalStatus === 'SILENT_FAILURE').length;
    const success = watchdog.finalized.filter((r) => r.finalStatus === 'SUCCESS').length;
    return { finalized, active, blocked, success, taps: watchdog.tapCount, blockedTaps: watchdog.blockedTapCount };
  }, [watchdog]);

  const buildReportText = useCallback((): string => {
    const lines: string[] = [];
    lines.push('IVX DIAGNOSTICS REPORT');
    lines.push(`captured: ${new Date().toISOString()}`);
    lines.push(`platform: ${Platform.OS} ${Platform.Version}`);
    lines.push(`session-start: ${diag.startedAt}`);
    lines.push('');
    lines.push('BUILD MARKER');
    lines.push(`  buildMarker: ${build.buildMarker}`);
    lines.push(`  bundleTimestamp: ${build.buildTimestamp}`);
    lines.push(`  watchdogPatchVersion: ${build.watchdogPatchVersion}`);
    lines.push(`  frontendDeployMarker: ${build.frontendDeployMarker}`);
    lines.push(`  appVersion: ${build.appVersion}  commit: ${build.commitShort}`);
    lines.push(`  bundleBootEpochMs: ${build.bundleBootEpochMs}`);
    lines.push('');
    lines.push('PERFORMANCE');
    lines.push(`  fps (rendered): ${fps.fps}`);
    lines.push(`  jsFps (worst-frame): ${fps.jsFps}`);
    lines.push(`  worstFrameMs: ${fps.worstFrameMs}`);
    lines.push(`  droppedFrames (last 1s): ${fps.droppedFrames}`);
    lines.push(`  memoryUsedMb: ${memory.available ? memory.usedMb : 'N/A (native)'}`);
    lines.push(`  memoryLimitMb: ${memory.available ? memory.limitMb : 'N/A (native)'}`);
    lines.push('');
    lines.push('WATCHDOG EVENTS');
    lines.push(`  finalized: ${watchdogEvents.finalized}  active: ${watchdogEvents.active}`);
    lines.push(`  success: ${watchdogEvents.success}  blocked/silent: ${watchdogEvents.blocked}`);
    lines.push(`  taps: ${watchdogEvents.taps}  blockedTaps: ${watchdogEvents.blockedTaps}`);
    lines.push('');
    lines.push('RENDER WARNINGS');
    lines.push(`  total: ${diag.renderWarnings}`);
    Object.entries(diag.renderWarningsByType).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
    lines.push('');
    lines.push('SCROLL');
    lines.push(`  scrollEvents: ${diag.scrollEvents}`);
    lines.push(`  autoScrollTriggers: ${diag.autoScrollTriggers}`);
    Object.entries(diag.autoScrollByReason).forEach(([k, v]) => lines.push(`  auto-scroll[${k}]: ${v}`));
    lines.push('');
    const m = metricsState.data;
    if (m) {
      lines.push('OPERATIONAL METRICS (24h / lifetime)');
      lines.push(`  crashes: ${m.crashCounter.last24h.count} / ${m.crashCounter.lifetime.count}`);
      lines.push(`  apiLatencyAvgMs: ${m.apiLatency.last24h.avgMs ?? '—'} / ${m.apiLatency.lifetime.avgMs ?? '—'} (p95 ${m.apiLatency.last24h.p95Ms ?? '—'} / ${m.apiLatency.lifetime.p95Ms ?? '—'})`);
      lines.push(`  supabaseQueryAvgMs: ${m.supabaseQueryLatency.last24h.avgMs ?? '—'} / ${m.supabaseQueryLatency.lifetime.avgMs ?? '—'}`);
      lines.push(`  openaiLatencyAvgMs: ${m.openaiRequestLatency.last24h.avgMs ?? '—'} / ${m.openaiRequestLatency.lifetime.avgMs ?? '—'} (p95 ${m.openaiRequestLatency.last24h.p95Ms ?? '—'} / ${m.openaiRequestLatency.lifetime.p95Ms ?? '—'})`);
      lines.push(`  ownerRouteSuccess%: ${m.ownerRouteSuccessRate.last24h.successRate ?? '—'} / ${m.ownerRouteSuccessRate.lifetime.successRate ?? '—'} (${m.ownerRouteSuccessRate.lifetime.success}/${m.ownerRouteSuccessRate.lifetime.total})`);
      lines.push(`  deliverableSuccess%: ${m.deliverableSuccessRate.last24h.successRate ?? '—'} / ${m.deliverableSuccessRate.lifetime.successRate ?? '—'} (${m.deliverableSuccessRate.lifetime.success}/${m.deliverableSuccessRate.lifetime.total})`);
      lines.push(`  coverageStart: ${m.coverageStart ?? 'n/a'}  samples: ${m.totalSamples}`);
    } else if (metricsState.error) {
      lines.push('OPERATIONAL METRICS');
      lines.push(`  unavailable: ${metricsState.error}`);
    }
    lines.push('');
    lines.push('RECENT EVENTS (newest first)');
    diag.recentEvents.slice(0, 30).forEach((e) => lines.push(`  ${formatClock(e.at)} ${e.kind} · ${e.detail}`));
    return lines.join('\n');
  }, [diag, fps, memory, watchdogEvents, metricsState, build]);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(buildReportText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [buildReportText]);

  const handleReset = useCallback(() => {
    ivxDiagnostics.reset();
    void ivxAIWatchdog.clear();
  }, []);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Diagnostics', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Cpu size={20} color={Colors.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>Live runtime diagnostics</Text>
            <Text style={styles.headerTitle}>Performance & stability</Text>
            <Text style={styles.headerSubtitle}>Updates in real time. Keep this open during stream tests, then copy the report.</Text>
          </View>
        </View>

        <BuildMarkerCard build={build} />

        <Pressable
          style={styles.prodLink}
          onPress={() => router.push('/ivx/production-diagnostics')}
          testID="ivx-diagnostics-open-production"
        >
          <ServerCog size={16} color={Colors.primary} />
          <View style={styles.prodLinkCopy}>
            <Text style={styles.prodLinkTitle}>Production Diagnostics</Text>
            <Text style={styles.prodLinkSub}>Frontend vs backend version, deploy markers, send-path audit</Text>
          </View>
        </Pressable>

        <View style={styles.grid}>
          <MetricCard
            icon={<Gauge size={15} color={fpsColor(fps.fps)} />}
            label="FPS"
            value={String(fps.fps)}
            unit="fps"
            tone={fpsColor(fps.fps)}
            hint="Rendered frames / sec"
          />
          <MetricCard
            icon={<Activity size={15} color={fpsColor(fps.jsFps)} />}
            label="JS FPS"
            value={String(fps.jsFps)}
            unit="fps"
            tone={fpsColor(fps.jsFps)}
            hint={`Worst frame ${fps.worstFrameMs}ms · ${fps.droppedFrames} dropped/s`}
          />
          <MetricCard
            icon={<MemoryStick size={15} color={memory.available ? Colors.info : Colors.textTertiary} />}
            label="Memory"
            value={memory.available && memory.usedMb !== null ? String(memory.usedMb) : 'N/A'}
            unit={memory.available ? 'MB' : undefined}
            tone={memory.available ? Colors.info : Colors.textTertiary}
            hint={memory.available && memory.limitMb !== null ? `Limit ${memory.limitMb} MB` : 'JS heap unavailable (native)'}
          />
          <MetricCard
            icon={<ShieldAlert size={15} color={watchdogEvents.blocked > 0 ? Colors.error : Colors.success} />}
            label="Watchdog"
            value={String(watchdogEvents.finalized)}
            unit="reports"
            tone={watchdogEvents.blocked > 0 ? Colors.error : Colors.success}
            hint={`${watchdogEvents.success} ok · ${watchdogEvents.blocked} blocked · ${watchdogEvents.active} active`}
          />
          <MetricCard
            icon={<TriangleAlert size={15} color={diag.renderWarnings > 0 ? Colors.warning : Colors.success} />}
            label="Render warnings"
            value={String(diag.renderWarnings)}
            tone={diag.renderWarnings > 0 ? Colors.warning : Colors.success}
            hint={diag.renderWarnings > 0 ? Object.keys(diag.renderWarningsByType).join(', ') : 'No warnings captured'}
          />
          <MetricCard
            icon={<MousePointerClick size={15} color={Colors.primary} />}
            label="Scroll events"
            value={String(diag.scrollEvents)}
            tone={Colors.primary}
            hint="Chat list scroll callbacks"
          />
          <MetricCard
            icon={<RotateCcw size={15} color={Colors.primary} />}
            label="Auto-scroll"
            value={String(diag.autoScrollTriggers)}
            unit="triggers"
            tone={Colors.primary}
            hint={Object.keys(diag.autoScrollByReason).length > 0 ? Object.entries(diag.autoScrollByReason).map(([k, v]) => `${k}:${v}`).join(' · ') : 'Follow-new + jump-to-latest'}
          />
        </View>

        <View style={styles.opCard}>
          <View style={styles.opHeaderRow}>
            <Text style={styles.opTitle}>Operational metrics</Text>
            <Text style={styles.opWindowsHint}>24h · Lifetime</Text>
          </View>
          {metricsState.status === 'loading' && !metricsState.data ? (
            <Text style={styles.opEmpty}>Loading live metrics…</Text>
          ) : metricsState.error && !metricsState.data ? (
            <View>
              <Text style={styles.opError}>{metricsState.error}</Text>
              <Pressable style={styles.opRetry} onPress={refreshMetrics} testID="ivx-diagnostics-metrics-retry">
                <RotateCcw size={13} color={Colors.text} />
                <Text style={styles.opRetryText}>Retry</Text>
              </Pressable>
            </View>
          ) : metricsState.data ? (
            <View>
              <View style={styles.opMetricRow} testID="ivx-diagnostics-opmetric-Crashes">
                <View style={styles.opMetricHead}>
                  <View style={styles.opMetricIcon}><ServerCrash size={15} color={metricsState.data.crashCounter.last24h.count > 0 ? Colors.error : Colors.success} /></View>
                  <Text style={styles.opMetricLabel}>Crashes</Text>
                </View>
                <View style={styles.opMetricWindows}>
                  <View style={styles.opMetricWindow}>
                    <Text style={styles.opMetricWindowLabel}>24h</Text>
                    <Text style={[styles.opMetricValue, { color: metricsState.data.crashCounter.last24h.count > 0 ? Colors.error : Colors.success }]}>{metricsState.data.crashCounter.last24h.count}</Text>
                    <Text style={styles.opMetricSub}>incidents</Text>
                  </View>
                  <View style={styles.opMetricWindow}>
                    <Text style={styles.opMetricWindowLabel}>Lifetime</Text>
                    <Text style={[styles.opMetricValue, { color: metricsState.data.crashCounter.lifetime.count > 0 ? Colors.error : Colors.success }]}>{metricsState.data.crashCounter.lifetime.count}</Text>
                    <Text style={styles.opMetricSub}>incidents</Text>
                  </View>
                </View>
              </View>
              <LatencyMetricRow icon={<Timer size={15} color={Colors.info} />} label="API latency" stats={metricsState.data.apiLatency} />
              <LatencyMetricRow icon={<Database size={15} color={Colors.info} />} label="Supabase query" stats={metricsState.data.supabaseQueryLatency} />
              <LatencyMetricRow icon={<Sparkles size={15} color={Colors.info} />} label="OpenAI request" stats={metricsState.data.openaiRequestLatency} />
              <RateMetricRow icon={<Zap size={15} color={Colors.primary} />} label="Owner route" stats={metricsState.data.ownerRouteSuccessRate} />
              <RateMetricRow icon={<ClipboardCopy size={15} color={Colors.primary} />} label="Deliverables" stats={metricsState.data.deliverableSuccessRate} />
              <Text style={styles.opFootnote}>
                {metricsState.data.totalSamples} samples · since {metricsState.data.coverageStart ? formatClock(metricsState.data.coverageStart) : 'n/a'}
                {metricsState.error ? ' · refresh failed (showing last good)' : ''}
              </Text>
            </View>
          ) : (
            <Text style={styles.opEmpty}>No metrics available.</Text>
          )}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={handleCopy}
            testID="ivx-diagnostics-copy"
          >
            <ClipboardCopy size={15} color={Colors.black} />
            <Text style={styles.actionPrimaryText}>{copied ? 'Copied report' : 'Copy diagnostics'}</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.actionSecondary]}
            onPress={handleReset}
            testID="ivx-diagnostics-reset"
          >
            <RotateCcw size={15} color={Colors.text} />
            <Text style={styles.actionSecondaryText}>Reset counters</Text>
          </Pressable>
        </View>

        <View style={styles.logCard}>
          <Text style={styles.logTitle}>Recent events</Text>
          {diag.recentEvents.length === 0 ? (
            <Text style={styles.logEmpty}>No events yet. Send chat messages and scroll to populate.</Text>
          ) : (
            diag.recentEvents.slice(0, 40).map((event, index) => (
              <View key={`${event.at}-${index}`} style={styles.logRow}>
                <Text style={styles.logTime}>{formatClock(event.at)}</Text>
                <View style={[styles.logBadge, kindStyle(event.kind)]}>
                  <Text style={styles.logBadgeText}>{event.kind}</Text>
                </View>
                <Text style={styles.logDetail} numberOfLines={2}>{event.detail}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function kindStyle(kind: DiagnosticsSnapshot['recentEvents'][number]['kind']): { backgroundColor: string } {
  switch (kind) {
    case 'render-warning':
      return { backgroundColor: 'rgba(245,158,11,0.18)' };
    case 'auto-scroll':
      return { backgroundColor: 'rgba(59,130,246,0.18)' };
    default:
      return { backgroundColor: 'rgba(255,215,0,0.16)' };
  }
}

export default function DiagnosticsScreen() {
  return (
    <ErrorBoundary fallbackTitle="Diagnostics unavailable">
      <DiagnosticsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  headerRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  headerCopy: { flex: 1 },
  headerEyebrow: { color: Colors.primary, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '700' as const, marginTop: 2 },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    width: '48.5%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14},
  metricHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8 },
  metricValue: { color: Colors.text, fontSize: 28, fontWeight: '800' as const },
  metricUnit: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' as const },
  metricHint: { color: Colors.textTertiary, fontSize: 10.5, marginTop: 4, lineHeight: 14 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12 },
  actionPrimary: { backgroundColor: Colors.primary },
  actionPrimaryText: { color: Colors.black, fontSize: 13, fontWeight: '700' as const },
  actionSecondary: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionSecondaryText: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  logCard: {
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14},
  logTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, marginBottom: 10 },
  logEmpty: { color: Colors.textTertiary, fontSize: 12, lineHeight: 17 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceBorder },
  logTime: { color: Colors.textTertiary, fontSize: 10.5, width: 58, fontVariant: ['tabular-nums'] },
  logBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  logBadgeText: { color: Colors.text, fontSize: 9.5, fontWeight: '700' as const },
  logDetail: { flex: 1, color: Colors.textSecondary, fontSize: 11, lineHeight: 15 },
  opCard: {
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14},
  opHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  opTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  opWindowsHint: { color: Colors.textTertiary, fontSize: 10.5, fontWeight: '600' as const, letterSpacing: 0.4 },
  opEmpty: { color: Colors.textTertiary, fontSize: 12, lineHeight: 17, paddingVertical: 6 },
  opError: { color: Colors.error, fontSize: 12, lineHeight: 17, paddingVertical: 6 },
  opRetry: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder, marginTop: 4 },
  opRetryText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  opMetricRow: { paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceBorder },
  opMetricHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  opMetricIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  opMetricLabel: { color: Colors.text, fontSize: 12.5, fontWeight: '600' as const },
  opMetricWindows: { flexDirection: 'row', gap: 10 },
  opMetricWindow: { flex: 1, backgroundColor: Colors.surfaceElevated, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  opMetricWindowLabel: { color: Colors.textTertiary, fontSize: 9.5, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  opMetricValue: { fontSize: 20, fontWeight: '800' as const, marginTop: 2, fontVariant: ['tabular-nums'] },
  opMetricSub: { color: Colors.textTertiary, fontSize: 10, marginTop: 1 },
  opFootnote: { color: Colors.textTertiary, fontSize: 10, marginTop: 10, lineHeight: 14 },
  prodLink: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.primary, padding: 14, marginTop: 12 },
  prodLinkCopy: { flex: 1 },
  prodLinkTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  prodLinkSub: { color: Colors.textSecondary, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  buildCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 12, gap: 8 },
  buildHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buildTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  buildRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  buildLabel: { color: Colors.textSecondary, fontSize: 12 },
  buildValue: { color: Colors.text, fontSize: 12, fontWeight: '600' as const, flexShrink: 1, textAlign: 'right' },
  buildHint: { color: Colors.textTertiary, fontSize: 10.5, lineHeight: 14, marginTop: 4 }});
