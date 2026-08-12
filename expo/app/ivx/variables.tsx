import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';

import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  DownloadCloud,
  Github,
  Info,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Rocket,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  deleteIVXOwnerVariable,
  getIVXOwnerVariablesStatus,
  IVX_OWNER_VARIABLE_NAMES,
  saveIVXOwnerVariable,
  selfSyncIVXOwnerVariablesFromRorkEnv,
  testIVXOwnerVariable,
  triggerIVXRenderDeploy,
  type IVXOwnerVariableName,
  type IVXOwnerVariableProvider,
  type IVXOwnerVariableRow,
  type IVXOwnerVariablesSelfSyncResponse,
  type IVXOwnerVariablesStatus,
  type IVXRenderDeployTriggerResult} from '@/src/modules/ivx-owner-ai/services/ivxVariablesToolService';
import {
  detectPublicVariablePresence,
  IVX_TRACKED_VARIABLE_METADATA,
  type IVXTrackedVariableMetadata} from '@/src/modules/ivx-owner-ai/services/ivxVariablesMetadata';

type IVXMergedVariableRow = {
  metadata: IVXTrackedVariableMetadata;
  backend: IVXOwnerVariableRow | null;
  isWritable: boolean;
  present: boolean;
  runtimeReadable: boolean;
  verified: boolean;
  lastVerifiedAt: string | null;
  status: 'tested' | 'saved' | 'invalid' | 'missing';
};

const OWNER_WRITABLE_NAMES = new Set<string>(IVX_OWNER_VARIABLE_NAMES as readonly string[]);

const IVX_OWNER_VARIABLES_QUERY_KEY = ['ivx-owner-ai', 'owner-variables-status'] as const;

function getProviderLabel(provider: IVXOwnerVariableProvider | string): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'render') return 'Render';
  if (provider === 'supabase') return 'Supabase';
  if (provider === 'aws') return 'AWS / Amazon';
  if (provider === 'ai') return 'AI Gateway';
  if (provider === 'storage') return 'Storage/CDN';
  return 'Security';
}

function getProviderIcon(provider: IVXOwnerVariableProvider | string) {
  if (provider === 'github') return <Github size={16} color={Colors.primary} />;
  if (provider === 'render') return <Server size={16} color={Colors.primary} />;
  if (provider === 'supabase') return <Database size={16} color={Colors.primary} />;
  if (provider === 'aws' || provider === 'storage') return <Cloud size={16} color={Colors.primary} />;
  return <ShieldCheck size={16} color={Colors.primary} />;
}

function getStatusColor(status: string): string {
  if (status === 'tested') return Colors.success;
  if (status === 'saved') return Colors.primary;
  if (status === 'invalid') return Colors.error;
  return Colors.warning;
}

function getStatusLabel(status: string): string {
  if (status === 'tested') return 'tested';
  if (status === 'saved') return 'saved';
  if (status === 'invalid') return 'invalid';
  return 'missing';
}

function formatTime(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

type RowActionKind = 'save' | 'test' | 'reverify' | 'delete';
type BusyAction = { name: IVXOwnerVariableName; action: RowActionKind } | null;
type ToastState = { message: string; tone: 'success' | 'error' } | null;

function Toast({ toast }: { toast: ToastState }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: toast ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: toast ? 0 : 12, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [toast, opacity, translateY]);
  if (!toast) return null;
  const isSuccess = toast.tone === 'success';
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, isSuccess ? styles.toastSuccess : styles.toastError, { opacity, transform: [{ translateY }] }]}
      testID="ivx-owner-variable-toast"
    >
      {isSuccess ? <CheckCircle2 size={16} color={Colors.success} /> : <CircleAlert size={16} color={Colors.error} />}
      <Text style={[styles.toastText, { color: isSuccess ? Colors.success : Colors.error }]} numberOfLines={3}>{toast.message}</Text>
    </Animated.View>
  );
}

function SecurityPill({ passed, label }: { passed: boolean; label: string }) {
  return (
    <View style={[styles.securityPill, passed ? styles.securityPillPass : styles.securityPillWarn]}>
      {passed ? <CheckCircle2 size={13} color={Colors.success} /> : <CircleAlert size={13} color={Colors.warning} />}
      <Text style={[styles.securityPillText, { color: passed ? Colors.success : Colors.warning }]}>{label}</Text>
    </View>
  );
}

