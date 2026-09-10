/**
 * IVX Agent Code Executor API
 *
 * HTTP endpoints for the agent code execution layer. These routes connect
 * the 112 IA agents to real code execution — file writing, build loops,
 * and deployment.
 *
 *   GET  /api/ivx/agent-code-executor/status   — executor health + capabilities
 *   POST /api/ivx/agent-code-executor/write     — write files from agent output
 *   POST /api/ivx/agent-code-executor/build      — run build loop with AI error feedback
 *   POST /api/ivx/agent-code-executor/deploy     — commit + deploy to production
 *   POST /api/ivx/agent-code-executor/full        — full pipeline: write → build → deploy
 *   POST /api/ivx/agent-code-executor/112-cert    — run one execution-layer sample; 112 certification remains fail-closed
 */
import {
  writeAgentFiles,
  runBuildLoop,
  deployToProduction,
  runFullCodeExecution,
  getExecutorStatus,
  parseAIFileOutput,
  IVX_AGENT_CODE_EXECUTOR_MARKER,
  type CodeFile,
} from '../services/ivx-agent-code-executor';
import { requestIVXAIText, isIVXAIConfigured, resolveIVXAIModel, getIVXAIEndpoint } from '../ivx-ai-runtime';
import { randomUUID, createHash } from 'node:crypto';

