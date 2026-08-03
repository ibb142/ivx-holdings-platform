/**
 * IVX Owner — One-tap Approve & Deploy.
 *
 * Uses the signed-in Supabase session bearer (no manual token, no dashboard
 * work) to call the owner-only autonomy orchestration route. The route
 * triggers Render, polls until terminal status, then probes production and
 * returns full proof. Rollback is also one tap.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from 'expo-router';
import { CheckCircle2, ChevronRight, RefreshCw, Rocket, ShieldAlert, Undo2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const API_BASE = ((process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.ivxholding.com') as string).replace(/\/$/, '');

type DeployStage =
  | 'idle'
  | 'preparing'
  | 'deploying'
  | 'verifying'
  | 'verified_live'
  | 'verification_failed'
  | 'render_in_progress'
  | 'render_failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_failed'
  | 'error';

type ApproveAndRunResponse = {
  ok: boolean;
  stage?: string;
  approvalProof?: {
    ownerEmailMasked: string | null;
    ownerUserId: string | null;
    mechanism: string;
    approvedAt: string;
  };
  deploy?: {
    id: string | null;
    status: string | null;
    commitSha: string | null;
    commitMessage: string | null;
    pollCount: number;
    reachedTerminal: boolean;
    failureReason: string | null;
  };
  productionProbe?: {
    baseUrl: string | null;
    status: number | null;
    ok: boolean;
    marker: string | null;
    error: string | null;
    durationMs: number;
  } | null;
  rollback?: { available: boolean; route: string };
  timing?: { startedAt: string; finishedAt: string };
  error?: string;
};

type RollbackResponse = {
  ok: boolean;
  stage?: string;
  result?: {
    ok: boolean;
    triggered: boolean;
    reason: string;
    targetDeployId: string | null;
    newDeployId: string | null;
    incidentId: string | null;
  };
  productionProbe?: ApproveAndRunResponse['productionProbe'];
  error?: string;
};

async function getOwnerBearer(): Promise<string | null> {
  try {
    const result = await supabase.auth.getSession();
    const token = result.data?.session?.access_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (err) {
    console.log('[ivx-deploy] session read failed', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${title}\n\n${message}`)
      : true;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Approve', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function stageLabel(stage: DeployStage): string {
  if (stage === 'preparing') return 'Verifying owner session…';
  if (stage === 'deploying') return 'Triggering Render deploy…';
  if (stage === 'verifying') return 'Polling Render & verifying /health…';
  if (stage === 'verified_live') return 'Deploy live & verified';
  if (stage === 'verification_failed') return 'Deploy live but /health probe failed';
  if (stage === 'render_in_progress') return 'Deploy still in progress (poll timed out)';
  if (stage === 'render_failed') return 'Render reported deploy failure';
  if (stage === 'rolling_back') return 'Rolling back…';
  if (stage === 'rolled_back') return 'Rolled back to previous deploy';
  if (stage === 'rollback_failed') return 'Rollback failed';
  if (stage === 'error') return 'Request failed';
  return 'Idle';
}

function stageTone(stage: DeployStage): 'success' | 'warning' | 'error' | 'neutral' {
  if (stage === 'verified_live' || stage === 'rolled_back') return 'success';
  if (stage === 'verification_failed' || stage === 'render_in_progress') return 'warning';
  if (stage === 'render_failed' || stage === 'rollback_failed' || stage === 'error') return 'error';
  return 'neutral';
}

export default function IVXDeployScreen() {
  const [stage, setStage] = useState<DeployStage>('idle');
  const [deployResult, setDeployResult] = useState<ApproveAndRunResponse | null>(null);
  const [rollbackResult, setRollbackResult] = useState<RollbackResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const screenOptions = useMemo(() => ({ title: 'Approve & Deploy' }), []);

  const handleApproveAndRun = useCallback(async () => {
    const proceed = await confirm(
      'Approve owner-only production deploy?',
      'This will trigger a Render deploy of the latest commit and verify production /health. Secrets are not exposed. You can roll back from this screen if anything looks wrong.',
    );
    if (!proceed) return;

    setStage('preparing');
    setErrorMessage(null);
    setDeployResult(null);
    setRollbackResult(null);

    const bearer = await getOwnerBearer();
    if (!bearer) {
      setStage('error');
      setErrorMessage('No signed-in owner session detected. Sign in with the owner account, then try again.');
      return;
    }

    try {
      setStage('deploying');
      const response = await fetch(`${API_BASE}/api/ivx/autonomy/deploy/approve-and-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({ clearCache: false, pollTimeoutMs: 5 * 60_000 })});
      setStage('verifying');
      const json = await response.json().catch(() => ({})) as ApproveAndRunResponse;
      setDeployResult(json);
      const incomingStage = (json.stage ?? '').toLowerCase();
      if (incomingStage === 'verified_live') setStage('verified_live');
      else if (incomingStage === 'verification_failed') setStage('verification_failed');
      else if (incomingStage === 'render_in_progress') setStage('render_in_progress');
      else if (incomingStage === 'render_failed') setStage('render_failed');
      else if (!response.ok) {
        setStage('error');
        setErrorMessage(json.error ?? `HTTP ${response.status}`);
      } else {
        setStage(json.ok ? 'verified_live' : 'verification_failed');
      }
    } catch (err) {
      setStage('error');
      setErrorMessage(err instanceof Error ? err.message : 'network_error');
    }
  }, []);

  const handleRollback = useCallback(async () => {
    const proceed = await confirm(
      'Roll back to the previous deploy?',
      'This reverts production to the most recent successful deploy on Render. Use this only if the new deploy is broken.',
    );
    if (!proceed) return;

    setStage('rolling_back');
    setErrorMessage(null);
    setRollbackResult(null);

    const bearer = await getOwnerBearer();
    if (!bearer) {
      setStage('error');
      setErrorMessage('No signed-in owner session detected.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ivx/autonomy/deploy/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({ reason: 'Owner one-tap rollback from in-app Approve & Deploy screen.' })});
      const json = await response.json().catch(() => ({})) as RollbackResponse;
      setRollbackResult(json);
      if (response.ok && json.ok) setStage('rolled_back');
      else {
        setStage('rollback_failed');
        setErrorMessage(json.error ?? json.result?.reason ?? `HTTP ${response.status}`);
      }
    } catch (err) {
      setStage('rollback_failed');
      setErrorMessage(err instanceof Error ? err.message : 'network_error');
    }
  }, []);

  const busy = stage === 'preparing' || stage === 'deploying' || stage === 'verifying' || stage === 'rolling_back';
  const tone = stageTone(stage);
  const toneColor =
    tone === 'success' ? Colors.success
      : tone === 'warning' ? Colors.warning
        : tone === 'error' ? Colors.error
          : Colors.info;

  return (
    <View style={styles.root} testID="ivx-deploy-screen">
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: `${Colors.success}1F`, borderColor: Colors.success }]}>
            <Rocket size={22} color={Colors.success} />
          </View>
          <Text style={styles.title}>Approve & Deploy</Text>
          <Text style={styles.subtitle}>
            One tap triggers a Render deploy of the latest commit, polls until terminal status, then verifies production /health. Owner session bearer is attached automatically — no copying tokens, no Render dashboard.
          </Text>
        </View>

        <Pressable
          onPress={handleApproveAndRun}
          disabled={busy}
          style={[styles.primaryButton, busy ? styles.primaryButtonDisabled : null]}
          testID="ivx-deploy-approve-button"
        >
          {busy && (stage === 'preparing' || stage === 'deploying' || stage === 'verifying') ? (
            <ShimmerIndicator color="#0B0B0B" />
          ) : (
            <Rocket size={18} color="#0B0B0B" />
          )}
          <Text style={styles.primaryButtonText}>
            {busy && stage !== 'rolling_back' ? 'Working…' : 'Approve & Deploy Latest Commit'}
          </Text>
        </Pressable>

        <View style={styles.statusCard} testID="ivx-deploy-status-card">
          <View style={styles.statusHeader}>
            <View style={[styles.statusDot, { backgroundColor: toneColor }]} />
            <Text style={styles.statusLabel}>{stageLabel(stage)}</Text>
          </View>
          {errorMessage ? (
            <View style={styles.errorBox}>
              <ShieldAlert size={14} color={Colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
          {deployResult ? (
            <View style={styles.proofBlock}>
              <Text style={styles.proofTitle}>Deploy proof</Text>
              <ProofRow label="Deploy id" value={deployResult.deploy?.id ?? '—'} />
              <ProofRow label="Status" value={deployResult.deploy?.status ?? '—'} />
              <ProofRow label="Commit" value={deployResult.deploy?.commitSha?.slice(0, 12) ?? '—'} />
              {deployResult.deploy?.commitMessage ? (
                <ProofRow label="Message" value={deployResult.deploy.commitMessage.slice(0, 80)} />
              ) : null}
              <ProofRow label="Polls" value={String(deployResult.deploy?.pollCount ?? 0)} />
              {deployResult.productionProbe ? (
                <>
                  <ProofRow label="Health URL" value={deployResult.productionProbe.baseUrl ?? '—'} />
                  <ProofRow
                    label="Health status"
                    value={`${deployResult.productionProbe.status ?? '—'} ${deployResult.productionProbe.ok ? 'OK' : 'FAIL'}`}
                  />
                  {deployResult.productionProbe.marker ? (
                    <ProofRow label="Marker" value={deployResult.productionProbe.marker} />
                  ) : null}
                </>
              ) : null}
              {deployResult.approvalProof ? (
                <ProofRow label="Owner" value={deployResult.approvalProof.ownerEmailMasked ?? '—'} />
              ) : null}
            </View>
          ) : null}
          {rollbackResult ? (
            <View style={styles.proofBlock}>
              <Text style={styles.proofTitle}>Rollback proof</Text>
              <ProofRow label="Target deploy" value={rollbackResult.result?.targetDeployId ?? '—'} />
              <ProofRow label="New deploy" value={rollbackResult.result?.newDeployId ?? '—'} />
              <ProofRow label="Reason" value={rollbackResult.result?.reason ?? '—'} />
              {rollbackResult.productionProbe ? (
                <ProofRow
                  label="Post-rollback health"
                  value={`${rollbackResult.productionProbe.status ?? '—'} ${rollbackResult.productionProbe.ok ? 'OK' : 'FAIL'}`}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={handleRollback}
          disabled={busy}
          style={[styles.secondaryButton, busy ? styles.secondaryButtonDisabled : null]}
          testID="ivx-deploy-rollback-button"
        >
          {stage === 'rolling_back' ? <ShimmerIndicator color={Colors.text} /> : <Undo2 size={16} color={Colors.text} />}
          <Text style={styles.secondaryButtonText}>One-tap Rollback</Text>
        </Pressable>

        <View style={styles.policyCard}>
          <Text style={styles.policyTitle}>Policy</Text>
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="Owner Supabase session required (attached automatically)." />
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="Render credentials read from backend runtime; never returned to client." />
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="Production /health verified after deploy reaches terminal status." />
          <PolicyRow icon={<RefreshCw size={14} color={Colors.info} />} text="Rollback targets the most recent successful previous Render deploy." />
          <PolicyRow icon={<ShieldAlert size={14} color={Colors.warning} />} text="Secrets, billing, payments, and DB schema still require explicit owner approval through their own gated routes." />
        </View>
      </ScrollView>
    </View>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.proofRow}>
      <Text style={styles.proofLabel}>{label}</Text>
      <Text style={styles.proofValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function PolicyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.policyRow}>
      {icon}
      <Text style={styles.policyText}>{text}</Text>
      <ChevronRight size={14} color={Colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },
  header: { gap: 8, marginTop: 8 },
  iconBadge: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center'},
  title: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: Colors.success, borderRadius: 14},
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#0B0B0B', fontSize: 15, fontWeight: '700' as const },
  statusCard: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14,
    padding: 14, backgroundColor: Colors.card, gap: 10},
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10,
    backgroundColor: `${Colors.error}14`,
    borderWidth: 1, borderColor: `${Colors.error}55`},
  errorText: { color: Colors.error, fontSize: 12, flex: 1 },
  proofBlock: { gap: 6, marginTop: 4 },
  proofTitle: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  proofRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  proofLabel: { color: Colors.textSecondary, fontSize: 12 },
  proofValue: { color: Colors.text, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), flexShrink: 1, textAlign: 'right' as const },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14,
    backgroundColor: Colors.card},
  secondaryButtonDisabled: { opacity: 0.5 },
  secondaryButtonText: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  policyCard: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14,
    padding: 14, backgroundColor: Colors.card, gap: 8},
  policyTitle: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  policyText: { color: Colors.text, fontSize: 12, flex: 1, lineHeight: 17 }});
