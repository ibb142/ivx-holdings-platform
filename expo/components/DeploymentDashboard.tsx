/**
 * IVX Live Deployment Dashboard
 *
 * Real-time status display for all deployment tools:
 *   - GitHub HEAD commit
 *   - Render deployed commit
 *   - Production commit
 *   - Commit match status
 *   - Auto-deploy status
 *   - Supabase status
 *   - Errors and blockers
 *   - Next automatic action
 */

import React, { useCallback, useEffect, useState } from 'react';
import {View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform} from "react-native";
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, ExternalLink, ChevronRight, Rocket } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// ─── Types ───────────────────────────────────────────────────────────

type BrainStatus = 'healthy' | 'degraded' | 'stale' | 'broken' | 'unverified';

interface DashboardData {
  brain: {
    overallStatus: BrainStatus;
    decision: string;
    commitMatch: boolean;
    commits: { github: string | null; render: string | null; production: string | null };
    platforms: Array<{ platform: string; ok: boolean; configured: boolean; error: string | null; details: Record<string, unknown> }>;
    deployInProgress: boolean;
    latestDeploy: { id: string | null; status: string | null; duration: number | null };
    credentials: { total: number; valid: number; missing: number; failed: number };
    errors: string[];
    blockers: string[];
    nextAction: string;
    autoRepairAvailable: boolean;
    ownerApprovalRequired: boolean;
  };
  evidence: {
    endpoints: Array<{ name: string; ok: boolean; status: number | null; latencyMs: number; error: string | null }>;
    commitMatch: boolean;
    commits: Array<{ source: string; shortSha: string | null; error: string | null }>;
    allEndpointsOk: boolean;
    healthStatus: string | null;
  };
  credentials: {
    summary: { total: number; valid: number; missing: number; failed: number };
    gaps: string[];
    recommendations: string[];
  };
  timestamp: string;
}

// ─── Styles ───────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0a0a0f',
  card: '#14141f',
  cardBorder: '#1e1e2e',
  text: '#e4e4f0',
  textSecondary: '#8888a0',
  green: '#00C48C',
  greenBg: 'rgba(34, 197, 94, 0.1)',
  red: '#FF4D4D',
  redBg: 'rgba(239, 68, 68, 0.1)',
  yellow: '#f59e0b',
  yellowBg: 'rgba(245, 158, 11, 0.1)',
  blue: '#4A90D9',
  blueBg: 'rgba(59, 130, 246, 0.1)',
  purple: '#8b5cf6',
  accent: '#6366f1'};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg},
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text},
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.card},
  statusBadge: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start'},
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  section: {
    marginHorizontal: 16,
    marginBottom: 16},
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    marginBottom: 8},
  commitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4},
  commitSource: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500'},
  commitSha: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: COLORS.text,
    fontWeight: '600'},
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder},
  platformName: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '600',
    textTransform: 'capitalize'},
  platformStatus: {
    fontSize: 12,
    fontWeight: '500'},
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
    alignItems: 'center'},
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text},
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase'},
  errorCard: {
    backgroundColor: COLORS.redBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.red},
  errorText: {
    fontSize: 12,
    color: COLORS.red,
    lineHeight: 18},
  nextActionCard: {
    backgroundColor: COLORS.blueBg,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.blue},
  nextActionText: {
    fontSize: 13,
    color: COLORS.blue,
    fontWeight: '500',
    lineHeight: 20},
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4},
  endpointName: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1},
  endpointStatus: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginRight: 8},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg},
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 12,
    fontSize: 14},
  deployProgress: {
    backgroundColor: COLORS.yellowBg,
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  redeploySection: {
    marginHorizontal: 16,
    marginBottom: 16},
  redeployButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: COLORS.green,
    borderRadius: 12},
  redeployButtonDisabled: {
    opacity: 0.6},
  redeployButtonText: {
    color: '#0B0B0B',
    fontSize: 15,
    fontWeight: '700'},
  redeployHint: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.yellow,
    textAlign: 'center'},
  redeployResult: {
    marginTop: 10,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1},
  redeployResultText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18}});

// ─── Component ────────────────────────────────────────────────────────

