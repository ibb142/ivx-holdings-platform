/**
 * IVX IA Chat Execution Mode — Console Bubble
 *
 * FINAL IVX IA CHAT EXECUTION MODE mandate (owner 2026-07-19):
 *   "For execution requests, the chat becomes an execution console,
 *    not a planning assistant."
 *
 * Renders the strict 9-field execution status payload as a live console
 * bubble: taskId, status, stage, live progress bar, files changed, tests,
 * commit SHA, deployment id, and verified evidence. Polls the worker
 * statusUrl via useExecutionStatusPoll so the bubble updates in real time
 * as the worker drains the queue.
 */
import React, { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  FileCode2,
  GitCommit,
  Loader2,
  Rocket,
  ShieldAlert,
  Terminal,
  XCircle,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  useExecutionStatusPoll,
  type IVXChatExecutionStatus,
} from '../hooks/useExecutionStatusPoll';

const STAGE_LABELS: Record<string, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  PATCHING: 'Patching',
  TESTING: 'Testing',
  COMMITTING: 'Committing',
  DEPLOYING: 'Deploying',
  VERIFYING: 'Verifying',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function statusColor(status: string): string {
  if (status === 'completed') return Colors.success;
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return Colors.error;
  if (status === 'queued') return Colors.info;
  return Colors.primary;
}

function statusIcon(status: string, size: number): React.ReactNode {
  if (status === 'completed') return <CheckCircle2 size={size} color={Colors.success} />;
  if (status === 'failed' || status === 'cancelled') return <XCircle size={size} color={Colors.error} />;
  if (status === 'blocked') return <ShieldAlert size={size} color={Colors.warning} />;
  if (status === 'queued') return <Clock size={size} color={Colors.info} />;
  return <Loader2 size={size} color={Colors.primary} />;
}

type ExecutionConsoleBubbleProps = {
  initialStatus: IVXChatExecutionStatus;
  authToken: string | null;
  categoryLabel?: string;
  onTerminal?: (status: IVXChatExecutionStatus) => void;
};

