import React, { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import * as Haptics from 'expo-haptics';
import { CheckCircle2, PlayCircle, RefreshCw, Server, ShieldCheck, XCircle } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { buildSeniorDeveloperJobDraft } from '@/src/modules/ivx-developer/seniorDeveloperBuildIntent';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getSeniorDeveloperWorkerLastProof,
  getSeniorDeveloperWorkerStatus,
  listSeniorDeveloperWorkerJobs,
  listSeniorDeveloperWorkerLedger,
  pollSeniorDeveloperWorkerJob,
  submitSeniorDeveloperWorkerJob,
  type WorkerJobFinalStatus,
  type WorkerJobView,
  type WorkerLastProof,
  type WorkerLedgerEntry,
  type WorkerStatus} from '@/src/modules/ivx-developer/seniorDeveloperWorkerService';

const ONE_TAP_PROOF_REQUEST =
  'Build module IVX Worker Proof: create a new route, screen, backend endpoint, service helper, and test, then deploy live and return proof.';

/** Exact owner request submitted by the "Run final IVX proof" action. */
const FINAL_PROOF_REQUEST = 'build login page';

const PROOF_QUERY_KEY = ['ivx-developer', 'worker-proof'] as const;

/**
 * Build the final-proof job draft from the exact "build login page" request and
 * force the production-deploy path so the worker commits, pushes, deploys, and
 * returns a real commit hash + deploy ID + health 200 (not local-only).
 */
function buildFinalProofDraft(): ReturnType<typeof buildSeniorDeveloperJobDraft> {
  const base = buildSeniorDeveloperJobDraft(FINAL_PROOF_REQUEST);
  return {
    ...base,
    requestsDeploy: true,
    proposedPlan: [
      '1. Read the repository and locate the login screen + route files.',
      '2. Create the login page (route, screen, form, and supporting service).',
      '3. Add a focused test for the login flow.',
      '4. Run tests + typecheck + build.',
      '5. Commit, push to GitHub, trigger a Render deploy, then verify /health (200) and /version commit match.',
    ].join('\n'),
    rollbackPlan:
      'Revert the worker commit on GitHub and trigger a redeploy of the previous commit; the worker records the prior commit hash in the proof ledger.'};
}

type WorkerProofData = {
  status: WorkerStatus;
  jobs: WorkerJobView[];
  ledger: WorkerLedgerEntry[];
  lastProof: WorkerLastProof | null;
};

async function fetchWorkerProof(): Promise<WorkerProofData> {
  const [status, jobs, ledger, lastProof] = await Promise.all([
    getSeniorDeveloperWorkerStatus(),
    listSeniorDeveloperWorkerJobs(),
    listSeniorDeveloperWorkerLedger(),
    getSeniorDeveloperWorkerLastProof(),
  ]);
  return { status, jobs, ledger, lastProof };
}

function dash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

