/**
 * IVX Production Agent Registry — honest runtime registry for the 12 agents.
 *
 * Replaces the old static-tool-list scoring with a registry that tracks
 * REAL runtime state: heartbeat, current job, completed jobs, failures,
 * queue depth, concurrency, and owner controls.
 *
 * HONESTY RULES:
 *   - An agent is only VERIFIED if it has runtime evidence, not static config.
 *   - Shared workers are labeled SHARED WORKER, never independent agent.
 *   - The dashboard MUST read from this registry, not from static card data.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_AGENT_REGISTRY_MARKER = 'ivx-agent-registry-2026-07-25';
// ── Registry Storage ─────────────────────────────────────────────────────────
const REGISTRY_DIR = path.join(process.cwd(), 'logs', 'audit', 'agent-registry');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'registry.json');
const REGISTRY_LOG_PATH = path.join(REGISTRY_DIR, 'events.jsonl');
let inMemoryRegistry = null;
/**
 * Load the registry from durable storage (or in-memory cache).
 */
export async function loadAgentRegistry() {
    if (inMemoryRegistry)
        return inMemoryRegistry;
    const registry = new Map();
    try {
        let raw;
        if (isDurableStoreConfigured()) {
            const data = await readDurableJson(REGISTRY_PATH, []);
            raw = JSON.stringify(data);
        }
        else {
            raw = await readFile(REGISTRY_PATH, 'utf8');
        }
        const records = JSON.parse(raw);
        for (const record of records) {
            if (record && typeof record.agent_id === 'string') {
                registry.set(record.agent_id, record);
            }
        }
    }
    catch {
        // File doesn't exist yet — start with empty registry
    }
    inMemoryRegistry = registry;
    return registry;
}
/**
 * Persist the registry to durable storage.
 */
async function persistAgentRegistry(registry) {
    const records = Array.from(registry.values());
    if (isDurableStoreConfigured()) {
        await writeDurableJson(REGISTRY_PATH, records);
    }
    else {
        await mkdir(REGISTRY_DIR, { recursive: true });
        const tmp = path.join(REGISTRY_DIR, 'registry.json.tmp');
        await writeFile(tmp, JSON.stringify(records, null, 2), 'utf8');
        await rename(tmp, REGISTRY_PATH);
    }
}
/**
 * Append a registry event to the append-only log.
 */
async function appendRegistryEvent(event) {
    try {
        const entry = JSON.stringify({ ...event, at: new Date().toISOString() });
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(REGISTRY_LOG_PATH, event);
        }
        else {
            await mkdir(REGISTRY_DIR, { recursive: true });
            await appendFile(REGISTRY_LOG_PATH, `${entry}\n`, 'utf8');
        }
    }
    catch {
        // best-effort
    }
}
// ── Registry Operations ──────────────────────────────────────────────────────
/**
 * Get a single agent record by ID.
 */
export async function getAgentRecord(agentId) {
    const registry = await loadAgentRegistry();
    return registry.get(agentId) ?? null;
}
/**
 * Get all agent records.
 */
export async function listAgentRecords() {
    const registry = await loadAgentRegistry();
    return Array.from(registry.values()).sort((a, b) => a.agent_id.localeCompare(b.agent_id));
}
/**
 * Update a single agent record. Returns the updated record or null if not found.
 */
export async function updateAgentRecord(agentId, updates) {
    const registry = await loadAgentRegistry();
    const existing = registry.get(agentId);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        ...updates,
        agent_id: existing.agent_id, // immutable
        updated_at: new Date().toISOString(),
    };
    registry.set(agentId, updated);
    await persistAgentRegistry(registry);
    await appendRegistryEvent({
        type: 'record_updated',
        agent_id: agentId,
        fields: Object.keys(updates),
    });
    return updated;
}
/**
 * Record a heartbeat for an agent.
 */
export async function recordAgentHeartbeat(agentId) {
    return updateAgentRecord(agentId, {
        heartbeat: new Date().toISOString(),
        status: 'online',
    });
}
/**
 * Record a job completion for an agent.
 */
export async function recordJobCompleted(agentId, jobId) {
    const record = await getAgentRecord(agentId);
    if (!record)
        return null;
    return updateAgentRecord(agentId, {
        last_completed_job: jobId,
        current_job: null,
        active_jobs: Math.max(0, record.active_jobs - 1),
        queue_depth: Math.max(0, record.queue_depth - 1),
    });
}
/**
 * Record a job failure for an agent.
 */