export const ExecutionConsoleBubble = memo(function ExecutionConsoleBubble({
  initialStatus,
  authToken,
  categoryLabel,
  onTerminal,
}: ExecutionConsoleBubbleProps) {
  const { status, polling, error, attempts } = useExecutionStatusPoll(initialStatus, authToken);

  // Notify the parent once when the job reaches a terminal state so the chat
  // can swap the live-progress bubble for the final verified-evidence block.
  React.useEffect(() => {
    if (status && onTerminal) {
      const terminal =
        status.status === 'completed' ||
        status.status === 'failed' ||
        status.status === 'blocked' ||
        status.status === 'cancelled';
      if (terminal) {
        onTerminal(status);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status, status?.taskId]);

  const evidence = status?.evidence ?? null;
  const liveProgress = status?.liveProgress ?? 0;
  const stage = status?.stage ?? 'UNKNOWN';
  const filesChanged = status?.filesChanged ?? [];
  const tests = status?.tests;
  const commitSha = status?.commitSha ?? null;
  const deploymentId = status?.deploymentId ?? null;
  const taskId = status?.taskId ?? initialStatus.taskId;
  const isTerminal =
    status?.status === 'completed' ||
    status?.status === 'failed' ||
    status?.status === 'blocked' ||
    status?.status === 'cancelled';

  const handleCopyTaskId = useCallback(() => {
    // Copy is optional; the field is already visible for the owner to read.
  }, []);

  const headerLabel = useMemo(() => {
    const cat = categoryLabel ?? status?.category ?? 'execution';
    return `IVX Execution Console · ${cat}`;
  }, [categoryLabel, status?.category]);

  return (
    <View style={styles.wrapper} testID="ivx-execution-console-bubble">
      <View style={styles.header}>
        <Terminal size={14} color={Colors.info} />
        <Text style={styles.headerText}>{headerLabel}</Text>
        {polling ? (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.headerSpinner} />
        ) : null}
      </View>

      <View style={styles.row}>
        {statusIcon(status?.status ?? 'queued', 16)}
        <Text style={styles.label}>Task ID</Text>
        <Pressable onLongPress={handleCopyTaskId} accessible={false}>
          <Text style={styles.monoValue} selectable>{taskId}</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Circle size={16} color={statusColor(status?.status ?? 'queued')} />
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, { color: statusColor(status?.status ?? 'queued') }]}>
          {status?.status ?? 'unknown'}
        </Text>
      </View>

      <View style={styles.row}>
        <Clock size={16} color={Colors.info} />
        <Text style={styles.label}>Stage</Text>
        <Text style={styles.value}>{stageLabel(stage)}</Text>
      </View>

      <View style={styles.progressTrack} testID="ivx-execution-progress-track">
        <View
          style={[styles.progressFill, { width: `${Math.min(Math.max(liveProgress, 0), 100)}%` }]}
          testID="ivx-execution-progress-fill"
        />
        <Text style={styles.progressText}>{liveProgress}%</Text>
      </View>

      <View style={styles.row}>
        <FileCode2 size={16} color={Colors.info} />
        <Text style={styles.label}>Files changed</Text>
        <Text style={styles.value}>{filesChanged.length > 0 ? `${filesChanged.length} file(s)` : '—'}</Text>
      </View>
      {filesChanged.length > 0 ? (
        <View style={styles.fileList}>
          {filesChanged.slice(0, 12).map((file) => (
            <Text key={file} style={styles.fileItem} selectable>· {file}</Text>
          ))}
          {filesChanged.length > 12 ? (
            <Text style={styles.fileItem}>+ {filesChanged.length - 12} more</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        <CheckCircle2
          size={16}
          color={tests?.passed ? Colors.success : tests?.run ? Colors.error : Colors.muted}
        />
        <Text style={styles.label}>Tests</Text>
        <Text style={styles.value}>
          {!tests?.run ? 'NOT RUN' : tests.passed ? 'PASS' : 'FAIL'}
        </Text>
      </View>

      <View style={styles.row}>
        <GitCommit size={16} color={commitSha ? Colors.success : Colors.muted} />
        <Text style={styles.label}>Commit SHA</Text>
        <Text style={styles.monoValue}>{commitSha ? commitSha.slice(0, 12) : '—'}</Text>
      </View>

      <View style={styles.row}>
        <Rocket size={16} color={deploymentId ? Colors.success : Colors.muted} />
        <Text style={styles.label}>Deployment ID</Text>
        <Text style={styles.monoValue}>{deploymentId ?? '—'}</Text>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <AlertCircle size={12} color={Colors.warning} />
          <Text style={styles.errorText}>poll: {error} (attempts: {attempts})</Text>
        </View>
      ) : null}

      {evidence && isTerminal ? (
        <View style={styles.evidenceBlock} testID="ivx-execution-evidence">
          <Text style={styles.evidenceHeader}>Verified evidence</Text>
          <Text style={styles.evidenceLine}>
            deployed_to_production: {evidence.deployedToProduction ? 'true' : 'false'}
          </Text>
          <Text style={styles.evidenceLine}>
            live_commit: {evidence.liveCommit ? evidence.liveCommit.slice(0, 12) : '—'}
          </Text>
          <Text style={styles.evidenceLine}>
            commit_match: {evidence.commitMatch ? 'true' : 'false'}
          </Text>
          <Text style={styles.evidenceLine}>
            /health: {evidence.healthOk ? '200 healthy' : 'not confirmed'}
          </Text>
          <Text style={styles.evidenceLine}>
            typecheck: {!evidence.typecheck.run ? 'NOT RUN' : evidence.typecheck.passed ? 'PASS' : 'FAIL'}
          </Text>
          <Text style={styles.evidenceLine}>
            build_run: {evidence.buildRun ? 'true' : 'false'}
          </Text>
          <Text style={styles.evidenceLine}>final_status: {evidence.finalStatus}</Text>
          {evidence.error ? (
            <Text style={styles.evidenceError}>error: {evidence.error}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(8, 10, 16, 0.92)',
    borderRadius: 14,
    padding: 14,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(72, 120, 200, 0.35)',
    maxWidth: 460,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(72, 120, 200, 0.25)',
  },
  headerText: {
    color: Colors.info,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    flex: 1,
  },
  headerSpinner: {
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  label: {
    color: 'rgba(180, 200, 230, 0.7)',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    minWidth: 96,
  },
  value: {
    color: 'rgba(240, 246, 255, 0.95)',
    fontFamily: 'monospace',
    fontSize: 11,
    flex: 1,
  },
  monoValue: {
    color: 'rgba(240, 246, 255, 0.95)',
    fontFamily: 'monospace',
    fontSize: 11,
    flex: 1,
  },
  progressTrack: {
    height: 10,
    backgroundColor: 'rgba(20, 28, 44, 0.9)',
    borderRadius: 5,
    marginVertical: 8,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primary,
    borderRadius: 5,
  },
  progressText: {
    color: 'rgba(240, 246, 255, 0.95)',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    alignSelf: 'center',
    zIndex: 2,
  },
  fileList: {
    marginTop: 2,
    marginBottom: 6,
    paddingLeft: 24,
  },
  fileItem: {
    color: 'rgba(200, 220, 240, 0.85)',
    fontFamily: 'monospace',
    fontSize: 10,
    paddingVertical: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(200, 80, 80, 0.25)',
  },
  errorText: {
    color: Colors.warning,
    fontFamily: 'monospace',
    fontSize: 10,
    flex: 1,
  },
  evidenceBlock: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(12, 28, 18, 0.55)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(80, 200, 120, 0.35)',
  },
  evidenceHeader: {
    color: Colors.success,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  evidenceLine: {
    color: 'rgba(220, 240, 230, 0.95)',
    fontFamily: 'monospace',
    fontSize: 10,
    paddingVertical: 1,
  },
  evidenceError: {
    color: Colors.error,
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 4,
  },
});