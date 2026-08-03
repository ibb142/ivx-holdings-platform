import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowLeft,
  Beaker,
  Bug,
  CheckCircle2,
  ClipboardList,
  Code2,
  Copy,
  Cpu,
  Database,
  FileCode,
  FileText,
  Filter,
  GitBranch,
  GitPullRequestArrow,
  History,
  Plus,
  Rocket,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  XCircle} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  cancelPendingAIReply,
  requestAIReply} from '@/src/modules/chat/services/aiReplyService';
import { recordIVXOwnerChatAuditEvent } from '@/src/modules/ivx-owner-ai/services';
import { proposeAction as proposeApprovedAction } from '@/src/modules/ivx-developer/developerApprovedActionsService';
import {
  auditSeniorDeveloperProductionReadiness,
  runOwnerApprovedSeniorDeveloperProduction,
  type IVXSeniorDeveloperCredentialAuditResponse,
  type IVXSeniorDeveloperRiskLevel,
  type IVXSeniorDeveloperRunResponse} from '@/src/modules/ivx-developer/seniorDeveloperApprovalService';
import {
  gatherSeniorDeveloperPreflight,
  gatherOwnerProofGate,
  type OwnerProofGate,
  type SeniorDeveloperPreflight} from '@/src/modules/ivx-developer/seniorDeveloperPreflightService';
import { getIVXRuntimeInfo, type IVXRuntimeInfo } from '@/lib/runtime-environment';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  BLOCK18_DEVELOPER_WORKSPACE_MARKER,
  PATCH_REPLY_FORMAT_INSTRUCTION,
  PROJECT_FILE_REGISTRY,
  type DeveloperActionLog,
  type PatchProposal,
  type PatchStatus,
  type ProjectFileEntry,
  type ProjectFileKind,
  type SafetyFinding,
  createPatch,
  deletePatch,
  listDeveloperActions,
  listPatches,
  logDeveloperAction,
  sanitizeForDisplay,
  scanForSafetyIssues,
  tryParseAIPatchReply,
  updatePatchStatus} from '@/src/modules/ivx-developer/developerWorkspaceService';

const WORKSPACE_CONVERSATION_ID = 'ivx-owner-ai-developer-workspace';

type TabId = 'approve' | 'files' | 'assistant' | 'patches' | 'tests';

type AssistantMode = 'review_code' | 'debug_bug' | 'plan_feature' | 'propose_patch' | 'analyze_error';

const ASSISTANT_MODES: readonly {
  id: AssistantMode;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}[] = [
  { id: 'review_code', label: 'Review', hint: 'Senior code review', icon: FileCode },
  { id: 'debug_bug', label: 'Debug', hint: 'Root cause + minimal patch', icon: Bug },
  { id: 'plan_feature', label: 'Plan', hint: 'Crash-safe additive plan', icon: ClipboardList },
  { id: 'propose_patch', label: 'Patch', hint: 'Tagged diff for approval', icon: GitPullRequestArrow },
  { id: 'analyze_error', label: 'Analyze', hint: 'Test/build failure triage', icon: Beaker },
];

function buildAssistantPrompt(
  mode: AssistantMode,
  input: string,
  attachedFile: ProjectFileEntry | null,
): string {
  const fileContext = attachedFile
    ? `\n\n--- ATTACHED FILE CONTEXT ---\npath: ${attachedFile.path}\nkind: ${attachedFile.kind}\ncategory: ${attachedFile.category}\ntitle: ${attachedFile.title}\nsummary: ${attachedFile.summary}\ntags: ${attachedFile.tags.join(', ')}`
    : '';
  const baseGuard = [
    'Act as the IVX senior developer assistant operating inside the owner-only Code Developer Workspace.',
    'Hard rules: do NOT silently modify production code; never expose real secret values; never propose destructive ops without an explicit confirmation note; keep changes additive and crash-safe.',
    'The live ChatGPT path (POST /api/public/chat returning source=chatgpt) and Block 17 sessions/history MUST keep working.',
  ].join('\n');
  const modeBlock = (() => {
    switch (mode) {
      case 'review_code':
        return 'Mode: REVIEW. Reply with: 1) verdict, 2) numbered fixes (path-style), 3) suggested next test.';
      case 'debug_bug':
        return 'Mode: DEBUG. Reply with: 1) hypothesis, 2) evidence to confirm, 3) minimal patch outline, 4) regression risk.';
      case 'plan_feature':
        return 'Mode: PLAN. Reply with: 1) goal, 2) numbered file-by-file changes, 3) validation per block, 4) rollback note.';
      case 'propose_patch':
        return [
          'Mode: PROPOSE PATCH.',
          PATCH_REPLY_FORMAT_INSTRUCTION,
        ].join('\n');
      case 'analyze_error':
        return 'Mode: ANALYZE ERROR. Reply with: 1) likely cause, 2) safest fix, 3) verification command, 4) rollback note.';
    }
  })();
  return [baseGuard, modeBlock, fileContext, '\n--- OWNER INPUT ---', input].join('\n');
}

const KIND_LABEL: Record<ProjectFileKind, string> = {
  route: 'Route',
  screen: 'Screen',
  service: 'Service',
  module: 'Module',
  backend: 'Backend',
  migration: 'Migration',
  config: 'Config',
  doc: 'Doc'};

const PATCH_STATUS_COLOR: Record<PatchStatus, string> = {
  proposed: Colors.warning,
  approved: Colors.blue,
  applied: Colors.green,
  failed: Colors.error,
  rejected: Colors.textTertiary};

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'success'; answer: string; model: string; source: string; ms: number; mode: AssistantMode }
  | { kind: 'error'; message: string };

export default function IVXDeveloperWorkspaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ seniorGoal?: string; seniorPlan?: string; seniorSource?: string }>();
  const [tab, setTab] = useState<TabId>('approve');

  // Files tab
  const [search, setSearch] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<ProjectFileKind | 'all'>('all');
  const [selectedFile, setSelectedFile] = useState<ProjectFileEntry | null>(null);

  // Assistant tab
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('review_code');
  const [assistantInput, setAssistantInput] = useState<string>('');
  const [assistantRun, setAssistantRun] = useState<RunState>({ kind: 'idle' });
  const [attachedFile, setAttachedFile] = useState<ProjectFileEntry | null>(null);
  const [safetyFindings, setSafetyFindings] = useState<SafetyFinding[]>([]);

  // Patches tab
  const [patches, setPatches] = useState<PatchProposal[]>([]);
  const [actions, setActions] = useState<DeveloperActionLog[]>([]);
  const [patchesLoading, setPatchesLoading] = useState<boolean>(false);

  // Owner-approved senior developer production flow
  const [seniorGoal, setSeniorGoal] = useState<string>('Act as IVX senior developer: apply the approved safe patch, commit to GitHub, trigger Render deploy, and verify production health.');
  const [seniorProposedPlan, setSeniorProposedPlan] = useState<string>('1. Inspect the selected approved patch and current backend runtime state.\n2. Apply only the safe owner-approved code change.\n3. Run focused validation.\n4. Commit changed files to GitHub.\n5. Trigger Render deploy.\n6. Verify production /health and changed route.');
  const [seniorFilesText, setSeniorFilesText] = useState<string>('backend/services/agents/multi-agent-framework.ts');
  const [seniorRiskLevel, setSeniorRiskLevel] = useState<IVXSeniorDeveloperRiskLevel>('medium');
  const [seniorRollbackOption, setSeniorRollbackOption] = useState<string>('Rollback by reverting the returned GitHub commit hash, then trigger a Render redeploy of the previous known-good commit.');
  const [seniorAudit, setSeniorAudit] = useState<IVXSeniorDeveloperCredentialAuditResponse | null>(null);
  const [seniorRun, setSeniorRun] = useState<IVXSeniorDeveloperRunResponse | null>(null);
  const [seniorError, setSeniorError] = useState<string | null>(null);
  const [seniorAuditLoading, setSeniorAuditLoading] = useState<boolean>(false);
  const [seniorRunLoading, setSeniorRunLoading] = useState<boolean>(false);
  const [seniorPreflight, setSeniorPreflight] = useState<SeniorDeveloperPreflight | null>(null);
  const [seniorPreflightLoading, setSeniorPreflightLoading] = useState<boolean>(false);

  // Prefill the Senior Developer task from a daily-report "Send to Senior Dev" hand-off.
  useEffect(() => {
    const goal = typeof params.seniorGoal === 'string' ? params.seniorGoal.trim() : '';
    const plan = typeof params.seniorPlan === 'string' ? params.seniorPlan.trim() : '';
    if (!goal && !plan) return;
    if (goal) setSeniorGoal(goal);
    if (plan) setSeniorProposedPlan(plan);
    setSeniorRiskLevel('low');
  }, [params.seniorGoal, params.seniorPlan]);

  // Expo Go / dev-runtime owner-proof gate
  const runtimeInfo = useMemo<IVXRuntimeInfo>(() => getIVXRuntimeInfo(), []);
  const [ownerProofGate, setOwnerProofGate] = useState<OwnerProofGate | null>(null);
  const [ownerProofGateLoading, setOwnerProofGateLoading] = useState<boolean>(false);

  const seniorFilesAffected = useMemo<string[]>(() => {
    return Array.from(new Set(seniorFilesText
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean)));
  }, [seniorFilesText]);

  const seniorApprovedActionSummary = useMemo<string>(() => {
    return [
      'Proposed plan:',
      seniorProposedPlan.trim() || '(missing)',
      '',
      `Files affected: ${seniorFilesAffected.length > 0 ? seniorFilesAffected.join(', ') : '(missing)'}`,
      `Risk level: ${seniorRiskLevel}`,
      `Rollback option: ${seniorRollbackOption.trim() || '(missing)'}`,
    ].join('\n');
  }, [seniorFilesAffected, seniorProposedPlan, seniorRiskLevel, seniorRollbackOption]);

  // ---------- Senior Developer run gate ----------
  // The run is only enabled when EVERY owner-proof condition passes:
  // owner session present, token valid, owner email allowlisted, GitHub ready, Render audited.
  const seniorOwnerSessionReady = seniorPreflight?.readyToRun === true;
  const seniorGithubReady = seniorAudit?.audit?.github?.canPush === true;
  const seniorRenderReady = seniorAudit?.audit?.render?.canDeploy === true;
  const seniorRunGateReady = seniorOwnerSessionReady && seniorGithubReady && seniorRenderReady;

  /** Precise, non-secret reason the run is gated, or null when ready to run. */
  const seniorRunGateReason = useMemo<string | null>(() => {
    if (!seniorPreflight || !seniorPreflight.ownerSessionPresent) {
      return 'Sign in as the IVX owner before running a Senior Developer task.';
    }
    if (!seniorPreflight.readyToRun) {
      return seniorPreflight.blockReason ?? 'Owner session is not valid for a Senior Developer run.';
    }
    if (!seniorAudit) {
      return 'Run "Audit owner + credentials" to confirm GitHub is ready and Render is audited.';
    }
    if (!seniorGithubReady) {
      return 'GitHub is not ready to push. Resolve the credential audit before running.';
    }
    if (!seniorRenderReady) {
      return 'Render is not audited/ready to deploy. Resolve the credential audit before running.';
    }
    return null;
  }, [seniorPreflight, seniorAudit, seniorGithubReady, seniorRenderReady]);

  const refreshPatches = useCallback(async () => {
    setPatchesLoading(true);
    try {
      const [p, a] = await Promise.all([listPatches(), listDeveloperActions()]);
      setPatches(p);
      setActions(a);
    } finally {
      setPatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPatches();
  }, [refreshPatches]);

  const onCheckSeniorDeveloperPreflight = useCallback(async (): Promise<SeniorDeveloperPreflight> => {
    setSeniorPreflightLoading(true);
    try {
      const preflight = await gatherSeniorDeveloperPreflight();
      setSeniorPreflight(preflight);
      await logDeveloperAction({
        actor: 'owner',
        action: 'senior_developer_preflight_check',
        detail: `ready=${preflight.readyToRun} session=${preflight.ownerSessionPresent} segs=${preflight.tokenSegmentCount} jwt=${preflight.tokenLooksLikeSupabaseJwt} allow=${preflight.ownerEmailAllowlisted}`});
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(preflight.readyToRun ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      }
      return preflight;
    } finally {
      setSeniorPreflightLoading(false);
    }
  }, []);

  // Detect the logged-in Supabase owner session on mount so the run gate reflects
  // owner-session / token / allowlist state immediately (before any run attempt).
  // Owner sign-in is manual only; no automatic credential use.
  useEffect(() => {
    void onCheckSeniorDeveloperPreflight();
  }, [onCheckSeniorDeveloperPreflight]);

  // ---------- Files tab logic ----------
  const filteredFiles = useMemo<ProjectFileEntry[]>(() => {
    const q = search.trim().toLowerCase();
    return PROJECT_FILE_REGISTRY.filter((f) => {
      if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
      if (!q) return true;
      const hay = `${f.path} ${f.title} ${f.summary} ${f.category} ${f.tags.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [search, kindFilter]);

  const filesByCategory = useMemo<{ category: string; items: ProjectFileEntry[] }[]>(() => {
    const map = new Map<string, ProjectFileEntry[]>();
    for (const f of filteredFiles) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
  }, [filteredFiles]);

  const onSelectFile = useCallback(
    (file: ProjectFileEntry) => {
      setSelectedFile(file);
      void logDeveloperAction({
        actor: 'owner',
        action: 'file_inspected',
        detail: `${file.path} (${file.kind})`});
    },
    [],
  );

  const onAskAboutFile = useCallback(
    (file: ProjectFileEntry) => {
      setAttachedFile(file);
      setTab('assistant');
      setAssistantInput((prev) =>
        prev.length > 0 ? prev : `Explain ${file.path} and how to safely change it.`,
      );
    },
    [],
  );

  // ---------- Assistant tab logic ----------
  const onAssistantInputChange = useCallback((value: string) => {
    setAssistantInput(value);
    setSafetyFindings(scanForSafetyIssues(value));
  }, []);

  const onCopy = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    } catch (err) {
      console.log('[IVXDeveloperWorkspace] copy failed:', (err as Error)?.message);
    }
  }, []);

  const onRunAssistant = useCallback(async () => {
    const trimmed = assistantInput.trim();
    if (!trimmed || assistantRun.kind === 'running') return;

    const findings = scanForSafetyIssues(trimmed);
    if (findings.some((f) => f.kind === 'secret')) {
      Alert.alert(
        'Secret blocked',
        'Your input contains a value that looks like a real API key or token. Redact it before sending.',
      );
      void logDeveloperAction({
        actor: 'system',
        action: 'safety_block_secret',
        detail: findings.map((f) => f.name).join(', ')});
      return;
    }
    if (findings.some((f) => f.kind === 'destructive')) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Destructive operation detected',
          `Found: ${findings
            .filter((f) => f.kind === 'destructive')
            .map((f) => f.name)
            .join(', ')}\n\nContinue anyway? IVX IA will be told to refuse silent execution.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) {
        void logDeveloperAction({
          actor: 'owner',
          action: 'destructive_canceled',
          detail: findings.map((f) => f.name).join(', ')});
        return;
      }
    }

    const prompt = buildAssistantPrompt(assistantMode, trimmed, attachedFile);
    const startedAt = Date.now();
    setAssistantRun({ kind: 'running' });

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }

    void recordIVXOwnerChatAuditEvent({
      action: 'developer_workspace_prompt',
      conversationId: WORKSPACE_CONVERSATION_ID,
      status: 'started',
      summary: `dev workspace prompt: ${assistantMode}`,
      metadata: {
        mode: assistantMode,
        block: BLOCK18_DEVELOPER_WORKSPACE_MARKER,
        inputLength: trimmed.length,
        attachedFile: attachedFile?.path ?? null}}).catch(() => undefined);

    try {
      const result = await requestAIReply(
        prompt,
        WORKSPACE_CONVERSATION_ID,
        'IVX Owner Developer Workspace',
      );
      const elapsed = Date.now() - startedAt;
      setAssistantRun({
        kind: 'success',
        answer: sanitizeForDisplay(result.answer),
        model: result.model,
        source: result.source,
        ms: elapsed,
        mode: assistantMode});
      void recordIVXOwnerChatAuditEvent({
        action: 'developer_workspace_response',
        conversationId: WORKSPACE_CONVERSATION_ID,
        status: 'success',
        summary: `dev workspace response: ${assistantMode} (${result.source})`,
        metadata: {
          mode: assistantMode,
          block: BLOCK18_DEVELOPER_WORKSPACE_MARKER,
          model: result.model,
          source: result.source,
          ms: elapsed,
          answerLength: result.answer.length}}).catch(() => undefined);

      if (assistantMode === 'propose_patch') {
        const parsed = tryParseAIPatchReply(result.answer);
        if (parsed) {
          const patch = await createPatch(parsed);
          await refreshPatches();
          Alert.alert(
            'Patch proposal saved',
            `${patch.filePath}\nrisk=${patch.riskLevel}${patch.destructive ? ' · destructive' : ''}\n\nReview and approve in the Patches tab before any apply.`,
          );
        }
      }
    } catch (err) {
      const message = (err as Error)?.message ?? 'Request failed';
      setAssistantRun({ kind: 'error', message });
      void recordIVXOwnerChatAuditEvent({
        action: 'developer_workspace_error',
        conversationId: WORKSPACE_CONVERSATION_ID,
        status: 'failed',
        summary: `dev workspace error: ${assistantMode}`,
        metadata: {
          mode: assistantMode,
          block: BLOCK18_DEVELOPER_WORKSPACE_MARKER,
          error: message.slice(0, 240)}}).catch(() => undefined);
    }
  }, [assistantInput, assistantMode, assistantRun.kind, attachedFile, refreshPatches]);

  const onCancelAssistant = useCallback(() => {
    cancelPendingAIReply(WORKSPACE_CONVERSATION_ID, 'workspace_user_cancel');
    setAssistantRun({ kind: 'idle' });
  }, []);

  // ---------- Patches tab actions ----------
  const onApprovePatch = useCallback(
    async (patch: PatchProposal) => {
      const confirmTitle = patch.destructive ? 'Approve destructive patch?' : 'Approve patch?';
      const confirmMsg = patch.destructive
        ? `${patch.filePath}\n\nThis patch was flagged as destructive. Type confirm by tapping the destructive button.`
        : `${patch.filePath}\n\nMark as approved? Apply still requires a separate explicit step.`;
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(confirmTitle, confirmMsg, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: patch.destructive ? 'Approve destructive' : 'Approve',
            style: patch.destructive ? 'destructive' : 'default',
            onPress: () => resolve(true)},
        ]);
      });
      if (!ok) return;
      await updatePatchStatus(patch.id, 'approved', { approver: 'owner' });
      await refreshPatches();
    },
    [refreshPatches],
  );

  const onRejectPatch = useCallback(
    async (patch: PatchProposal) => {
      await updatePatchStatus(patch.id, 'rejected');
      await refreshPatches();
    },
    [refreshPatches],
  );

  const onMarkApplied = useCallback(
    async (patch: PatchProposal) => {
      Alert.alert(
        'Mark patch as applied?',
        `${patch.filePath}\n\nOnly mark applied AFTER you have manually applied the diff and verified runChecks/tests.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark applied',
            onPress: async () => {
              await updatePatchStatus(patch.id, 'applied');
              await refreshPatches();
            }},
          {
            text: 'Mark failed',
            style: 'destructive',
            onPress: async () => {
              await updatePatchStatus(patch.id, 'failed', { failedReason: 'owner_marked_failed' });
              await refreshPatches();
            }},
        ],
      );
    },
    [refreshPatches],
  );

  const onPromoteToGithub = useCallback(
    async (patch: PatchProposal) => {
      try {
        const action = await proposeApprovedAction({
          kind: 'github_commit',
          commitMessage: `chore(ivx): apply approved patch ${patch.filePath}`,
          files: [patch.filePath],
          patchIds: [patch.id],
          reason: `Promoted from workspace patch ${patch.id} :: ${patch.reason.slice(0, 200)}`});
        await logDeveloperAction({
          actor: 'owner',
          action: 'promote_patch_to_github_commit',
          detail: `${patch.filePath} -> approved-action ${action.id} (status=${action.status})`});
        Alert.alert(
          'Promoted to Block 21',
          `Proposed GitHub commit action ${action.id} for ${patch.filePath}.\n\nOpen Approved Developer Actions to review and approve. Nothing is committed without explicit owner approval.`,
          [
            { text: 'Stay here', style: 'cancel' },
            {
              text: 'Open Approved Actions',
              onPress: () => router.push('/admin/ivx-developer-actions' as any)},
          ],
        );
      } catch (err) {
        Alert.alert('Promote failed', (err as Error)?.message ?? 'Unknown error.');
      }
    },
    [router],
  );

  const onDeletePatch = useCallback(
    async (patch: PatchProposal) => {
      Alert.alert('Delete patch?', patch.filePath, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePatch(patch.id);
            await refreshPatches();
          }},
      ]);
    },
    [refreshPatches],
  );

  const onAuditSeniorDeveloperReadiness = useCallback(async () => {
    setSeniorAuditLoading(true);
    setSeniorError(null);
    try {
      const audit = await auditSeniorDeveloperProductionReadiness();
      setSeniorAudit(audit);
      await logDeveloperAction({
        actor: 'owner',
        action: 'senior_developer_credential_audit',
        detail: `ok=${audit.ok} github=${audit.audit?.github?.canPush === true} render=${audit.audit?.render?.canDeploy === true}`});
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(audit.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      }
    } catch (err) {
      const error = err as Error & { payload?: IVXSeniorDeveloperCredentialAuditResponse };
      const payload = error.payload;
      if (payload) {
        setSeniorAudit(payload);
      }
      const message = payload?.exactBlocker || payload?.error || error.message || 'Senior developer audit failed.';
      setSeniorError(message);
      await logDeveloperAction({ actor: 'system', action: 'senior_developer_credential_audit_failed', detail: message.slice(0, 240) });
    } finally {
      setSeniorAuditLoading(false);
    }
  }, []);

  const onCheckOwnerProofGate = useCallback(async (): Promise<OwnerProofGate> => {
    setOwnerProofGateLoading(true);
    try {
      const gate = await gatherOwnerProofGate();
      setOwnerProofGate(gate);
      setSeniorPreflight(gate.preflight);
      await logDeveloperAction({
        actor: 'owner',
        action: 'owner_proof_gate_check',
        detail: `status=${gate.status} access=${gate.accessGranted} runtime=${runtimeInfo.kind}`});
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(gate.accessGranted ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      }
      return gate;
    } finally {
      setOwnerProofGateLoading(false);
    }
  }, [runtimeInfo.kind]);

  const onOpenOwnerLogin = useCallback(() => {
    const path = ownerProofGate?.loginPath ?? '/login?ownerMode=1';
    router.push(path as any);
  }, [ownerProofGate?.loginPath, router]);

  const onApproveSeniorDeveloperProductionRun = useCallback(async () => {
    const goal = seniorGoal.trim();
    const proposedPlan = seniorProposedPlan.trim();
    const rollbackOption = seniorRollbackOption.trim();
    if (!goal || seniorRunLoading) return;
    if (!proposedPlan || seniorFilesAffected.length === 0 || !rollbackOption) {
      Alert.alert(
        'Approval details required',
        'Add the proposed plan, files affected, risk level, and rollback option before approving a senior-developer production mutation.',
      );
      return;
    }

    // Preflight gate: block BEFORE reaching the backend if the owner session is not valid.
    const preflight = await onCheckSeniorDeveloperPreflight();
    if (!preflight.readyToRun) {
      const reason = preflight.blockReason ?? 'Owner session preflight failed.';
      setSeniorError(reason);
      Alert.alert('Preflight blocked the run', reason);
      await logDeveloperAction({ actor: 'system', action: 'senior_developer_preflight_blocked', detail: reason.slice(0, 240) });
      return;
    }

    const ok = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Approve senior-developer production action?',
        `${seniorApprovedActionSummary}\n\nThis sends your logged-in Supabase owner bearer to the backend. If verified against IVX_OWNER_REGISTRATION_EMAILS, the backend may commit to GitHub, trigger Render deploy, and verify production. No GitHub/Render secrets are sent from the phone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Approve + run', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });
    if (!ok) return;

    setSeniorRunLoading(true);
    setSeniorError(null);
    setSeniorRun(null);
    try {
      const result = await runOwnerApprovedSeniorDeveloperProduction({
        goal,
        proposedPlan,
        filesAffected: seniorFilesAffected,
        riskLevel: seniorRiskLevel,
        rollbackOption,
        validationMode: 'focused'});
      setSeniorRun(result);
      await logDeveloperAction({
        actor: 'owner',
        action: 'senior_developer_owner_approved_run',
        detail: `ownerVerified=${result.ownerApproval?.ownerVerified === true} commit=${result.proof?.githubCommitHash ?? 'none'} deploy=${result.proof?.renderDeployId ?? 'none'}`});
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      }
    } catch (err) {
      const error = err as Error & { payload?: IVXSeniorDeveloperRunResponse };
      const payload = error.payload;
      if (payload) {
        setSeniorRun(payload);
      }
      const message = payload?.exactBlocker || payload?.error || error.message || 'Senior developer production run failed.';
      setSeniorError(message);
      await logDeveloperAction({ actor: 'system', action: 'senior_developer_owner_approved_run_failed', detail: message.slice(0, 240) });
    } finally {
      setSeniorRunLoading(false);
    }
  }, [onCheckSeniorDeveloperPreflight, seniorApprovedActionSummary, seniorFilesAffected, seniorGoal, seniorProposedPlan, seniorRiskLevel, seniorRollbackOption, seniorRunLoading]);

  const onLoadSafeDefaultSeniorTask = useCallback(() => {
    setSeniorGoal('Update IVX senior developer build marker: apply one harmless non-functional change (bump the build marker comment), commit to GitHub, trigger a Render deploy, and verify the live /version commit matches.');
    setSeniorProposedPlan('1. Update the IVX senior developer build marker (non-functional comment/version bump).\n2. Run focused tests + typecheck.\n3. Commit the single changed file to GitHub.\n4. Trigger a Render deploy.\n5. Verify production /version live commit matches the new commit hash.');
    setSeniorFilesText('backend/version-endpoint.test.ts');
    setSeniorRiskLevel('low');
    setSeniorRollbackOption('Rollback by reverting the returned GitHub build-marker commit hash, then trigger a Render redeploy of the previous known-good commit.');
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
  }, []);

  const onCopySeniorRollback = useCallback(async () => {
    const rollback = seniorRun?.approvedAction?.rollbackOption || seniorRun?.proof?.approvedAction?.rollbackOption || seniorRollbackOption;
    await onCopy(rollback);
    await logDeveloperAction({ actor: 'owner', action: 'senior_developer_rollback_option_copied', detail: rollback.slice(0, 180) });
  }, [onCopy, seniorRollbackOption, seniorRun]);

  // ---------- Render helpers ----------
  const KIND_FILTERS: readonly { id: ProjectFileKind | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'route', label: 'Routes' },
    { id: 'screen', label: 'Screens' },
    { id: 'service', label: 'Services' },
    { id: 'backend', label: 'Backend' },
    { id: 'migration', label: 'Migrations' },
    { id: 'config', label: 'Config' },
    { id: 'doc', label: 'Docs' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          testID="ivx-dev-workspace-back"
          hitSlop={12}
        >
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerTitleRow}>
            <Terminal size={16} color={Colors.green} />
            <Text style={styles.headerTitle}>Code Developer Workspace</Text>
          </View>
          <Text style={styles.headerSub}>IVX IA · senior developer mode</Text>
        </View>
        <Pressable
          onPress={() => router.push('/admin/ivx-auth-debug' as any)}
          style={styles.headerDebugBtn}
          hitSlop={12}
          testID="ivx-dev-auth-debug"
        >
          <ShieldCheck size={14} color={Colors.green} />
        </Pressable>
        <View style={styles.headerBadge}>
          <Cpu size={12} color={Colors.green} />
          <Text style={styles.headerBadgeText}>BLOCK 18</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        {(
          [
            { id: 'approve', label: 'Approve', icon: ShieldCheck },
            { id: 'files', label: 'Files', icon: FileCode },
            { id: 'assistant', label: 'Assistant', icon: Sparkles },
            { id: 'patches', label: 'Patches', icon: GitPullRequestArrow },
            { id: 'tests', label: 'Tests', icon: Beaker },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tabItem, active && styles.tabItemActive]}
              testID={`ivx-dev-tab-${t.id}`}
            >
              <Icon size={13} color={active ? Colors.green : Colors.textTertiary} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'files' && (
            <View style={styles.gap}>
              <View style={styles.searchCard}>
                <Search size={14} color={Colors.textTertiary} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search routes, screens, services, tags…"
                  placeholderTextColor={Colors.textTertiary}
                  autoCorrect={false}
                  autoCapitalize="none"
                  testID="ivx-dev-files-search"
                />
                {search.length > 0 ? (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <XCircle size={14} color={Colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.filterRow}>
                <Filter size={11} color={Colors.textTertiary} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterScroll}
                >
                  {KIND_FILTERS.map((f) => {
                    const active = kindFilter === f.id;
                    return (
                      <Pressable
                        key={f.id}
                        onPress={() => setKindFilter(f.id)}
                        style={[styles.filterChip, active && styles.filterChipActive]}
                      >
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={styles.metaText}>
                {filteredFiles.length} of {PROJECT_FILE_REGISTRY.length} entries
              </Text>

              {filesByCategory.map(({ category, items }) => (
                <View key={category} style={styles.section}>
                  <Text style={styles.sectionLabel}>{category}</Text>
                  {items.map((file) => (
                    <Pressable
                      key={file.id}
                      onPress={() => onSelectFile(file)}
                      style={[
                        styles.fileRow,
                        selectedFile?.id === file.id && styles.fileRowActive,
                      ]}
                      testID={`ivx-dev-file-${file.id}`}
                    >
                      <View style={styles.fileRowLeft}>
                        <View style={styles.fileKindPill}>
                          <Text style={styles.fileKindText}>{KIND_LABEL[file.kind]}</Text>
                        </View>
                        {file.ownerOnly ? (
                          <ShieldCheck size={11} color={Colors.green} />
                        ) : null}
                      </View>
                      <View style={styles.fileRowMain}>
                        <Text style={styles.fileTitle} numberOfLines={1}>
                          {file.title}
                        </Text>
                        <Text style={styles.filePath} numberOfLines={1}>
                          {file.path}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}

              {selectedFile ? (
                <View style={styles.detailCard}>
                  <View style={styles.detailHeader}>
                    <FileText size={14} color={Colors.green} />
                    <Text style={styles.detailHeaderText} numberOfLines={1}>
                      {selectedFile.path}
                    </Text>
                    <Pressable onPress={() => setSelectedFile(null)} hitSlop={8}>
                      <XCircle size={14} color={Colors.textTertiary} />
                    </Pressable>
                  </View>
                  <Text style={styles.detailTitle}>{selectedFile.title}</Text>
                  <Text style={styles.detailSummary}>{selectedFile.summary}</Text>
                  <View style={styles.tagRow}>
                    {selectedFile.tags.map((t) => (
                      <View key={t} style={styles.tagPill}>
                        <Text style={styles.tagText}>#{t}</Text>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => onAskAboutFile(selectedFile)}
                    style={styles.askBtn}
                    testID="ivx-dev-ask-file"
                  >
                    <Sparkles size={13} color={Colors.background} />
                    <Text style={styles.askBtnText}>Ask IVX IA about this file</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}

          {tab === 'assistant' && (
            <View style={styles.gap}>
              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <Sparkles size={14} color={Colors.green} />
                  <Text style={styles.heroPrompt}>~/ivx</Text>
                  <Text style={styles.heroBranch}>main</Text>
                </View>
                <Text style={styles.heroText}>
                  Ask about a file, route, bug, or feature. IVX IA explains the change. Use the
                  Patch mode to get a tagged diff that becomes a reviewable proposal.
                </Text>
              </View>

              <Text style={styles.sectionLabel}>Mode</Text>
              <View style={styles.templateGrid}>
                {ASSISTANT_MODES.map((m) => {
                  const Icon = m.icon;
                  const active = m.id === assistantMode;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setAssistantMode(m.id)}
                      style={[styles.templateCard, active && styles.templateCardActive]}
                      testID={`ivx-dev-mode-${m.id}`}
                    >
                      <View style={[styles.templateIcon, active && styles.templateIconActive]}>
                        <Icon size={14} color={active ? Colors.background : Colors.green} />
                      </View>
                      <Text
                        style={[styles.templateLabel, active && styles.templateLabelActive]}
                        numberOfLines={1}
                      >
                        {m.label}
                      </Text>
                      <Text style={styles.templateHint} numberOfLines={2}>
                        {m.hint}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {attachedFile ? (
                <View style={styles.attachedRow}>
                  <FileText size={12} color={Colors.green} />
                  <Text style={styles.attachedText} numberOfLines={1}>
                    attached: {attachedFile.path}
                  </Text>
                  <Pressable onPress={() => setAttachedFile(null)} hitSlop={8}>
                    <XCircle size={12} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.sectionLabel}>Input</Text>
              <View style={styles.inputCard}>
                <View style={styles.inputHeader}>
                  <Text style={styles.inputHeaderText}>$ ivx-ia {assistantMode}</Text>
                  <Text style={styles.inputHeaderMeta}>{assistantInput.length} chars</Text>
                </View>
                <TextInput
                  value={assistantInput}
                  onChangeText={onAssistantInputChange}
                  placeholder={
                    assistantMode === 'propose_patch'
                      ? 'Describe the change you want. IVX IA will return a tagged diff for approval.'
                      : 'Paste code, error, or ask a question. One task per run.'
                  }
                  placeholderTextColor={Colors.textTertiary}
                  style={styles.inputField}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="none"
                  testID="ivx-dev-assistant-input"
                />
                {safetyFindings.length > 0 ? (
                  <View style={styles.safetyBanner}>
                    <ShieldAlert size={12} color={Colors.warning} />
                    <Text style={styles.safetyText} numberOfLines={2}>
                      Safety: {safetyFindings.map((f) => `${f.kind}:${f.name}`).join(' · ')}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.inputActions}>
                  {assistantRun.kind === 'running' ? (
                    <Pressable
                      onPress={onCancelAssistant}
                      style={[styles.runBtn, styles.cancelBtn]}
                      testID="ivx-dev-assistant-cancel"
                    >
                      <Square size={14} color={Colors.text} fill={Colors.text} />
                      <Text style={styles.runBtnText}>Cancel</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={onRunAssistant}
                      style={[styles.runBtn, !assistantInput.trim() && styles.runBtnDisabled]}
                      disabled={!assistantInput.trim()}
                      testID="ivx-dev-assistant-run"
                    >
                      <Send size={14} color={Colors.background} />
                      <Text style={styles.runBtnTextDark}>Run with IVX IA</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <Text style={styles.sectionLabel}>Output</Text>
              <View style={styles.outputCard}>
                {assistantRun.kind === 'idle' && (
                  <View style={styles.outputIdle}>
                    <Terminal size={18} color={Colors.textTertiary} />
                    <Text style={styles.outputIdleText}>Awaiting input.</Text>
                  </View>
                )}
                {assistantRun.kind === 'running' && (
                  <View style={styles.outputIdle}>
                    <ShimmerIndicator size="small" color={Colors.green} />
                    <Text style={styles.outputRunningText}>IVX IA is thinking…</Text>
                  </View>
                )}
                {assistantRun.kind === 'error' && (
                  <View>
                    <View style={styles.outputErrorRow}>
                      <XCircle size={14} color={Colors.error} />
                      <Text style={styles.outputErrorTitle}>Request failed</Text>
                    </View>
                    <Text style={styles.outputErrorBody}>{assistantRun.message}</Text>
                  </View>
                )}
                {assistantRun.kind === 'success' && (
                  <View>
                    <View style={styles.outputMetaRow}>
                      <View style={styles.outputMetaPill}>
                        <Text style={styles.outputMetaPillText}>{assistantRun.source}</Text>
                      </View>
                      <View style={styles.outputMetaPill}>
                        <Text style={styles.outputMetaPillText}>{assistantRun.model}</Text>
                      </View>
                      <View style={styles.outputMetaPill}>
                        <Text style={styles.outputMetaPillText}>{assistantRun.ms} ms</Text>
                      </View>
                      <Pressable
                        onPress={() => onCopy(assistantRun.answer)}
                        style={styles.copyBtn}
                        hitSlop={8}
                      >
                        <Copy size={12} color={Colors.green} />
                        <Text style={styles.copyBtnText}>Copy</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.outputBody} selectable>
                      {assistantRun.answer}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {(tab === 'patches' || tab === 'approve') && (
            <View style={styles.gap}>
              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <GitPullRequestArrow size={14} color={Colors.green} />
                  <Text style={styles.heroPrompt}>patch proposals</Text>
                </View>
                <Text style={styles.heroText}>
                  Every proposed change is tracked here. AI never modifies code silently. Owner
                  must approve, and apply is a separate explicit step.
                </Text>
              </View>

              <View style={styles.preflightCard}>
                <View style={styles.preflightHeader}>
                  <ShieldCheck size={13} color={Colors.green} />
                  <Text style={styles.preflightTitle}>Expo Go owner-proof gate</Text>
                  <View style={[styles.preflightVerdict, ownerProofGate?.accessGranted ? styles.preflightVerdictOk : styles.preflightVerdictBad]}>
                    <Text style={[styles.preflightVerdictText, ownerProofGate?.accessGranted ? styles.preflightVerdictTextOk : styles.preflightVerdictTextBad]}>
                      {runtimeInfo.kind.toUpperCase()}
                    </Text>
                  </View>
                </View>
                {ownerProofGate ? (
                  <View style={styles.preflightRows}>
                    <Text style={styles.ownerProofText}>status: {ownerProofGate.status}</Text>
                    <Text style={styles.ownerProofText}>accessGranted: {ownerProofGate.accessGranted ? 'true' : 'false'}</Text>
                    <Text style={styles.ownerProofText}>runtime: {runtimeInfo.kind} (expoGo={runtimeInfo.isExpoGo ? 'true' : 'false'})</Text>
                    <Text style={styles.ownerProofText}>ownerEmailAllowlisted: {ownerProofGate.preflight.ownerEmailAllowlisted ? 'true' : 'false'}</Text>
                    {ownerProofGate.reason ? <Text style={styles.ownerProofError}>Reason: {ownerProofGate.reason}</Text> : null}
                    {ownerProofGate.loginPath ? <Text style={styles.ownerProofText}>Login path: {ownerProofGate.loginPath}</Text> : null}
                  </View>
                ) : (
                  <Text style={styles.ownerApprovalNote}>Check the owner-proof gate to confirm an allowlisted owner is signed in for the build-marker proof in {runtimeInfo.kind}. No token value is ever shown.</Text>
                )}
                <View style={styles.patchActions}>
                  <Pressable
                    onPress={onCheckOwnerProofGate}
                    style={[styles.smallBtn, ownerProofGateLoading ? styles.buttonDisabled : null]}
                    disabled={ownerProofGateLoading}
                    testID="ivx-owner-proof-gate-check"
                  >
                    {ownerProofGateLoading ? <ShimmerIndicator size="small" color={Colors.green} /> : <ShieldCheck size={12} color={Colors.green} />}
                    <Text style={styles.smallBtnText}>{ownerProofGateLoading ? 'Checking…' : 'Check owner-proof gate'}</Text>
                  </Pressable>
                  {ownerProofGate && !ownerProofGate.accessGranted && ownerProofGate.loginPath ? (
                    <Pressable
                      onPress={onOpenOwnerLogin}
                      style={[styles.smallBtn, styles.dangerBtn]}
                      testID="ivx-owner-proof-gate-login"
                    >
                      <ShieldAlert size={12} color={Colors.background} />
                      <Text style={styles.smallBtnTextDark}>Open owner login</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <View style={styles.ownerApprovalCard}>
                <View style={styles.ownerApprovalHeader}>
                  <View style={styles.ownerApprovalIcon}>
                    <Rocket size={16} color={Colors.background} />
                  </View>
                  <View style={styles.ownerApprovalTitleWrap}>
                    <Text style={styles.ownerApprovalTitle}>Owner-approved senior developer run</Text>
                    <Text style={styles.ownerApprovalSubtitle}>Uses your logged-in Supabase owner session. Backend verifies the bearer email against IVX_OWNER_REGISTRATION_EMAILS before GitHub or Render mutation.</Text>
                  </View>
                </View>
                <Pressable
                  onPress={onLoadSafeDefaultSeniorTask}
                  style={styles.safeDefaultBtn}
                  disabled={seniorRunLoading}
                  testID="ivx-senior-developer-safe-default-task"
                >
                  <Sparkles size={12} color={Colors.green} />
                  <Text style={styles.safeDefaultBtnText}>Load safe default task · Update IVX senior developer build marker</Text>
                </Pressable>
                <Text style={styles.ownerApprovalFieldLabel}>Action goal</Text>
                <TextInput
                  value={seniorGoal}
                  onChangeText={setSeniorGoal}
                  placeholder="Describe the exact senior-developer production action…"
                  placeholderTextColor={Colors.textTertiary}
                  style={styles.ownerApprovalInput}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="sentences"
                  testID="ivx-senior-developer-owner-goal"
                />
                <Text style={styles.ownerApprovalFieldLabel}>Proposed plan shown before approval</Text>
                <TextInput
                  value={seniorProposedPlan}
                  onChangeText={setSeniorProposedPlan}
                  placeholder="1. Inspect…\n2. Patch…\n3. Validate…\n4. Commit/deploy/verify…"
                  placeholderTextColor={Colors.textTertiary}
                  style={[styles.ownerApprovalInput, styles.ownerApprovalPlanInput]}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="sentences"
                  testID="ivx-senior-developer-proposed-plan"
                />
                <Text style={styles.ownerApprovalFieldLabel}>Files affected</Text>
                <TextInput
                  value={seniorFilesText}
                  onChangeText={setSeniorFilesText}
                  placeholder="backend/file.ts, expo/app/screen.tsx"
                  placeholderTextColor={Colors.textTertiary}
                  style={styles.ownerApprovalInput}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="none"
                  testID="ivx-senior-developer-files-affected"
                />
                <Text style={styles.ownerApprovalFieldLabel}>Risk level</Text>
                <View style={styles.riskPickerRow}>
                  {([
                    { id: 'low', label: 'Low' },
                    { id: 'medium', label: 'Medium' },
                    { id: 'high', label: 'High' },
                  ] as const).map((risk) => {
                    const active = seniorRiskLevel === risk.id;
                    return (
                      <Pressable
                        key={risk.id}
                        onPress={() => setSeniorRiskLevel(risk.id)}
                        style={[styles.riskPill, active && styles.riskPillActive]}
                        testID={`ivx-senior-developer-risk-${risk.id}`}
                      >
                        <Text style={[styles.riskPillText, active && styles.riskPillTextActive]}>{risk.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.ownerApprovalFieldLabel}>Rollback option</Text>
                <TextInput
                  value={seniorRollbackOption}
                  onChangeText={setSeniorRollbackOption}
                  placeholder="How IVX should roll back if deploy verification fails…"
                  placeholderTextColor={Colors.textTertiary}
                  style={styles.ownerApprovalInput}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="sentences"
                  testID="ivx-senior-developer-rollback-option"
                />
                <View style={styles.ownerApprovalChecklist}>
                  <View style={styles.ownerApprovalChecklistRow}>
                    <CheckCircle2 size={11} color={seniorProposedPlan.trim() ? Colors.green : Colors.textTertiary} />
                    <Text style={styles.ownerApprovalChecklistText}>Plan visible before approval</Text>
                  </View>
                  <View style={styles.ownerApprovalChecklistRow}>
                    <CheckCircle2 size={11} color={seniorFilesAffected.length > 0 ? Colors.green : Colors.textTertiary} />
                    <Text style={styles.ownerApprovalChecklistText}>{seniorFilesAffected.length} file(s) listed</Text>
                  </View>
                  <View style={styles.ownerApprovalChecklistRow}>
                    <CheckCircle2 size={11} color={seniorRollbackOption.trim() ? Colors.green : Colors.textTertiary} />
                    <Text style={styles.ownerApprovalChecklistText}>Rollback option ready</Text>
                  </View>
                </View>
                <View style={styles.preflightCard}>
                  <View style={styles.preflightHeader}>
                    <ShieldCheck size={13} color={Colors.green} />
                    <Text style={styles.preflightTitle}>Owner session preflight</Text>
                    {seniorPreflight ? (
                      <View style={[styles.preflightVerdict, seniorPreflight.readyToRun ? styles.preflightVerdictOk : styles.preflightVerdictBad]}>
                        <Text style={[styles.preflightVerdictText, seniorPreflight.readyToRun ? styles.preflightVerdictTextOk : styles.preflightVerdictTextBad]}>
                          {seniorPreflight.readyToRun ? 'READY' : 'BLOCKED'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {seniorPreflight ? (
                    <View style={styles.preflightRows}>
                      <Text style={styles.ownerProofText}>ownerSessionPresent: {seniorPreflight.ownerSessionPresent ? 'true' : 'false'}</Text>
                      <Text style={styles.ownerProofText}>tokenPresent: {seniorPreflight.tokenPresent ? 'true' : 'false'}</Text>
                      <Text style={styles.ownerProofText}>tokenSegmentCount: {seniorPreflight.tokenSegmentCount}</Text>
                      <Text style={styles.ownerProofText}>tokenLooksLikeSupabaseJwt: {seniorPreflight.tokenLooksLikeSupabaseJwt ? 'true' : 'false'}</Text>
                      <Text style={styles.ownerProofText}>userEmailPresent: {seniorPreflight.userEmailPresent ? 'true' : 'false'}</Text>
                      <Text style={styles.ownerProofText}>ownerEmailAllowlisted: {seniorPreflight.ownerEmailAllowlisted ? 'true' : 'false'}</Text>
                      <Text style={styles.ownerProofText}>readyToRun: {seniorPreflight.readyToRun ? 'true' : 'false'}</Text>
                      {seniorPreflight.blockReason ? <Text style={styles.ownerProofError}>Reason: {seniorPreflight.blockReason}</Text> : null}
                    </View>
                  ) : (
                    <Text style={styles.ownerApprovalNote}>Run the preflight to confirm a valid owner session before the Senior Developer run. No token value is ever shown.</Text>
                  )}
                  <Pressable
                    onPress={onCheckSeniorDeveloperPreflight}
                    style={[styles.smallBtn, (seniorPreflightLoading || seniorRunLoading) ? styles.buttonDisabled : null]}
                    disabled={seniorPreflightLoading || seniorRunLoading}
                    testID="ivx-senior-developer-preflight-check"
                  >
                    {seniorPreflightLoading ? <ShimmerIndicator size="small" color={Colors.green} /> : <ShieldCheck size={12} color={Colors.green} />}
                    <Text style={styles.smallBtnText}>{seniorPreflightLoading ? 'Checking…' : 'Run preflight check'}</Text>
                  </Pressable>
                </View>
                <View style={styles.patchActions}>
                  <Pressable
                    onPress={onAuditSeniorDeveloperReadiness}
                    style={[styles.smallBtn, seniorAuditLoading ? styles.buttonDisabled : null]}
                    disabled={seniorAuditLoading || seniorRunLoading}
                    testID="ivx-senior-developer-audit"
                  >
                    {seniorAuditLoading ? <ShimmerIndicator size="small" color={Colors.green} /> : <ShieldCheck size={12} color={Colors.green} />}
                    <Text style={styles.smallBtnText}>{seniorAuditLoading ? 'Auditing…' : 'Audit owner + credentials'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={onApproveSeniorDeveloperProductionRun}
                    style={[styles.smallBtn, styles.dangerBtn, (!seniorGoal.trim() || !seniorProposedPlan.trim() || seniorFilesAffected.length === 0 || !seniorRollbackOption.trim() || !seniorRunGateReady || seniorRunLoading) ? styles.buttonDisabled : null]}
                    disabled={!seniorGoal.trim() || !seniorProposedPlan.trim() || seniorFilesAffected.length === 0 || !seniorRollbackOption.trim() || !seniorRunGateReady || seniorAuditLoading || seniorRunLoading}
                    testID="ivx-senior-developer-owner-approve-run"
                  >
                    {seniorRunLoading ? <ShimmerIndicator size="small" color={Colors.background} /> : <Rocket size={12} color={Colors.background} />}
                    <Text style={styles.smallBtnTextDark}>{seniorRunLoading ? 'Running…' : 'Approve + run commit/deploy'}</Text>
                  </Pressable>
                </View>
                {seniorRunGateReason ? (
                  <View style={styles.seniorGateBanner} testID="ivx-senior-developer-gate-banner">
                    <ShieldAlert size={13} color={Colors.background} />
                    <Text style={styles.seniorGateBannerText}>{seniorRunGateReason}</Text>
                  </View>
                ) : null}
                {seniorRunGateReason && (!seniorPreflight || !seniorPreflight.ownerSessionPresent || !seniorPreflight.ownerEmailAllowlisted) ? (
                  <Pressable
                    onPress={onOpenOwnerLogin}
                    style={[styles.smallBtn, styles.dangerBtn]}
                    testID="ivx-senior-developer-gate-login"
                  >
                    <ShieldAlert size={12} color={Colors.background} />
                    <Text style={styles.smallBtnTextDark}>Open owner login</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={onApproveSeniorDeveloperProductionRun}
                  style={[styles.runSeniorBtn, (!seniorRunGateReady || seniorRunLoading || seniorPreflightLoading) ? styles.buttonDisabled : null]}
                  disabled={!seniorRunGateReady || seniorRunLoading || seniorPreflightLoading}
                  testID="ivx-senior-developer-run-button"
                >
                  {seniorRunLoading ? <ShimmerIndicator size="small" color={Colors.background} /> : <Rocket size={14} color={Colors.background} />}
                  <Text style={styles.runSeniorBtnText}>{seniorRunLoading ? 'Running Senior Developer…' : 'Run Senior Developer'}</Text>
                </Pressable>
                {seniorAudit || seniorRun || seniorError ? (
                  <View style={styles.ownerProofGrid}>
                    <Text style={styles.ownerProofText}>Owner session detected: {(seniorRun?.ownerApproval?.ownerSessionDetected ?? seniorAudit?.ownerApproval?.ownerSessionDetected) === true ? 'yes' : (seniorRun?.ownerApproval || seniorAudit?.ownerApproval) ? 'no' : 'not run'}</Text>
                    <Text style={styles.ownerProofText}>Bearer accepted: {(seniorRun?.ownerApproval?.bearerAccepted ?? seniorAudit?.ownerApproval?.bearerAccepted) === true ? 'yes' : (seniorRun?.ownerApproval || seniorAudit?.ownerApproval) ? 'no' : 'not run'}</Text>
                    <Text style={styles.ownerProofText}>Owner verified: {(seniorRun?.ownerApproval?.ownerVerified ?? seniorAudit?.ownerApproval?.ownerVerified) === true ? 'yes' : (seniorRun?.ownerApproval || seniorAudit?.ownerApproval) ? 'no' : 'not run'}</Text>
                    <Text style={styles.ownerProofText}>GitHub ready: {seniorAudit?.audit?.github?.canPush === true ? 'yes' : seniorAudit ? 'no' : 'not audited'}</Text>
                    <Text style={styles.ownerProofText}>Render ready: {seniorAudit?.audit?.render?.canDeploy === true ? 'yes' : seniorAudit ? 'no' : 'not audited'}</Text>
                    <Text style={styles.ownerProofText}>Commit hash: {seniorRun?.proof?.githubCommitHash ?? seniorRun?.result?.gitDeployOperator?.github?.commitSha ?? 'none'}</Text>
                    <Text style={styles.ownerProofText}>Render deploy ID: {seniorRun?.proof?.renderDeployId ?? seniorRun?.result?.gitDeployOperator?.render?.deployId ?? 'none'}</Text>
                    <Text style={styles.ownerProofText}>Production health: {seniorRun?.proof?.productionHealthResult?.httpStatus ?? seniorRun?.result?.productionVerification?.httpStatus ?? 'not verified'}</Text>
                    <Text style={styles.ownerProofText}>Approved plan: {(seniorRun?.approvedAction?.proposedPlan || seniorRun?.proof?.approvedAction?.proposedPlan || seniorProposedPlan).slice(0, 160)}</Text>
                    <Text style={styles.ownerProofText}>Files affected: {(seniorRun?.approvedAction?.filesAffected || seniorRun?.proof?.approvedAction?.filesAffected || seniorFilesAffected).join(', ') || 'none'}</Text>
                    <Text style={styles.ownerProofText}>Risk level: {seniorRun?.approvedAction?.riskLevel || seniorRun?.proof?.approvedAction?.riskLevel || seniorRiskLevel}</Text>
                    <Text style={styles.ownerProofText}>Rollback: {(seniorRun?.approvedAction?.rollbackOption || seniorRun?.proof?.approvedAction?.rollbackOption || seniorRollbackOption).slice(0, 180)}</Text>
                    <Pressable onPress={onCopySeniorRollback} style={styles.smallBtn} testID="ivx-senior-developer-copy-rollback">
                      <Copy size={11} color={Colors.green} />
                      <Text style={styles.smallBtnText}>Copy rollback option</Text>
                    </Pressable>
                    {seniorRun?.approvedAction?.auditLog?.slice(0, 5).map((entry) => (
                      <Text key={entry} style={styles.ownerProofText}>Audit: {entry}</Text>
                    ))}
                    {seniorRun?.result?.logs?.slice(-4).map((entry) => (
                      <Text key={`${entry.sequence ?? 0}-${entry.phase ?? 'phase'}`} style={styles.ownerProofText}>Runtime: {entry.phase ?? 'phase'} · {entry.message ?? ''}</Text>
                    ))}
                    {seniorRun?.result?.auditFiles?.json ? <Text style={styles.ownerProofText}>Audit file: {seniorRun.result.auditFiles.json}</Text> : null}
                    {seniorError ? <Text style={styles.ownerProofError}>Blocker: {seniorError}</Text> : null}
                    {seniorAudit?.exactBlocker ? <Text style={styles.ownerProofError}>Audit blocker: {seniorAudit.exactBlocker}</Text> : null}
                    {seniorRun?.proof?.exactBlocker ? <Text style={styles.ownerProofError}>Run blocker: {seniorRun.proof.exactBlocker}</Text> : null}
                  </View>
                ) : (
                  <Text style={styles.ownerApprovalNote}>This replaces shell IVX_OWNER_TOKEN. Approval happens from the signed-in owner UI only; the backend returns non-secret proof.</Text>
                )}
              </View>

              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>Proposals ({patches.length})</Text>
                <Pressable
                  onPress={refreshPatches}
                  style={styles.smallBtn}
                  testID="ivx-dev-patches-refresh"
                >
                  <Text style={styles.smallBtnText}>Refresh</Text>
                </Pressable>
              </View>

              {patchesLoading ? <ShimmerIndicator size="small" color={Colors.green} /> : null}

              {patches.length === 0 && !patchesLoading ? (
                <View style={styles.emptyCard}>
                  <Plus size={16} color={Colors.textTertiary} />
                  <Text style={styles.emptyText}>
                    No patches yet. Use Assistant → Patch mode to generate one.
                  </Text>
                </View>
              ) : null}

              {patches.map((p) => (
                <View key={p.id} style={styles.patchCard}>
                  <View style={styles.patchHeader}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: PATCH_STATUS_COLOR[p.status] },
                      ]}
                    />
                    <Text style={styles.patchStatus}>{p.status.toUpperCase()}</Text>
                    <Text style={styles.patchRisk}>risk:{p.riskLevel}</Text>
                    {p.destructive ? (
                      <View style={styles.destructivePill}>
                        <AlertTriangle size={10} color={Colors.error} />
                        <Text style={styles.destructiveText}>destructive</Text>
                      </View>
                    ) : null}
                    <Text style={styles.patchSource}>{p.source}</Text>
                  </View>
                  <Text style={styles.patchPath} numberOfLines={1}>
                    {p.filePath}
                  </Text>
                  <Text style={styles.patchReason}>{p.reason}</Text>
                  <View style={styles.patchBeforeAfter}>
                    <View style={styles.patchBA}>
                      <Text style={styles.patchBALabel}>OLD</Text>
                      <Text style={styles.patchBAText} numberOfLines={3}>
                        {p.oldBehavior}
                      </Text>
                    </View>
                    <View style={styles.patchBA}>
                      <Text style={styles.patchBALabel}>NEW</Text>
                      <Text style={styles.patchBAText} numberOfLines={3}>
                        {p.newBehavior}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.diffBox}>
                    <Text style={styles.diffText} numberOfLines={12} selectable>
                      {p.diff}
                    </Text>
                  </View>
                  <View style={styles.patchActions}>
                    {p.status === 'proposed' ? (
                      <>
                        <Pressable
                          onPress={() => onApprovePatch(p)}
                          style={[styles.smallBtn, styles.smallBtnPrimary]}
                          testID={`ivx-dev-patch-approve-${p.id}`}
                        >
                          <CheckCircle2 size={12} color={Colors.background} />
                          <Text style={styles.smallBtnTextDark}>Approve</Text>
                        </Pressable>
                        <Pressable onPress={() => onRejectPatch(p)} style={styles.smallBtn}>
                          <Text style={styles.smallBtnText}>Reject</Text>
                        </Pressable>
                      </>
                    ) : null}
                    {p.status === 'approved' ? (
                      <>
                        <Pressable
                          onPress={() => onMarkApplied(p)}
                          style={[styles.smallBtn, styles.smallBtnPrimary]}
                        >
                          <Text style={styles.smallBtnTextDark}>Mark applied / failed</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onPromoteToGithub(p)}
                          style={styles.smallBtn}
                          testID={`ivx-dev-patch-promote-github-${p.id}`}
                        >
                          <GitBranch size={11} color={Colors.green} />
                          <Text style={styles.smallBtnText}>Promote to GitHub commit</Text>
                        </Pressable>
                      </>
                    ) : null}
                    <Pressable onPress={() => onCopy(p.diff)} style={styles.smallBtn}>
                      <Copy size={11} color={Colors.green} />
                      <Text style={styles.smallBtnText}>Copy diff</Text>
                    </Pressable>
                    <Pressable onPress={() => onDeletePatch(p)} style={styles.smallBtn}>
                      <Trash2 size={11} color={Colors.error} />
                      <Text style={[styles.smallBtnText, { color: Colors.error }]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              <Text style={styles.sectionLabel}>Action log</Text>
              <View style={styles.logCard}>
                {actions.length === 0 ? (
                  <Text style={styles.emptyText}>No actions yet.</Text>
                ) : (
                  actions.slice(0, 30).map((a) => (
                    <View key={a.id} style={styles.logRow}>
                      <History size={10} color={Colors.textTertiary} />
                      <Text style={styles.logActor}>[{a.actor}]</Text>
                      <Text style={styles.logAction}>{a.action}</Text>
                      <Text style={styles.logDetail} numberOfLines={1}>
                        {a.detail}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}

          {tab === 'tests' && (
            <View style={styles.gap}>
              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <Beaker size={14} color={Colors.green} />
                  <Text style={styles.heroPrompt}>test / build assistant</Text>
                </View>
                <Text style={styles.heroText}>
                  Paste a test failure, build error, or runtime stack trace. IVX IA will analyze
                  and recommend the safest fix. Status reflects current proposed → applied flow.
                </Text>
              </View>

              <View style={styles.statusGrid}>
                {(
                  [
                    { id: 'proposed', label: 'Proposed' },
                    { id: 'approved', label: 'Approved' },
                    { id: 'applied', label: 'Applied' },
                    { id: 'failed', label: 'Failed' },
                  ] as const
                ).map((s) => {
                  const count = patches.filter((p) => p.status === s.id).length;
                  return (
                    <View key={s.id} style={styles.statusCell}>
                      <View
                        style={[
                          styles.statusDotLarge,
                          { backgroundColor: PATCH_STATUS_COLOR[s.id as PatchStatus] },
                        ]}
                      />
                      <Text style={styles.statusCount}>{count}</Text>
                      <Text style={styles.statusLabel}>{s.label}</Text>
                    </View>
                  );
                })}
              </View>

              <Pressable
                onPress={() => {
                  setAssistantMode('analyze_error');
                  setTab('assistant');
                }}
                style={styles.bigBtn}
                testID="ivx-dev-tests-go-analyze"
              >
                <Beaker size={14} color={Colors.background} />
                <Text style={styles.bigBtnText}>Analyze a test/build error</Text>
              </Pressable>

              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <Database size={12} color={Colors.green} />
                  <Text style={styles.heroPrompt}>production retest (block 18)</Text>
                </View>
                <Text style={styles.heroText}>
                  Last verified · POST /api/public/chat → source=chatgpt, persistence=supabase,
                  history + sessions live, uploads via signed /api/upload.
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.footerNote}>
            block: {BLOCK18_DEVELOPER_WORKSPACE_MARKER} · audited via owner action log
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  gap: { gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#0A0F0A'},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  headerDebugBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8},
  headerTitleWrap: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.2 },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    backgroundColor: 'rgba(34,197,94,0.08)'},
  headerBadgeText: { color: Colors.green, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.6 },
  safeDefaultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    backgroundColor: 'rgba(34,197,94,0.08)',
    marginBottom: 4},
  safeDefaultBtnText: { color: Colors.green, fontSize: 11, fontWeight: '700' as const, flex: 1 },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#080C08'},
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  tabItemActive: { backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.4)' },
  tabLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  tabLabelActive: { color: Colors.green },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 64, gap: 12 },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: { flex: 1, color: Colors.text, fontSize: 13, padding: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterScroll: { gap: 6, paddingRight: 16 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.45)' },
  filterChipText: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.green },
  metaText: { color: Colors.textTertiary, fontSize: 10, marginTop: -4 },
  section: { gap: 6 },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 4},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  fileRowActive: { borderColor: 'rgba(34,197,94,0.5)', backgroundColor: 'rgba(34,197,94,0.05)' },
  fileRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 78 },
  fileRowMain: { flex: 1, gap: 2 },
  fileKindPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)'},
  fileKindText: { color: Colors.green, fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  fileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  filePath: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  detailCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#0B130C',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    gap: 8},
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailHeaderText: {
    flex: 1,
    color: Colors.green,
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  detailTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  detailSummary: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tagPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  tagText: { color: Colors.textSecondary, fontSize: 10 },
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.green,
    marginTop: 4},
  askBtnText: { color: Colors.background, fontSize: 13, fontWeight: '700' as const },
  heroCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#0B130C',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)'},
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  heroPrompt: {
    color: Colors.green,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  heroBranch: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  heroText: { color: Colors.text, fontSize: 13, lineHeight: 19 },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  templateCard: {
    width: '48%',
    padding: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6},
  templateCardActive: { backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.55)' },
  templateIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,197,94,0.1)'},
  templateIconActive: { backgroundColor: Colors.green },
  templateLabel: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  templateLabelActive: { color: Colors.green },
  templateHint: { color: Colors.textTertiary, fontSize: 11, lineHeight: 15 },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)'},
  attachedText: { flex: 1, color: Colors.green, fontSize: 11 },
  inputCard: {
    borderRadius: 12,
    backgroundColor: '#0A0F0A',
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden'},
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#080C08'},
  inputHeaderText: {
    color: Colors.green,
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  inputHeaderMeta: { color: Colors.textTertiary, fontSize: 10 },
  inputField: {
    minHeight: 140,
    color: Colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 19,
    textAlignVertical: 'top',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(245,158,11,0.3)'},
  safetyText: { flex: 1, color: Colors.warning, fontSize: 11 },
  inputActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: '#080C08'},
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.green},
  runBtnDisabled: { backgroundColor: 'rgba(34,197,94,0.35)' },
  cancelBtn: { backgroundColor: Colors.error },
  runBtnText: { color: Colors.text, fontWeight: '700' as const, fontSize: 13 },
  runBtnTextDark: { color: Colors.background, fontWeight: '700' as const, fontSize: 13 },
  outputCard: {
    minHeight: 140,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#0A0F0A',
    borderWidth: 1,
    borderColor: Colors.border},
  outputIdle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 28, justifyContent: 'center' },
  outputIdleText: { color: Colors.textTertiary, fontSize: 12 },
  outputRunningText: { color: Colors.green, fontSize: 12, fontWeight: '600' as const },
  outputErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  outputErrorTitle: { color: Colors.error, fontWeight: '700' as const, fontSize: 13 },
  outputErrorBody: { color: Colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  outputMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  outputMetaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  outputMetaPillText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  copyBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)'},
  copyBtnText: { color: Colors.green, fontSize: 11, fontWeight: '600' as const },
  outputBody: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  smallBtnPrimary: { backgroundColor: Colors.green, borderColor: Colors.green },
  dangerBtn: { backgroundColor: Colors.error, borderColor: Colors.error },
  buttonDisabled: { opacity: 0.55 },
  smallBtnText: { color: Colors.green, fontSize: 11, fontWeight: '600' as const },
  smallBtnTextDark: { color: Colors.background, fontSize: 11, fontWeight: '700' as const },
  ownerApprovalCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#100A0A',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.34)',
    gap: 10},
  ownerApprovalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  ownerApprovalIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error},
  ownerApprovalTitleWrap: { flex: 1, gap: 3 },
  ownerApprovalTitle: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  ownerApprovalSubtitle: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
  ownerApprovalFieldLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2},
  ownerApprovalInput: {
    minHeight: 76,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    color: Colors.text,
    backgroundColor: '#070707',
    borderWidth: 1,
    borderColor: Colors.border,
    textAlignVertical: 'top',
    fontSize: 12,
    lineHeight: 17},
  ownerApprovalPlanInput: { minHeight: 120 },
  riskPickerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  riskPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#070707',
    borderWidth: 1,
    borderColor: Colors.border},
  riskPillActive: { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.48)' },
  riskPillText: { color: Colors.textTertiary, fontSize: 11, fontWeight: '700' as const },
  riskPillTextActive: { color: Colors.green },
  ownerApprovalChecklist: {
    gap: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(34,197,94,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.18)'},
  ownerApprovalChecklistRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerApprovalChecklistText: { color: Colors.textSecondary, fontSize: 11 },
  ownerProofGrid: {
    gap: 5,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#070707',
    borderWidth: 1,
    borderColor: Colors.border},
  ownerProofText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  ownerProofError: { color: Colors.warning, fontSize: 11, lineHeight: 16 },
  ownerApprovalNote: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16 },
  preflightCard: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#070707',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)'},
  preflightHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preflightTitle: { color: Colors.text, fontSize: 12, fontWeight: '800' as const, flex: 1 },
  preflightVerdict: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  preflightVerdictOk: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.5)' },
  preflightVerdictBad: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.5)' },
  preflightVerdictText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.6 },
  preflightVerdictTextOk: { color: Colors.green },
  preflightVerdictTextBad: { color: Colors.error },
  preflightRows: { gap: 4 },
  runSeniorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.green,
    borderWidth: 1,
    borderColor: Colors.green},
  runSeniorBtnText: { color: Colors.background, fontSize: 14, fontWeight: '800' as const, letterSpacing: 0.3 },
  seniorGateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 10,
    backgroundColor: Colors.warning},
  seniorGateBannerText: { flex: 1, color: Colors.background, fontSize: 12, fontWeight: '700' as const },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border},
  emptyText: { color: Colors.textTertiary, fontSize: 12 },
  patchCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  patchHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  patchStatus: { color: Colors.text, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.5 },
  patchRisk: { color: Colors.textSecondary, fontSize: 10 },
  patchSource: { color: Colors.textTertiary, fontSize: 10, marginLeft: 'auto' },
  destructivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)'},
  destructiveText: { color: Colors.error, fontSize: 9, fontWeight: '700' as const },
  patchPath: {
    color: Colors.green,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  patchReason: { color: Colors.text, fontSize: 13, lineHeight: 18 },
  patchBeforeAfter: { flexDirection: 'row', gap: 8 },
  patchBA: {
    flex: 1,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#0A0F0A',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4},
  patchBALabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  patchBAText: { color: Colors.textSecondary, fontSize: 11, lineHeight: 15 },
  diffBox: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#06090A',
    borderWidth: 1,
    borderColor: Colors.border},
  diffText: {
    color: Colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  patchActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  logCard: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#0A0F0A',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6},
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logActor: { color: Colors.textTertiary, fontSize: 10, fontWeight: '700' as const },
  logAction: { color: Colors.green, fontSize: 10, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  logDetail: { flex: 1, color: Colors.textSecondary, fontSize: 10 },
  statusGrid: { flexDirection: 'row', gap: 8 },
  statusCell: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
    alignItems: 'flex-start'},
  statusDotLarge: { width: 10, height: 10, borderRadius: 5 },
  statusCount: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  statusLabel: { color: Colors.textTertiary, fontSize: 10, letterSpacing: 0.5 },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.green},
  bigBtnText: { color: Colors.background, fontSize: 13, fontWeight: '700' as const },
  footerNote: {
    color: Colors.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 8,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })}});
