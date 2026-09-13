import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.ivxholding.com';
const DAY_MS = 86_400_000;
const EVIDENCE_PATH = 'qa/evidence/per-agent-timers/timers.json';
const SHA = /^[a-f0-9]{40}$/;

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
function timestamp(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
function validNumber(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function indexedAgents(rows, field) {
  requireValue(Array.isArray(rows) && rows.length === 112, 'AGENT_COVERAGE_INVALID');
  const indexed = new Map();
  for (const row of rows) {
    const number = row?.[field];
    requireValue(Number.isInteger(number) && number >= 1 && number <= 112 && !indexed.has(number), 'AGENT_ID_INVALID');
    indexed.set(number, row);
  }
  return indexed;
}

/** QA time is a measured lower bound; it does not include coding/tool jobs. */
export function summarizeTimerEvidence({ ledger, truth, from, to, sourceSha, observedAt, targetHours = 20 }) {
  requireValue(SHA.test(sourceSha), 'SOURCE_SHA_INVALID');
  requireValue(validNumber(targetHours, 24) && targetHours > 0, 'TARGET_HOURS_INVALID');
  requireValue(timestamp(to) - timestamp(from) === DAY_MS, 'REQUEST_WINDOW_INVALID');
  requireValue(ledger?.ok === true && ledger.auth === 'oidc'
    && ledger.marker === 'ivx-immutable-work-evidence-2026-09-10', 'DURABLE_LEDGER_INVALID');
  const hours = ledger.hours;
  requireValue(hours && typeof hours.historicalEvidenceIncomplete === 'boolean', 'LEDGER_COVERAGE_UNAVAILABLE');
  requireValue(timestamp(hours.from) === timestamp(from) && timestamp(hours.to) === timestamp(to), 'LEDGER_WINDOW_MISMATCH');
  requireValue(truth?.degraded === false && Array.isArray(truth.degradedDependencies)
    && truth.degradedDependencies.length === 0, 'CONTROL_TELEMETRY_UNAVAILABLE');
  requireValue(timestamp(observedAt) - timestamp(truth.generatedAt) >= -5000
    && timestamp(observedAt) - timestamp(truth.generatedAt) <= 60000, 'CONTROL_TELEMETRY_STALE');
  const control = truth.autonomous;
  requireValue(control?.ownerControlVerified === true
    && typeof control.dispatcherPaused === 'boolean'
    && typeof control.emergencyStop === 'boolean'
    && typeof control.ownerControl?.paused === 'boolean'
    && typeof control.ownerControl?.stopped === 'boolean', 'OWNER_CONTROL_UNAVAILABLE');
  const qa = indexedAgents(hours.agents, 'agent_number');
  const runtime = indexedAgents(truth.agents?.rows, 'agentNumber');
  const globallyHeld = control.dispatcherPaused || control.emergencyStop
    || control.ownerControl.paused || control.ownerControl.stopped;
  const agents = [];
  for (let number = 1; number <= 112; number++) {
    const row = qa.get(number);
    const state = runtime.get(number);
    requireValue(typeof state.paused === 'boolean' && typeof state.disabled === 'boolean'
      && typeof state.actuallyWorking === 'boolean'
      && ['WORKING', 'IDLE', 'STALE', 'BLOCKED', 'UNKNOWN'].includes(state.status), 'AGENT_CONTROL_INVALID');
    requireValue(Number.isSafeInteger(row.observations) && row.observations >= 0
      && ['attempted_seconds', 'passing_seconds', 'nonpassing_seconds'].every(key => validNumber(row[key], DAY_MS / 1000))
      && Math.abs(row.attempted_seconds - row.passing_seconds - row.nonpassing_seconds) <= 0.01
      && (row.observations > 0 || row.attempted_seconds === 0), 'QA_TIMER_INVALID');
    const eligible = !globallyHeld && !state.paused && !state.disabled;
    agents.push({
      agentNumber: number,
      runtimeStatus: state.status,
      actuallyWorking: state.actuallyWorking,
      paused: state.paused,
      disabled: state.disabled,
      eligible,
      qaObservations24h: row.observations,
      qaAttemptedSeconds24h: row.attempted_seconds,
      qaPassingSeconds24h: row.passing_seconds,
      qaNonpassingSeconds24h: row.nonpassing_seconds,
      qaPassingHours24h: row.passing_seconds / 3600,
      qaEvidenceMeetsTarget: row.passing_seconds >= targetHours * 3600,
      qaTimerState: row.observations === 0 ? 'NO_QA_EVIDENCE' : 'MEASURED',
    });
  }
  const eligible = agents.filter(row => row.eligible);
  const withoutQa = eligible.filter(row => row.qaObservations24h === 0);
  const belowTarget = eligible.filter(row => !row.qaEvidenceMeetsTarget);
  const historicalEvidenceIncomplete = hours.historicalEvidenceIncomplete;
  return {
    marker: 'ivx-per-agent-durable-qa-timer-v1',
    sourceSha,
    sourceShaMeaning: 'workflow revision; health checked before and after the observation',
    observedAt,
    window: { from, to },
    observationStatus: historicalEvidenceIncomplete ? 'INCOMPLETE' : 'OBSERVED',
    timerGate: historicalEvidenceIncomplete || withoutQa.length ? 'FAIL' : 'PASS',
    certified: false,
    scope: 'Persisted QA observations and technical audits; coding and other tool execution time are not measured here.',
    historicalEvidenceIncomplete,
    totalAgents: agents.length,
    eligibleAgents: eligible.length,
    eligibleAgentsWithoutQaEvidence: withoutQa.length,
    eligibleAgentsBelowQaHoursTarget: belowTarget.length,
    targetHoursPerAgent: targetHours,
    targetStatus: globallyHeld || !eligible.length ? 'HELD'
      : historicalEvidenceIncomplete ? 'INCOMPLETE' : belowTarget.length ? 'BREACH' : 'MET',
    dispatch: {
      authority: 'existing production worker',
      queueBackend: control.provenQueueBackend ?? null,
      globallyHeld,
      productionMutations: 0,
    },
    agents,
  };
}

async function getJson(fetcher, url, label, headers, signal) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Accept: 'application/json', ...headers },
    });
  } catch {
    throw new Error(label + '_REQUEST_UNAVAILABLE');
  }
  requireValue(response.status === 200, label + '_HTTP_' + response.status);
  try { return await response.json(); }
  catch { throw new Error(label + '_JSON_INVALID'); }
}

