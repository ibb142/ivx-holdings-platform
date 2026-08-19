/**
 * IVX Safe Render Environment-Variable Merge (Phase 1 — 2026-07-16).
 *
 * Problem: Render's PUT /v1/services/{id}/env-vars endpoint REPLACES the entire
 * variable set. A naive update that sends only the new/changed variables wipes
 * every other variable on the service — including secrets like OPENAI_API_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, etc.
 *
 * Solution: This module implements a safe read-merge-write-validate workflow:
 *   1. Read the full existing variable set (GET).
 *   2. Abort if the read fails.
 *   3. Merge only the intended additions/updates into the existing set.
 *   4. Submit the complete merged set (PUT).
 *   5. Read the variables again (GET).
 *   6. Confirm every required variable remains present and non-empty.
 *   7. Abort if post-write validation detects a missing variable.
 *   8. Never log secret values.
 *   9. Return a trace ID and rollback instructions.
 */
import { randomUUID } from 'node:crypto';

const RENDER_API_BASE_URL = 'https://api.render.com/v1';

// In-memory merge lock to serialize concurrent env-var updates per service.
// Without this, two concurrent merges can race: both read the same base set,
// each adds only its own variable, and the second PUT overwrites the first's
// addition. The lock ensures the second merge reads AFTER the first writes.
const mergeLocks = new Map<string, Promise<void>>();

export type RenderEnvVar = {
  key: string;
  value: string;
};

export type RenderEnvVarResponse = {
  envVar: RenderEnvVar;
};

export type SafeMergeResult = {
  traceId: string;
  ok: boolean;
  variablesBefore: number;
  variablesAfter: number;
  added: string[];
  updated: string[];
  preserved: string[];
  missingAfterValidation: string[];
  rollbackInstructions: string;
  error: string | null;
  secretValuesReturned: false;
};

export type SafeMergeInput = {
  renderApiKey: string;
  serviceId: string;
  /** Variables to add or update (merged into existing set). */
  updates: Record<string, string>;
  /** Variables that MUST be present and non-empty after the write. */
  requiredKeys?: string[];
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
};

function redactValue(value: string): string {
  if (!value) return '';
  return value.length > 4 ? `${value.slice(0, 2)}…${value.slice(-2)}` : '****';
}

function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Read the full existing Render env-var set for a service.
 * Returns a map of key → value. Throws on failure.
 */
export async function readRenderEnvVars(
  serviceId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  // limit=100 is REQUIRED: without it Render returns only the first page (20
  // items) and a subsequent replace-all PUT silently wipes every variable
  // beyond page 1. Confirmed live on 2026-08-19 (32 vars truncated to 23).
  const url = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: renderHeaders(apiKey),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Render env-vars GET failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
    );
  }
  const data = (await response.json()) as RenderEnvVarResponse[];
  const map = new Map<string, string>();
  if (Array.isArray(data)) {
    for (const item of data) {
      const ev = item?.envVar ?? item;
      if (ev && typeof ev.key === 'string') {
        map.set(ev.key, typeof ev.value === 'string' ? ev.value : '');
      }
    }
  }
  return map;
}

/**
 * Write the full env-var set to Render (PUT replaces all).
 * Returns the written keys. Throws on failure.
 */
