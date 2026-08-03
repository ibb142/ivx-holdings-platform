/**
 * IVX Owner — One-tap Sync to GitHub.
 *
 * Pushes the latest backend working tree to the owner-controlled GitHub repo
 * via the owner-only autonomy route (`POST /api/ivx/autonomy/github/sync`).
 * The GitHub token lives server-side and is never exposed to the client.
 *
 * Flow:
 *  - "Preview changes" runs a dry-run (no push) and lists what would change.
 *  - "Push to GitHub" performs the real push, then re-reads the branch ref and
 *    returns the verified commit hash + GitHub commit URL as proof.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from 'expo-router';
import { CheckCircle2, ChevronRight, Eye, GitBranch, Github, Rocket, ShieldAlert, UploadCloud } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const API_BASE = ((process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.ivxholding.com') as string).replace(/\/$/, '');

type SyncStage =
  | 'idle'
  | 'previewing'
  | 'preview_ready'
  | 'pushing'
  | 'pushed'
  | 'no_changes'
  | 'failed'
  | 'error';

type DeployProofStage = 'idle' | 'running' | 'verified' | 'partial' | 'failed';

/** Full delivery-chain proof from POST /api/ivx/admin/sync-github. */
type DeployProofResponse = {
  SYNC_HTTP_STATUS?: number;
  GITHUB_PUSHED?: string;
  GITHUB_HEAD_SHA?: string | null;
  GITHUB_COMMIT_URL?: string | null;
  RENDER_DEPLOY_TRIGGERED?: string;
  RENDER_DEPLOY_ID?: string | null;
  RENDER_STATUS?: string | null;
  HEALTH_HTTP_STATUS?: number;
  PRODUCTION_HEALTH_SHA?: string | null;
  MATCH_GITHUB_TO_HEALTH?: string;
  FINAL_STATUS?: string;
  FAILED_AT?: string;
  RAW_ERROR?: string;
  MISSING_ENV?: string[];
  NEXT_OWNER_ACTION?: string;
};

type GithubSyncResponse = {
  ok: boolean;
  stage?: string;
  syncStatus?: string;
  repoUrl?: string;
  branch?: string;
  previousCommit?: string | null;
  pushedCommit?: string | null;
  mode?: 'apply' | 'dry_run';
  approvalProof?: {
    ownerEmailMasked: string | null;
    approvedAt: string;
    mechanism: string;
  };
  verificationProof?: {
    commitUrl?: string | null;
    scriptExitCode?: number;
    scriptStdoutTail?: string;
    commitDetail?: {
      sha: string;
      message: string | null;
      author: string | null;
      committedAt: string | null;
    } | null;
  };
  error?: string;
  hint?: string;
};

