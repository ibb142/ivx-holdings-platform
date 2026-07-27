/**
 * IVX Scoped Memory — owner-only HTTP routes (GATE 1).
 *
 * Four-layer memory isolation: task / agent / company / enterprise.
 * Enforces cross-agent, cross-company, and division-level isolation.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  createScopedMemory,
  retrieveScopedMemory,
  buildScopedContextPackage,
  revokeMemory,
  applyOwnerInstructionOverride,
  summarizeScopedMemory,
  validateScopedMemoryInput,
  isScopedMemorySecret,
  IVX_SCOPED_MEMORY_MARKER,
  type MemoryLayer,
  type MemoryKind,
  type EnterpriseMemoryKind,
  type MemoryAccessContext,
} from '../services/ivx-scoped-memory-store';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .slice(0, 320) || fallback;
}

function getErrorStatus(error: unknown): number {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (msg.includes('missing bearer token') || msg.includes('invalid or expired')) return 401;
  if (msg.includes('privileged ivx access is required')) return 403;
  if (msg.includes('required') || msg.includes('not configured')) return 503;
  return 500;
}

function errorResponse(error: unknown): Response {
  return ownerOnlyJson({
    ok: false,
    error: sanitizeError(error, 'IVX scoped memory route failed.'),
    marker: IVX_SCOPED_MEMORY_MARKER,
    timestamp: new Date().toISOString(),
  }, getErrorStatus(error));
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

// ─── Status / Summary ─────────────────────────────────────────────

export async function handleStatus(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const summary = await summarizeScopedMemory();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      summary,
      layers: ['task', 'agent', 'company', 'enterprise'],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Create Memory ────────────────────────────────────────────────

type CreateBody = {
  layer?: unknown;
  scopeId?: unknown;
  kind?: unknown;
  content?: unknown;
  source?: unknown;
  sourceType?: unknown;
  sourceLabel?: unknown;
  tags?: unknown;
  expiresAt?: unknown;
  sourceFilePath?: unknown;
  sourceCommitSha?: unknown;
  writeCtx?: unknown;
};

export async function handleCreate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as CreateBody;

    // Build write context from body or default to owner.
    const writeCtx = body.writeCtx && typeof body.writeCtx === 'object'
      ? body.writeCtx as MemoryAccessContext
      : { agentId: 'owner', companyId: null, taskId: null, isOwner: true };

    const result = await createScopedMemory({
      layer: readTrimmed(body.layer) as MemoryLayer,
      scopeId: readTrimmed(body.scopeId),
      kind: readTrimmed(body.kind) as MemoryKind,
      content: readTrimmed(body.content),
      source: readTrimmed(body.source),
      sourceType: (readTrimmed(body.sourceType) as 'file' | 'api' | 'owner' | 'agent' | 'system') || 'system',
      sourceLabel: readTrimmed(body.sourceLabel),
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      expiresAt: body.expiresAt ? String(body.expiresAt) : null,
      sourceFilePath: body.sourceFilePath ? String(body.sourceFilePath) : null,
      sourceCommitSha: body.sourceCommitSha ? String(body.sourceCommitSha) : null,
      writeCtx,
    });

    if (!result.ok) {
      return ownerOnlyJson({
        ok: false,
        error: result.error,
        marker: IVX_SCOPED_MEMORY_MARKER,
      }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Retrieve Memory ──────────────────────────────────────────────

type RetrieveBody = {
  query?: unknown;
  accessCtx?: unknown;
};

export async function handleRetrieve(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as RetrieveBody;

    const query = (body.query && typeof body.query === 'object' ? body.query : {}) as Record<string, unknown>;
    const accessCtx = (body.accessCtx && typeof body.accessCtx === 'object'
      ? body.accessCtx
      : { agentId: 'owner', companyId: null, taskId: null, isOwner: true }) as MemoryAccessContext;

    const result = await retrieveScopedMemory(
      {
        layer: readTrimmed(query.layer) as MemoryLayer || undefined,
        scopeId: readTrimmed(query.scopeId) || undefined,
        kind: readTrimmed(query.kind) as MemoryKind || undefined,
        tags: Array.isArray(query.tags) ? query.tags as string[] : undefined,
        search: readTrimmed(query.search) || undefined,
        includeRevoked: query.includeRevoked === true,
        includeExpired: query.includeExpired === true,
        includeSuperseded: query.includeSuperseded === true,
        limit: query.limit ? Number(query.limit) : undefined,
      },
      accessCtx,
    );

    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      records: result.records,
      count: result.records.length,
      denied: result.denied,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Build Context Package ────────────────────────────────────────

type BuildContextBody = {
  accessCtx?: unknown;
  taskId?: unknown;
  taskKeywords?: unknown;
  currentCommitSha?: unknown;
  search?: unknown;
  limit?: unknown;
};

export async function handleBuildContext(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as BuildContextBody;

    const accessCtx = (body.accessCtx && typeof body.accessCtx === 'object'
      ? body.accessCtx
      : { agentId: 'owner', companyId: null, taskId: null, isOwner: true }) as MemoryAccessContext;

    const ctxPackage = await buildScopedContextPackage(accessCtx, {
      taskId: body.taskId ? String(body.taskId) : undefined,
      taskKeywords: Array.isArray(body.taskKeywords) ? body.taskKeywords as string[] : undefined,
      currentCommitSha: body.currentCommitSha ? String(body.currentCommitSha) : undefined,
      search: body.search ? String(body.search) : undefined,
      limit: body.limit ? Number(body.limit) : undefined,
    });

    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      contextPackage: ctxPackage,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Revoke Memory ────────────────────────────────────────────────

type RevokeBody = {
  id?: unknown;
  revokedBy?: unknown;
  writeCtx?: unknown;
};

export async function handleRevoke(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as RevokeBody;
    const id = readTrimmed(body.id);
    if (!id) {
      return ownerOnlyJson({ ok: false, error: 'id is required.', marker: IVX_SCOPED_MEMORY_MARKER }, 400);
    }

    const writeCtx = body.writeCtx && typeof body.writeCtx === 'object'
      ? body.writeCtx as MemoryAccessContext
      : { agentId: 'owner', companyId: null, taskId: null, isOwner: true };

    const result = await revokeMemory(id, readTrimmed(body.revokedBy) || 'owner', writeCtx);
    if (!result.ok) {
      return ownerOnlyJson({ ok: false, error: result.error, marker: IVX_SCOPED_MEMORY_MARKER }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Owner Instruction Override ───────────────────────────────────

type OverrideBody = {
  kind?: unknown;
  content?: unknown;
  sourceLabel?: unknown;
  tags?: unknown;
};

const VALID_ENTERPRISE_KINDS: ReadonlySet<string> = new Set([
  'ivx_policy', 'owner_restriction', 'security_rule', 'approval_requirement', 'architecture_context',
]);

export async function handleOwnerOverride(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as OverrideBody;
    const kind = readTrimmed(body.kind);
    if (!VALID_ENTERPRISE_KINDS.has(kind)) {
      return ownerOnlyJson({
        ok: false,
        error: 'kind must be an enterprise-layer kind (ivx_policy | owner_restriction | security_rule | approval_requirement | architecture_context).',
        marker: IVX_SCOPED_MEMORY_MARKER,
      }, 400);
    }

    const result = await applyOwnerInstructionOverride({
      kind: kind as EnterpriseMemoryKind,
      content: readTrimmed(body.content),
      sourceLabel: readTrimmed(body.sourceLabel),
      tags: Array.isArray(body.tags) ? body.tags as string[] : undefined,
    });

    if (!result.ok) {
      return ownerOnlyJson({ ok: false, error: result.error, marker: IVX_SCOPED_MEMORY_MARKER }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Validation Helper ────────────────────────────────────────────

type ValidateBody = {
  layer?: unknown;
  scopeId?: unknown;
  kind?: unknown;
  content?: unknown;
  source?: unknown;
};

export async function handleValidate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as ValidateBody;
    const result = validateScopedMemoryInput({
      layer: body.layer,
      scopeId: body.scopeId,
      kind: body.kind,
      content: body.content,
      source: body.source,
    });
    return ownerOnlyJson({
      ok: true,
      marker: IVX_SCOPED_MEMORY_MARKER,
      valid: result.ok,
      error: result.ok ? null : result.error,
      isSecret: isScopedMemorySecret(String(body.content ?? '')),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
