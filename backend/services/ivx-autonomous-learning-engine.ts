import path from 'node:path';
import { createTask, getAllTasks } from './ivx-autonomous-task-engine';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';

export const IVX_AUTONOMOUS_LEARNING_MARKER = 'ivx-autonomous-learning-v2-2026-09-06';
export const IVX_AUTONOMOUS_DAILY_STUDY_MINUTES = 300;
const LEARNING_STATE_FILE = path.join(process.cwd(), 'logs/audit/autonomous-learning/state.json');
const REPO = 'ibb142/ivx-holdings-platform';

type LearningLesson = {
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  lastKnownGoodSha: string | null;
  badSha: string;
  suspectedFiles: string[];
  diagnoses: string[];
  repairVerified: boolean;
};

type LearningState = {
  marker: string;
  lastKnownGoodSha: string | null;
  lastKnownGoodAt: string | null;
  lastObservedSha: string | null;
  lastObservedHealthy: boolean;
  lastComparedAt: string | null;
  lastComparison: null | {
    baseSha: string;
    headSha: string;
    changedFiles: string[];
    highRiskFiles: string[];
  };
  studyDate: string | null;
  studyMinutesPlanned: number;
  studyBlocksCreated: number;
  lessons: LearningLesson[];
  updatedAt: string;
};

export type LearningObservation = {
  sourceSha: string;
  certified: boolean;
  working: number;
  total: number;
  diagnoses: string[];
  runtimeError?: string | null;
};

function nowIso(): string { return new Date().toISOString(); }
function utcDate(): string { return new Date().toISOString().slice(0, 10); }
function emptyState(): LearningState {
  return {
    marker: IVX_AUTONOMOUS_LEARNING_MARKER,
    lastKnownGoodSha: null,
    lastKnownGoodAt: null,
    lastObservedSha: null,
    lastObservedHealthy: false,
    lastComparedAt: null,
    lastComparison: null,
    studyDate: null,
    studyMinutesPlanned: 0,
    studyBlocksCreated: 0,
    lessons: [],
    updatedAt: nowIso(),
  };
}

async function loadState(): Promise<LearningState> {
  return readDurableJson<LearningState>(LEARNING_STATE_FILE, emptyState());
}

async function saveState(state: LearningState): Promise<void> {
  state.updatedAt = nowIso();
  await writeDurableJson(LEARNING_STATE_FILE, state);
}

function riskScore(file: string): number {
  let score = 0;
  if (file.includes('durable-store') || file.includes('supabase')) score += 100;
  if (file.includes('autonomous-task-engine') || file.includes('agent-real-engineering-cycle')) score += 90;
  if (file.includes('autonomous') || file.includes('dispatcher') || file.includes('scheduler')) score += 70;
  if (file.startsWith('.github/workflows/')) score += 50;
  if (file === 'server.ts') score += 40;
  return score;
}

async function compareWithLastKnownGood(baseSha: string, headSha: string) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`github_compare_http_${response.status}`);
  const body = await response.json() as { files?: Array<{ filename?: string }> };
  const changedFiles = (body.files ?? []).map((row) => row.filename ?? '').filter(Boolean).slice(0, 300);
  const highRiskFiles = [...changedFiles].sort((a, b) => riskScore(b) - riskScore(a)).filter((f) => riskScore(f) > 0).slice(0, 25);
  return { baseSha, headSha, changedFiles, highRiskFiles };
}

function fingerprint(input: LearningObservation): string {
  const parts = [...input.diagnoses].sort();
  if (input.runtimeError) parts.push(input.runtimeError.replace(/\d+ms/g, '<ms>').slice(0, 160));
  return parts.join('|') || `working:${input.working}/${input.total}`;
}

async function ensureDailyStudyQueue(state: LearningState, sourceSha: string): Promise<void> {
  const today = utcDate();
  if (state.studyDate === today && state.studyBlocksCreated >= 5) return;
  const tasks = await getAllTasks();
  let created = 0;
  for (let block = 1; block <= 5; block += 1) {
    const idempotencyKey = `autonomous-learning:${today}:block-${block}`;
    if (tasks.some((task) => task.idempotencyKey === idempotencyKey)) continue;
    const lane = 107 + block;
    const result = await createTask({
      title: `Autonomous learning block ${block}/5 — ${today}`,
      description: `Daily Autonomous learning/upgrade block. Study verified incidents, compare last-known-good SHA against current SHA ${sourceSha}, inspect regressions, convert repeated failures into prevention rules, and attach fresh evidence. This block reserves up to 60 minutes of real engineering/QA work; never fabricate time or mark complete without evidence.`,
      taskType: 'qa',
      idempotencyKey,
      priority: 'high',
      assignedAgentNumber: lane,
    });
    if (result.ok && result.task && !result.duplicate) created += 1;
  }
  state.studyDate = today;
  state.studyMinutesPlanned = IVX_AUTONOMOUS_DAILY_STUDY_MINUTES;
  state.studyBlocksCreated = Math.min(5, (state.studyDate === today ? state.studyBlocksCreated : 0) + created);
}

export async function observeAndLearn(input: LearningObservation): Promise<{ ok: boolean; state: LearningState; action: string }> {
  const state = await loadState();
  state.lastObservedSha = input.sourceSha;
  state.lastObservedHealthy = input.certified;

  await ensureDailyStudyQueue(state, input.sourceSha);

  if (input.certified) {
    const previousBadSha = state.lastComparison?.headSha ?? null;
    state.lastKnownGoodSha = input.sourceSha;
    state.lastKnownGoodAt = nowIso();
    if (previousBadSha) {
      for (const lesson of state.lessons) {
        if (lesson.badSha === previousBadSha) lesson.repairVerified = true;
      }
    }
    await saveState(state);
    return { ok: true, state, action: 'LAST_KNOWN_GOOD_UPDATED' };
  }

  if (state.lastKnownGoodSha && state.lastKnownGoodSha !== input.sourceSha) {
    try {
      const comparison = await compareWithLastKnownGood(state.lastKnownGoodSha, input.sourceSha);
      state.lastComparison = comparison;
      state.lastComparedAt = nowIso();
      const fp = fingerprint(input);
      const existing = state.lessons.find((lesson) => lesson.fingerprint === fp && lesson.badSha === input.sourceSha);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = nowIso();
        existing.suspectedFiles = comparison.highRiskFiles;
      } else {
        state.lessons.unshift({
          fingerprint: fp,
          firstSeenAt: nowIso(),
          lastSeenAt: nowIso(),
          occurrences: 1,
          lastKnownGoodSha: state.lastKnownGoodSha,
          badSha: input.sourceSha,
          suspectedFiles: comparison.highRiskFiles,
          diagnoses: input.diagnoses,
          repairVerified: false,
        });
        state.lessons = state.lessons.slice(0, 100);
      }
      await saveState(state);
      return { ok: true, state, action: comparison.highRiskFiles.length ? 'REGRESSION_DIFF_RANKED' : 'REGRESSION_DIFF_EMPTY' };
    } catch (error) {
      await saveState(state);
      return { ok: false, state, action: `COMPARE_FAILED:${error instanceof Error ? error.message : String(error)}` };
    }
  }

  await saveState(state);
  return { ok: true, state, action: 'NO_LAST_KNOWN_GOOD_YET' };
}

export async function getAutonomousLearningStatus(): Promise<LearningState> {
  return loadState();
}
