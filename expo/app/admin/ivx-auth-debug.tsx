import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  CheckCircle2,
  Globe,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Wifi,
  XCircle,
  Zap} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';

type EndpointProbe = {
  label: string;
  path: string;
  method: 'GET' | 'POST';
  status: number | null;
  ok: boolean | null;
  error: string | null;
  latencyMs: number | null;
};

type AuthDebugState = {
  tokenPresent: boolean | null;
  ownerEmailPresent: boolean | null;
  ownerEmailMasked: string | null;
  role: string | null;
  sessionExpired: boolean | null;
  baseUrl: string | null;
  probes: EndpointProbe[];
  lastRunAt: string | null;
  loading: boolean;
};

const INITIAL_PROBES: EndpointProbe[] = [
  { label: 'Health', path: '/health', method: 'GET', status: null, ok: null, error: null, latencyMs: null },
  { label: 'Senior Dev Status', path: '/api/ivx/senior-developer/status', method: 'GET', status: null, ok: null, error: null, latencyMs: null },
  { label: 'Agent Jobs Live', path: '/api/ivx/agent-jobs/live-activity?limit=1', method: 'GET', status: null, ok: null, error: null, latencyMs: null },
  { label: 'Owner AI Probe', path: '/api/ivx/owner-ai', method: 'GET', status: null, ok: null, error: null, latencyMs: null },
  { label: 'GitHub Audit', path: '/api/ivx/senior-developer/github-audit', method: 'GET', status: null, ok: null, error: null, latencyMs: null },
];