const GITHUB_API_BASE = 'https://api.github.com';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readString(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Read the GitHub token from env or owner variables.
 */
async function readGithubToken(): Promise<string> {
  const envVal = (process.env['GITHUB_TOKEN'] || '').trim();
  if (envVal) return envVal;
  try {
    const ownerVars = await import('./ivx-owner-variables');
    if (typeof ownerVars.getIVXOwnerVariableRuntimeValue === 'function') {
      return ((await ownerVars.getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN' as never)) || '').trim();
    }
  } catch { /* noop */ }
  return '';
}

function parseGithubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ── GET /api/ivx/agent-code-executor/status ──────────────────────────────────

export function handleExecutorStatusRequest(): Response {
  const status = getExecutorStatus();
  return json({
    ok: true,
    ...status,
    endpoints: {
      write: 'POST /api/ivx/agent-code-executor/write',
      build: 'POST /api/ivx/agent-code-executor/build',
      deploy: 'POST /api/ivx/agent-code-executor/deploy',
      full: 'POST /api/ivx/agent-code-executor/full',
      certify112: 'POST /api/ivx/agent-code-executor/112-cert',
    },
  });
}

// ── POST /api/ivx/agent-code-executor/write ───────────────────────────────────

export async function handleExecutorWriteRequest(request: Request): Promise<Response> {
  let body: { files?: unknown; agentNumber?: unknown; agentId?: unknown; appName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const files: CodeFile[] = [];
  for (const f of rawFiles) {
    if (f && typeof f === 'object' && 'path' in f && 'content' in f) {
      files.push({
        path: readString((f as Record<string, unknown>).path),
        content: readString((f as Record<string, unknown>).content) || (f as Record<string, unknown>).content as string,
      });
    }
  }

  if (files.length === 0) {
    return json({ ok: false, error: 'No valid files provided. Expected: { files: [{ path, content }] }' }, 400);
  }

  const result = await writeAgentFiles(files);
  return json({ ok: result.ok, result, agentId: readString(body.agentId), agentNumber: body.agentNumber ?? null });
}

// ── POST /api/ivx/agent-code-executor/build ───────────────────────────────────

export async function handleExecutorBuildRequest(request: Request): Promise<Response> {
  let body: { files?: unknown; agentNumber?: unknown; agentId?: unknown; appName?: unknown; buildCommand?: unknown };

  // Capacity check
  const { runningAgents, targetAgents } = getExecutorStatus();
  if (runningAgents >= targetAgents) {
    return json({ ok: false, error: 'No available capacity to execute the build.' }, 503);
  }
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const files: CodeFile[] = [];
  for (const f of rawFiles) {
    if (f && typeof f === 'object' && 'path' in f && 'content' in f) {
      files.push({
        path: readString((f as Record<string, unknown>).path),
        content: readString((f as Record<string, unknown>).content) || (f as Record<string, unknown>).content as string,
      });
    }
  }

  if (files.length === 0) {
    return json({ ok: false, error: 'No valid files provided.' }, 400);
  }

  const result = await runBuildLoop(
    files,
    typeof body.agentNumber === 'number' ? body.agentNumber : null,
    readString(body.agentId) || null,
    readString(body.appName) || 'IVX Build',
    readString(body.buildCommand) || undefined,
  );
  return json({ ok: result.ok, result });
}

// ── POST /api/ivx/agent-code-executor/deploy ──────────────────────────────────

export async function handleExecutorDeployRequest(request: Request): Promise<Response> {
  let body: { files?: unknown; commitMessage?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const files: CodeFile[] = [];
  for (const f of rawFiles) {
    if (f && typeof f === 'object' && 'path' in f && 'content' in f) {
      files.push({
        path: readString((f as Record<string, unknown>).path),
        content: readString((f as Record<string, unknown>).content) || (f as Record<string, unknown>).content as string,
      });
    }
  }

  if (files.length === 0) {
    return json({ ok: false, error: 'No valid files provided.' }, 400);
  }

  const commitMessage = readString(body.commitMessage) || `IVX Agent Code Executor deploy @ ${new Date().toISOString()}`;
  const result = await deployToProduction(files, commitMessage);
  return json({ ok: result.ok, result });
}

// ── POST /api/ivx/agent-code-executor/full ────────────────────────────────────

export async function handleExecutorFullRequest(request: Request): Promise<Response> {
  let body: {
    files?: unknown;
    agentNumber?: unknown;
    agentId?: unknown;
    appName?: unknown;
    skipDeploy?: unknown;
    buildCommand?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const files: CodeFile[] = [];
  for (const f of rawFiles) {
    if (f && typeof f === 'object' && 'path' in f && 'content' in f) {
      files.push({
        path: readString((f as Record<string, unknown>).path),
        content: readString((f as Record<string, unknown>).content) || (f as Record<string, unknown>).content as string,
      });
    }
  }

  if (files.length === 0) {
    return json({ ok: false, error: 'No valid files provided.' }, 400);
  }

  const result = await runFullCodeExecution(
    files,
    typeof body.agentNumber === 'number' ? body.agentNumber : null,
    readString(body.agentId) || null,
    readString(body.appName) || 'IVX App',
    body.skipDeploy === true,
  );
  return json({ ok: result.ok, result });
}

// ── POST /api/ivx/agent-code-executor/112-cert ────────────────────────────────

/**
 * Exercise the shared code execution layer with one sample agent.
 *
 * This endpoint runs a real proof: it generates a unique code file via AI
 * for a sample agent, writes it, builds it, and (optionally) deploys it.
 * The proof is that the agent produced REAL code that compiles and deploys.
 *
 * Historical versions incorrectly called this a 112-agent certificate even
 * though only IA-1 generated one file. The compatibility endpoint remains, but
 * `certified` and `certified112` stay false until 112 distinct agent outcomes,
 * leases, heartbeats and exact production evidence are supplied.
 */
export async function handleExecutor112CertRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const certId = `ivx-112-code-executor-cert-${randomUUID().slice(0, 8)}`;

  let body: { skipDeploy?: unknown; sampleAgentCount?: unknown };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  const skipDeploy = body.skipDeploy === true;
  const aiConfigured = isIVXAIConfigured();
  const aiModel = resolveIVXAIModel();
  const aiEndpoint = getIVXAIEndpoint(aiModel);

  // Generate a proof file via AI — this proves the AI can write real code
  const proofAgentNumber = 1;
  const proofAgentId = 'ivx_holdings_1';
  const proofAppName = 'IVX Code Executor Proof';

  const systemPrompt =
    `You are IVX IA-1, a real coding agent. Generate a real TypeScript module ` +
    `that exports a function returning a proof object. The module must be valid TypeScript ` +
    `that compiles with tsc --noEmit. Return ONLY the file content, no markdown fences.`;

  const userPrompt =
    `Generate a TypeScript file at backend/proof/ivx-agent-code-executor-proof.ts ` +
    `that exports a function called getExecutorProof() returning an object with: ` +
    `agentNumber (number), agentId (string), timestamp (string), proofToken (string), ` +
    `and source (string, must be "remote_api"). Make the proofToken "IVX-EXEC-PROOF-LIVE-001". ` +
    `Return ONLY the TypeScript code, no explanations, no markdown fences.`;

  let aiSource = 'not_configured';
  let aiOutput = '';
  let llmCallCount = 0;

  if (aiConfigured) {
    try {
      const aiResult = await requestIVXAIText({
        module: 'agent-code-executor-112-cert',
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1000,
        requestId: `code-exec-112-cert-${randomUUID().slice(0, 8)}`,
      });
      aiOutput = aiResult.text;
      aiSource = aiResult.providerMetadata.source;
      llmCallCount++;
    } catch (err) {
      return json({
        ok: false,
        error: `AI inference failed: ${err instanceof Error ? err.message : 'unknown'}`,
        certId,
        timestamp,
      }, 500);
    }
  } else {
    return json({
      ok: false,
      error: 'AI not configured — cannot certify code execution without AI inference.',
      certId,
      timestamp,
    }, 500);
  }

  // Parse the AI output into a file
  let proofFiles = parseAIFileOutput(aiOutput);

  // If parsing failed, use the raw output as the file content
  if (proofFiles.length === 0) {
    const cleaned = aiOutput.replace(/^```(?:typescript|ts)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
    proofFiles = [{
      path: 'backend/proof/ivx-agent-code-executor-proof.ts',
      content: cleaned,
    }];
  }

  // Run the full execution pipeline
  const executionResult = await runFullCodeExecution(
    proofFiles,
    proofAgentNumber,
    proofAgentId,
    proofAppName,
    skipDeploy,
  );

  const totalDurationMs = Date.now() - startedAt;
  const proofHash = sha256(JSON.stringify(executionResult) + certId);

  // Build an honest sample result. One shared-layer run is not 112-agent proof.
  const sampledAgents = 1;
  const certified112 = false;
  const certResult = {
    ok: executionResult.ok,
    certified: certified112,
    certified112,
    layerSampleVerified: executionResult.ok,
    sampledAgents,
    requiredAgents: 112,
    certId,
    marker: IVX_AGENT_CODE_EXECUTOR_MARKER,
    timestamp,
    proofHash,
    summary: executionResult.ok
      ? `Execution-layer sample verified for ${sampledAgents}/112 agents: AI generated code, wrote it to disk and the build passed; fleet certification remains NOT VERIFIED${skipDeploy ? ' and deployment was skipped' : ''}.`
      : `Code execution layer BLOCKED: ${executionResult.error}`,
    aiConfigured,
    aiModel,
    aiEndpoint,
    aiSource,
    llmCallCount,
    agentProof: {
      agentNumber: proofAgentNumber,
      agentId: proofAgentId,
      appName: proofAppName,
      filesGenerated: proofFiles.map(f => f.path),
      aiOutputLength: aiOutput.length,
      aiOutputHash: sha256(aiOutput),
    },
    execution: executionResult,
    totalDurationMs,
    capabilities: {
      fileWriting: executionResult.writeResult.ok,
      buildLoop: executionResult.buildResult.buildPassed,
      aiErrorFeedback: executionResult.buildResult.iterations.some(i => i.aiRevisedCode),
      deploy: skipDeploy ? null : (executionResult.deployResult?.ok ?? false),
      commitSha: skipDeploy ? null : (executionResult.deployResult?.commitSha ?? null),
      commitUrl: skipDeploy ? null : (executionResult.deployResult?.commitUrl ?? null),
    },
    certificationBlockers: [
      `DISTINCT_AGENT_EXECUTION_EVIDENCE:${sampledAgents}/112`,
      'DISTINCT_ACTIVE_LEASES:required_112',
      'FRESH_HEARTBEATS:required_112',
      'EXACT_PRODUCTION_EVIDENCE:required_per_agent',
    ],
    proofDefinition:
      'This result proves only the sampled shared execution path. Exact 112/112 certification requires distinct evidence for every agent plus the fail-closed fleet truth gate; registry membership or one sample cannot certify the fleet.',
  };

  return json(certResult, executionResult.ok ? 200 : 500);
}