async function getOwnerBearer(): Promise<string | null> {
  try {
    const result = await supabase.auth.getSession();
    const token = result.data?.session?.access_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (err) {
    console.log('[ivx-github-sync] session read failed', err instanceof Error ? err.message : String(err));
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
      { text: 'Push', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function stageLabel(stage: SyncStage): string {
  if (stage === 'previewing') return 'Scanning working tree (dry-run)…';
  if (stage === 'preview_ready') return 'Preview ready — review then push';
  if (stage === 'pushing') return 'Pushing to GitHub & verifying commit…';
  if (stage === 'pushed') return 'Pushed & verified on GitHub';
  if (stage === 'no_changes') return 'Already in sync — nothing to push';
  if (stage === 'failed') return 'Sync failed';
  if (stage === 'error') return 'Request failed';
  return 'Idle';
}

function stageTone(stage: SyncStage): 'success' | 'warning' | 'error' | 'neutral' {
  if (stage === 'pushed' || stage === 'no_changes') return 'success';
  if (stage === 'preview_ready') return 'warning';
  if (stage === 'failed' || stage === 'error') return 'error';
  return 'neutral';
}

export default function IVXGithubSyncScreen() {
  const [stage, setStage] = useState<SyncStage>('idle');
  const [result, setResult] = useState<GithubSyncResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deployStage, setDeployStage] = useState<DeployProofStage>('idle');
  const [deployResult, setDeployResult] = useState<DeployProofResponse | null>(null);

  const screenOptions = useMemo(() => ({ title: 'Sync to GitHub' }), []);

  const runSync = useCallback(async (apply: boolean) => {
    if (apply) {
      const proceed = await confirm(
        'Push the latest code to your GitHub repo?',
        'This commits the current backend working tree to your owner-controlled GitHub repository on the configured branch. The GitHub token stays on the server and is never exposed. You can review the pushed commit hash right after.',
      );
      if (!proceed) return;
    }

    setStage(apply ? 'pushing' : 'previewing');
    setErrorMessage(null);
    setResult(null);

    const bearer = await getOwnerBearer();
    if (!bearer) {
      setStage('error');
      setErrorMessage('No signed-in owner session detected. Sign in with the owner account, then try again.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ivx/autonomy/github/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({
          apply,
          message: apply
            ? `sync: owner push from IVX app ${new Date().toISOString()}`
            : undefined,
          timeoutMs: 5 * 60_000})});
      const json = await response.json().catch(() => ({})) as GithubSyncResponse;
      setResult(json);

      if (!response.ok || json.ok === false) {
        setStage('failed');
        setErrorMessage(json.error ?? json.hint ?? `HTTP ${response.status}`);
        return;
      }

      if (!apply) {
        setStage('preview_ready');
        return;
      }

      const status = (json.syncStatus ?? '').toLowerCase();
      if (status === 'pushed') setStage('pushed');
      else if (status === 'no_changes') setStage('no_changes');
      else setStage('pushed');
    } catch (err) {
      setStage('error');
      setErrorMessage(err instanceof Error ? err.message : 'network_error');
    }
  }, []);

  const runDeployProof = useCallback(async () => {
    const proceed = await confirm(
      'Run full sync + deploy proof?',
      'This pushes the current code to your GitHub repo, triggers a Render deploy, then polls the live /health endpoint and compares its build SHA to GitHub HEAD. The result shows the verified GitHub SHA, commit link, Render deploy ID, health SHA, and match status.',
    );
    if (!proceed) return;

    setDeployStage('running');
    setDeployResult(null);

    const bearer = await getOwnerBearer();
    if (!bearer) {
      setDeployStage('failed');
      setDeployResult({
        FINAL_STATUS: 'FAILED',
        FAILED_AT: 'owner_session',
        RAW_ERROR: 'No signed-in owner session detected. Sign in with the owner account, then try again.',
        NEXT_OWNER_ACTION: 'Sign in with the owner account and retry.'});
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ivx/admin/sync-github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({
          message: `sync: owner-approved full sync + deploy proof from IVX app ${new Date().toISOString()}`,
          timeoutMs: 5 * 60_000})});
      const json = await response.json().catch(() => ({})) as DeployProofResponse;
      setDeployResult(json);
      const final = (json.FINAL_STATUS ?? '').toUpperCase();
      if (final.startsWith('VERIFIED')) setDeployStage('verified');
      else if (final === 'PARTIAL') setDeployStage('partial');
      else setDeployStage('failed');
    } catch (err) {
      setDeployStage('failed');
      setDeployResult({
        FINAL_STATUS: 'FAILED',
        FAILED_AT: 'request',
        RAW_ERROR: err instanceof Error ? err.message : 'network_error',
        NEXT_OWNER_ACTION: 'Check connectivity to the IVX backend and retry.'});
    }
  }, []);

  const openDeployCommit = useCallback(() => {
    const url = deployResult?.GITHUB_COMMIT_URL;
    if (url) Linking.openURL(url).catch(() => {});
  }, [deployResult]);

  const openCommit = useCallback(() => {
    const url = result?.verificationProof?.commitUrl;
    if (url) Linking.openURL(url).catch(() => {});
  }, [result]);

  const busy = stage === 'previewing' || stage === 'pushing';
  const deployBusy = deployStage === 'running';
  const deployTone =
    deployStage === 'verified' ? Colors.success
      : deployStage === 'partial' ? Colors.warning
        : deployStage === 'failed' ? Colors.error
          : Colors.info;
  const deployStatusLabel =
    deployStage === 'running' ? 'Pushing → deploying → verifying /health…'
      : deployStage === 'verified' ? 'Verified live — GitHub → Render complete'
        : deployStage === 'partial' ? 'Pushed & deploying — /health not matched yet'
          : deployStage === 'failed' ? 'Full sync + deploy proof failed'
            : 'Not run yet';
  const tone = stageTone(stage);
  const toneColor =
    tone === 'success' ? Colors.success
      : tone === 'warning' ? Colors.warning
        : tone === 'error' ? Colors.error
          : Colors.info;
  const stdoutTail = result?.verificationProof?.scriptStdoutTail ?? null;

  return (
    <View style={styles.root} testID="ivx-github-sync-screen">
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: `${Colors.text}14`, borderColor: Colors.border }]}>
            <Github size={22} color={Colors.text} />
          </View>
          <Text style={styles.title}>Sync to GitHub</Text>
          <Text style={styles.subtitle}>
            Push the latest IVX code to your own GitHub repository. The GitHub token lives on your server and is never exposed to this app. Preview the changes first, then push — you get the verified commit hash and a link to the commit as proof.
          </Text>
        </View>

        <Pressable
          onPress={() => runSync(false)}
          disabled={busy}
          style={[styles.secondaryButton, busy ? styles.secondaryButtonDisabled : null]}
          testID="ivx-github-sync-preview-button"
        >
          {stage === 'previewing' ? <ShimmerIndicator color={Colors.text} /> : <Eye size={16} color={Colors.text} />}
          <Text style={styles.secondaryButtonText}>Preview changes (dry-run)</Text>
        </Pressable>

        <Pressable
          onPress={() => runSync(true)}
          disabled={busy}
          style={[styles.primaryButton, busy ? styles.primaryButtonDisabled : null]}
          testID="ivx-github-sync-push-button"
        >
          {stage === 'pushing' ? <ShimmerIndicator color="#0B0B0B" /> : <UploadCloud size={18} color="#0B0B0B" />}
          <Text style={styles.primaryButtonText}>
            {stage === 'pushing' ? 'Pushing…' : 'Push to GitHub now'}
          </Text>
        </Pressable>

        <Pressable
          onPress={runDeployProof}
          disabled={deployBusy || busy}
          style={[styles.deployButton, (deployBusy || busy) ? styles.primaryButtonDisabled : null]}
          testID="ivx-github-sync-deploy-proof-button"
        >
          {deployStage === 'running' ? <ShimmerIndicator color="#FFFFFF" /> : <Rocket size={18} color="#FFFFFF" />}
          <Text style={styles.deployButtonText}>
            {deployStage === 'running' ? 'Running full proof…' : 'Run Full Sync + Deploy Proof'}
          </Text>
        </Pressable>

        {deployStage !== 'idle' ? (
          <View style={styles.statusCard} testID="ivx-github-sync-deploy-card">
            <View style={styles.statusHeader}>
              <View style={[styles.statusDot, { backgroundColor: deployTone }]} />
              <Text style={styles.statusLabel}>{deployStatusLabel}</Text>
            </View>

            {deployResult ? (
              <View style={styles.proofBlock}>
                <Text style={styles.proofTitle}>Delivery chain proof</Text>
                <ProofRow label="GitHub pushed" value={deployResult.GITHUB_PUSHED ?? '—'} />
                <ProofRow label="GitHub SHA" value={deployResult.GITHUB_HEAD_SHA?.slice(0, 12) ?? '—'} />
                <ProofRow label="Render deploy" value={deployResult.RENDER_DEPLOY_TRIGGERED ?? '—'} />
                <ProofRow label="Render ID" value={deployResult.RENDER_DEPLOY_ID ?? '—'} />
                <ProofRow label="Render status" value={deployResult.RENDER_STATUS ?? '—'} />
                <ProofRow label="Health HTTP" value={deployResult.HEALTH_HTTP_STATUS ? String(deployResult.HEALTH_HTTP_STATUS) : '—'} />
                <ProofRow label="Health SHA" value={deployResult.PRODUCTION_HEALTH_SHA?.slice(0, 12) ?? '—'} />
                <ProofRow label="Match" value={deployResult.MATCH_GITHUB_TO_HEALTH ?? '—'} />
                <ProofRow label="Final" value={deployResult.FINAL_STATUS ?? '—'} />
                {deployResult.FAILED_AT ? <ProofRow label="Failed at" value={deployResult.FAILED_AT} /> : null}
                {deployResult.MISSING_ENV && deployResult.MISSING_ENV.length > 0 ? (
                  <ProofRow label="Missing env" value={deployResult.MISSING_ENV.join(', ')} />
                ) : null}
              </View>
            ) : null}

            {deployResult?.RAW_ERROR ? (
              <View style={styles.errorBox}>
                <ShieldAlert size={14} color={Colors.error} />
                <Text style={styles.errorText}>{deployResult.RAW_ERROR}</Text>
              </View>
            ) : null}

            {deployResult?.NEXT_OWNER_ACTION ? (
              <Text style={styles.nextActionText}>Next: {deployResult.NEXT_OWNER_ACTION}</Text>
            ) : null}

            {deployResult?.GITHUB_COMMIT_URL ? (
              <Pressable onPress={openDeployCommit} style={styles.linkButton} testID="ivx-github-sync-deploy-open-commit">
                <GitBranch size={14} color={Colors.info} />
                <Text style={styles.linkText} numberOfLines={1}>View commit on GitHub</Text>
                <ChevronRight size={14} color={Colors.info} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.statusCard} testID="ivx-github-sync-status-card">
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

          {result ? (
            <View style={styles.proofBlock}>
              <Text style={styles.proofTitle}>{result.mode === 'apply' ? 'Push proof' : 'Preview'}</Text>
              <ProofRow label="Repo" value={(result.repoUrl ?? '—').replace('https://github.com/', '')} />
              <ProofRow label="Branch" value={result.branch ?? '—'} />
              <ProofRow label="Previous" value={result.previousCommit?.slice(0, 12) ?? '—'} />
              <ProofRow label="Pushed" value={result.pushedCommit?.slice(0, 12) ?? '—'} />
              <ProofRow label="Status" value={result.syncStatus ?? result.stage ?? '—'} />
              {result.verificationProof?.commitDetail?.message ? (
                <ProofRow label="Message" value={result.verificationProof.commitDetail.message.slice(0, 80)} />
              ) : null}
              {result.verificationProof?.commitDetail?.committedAt ? (
                <ProofRow label="Committed" value={result.verificationProof.commitDetail.committedAt} />
              ) : null}
              {result.approvalProof ? (
                <ProofRow label="Owner" value={result.approvalProof.ownerEmailMasked ?? '—'} />
              ) : null}
            </View>
          ) : null}

          {result?.verificationProof?.commitUrl ? (
            <Pressable onPress={openCommit} style={styles.linkButton} testID="ivx-github-sync-open-commit">
              <GitBranch size={14} color={Colors.info} />
              <Text style={styles.linkText} numberOfLines={1}>View commit on GitHub</Text>
              <ChevronRight size={14} color={Colors.info} />
            </Pressable>
          ) : null}

          {stdoutTail ? (
            <View style={styles.logBox}>
              <Text style={styles.logTitle}>Sync log (tail)</Text>
              <Text style={styles.logText}>{stdoutTail}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.policyCard}>
          <Text style={styles.policyTitle}>Policy</Text>
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="Owner Supabase session required (attached automatically)." />
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="GitHub token read from backend runtime; never returned to this app." />
          <PolicyRow icon={<CheckCircle2 size={14} color={Colors.success} />} text="Pushed commit hash is re-read from GitHub and shown as proof." />
          <PolicyRow icon={<Eye size={14} color={Colors.info} />} text="Preview (dry-run) lists changes without pushing anything." />
          <PolicyRow icon={<ShieldAlert size={14} color={Colors.warning} />} text="Secrets, .env files, and large binaries are excluded from every push." />
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
  deployButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: Colors.info, borderRadius: 14},
  deployButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' as const },
  nextActionText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
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
  linkButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: `${Colors.info}14`, borderWidth: 1, borderColor: `${Colors.info}55`},
  linkText: { color: Colors.info, fontSize: 13, fontWeight: '600' as const, flex: 1 },
  logBox: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    padding: 10, backgroundColor: Colors.background, gap: 6},
  logTitle: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  logText: { color: Colors.textSecondary, fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), lineHeight: 16 },
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