function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const [user, domain] = email.split('@');
  if (!user || !domain) return null;
  const maskedUser = user.length <= 2 ? user : `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

export default function IVXAuthDebugScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [state, setState] = useState<AuthDebugState>({
    tokenPresent: null,
    ownerEmailPresent: null,
    ownerEmailMasked: null,
    role: null,
    sessionExpired: null,
    baseUrl: null,
    probes: INITIAL_PROBES.map((p) => ({ ...p })),
    lastRunAt: null,
    loading: false});

  const runDiagnostics = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    if (typeof Platform !== 'undefined' && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }

    const audit = getIVXOwnerAIConfigAudit();
    const baseUrl = audit.activeBaseUrl;

    // Auth diagnostics
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const accessToken = session?.access_token ?? null;
    const tokenPresent = !!accessToken;
    const email = session?.user?.email ?? null;
    const ownerEmailPresent = !!email;
    const masked = maskEmail(email);
    const role = (session?.user?.user_metadata?.role as string) ?? (session?.user?.app_metadata?.role as string) ?? null;
    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    const sessionExpired = expiresAt > 0 ? Date.now() > expiresAt : null;

    // Endpoint probes
    const probes: EndpointProbe[] = [];
    for (const template of INITIAL_PROBES) {
      const probe: EndpointProbe = { ...template, status: null, ok: null, error: null, latencyMs: null };
      if (!baseUrl) {
        probe.error = 'No active base URL';
        probes.push(probe);
        continue;
      }
      const url = `${baseUrl.replace(/\/+$/, '')}${probe.path}`;
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          method: probe.method,
          headers: {
            Accept: 'application/json',
            ...(tokenPresent ? { Authorization: `Bearer ${accessToken}` } : {})}});
        probe.latencyMs = Date.now() - startedAt;
        probe.status = response.status;
        // For owner-only routes, 401 means the route exists but auth is required (not a failure of routing)
        probe.ok = response.status === 200 || response.status === 204 || response.status === 401;
      } catch (err) {
        probe.latencyMs = Date.now() - startedAt;
        probe.error = err instanceof Error ? err.message : 'Network error';
      }
      probes.push(probe);
    }

    setState({
      tokenPresent,
      ownerEmailPresent,
      ownerEmailMasked: masked,
      role,
      sessionExpired,
      baseUrl,
      probes,
      lastRunAt: new Date().toISOString(),
      loading: false});
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const statusBadge = (value: boolean | null) => {
    if (value === true) {
      return (
        <View style={styles.badgeOk}>
          <CheckCircle2 size={12} color={Colors.green} />
          <Text style={styles.badgeOkText}>PASS</Text>
        </View>
      );
    }
    if (value === false) {
      return (
        <View style={styles.badgeFail}>
          <XCircle size={12} color={Colors.red} />
          <Text style={styles.badgeFailText}>FAIL</Text>
        </View>
      );
    }
    return (
      <View style={styles.badgeUnknown}>
        <ShimmerIndicator size={12} color={Colors.textTertiary} />
        <Text style={styles.badgeUnknownText}>…</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerTitleRow}>
            <ShieldCheck size={16} color={Colors.green} />
            <Text style={styles.headerTitle}>Auth Debug</Text>
          </View>
          <Text style={styles.headerSub}>IVX IA · token + endpoint diagnostics</Text>
        </View>
        <Pressable onPress={runDiagnostics} style={styles.refreshBtn} hitSlop={12}>
          <RefreshCw size={18} color={Colors.green} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={state.loading} onRefresh={runDiagnostics} tintColor={Colors.green} />
        }
      >
        {/* Auth card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <KeyRound size={14} color={Colors.gold} />
            <Text style={styles.cardTitle}>Session Auth</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Zap size={13} color={Colors.textSecondary} />
              <Text style={styles.rowLabel}>Token present</Text>
            </View>
            {statusBadge(state.tokenPresent)}
          </View>
          <Text style={styles.rowHint}>Authorization: Bearer {'<token>'} attached to probes</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Mail size={13} color={Colors.textSecondary} />
              <Text style={styles.rowLabel}>Owner email present</Text>
            </View>
            {statusBadge(state.ownerEmailPresent)}
          </View>
          {state.ownerEmailMasked ? (
            <Text style={styles.rowHint}>Masked: {state.ownerEmailMasked}</Text>
          ) : null}

          {state.role ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <ShieldCheck size={13} color={Colors.textSecondary} />
                <Text style={styles.rowLabel}>Role</Text>
              </View>
              <View style={styles.badgeInfo}>
                <Text style={styles.badgeInfoText}>{state.role}</Text>
              </View>
            </View>
          ) : null}

          {state.sessionExpired !== null ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <ShieldX size={13} color={Colors.textSecondary} />
                <Text style={styles.rowLabel}>Session expired</Text>
              </View>
              {statusBadge(state.sessionExpired)}
            </View>
          ) : null}
        </View>

        {/* Endpoint probes card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Globe size={14} color={Colors.gold} />
            <Text style={styles.cardTitle}>Endpoint Probes</Text>
          </View>
          <Text style={styles.baseUrl}>{state.baseUrl ?? 'No base URL configured'}</Text>

          {state.probes.map((probe) => (
            <View key={probe.path} style={styles.probeRow}>
              <View style={styles.probeTop}>
                <View style={styles.probeLeft}>
                  <Wifi size={12} color={probe.ok === true ? Colors.green : probe.ok === false ? Colors.red : Colors.textTertiary} />
                  <Text style={styles.probeLabel}>{probe.label}</Text>
                </View>
                <View style={styles.probeRight}>
                  {probe.status !== null && (
                    <View style={[styles.statusPill, probe.status === 200 || probe.status === 204 ? styles.statusPillOk : probe.status === 401 ? styles.statusPillAuth : styles.statusPillFail]}>
                      <Text style={[styles.statusPillText, probe.status === 200 || probe.status === 204 ? styles.statusPillTextOk : probe.status === 401 ? styles.statusPillTextAuth : styles.statusPillTextFail]}>
                        {probe.status}
                      </Text>
                    </View>
                  )}
                  {probe.latencyMs !== null && (
                    <Text style={styles.latencyText}>{probe.latencyMs}ms</Text>
                  )}
                </View>
              </View>
              {probe.error ? (
                <Text style={styles.probeError}>{probe.error}</Text>
              ) : probe.status === 401 ? (
                <Text style={styles.probeHint}>401 = route exists, auth required (expected for owner-only)</Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* Legend */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <ShieldCheck size={14} color={Colors.gold} />
            <Text style={styles.cardTitle}>Legend</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.statusPill, styles.statusPillOk]}><Text style={[styles.statusPillText, styles.statusPillTextOk]}>200</Text></View>
            <Text style={styles.legendText}>OK — reachable and responding</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.statusPill, styles.statusPillAuth]}><Text style={[styles.statusPillText, styles.statusPillTextAuth]}>401</Text></View>
            <Text style={styles.legendText}>Auth required — route exists, bearer rejected or missing</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.statusPill, styles.statusPillFail]}><Text style={[styles.statusPillText, styles.statusPillTextFail]}>404</Text></View>
            <Text style={styles.legendText}>Not found — route missing or not deployed</Text>
          </View>
          <Text style={styles.safeNote}>No token value is ever displayed. Only presence (true/false) is shown.</Text>
        </View>

        {state.lastRunAt ? (
          <Text style={styles.footer}>Last run: {state.lastRunAt}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: { padding: 4, marginRight: 12 },
  headerTitleWrap: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  refreshBtn: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10},
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: Colors.textSecondary, fontSize: 13 },
  rowHint: { color: Colors.textTertiary, fontSize: 11, marginLeft: 21 },
  badgeOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  badgeOkText: { color: Colors.green, fontSize: 11, fontWeight: '700' },
  badgeFail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  badgeFailText: { color: Colors.red, fontSize: 11, fontWeight: '700' },
  badgeUnknown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  badgeUnknownText: { color: Colors.textTertiary, fontSize: 11, fontWeight: '700' },
  badgeInfo: {
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  badgeInfoText: { color: Colors.blue, fontSize: 11, fontWeight: '700' },
  baseUrl: { color: Colors.textTertiary, fontSize: 11, marginBottom: 4 },
  probeRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 4},
  probeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  probeLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  probeLabel: { color: Colors.textSecondary, fontSize: 13 },
  probeRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusPill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 44,
    alignItems: 'center'},
  statusPillOk: { backgroundColor: 'rgba(34,197,94,0.15)' },
  statusPillAuth: { backgroundColor: 'rgba(245,158,11,0.15)' },
  statusPillFail: { backgroundColor: 'rgba(239,68,68,0.15)' },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  statusPillTextOk: { color: Colors.green },
  statusPillTextAuth: { color: Colors.warning },
  statusPillTextFail: { color: Colors.red },
  latencyText: { color: Colors.textTertiary, fontSize: 11, fontVariant: ['tabular-nums'] },
  probeError: { color: Colors.red, fontSize: 11, marginLeft: 20 },
  probeHint: { color: Colors.textTertiary, fontSize: 11, marginLeft: 20, fontStyle: 'italic' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  legendText: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  safeNote: { color: Colors.textTertiary, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  footer: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 8 }});