export async function collectTimerEvidence({ token, sourceSha, fetcher = fetch, now = Date.now, targetHours = 20 }) {
  requireValue(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'OIDC_TOKEN_MISSING');
  requireValue(SHA.test(sourceSha), 'SOURCE_SHA_INVALID');
  const signal = AbortSignal.timeout(90000);
  const health = async () => {
    const body = await getJson(fetcher, API_BASE + '/health', 'HEALTH', {}, signal);
    requireValue(body?.ok === true && body.commit === sourceSha, 'DEPLOYMENT_SHA_MISMATCH');
  };
  await health();
  const end = now();
  const from = new Date(end - DAY_MS).toISOString();
  const to = new Date(end).toISOString();
  const params = new URLSearchParams({ from, to });
  const [ledger, truth] = await Promise.all([
    getJson(fetcher, API_BASE + '/api/ivx/autonomous/agent-ledger?' + params,
      'LEDGER', { 'X-IVX-GitHub-OIDC': token }, signal),
    getJson(fetcher, API_BASE + '/api/ivx/autonomous/truth', 'CONTROL', {}, signal),
  ]);
  await health();
  return summarizeTimerEvidence({ ledger, truth, from, to, sourceSha, targetHours, observedAt: new Date(now()).toISOString() });
}

async function main() {
  let report;
  try {
    requireValue(process.env.GITHUB_REPOSITORY === 'ibb142/ivx-holdings-platform'
      && process.env.GITHUB_REF === 'refs/heads/main', 'WORKFLOW_SCOPE_INVALID');
    report = await collectTimerEvidence({
      token: process.env.IVX_GITHUB_OIDC,
      sourceSha: process.env.GITHUB_SHA,
      targetHours: Number(process.env.TARGET_HOURS_24H ?? '20'),
    });
  } catch (error) {
    // Only our fixed diagnostic codes are published; response bodies and tokens are not.
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)
      ? error.message : 'TIMER_OBSERVATION_UNAVAILABLE';
    report = {
      marker: 'ivx-per-agent-durable-qa-timer-v1',
      sourceSha: SHA.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : null,
      observedAt: new Date().toISOString(),
      observationStatus: 'UNAVAILABLE', timerGate: 'FAIL', certified: false,
      error: code, agents: null, productionMutations: 0,
    };
  }
  await mkdir('qa/evidence/per-agent-timers', { recursive: true });
  await writeFile(EVIDENCE_PATH, JSON.stringify(report, null, 2) + '\n');
  const { agents, ...summary } = report;
  console.log(JSON.stringify(summary));
  process.exitCode = report.timerGate === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
