import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  Eraser,
  KeyRound,
  LogIn,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  clearStaleOwnerSession,
  reAuthenticateOwner,
  refreshOwnerSession,
  refreshOwnerToken,
  retryOwnerRequest,
  runAuthDiagnostic,
  testBackendReachability,
  type AuthActionResult,
  type AuthDiagnosticField,
  type AuthDiagnosticReport,
  type ReachabilityReport} from '@/src/modules/ivx-developer/authDiagnosticsService';

type ActionLogEntry = {
  at: string;
  label: string;
  ok: boolean;
  message: string;
};

function fieldStateColor(state: AuthDiagnosticField['state']): string {
  switch (state) {
    case 'ok': return Colors.success;
    case 'warn': return Colors.warning;
    case 'fail': return Colors.error;
    default: return Colors.textSecondary;
  }
}

function statusColor(status: AuthDiagnosticReport['status']): string {
  switch (status) {
    case 'healthy': return Colors.success;
    case 'degraded': return Colors.warning;
    default: return Colors.error;
  }
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function AuthDiagnosticsContent() {
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<AuthDiagnosticReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [reachability, setReachability] = useState<ReachabilityReport | null>(null);

  const appendLog = useCallback((label: string, result: AuthActionResult) => {
    setActionLog((prev) => [
      { at: new Date().toISOString(), label, ok: result.ok, message: result.message },
      ...prev,
    ].slice(0, 12));
  }, []);

  const runDiagnostic = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await runAuthDiagnostic();
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run auth diagnostic.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runDiagnostic();
  }, [runDiagnostic]);

  const handleRefreshOwnerSession = useCallback(async () => {
    setBusyAction('refresh-session');
    try {
      const result = await refreshOwnerSession();
      appendLog('Refresh Owner Session', {
        ok: result.ok,
        message: `${result.message} (ownerDetected: ${result.ownerDetected ? 'YES' : 'NO'})`});
      await runDiagnostic();
    } finally {
      setBusyAction(null);
    }
  }, [appendLog, runDiagnostic]);

  const handleRefreshToken = useCallback(async () => {
    setBusyAction('refresh');
    try {
      const result = await refreshOwnerToken();
      appendLog('Refresh token', result);
      await runDiagnostic();
    } finally {
      setBusyAction(null);
    }
  }, [appendLog, runDiagnostic]);

  const handleReAuthenticate = useCallback(async () => {
    setBusyAction('reauth');
    try {
      const result = await reAuthenticateOwner();
      appendLog('Re-authenticate', result);
      await runDiagnostic();
    } finally {
      setBusyAction(null);
    }
  }, [appendLog, runDiagnostic]);

  const handleClearStaleSession = useCallback(async () => {
    setBusyAction('clear-stale');
    try {
      const result = await clearStaleOwnerSession();
      appendLog('Clear stale session', result);
      await runDiagnostic();
    } finally {
      setBusyAction(null);
    }
  }, [appendLog, runDiagnostic]);

  const handleRetry = useCallback(async () => {
    setBusyAction('retry');
    try {
      const result = await retryOwnerRequest();
      appendLog('Retry owner request', result);
      await runDiagnostic();
    } finally {
      setBusyAction(null);
    }
  }, [appendLog, runDiagnostic]);

  const handleReachability = useCallback(async () => {
    setBusyAction('reachability');
    try {
      const result = await testBackendReachability();
      setReachability(result);
      appendLog('Test backend reachability', {
        ok: result.verdict === 'BACKEND_REACHABLE_OWNER_AI_OK',
        message: `${result.verdict} — ${result.verdictDetail}`});
    } catch (err) {
      appendLog('Test backend reachability', {
        ok: false,
        message: err instanceof Error ? err.message : 'Reachability probe failed.'});
    } finally {
      setBusyAction(null);
    }
  }, [appendLog]);

  const headline = useMemo<string>(
    () => report?.headline ?? (loading ? 'Running owner authentication diagnostic…' : 'Tap “Run diagnostic”.'),
    [report, loading],
  );
  const status = report?.status ?? 'degraded';
  const tone = statusColor(status);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={
        <RefreshControl tintColor={Colors.primary} refreshing={loading} onRefresh={() => { void runDiagnostic(); }} />
      }
      testID="ivx-auth-diagnostics-scroll"
    >
      <View style={[styles.heroCard, { borderColor: tone }]}>
        <View style={styles.heroHeaderRow}>
          {status === 'healthy' ? (
            <ShieldCheck size={18} color={tone} />
          ) : (
            <ShieldAlert size={18} color={tone} />
          )}
          <Text style={styles.heroTitle}>Owner Auth Diagnostics</Text>
          <View style={[styles.statusPill, { borderColor: tone }]}>
            <Text style={[styles.statusPillText, { color: tone }]}>{status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.heroSubtitle}>{headline}</Text>
        {report?.incidentRaised ? (
          <View style={styles.incidentChip}>
            <AlertTriangle size={12} color={Colors.warning} />
            <Text style={styles.incidentChipText}>Watchdog incident raised · owner_route_auth_401</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={[styles.card, styles.blockerCard]} testID="ivx-auth-diagnostics-error">
          <Text style={styles.blockerText}>{error}</Text>
        </View>
      ) : null}

      {/* One-tap recovery */}
      <View style={styles.card} testID="ivx-auth-diagnostics-one-tap">
        <Text style={styles.eyebrow}>One-tap recovery</Text>
        <Pressable
          style={[styles.primaryRecoveryButton, busyAction !== null ? styles.buttonDisabled : null]}
          onPress={() => { void handleRefreshOwnerSession(); }}
          disabled={busyAction !== null}
          testID="ivx-auth-action-refresh-owner-session"
        >
          {busyAction === 'refresh-session' ? (
            <ShimmerIndicator size="small" color={Colors.black} />
          ) : (
            <Sparkles size={15} color={Colors.black} />
          )}
          <Text style={styles.primaryRecoveryButtonText}>Refresh Owner Session</Text>
        </Pressable>
        <Text style={styles.primaryRecoveryHint}>Forces a session refresh, signs out for a fresh login if that fails, then confirms ownerDetected.</Text>
        <Pressable
          style={[styles.clearStaleButton, busyAction !== null ? styles.buttonDisabled : null]}
          onPress={() => { void handleClearStaleSession(); }}
          disabled={busyAction !== null}
          testID="ivx-auth-action-clear-stale-primary"
        >
          {busyAction === 'clear-stale' ? (
            <ShimmerIndicator size="small" color={Colors.error} />
          ) : (
            <Eraser size={15} color={Colors.error} />
          )}
          <Text style={styles.clearStaleButtonText}>Clear Stale Session (issuer_mismatch fix)</Text>
        </Pressable>
        <Text style={styles.primaryRecoveryHint}>Wipes the on-device cached Supabase token so the next sign-in mints a fresh token from the production project. Use this when you see `issuer_mismatch`.</Text>
      </View>

      {/* Recovery actions */}
      <View style={styles.card} testID="ivx-auth-diagnostics-actions">
        <Text style={styles.eyebrow}>Recovery actions</Text>
        <View style={styles.actionRow}>
          <ActionButton
            label="Refresh token"
            icon={<RefreshCw size={14} color={Colors.black} />}
            busy={busyAction === 'refresh'}
            disabled={busyAction !== null}
            onPress={() => { void handleRefreshToken(); }}
            testID="ivx-auth-action-refresh"
          />
          <ActionButton
            label="Re-authenticate"
            icon={<LogIn size={14} color={Colors.black} />}
            busy={busyAction === 'reauth'}
            disabled={busyAction !== null}
            onPress={() => { void handleReAuthenticate(); }}
            testID="ivx-auth-action-reauth"
          />
        </View>
        <View style={styles.actionRow}>
          <ActionButton
            label="Retry request"
            icon={<RotateCw size={14} color={Colors.black} />}
            busy={busyAction === 'retry'}
            disabled={busyAction !== null}
            onPress={() => { void handleRetry(); }}
            testID="ivx-auth-action-retry"
          />
          <ActionButton
            label="Run diagnostic"
            icon={<KeyRound size={14} color={Colors.black} />}
            busy={loading}
            disabled={busyAction !== null}
            onPress={() => { void runDiagnostic(); }}
            testID="ivx-auth-action-rerun"
          />
        </View>
        <View style={styles.actionRow}>
          <ActionButton
            label="Clear stale session"
            icon={<Trash2 size={14} color={Colors.black} />}
            busy={busyAction === 'clear-stale'}
            disabled={busyAction !== null}
            onPress={() => { void handleClearStaleSession(); }}
            testID="ivx-auth-action-clear-stale"
          />
          <ActionButton
            label="Test backend reachability"
            icon={<Wifi size={14} color={Colors.black} />}
            busy={busyAction === 'reachability'}
            disabled={busyAction !== null}
            onPress={() => { void handleReachability(); }}
            testID="ivx-auth-action-reachability"
          />
        </View>
      </View>

      {/* Backend reachability probe */}
      {reachability ? (
        <View style={styles.card} testID="ivx-auth-diagnostics-reachability">
          <Text style={styles.eyebrow}>Backend reachability</Text>
          <View style={[styles.verdictPill, { borderColor: reachability.verdict === 'BACKEND_REACHABLE_OWNER_AI_OK' ? Colors.success : reachability.verdict === 'DEVICE_CANNOT_REACH_BACKEND' || reachability.verdict === 'OWNER_AUTH_FAILED' || reachability.verdict === 'PUBLIC_CHAT_ROUTE_FAILED' ? Colors.error : Colors.warning }]}>
            <Text style={[styles.verdictPillText, { color: reachability.verdict === 'BACKEND_REACHABLE_OWNER_AI_OK' ? Colors.success : reachability.verdict === 'DEVICE_CANNOT_REACH_BACKEND' || reachability.verdict === 'OWNER_AUTH_FAILED' || reachability.verdict === 'PUBLIC_CHAT_ROUTE_FAILED' ? Colors.error : Colors.warning }]}>{reachability.verdict}</Text>
          </View>
          <Text style={styles.fixText}>{reachability.verdictDetail}</Text>
          {reachability.probes.map((probe) => (
            <View key={`${probe.label}-${probe.traceId}`} style={styles.fieldRow} testID={`ivx-reach-probe-${probe.label}`}>
              <View style={styles.fieldIcon}>
                {probe.responded && probe.httpStatus !== null && probe.httpStatus >= 200 && probe.httpStatus < 300 ? (
                  <CheckCircle2 size={14} color={Colors.success} />
                ) : (
                  <XCircle size={14} color={probe.responded ? Colors.warning : Colors.error} />
                )}
              </View>
              <View style={styles.fieldCopy}>
                <Text style={styles.fieldLabel}>{probe.method} {probe.label}</Text>
                <Text style={[styles.fieldValue, { color: probe.responded ? Colors.text : Colors.error }]} numberOfLines={3}>
                  {probe.statusLabel} · {probe.responseTimeMs}ms · body: {probe.responseBodyShape}
                </Text>
                {probe.detail ? <Text style={styles.reachDetail} numberOfLines={2}>{probe.detail}</Text> : null}
                <Text style={styles.reachTrace}>trace: {probe.traceId}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Fix recommendation */}
      {report?.fixRecommendation ? (
        <View style={[styles.card, styles.fixCard]} testID="ivx-auth-diagnostics-fix">
          <View style={styles.rowCenter}>
            <AlertTriangle size={15} color={Colors.warning} />
            <Text style={[styles.eyebrow, { marginLeft: 6, color: Colors.warning }]}>Fix recommendation</Text>
          </View>
          <Text style={styles.fixText}>{report.fixRecommendation}</Text>
        </View>
      ) : null}

      {/* Diagnostic fields */}
      <View style={styles.card} testID="ivx-auth-diagnostics-fields">
        <Text style={styles.eyebrow}>Authentication details</Text>
        {(report?.fields ?? []).length === 0 ? (
          <Text style={styles.emptyBody}>Run the diagnostic to gather owner authentication details.</Text>
        ) : (
          report?.fields.map((field) => (
            <View key={field.label} style={styles.fieldRow} testID={`ivx-auth-field-${field.label}`}>
              <View style={styles.fieldIcon}>
                {field.state === 'ok' ? (
                  <CheckCircle2 size={14} color={Colors.success} />
                ) : field.state === 'fail' ? (
                  <XCircle size={14} color={Colors.error} />
                ) : field.state === 'warn' ? (
                  <AlertTriangle size={14} color={Colors.warning} />
                ) : (
                  <KeyRound size={14} color={Colors.textSecondary} />
                )}
              </View>
              <View style={styles.fieldCopy}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <Text style={[styles.fieldValue, { color: fieldStateColor(field.state) }]} numberOfLines={3}>{field.value}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Action log */}
      <View style={styles.card} testID="ivx-auth-diagnostics-log">
        <Text style={styles.eyebrow}>Action log</Text>
        {actionLog.length === 0 ? (
          <Text style={styles.emptyBody}>Refresh, re-authenticate, or retry to recover the session. Results appear here.</Text>
        ) : (
          actionLog.map((entry, index) => (
            <View key={`${entry.at}-${index}`} style={styles.logRow}>
              <View style={[styles.logDot, { backgroundColor: entry.ok ? Colors.success : Colors.error }]} />
              <View style={styles.logCopy}>
                <View style={styles.logTopRow}>
                  <Text style={styles.logChannel}>{entry.label}</Text>
                  <Text style={styles.logTime}>{formatClock(entry.at)}</Text>
                </View>
                <Text style={styles.logMessage} numberOfLines={3}>{entry.message}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  disabled,
  onPress,
  testID}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={[styles.actionButton, disabled ? styles.buttonDisabled : null]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
    >
      {busy ? <ShimmerIndicator size="small" color={Colors.black} /> : icon}
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

export default function AuthDiagnosticsScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Auth Diagnostics' }} />
      <AuthDiagnosticsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 12, borderWidth: 1 },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  verdictPill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  verdictPillText: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.3 },
  reachDetail: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16, marginTop: 2 },
  reachTrace: { fontSize: 10.5, color: Colors.textSecondary, marginTop: 2 },
  incidentChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.warning, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  incidentChipText: { fontSize: 11, fontWeight: '700' as const, color: Colors.warning },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.border },
  blockerCard: { borderColor: Colors.error },
  blockerText: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  fixCard: { borderColor: Colors.warning },
  fixText: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, color: Colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.primary, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10 },
  primaryRecoveryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12 },
  primaryRecoveryButtonText: { fontSize: 15, fontWeight: '800' as const, color: Colors.black, letterSpacing: 0.2 },
  primaryRecoveryHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  clearStaleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'transparent', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.error, marginTop: 10 },
  clearStaleButtonText: { fontSize: 14, fontWeight: '800' as const, color: Colors.error, letterSpacing: 0.2 },
  actionButtonText: { fontSize: 13, fontWeight: '700' as const, color: Colors.black },
  buttonDisabled: { opacity: 0.55 },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  fieldIcon: { width: 18, alignItems: 'center', paddingTop: 1 },
  fieldCopy: { flex: 1, gap: 2 },
  fieldLabel: { fontSize: 12.5, color: Colors.textSecondary },
  fieldValue: { fontSize: 13.5, fontWeight: '600' as const, lineHeight: 19 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  logDot: { width: 7, height: 7, borderRadius: 999, marginTop: 5 },
  logCopy: { flex: 1, gap: 2 },
  logTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logChannel: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary, letterSpacing: 0.3 },
  logTime: { fontSize: 10.5, color: Colors.textSecondary },
  logMessage: { fontSize: 12.5, color: Colors.text, lineHeight: 18 }});