function statusColor(status: WorkerJobFinalStatus | 'queued' | 'running' | 'completed' | 'failed' | 'blocked'): string {
  switch (status) {
    case 'COMPLETE':
    case 'completed':
      return Colors.success;
    case 'LOCAL_ONLY':
    case 'running':
    case 'queued':
    case 'RUNNING':
      return Colors.warning;
    case 'FAILED':
    case 'failed':
      return Colors.error;
    case 'BLOCKED':
    case 'blocked':
      return Colors.info;
    default:
      return Colors.textSecondary;
  }
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]} selectable numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function IVXWorkerProofRoute() {
  const queryClient = useQueryClient();
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const query = useQuery<WorkerProofData, Error>({
    queryKey: PROOF_QUERY_KEY,
    queryFn: fetchWorkerProof,
    staleTime: 0});

  const handleRefresh = useCallback((): void => {
    void query.refetch();
  }, [query]);

  const oneTapJob = useMutation<string, Error, void>({
    mutationFn: async (): Promise<string> => {
      setJobStatus('Submitting one-tap proof job to the self-hosted worker…');
      const draft = buildSeniorDeveloperJobDraft(ONE_TAP_PROOF_REQUEST);
      const submit = await submitSeniorDeveloperWorkerJob(draft);
      if (submit.statusCode !== 'SUBMITTED' || !submit.jobId) {
        throw new Error(
          submit.statusCode === 'OWNER_APPROVAL_REQUIRED'
            ? 'Owner sign-in required. Sign in as the IVX owner, then run the job.'
            : submit.statusCode === 'DEPLOY_SECRETS_MISSING'
              ? 'Worker cannot commit/deploy: GitHub/Render secrets are not configured in the production runtime.'
              : `Worker unavailable${submit.reason ? `: ${submit.reason}` : '.'}`,
        );
      }
      setJobStatus(`Job ${submit.jobId} submitted. Polling for completion…`);
      const finished = await pollSeniorDeveloperWorkerJob(submit.jobId, { intervalMs: 4000, timeoutMs: 180000 });
      const result = finished?.result ?? null;
      const finalStatus = result?.finalStatus ?? finished?.status.toUpperCase() ?? 'RUNNING';
      return `Job ${submit.jobId} → ${finalStatus} · commit ${result?.commitSha ?? 'none'} · deploy ${result?.deployId ?? 'none'} · health ${result?.healthStatus ?? 'none'}`;
    },
    onSuccess: (summary) => {
      setJobStatus(summary);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: PROOF_QUERY_KEY });
    },
    onError: (error) => {
      setJobStatus(error.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }});

  const handleRunOneTapJob = useCallback((): void => {
    if (oneTapJob.isPending) return;
    Alert.alert(
      'Create IVX Worker Proof module',
      'Submit this as an owner-approved job to the self-hosted Senior Developer Worker? It will create a new route, screen, backend endpoint, service helper, and test, then deploy and return proof.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve + Run', onPress: () => { oneTapJob.mutate(); } },
      ],
    );
  }, [oneTapJob]);

  const finalProofJob = useMutation<string, Error, void>({
    mutationFn: async (): Promise<string> => {
      setJobStatus(`Submitting final proof job ("${FINAL_PROOF_REQUEST}") to the self-hosted worker using your owner session…`);
      const draft = buildFinalProofDraft();
      const submit = await submitSeniorDeveloperWorkerJob(draft);
      if (submit.statusCode !== 'SUBMITTED' || !submit.jobId) {
        throw new Error(
          submit.statusCode === 'OWNER_APPROVAL_REQUIRED'
            ? 'OWNER_APPROVAL_REQUIRED — sign in as the IVX owner, then tap Run final IVX proof again.'
            : submit.statusCode === 'DEPLOY_SECRETS_MISSING'
              ? 'DEPLOY_SECRETS_MISSING — GitHub/Render secrets are not configured in the production runtime.'
              : `WORKER_UNAVAILABLE${submit.reason ? `: ${submit.reason}` : '.'}`,
        );
      }
      setJobStatus(`OWNER_CONFIRMED=true · Job ${submit.jobId} submitted. Polling for completion…`);
      const finished = await pollSeniorDeveloperWorkerJob(submit.jobId, { intervalMs: 4000, timeoutMs: 240000 });
      const result = finished?.result ?? null;
      const finalStatus = result?.finalStatus ?? finished?.status.toUpperCase() ?? 'RUNNING';
      return [
        `JOB_ID=${submit.jobId}`,
        `COMMIT_SHA=${result?.commitSha ?? 'none'}`,
        `DEPLOY_ID=${result?.deployId ?? 'none'}`,
        `HEALTH_STATUS=${result?.healthStatus ?? 'none'}`,
        `VERSION_MATCH=${result?.commitMatch ? 'YES' : 'NO'}`,
        `OWNER_CONFIRMED=true`,
        `SYSTEM_STATUS=${finalStatus === 'COMPLETE' ? 'COMPLETE' : finalStatus}`,
      ].join('  ·  ');
    },
    onSuccess: (summary) => {
      setJobStatus(summary);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: PROOF_QUERY_KEY });
    },
    onError: (error) => {
      setJobStatus(error.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }});

  const handleRunFinalProof = useCallback((): void => {
    if (finalProofJob.isPending) return;
    Alert.alert(
      'Run final IVX proof',
      `Submit "${FINAL_PROOF_REQUEST}" as an owner-approved job to the self-hosted Senior Developer Worker, deploy live, and write the proof ledger? This uses your signed-in owner session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve + Run (/confirm)', onPress: () => { finalProofJob.mutate(); } },
      ],
    );
  }, [finalProofJob]);

  const data = query.data ?? null;
  const failedJobs = (data?.jobs ?? []).filter((job) => job.status === 'failed' || job.status === 'blocked');
  const latestJob = data?.jobs[0] ?? null;
  const lastProof = data?.lastProof ?? null;

  return (
    <ErrorBoundary fallbackTitle="Worker Proof unavailable">
      <View style={styles.container} testID="ivx-worker-proof-screen">
        <Stack.Screen
          options={{
            title: 'Senior Developer Worker',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.text}}
        />
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
        >
          <View style={styles.headerRow}>
            <ShieldCheck color={Colors.primary} size={24} />
            <Text style={styles.headerTitle}>Self-Hosted Worker Proof</Text>
          </View>
          <Text style={styles.headerSub}>
            Owner-only view of the self-hosted Senior Developer Worker: live status, queue, latest job,
            latest commit/deploy, health, version match, and the durable proof ledger. Every value is read
            from the owner-gated worker API — no fabricated commits or deploy IDs.
          </Text>

          <Pressable
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={query.isFetching}
            accessibilityRole="button"
            testID="worker-proof-refresh"
          >
            {query.isFetching ? (
              <ShimmerIndicator color={Colors.black} />
            ) : (
              <>
                <RefreshCw size={16} color={Colors.black} />
                <Text style={styles.refreshButtonText}>Refresh / retry</Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={[styles.finalProofButton, finalProofJob.isPending ? styles.oneTapButtonDisabled : null]}
            onPress={handleRunFinalProof}
            disabled={finalProofJob.isPending}
            accessibilityRole="button"
            accessibilityLabel="Run final IVX proof: build login page and deploy live"
            testID="worker-proof-final-proof"
          >
            {finalProofJob.isPending ? (
              <ShimmerIndicator color={Colors.black} />
            ) : (
              <ShieldCheck size={18} color={Colors.black} />
            )}
            <Text style={styles.finalProofButtonText}>
              {finalProofJob.isPending ? 'Running final proof…' : 'Run final IVX proof (build login page)'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.oneTapButton, oneTapJob.isPending ? styles.oneTapButtonDisabled : null]}
            onPress={handleRunOneTapJob}
            disabled={oneTapJob.isPending}
            accessibilityRole="button"
            accessibilityLabel="Run one-tap Create IVX Worker Proof module job"
            testID="worker-proof-one-tap-job"
          >
            {oneTapJob.isPending ? (
              <ShimmerIndicator color={Colors.primary} />
            ) : (
              <PlayCircle size={18} color={Colors.primary} />
            )}
            <Text style={styles.oneTapButtonText}>
              {oneTapJob.isPending ? 'Running proof job…' : 'One-tap: Create IVX Worker Proof module'}
            </Text>
          </Pressable>

          {jobStatus ? (
            <View style={styles.jobStatusBlock} testID="worker-proof-one-tap-status">
              <Text style={styles.jobStatusText} selectable>{jobStatus}</Text>
            </View>
          ) : null}

          {query.isError ? (
            <View style={styles.errorBlock} testID="worker-proof-error">
              <XCircle color={Colors.error} size={18} />
              <Text style={styles.errorText}>{query.error?.message ?? 'Failed to load worker proof.'}</Text>
            </View>
          ) : null}

          {query.isLoading && !data ? (
            <View style={styles.statusBlock}>
              <ShimmerIndicator color={Colors.primary} />
              <Text style={styles.statusText}>Loading worker status…</Text>
            </View>
          ) : null}

          {data ? (
            <>
              {/* Worker status */}
              <View style={styles.card} testID="worker-proof-status">
                <View style={styles.cardHeader}>
                  <Server size={16} color={Colors.primary} />
                  <Text style={styles.cardTitle}>Worker status</Text>
                </View>
                <StatRow
                  label="Reachable"
                  value={data.status.reachable ? 'YES' : 'NO'}
                  tone={data.status.reachable ? Colors.success : Colors.error}
                />
                <StatRow
                  label="Durable queue"
                  value={data.status.durableQueue ? 'YES (Supabase)' : 'in-memory'}
                  tone={data.status.durableQueue ? Colors.success : Colors.warning}
                />
                <StatRow
                  label="Rork required as executor"
                  value={data.status.externalRequiredAsExecutor ? 'YES' : 'NO (self-hosted)'}
                  tone={data.status.externalRequiredAsExecutor ? Colors.warning : Colors.success}
                />
                <StatRow label="Queue depth" value={String(data.jobs.length)} />
              </View>

              {/* Latest job */}
              <View style={styles.card} testID="worker-proof-latest-job">
                <Text style={styles.cardTitle}>Latest job</Text>
                {latestJob ? (
                  <>
                    <StatRow label="Job ID" value={dash(latestJob.jobId)} />
                    <StatRow
                      label="Status"
                      value={latestJob.status.toUpperCase()}
                      tone={statusColor(latestJob.status)}
                    />
                    <StatRow label="Commit" value={dash(latestJob.result?.commitSha)} />
                    <StatRow label="Deploy ID" value={dash(latestJob.result?.deployId)} />
                    <StatRow
                      label="Health"
                      value={latestJob.result?.healthStatus != null ? String(latestJob.result.healthStatus) : '—'}
                      tone={latestJob.result?.healthOk ? Colors.success : Colors.textSecondary}
                    />
                    <StatRow
                      label="Version match"
                      value={latestJob.result ? (latestJob.result.commitMatch ? 'YES' : 'NO') : '—'}
                      tone={latestJob.result?.commitMatch ? Colors.success : Colors.textSecondary}
                    />
                  </>
                ) : (
                  <Text style={styles.emptyText}>No jobs submitted yet.</Text>
                )}
              </View>

              {/* Last proof (compact ledger read) */}
              <View style={styles.card} testID="worker-proof-last-proof">
                <Text style={styles.cardTitle}>Last proof (ledger)</Text>
                {lastProof && lastProof.lastJobId ? (
                  <>
                    <StatRow label="Job ID" value={dash(lastProof.lastJobId)} />
                    <StatRow label="Commit hash" value={dash(lastProof.lastCommitHash)} />
                    <StatRow label="Deploy ID" value={dash(lastProof.lastDeployId)} />
                    <StatRow
                      label="Health status"
                      value={lastProof.lastHealthStatus != null ? String(lastProof.lastHealthStatus) : '—'}
                      tone={lastProof.lastHealthStatus === 200 ? Colors.success : Colors.textSecondary}
                    />
                    <StatRow
                      label="Version match"
                      value={lastProof.lastVersionMatch ? 'YES' : 'NO'}
                      tone={lastProof.lastVersionMatch ? Colors.success : Colors.textSecondary}
                    />
                    <StatRow label="Completed at" value={dash(lastProof.completedAt)} />
                  </>
                ) : (
                  <Text style={styles.emptyText}>No proof recorded yet.</Text>
                )}
              </View>

              {/* Failed jobs */}
              {failedJobs.length > 0 ? (
                <View style={styles.card} testID="worker-proof-failed">
                  <Text style={styles.cardTitle}>Failed / blocked jobs</Text>
                  {failedJobs.map((job) => (
                    <View key={job.jobId} style={styles.ledgerEntry}>
                      <Text style={[styles.ledgerStatus, { color: statusColor(job.status) }]}>
                        {job.status.toUpperCase()}
                      </Text>
                      <Text style={styles.ledgerJobId}>{job.jobId}</Text>
                      {job.error ? <Text style={styles.ledgerError}>{job.error}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Proof ledger */}
              <View style={styles.card} testID="worker-proof-ledger">
                <Text style={styles.cardTitle}>Proof ledger ({data.ledger.length})</Text>
                {data.ledger.length === 0 ? (
                  <Text style={styles.emptyText}>The durable proof ledger is empty.</Text>
                ) : (
                  data.ledger.map((entry) => (
                    <View key={entry.jobId} style={styles.ledgerEntry}>
                      <View style={styles.ledgerEntryHeader}>
                        <Text style={[styles.ledgerStatus, { color: statusColor(entry.finalStatus) }]}>
                          {entry.finalStatus === 'COMPLETE' ? (
                            <CheckCircle2 size={12} color={Colors.success} />
                          ) : null}{' '}
                          {entry.finalStatus}
                        </Text>
                        <Text style={styles.ledgerDate}>{dash(entry.generatedAt)}</Text>
                      </View>
                      <Text style={styles.ledgerGoal} numberOfLines={2}>
                        {dash(entry.goal)}
                      </Text>
                      <Text style={styles.ledgerMeta}>
                        commit {dash(entry.commitSha)} · deploy {dash(entry.deployId)} · health{' '}
                        {entry.healthStatus != null ? entry.healthStatus : '—'} · match{' '}
                        {entry.commitMatch ? 'YES' : 'NO'}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  scroll: {
    padding: 16,
    gap: 14,
    paddingBottom: 40},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  headerTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: '800' as const,
    flex: 1},
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  refreshButton: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18},
  refreshButtonText: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '800' as const},
  finalProofButton: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18},
  finalProofButtonText: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '800' as const,
    flexShrink: 1},
  oneTapButton: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16},
  oneTapButtonDisabled: {
    opacity: 0.6},
  oneTapButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const,
    flexShrink: 1},
  jobStatusBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    padding: 12},
  jobStatusText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 18},
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12},
  statusText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1},
  errorBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 12},
  errorText: {
    color: Colors.text,
    fontSize: 13,
    flex: 1},
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 8},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  cardTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12},
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '600' as const},
  statValue: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right'},
  ledgerEntry: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 8,
    gap: 3},
  ledgerEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  ledgerStatus: {
    fontSize: 12,
    fontWeight: '800' as const},
  ledgerDate: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontFamily: 'monospace'},
  ledgerJobId: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace'},
  ledgerGoal: {
    color: Colors.text,
    fontSize: 13},
  ledgerMeta: {
    color: Colors.textTertiary,
    fontSize: 11.5,
    fontFamily: 'monospace'},
  ledgerError: {
    color: Colors.error,
    fontSize: 12},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18}});
