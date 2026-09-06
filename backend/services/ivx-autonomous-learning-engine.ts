import path from 'node:path';
import { createTask, getAllTasks } from './ivx-autonomous-task-engine';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';

export const IVX_AUTONOMOUS_LEARNING_MARKER = 'ivx-autonomous-learning-v3-ai-quantum-112-2026-09-06';
export const IVX_AUTONOMOUS_DAILY_STUDY_MINUTES = 300;
export const IVX_AUTONOMOUS_LEARNING_FLEET_SIZE = 112;
export const IVX_AUTONOMOUS_DAILY_FLEET_STUDY_MINUTES = IVX_AUTONOMOUS_DAILY_STUDY_MINUTES * IVX_AUTONOMOUS_LEARNING_FLEET_SIZE;
export const IVX_AUTONOMOUS_LEARNING_DOMAINS = ['AI_AGI_TECHNOLOGY', 'QUANTUM_TECHNOLOGY', 'APPLIED_IVX_UPGRADE'] as const;
const LEARNING_STATE_FILE = path.join(process.cwd(), 'logs/audit/autonomous-learning/state.json');
const REPO = 'ibb142/ivx-holdings-platform';
const CURRICULUM_VERSION = 'ai-agi-quantum-v1';

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
  studyMinutesPerAgent: number;
  studyFleetMinutesPlanned: number;
  studyAgentsPlanned: number;
  studyTasksCreated: number;
  studyCurriculumVersion: string;
  studyDomains: string[];
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
    studyMinutesPerAgent: IVX_AUTONOMOUS_DAILY_STUDY_MINUTES,
    studyFleetMinutesPlanned: IVX_AUTONOMOUS_DAILY_FLEET_STUDY_MINUTES,
    studyAgentsPlanned: IVX_AUTONOMOUS_LEARNING_FLEET_SIZE,
    studyTasksCreated: 0,
    studyCurriculumVersion: CURRICULUM_VERSION,
    studyDomains: [...IVX_AUTONOMOUS_LEARNING_DOMAINS],
    lessons: [],
    updatedAt: nowIso(),
  };
}

function normalizeState(value: LearningState): LearningState {
  const base = emptyState();
  return {
    ...base,
    ...value,
    marker: IVX_AUTONOMOUS_LEARNING_MARKER,
    studyMinutesPerAgent: IVX_AUTONOMOUS_DAILY_STUDY_MINUTES,
    studyFleetMinutesPlanned: IVX_AUTONOMOUS_DAILY_FLEET_STUDY_MINUTES,
    studyAgentsPlanned: IVX_AUTONOMOUS_LEARNING_FLEET_SIZE,
    studyCurriculumVersion: CURRICULUM_VERSION,
    studyDomains: [...IVX_AUTONOMOUS_LEARNING_DOMAINS],
    lessons: Array.isArray(value?.lessons) ? value.lessons : [],
  };
}

async function loadState(): Promise<LearningState> {
  return normalizeState(await readDurableJson<LearningState>(LEARNING_STATE_FILE, emptyState()));
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
  if (input.runtimeError) parts.push(input.runtimeError.replace(/\d+ms/g, '<duration>').slice(0, 160));
  return parts.join('|') || `working:${input.working}/${input.total}`;
}

function curriculumDescription(agentNumber: number, sourceSha: string): string {
  return [
    `Mandatory 5-hour Autonomous upgrade curriculum for IA-${agentNumber} at source SHA ${sourceSha}.`,
    'This is measured study plus applied engineering work and must produce verifiable artifacts.',
    'Gate 1 (60 min): AI/AGI architecture, reasoning, agents, memory, tool-use, evaluation, reliability and safety patterns relevant to this IA role.',
    'Gate 2 (60 min): AI/AGI research translated into one concrete IVX improvement hypothesis, with source/evidence notes and measurable acceptance criteria.',
    'Gate 3 (60 min): Quantum technology fundamentals and current practical relevance: algorithms, optimization, simulation, cryptography/post-quantum risk, hybrid classical/quantum workflows; reject hype and label non-production concepts clearly.',
    'Gate 4 (60 min): Role-specific application study: determine whether AI/AGI or quantum-derived methods can improve this agent domain; prototype or document a technically testable upgrade when applicable.',
    'Gate 5 (60 min): Apply/verify: inspect current IVX code or operating evidence, propose or execute the lowest-risk useful upgrade, run QA, attach evidence, and record what should be reused or avoided next time.',
    'Completion rules: all five gates require fresh evidence; productive minutes must be measured from real work; no fabricated 300-minute completion; no unsupported claim of quantum advantage; production-changing actions remain owner/CI gated.',
  ].join(' ');
}

async function ensureDailyStudyQueue(state: LearningState, sourceSha: string): Promise<void> {
  const today = utcDate();
  const tasks = await getAllTasks();
  let created = 0;
  let represented = 0;

  for (let agentNumber = 1; agentNumber <= IVX_AUTONOMOUS_LEARNING_FLEET_SIZE; agentNumber += 1) {
    const idempotencyKey = `autonomous-learning:${CURRICULUM_VERSION}:${today}:ia-${agentNumber}`;
    const existing = tasks.find((task) => task.idempotencyKey === idempotencyKey);
    if (existing) {
      represented += 1;
      continue;
    }
    const result = await createTask({
      title: `IA-${agentNumber} daily AI/AGI + Quantum 5h upgrade — ${today}`,
      description: curriculumDescription(agentNumber, sourceSha),
      taskType: 'qa',
      idempotencyKey,
      priority: 'high',
      assignedAgentNumber: agentNumber,
    });
    if (result.ok && result.task) {
      represented += 1;
      if (!result.duplicate) created += 1;
    }
  }

  state.studyDate = today;
  state.studyMinutesPerAgent = IVX_AUTONOMOUS_DAILY_STUDY_MINUTES;
  state.studyFleetMinutesPlanned = IVX_AUTONOMOUS_DAILY_FLEET_STUDY_MINUTES;
  state.studyAgentsPlanned = IVX_AUTONOMOUS_LEARNING_FLEET_SIZE;
  state.studyTasksCreated = represented;
  state.studyCurriculumVersion = CURRICULUM_VERSION;
  state.studyDomains = [...IVX_AUTONOMOUS_LEARNING_DOMAINS];

  if (represented !== IVX_AUTONOMOUS_LEARNING_FLEET_SIZE) {
    throw new Error(`autonomous_learning_queue_incomplete:${represented}/${IVX_AUTONOMOUS_LEARNING_FLEET_SIZE}:created=${created}`);
  }
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