function ProviderCard({ status, provider }: { status: IVXOwnerVariablesStatus | null; provider: IVXOwnerVariableProvider }) {
  const readiness = status?.providers[provider];
  const providerStatus = readiness?.status ?? 'missing';
  const missingCount = readiness?.missingVariableNames.length ?? 0;
  return (
    <View style={styles.providerCard} testID={`ivx-owner-provider-${provider}`}>
      <View style={styles.providerHeader}>
        {getProviderIcon(provider)}
        <Text style={styles.providerTitle}>{getProviderLabel(provider)}</Text>
        <View style={[styles.statusBadge, { borderColor: getStatusColor(providerStatus), backgroundColor: `${getStatusColor(providerStatus)}22` }]}>
          <Text style={[styles.statusBadgeText, { color: getStatusColor(providerStatus) }]}>{getStatusLabel(providerStatus)}</Text>
        </View>
      </View>
      <Text style={styles.providerDetail}>{missingCount === 0 ? 'Required credentials are saved.' : `${missingCount} required credential${missingCount === 1 ? '' : 's'} missing.`}</Text>
      <Text style={styles.providerMuted}>Last tested: {formatTime(readiness?.lastTestedAt ?? null)}</Text>
    </View>
  );
}

function VariableRow({
  variable,
  draftValue,
  onChangeDraft,
  onSave,
  onTest,
  onReverify,
  onDelete,
  busyAction,
  anyBusy}: {
  variable: IVXOwnerVariableRow;
  draftValue: string;
  onChangeDraft: (name: IVXOwnerVariableName, value: string) => void;
  onSave: (name: IVXOwnerVariableName) => void;
  onTest: (name: IVXOwnerVariableName) => void;
  onReverify: (name: IVXOwnerVariableName) => void;
  onDelete: (name: IVXOwnerVariableName) => void;
  busyAction: BusyAction;
  anyBusy: boolean;
}) {
  const hasDraft = draftValue.trim().length > 0;
  const rowAction: RowActionKind | null = busyAction?.name === variable.name ? busyAction.action : null;
  const savedActionsDisabled = anyBusy || !variable.saved;
  const statusColor = getStatusColor(variable.status);
  return (
    <View style={styles.variableCard} testID={`ivx-owner-variable-row-${variable.name}`}>
      <View style={styles.variableTopRow}>
        <View style={styles.variableNameBlock}>
          <Text style={styles.variableName}>{variable.name}</Text>
          <Text style={styles.variableDescription}>{variable.description}</Text>
        </View>
        <View style={[styles.statusBadge, { borderColor: statusColor, backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>{getStatusLabel(variable.status)}</Text>
        </View>
      </View>

      <View style={styles.variableMetaGrid}>
        <Text style={styles.metaText}>Provider: {getProviderLabel(variable.provider)}</Text>
        <Text style={styles.metaText}>Preview: {variable.maskedPreview ?? 'not saved'}</Text>
        <Text style={styles.metaText}>Last tested: {formatTime(variable.lastTestedAt)}</Text>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draftValue}
          onChangeText={(value) => onChangeDraft(variable.name, value)}
          placeholder={`Enter ${variable.name}`}
          placeholderTextColor={Colors.textTertiary}
          secureTextEntry={variable.secret}
          autoCapitalize="none"
          autoCorrect={false}
          testID={`ivx-owner-variable-input-${variable.name}`}
        />
        <Pressable
          style={[styles.iconButton, (!hasDraft || anyBusy) ? styles.buttonDisabled : null]}
          disabled={!hasDraft || anyBusy}
          onPress={() => onSave(variable.name)}
          accessibilityLabel={`Save ${variable.name}`}
          testID={`ivx-owner-variable-save-${variable.name}`}
        >
          {rowAction === 'save' ? <ShimmerIndicator size="small" color={Colors.black} /> : <Save size={17} color={Colors.black} />}
        </Pressable>
      </View>

      <View style={styles.rowActions}>
        <Pressable
          style={[styles.secondaryButton, styles.actionFlex, savedActionsDisabled ? styles.buttonDisabled : null]}
          disabled={savedActionsDisabled}
          onPress={() => onTest(variable.name)}
          accessibilityLabel={`Test ${variable.name}`}
          testID={`ivx-owner-variable-test-${variable.name}`}
        >
          {rowAction === 'test' ? <ShimmerIndicator size="small" color={Colors.text} /> : <ShieldCheck size={14} color={Colors.text} />}
          <Text style={styles.secondaryButtonText}>Test</Text>
        </Pressable>
        <Pressable
          style={[styles.reverifyButton, styles.actionFlex, savedActionsDisabled ? styles.buttonDisabled : null]}
          disabled={savedActionsDisabled}
          onPress={() => onReverify(variable.name)}
          accessibilityLabel={`Reverify ${variable.name}`}
          testID={`ivx-owner-variable-reverify-${variable.name}`}
        >
          {rowAction === 'reverify' ? <ShimmerIndicator size="small" color={Colors.primary} /> : <RefreshCw size={14} color={Colors.primary} />}
          <Text style={styles.reverifyButtonText}>Reverify</Text>
        </Pressable>
        <Pressable
          style={[styles.dangerButton, styles.actionFlex, savedActionsDisabled ? styles.buttonDisabled : null]}
          disabled={savedActionsDisabled}
          onPress={() => onDelete(variable.name)}
          accessibilityLabel={`Delete ${variable.name}`}
          testID={`ivx-owner-variable-delete-${variable.name}`}
        >
          {rowAction === 'delete' ? <ShimmerIndicator size="small" color={Colors.error} /> : <Trash2 size={14} color={Colors.error} />}
          <Text style={styles.dangerButtonText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

type SummaryTone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

function summaryToneColor(tone: SummaryTone): string {
  if (tone === 'primary') return Colors.primary;
  if (tone === 'success') return Colors.success;
  if (tone === 'warning') return Colors.warning;
  if (tone === 'danger') return Colors.error;
  return Colors.textSecondary;
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: SummaryTone }) {
  const color = summaryToneColor(tone);
  return (
    <View style={[styles.summaryStat, { borderColor: `${color}44` }]} testID={`ivx-owner-variables-summary-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <Text style={[styles.summaryStatValue, { color }]}>{value}</Text>
      <Text style={styles.summaryStatLabel}>{label}</Text>
    </View>
  );
}

function MetadataPill({ label, tone }: { label: string; tone: SummaryTone }) {
  const color = summaryToneColor(tone);
  return (
    <View style={[styles.metadataPill, { borderColor: `${color}55`, backgroundColor: `${color}14` }]}>
      <Text style={[styles.metadataPillText, { color }]}>{label}</Text>
    </View>
  );
}

function TrackedVariableRow({ row }: { row: IVXMergedVariableRow }) {
  const { metadata, backend, isWritable, present, runtimeReadable, verified, lastVerifiedAt, status } = row;
  const statusColor = getStatusColor(status);
  return (
    <View style={styles.trackedCard} testID={`ivx-owner-tracked-${metadata.name}`}>
      <View style={styles.variableTopRow}>
        <View style={styles.variableNameBlock}>
          <Text style={styles.variableName}>{metadata.name}</Text>
          <Text style={styles.variableDescription}>{metadata.description}</Text>
        </View>
        <View style={[styles.statusBadge, { borderColor: statusColor, backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>{getStatusLabel(status)}</Text>
        </View>
      </View>

      <View style={styles.metadataPillRow}>
        <MetadataPill label={metadata.category} tone="primary" />
        <MetadataPill label={metadata.isPublic ? 'public env' : 'private / backend'} tone={metadata.isPublic ? 'muted' : 'warning'} />
        <MetadataPill label={metadata.secret ? 'secret · masked' : 'non-secret'} tone={metadata.secret ? 'danger' : 'muted'} />
        <MetadataPill label={present ? 'present: yes' : 'present: no'} tone={present ? 'success' : 'danger'} />
        <MetadataPill label={runtimeReadable ? 'runtime: readable' : 'runtime: unverified'} tone={runtimeReadable ? 'success' : 'warning'} />
        <MetadataPill label={verified ? 'verified' : 'not verified'} tone={verified ? 'success' : 'warning'} />
        {metadata.required ? <MetadataPill label="required" tone="warning" /> : null}
        {metadata.rollbackOnly ? <MetadataPill label="rollback-only" tone="muted" /> : null}
        {metadata.devOnly ? <MetadataPill label="dev-only" tone="muted" /> : null}
        {metadata.safeToRemove ? <MetadataPill label="safe to remove" tone="muted" /> : null}
        {metadata.ownerActionNeeded ? <MetadataPill label="owner action" tone="warning" /> : null}
      </View>

      <View style={styles.variableMetaGrid}>
        <Text style={styles.metaText}>Source: {metadata.sourceLocation}</Text>
        <Text style={styles.metaText}>Unlocks: {metadata.featureUnlocked}</Text>
        <Text style={styles.metaText}>Last verified: {formatTime(lastVerifiedAt)}</Text>
        <Text style={styles.metaText}>Preview: {backend?.maskedPreview ?? (metadata.isPublic && present ? 'inlined (masked)' : 'not stored')}</Text>
        {!isWritable ? (
          <View style={styles.metadataNoteRow}>
            <Info size={11} color={Colors.textTertiary} />
            <Text style={styles.metaText}>Edit this credential in {metadata.sourceLocation}. Backend save/test/delete is intentionally disabled here.</Text>
          </View>
        ) : null}
        {metadata.actionRequired ? (
          <View style={styles.metadataNoteRow}>
            <CircleAlert size={11} color={Colors.warning} />
            <Text style={[styles.metaText, { color: Colors.warning }]}>Action required: {metadata.actionRequired}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function IVXVariablesToolRoute() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [draftValues, setDraftValues] = useState<Partial<Record<IVXOwnerVariableName, string>>>({});
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const statusQuery = useQuery<IVXOwnerVariablesStatus, Error>({
    queryKey: IVX_OWNER_VARIABLES_QUERY_KEY,
    queryFn: getIVXOwnerVariablesStatus,
    refetchInterval: 45_000});

  const saveMutation = useMutation({
    mutationFn: async (input: { name: IVXOwnerVariableName; value: string }) => await saveIVXOwnerVariable(input),
    onMutate: (input) => setBusyAction({ name: input.name, action: 'save' }),
    onSuccess: async (response, input) => {
      setDraftValues((current) => {
        const nextValues = { ...current };
        delete nextValues[input.name];
        return nextValues;
      });
      await queryClient.invalidateQueries({ queryKey: IVX_OWNER_VARIABLES_QUERY_KEY });
      showToast(`${input.name} saved securely · ${response.saved?.maskedPreview ?? 'masked'}`, 'success');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Owner Variables save failed.', 'error'),
    onSettled: () => setBusyAction(null)});

  const testMutation = useMutation({
    mutationFn: async (input: { name?: IVXOwnerVariableName; provider?: IVXOwnerVariableProvider }) => await testIVXOwnerVariable(input),
    onMutate: (input) => setBusyAction(input.name ? { name: input.name, action: 'test' } : null),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: IVX_OWNER_VARIABLES_QUERY_KEY });
      showToast(
        response.ok ? 'Credential test passed' : (response.message ?? response.providerResult?.error ?? 'Credential test finished'),
        response.ok ? 'success' : 'error',
      );
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Owner Variables test failed.', 'error'),
    onSettled: () => setBusyAction(null)});

  const [lastSelfSync, setLastSelfSync] = useState<IVXOwnerVariablesSelfSyncResponse | null>(null);
  const selfSyncMutation = useMutation<IVXOwnerVariablesSelfSyncResponse, Error, { overwriteExisting: boolean }>({
    mutationFn: async (input) => await selfSyncIVXOwnerVariablesFromRorkEnv({ overwriteExisting: input.overwriteExisting }),
    onSuccess: async (response) => {
      setLastSelfSync(response);
      await queryClient.invalidateQueries({ queryKey: IVX_OWNER_VARIABLES_QUERY_KEY });
      const { syncedCount, missingInEnvCount, errorCount } = response.summary;
      Alert.alert(
        response.ok ? 'Sync from external source complete' : 'Sync from external source finished with issues',
        `Synced: ${syncedCount}\nMissing on backend env: ${missingInEnvCount}\nErrors: ${errorCount}\n\nSecret values returned=false. Only masked previews are shown below.`,
      );
    },
    onError: (error) => {
      setLastSelfSync(null);
      Alert.alert('Sync from external source failed', error instanceof Error ? error.message : 'Owner Variables self-sync failed.');
    }});

  const handleSelfSync = useCallback((overwriteExisting: boolean) => {
    Alert.alert(
      overwriteExisting ? 'Sync ALL credentials from external source now?' : 'Sync missing credentials from external source now?',
      'The backend reads its own saved env values (GITHUB_TOKEN, RENDER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, AWS keys, AI keys, etc.) and writes encrypted copies into ivx_owner_variables. Your phone never sees the raw secrets. Response shows only masked previews.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sync now', onPress: () => selfSyncMutation.mutate({ overwriteExisting }) },
      ],
    );
  }, [selfSyncMutation]);

  const [lastDeploy, setLastDeploy] = useState<IVXRenderDeployTriggerResult | null>(null);
  const deployMutation = useMutation<IVXRenderDeployTriggerResult, Error, { clearCache: boolean }>({
    mutationFn: async (input) => await triggerIVXRenderDeploy({ clearCache: input.clearCache }),
    onSuccess: (result) => {
      setLastDeploy(result);
      if (result.ok) {
        Alert.alert(
          'Render deploy triggered',
          `Service: ivx-holdings-platform\nService ID: ${result.serviceId ?? 'unknown'}\nDeploy ID: ${result.deployId ?? 'pending'}\nStatus: ${result.deployStatus ?? 'accepted'}\n\nWait ~2\u20135 minutes for Render to build and go Live, then refresh and tap Test Render.`,
        );
      } else {
        Alert.alert('Render deploy not triggered', result.error || 'Backend rejected the deploy. Confirm RENDER_API_KEY and RENDER_SERVICE_ID are saved and tested above.');
      }
    },
    onError: (error) => {
      setLastDeploy(null);
      Alert.alert('Render deploy failed', error instanceof Error ? error.message : 'Could not reach backend deploy action.');
    }});

  const handleTriggerDeploy = useCallback((clearCache: boolean) => {
    Alert.alert(
      clearCache ? 'Deploy backend (clear cache)?' : 'Deploy backend now?',
      'This triggers a Render deploy of ivx-holdings-platform using the backend\u2019s RENDER_API_KEY. The public landing site is NOT touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deploy', onPress: () => deployMutation.mutate({ clearCache }) },
      ],
    );
  }, [deployMutation]);

  const deleteMutation = useMutation({
    mutationFn: async (name: IVXOwnerVariableName) => await deleteIVXOwnerVariable(name),
    onMutate: (name) => setBusyAction({ name, action: 'delete' }),
    onSuccess: async (_response, name) => {
      await queryClient.invalidateQueries({ queryKey: IVX_OWNER_VARIABLES_QUERY_KEY });
      showToast(`${name} deleted`, 'success');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Owner Variables delete failed.', 'error'),
    onSettled: () => setBusyAction(null)});

  const status = statusQuery.data ?? null;
  const variables = useMemo<IVXOwnerVariableRow[]>(() => {
    const rowsByName = new Map((status?.variables ?? []).map((item) => [item.name, item]));
    return IVX_OWNER_VARIABLE_NAMES.map((name) => rowsByName.get(name)).filter((item): item is IVXOwnerVariableRow => Boolean(item));
  }, [status?.variables]);

  const trackedRows = useMemo<IVXMergedVariableRow[]>(() => {
    const backendByName = new Map((status?.variables ?? []).map((item) => [item.name as string, item]));
    return IVX_TRACKED_VARIABLE_METADATA.map((metadata) => {
      const backend = backendByName.get(metadata.name) ?? null;
      const publicPresent = metadata.isPublic ? detectPublicVariablePresence(metadata.name) : false;
      const backendSaved = backend?.saved === true;
      const backendStatus = backend?.status ?? 'missing';
      const verified = backendStatus === 'tested';
      const present = backendSaved || publicPresent;
      const runtimeReadable = backendStatus === 'tested' || backendStatus === 'saved' || (metadata.isPublic && publicPresent);
      const status: IVXMergedVariableRow['status'] = backend ? backendStatus : present ? 'saved' : 'missing';
      return {
        metadata,
        backend,
        isWritable: OWNER_WRITABLE_NAMES.has(metadata.name),
        present,
        runtimeReadable,
        verified,
        lastVerifiedAt: backend?.lastTestedAt ?? null,
        status};
    });
  }, [status?.variables]);

  const trackedSummary = useMemo(() => {
    let synced = 0;
    let runtimeVerified = 0;
    let presentNotVerified = 0;
    let missing = 0;
    let rollbackOnly = 0;
    let devOnly = 0;
    let safeToRemove = 0;
    let ownerActionRequired = 0;
    for (const row of trackedRows) {
      if (row.present) synced += 1;
      if (row.verified) runtimeVerified += 1;
      if (row.present && !row.verified) presentNotVerified += 1;
      if (!row.present) missing += 1;
      if (row.metadata.rollbackOnly) rollbackOnly += 1;
      if (row.metadata.devOnly) devOnly += 1;
      if (row.metadata.safeToRemove) safeToRemove += 1;
      if (row.metadata.ownerActionNeeded) ownerActionRequired += 1;
    }
    return { synced, runtimeVerified, presentNotVerified, missing, rollbackOnly, devOnly, safeToRemove, ownerActionRequired, total: trackedRows.length };
  }, [trackedRows]);

  const providerNames = useMemo<IVXOwnerVariableProvider[]>(() => ['github', 'render', 'supabase', 'aws', 'ai', 'security', 'storage'], []);
  const requiredTotal = useMemo<number>(() => variables.filter((item) => item.required).length, [variables]);
  const savedRequiredCount = useMemo<number>(() => variables.filter((item) => item.required && item.saved).length, [variables]);
  const missingList = status?.missingCredentials ?? [];
  const isMutating = saveMutation.isPending || testMutation.isPending || deleteMutation.isPending;
  const anyBusy = isMutating || busyAction?.action === 'reverify';

  const handleReverify = useCallback(async (name: IVXOwnerVariableName) => {
    setBusyAction({ name, action: 'reverify' });
    try {
      await statusQuery.refetch();
      showToast(`${name} re-verified`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reverify failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  }, [statusQuery, showToast]);

  const updateDraftValue = useCallback((name: IVXOwnerVariableName, value: string) => {
    setDraftValues((current) => ({ ...current, [name]: value }));
  }, []);

  const handleRefresh = useCallback(() => {
    if (statusQuery.isFetching) {
      return;
    }
    void statusQuery.refetch();
  }, [statusQuery]);

  const handleSave = useCallback((name: IVXOwnerVariableName) => {
    const value = (draftValues[name] ?? '').trim();
    if (!value) {
      Alert.alert('No credential entered', `Enter ${name} before saving.`);
      return;
    }
    Alert.alert(
      `Save ${name}?`,
      'This sends the value only to the owner-only backend. The response, UI, logs, and screenshots show only masked status/proof.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save securely', onPress: () => saveMutation.mutate({ name, value }) },
      ],
    );
  }, [draftValues, saveMutation]);

  const handleDelete = useCallback((name: IVXOwnerVariableName) => {
    Alert.alert(
      `Delete ${name}?`,
      'The saved encrypted value will be removed. Audit logs keep only variable name/provider/action, never the secret.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(name) },
      ],
    );
  }, [deleteMutation]);

  const handleTestProvider = useCallback((provider: IVXOwnerVariableProvider) => {
    testMutation.mutate({ provider });
  }, [testMutation]);

  return (
    <ErrorBoundary fallbackTitle="IVX Owner Variables unavailable">
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(120, insets.bottom + 96) }]}
          refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={statusQuery.isFetching} onRefresh={handleRefresh} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          testID="ivx-owner-variables-screen"
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <LockKeyhole size={15} color={Colors.black} />
              <Text style={styles.heroBadgeText}>Owner/admin only</Text>
            </View>
            <Text style={styles.heroTitle}>Owner Variables / Credentials</Text>
            <Text style={styles.heroSubtitle}>Secure portal for GitHub, Render, Supabase, AWS, AI, and storage credentials. IVX AI can check readiness without ever returning raw secret values.</Text>
            <View style={styles.heroPills}>
              <SecurityPill passed={status?.ownerOnly === true} label="owner login required" />
              <SecurityPill passed={status?.storage.encryptedAtRest === true} label="encrypted at rest" />
              <SecurityPill passed={status?.secretValuesReturned === false || !status} label="secret echo blocked" />
              <SecurityPill passed={status?.storage.auditLogEnabled === true} label="audit log enabled" />
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <ShieldCheck size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Readiness proof</Text>
                <Text style={styles.cardSubtitle}>{`${savedRequiredCount}/${requiredTotal} required credentials saved · deployment marker: ${status?.deploymentMarker ?? 'not loaded'}`}</Text>
              </View>
              <Pressable style={styles.refreshButton} onPress={handleRefresh} testID="ivx-owner-variables-refresh">
                <RefreshCw size={13} color={Colors.black} />
                <Text style={styles.refreshButtonText}>Refresh</Text>
              </Pressable>
            </View>
            {statusQuery.isLoading ? (
              <View style={styles.loadingRow}>
                <ShimmerIndicator color={Colors.primary} size="small" />
                <Text style={styles.mutedText}>Checking encrypted credential statuses only…</Text>
              </View>
            ) : statusQuery.error ? (
              <Text style={styles.errorText}>{statusQuery.error.message}</Text>
            ) : status?.storage.error ? (
              <Text style={styles.errorText}>{status.storage.error}</Text>
            ) : null}
            <View style={styles.proofGrid}>
              <Text style={styles.proofText}>Storage: {status?.storage.backend ?? 'not verified'}</Text>
              <Text style={styles.proofText}>Authenticated owner: {status?.authenticatedUserId ? 'yes' : 'not verified'}</Text>
              <Text style={styles.proofText}>Missing: {missingList.length > 0 ? missingList.join(', ') : 'none'}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <DownloadCloud size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Sync external credentials into IVX now</Text>
                <Text style={styles.cardSubtitle}>One tap: the backend reads its own saved external env values (GITHUB_TOKEN, RENDER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, AWS, AI, etc.) and writes encrypted copies into ivx_owner_variables. Raw secrets never reach your phone — only masked previews are returned as proof.</Text>
              </View>
            </View>
            <View style={styles.deployButtonRow}>
              <Pressable
                style={[styles.deployButtonPrimary, selfSyncMutation.isPending ? styles.buttonDisabled : null]}
                disabled={selfSyncMutation.isPending}
                onPress={() => handleSelfSync(true)}
                testID="ivx-owner-variables-self-sync-overwrite"
              >
                {selfSyncMutation.isPending ? <ShimmerIndicator size="small" color={Colors.black} /> : <DownloadCloud size={15} color={Colors.black} />}
                <Text style={styles.deployButtonPrimaryText}>{selfSyncMutation.isPending ? 'Syncing…' : 'Sync ALL credentials now'}</Text>
              </Pressable>
              <Pressable
                style={[styles.deployButtonSecondary, selfSyncMutation.isPending ? styles.buttonDisabled : null]}
                disabled={selfSyncMutation.isPending}
                onPress={() => handleSelfSync(false)}
                testID="ivx-owner-variables-self-sync-missing-only"
              >
                <Text style={styles.deployButtonSecondaryText}>Sync only missing</Text>
              </Pressable>
            </View>
            {lastSelfSync ? (
              <View style={styles.proofGrid}>
                <Text style={styles.proofText}>Synced: {lastSelfSync.summary.syncedCount}/{lastSelfSync.summary.candidatesChecked}</Text>
                <Text style={styles.proofText}>Skipped existing: {lastSelfSync.summary.skippedExistingCount}</Text>
                <Text style={styles.proofText}>Missing on backend env: {lastSelfSync.summary.missingInEnvCount}</Text>
                <Text style={styles.proofText}>Errors: {lastSelfSync.summary.errorCount}</Text>
                <Text style={styles.proofText}>Time: {formatTime(lastSelfSync.timestamp)}</Text>
                {lastSelfSync.results.slice(0, 16).map((item) => (
                  <Text key={`self-sync-${item.name}`} style={styles.proofText}>
                    {item.name}: {item.action}{item.maskedPreview ? ` — ${item.maskedPreview}` : ''}{item.sourceEnvName && item.sourceEnvName !== item.name ? ` (from ${item.sourceEnvName})` : ''}
                  </Text>
                ))}
                {lastSelfSync.error ? <Text style={styles.errorText}>{lastSelfSync.error}</Text> : null}
              </View>
            ) : (
              <Text style={styles.securityNote}>Owner session token authorizes this sync. Phone never transmits raw secrets — the backend uses its own saved env values and returns only masked previews like ghp_****1234.</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Rocket size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Deploy backend now</Text>
                <Text style={styles.cardSubtitle}>Triggers Render deploy of the IVX backend using\u2019s RENDER_API_KEY + RENDER_SERVICE_ID. Pinned to https://api.ivxholding.com The public landing site is never touched.</Text>
              </View>
            </View>
            <View style={styles.deployButtonRow}>
              <Pressable
                style={[styles.deployButtonPrimary, deployMutation.isPending ? styles.buttonDisabled : null]}
                disabled={deployMutation.isPending}
                onPress={() => handleTriggerDeploy(false)}
                testID="ivx-owner-render-deploy-trigger"
              >
                {deployMutation.isPending ? <ShimmerIndicator size="small" color={Colors.black} /> : <Rocket size={15} color={Colors.black} />}
                <Text style={styles.deployButtonPrimaryText}>{deployMutation.isPending ? 'Triggering deploy…' : 'Deploy backend now'}</Text>
              </Pressable>
              <Pressable
                style={[styles.deployButtonSecondary, deployMutation.isPending ? styles.buttonDisabled : null]}
                disabled={deployMutation.isPending}
                onPress={() => handleTriggerDeploy(true)}
                testID="ivx-owner-render-deploy-trigger-clear-cache"
              >
                <Text style={styles.deployButtonSecondaryText}>Deploy + clear cache</Text>
              </Pressable>
            </View>
            {lastDeploy ? (
              <View style={styles.proofGrid}>
                <Text style={styles.proofText}>Endpoint: {lastDeploy.endpoint}</Text>
                <Text style={styles.proofText}>HTTP: {lastDeploy.httpStatus}</Text>
                <Text style={styles.proofText}>Service ID: {lastDeploy.serviceId ?? 'unknown'}</Text>
                <Text style={styles.proofText}>Deploy ID: {lastDeploy.deployId ?? 'pending'}</Text>
                <Text style={styles.proofText}>Status: {lastDeploy.deployStatus ?? (lastDeploy.ok ? 'accepted' : 'failed')}</Text>
                <Text style={styles.proofText}>Time: {formatTime(lastDeploy.timestamp)}</Text>
                {lastDeploy.error ? <Text style={styles.errorText}>{lastDeploy.error}</Text> : null}
              </View>
            ) : (
              <Text style={styles.securityNote}>Owner session token is used to authorize this deploy. Secrets are never sent from the phone \u2014 the backend uses its own saved RENDER_API_KEY.</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Sparkles size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Tracked credential metadata</Text>
                <Text style={styles.cardSubtitle}>Single source of truth for safe metadata across external dependencies, Render, Supabase, AWS, AI, and storage. Secret values are never displayed, logged, or returned.</Text>
              </View>
            </View>
            <View style={styles.summaryGrid}>
              <SummaryStat label="Synced" value={`${trackedSummary.synced}/${trackedSummary.total}`} tone="primary" />
              <SummaryStat label="Runtime verified" value={`${trackedSummary.runtimeVerified}`} tone="success" />
              <SummaryStat label="Present, not verified" value={`${trackedSummary.presentNotVerified}`} tone="warning" />
              <SummaryStat label="Missing" value={`${trackedSummary.missing}`} tone="danger" />
              <SummaryStat label="Rollback-only" value={`${trackedSummary.rollbackOnly}`} tone="muted" />
              <SummaryStat label="Dev-only" value={`${trackedSummary.devOnly}`} tone="muted" />
              <SummaryStat label="Safe to remove" value={`${trackedSummary.safeToRemove}`} tone="muted" />
              <SummaryStat label="Owner action" value={`${trackedSummary.ownerActionRequired}`} tone="warning" />
            </View>
            <View style={styles.trackedList}>
              {trackedRows.map((row) => (
                <TrackedVariableRow key={row.metadata.name} row={row} />
              ))}
            </View>
            <Text style={styles.securityNote}>Metadata only: name, category, source, presence, runtime readability, verification timestamp, feature unlocked, and action required. Secret values are never displayed, logged, or returned.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <KeyRound size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Provider tests</Text>
                <Text style={styles.cardSubtitle}>Tests verify external access and store only status, time, provider, and variable name in audit logs.</Text>
              </View>
            </View>
            <View style={styles.providerGrid}>
              {providerNames.map((provider) => (
                <View key={provider} style={styles.providerWrapper}>
                  <ProviderCard status={status} provider={provider} />
                  <Pressable
                    style={[styles.providerTestButton, isMutating ? styles.buttonDisabled : null]}
                    disabled={isMutating}
                    onPress={() => handleTestProvider(provider)}
                    testID={`ivx-owner-provider-test-${provider}`}
                  >
                    <Text style={styles.providerTestButtonText}>Test {getProviderLabel(provider)}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <KeyRound size={18} color={Colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>Add / update credentials</Text>
                <Text style={styles.cardSubtitle}>Inputs are masked for secret fields. Leave a field blank unless you want to replace that one credential.</Text>
              </View>
            </View>
            <View style={styles.inputList}>
              {variables.map((variable) => (
                <VariableRow
                  key={variable.name}
                  variable={variable}
                  draftValue={draftValues[variable.name] ?? ''}
                  onChangeDraft={updateDraftValue}
                  onSave={handleSave}
                  onTest={(name) => testMutation.mutate({ name })}
                  onReverify={handleReverify}
                  onDelete={handleDelete}
                  busyAction={busyAction}
                  anyBusy={anyBusy}
                />
              ))}
            </View>
            <Text style={styles.securityNote}>Security proof: UI/API responses show only name, provider, status, last tested time, and masked preview like ghp_****1234. Raw secrets are never returned.</Text>
          </View>
        </ScrollView>
        <Toast toast={toast} />
      </KeyboardAvoidingView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  content: {
    padding: 16,
    gap: 14},
  heroCard: {
    padding: 20,
    borderRadius: 30,
    backgroundColor: '#071019',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)',
    gap: 12},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  heroBadgeText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  heroTitle: {
    color: Colors.text,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '900' as const},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600' as const},
  heroPills: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8},
  securityPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1},
  securityPillPass: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.3)'},
  securityPillWarn: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.3)'},
  securityPillText: {
    fontSize: 11,
    fontWeight: '800' as const},
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14},
  cardHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  cardHeaderCopy: {
    flex: 1,
    gap: 3},
  cardTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '900' as const},
  cardSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const},
  refreshButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  refreshButtonText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const},
  loadingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  mutedText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  errorText: {
    color: Colors.error,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700' as const},
  proofGrid: {
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  proofText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700' as const},
  providerGrid: {
    gap: 10},
  providerWrapper: {
    gap: 8},
  providerCard: {
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 7},
  providerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  providerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '900' as const},
  providerDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const},
  providerMuted: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const},
  providerTestButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)'},
  providerTestButtonText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '900' as const},
  inputList: {
    gap: 12},
  variableCard: {
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  variableTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  variableNameBlock: {
    flex: 1,
    gap: 3},
  variableName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '900' as const},
  variableDescription: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const},
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4},
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase'},
  variableMetaGrid: {
    gap: 4},
  metaText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const},
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  input: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.inputBackground,
    color: Colors.text,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '700' as const},
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.primary},
  buttonDisabled: {
    opacity: 0.44},
  rowActions: {
    flexDirection: 'row' as const,
    gap: 8},
  secondaryButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: Colors.border},
  secondaryButtonText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '900' as const},
  dangerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.24)'},
  dangerButtonText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '900' as const},
  actionFlex: {
    flex: 1,
    justifyContent: 'center' as const},
  reverifyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)'},
  reverifyButtonText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '900' as const},
  toast: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    bottom: 28,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#0b1016'},
  toastSuccess: {
    borderColor: 'rgba(34,197,94,0.45)'},
  toastError: {
    borderColor: 'rgba(239,68,68,0.45)'},
  toastText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800' as const},
  deployButtonRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10},
  deployButtonPrimary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  deployButtonPrimaryText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '900' as const},
  deployButtonSecondary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.32)'},
  deployButtonSecondaryText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '900' as const},
  securityNote: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700' as const},
  summaryGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8},
  summaryStat: {
    minWidth: 96,
    flexGrow: 1,
    flexBasis: '22%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.035)',
    gap: 4},
  summaryStatValue: {
    fontSize: 18,
    fontWeight: '900' as const},
  summaryStatLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4},
  trackedList: {
    gap: 10},
  trackedCard: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)'},
  metadataPillRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6},
  metadataPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1},
  metadataPillText: {
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.3},
  metadataNoteRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6}});
