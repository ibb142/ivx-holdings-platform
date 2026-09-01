/**
 * IVX IA Chat Execution Mode — Live-polling hook
 *
 * FINAL IVX IA CHAT EXECUTION MODE mandate (owner 2026-07-19):
 *   "Stream live execution status."
 *
 * When the backend returns HTTP 202 + `executionStatus` payload for an
 * execution-mode prompt (fix/build/deploy/audit/QA/refactor/migration/
 * create module/create app/senior developer), the Expo chat renders a
 * live-polling execution console bubble. This hook polls the worker job
 * statusUrl on an interval and updates the bubble with the real stage,
 * progress %, files changed, tests, commitSha, deployId, and verified
 * evidence — never fabricated.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// IVX canonical API base. Reads EXPO_PUBLIC_IVX_API_BASE_URL (owner-AI routing
// env) with a fallback to the production host, matching the rest of the app
// (see expo/lib/ivx-supabase-client.ts, expo/lib/video-feed.ts, etc.).
const BASE_URL = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

export type IVXChatExecutionStatus = {
  taskId: string;
  status: string;
  stage: string;
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

function coerceStatus(payload: unknown): IVXChatExecutionStatus | null {
  if (!isRecord(payload)) return null;
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
  const statusUrl = typeof payload.statusUrl === 'string' ? payload.statusUrl : null;
  if (!taskId || !statusUrl) return null;
  const testsRaw = isRecord(payload.tests) ? payload.tests : {};
  const evidenceRaw = isRecord(payload.evidence) ? payload.evidence : null;
  const typecheckField = evidenceRaw?.typecheck;
  const typecheckRaw = isRecord(typecheckField) ? typecheckField : {};
  return {
    taskId,
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    stage: typeof payload.stage === 'string' ? payload.stage : 'UNKNOWN',
    liveProgress: typeof payload.liveProgress === 'number' ? payload.liveProgress : 0,
    filesChanged: Array.isArray(payload.filesChanged)
      ? payload.filesChanged.filter((f): f is string => typeof f === 'string')
      : [],
    tests: {
      run: typeof testsRaw.run === 'boolean' ? testsRaw.run : false,
      passed: typeof testsRaw.passed === 'boolean' ? testsRaw.passed : false,
      command: typeof testsRaw.command === 'string' ? testsRaw.command : null,
    },
    commitSha: typeof payload.commitSha === 'string' ? payload.commitSha : null,
    deploymentId: typeof payload.deploymentId === 'string' ? payload.deploymentId : null,
    evidence: evidenceRaw
      ? {
          deployedToProduction: typeof evidenceRaw.deployedToProduction === 'boolean' ? evidenceRaw.deployedToProduction : false,
          liveCommit: typeof evidenceRaw.liveCommit === 'string' ? evidenceRaw.liveCommit : null,
          commitMatch: typeof evidenceRaw.commitMatch === 'boolean' ? evidenceRaw.commitMatch : false,
          healthOk: typeof evidenceRaw.healthOk === 'boolean' ? evidenceRaw.healthOk : false,
          typecheck: {
            run: typeof typecheckRaw.run === 'boolean' ? typecheckRaw.run : false,
            passed: typeof typecheckRaw.passed === 'boolean' ? typecheckRaw.passed : false,
          },
          buildRun: typeof evidenceRaw.buildRun === 'boolean' ? evidenceRaw.buildRun : false,
          finalStatus: typeof evidenceRaw.finalStatus === 'string' ? evidenceRaw.finalStatus : 'UNKNOWN',
          error: typeof evidenceRaw.error === 'string' ? evidenceRaw.error : null,
          answerBlock: typeof evidenceRaw.answerBlock === 'string' ? evidenceRaw.answerBlock : '',
        }
      : null,
    httpStatus: payload.httpStatus === 200 ? 200 : 202,
    category: typeof payload.category === 'string' ? payload.category : null,
    statusUrl,
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
  };
}

type PollState = {
  status: IVXChatExecutionStatus | null;
  polling: boolean;
  error: string | null;
  attempts: number;
};

const DEFAULT_POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 80; // ~3.3min at 2.5s — ample for senior-dev tasks

/**
 * Poll the worker statusUrl for live execution updates until the job reaches
 * a terminal state (completed/failed/blocked/cancelled) or the attempt cap
 * fires. Returns the latest status plus the terminal answerBlock so the chat
 * can swap the live-progress bubble for the final verified-evidence block.
 */
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
        // 404/401 → keep the last status but stop polling to avoid a loop.
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

  // Keep a ref of the latest state so the interval callback reads fresh data.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Refs keep the interval restart keyed on taskId + interval only; fresh
  // status/callback identities never restart an in-flight poll.
  const initialStatusRef = useRef(initialStatus);
  initialStatusRef.current = initialStatus;
  const pollOnceRef = useRef(pollOnce);
  pollOnceRef.current = pollOnce;

  useEffect(() => {
    const current = initialStatusRef.current;
    if (!current || isTerminal(current)) {
      return;
    }
    stoppedRef.current = false;
    const intervalId = setInterval(() => {
      void pollOnceRef.current();
    }, pollIntervalMs);
    // Fire one immediate poll so the bubble advances past "queued" quickly.
    void pollOnceRef.current();
    return () => {
      clearInterval(intervalId);
      stoppedRef.current = true;
    };
  }, [initialStatus?.taskId, pollIntervalMs, isTerminal]);

  // Hard stop after maxAttempts to prevent unbounded polling.
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
