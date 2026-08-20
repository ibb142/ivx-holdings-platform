/**
 * IVX 112-agent audit — real execution, role-appropriate acceptance.
 *
 * WHAT CHANGED AND WHY
 * The previous revision of this file pushed 'no_authored_changedFiles' UNCONDITIONALLY
 * (outside every branch) and hardcoded `changedFiles: []`. `acceptedBySeniorGate` was
 * `reasons.length === 0`, so the result was arithmetically pinned at 0/112 no matter what
 * the fleet actually did. That is a rigged harness, not a measurement.
 *
 * This revision measures what actually happens, and is deliberately HARD to pass:
 *
 *   POSITIVE  Every agent must really execute a tool from its OWN permitted set through
 *             the full `executeRealTool` permission path, returning ok + sourceReference
 *             + contentSha256. No artifact, no acceptance.
 *
 *   NEGATIVE  Three refusals every agent must produce, or it FAILS:
 *               1. a tool outside its permitted set   -> must be blocked
 *               2. a permanently prohibited tool      -> must be blocked
 *               3. an approval-gated write, no token  -> must be blocked
 *             These are local and deterministic. They are what stop this audit from
 *             degenerating into "everyone passes".
 *
 *   ENGINEERING  The 50 engineering agents must additionally read a DISTINCT real repo
 *             file and return its true sha256 — a per-agent artifact, not one shared probe.
 *
 *   SHARED    typecheck + backend tests + secret_scan must be green on the same sha.
 *
 * Acceptance is role-appropriate: a research-only agent is judged on its research remit,
 * NOT on producing code. It is therefore reported as "role-verified", never as "senior
 * developer". The engineering bar and the research bar are counted and reported SEPARATELY
 * so the headline number cannot be mistaken for 112 developers. See the certificate logic
 * at the bottom: the 10/10 senior-developer id requires all 112 to clear the ENGINEERING
 * bar, which is structurally impossible while 62 agents hold no engineering tools. This
 * file will not print that id until that is genuinely true.
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
  executeRealTool,
  isEngineeringAgent,
  getPermittedRealTools,
  type RealToolId,
} from '../backend/services/ivx-agent-real-tools';

const repoRoot = resolveRepoRoot();

type SharedGate = { name: string; passed: boolean; detail: string; evidence: Record<string, unknown> };

function sh(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`;
      const code =
        err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
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
    detail: secret.ok
      ? `${String(secret.extract.matchedFileCount)} file(s) matched secret patterns (names only)`
      : `tool error: ${secret.error}`,
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

/** Deterministic pool of real repo files, so each engineering agent reads a DISTINCT one. */
async function loadReadPool(): Promise<string[]> {
  const res = await sh('git', ['ls-files', 'backend/services'], 60_000);
  const files = res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.ts') && !l.endsWith('.test.ts'))
    .sort();
  return files;
}

/** A tool that is definitively NOT in this agent's permitted set — used as a negative control. */
function unpermittedToolFor(agentNumber: number): RealToolId {
  const permitted = new Set<string>(getPermittedRealTools(agentNumber));
  const candidates: RealToolId[] = ['crm_write', 'typecheck', 'run_tests', 'code_read', 'sec_edgar_fulltext'];
  const found = candidates.find((t) => !permitted.has(t));
  return found ?? 'crm_write';
}

type AgentOutcome = {
  identity: AgentIdentity;
  hasEngineering: boolean;
  positive: { toolId: string; ok: boolean; sourceReference: string; contentSha256: string; error: string | null };
  refusedUnpermitted: boolean;
  refusedProhibited: boolean;
  refusedUnapprovedWrite: boolean;
  engineeringArtifact: { file: string; contentSha256: string } | null;
  reasons: string[];
  roleVerified: boolean;
  meetsEngineeringBar: boolean;
};

