/**
 * IVX IA Chat Execution Mode — Live-polling hook
 *
 * Streams real worker state into the chat execution console. The status
 * endpoint returns the durable worker job shape, while the initial owner-chat
 * response may return the normalized execution-status shape. This hook accepts
 * BOTH shapes so the UI keeps advancing instead of getting stuck on the first
 * state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const BASE_URL = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

export type IVXChatExecutionStatus = {
  taskId: string;
  status: string;
  stage: string;
  stageDetail: string;
  liveProgress: number;
  filesChanged: string[];
  tests: { run: boolean; passed: boolean; command: string | null };
  commitSha: string | null;
  deploymentId: string | null;
  evidence: {
    deployedToProduction: boolean;
    liveCommit: string | null;
    commitMatch: boolean;
    healthOk: boolean;
    typecheck: { run: boolean; passed: boolean };
    buildRun: boolean;
    finalStatus: string;
    error: string | null;
    answerBlock: string;
  } | null;
  httpStatus: 200 | 202;
  category: string | null;
  statusUrl: string;
  generatedAt: string;
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResultEvidence(result: Record<string, unknown> | null): IVXChatExecutionStatus['evidence'] {
  if (!result) return null;
  const terminalEvidence = isRecord(result.evidence) ? result.evidence : null;
  if (terminalEvidence) {
    const typecheck = isRecord(terminalEvidence.typecheck) ? terminalEvidence.typecheck : {};
    return {
      deployedToProduction: terminalEvidence.deployedToProduction === true,
      liveCommit: typeof terminalEvidence.liveCommit === 'string' ? terminalEvidence.liveCommit : null,
      commitMatch: terminalEvidence.commitMatch === true,
      healthOk: terminalEvidence.healthOk === true,
      typecheck: {
        run: typecheck.run === true,
        passed: typecheck.passed === true,
      },
      buildRun: terminalEvidence.buildRun === true,
      finalStatus: typeof terminalEvidence.finalStatus === 'string' ? terminalEvidence.finalStatus : 'UNKNOWN',
      error: typeof terminalEvidence.error === 'string' ? terminalEvidence.error : null,
      answerBlock: typeof terminalEvidence.answerBlock === 'string' ? terminalEvidence.answerBlock : '',
    };
  }

  const finalStatus = typeof result.finalStatus === 'string' ? result.finalStatus : null;
  if (!finalStatus) return null;
  return {
    deployedToProduction: result.endToEndProductionComplete === true && result.commitMatch === true && result.healthOk === true,
    liveCommit: typeof result.liveCommit === 'string' ? result.liveCommit : null,
    commitMatch: result.commitMatch === true,
    healthOk: result.healthOk === true,
    typecheck: {
      run: result.typecheckRun === true,
      passed: result.testsPassed === true,
    },
    buildRun: result.buildRun === true,
    finalStatus,
    error: typeof result.error === 'string' ? result.error : null,
    answerBlock: typeof result.answerBlock === 'string' ? result.answerBlock : '',
  };
}

function coerceStatus(payload: unknown): IVXChatExecutionStatus | null {
  if (!isRecord(payload)) return null;

  // Accept either the normalized execution-status payload or the raw durable
  // worker job returned by GET /worker/jobs/:id.
  const taskId = typeof payload.taskId === 'string'
    ? payload.taskId
    : typeof payload.jobId === 'string'
      ? payload.jobId
      : null;
  if (!taskId) return null;

  const result = isRecord(payload.result) ? payload.result : null;
  const testsRaw = isRecord(payload.tests) ? payload.tests : {};
  const filesChanged = Array.isArray(payload.filesChanged)
    ? payload.filesChanged.filter((f): f is string => typeof f === 'string')
    : Array.isArray(result?.changedFiles)
      ? result.changedFiles.filter((f): f is string => typeof f === 'string')
      : [];

  const status = typeof payload.status === 'string' ? payload.status : 'unknown';
  const stage = typeof payload.stage === 'string' ? payload.stage : 'UNKNOWN';
  const stageDetail = typeof payload.stageDetail === 'string' && payload.stageDetail.trim()
    ? payload.stageDetail.trim()
    : stage;
  const isTerminal = TERMINAL_STATUSES.has(status);

  const testsRun = typeof testsRaw.run === 'boolean' ? testsRaw.run : result?.testsRun === true;
  const testsPassed = typeof testsRaw.passed === 'boolean' ? testsRaw.passed : result?.testsPassed === true;

  return {
    taskId,
    status,
    stage,
    stageDetail,
    liveProgress: typeof payload.liveProgress === 'number'
      ? payload.liveProgress
      : typeof payload.progressPercent === 'number'
        ? payload.progressPercent
        : 0,
    filesChanged,
    tests: {
      run: testsRun,
      passed: testsPassed,
      command: typeof testsRaw.command === 'string'
        ? testsRaw.command
        : testsRun
          ? 'worker validation suite'
          : null,
    },
    commitSha: typeof payload.commitSha === 'string'
      ? payload.commitSha
      : typeof result?.commitSha === 'string'
        ? result.commitSha
        : null,
    deploymentId: typeof payload.deploymentId === 'string'
      ? payload.deploymentId
      : typeof result?.deployId === 'string'
        ? result.deployId
        : null,
    evidence: readResultEvidence(payload.evidence && isRecord(payload.evidence) ? { evidence: payload.evidence } : result),
    httpStatus: payload.httpStatus === 200 || isTerminal ? 200 : 202,
    category: typeof payload.category === 'string' ? payload.category : null,
    statusUrl: typeof payload.statusUrl === 'string' && payload.statusUrl.trim()
      ? payload.statusUrl
      : `/api/ivx/senior-developer/worker/jobs/${taskId}`,
    generatedAt: typeof payload.generatedAt === 'string'
      ? payload.generatedAt
      : typeof payload.lastHeartbeatAt === 'string'
        ? payload.lastHeartbeatAt
        : typeof payload.finishedAt === 'string'
          ? payload.finishedAt
          : new Date().toISOString(),
  };
}

type PollState = {
  status: IVXChatExecutionStatus | null;
  polling: boolean;
  error: string | null;
  attempts: number;
};

const DEFAULT_POLL_INTERVAL_MS = 900;
const MAX_POLL_ATTEMPTS = 260;

export function useExecutionStatusPoll(
  initialStatus: IVXChatExecutionStatus | null,
  authToken: string | null,
  options: { pollIntervalMs?: number; maxAttempts?: number } = {},
): PollState & {
  refresh: () => void;
  stop: () => void;
} {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? MAX_POLL_ATTEMPTS;
  const [state, setState] = useState<PollState>({
    status: initialStatus,
    polling: initialStatus !== null && !TERMINAL_STATUSES.has(initialStatus?.status ?? ''),
    error: null,
    attempts: 0,
  });
  const stoppedRef = useRef(false);
  const authTokenRef = useRef(authToken);
  authTokenRef.current = authToken;

  const isTerminal = useCallback((s: IVXChatExecutionStatus | null): boolean => {
    return s !== null && TERMINAL_STATUSES.has(s.status);
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;

  const pollOnce = useCallback(async (): Promise<void> => {
    const current = stateRef.current.status;
    if (!current || stoppedRef.current || isTerminal(current)) {
      setState((prev) => ({ ...prev, polling: false }));
      return;
    }
    const url = current.statusUrl.startsWith('http')
      ? current.statusUrl
      : `${BASE_URL}${current.statusUrl}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
        },
      });
      if (!response.ok) {
        setState((prev) => ({
          ...prev,
          polling: false,
          error: `status endpoint returned ${response.status}`,
          attempts: prev.attempts + 1,
        }));
        stoppedRef.current = true;
        return;
      }
      const body = await response.json().catch(() => null);
      const job = isRecord(body) && isRecord(body.job) ? body.job : isRecord(body) ? body : null;
      const next = coerceStatus(job);
      if (!next) {
        setState((prev) => ({ ...prev, attempts: prev.attempts + 1 }));
        return;
      }
      setState((prev) => ({
        status: next,
        polling: !TERMINAL_STATUSES.has(next.status),
        error: null,
        attempts: prev.attempts + 1,
      }));
      if (TERMINAL_STATUSES.has(next.status)) {
        stoppedRef.current = true;
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'poll failed',
        attempts: prev.attempts + 1,
      }));
    }
  }, [isTerminal]);

  useEffect(() => {
    if (!initialStatus || isTerminal(initialStatus)) return;
    stoppedRef.current = false;
    const intervalId = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
    void pollOnce();
    return () => {
      clearInterval(intervalId);
      stoppedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatus?.taskId, pollIntervalMs]);

  useEffect(() => {
    if (state.attempts >= maxAttempts && state.polling) {
      setState((prev) => ({ ...prev, polling: false, error: prev.error ?? 'poll timeout' }));
      stoppedRef.current = true;
    }
  }, [state.attempts, state.polling, maxAttempts]);

  const refresh = useCallback(() => {
    stoppedRef.current = false;
    setState((prev) => ({ ...prev, polling: true, error: null }));
    void pollOnce();
  }, [pollOnce]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setState((prev) => ({ ...prev, polling: false }));
  }, []);

  return { ...state, refresh, stop };
}

export { coerceStatus as coerceExecutionStatusFromPayload };
export { TERMINAL_STATUSES as EXECUTION_TERMINAL_STATUSES };