export default function DeploymentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployResult, setRedeployResult] = useState<{ ok: boolean; deployId?: string | null; status?: string | null; error?: string | null } | null>(null);

  const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.ivxholding.com';

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ivx/deploy-tools/dashboard`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30000)});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { ok: boolean; brain?: unknown; evidence?: unknown; credentials?: unknown } & Record<string, unknown>;
      if (!json.ok) throw new Error('Dashboard returned not-ok');
      setData(json as unknown as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  const getOwnerBearer = useCallback(async () => {
    try {
      const result = await supabase.auth.getSession();
      const token = result.data?.session?.access_token;
      return typeof token === 'string' && token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }, []);

  const confirmRedeploy = useCallback((title: string, message: string): Promise<boolean> => {
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(`${title}\n\n${message}`)
        : true;
      return Promise.resolve(ok);
    }
    return new Promise((resolve) => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Redeploy', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  }, []);

  const handleRedeploy = useCallback(async () => {
    const proceed = await confirmRedeploy(
      'Trigger fresh Render deploy?',
      'This queues a fresh build of the latest GitHub commit on Render. Only proceed after resolving any billing/build-pipeline issues.',
    );
    if (!proceed) return;

    setRedeploying(true);
    setRedeployResult(null);

    const bearer = await getOwnerBearer();
    if (!bearer) {
      setRedeploying(false);
      setRedeployResult({ ok: false, error: 'No signed-in owner session. Sign in as the IVX owner and retry.' });
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ivx/developer-deploy/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({
          action: 'render_trigger_deploy',
          confirm: true,
          confirmText: 'CONFIRM_IVX_RENDER_DEPLOY',
          input: { clearCache: true }}),
        signal: AbortSignal.timeout(60000)});
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const ok = res.ok && json.ok !== false;
      const result = (json.result ?? json) as Record<string, unknown>;
      const deployId: string | null =
        (typeof result.deployId === 'string' ? result.deployId : null) ||
        (typeof (result.deploy as Record<string, unknown>)?.id === 'string' ? (result.deploy as Record<string, unknown>).id as string : null) ||
        null;
      const status: string | null = (typeof result.status === 'string' ? result.status : null) || null;
      setRedeployResult({
        ok,
        deployId,
        status,
        error: ok ? null : (typeof json.error === 'string' ? json.error : `HTTP ${res.status}`)});
      if (ok) void fetchDashboard();
    } catch (err) {
      setRedeployResult({ ok: false, error: err instanceof Error ? err.message : 'Failed to trigger redeploy' });
    } finally {
      setRedeploying(false);
    }
  }, [API_BASE, confirmRedeploy, fetchDashboard, getOwnerBearer]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading && !data) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>Loading deployment dashboard...</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.loadingContainer}>
        <XCircle size={48} color={COLORS.red} />
        <Text style={[styles.loadingText, { color: COLORS.red }]}>{error}</Text>
        <TouchableOpacity style={[styles.refreshButton, { marginTop: 16 }]} onPress={fetchDashboard}>
          <RefreshCw size={20} color={COLORS.accent} />
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;

  const { brain, evidence, credentials } = data;

  const statusColors: Record<BrainStatus, string> = {
    healthy: COLORS.green,
    degraded: COLORS.yellow,
    stale: COLORS.yellow,
    broken: COLORS.red,
    unverified: COLORS.textSecondary};

  const statusLabel: Record<BrainStatus, string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    stale: 'Stale — Needs Deploy',
    broken: 'Broken',
    unverified: 'Unverified'};

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Deployment</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={fetchDashboard}>
          <RefreshCw size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Manual Redeploy */}
      <View style={styles.redeploySection}>
        <TouchableOpacity
          style={[styles.redeployButton, redeploying && styles.redeployButtonDisabled]}
          onPress={handleRedeploy}
          disabled={redeploying || brain.deployInProgress}
          testID="deployment-dashboard-redeploy-button"
        >
          {redeploying ? (
            <ShimmerIndicator size="small" color="#0B0B0B" />
          ) : (
            <Rocket size={18} color="#0B0B0B" />
          )}
          <Text style={styles.redeployButtonText}>
            {redeploying ? 'Queueing fresh deploy…' : 'Redeploy latest commit'}
          </Text>
        </TouchableOpacity>
        {brain.deployInProgress && !redeploying && (
          <Text style={styles.redeployHint}>A deploy is already in progress.</Text>
        )}
        {redeployResult && (
          <View style={[styles.redeployResult, redeployResult.ok ? { backgroundColor: COLORS.greenBg, borderColor: COLORS.green } : { backgroundColor: COLORS.redBg, borderColor: COLORS.red }]}>
            <Text style={[styles.redeployResultText, { color: redeployResult.ok ? COLORS.green : COLORS.red }]}>
              {redeployResult.ok
                ? `Redeploy queued${redeployResult.deployId ? ` :: ${redeployResult.deployId}` : ''}${redeployResult.status ? ` (${redeployResult.status})` : ''}`
                : redeployResult.error ?? 'Redeploy failed'}
            </Text>
          </View>
        )}
      </View>

      {/* Overall Status Badge */}
      <View style={[styles.statusBadge, { backgroundColor: `${statusColors[brain.overallStatus]}20` }]}>
        <Text style={[styles.statusText, { color: statusColors[brain.overallStatus] }]}>
          {statusLabel[brain.overallStatus]}
        </Text>
      </View>

      {/* Deploy In Progress */}
      {brain.deployInProgress && (
        <View style={styles.deployProgress}>
          <ShimmerIndicator size="small" color={COLORS.yellow} />
          <Text style={{ color: COLORS.yellow, fontSize: 13, fontWeight: '500' }}>
            Deploy in progress — {brain.latestDeploy.status ?? 'building'}
          </Text>
        </View>
      )}

      {/* Commits Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Commits</Text>
        <View style={styles.card}>
          {Object.entries(brain.commits).map(([source, sha]) => (
            <View key={source} style={styles.commitRow}>
              <Text style={styles.commitSource}>{source}</Text>
              <Text style={styles.commitSha}>{sha ?? 'UNKNOWN'}</Text>
            </View>
          ))}
          <View style={[styles.commitRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.cardBorder }]}>
            <Text style={styles.commitSource}>Commit Match</Text>
            {brain.commitMatch ? (
              <CheckCircle size={18} color={COLORS.green} />
            ) : (
              <XCircle size={18} color={COLORS.red} />
            )}
          </View>
        </View>
      </View>

      {/* Platforms Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Platforms</Text>
        {brain.platforms.map((p) => (
          <View key={p.platform} style={styles.card}>
            <View style={styles.platformRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {p.ok ? (
                  <CheckCircle size={16} color={COLORS.green} />
                ) : p.configured ? (
                  <AlertTriangle size={16} color={COLORS.yellow} />
                ) : (
                  <XCircle size={16} color={COLORS.red} />
                )}
                <Text style={styles.platformName}>{p.platform}</Text>
              </View>
              <Text style={[styles.platformStatus, { color: p.ok ? COLORS.green : p.configured ? COLORS.yellow : COLORS.red }]}>
                {p.ok ? 'OK' : p.configured ? 'Issue' : 'Off'}
              </Text>
            </View>
            {p.error && (
              <Text style={{ fontSize: 11, color: COLORS.red, marginTop: 4 }} numberOfLines={2}>
                {p.error}
              </Text>
            )}
          </View>
        ))}
      </View>

      {/* Endpoints Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Endpoints</Text>
        <View style={styles.card}>
          {evidence.endpoints.slice(0, 10).map((ep) => (
            <View key={ep.name} style={styles.endpointRow}>
              {ep.ok ? (
                <CheckCircle size={12} color={COLORS.green} />
              ) : (
                <XCircle size={12} color={COLORS.red} />
              )}
              <Text style={styles.endpointName} numberOfLines={1}>
                {ep.name}
              </Text>
              <Text style={styles.endpointStatus}>
                {ep.status ?? 'ERR'} ({ep.latencyMs}ms)
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Stats Grid */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Credentials</Text>
        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.green }]}>{credentials.summary.valid}</Text>
            <Text style={styles.statLabel}>Valid</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.red }]}>{credentials.summary.missing}</Text>
            <Text style={styles.statLabel}>Missing</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.yellow }]}>{credentials.summary.failed}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.textSecondary }]}>{credentials.summary.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>
      </View>

      {/* Errors */}
      {brain.errors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Errors ({brain.errors.length})</Text>
          {brain.errors.map((err, i) => (
            <View key={i} style={styles.errorCard}>
              <Text style={styles.errorText}>{err}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Blockers */}
      {brain.blockers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blockers ({brain.blockers.length})</Text>
          {brain.blockers.map((b, i) => (
            <View key={i} style={[styles.errorCard, { borderLeftColor: COLORS.yellow }]}>
              <Text style={[styles.errorText, { color: COLORS.yellow }]}>{b}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Next Action */}
      <View style={styles.nextActionCard}>
        <Text style={styles.nextActionText}>{brain.nextAction}</Text>
      </View>

      {/* Last Updated */}
      <Text style={{
        textAlign: 'center',
        color: COLORS.textSecondary,
        fontSize: 11,
        marginBottom: 24}}>
        Last updated: {data.timestamp ? new Date(data.timestamp).toLocaleString() : 'unknown'}
      </Text>
    </ScrollView>
  );
}
