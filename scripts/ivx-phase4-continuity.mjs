import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Observation acceptance policy, not a throughput estimate or a worker control.
export const POLICY = Object.freeze({ agents: 112, evidenceMaxAgeMs: 120_000,
  sampleMaxGapMs: 120_000, initialWindowMs: 24 * 60 * 60 * 1000 });
const hash = value => createHash('sha256').update(value).digest('hex');
// Kept in sync with the authoritative production assignment by a regression.
// Input samples cannot narrow their own required coverage to manufacture PASS.
const UNIT_CATALOG = JSON.parse(readFileSync(new URL('./ivx-phase4-unit-catalog.json', import.meta.url), 'utf8'));
function decodeEvidence(evidence, number, sourceSha, now) {
  if (!evidence?.evidenceId || evidence.commitSha !== sourceSha ||
      !evidence.source?.startsWith('continuous-patrol:') ||
      !evidence.summary?.startsWith('LANDING_P0_RESULT ') ||
      hash(evidence.summary) !== evidence.contentHash) throw new Error('invalid evidence');
  const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length));
  const ended = Date.parse(record.completed_at), persisted = Date.parse(evidence.createdAt);
  const started = Date.parse(record.started_at);
  if (record.v !== 1 || record.agent_number !== number || record.production_sha !== sourceSha ||
      !UNIT_CATALOG[number]?.includes(record.unit_id) ||
      !['PASS', 'FAIL', 'BLOCKED'].includes(record.status) ||
      ![started, ended, persisted, now].every(Number.isFinite) || started > ended ||
      ended > now || persisted > now || persisted < ended) throw new Error('invalid evidence');
  return record;
}

export function evaluateSample(snapshot) {
  const errors = [];
  const sourceSha = snapshot?.sourceSha;
  const rows = Array.isArray(snapshot?.data) ? snapshot.data : [];
  const sampledAt = snapshot?.sampledAt ?? rows[0]?.sampled_at ?? snapshot?.capturedAt;
  const now = Date.parse(sampledAt);
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) errors.push('INVALID_SOURCE_SHA');
  if (!Number.isFinite(now)) errors.push('INVALID_SAMPLE_TIME');
  if (rows.length !== POLICY.agents) errors.push('INCOMPLETE_INVENTORY');
  const agents = [];
  const taskIds = new Set();
  for (let number = 1; number <= POLICY.agents; number++) {
    const matches = rows.filter(row => row.assigned_agent_number === number);
    const row = matches[0];
    const blockers = [];
    let record = null;
    let validEvidence = false;
    const unitVerdicts = [];
    if (matches.length !== 1) blockers.push(matches.length ? 'DUPLICATE_AGENT' : 'MISSING_AGENT');
    if (row) {
      if (!row.task_id || taskIds.has(row.task_id)) blockers.push('INVALID_TASK_IDENTITY');
      taskIds.add(row.task_id);
      if (row.idempotency_key !== `landing-p0-patrol:${sourceSha}:ia-${String(number).padStart(3, '0')}`) {
        blockers.push('TASK_SHA_MISMATCH');
      }
      const evidence = row.latest_evidence;
      try {
        record = decodeEvidence(evidence, number, sourceSha, now);
        const ended = Date.parse(record.completed_at), persisted = Date.parse(evidence.createdAt);
        validEvidence = true;
        if (now - ended > POLICY.evidenceMaxAgeMs || now - persisted > POLICY.evidenceMaxAgeMs) {
          blockers.push('STALE_EVIDENCE');
        }
        if (record.status !== 'PASS') blockers.push(`OBSERVATION_${record.status}`);
      } catch { blockers.push('INVALID_OR_MISSING_EVIDENCE'); }
      const expectedUnits = UNIT_CATALOG[number];
      const evidenceByUnit = new Map();
      const ids = new Set();
      const supplied = Array.isArray(row.unit_evidence) ? row.unit_evidence : [];
      if (supplied.length !== expectedUnits.length) blockers.push('INCOMPLETE_UNIT_COVERAGE');
      for (const item of supplied.slice(0, expectedUnits.length + 1)) {
        try {
          const unit = decodeEvidence(item, number, sourceSha, now);
          if (evidenceByUnit.has(unit.unit_id) || ids.has(item.evidenceId)) throw new Error('duplicate unit');
          evidenceByUnit.set(unit.unit_id, { item, record: unit });
          ids.add(item.evidenceId);
        } catch { blockers.push('INVALID_OR_DUPLICATE_UNIT_EVIDENCE'); }
      }
      for (const unitId of expectedUnits) {
        const entry = evidenceByUnit.get(unitId);
        const reasons = [];
        if (!entry) reasons.push(`UNIT_${unitId}_MISSING`);
        else {
          if (entry.record.status !== 'PASS') reasons.push(`UNIT_${unitId}_${entry.record.status}`);
          if (now - Date.parse(entry.record.completed_at) > POLICY.evidenceMaxAgeMs ||
              now - Date.parse(entry.item.createdAt) > POLICY.evidenceMaxAgeMs) reasons.push(`UNIT_${unitId}_STALE`);
        }
        blockers.push(...reasons);
        unitVerdicts.push({ unitId, evidenceId: entry?.item.evidenceId ?? null,
          evidenceAt: entry?.record.completed_at ?? null, verdict: entry?.record.status ?? null,
          passed: reasons.length === 0, blockers: reasons });
      }
      if (validEvidence) {
        const latestUnit = evidenceByUnit.get(record.unit_id)?.item;
        if (latestUnit?.evidenceId !== evidence.evidenceId || latestUnit?.contentHash !== evidence.contentHash) {
          blockers.push('LATEST_EVIDENCE_NOT_IN_UNIT_COVERAGE');
        }
      }
      if (['FAILED', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'PAUSED'].includes(row.state)) blockers.push(`TASK_${row.state}`);
      if (!['QUEUED', 'RETRYING', 'RUNNING', 'VERIFIED', 'NO_ACTION_REQUIRED', 'FAILED', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'PAUSED'].includes(row.state)) {
        blockers.push('UNKNOWN_TASK_STATE');
      }
      if (row.state === 'RUNNING' && (!row.lease_holder || !Number.isFinite(Date.parse(row.lease_expires_at)) || Date.parse(row.lease_expires_at) <= now)) {
        blockers.push('EXPIRED_OR_MISSING_LEASE');
      }
      if (['QUEUED', 'RETRYING'].includes(row.state) && (!validEvidence || blockers.includes('STALE_EVIDENCE'))) blockers.push('QUEUE_WITHOUT_RECENT_PROGRESS');
    }
    agents.push({ agentNumber: number, taskId: row?.task_id ?? null, state: row?.state ?? null,
      evidenceId: validEvidence ? row.latest_evidence.evidenceId : null,
      evidenceAt: validEvidence ? record.completed_at : null,
      observationVerdict: validEvidence ? record.status : null,
      passed: blockers.length === 0, blockers, unitVerdicts });
  }
  const passed = errors.length === 0 && agents.every(agent => agent.passed);
  return { sourceSha, sampledAt, passed, errors, agents, freshPassingAgents: agents.filter(agent => agent.passed).length,
    scope: 'Persisted patrol observations only; does not certify repairs, model work or the chat-to-production chain.' };
}