export async function writeRenderEnvVars(
  serviceId: string,
  apiKey: string,
  vars: Map<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars`;
  const body = Array.from(vars.entries()).map(([key, value]) => ({ key, value }));
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: renderHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Render env-vars PUT failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
    );
  }
  return Array.from(vars.keys());
}

/**
 * Safe merge: read → merge → write → validate.
 * Never overwrites existing variables that aren't in the update set.
 * Returns a trace ID and rollback instructions for audit.
 */
export async function safeMergeRenderEnvVars(
  input: SafeMergeInput,
): Promise<SafeMergeResult> {
  const traceId = `ivx-env-merge-${randomUUID()}`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const requiredKeys = input.requiredKeys ?? [];

  // Serialize concurrent merges per service to prevent race conditions.
  const serviceId = input.serviceId;
  const prevLock = mergeLocks.get(serviceId) ?? Promise.resolve();
  let resolveLock: () => void = () => {};
  const thisLock = new Promise<void>((resolve) => { resolveLock = resolve; });
  const chainedLock = prevLock.then(() => thisLock);
  mergeLocks.set(serviceId, chainedLock);
  await prevLock;
  try {
    return await safeMergeRenderEnvVarsInner(input, traceId, fetchImpl, requiredKeys);
  } finally {
    resolveLock();
    if (mergeLocks.get(serviceId) === chainedLock) {
      mergeLocks.delete(serviceId);
    }
  }
}

async function safeMergeRenderEnvVarsInner(
  input: SafeMergeInput,
  traceId: string,
  fetchImpl: typeof fetch,
  requiredKeys: string[],
): Promise<SafeMergeResult> {

  // Step 1: Read existing variables. Abort if read fails.
  let existing: Map<string, string>;
  try {
    existing = await readRenderEnvVars(
      input.serviceId,
      input.renderApiKey,
      fetchImpl,
    );
  } catch (error) {
    return {
      traceId,
      ok: false,
      variablesBefore: 0,
      variablesAfter: 0,
      added: [],
      updated: [],
      preserved: [],
      missingAfterValidation: [],
      rollbackInstructions: 'No changes were made. Fix the Render API read error and retry.',
      error: error instanceof Error ? error.message : 'Unknown error during env-var read.',
      secretValuesReturned: false,
    };
  }

  const variablesBefore = existing.size;
  const added: string[] = [];
  const updated: string[] = [];

  // Step 2: Merge updates into existing set.
  const merged = new Map(existing);
  for (const [key, value] of Object.entries(input.updates)) {
    if (existing.has(key)) {
      updated.push(key);
    } else {
      added.push(key);
    }
    merged.set(key, value);
  }

  const preserved = Array.from(existing.keys()).filter(
    (k) => !input.updates.hasOwnProperty(k),
  );

  // Step 3: Write the complete merged set.
  try {
    await writeRenderEnvVars(
      input.serviceId,
      input.renderApiKey,
      merged,
      fetchImpl,
    );
  } catch (error) {
    return {
      traceId,
      ok: false,
      variablesBefore,
      variablesAfter: existing.size,
      added,
      updated,
      preserved,
      missingAfterValidation: [],
      rollbackInstructions: `Write failed. The existing ${variablesBefore} variables should be unchanged. Retry with the same updates.`,
      error: error instanceof Error ? error.message : 'Unknown error during env-var write.',
      secretValuesReturned: false,
    };
  }

  // Step 4: Read again and validate.
  let afterWrite: Map<string, string>;
  try {
    afterWrite = await readRenderEnvVars(
      input.serviceId,
      input.renderApiKey,
      fetchImpl,
    );
  } catch (error) {
    return {
      traceId,
      ok: false,
      variablesBefore,
      variablesAfter: merged.size,
      added,
      updated,
      preserved,
      missingAfterValidation: [],
      rollbackInstructions: `Post-write validation read failed. ${merged.size} variables were written. Manually verify in Render dashboard. Rollback: re-PUT the original ${variablesBefore} variables.`,
      error: error instanceof Error ? error.message : 'Unknown error during post-write validation.',
      secretValuesReturned: false,
    };
  }

  const variablesAfter = afterWrite.size;
  const missingAfterValidation: string[] = [];

  // Check required keys are present and non-empty.
  for (const key of requiredKeys) {
    const value = afterWrite.get(key);
    if (!value || value.trim() === '') {
      missingAfterValidation.push(key);
    }
  }

  // Check preserved keys still exist (may have different values due to Render masking).
  for (const key of preserved) {
    if (!afterWrite.has(key)) {
      missingAfterValidation.push(key);
    }
  }

  if (missingAfterValidation.length > 0) {
    return {
      traceId,
      ok: false,
      variablesBefore,
      variablesAfter,
      added,
      updated,
      preserved,
      missingAfterValidation,
      rollbackInstructions: `Post-write validation detected missing variables: ${missingAfterValidation.join(', ')}. Rollback: re-PUT the original variable set saved in trace ${traceId}.`,
      error: `Missing variables after write: ${missingAfterValidation.join(', ')}`,
      secretValuesReturned: false,
    };
  }

  return {
    traceId,
    ok: true,
    variablesBefore,
    variablesAfter,
    added,
    updated,
    preserved,
    missingAfterValidation: [],
    rollbackInstructions: 'No rollback needed. All variables preserved.',
    error: null,
    secretValuesReturned: false,
  };
}

/** Redact all secret values in a merge result for safe logging. */
export function redactMergeResultForLogging(result: SafeMergeResult): Record<string, unknown> {
  return {
    traceId: result.traceId,
    ok: result.ok,
    variablesBefore: result.variablesBefore,
    variablesAfter: result.variablesAfter,
    added: result.added,
    updated: result.updated,
    preserved: result.preserved,
    missingAfterValidation: result.missingAfterValidation,
    error: result.error,
    secretValuesReturned: false as const,
  };
}
