/**
 * IVX 112-agent senior-developer audit.
 *
 * Executes the REAL engineering tools and records only what actually happened.
 * There is no code path in this file that can mark an agent accepted without a
 * verifiable artifact (sourceReference + contentSha256 + toolResultId) AND green
 * shared gates. Missing evidence is recorded as FAIL, never as "not reported".
 *
 * Run: bun run qa/ivx-112-senior-audit.ts
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  executeEngineeringTool,
  resolveRepoRoot,
  parseBunTestOutput,
  parseTscOutput,
} from '../backend/services/ivx-agent-engineering-tools';
import {
  isEngineeringAgent,
  getPermittedRealTools,
} from '../backend/services/ivx-agent-real-tools';

const repoRoot = resolveRepoRoot();

type SharedGate = {
  name: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

function sh(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`;
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ stdout: out, code });
    });
  });
}

/** Shared repository gates. Run once; every agent inherits the real result. */
async function runSharedGates(): Promise<SharedGate[]> {
  const gates: SharedGate[] = [];

  const tsc = await sh('bunx', ['tsc', '--noEmit'], 600_000);
  const tscParsed = parseTscOutput(tsc.stdout);
  gates.push({
    name: 'typecheck',
    passed: tscParsed.errorCount === 0,
    detail: `${tscParsed.errorCount} TypeScript error(s)`,
    evidence: { errorCount: tscParsed.errorCount, firstErrors: tscParsed.firstErrors.slice(0, 5), exitCode: tsc.code },
  });

  const tests = await sh('bun', ['test', 'backend'], 900_000);
  const testParsed = parseBunTestOutput(tests.stdout);
  const failingNames = Array.from(
    new Set(
      tests.stdout
        .split('\n')
        .filter((l) => l.startsWith('(fail)'))
        .map((l) => l.replace(/\s\[[0-9.]+ms\]$/, '').trim()),
    ),
  );
  gates.push({
    name: 'tests',
    passed: failingNames.length === 0 && testParsed.pass > 0,
    detail: `${failingNames.length} unique failing test name(s); counters ${testParsed.pass} pass / ${testParsed.fail} fail`,
    evidence: {
      uniqueFailingTestNames: failingNames.length,
      sampleFailing: failingNames.slice(0, 10),
      countersNote: 'Raw counters are non-deterministic across runs; unique failing NAMES are the stable metric.',
    },
  });

  const secret = await executeEngineeringTool('secret_scan', {}, { repoRoot });
  gates.push({
    name: 'secret_scan',
    passed: secret.ok && secret.extract.matchedFileCount === 0,
    detail: secret.ok ? `${String(secret.extract.matchedFileCount)} file(s) matched secret patterns (names only)` : `tool error: ${secret.error}`,
    evidence: { matchedFileCount: secret.extract.matchedFileCount ?? null, contentSha256: secret.contentSha256 },
  });

  return gates;
}

type AgentIdentity = { agentNumber: number; agentId: string; agentName: string; role: string };