export function compareSamples(before, after) {
  const previous = evaluateSample(before), current = evaluateSample(after);
  const gapMs = Date.parse(current.sampledAt) - Date.parse(previous.sampledAt);
  const comparable = previous.sourceSha === current.sourceSha && Number.isFinite(gapMs) && gapMs > 0;
  const coverageGap = !comparable || gapMs > POLICY.sampleMaxGapMs;
  return { comparable, coverageGap, gapMs,
    agents: current.agents.map(agent => {
      const prior = previous.agents[agent.agentNumber - 1];
      const newEvidence = comparable && Boolean(agent.evidenceId) && agent.evidenceId !== prior.evidenceId &&
        Date.parse(agent.evidenceAt) > Date.parse(previous.sampledAt);
      return { ...agent, newEvidence, blockers: [...agent.blockers, ...(!comparable ? ['INCOMPARABLE_SAMPLES'] : [])] };
    }) };
}

export function evaluateWindow(samples) {
  const results = Array.isArray(samples) ? samples.map(evaluateSample) : [];
  const pairs = results.slice(1).map((_, i) => compareSamples(samples[i], samples[i + 1]));
  const durationMs = results.length > 1 ? Date.parse(results.at(-1).sampledAt) - Date.parse(results[0].sampledAt) : 0;
  const coverageGaps = pairs.filter(pair => pair.coverageGap).length;
  const enoughTime = Number.isFinite(durationMs) && durationMs >= POLICY.initialWindowMs;
  return { policy: POLICY, sampleCount: results.length, durationMs, coverageGaps,
    initialWindowPassed: enoughTime && coverageGaps === 0 && results.every(result => result.passed),
    phase4Certified: false,
    limitation: 'Chat, deployment, failure drills and restored data need their own evidence. An elapsed 24-hour interval alone is insufficient.',
    latest: results.at(-1) ?? null, pairs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || !inputs.length) throw new Error('Usage: node scripts/ivx-phase4-continuity.mjs OUTPUT.json SAMPLE.json [SAMPLE.json ...]');
  const samples = await Promise.all(inputs.map(async file => JSON.parse(await readFile(file, 'utf8'))));
  const report = evaluateWindow(samples);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, sampleCount: report.sampleCount, initialWindowPassed: report.initialWindowPassed,
    freshPassingAgents: report.latest?.freshPassingAgents ?? 0, coverageGaps: report.coverageGaps, phase4Certified: false }));
  if (!report.initialWindowPassed) process.exitCode = 1;
}