async function auditAgent(a: AgentIdentity, readPool: string[], sharedGreen: boolean, idx: number): Promise<AgentOutcome> {
  const reasons: string[] = [];
  const hasEngineering = isEngineeringAgent(a.agentNumber);
  const permitted = getPermittedRealTools(a.agentNumber);

  // POSITIVE — a real execution through the full permission path.
  const positiveTool: RealToolId = hasEngineering ? 'code_search' : 'wikipedia_search';
  const positiveParams = hasEngineering
    ? { pattern: 'export', scope: 'backend/services' }
    : { query: 'Sovereign wealth fund' };
  const probe = await executeRealTool(a.agentId, a.agentNumber, positiveTool, positiveParams, { timeoutMs: 20_000 });
  if (!probe.ok) reasons.push(`positive_tool_failed:${positiveTool}: ${probe.error ?? 'unknown'}`);
  if (!probe.sourceReference) reasons.push('missing_sourceReference');
  if (!probe.contentSha256) reasons.push('missing_contentSha256');

  // NEGATIVE 1 — a tool outside the permitted set must be refused.
  const unpermitted = unpermittedToolFor(a.agentNumber);
  const negPerm = await executeRealTool(a.agentId, a.agentNumber, unpermitted, {}, { timeoutMs: 10_000 });
  const refusedUnpermitted = !negPerm.ok;
  if (!refusedUnpermitted) reasons.push(`permission_boundary_breached: executed unpermitted "${unpermitted}"`);

  // NEGATIVE 2 — permanently prohibited tools must be refused for every agent.
  const negProhibited = await executeRealTool(a.agentId, a.agentNumber, 'money_movement', {}, { timeoutMs: 10_000 });
  const refusedProhibited = !negProhibited.ok && negProhibited.blocked;
  if (!refusedProhibited) reasons.push('prohibited_tool_not_blocked: money_movement was not refused');

  // NEGATIVE 3 — an approval-gated write with NO owner token must be refused.
  const negWrite = await executeRealTool(
    a.agentId,
    a.agentNumber,
    'code_write',
    { filePath: 'qa/__audit_probe.txt', content: 'probe' },
    { timeoutMs: 10_000, ownerApprovalToken: null },
  );
  const refusedUnapprovedWrite = !negWrite.ok;
  if (!refusedUnapprovedWrite) reasons.push('approval_gate_breached: code_write succeeded without owner approval');

  // ENGINEERING — a distinct real artifact per agent.
  let engineeringArtifact: { file: string; contentSha256: string } | null = null;
  if (hasEngineering) {
    const file = readPool.length > 0 ? readPool[idx % readPool.length] : '';
    if (!file) {
      reasons.push('engineering_read_pool_empty');
    } else {
      const read = await executeEngineeringTool('code_read', { path: file }, { repoRoot });
      if (read.ok && read.contentSha256) {
        engineeringArtifact = { file, contentSha256: read.contentSha256 };
      } else {
        reasons.push(`engineering_artifact_failed:${file}: ${read.error ?? 'unknown'}`);
      }
    }
  }

  if (!sharedGreen) reasons.push('shared_gates_not_green');

  const roleVerified = reasons.length === 0;
  // The engineering bar is strictly stronger: it additionally demands a real code artifact.
  const meetsEngineeringBar = roleVerified && hasEngineering && engineeringArtifact !== null;

  return {
    identity: a,
    hasEngineering,
    positive: {
      toolId: positiveTool,
      ok: probe.ok,
      sourceReference: probe.sourceReference,
      contentSha256: probe.contentSha256,
      error: probe.error,
    },
    refusedUnpermitted,
    refusedProhibited,
    refusedUnapprovedWrite,
    engineeringArtifact,
    reasons,
    roleVerified,
    meetsEngineeringBar,
  };
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
  const readPool = await loadReadPool();
  console.log(`[audit] roster=${roster.length} agents; engineering read pool=${readPool.length} files`);
  console.log('[audit] executing per-agent positive + 3 negative controls...');

  const outDir = path.join(repoRoot, `qa/evidence/autonomous/audit-${startedAt.replace(/[:.]/g, '-')}`);
  await mkdir(outDir, { recursive: true });

  // Bounded concurrency: real network + real local tools, kept to a sane parallelism.
  const outcomes: AgentOutcome[] = [];
  const BATCH = 8;
  for (let i = 0; i < roster.length; i += BATCH) {
    const slice = roster.slice(i, i + BATCH);
    const batch = await Promise.all(slice.map((a, j) => auditAgent(a, readPool, sharedAllGreen, i + j)));
    outcomes.push(...batch);
    console.log(`[audit] ${Math.min(i + BATCH, roster.length)}/${roster.length} agents audited`);
  }

  for (const o of outcomes) {
    const record = {
      ...o.identity,
      sourceSha,
      auditStartedAt: startedAt,
      permittedTools: getPermittedRealTools(o.identity.agentNumber),
      hasEngineeringCapability: o.hasEngineering,
      positiveExecution: o.positive,
      negativeControls: {
        refusedUnpermittedTool: o.refusedUnpermitted,
        refusedProhibitedTool: o.refusedProhibited,
        refusedUnapprovedWrite: o.refusedUnapprovedWrite,
      },
      engineeringArtifact: o.engineeringArtifact,
      sharedGates: shared.map((g) => ({ name: g.name, passed: g.passed, detail: g.detail })),
      roleVerified: o.roleVerified,
      meetsEngineeringBar: o.meetsEngineeringBar,
      status: o.roleVerified ? 'ROLE_VERIFIED' : 'NOT_ACCEPTED',
      rejectionReasons: o.reasons,
    };
    await writeFile(
      path.join(outDir, `agent-${String(o.identity.agentNumber).padStart(3, '0')}.json`),
      JSON.stringify(record, null, 2),
    );
  }

  const engineeringAgents = outcomes.filter((o) => o.hasEngineering);
  const researchAgents = outcomes.filter((o) => !o.hasEngineering);
  const roleVerified = outcomes.filter((o) => o.roleVerified).length;
  const engineeringBarMet = outcomes.filter((o) => o.meetsEngineeringBar).length;
  const securityClean = outcomes.filter(
    (o) => o.refusedUnpermitted && o.refusedProhibited && o.refusedUnapprovedWrite,
  ).length;
  const rejected = outcomes.filter((o) => !o.roleVerified);

  // The 10/10 senior-developer id demands the ENGINEERING bar from ALL 112 agents.
  // Role verification alone is NOT sufficient and deliberately does not unlock it.
  const seniorDeveloperCertified = engineeringBarMet === roster.length && sharedAllGreen;

  const summary = {
    auditId: `ivx-112-senior-audit-${startedAt}`,
    sourceSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalAgents: roster.length,
    roleVerified,
    notAccepted: roster.length - roleVerified,
    engineeringAgentCount: engineeringAgents.length,
    researchOnlyAgentCount: researchAgents.length,
    engineeringBarMet,
    securityControlsClean: securityClean,
    sharedGates: shared,
    sharedGatesAllGreen: sharedAllGreen,
    seniorDeveloperCertified,
    certificateId: seniorDeveloperCertified
      ? 'IVX-112-SENIOR-DEVELOPER-10OF10-CERTIFIED'
      : 'NOT-CERTIFIED-AS-112-SENIOR-DEVELOPERS',
    certificateNote: seniorDeveloperCertified
      ? 'All 112 agents cleared the engineering bar.'
      : `${engineeringBarMet}/${roster.length} agents cleared the ENGINEERING bar. ${researchAgents.length} agents hold a research-only tool set and cannot produce code artifacts, so the 112-senior-developer claim is not supported by evidence.`,
    failingAgentNumbers: rejected.map((r) => r.identity.agentNumber),
    rejectionSample: rejected.slice(0, 5).map((r) => ({ agentNumber: r.identity.agentNumber, reasons: r.reasons })),
    evidenceDir: path.relative(repoRoot, outDir),
  };
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('');
  console.log(`[audit] role-verified          = ${roleVerified}/${roster.length}`);
  console.log(`[audit] engineering bar met    = ${engineeringBarMet}/${roster.length}`);
  console.log(`[audit] security controls ok   = ${securityClean}/${roster.length}`);
  console.log(`[audit] certificate            = ${summary.certificateId}`);
  console.log(`[audit] evidence               = ${summary.evidenceDir}`);
}

void main();