async function loadRoster(): Promise<AgentIdentity[]> {
  const dir = path.join(repoRoot, 'qa/evidence/autonomous/agents');
  const files = (await readdir(dir)).filter((f) => /^agent-\d{3}\.json$/.test(f)).sort();
  const out: AgentIdentity[] = [];
  for (const f of files) {
    const d = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as Record<string, unknown>;
    out.push({
      agentNumber: Number(d.agentNumber),
      agentId: String(d.agentId ?? ''),
      agentName: String(d.agentName ?? ''),
      role: String(d.role ?? ''),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const shaRes = await sh('git', ['rev-parse', 'HEAD'], 30_000);
  const sourceSha = shaRes.stdout.trim();

  console.log(`[audit] sha=${sourceSha}`);
  console.log('[audit] running shared gates (typecheck, tests, secret_scan)...');
  const shared = await runSharedGates();
  for (const g of shared) console.log(`[gate] ${g.name}: ${g.passed ? 'PASS' : 'FAIL'} - ${g.detail}`);

  const sharedAllGreen = shared.every((g) => g.passed);
  const roster = await loadRoster();

  const outDir = path.join(repoRoot, `qa/evidence/autonomous/audit-${startedAt.replace(/[:.]/g, '-')}`);
  await mkdir(outDir, { recursive: true });

  let accepted = 0;
  const rejected: { agentNumber: number; reasons: string[] }[] = [];

  for (const a of roster) {
    const reasons: string[] = [];
    const hasEngineering = isEngineeringAgent(a.agentNumber);

    // Per-agent verifiable artifact: a REAL tool execution attributed to this agent.
    let sourceReference = '';
    let contentSha256 = '';
    let toolResultId = '';

    if (!hasEngineering) {
      reasons.push('no_engineering_capability: agent holds a research-only tool set; cannot produce code, tests, typecheck or deployment evidence');
    } else {
      const probe = await executeEngineeringTool(
        'code_search',
        { pattern: 'export', scope: 'backend/services' },
        { repoRoot },
      );
      if (probe.ok) {
        sourceReference = probe.sourceReference;
        contentSha256 = probe.contentSha256;
        toolResultId = `${probe.toolId}:${probe.contentSha256.slice(0, 12)}`;
      } else {
        reasons.push(`tool_execution_failed: ${probe.error ?? 'unknown'}`);
      }
    }

    // Senior gate. Every condition must hold on the SAME sha.
    if (!sourceReference) reasons.push('missing_sourceReference');
    if (!contentSha256) reasons.push('missing_contentSha256');
    if (!toolResultId) reasons.push('missing_toolResultId');
    for (const g of shared) {
      if (!g.passed) reasons.push(`shared_gate_failed:${g.name} (${g.detail})`);
    }
    // A senior developer's accepted work requires authored changes under review.
    reasons.push('no_authored_changedFiles: agent produced no reviewed code change in this audit window');

    const acceptedBySeniorGate = reasons.length === 0;
    if (acceptedBySeniorGate) accepted += 1;
    else rejected.push({ agentNumber: a.agentNumber, reasons });

    const record = {
      ...a,
      sourceSha,
      auditStartedAt: startedAt,
      permittedTools: getPermittedRealTools(a.agentNumber),
      hasEngineeringCapability: hasEngineering,
      sourceReference,
      contentSha256,
      toolResultId,
      changedFiles: [],
      sharedGates: shared.map((g) => ({ name: g.name, passed: g.passed, detail: g.detail })),
      deploymentEvidence: null,
      status: acceptedBySeniorGate ? 'VERIFIED' : 'NOT_ACCEPTED',
      acceptedBySeniorGate,
      rejectionReasons: reasons,
    };
    await writeFile(path.join(outDir, `agent-${String(a.agentNumber).padStart(3, '0')}.json`), JSON.stringify(record, null, 2));
  }

  const summary = {
    auditId: `ivx-112-senior-audit-${startedAt}`,
    sourceSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalAgents: roster.length,
    acceptedBySeniorGate: accepted,
    notAccepted: roster.length - accepted,
    sharedGates: shared,
    sharedGatesAllGreen: sharedAllGreen,
    certified: accepted === 112 && sharedAllGreen,
    certificateId: accepted === 112 && sharedAllGreen ? 'IVX-112-SENIOR-DEVELOPER-10OF10-CERTIFIED' : 'NOT-CERTIFIED',
    failingAgentNumbers: rejected.map((r) => r.agentNumber),
    rejectionSample: rejected.slice(0, 5),
    evidenceDir: path.relative(repoRoot, outDir),
  };
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('');
  console.log(`[audit] accepted=${accepted}/${roster.length}`);
  console.log(`[audit] certificate=${summary.certificateId}`);
  console.log(`[audit] evidence=${summary.evidenceDir}`);
}

void main();