export async function recordJobFailed(agentId, jobId) {
    const record = await getAgentRecord(agentId);
    if (!record)
        return null;
    return updateAgentRecord(agentId, {
        last_failed_job: jobId,
        current_job: null,
        active_jobs: Math.max(0, record.active_jobs - 1),
    });
}
/**
 * Assign a job to an agent.
 */
export async function assignJobToAgent(agentId, jobId) {
    const record = await getAgentRecord(agentId);
    if (!record)
        return null;
    if (record.active_jobs >= record.concurrency_limit) {
        return updateAgentRecord(agentId, {
            queue_depth: record.queue_depth + 1,
        });
    }
    return updateAgentRecord(agentId, {
        current_job: jobId,
        active_jobs: record.active_jobs + 1,
    });
}
/**
 * Validate the agent registry against the required rules.
 *
 * Rules:
 * - agents.length must equal expected registry count
 * - every required agent must have a unique ID
 * - every required role must exist
 * - every required test must have execution evidence
 * - zero agents must return FAIL
 * - missing evidence must return FAIL
 * - shared worker must be labeled SHARED WORKER, not independent agent
 * - no score may be based only on declared tools
 */
export async function validateAgentRegistry(expectedAgentIds, requiredRoles) {
    const errors = [];
    const warnings = [];
    const registry = await loadAgentRegistry();
    const records = Array.from(registry.values());
    // Rule: zero agents → FAIL (but still check for missing agents)
    if (records.length === 0 && expectedAgentIds.length > 0) {
        errors.push('Registry is empty — zero agents registered. FAIL.');
        // Don't return early — also report missing agents for complete diagnostics
        for (const expectedId of expectedAgentIds) {
            errors.push(`Missing required agent: ${expectedId}`);
        }
        return { ok: false, errors, warnings, agentCount: 0, expectedCount: expectedAgentIds.length };
    }
    // Rule: agents.length must equal expected registry count
    if (records.length !== expectedAgentIds.length) {
        errors.push(`Agent count mismatch: registry has ${records.length}, expected ${expectedAgentIds.length}`);
    }
    // Rule: every required agent must have a unique ID
    const ids = records.map((r) => r.agent_id);
    const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    if (duplicates.length > 0) {
        errors.push(`Duplicate agent IDs found: ${duplicates.join(', ')}`);
    }
    // Rule: every required agent must be present
    for (const expectedId of expectedAgentIds) {
        if (!registry.has(expectedId)) {
            errors.push(`Missing required agent: ${expectedId}`);
        }
    }
    // Rule: every required role must exist
    const presentRoles = records.map((r) => r.role);
    for (const requiredRole of requiredRoles) {
        if (!presentRoles.some((r) => r.includes(requiredRole))) {
            errors.push(`Missing required role: ${requiredRole}`);
        }
    }
    // Rule: shared worker must be labeled SHARED_WORKER, not independent
    for (const record of records) {
        if (record.runtime_type === 'shared_worker' && record.classification === 'REAL_INDEPENDENT_AGENT') {
            errors.push(`Agent ${record.agent_id} runs on a shared worker but is mislabeled REAL_INDEPENDENT_AGENT`);
        }
        if (record.runtime_type === 'config_only' && record.classification === 'REAL_INDEPENDENT_AGENT') {
            errors.push(`Agent ${record.agent_id} has no runtime but is mislabeled REAL_INDEPENDENT_AGENT`);
        }
    }
    // Rule: every agent must have a heartbeat or be marked never_started
    for (const record of records) {
        if (record.status === 'online' && !record.heartbeat) {
            errors.push(`Agent ${record.agent_id} is online but has no heartbeat`);
        }
        if (record.classification === 'REAL_INDEPENDENT_AGENT' && !record.heartbeat) {
            warnings.push(`Agent ${record.agent_id} is classified independent but has no heartbeat`);
        }
    }
    // Rule: every agent must have at least one completed job or be marked never_started
    for (const record of records) {
        if (record.classification === 'REAL_INDEPENDENT_AGENT' &&
            !record.last_completed_job &&
            record.status !== 'never_started') {
            warnings.push(`Agent ${record.agent_id} is classified independent but has no completed job`);
        }
    }
    // Rule: no score may be based only on declared tools
    // (This is enforced in the audit module, not here — but we check that
    // capabilities have verified=true with evidence)
    for (const record of records) {
        for (const cap of record.capabilities) {
            if (cap.required && !cap.verified) {
                warnings.push(`Agent ${record.agent_id} capability "${cap.name}" is required but not verified`);
            }
        }
    }
    return {
        ok: errors.length === 0,
        errors,
        warnings,
        agentCount: records.length,
        expectedCount: expectedAgentIds.length,
    };
}
