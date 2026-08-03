import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Bot, CheckCircle2, Clock3, Play, RefreshCw, RotateCcw, ShieldCheck, Square, XCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createIVXAgentJob,
  getIVXAgentJobsStatus,
  listIVXAgentJobs,
  runIVXAgentJobAction,
  runIVXAgentWorkerOnce,
  type IVXAgentJob,
  type IVXAgentJobStatus} from '@/src/modules/ivx-developer/agentJobsService';

const STATUS_FILTERS: Array<IVXAgentJobStatus | 'all'> = ['all', 'queued', 'running', 'waiting_approval', 'completed', 'failed', 'canceled'];
const STATUS_LABEL: Record<IVXAgentJobStatus | 'all', string> = {
  all: 'All',
  queued: 'Queued',
  running: 'Running',
  waiting_approval: 'Approval',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled'};
const STATUS_COLOR: Record<IVXAgentJobStatus, string> = {
  queued: Colors.warning,
  running: Colors.blue,
  waiting_approval: Colors.gold,
  completed: Colors.green,
  failed: Colors.error,
  canceled: Colors.textTertiary};

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function stringifyPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

export default function IVXAgentJobsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<IVXAgentJobStatus | 'all'>('all');
  const [prompt, setPrompt] = useState<string>('Block 22 production proof: create a backend job, process it server-side, save logs, and prove it is independent of phone/app/external chat.');
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const jobsKey = useMemo(() => ['ivx-agent-jobs', status] as const, [status]);
  const statusQuery = useQuery({
    queryKey: ['ivx-agent-jobs-status'],
    queryFn: getIVXAgentJobsStatus,
    refetchInterval: 15_000});
  const jobsQuery = useQuery({
    queryKey: jobsKey,
    queryFn: () => listIVXAgentJobs(status),
    refetchInterval: 10_000});

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ivx-agent-jobs-status'] }),
      queryClient.invalidateQueries({ queryKey: ['ivx-agent-jobs'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: () => createIVXAgentJob({
      type: 'block22_production_proof',
      prompt,
      payload: {
        createdFrom: '/admin/ivx-agent-jobs',
        proofRequired: ['server_side_worker', 'job_logs', 'phone_independent', 'rork_chat_independent']},
      approvalRequired: false,
      maxAttempts: 3}),
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await invalidate();
    },
    onError: (error) => Alert.alert('Create job failed', error instanceof Error ? error.message : 'Unknown error')});

  const runOnceMutation = useMutation({
    mutationFn: runIVXAgentWorkerOnce,
    onSuccess: async (result) => {
      await invalidate();
      Alert.alert('Worker tick complete', stringifyPreview(result.result));
    },
    onError: (error) => Alert.alert('Worker tick failed', error instanceof Error ? error.message : 'Unknown error')});

  const actionMutation = useMutation({
    mutationFn: async ({ jobId, action }: { jobId: string; action: 'retry' | 'cancel' | 'approve' }) => {
      setBusyJobId(jobId);
      return await runIVXAgentJobAction(jobId, action);
    },
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await invalidate();
    },
    onError: (error) => Alert.alert('Job action failed', error instanceof Error ? error.message : 'Unknown error'),
    onSettled: () => setBusyJobId(null)});

  const refresh = async (): Promise<void> => {
    await invalidate();
  };

  const renderJob = (job: IVXAgentJob) => {
    const busy = busyJobId === job.id;
    return (
      <View key={job.id} style={styles.jobCard}>
        <View style={styles.jobHeader}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[job.status] }]} />
          <Text style={styles.statusText}>{STATUS_LABEL[job.status]}</Text>
          <View style={styles.typePill}><Text style={styles.typePillText}>{job.type}</Text></View>
        </View>
        <Text style={styles.jobTitle}>{job.prompt}</Text>
        <Text style={styles.metaText}>id: {job.id}</Text>
        <Text style={styles.metaText}>attempts: {job.attempts}/{job.max_attempts} · created: {formatTime(job.created_at)}</Text>
        {job.locked_by ? <Text style={styles.metaText}>worker: {job.locked_by}</Text> : null}
        {job.error ? <Text style={styles.errorText}>{job.error}</Text> : null}
        {job.result ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Result</Text>
            <Text style={styles.monoText} selectable>{stringifyPreview(job.result)}</Text>
          </View>
        ) : null}
        <View style={styles.logBox}>
          <Text style={styles.resultTitle}>Logs ({job.logs.length})</Text>
          {job.logs.slice(-6).map((log) => (
            <Text key={log.id} style={styles.logLine}>
              {formatTime(log.created_at)} · {log.level.toUpperCase()} · {log.step}: {log.message}
            </Text>
          ))}
          {job.logs.length === 0 ? <Text style={styles.logLine}>No logs saved yet.</Text> : null}
        </View>
        <View style={styles.actionRow}>
          {job.status === 'waiting_approval' ? (
            <Pressable
              onPress={() => actionMutation.mutate({ jobId: job.id, action: 'approve' })}
              disabled={busy}
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              testID={`block22-approve-${job.id}`}
            >
              <CheckCircle2 size={12} color={Colors.background} />
              <Text style={styles.actionBtnTextDark}>Approve</Text>
            </Pressable>
          ) : null}
          {job.status === 'failed' || job.status === 'canceled' || job.status === 'completed' ? (
            <Pressable
              onPress={() => actionMutation.mutate({ jobId: job.id, action: 'retry' })}
              disabled={busy}
              style={styles.actionBtn}
              testID={`block22-retry-${job.id}`}
            >
              <RotateCcw size={12} color={Colors.gold} />
              <Text style={styles.actionBtnText}>Retry</Text>
            </Pressable>
          ) : null}
          {job.status !== 'completed' && job.status !== 'canceled' ? (
            <Pressable
              onPress={() => actionMutation.mutate({ jobId: job.id, action: 'cancel' })}
              disabled={busy}
              style={styles.actionBtn}
              testID={`block22-cancel-${job.id}`}
            >
              <XCircle size={12} color={Colors.error} />
              <Text style={[styles.actionBtnText, { color: Colors.error }]}>Cancel</Text>
            </Pressable>
          ) : null}
          {busy ? <ShimmerIndicator size="small" color={Colors.gold} /> : null}
        </View>
      </View>
    );
  };

  const jobs = jobsQuery.data?.jobs ?? [];
  const worker = statusQuery.data?.worker;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerTitleRow}>
            <Bot size={16} color={Colors.gold} />
            <Text style={styles.headerTitle}>IVX Agent Jobs</Text>
          </View>
          <Text style={styles.headerSub}>Block 22 · backend worker runtime</Text>
        </View>
        <View style={styles.headerBadge}>
          <ShieldCheck size={12} color={Colors.green} />
          <Text style={styles.headerBadgeText}>OWNER</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroLine}>
            <Clock3 size={14} color={Colors.gold} />
            <Text style={styles.heroPrompt}>server-side, not phone-side</Text>
          </View>
          <Text style={styles.heroText}>
            Jobs are stored in Supabase, picked by the backend worker loop, and logged in
            ivx_agent_job_logs. The app can create/approve work, but the server does the run.
          </Text>
        </View>

        <View style={styles.workerCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Worker status</Text>
            <Pressable onPress={refresh} style={styles.smallBtn} testID="block22-refresh">
              <RefreshCw size={12} color={Colors.gold} />
              <Text style={styles.smallBtnText}>Refresh</Text>
            </Pressable>
          </View>
          {statusQuery.isLoading ? <ShimmerIndicator color={Colors.gold} /> : null}
          {worker ? (
            <>
              <Text style={styles.workerLine}>loop: {worker.loopStarted ? 'started' : 'stopped'} · serverSide: {worker.serverSide ? 'yes' : 'no'}</Text>
              <Text style={styles.workerLine}>phone independent: {worker.independentOfPhone ? 'yes' : 'no'} · external chat independent: {worker.independentOfRorkChat ? 'yes' : 'no'}</Text>
              <Text style={styles.workerLine}>last tick: {formatTime(worker.lastTickAt)} · in flight: {worker.inFlight ? 'yes' : 'no'}</Text>
              <Text style={styles.workerLine}>tables: {(statusQuery.data?.tables ?? []).join(', ')}</Text>
            </>
          ) : statusQuery.error ? <Text style={styles.errorText}>{(statusQuery.error as Error).message}</Text> : null}
          <Pressable
            onPress={() => runOnceMutation.mutate()}
            disabled={runOnceMutation.isPending}
            style={[styles.primaryWideBtn, runOnceMutation.isPending && styles.disabledBtn]}
            testID="block22-run-worker-once"
          >
            {runOnceMutation.isPending ? <ShimmerIndicator size="small" color={Colors.background} /> : <Play size={14} color={Colors.background} />}
            <Text style={styles.primaryWideBtnText}>Run worker once</Text>
          </Pressable>
        </View>

        <View style={styles.createCard}>
          <Text style={styles.sectionTitle}>Create production proof job</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="Describe the backend job"
            placeholderTextColor={Colors.textTertiary}
            style={styles.input}
            testID="block22-job-prompt"
          />
          <Pressable
            onPress={() => createMutation.mutate()}
            disabled={createMutation.isPending || !prompt.trim()}
            style={[styles.primaryWideBtn, (createMutation.isPending || !prompt.trim()) && styles.disabledBtn]}
            testID="block22-create-job"
          >
            {createMutation.isPending ? <ShimmerIndicator size="small" color={Colors.background} /> : <Play size={14} color={Colors.background} />}
            <Text style={styles.primaryWideBtnText}>Create queued job</Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((item) => (
            <Pressable
              key={item}
              onPress={() => setStatus(item)}
              style={[styles.filterChip, status === item && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, status === item && styles.filterChipTextActive]}>{STATUS_LABEL[item]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Jobs ({jobs.length})</Text>
          {jobsQuery.isFetching ? <ShimmerIndicator size="small" color={Colors.gold} /> : null}
        </View>
        {jobsQuery.error ? <Text style={styles.errorText}>{(jobsQuery.error as Error).message}</Text> : null}
        {jobs.length === 0 && !jobsQuery.isLoading ? (
          <View style={styles.emptyCard}>
            <Square size={16} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No jobs in this status yet.</Text>
          </View>
        ) : jobs.map(renderJob)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  headerBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  headerBadgeText: { color: Colors.green, fontSize: 10, fontWeight: '800' as const },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  heroCard: { backgroundColor: '#101307', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)', padding: 16 },
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heroPrompt: { color: Colors.gold, fontSize: 12, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.9 },
  heroText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  workerCard: { backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 8 },
  createCard: { backgroundColor: Colors.surfaceElevated, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: Colors.text, fontSize: 15, fontWeight: '800' as const },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: '#1C1A0C', borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)' },
  smallBtnText: { color: Colors.gold, fontSize: 12, fontWeight: '700' as const },
  workerLine: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  primaryWideBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 16, backgroundColor: Colors.gold, marginTop: 6 },
  primaryWideBtnText: { color: Colors.background, fontSize: 14, fontWeight: '800' as const },
  disabledBtn: { opacity: 0.55 },
  input: { minHeight: 96, color: Colors.text, backgroundColor: Colors.inputBackground, borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: 16, padding: 12, textAlignVertical: 'top' as const, fontSize: 13, lineHeight: 18 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: '#1C1A0C', borderColor: 'rgba(255,215,0,0.45)' },
  filterChipText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '700' as const },
  filterChipTextActive: { color: Colors.gold },
  jobCard: { backgroundColor: Colors.card, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 9 },
  jobHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: Colors.text, fontSize: 11, fontWeight: '900' as const, textTransform: 'uppercase' as const },
  typePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: Colors.surfaceLight },
  typePillText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' as const },
  jobTitle: { color: Colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700' as const },
  metaText: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16 },
  errorText: { color: Colors.error, fontSize: 12, lineHeight: 17 },
  resultBox: { backgroundColor: '#09130D', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', padding: 10, gap: 6 },
  logBox: { backgroundColor: '#0B0B0B', borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 10, gap: 5 },
  resultTitle: { color: Colors.text, fontSize: 12, fontWeight: '800' as const },
  monoText: { color: Colors.green, fontFamily: 'monospace', fontSize: 11, lineHeight: 15 },
  logLine: { color: Colors.textSecondary, fontFamily: 'monospace', fontSize: 10, lineHeight: 15 },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8, marginTop: 2 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  actionBtnPrimary: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  actionBtnText: { color: Colors.text, fontSize: 12, fontWeight: '800' as const },
  actionBtnTextDark: { color: Colors.background, fontSize: 12, fontWeight: '900' as const },
  emptyCard: { minHeight: 90, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: Colors.textTertiary, fontSize: 13 }});
