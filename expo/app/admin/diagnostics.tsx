import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import {
  Activity,
  AlertTriangle,
  Boxes,
  ClipboardCopy,
  Cpu,
  Database,
  Fingerprint,
  GitBranch,
  Hash,
  HeartPulse,
  Lock,
  Package,
  RotateCcw,
  Server,
  Shield,
  Smartphone,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { RefreshControl } from 'react-native';
import { getIVXBuildInfo, type IVXBuildInfo } from '@/constants/build-info';
import { getStartupTraceInfo } from '@/lib/startup-trace';
import { useAuth } from '@/lib/auth-context';
import { isAdminRole } from '@/lib/auth-helpers';
import { ivxDiagnostics, type DiagnosticsSnapshot } from '@/src/modules/ivx-developer/diagnosticsStore';
import { IVX_CANONICAL_API_BASE_URL } from '@/lib/ivx-supabase-client';

type BackendHealthState = {
  status: 'idle' | 'loading' | 'healthy' | 'down' | 'error';
  commit: string | null;
  routes: number | null;
  aiEnabled: boolean | null;
  error: string | null;
  lastChecked: string | null;
};

function useBackendHealth(): { state: BackendHealthState; refresh: () => void } {
  const [state, setState] = useState<BackendHealthState>({
    status: 'idle',
    commit: null,
    routes: null,
    aiEnabled: null,
    error: null,
    lastChecked: null});
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${IVX_CANONICAL_API_BASE_URL}/health`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }});
      clearTimeout(timeout);
      if (!mountedRef.current) return;
      if (!resp.ok) {
        setState({
          status: 'down',
          commit: null,
          routes: null,
          aiEnabled: null,
          error: `HTTP ${resp.status}`,
          lastChecked: new Date().toISOString()});
        return;
      }
      const data = await resp.json();
      if (!mountedRef.current) return;
      setState({
        status: 'healthy',
        commit: typeof data.commit === 'string' ? data.commit : null,
        routes: Array.isArray(data.routes) ? data.routes.length : null,
        aiEnabled: typeof data.aiEnabled === 'boolean' ? data.aiEnabled : null,
        error: null,
        lastChecked: new Date().toISOString()});
    } catch (error) {
      if (!mountedRef.current) return;
      setState({
        status: 'error',
        commit: null,
        routes: null,
        aiEnabled: null,
        error: error instanceof Error ? error.message : 'Network error',
        lastChecked: new Date().toISOString()});
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { state, refresh: () => void load() };
}

function useDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>(() => ivxDiagnostics.getSnapshot());
  useEffect(() => {
    const unsub = ivxDiagnostics.subscribe(setSnapshot);
    return () => unsub();
  }, []);
  return snapshot;
}

function healthStatusColor(status: BackendHealthState['status']): string {
  if (status === 'healthy') return Colors.success;
  if (status === 'loading') return Colors.warning;
  return Colors.error;
}

function authStateLabel(userRole: string | null, isAuthenticated: boolean, isLoading: boolean): string {
  if (isLoading) return 'AUTH_INITIALIZING';
  if (!isAuthenticated) return 'SIGNED_OUT';
  if (isAdminRole(userRole)) return 'SIGNED_IN_OWNER';
  return 'SIGNED_IN_MEMBER';
}

function ownerAuthLabel(userRole: string | null, isAuthenticated: boolean): string {
  if (!isAuthenticated) return 'NOT_AUTHENTICATED';
  if (isAdminRole(userRole)) return 'OWNER_AUTHORIZED';
  return 'OWNER_DENIED';
}

function getLastSanitizedError(snapshot: DiagnosticsSnapshot): string {
  const renderWarningEvents = snapshot.recentEvents.filter((e) => e.kind === 'render-warning');
  if (renderWarningEvents.length > 0) {
    return renderWarningEvents[0].detail.slice(0, 200);
  }
  const allEvents = snapshot.recentEvents;
  if (allEvents.length > 0) {
    return `${allEvents[0].kind}: ${allEvents[0].detail.slice(0, 160)}`;
  }
  return 'No runtime errors recorded';
}

function Row({
  icon,
  label,
  value,
  tone = 'default',
  testId}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'error' | 'success' | 'warning';
  testId?: string;
}) {
  const color =
    tone === 'error' ? Colors.error :
    tone === 'success' ? Colors.success :
    tone === 'warning' ? Colors.warning :
    Colors.text;
  return (
    <View style={styles.row} testID={testId}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color }]} numberOfLines={2} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

function Card({ title, icon, children, testId }: { title: string; icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <View style={styles.card} testID={testId}>
      <View style={styles.cardHeader}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function DiagnosticsContent() {
  const insets = useSafeAreaInsets();
  const build = useMemo<IVXBuildInfo>(() => getIVXBuildInfo(), []);
  const startupTrace = useMemo(() => getStartupTraceInfo(), []);
  const diag = useDiagnosticsSnapshot();
  const { state: healthState, refresh: refreshHealth } = useBackendHealth();
  const { user, userId, userRole, isAuthenticated, isLoading } = useAuth();
  const [copied, setCopied] = useState(false);

  const packageName = useMemo(
    () => Constants.expoConfig?.android?.package ?? Constants.expoConfig?.ios?.bundleIdentifier ?? 'unknown',
    [],
  );
  const versionCode = useMemo(
    () => String(Constants.expoConfig?.android?.versionCode ?? 'unknown'),
    [],
  );

  const authState = authStateLabel(userRole, isAuthenticated, isLoading);
  const ownerAuth = ownerAuthLabel(userRole, isAuthenticated);
  const lastError = getLastSanitizedError(diag);

  const reportText = useMemo(() => {
    const lines = [
      '=== IVX DIAGNOSTICS REPORT (Admin) ===',
      `captured: ${new Date().toISOString()}`,
      `platform: ${Platform.OS} ${Platform.Version}`,
      '',
      'BUILD IDENTITY',
      `  appVersion: ${build.appVersion}`,
      `  versionCode: ${versionCode}`,
      `  gitSHA: ${build.commitFull}`,
      `  gitShort: ${build.commitShort}`,
      `  buildMarker: ${build.buildMarker}`,
      `  buildTimestamp: ${build.buildTimestamp}`,
      `  watchdogPatch: ${build.watchdogPatchVersion}`,
      `  frontendDeploy: ${build.frontendDeployMarker}`,
      `  bundleBoot: ${new Date(build.bundleBootEpochMs).toISOString()}`,
      `  environment: ${build.environment}`,
      `  runtime: ${build.runtimeKind}`,
      `  package: ${packageName}`,
      '',
      'BACKEND HEALTH',
      `  status: ${healthState.status}`,
      `  commit: ${healthState.commit ?? 'unavailable'}`,
      `  routes: ${healthState.routes ?? '—'}`,
      `  aiEnabled: ${healthState.aiEnabled ?? '—'}`,
      `  error: ${healthState.error ?? 'none'}`,
      `  lastChecked: ${healthState.lastChecked ?? 'never'}`,
      '',
      'SUPABASE',
      `  projectHint: ${build.supabaseProjectHint}`,
      `  apiBaseUrl: ${build.apiBaseUrl}`,
      '',
      'AUTH STATE',
      `  authState: ${authState}`,
      `  ownerAuth: ${ownerAuth}`,
      `  userId: ${userId ?? 'null'}`,
      `  userRole: ${userRole ?? 'null'}`,
      `  email: ${user?.email ?? 'null'}`,
      '',
      'STARTUP TRACE',
      `  traceId: ${startupTrace.traceId}`,
      `  elapsedMs: ${startupTrace.elapsedMs}`,
      `  checkpoints: ${startupTrace.checkpoints.join(', ') || 'none'}`,
      '',
      'RUNTIME ERRORS',
      `  renderWarnings: ${diag.renderWarnings}`,
      `  scrollEvents: ${diag.scrollEvents}`,
      `  lastError: ${lastError}`,
      `  recentEvents: ${diag.recentEvents.length}`,
    ];
    return lines.join('\n');
  }, [build, versionCode, packageName, healthState, authState, ownerAuth, userId, userRole, user, startupTrace, diag, lastError]);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, [reportText]);

  const handleResetDiagnostics = useCallback(() => {
    ivxDiagnostics.reset();
  }, []);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'IVX Diagnostics',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false}}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        testID="admin-diagnostics-scroll"
      >
        <Card
          title="Build Identity"
          icon={<Boxes size={16} color={Colors.primary} />}
          testId="admin-diagnostics-build-card"
        >
          <Row icon={<Smartphone size={14} color={Colors.gold} />} label="App Version" value={build.appVersion} testId="diag-app-version" />
          <Row icon={<Hash size={14} color={Colors.gold} />} label="versionCode" value={versionCode} testId="diag-version-code" />
          <Row
            icon={<GitBranch size={14} color={build.commitShort === 'local' ? Colors.error : Colors.gold} />}
            label="Git SHA"
            value={build.commitFull || build.commitShort}
            tone={build.commitShort === 'local' ? 'error' : 'default'}
            testId="diag-git-sha"
          />
          <Row icon={<Package size={14} color={Colors.gold} />} label="APK Build ID" value={build.buildMarker} testId="diag-build-id" />
          <Row icon={<Cpu size={14} color={Colors.gold} />} label="Build Time" value={build.buildTimestamp} testId="diag-build-time" />
          <Row icon={<Package size={14} color={Colors.gold} />} label="Package" value={packageName} testId="diag-package" />
          <Row icon={<Cpu size={14} color={Colors.gold} />} label="Watchdog" value={build.watchdogPatchVersion} testId="diag-watchdog" />
          <Row icon={<Cpu size={14} color={Colors.gold} />} label="Environment" value={build.environment} testId="diag-environment" />
          <Row icon={<Smartphone size={14} color={Colors.gold} />} label="Runtime" value={build.runtimeKind} testId="diag-runtime" />
          <Row icon={<Package size={14} color={Colors.gold} />} label="Deploy Marker" value={build.frontendDeployMarker} testId="diag-deploy-marker" />
          {build.isIdentified ? null : (
            <View style={styles.warningRow}>
              <AlertTriangle size={13} color={Colors.error} />
              <Text style={styles.warningText}>{build.unidentifiedReason ?? 'Build not identified'}</Text>
            </View>
          )}
        </Card>

        <Card
          title="Backend Health"
          icon={<HeartPulse size={16} color={healthStatusColor(healthState.status)} />}
          testId="admin-diagnostics-health-card"
        >
          <Row
            icon={<HeartPulse size={14} color={healthStatusColor(healthState.status)} />}
            label="API Health"
            value={healthState.status.toUpperCase()}
            tone={healthState.status === 'healthy' ? 'success' : healthState.status === 'error' || healthState.status === 'down' ? 'error' : 'warning'}
            testId="diag-api-health"
          />
          <Row
            icon={<GitBranch size={14} color={Colors.gold} />}
            label="Backend SHA"
            value={healthState.commit ?? 'unavailable'}
            tone={healthState.commit ? 'success' : 'error'}
            testId="diag-backend-sha"
          />
          <Row icon={<Server size={14} color={Colors.gold} />} label="Routes" value={healthState.routes != null ? String(healthState.routes) : '—'} testId="diag-routes" />
          <Row icon={<Activity size={14} color={Colors.gold} />} label="AI Enabled" value={healthState.aiEnabled != null ? String(healthState.aiEnabled) : '—'} testId="diag-ai-enabled" />
          {healthState.error ? (
            <Row icon={<XCircle size={14} color={Colors.error} />} label="Error" value={healthState.error} tone="error" testId="diag-health-error" />
          ) : null}
          <Row icon={<Server size={14} color={Colors.gold} />} label="Last Check" value={healthState.lastChecked ?? 'never'} testId="diag-last-check" />
          <Pressable style={styles.refreshBtn} onPress={refreshHealth} testID="diag-health-refresh">
            <RotateCcw size={13} color={Colors.text} />
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </Pressable>
        </Card>

        <Card
          title="Supabase"
          icon={<Database size={16} color={Colors.primary} />}
          testId="admin-diagnostics-supabase-card"
        >
          <Row icon={<Database size={14} color={Colors.gold} />} label="Project Ref" value={build.supabaseProjectHint} testId="diag-supabase-project" />
          <Row icon={<Server size={14} color={Colors.gold} />} label="API Base URL" value={build.apiBaseUrl} testId="diag-api-base-url" />
        </Card>

        <Card
          title="Authentication"
          icon={<Shield size={16} color={Colors.primary} />}
          testId="admin-diagnostics-auth-card"
        >
          <Row
            icon={<Shield size={14} color={authState === 'SIGNED_IN_OWNER' ? Colors.success : authState === 'SIGNED_OUT' ? Colors.error : Colors.warning} />}
            label="Auth State"
            value={authState}
            tone={authState === 'SIGNED_IN_OWNER' ? 'success' : authState === 'SIGNED_OUT' ? 'error' : 'warning'}
            testId="diag-auth-state"
          />
          <Row
            icon={<Lock size={14} color={ownerAuth === 'OWNER_AUTHORIZED' ? Colors.success : Colors.error} />}
            label="Owner Auth"
            value={ownerAuth}
            tone={ownerAuth === 'OWNER_AUTHORIZED' ? 'success' : 'error'}
            testId="diag-owner-auth"
          />
          <Row icon={<Fingerprint size={14} color={Colors.gold} />} label="User ID" value={userId ?? 'null'} testId="diag-user-id" />
          <Row icon={<Shield size={14} color={Colors.gold} />} label="Role" value={userRole ?? 'null'} testId="diag-role" />
        </Card>

        <Card
          title="Startup Trace"
          icon={<Activity size={16} color={Colors.primary} />}
          testId="admin-diagnostics-startup-card"
        >
          <Row icon={<Fingerprint size={14} color={Colors.gold} />} label="Trace ID" value={startupTrace.traceId} testId="diag-trace-id" />
          <Row icon={<Activity size={14} color={Colors.gold} />} label="Elapsed" value={`${startupTrace.elapsedMs}ms`} testId="diag-elapsed" />
          <Row
            icon={<Activity size={14} color={Colors.gold} />}
            label="Checkpoints"
            value={startupTrace.checkpoints.length > 0 ? startupTrace.checkpoints.join(', ') : 'none recorded'}
            testId="diag-checkpoints"
          />
        </Card>

        <Card
          title="Runtime Errors"
          icon={<AlertTriangle size={16} color={diag.renderWarnings > 0 ? Colors.warning : Colors.success} />}
          testId="admin-diagnostics-errors-card"
        >
          <Row icon={<AlertTriangle size={14} color={Colors.gold} />} label="Render Warnings" value={String(diag.renderWarnings)} testId="diag-render-warnings" />
          <Row icon={<AlertTriangle size={14} color={Colors.gold} />} label="Scroll Events" value={String(diag.scrollEvents)} testId="diag-scroll-events" />
          <View style={styles.errorBox} testID="diag-last-error">
            <Text style={styles.errorLabel}>Last Sanitized Runtime Error:</Text>
            <Text style={styles.errorText}>{lastError}</Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={handleResetDiagnostics} testID="diag-reset-errors">
            <RotateCcw size={13} color={Colors.text} />
            <Text style={styles.refreshBtnText}>Reset Counters</Text>
          </Pressable>
        </Card>

        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={handleCopy}
            testID="admin-diagnostics-copy"
          >
            <ClipboardCopy size={15} color={Colors.black} />
            <Text style={styles.actionPrimaryText}>{copied ? 'Copied!' : 'Copy Report'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

export default function DiagnosticsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
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
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    marginBottom: 14},
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  rowIcon: { width: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: Colors.textSecondary, fontSize: 12, width: 110 },
  rowValue: { color: Colors.text, fontSize: 12, flex: 1, fontWeight: '600' as const },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${Colors.error}18`,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    gap: 8},
  warningText: { color: Colors.error, fontSize: 11, flex: 1, lineHeight: 15 },
  errorBox: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    padding: 10,
    marginTop: 8},
  errorLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' as const, marginBottom: 4 },
  errorText: { color: Colors.text, fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginTop: 10},
  refreshBtnText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12 },
  actionPrimary: { backgroundColor: Colors.primary },
  actionPrimaryText: { color: Colors.black, fontSize: 13, fontWeight: '700' as const }});
