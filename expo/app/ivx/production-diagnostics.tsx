import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import * as Clipboard from 'expo-clipboard';
import {
  CheckCircle2,
  ClipboardCopy,
  Cloud,
  GitCommitHorizontal,
  Globe,
  RotateCcw,
  Send,
  ShieldAlert,
  Smartphone,
  TriangleAlert,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXBuildInfo, type IVXBuildInfo } from '@/constants/build-info';
import { getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { fetchBackendMarker, type IVXBackendMarker } from '@/src/modules/ivx-owner-ai/services/ivxBackendMarkerService';
import { auditOwnerAISendPaths, type OwnerAISendPathAuditReport } from '@/src/modules/ivx-owner-ai/services/ivxSendPathAudit';
import { ivxAIWatchdog, type WatchdogSnapshot } from '@/src/modules/ivx-owner-ai/services/ivxAIWatchdog';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

/**
 * Version comparison verdict between the frontend bundle and the live backend.
 * MATCH/MISMATCH require both commits to be known; otherwise we honestly report
 * that we cannot verify (e.g. local bundle, or backend without RENDER_GIT_COMMIT).
 */
type VersionVerdict = 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE';

function deriveVersionVerdict(frontend: IVXBuildInfo, backend: IVXBackendMarker): VersionVerdict {
  const fe = (frontend.commitShort ?? '').toLowerCase();
  const be = (backend.commitShort ?? '').toLowerCase();
  const feKnown = fe.length > 0 && fe !== 'local' && fe !== 'unknown';
  const beKnown = be.length > 0 && be !== 'unknown';
  if (!feKnown || !beKnown || !backend.reachable) {
    return 'UNVERIFIABLE';
  }
  return fe === be ? 'MATCH' : 'MISMATCH';
}

function useWatchdog(): WatchdogSnapshot {
  const [snapshot, setSnapshot] = useState<WatchdogSnapshot>(() => ivxAIWatchdog.getSnapshot());
  useEffect(() => {
    void ivxAIWatchdog.hydrate();
    const unsub = ivxAIWatchdog.subscribe(setSnapshot);
    return () => unsub();
  }, []);
  return snapshot;
}

type WatchdogStatus = { label: string; tone: string; detail: string };

function deriveWatchdogStatus(snapshot: WatchdogSnapshot): WatchdogStatus {
  const failures = snapshot.finalized.filter(
    (r) => r.finalStatus === 'SILENT_FAILURE' || r.finalStatus === 'BLOCKED',
  ).length;
  const visibleErrors = snapshot.finalized.filter((r) => r.finalStatus === 'VISIBLE_ERROR').length;
  const success = snapshot.finalized.filter((r) => r.finalStatus === 'SUCCESS').length;
  if (failures > 0) {
    return { label: 'TRUE_FAILURE present', tone: Colors.error, detail: `${failures} silent/blocked · ${success} ok` };
  }
  if (visibleErrors > 0) {
    return { label: 'Visible errors', tone: Colors.warning, detail: `${visibleErrors} visible-error · ${success} ok` };
  }
  if (snapshot.finalized.length === 0) {
    return { label: 'No traces yet', tone: Colors.textTertiary, detail: 'Send a prompt to populate the watchdog' };
  }
  return { label: 'Clean', tone: Colors.success, detail: `${success} ok · ${snapshot.active.length} active` };
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono ? styles.mono : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Card({ icon, title, children, accent }: { icon: React.ReactNode; title: string; children: React.ReactNode; accent?: string }) {
  return (
    <View style={[styles.card, accent ? { borderColor: accent } : null]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>{icon}</View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ProductionDiagnosticsContent() {
  const insets = useSafeAreaInsets();
  const build = useMemo<IVXBuildInfo>(() => getIVXBuildInfo(), []);
  const audit = useMemo(() => getIVXOwnerAIConfigAudit(), []);
  const sendPathReport = useMemo<OwnerAISendPathAuditReport>(() => auditOwnerAISendPaths(), []);
  const watchdog = useWatchdog();
  const watchdogStatus = useMemo(() => deriveWatchdogStatus(watchdog), [watchdog]);

  const [backend, setBackend] = useState<IVXBackendMarker | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const loadBackend = useCallback(async () => {
    setLoading(true);
    const marker = await fetchBackendMarker();
    setBackend(marker);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBackend();
  }, [loadBackend]);

  const verdict = useMemo<VersionVerdict>(
    () => (backend ? deriveVersionVerdict(build, backend) : 'UNVERIFIABLE'),
    [build, backend],
  );

  const apiUrl = audit.activeBaseUrl ?? 'unconfigured';

  const reportText = useCallback((): string => {
    const lines: string[] = [];
    lines.push('IVX PRODUCTION DIAGNOSTICS');
    lines.push(`captured: ${new Date().toISOString()}`);
    lines.push(`platform: ${Platform.OS} ${Platform.Version}`);
    lines.push('');
    lines.push('API');
    lines.push(`  baseUrl: ${apiUrl}`);
    lines.push(`  healthUrl: ${backend?.url ?? '—'}`);
    lines.push(`  httpStatus: ${backend?.httpStatus ?? '—'}`);
    lines.push('');
    lines.push('FRONTEND MARKER');
    lines.push(`  buildMarker: ${build.buildMarker}`);
    lines.push(`  appVersion: ${build.appVersion}  commit: ${build.commitShort}`);
    lines.push(`  bundleTimestamp: ${build.buildTimestamp}`);
    lines.push('');
    lines.push('BACKEND MARKER');
    lines.push(`  deploymentMarker: ${backend?.deploymentMarker ?? '—'}`);
    lines.push(`  commit: ${backend?.commitShort ?? '—'}`);
    lines.push(`  bootTime: ${backend?.bootTime ?? '—'}`);
    lines.push(`  serverTime: ${backend?.serverTimestamp ?? '—'}`);
    lines.push('');
    lines.push(`VERSION VERDICT: ${verdict}`);
    lines.push('');
    lines.push(`WATCHDOG: ${watchdogStatus.label} (${watchdogStatus.detail})`);
    lines.push('');
    lines.push(`SEND-PATH AUDIT: ${sendPathReport.validCount}/${sendPathReport.totalCount} valid`);
    sendPathReport.paths.forEach((p) => {
      lines.push(`  [${p.body.valid ? 'PASS' : 'FAIL'}] ${p.label}: keys={${p.body.keys.join(',')}} message=${p.body.message === null ? 'null' : `"${p.body.message}"`}`);
    });
    return lines.join('\n');
  }, [apiUrl, backend, build, verdict, watchdogStatus, sendPathReport]);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(reportText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [reportText]);

  const verdictMeta = useMemo(() => {
    switch (verdict) {
      case 'MATCH':
        return { tone: Colors.success, label: 'VERSIONS MATCH', body: 'The frontend bundle and live backend report the same git commit.' };
      case 'MISMATCH':
        return { tone: Colors.error, label: 'VERSION_MISMATCH', body: 'The frontend bundle and live backend are on different commits. Redeploy the lagging side before trusting end-to-end results.' };
      default:
        return { tone: Colors.warning, label: 'VERSION UNVERIFIABLE', body: backend?.reachable ? 'One side did not expose a git commit (local bundle or backend without RENDER_GIT_COMMIT). Deployment markers below are still authoritative.' : 'Backend /health is unreachable, so versions cannot be compared right now.' };
    }
  }, [verdict, backend]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Production Diagnostics', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={loading} onRefresh={() => void loadBackend()} />}
      >
        <Text style={styles.headerEyebrow}>Live deployment proof</Text>
        <Text style={styles.headerTitle}>Production Diagnostics</Text>
        <Text style={styles.headerSubtitle}>Confirms which frontend bundle and backend build are live, whether they match, and that every send path posts {'{ message }'}.</Text>

        {/* VERSION VERDICT */}
        <View style={[styles.verdictCard, { borderColor: verdictMeta.tone, backgroundColor: `${verdictMeta.tone}14` }]} testID="ivx-prod-diag-version-verdict">
          <View style={styles.verdictHead}>
            {verdict === 'MISMATCH' ? <TriangleAlert size={18} color={verdictMeta.tone} /> : verdict === 'MATCH' ? <CheckCircle2 size={18} color={verdictMeta.tone} /> : <ShieldAlert size={18} color={verdictMeta.tone} />}
            <Text style={[styles.verdictLabel, { color: verdictMeta.tone }]}>{verdictMeta.label}</Text>
          </View>
          <Text style={styles.verdictBody}>{verdictMeta.body}</Text>
        </View>

        {/* API */}
        <Card icon={<Globe size={15} color={Colors.primary} />} title="API endpoint">
          <Row label="Base URL" value={apiUrl} mono />
          <Row label="Health URL" value={backend?.url ?? '—'} mono />
          <Row label="HTTP status" value={loading ? 'checking…' : backend?.httpStatus !== null && backend?.httpStatus !== undefined ? String(backend.httpStatus) : '—'} />
          <Row label="Reachable" value={loading ? '…' : backend?.reachable ? 'yes' : 'no'} />
          {backend?.error ? <Text style={styles.errorNote}>{backend.error}</Text> : null}
        </Card>

        {/* FRONTEND MARKER */}
        <Card icon={<Smartphone size={15} color={Colors.info} />} title="Frontend bundle (this device)">
          <Row label="Build marker" value={build.buildMarker} mono />
          <Row label="Deploy marker" value={build.frontendDeployMarker} mono />
          <Row label="App version" value={build.appVersion} />
          <Row label="Git commit" value={build.commitShort} mono />
          <Row label="Bundle timestamp" value={build.buildTimestamp} />
        </Card>

        {/* BACKEND MARKER */}
        <Card icon={<Cloud size={15} color={Colors.info} />} title="Backend build (api.ivxholding.com)">
          {loading && !backend ? (
            <View style={styles.loadingRow}><ShimmerIndicator color={Colors.primary} /><Text style={styles.loadingText}>Fetching /health…</Text></View>
          ) : (
            <>
              <Row label="Deployment marker" value={backend?.deploymentMarker ?? '—'} mono />
              <Row label="Git commit" value={backend?.commitShort ?? '—'} mono />
              <Row label="Booted" value={backend?.bootTime ?? '—'} />
              <Row label="Server time" value={backend?.serverTimestamp ?? '—'} />
            </>
          )}
        </Card>

        {/* COMMIT COMPARE */}
        <Card icon={<GitCommitHorizontal size={15} color={verdictMeta.tone} />} title="Commit comparison" accent={verdict === 'MISMATCH' ? Colors.error : undefined}>
          <Row label="Frontend" value={build.commitShort} mono />
          <Row label="Backend" value={backend?.commitShort ?? '—'} mono />
          <Row label="Verdict" value={verdict} />
        </Card>

        {/* WATCHDOG */}
        <Card icon={<ShieldAlert size={15} color={watchdogStatus.tone} />} title="Watchdog status" accent={watchdogStatus.tone === Colors.error ? Colors.error : undefined}>
          <View style={styles.statusPillRow}>
            <View style={[styles.statusPill, { backgroundColor: `${watchdogStatus.tone}22` }]}>
              <Text style={[styles.statusPillText, { color: watchdogStatus.tone }]}>{watchdogStatus.label}</Text>
            </View>
          </View>
          <Text style={styles.cardHint}>{watchdogStatus.detail}</Text>
        </Card>

        {/* SEND-PATH AUDIT */}
        <Card
          icon={<Send size={15} color={sendPathReport.allValid ? Colors.success : Colors.error} />}
          title={`Send-path audit · ${sendPathReport.validCount}/${sendPathReport.totalCount}`}
          accent={sendPathReport.allValid ? undefined : Colors.error}
        >
          <Text style={styles.cardHint}>Every path builds its body with the production builder and must serialize a non-empty {'{ message: string }'}.</Text>
          {sendPathReport.paths.map((p) => (
            <View key={p.id} style={styles.pathRow} testID={`ivx-prod-diag-path-${p.id}`}>
              <View style={styles.pathHead}>
                {p.body.valid ? <CheckCircle2 size={15} color={Colors.success} /> : <XCircle size={15} color={Colors.error} />}
                <Text style={styles.pathLabel}>{p.label}</Text>
              </View>
              <Text style={styles.pathOrigin} numberOfLines={2}>{p.origin}</Text>
              <Text style={styles.pathBody}>keys: {`{ ${p.body.keys.join(', ')} }`}</Text>
              <Text style={styles.pathBody}>message: {p.body.message === null ? <Text style={styles.pathFail}>null</Text> : `"${p.body.message}"`}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={handleCopy} testID="ivx-prod-diag-copy">
            <ClipboardCopy size={15} color={Colors.black} />
            <Text style={styles.actionPrimaryText}>{copied ? 'Copied report' : 'Copy report'}</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.actionSecondary]} onPress={() => void loadBackend()} testID="ivx-prod-diag-refresh">
            <RotateCcw size={15} color={Colors.text} />
            <Text style={styles.actionSecondaryText}>Re-check backend</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

export default function ProductionDiagnosticsScreen() {
  return (
    <ErrorBoundary fallbackTitle="Production diagnostics unavailable">
      <ProductionDiagnosticsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  headerEyebrow: { color: Colors.primary, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  headerTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, marginTop: 2 },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 6, lineHeight: 18, marginBottom: 16 },
  verdictCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  verdictHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictLabel: { fontSize: 14, fontWeight: '800' as const, letterSpacing: 0.4 },
  verdictBody: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  card: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  cardHint: { color: Colors.textTertiary, fontSize: 11.5, lineHeight: 16, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceBorder },
  rowLabel: { color: Colors.textSecondary, fontSize: 12, flexShrink: 0 },
  rowValue: { color: Colors.text, fontSize: 12, fontWeight: '600' as const, flex: 1, textAlign: 'right' as const },
  mono: { fontVariant: ['tabular-nums'], fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  errorNote: { color: Colors.error, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  loadingText: { color: Colors.textSecondary, fontSize: 12.5 },
  statusPillRow: { flexDirection: 'row', marginBottom: 6 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusPillText: { fontSize: 12, fontWeight: '700' as const },
  pathRow: { paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceBorder },
  pathHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pathLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  pathOrigin: { color: Colors.textTertiary, fontSize: 10.5, lineHeight: 14, marginTop: 3 },
  pathBody: { color: Colors.textSecondary, fontSize: 11.5, marginTop: 3, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  pathFail: { color: Colors.error, fontWeight: '700' as const },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12 },
  actionPrimary: { backgroundColor: Colors.primary },
  actionPrimaryText: { color: Colors.black, fontSize: 13, fontWeight: '700' as const },
  actionSecondary: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionSecondaryText: { color: Colors.text, fontSize: 13, fontWeight: '600' as const }});
