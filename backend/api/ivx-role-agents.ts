/**
 * IVX Role-Based Autonomous Agent Cloning routes (owner-only).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  ROLE_AGENTS,
  ROLE_AGENTS_MARKER,
  ROLE_AGENT_IDS,
  enqueueRoleTask,
  getRoleAgentRegistry,
  getRoleAgentsState,
  listRoleAgentOutputs,
  runAllRoleAgents,
  runRoleAgent,
  runRoleAgentValidation,
  setRoleAgentsEnabled,
  type RoleAgentId,
} from '../services/agents/role-agents';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getStatus(error: unknown): number {
  const m = error instanceof Error ? error.message.toLowerCase() : '';
  if (m.includes('missing bearer token') || m.includes('invalid or expired')) return 401;
  if (m.includes('privileged ivx access is required')) return 403;
  if (m.includes('required') || m.includes('not found') || m.includes('unknown agent')) return 400;
  return 500;
}

function errorResponse(error: unknown): Response {
  const msg = error instanceof Error ? error.message : 'IVX role-agent route failed.';
  return ownerOnlyJson({
    ok: false,
    error: msg.slice(0, 320),
    marker: ROLE_AGENTS_MARKER,
    timestamp: new Date().toISOString(),
  }, getStatus(error));
}

const VALID_IDS = new Set<string>(ROLE_AGENT_IDS);

function readRoleAgentId(value: unknown): RoleAgentId | undefined {
  const s = readTrimmed(value);
  return VALID_IDS.has(s) ? (s as RoleAgentId) : undefined;
}

export function OPTIONS(): Response { return ownerOnlyOptions(); }

/** GET — the role-agent registry (definitions + live stats). */
export async function handleRoleAgentRegistry(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    return ownerOnlyJson({
      ok: true,
      marker: ROLE_AGENTS_MARKER,
      agentCount: ROLE_AGENT_IDS.length,
      registry: await getRoleAgentRegistry(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) { return errorResponse(error); }
}

/** GET — full durable state (queues + outputs). */
export async function handleRoleAgentState(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    return ownerOnlyJson({
      ok: true,
      state: await getRoleAgentsState(),
      marker: ROLE_AGENTS_MARKER,
      timestamp: new Date().toISOString(),
    });
  } catch (error) { return errorResponse(error); }
}

/** GET — output records (optionally ?agentId=&limit=). */
export async function handleRoleAgentOutputs(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const url = new URL(request.url);
    const agentId = readRoleAgentId(url.searchParams.get('agentId'));
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    return ownerOnlyJson({
      ok: true,
      outputs: await listRoleAgentOutputs(agentId, limit),
      marker: ROLE_AGENTS_MARKER,
      timestamp: new Date().toISOString(),
    });
  } catch (error) { return errorResponse(error); }
}

/** POST — enqueue a task for a role agent. */
export async function handleRoleAgentEnqueue(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = readRoleAgentId(body.agentId);
    const goal = readTrimmed(body.goal);
    if (!agentId) throw new Error('unknown agent: agentId is required.');
    if (!goal) throw new Error('goal is required.');
    const item = await enqueueRoleTask({
      agentId,
      goal,
      destructive: typeof body.destructive === 'boolean' ? body.destructive : undefined,
      approverEmail: readTrimmed(body.approverEmail) || null,
    });
    return ownerOnlyJson({ ok: true, queued: item, marker: ROLE_AGENTS_MARKER, timestamp: new Date().toISOString() }, 201);
  } catch (error) { return errorResponse(error); }
}

/** POST — run one role agent now (?agentId in body). */
export async function handleRoleAgentRun(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = readRoleAgentId(body.agentId);
    if (!agentId) throw new Error('unknown agent: agentId is required.');
    const output = await runRoleAgent(agentId);
    return ownerOnlyJson({ ok: true, output, marker: ROLE_AGENTS_MARKER, timestamp: new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}

/** POST — run one cycle for every role agent. */
export async function handleRoleAgentRunAll(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const outputs = await runAllRoleAgents();
    return ownerOnlyJson({ ok: true, outputs, ran: outputs.length, marker: ROLE_AGENTS_MARKER, timestamp: new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}

/** POST — enable/disable the role-agent run loop. */
export async function handleRoleAgentToggle(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') throw new Error('enabled (boolean) is required.');
    const state = await setRoleAgentsEnabled(body.enabled);
    return ownerOnlyJson({ ok: true, enabled: state.enabled, marker: ROLE_AGENTS_MARKER, timestamp: new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}

/** POST/GET — end-to-end validation (one real run per agent + owner-gate proof). */
export async function handleRoleAgentValidate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const result = await runRoleAgentValidation();
    return ownerOnlyJson({
      ok: result.ok,
      validation: result,
      agents: Object.values(ROLE_AGENTS).map((a) => ({ id: a.id, roleName: a.roleName, goal: a.goal })),
      marker: ROLE_AGENTS_MARKER,
      timestamp: new Date().toISOString(),
    });
  } catch (error) { return errorResponse(error); }
}
