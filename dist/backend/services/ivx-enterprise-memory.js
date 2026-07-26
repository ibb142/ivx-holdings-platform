/**
 * IVX Enterprise Memory — Phase 7.
 *
 * Persistent knowledge store for the entire enterprise platform:
 *   - Architecture decisions and rationale
 *   - Deployment history with outcomes
 *   - Recurring issues and proven fixes
 *   - Coding standards and conventions
 *   - Business decisions and context
 *   - Agent learnings across runs
 *
 * All subsystems query this memory before making decisions.
 *
 * HARD HONESTY RULES:
 *   - Memory is always grounded in real events — never fabricated.
 *   - Each entry includes source attribution.
 *   - Outdated entries are flagged, not deleted.
 *   - Memory is searchable and queryable by all subsystems.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_ENTERPRISE_MEMORY_MARKER = 'ivx-enterprise-memory-2026-07-01';
// ── Durable Store ──────────────────────────────────────────────────────────
const MEMORY_DIR = path.join(process.cwd(), 'logs', 'audit', 'enterprise-memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.jsonl');
const STATE_FILE = path.join(MEMORY_DIR, 'state.json');
let _entries = null;
let _state = null;
async function ensureDirs() {
    await mkdir(MEMORY_DIR, { recursive: true });
}
function defaultState() {
    return {
        marker: IVX_ENTERPRISE_MEMORY_MARKER,
        totalEntries: 0,
        byCategory: {
            architecture: 0,
            deployment: 0,
            recurring_issue: 0,
            coding_standard: 0,
            business_decision: 0,
            agent_learning: 0,
            system_config: 0,
            incident_postmortem: 0,
            research_finding: 0,
            opportunity_insight: 0,
        },
        lastUpdated: new Date().toISOString(),
    };
}
async function loadEntries() {
    if (_entries)
        return _entries;
    await ensureDirs();
    _entries = [];
    try {
        const raw = await readFile(MEMORY_FILE, 'utf-8');
        for (const line of raw.split('\n')) {
            if (line.trim()) {
                try {
                    _entries.push(JSON.parse(line));
                }
                catch { /* skip corrupt line */ }
            }
        }
    }
    catch { /* first run */ }
    return _entries;
}
async function loadState() {
    if (_state)
        return _state;
    await ensureDirs();
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.marker === IVX_ENTERPRISE_MEMORY_MARKER) {
            _state = parsed;
            return _state;
        }
    }
    catch { /* first run */ }
    _state = defaultState();
    await persistState();
    return _state;
}
async function persistState() {
    if (!_state)
        return;
    await ensureDirs();
    _state.totalEntries = (await loadEntries()).length;
    const byCategory = { ...defaultState().byCategory };
    for (const e of await loadEntries()) {
        byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    }
    _state.byCategory = byCategory;
    _state.lastUpdated = new Date().toISOString();
    const tmp = STATE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(_state, null, 2), 'utf-8');
    await rename(tmp, STATE_FILE);
}
// ── Core Memory Operations ─────────────────────────────────────────────────
/**
 * Write a memory entry.
 */
export async function writeMemory(category, title, content, source, options) {
    const now = new Date().toISOString();
    const entry = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category,
        title,
        content,
        source,
        sourceAgent: options?.sourceAgent ?? null,
        importance: options?.importance ?? 'medium',
        tags: options?.tags ?? [],
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: null,
        deprecated: false,
        supersededBy: null,
    };
    await ensureDirs();
    await appendFile(MEMORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    // Invalidate cache
    _entries = null;
    await persistState();
    return entry;
}
/**
 * Search memory by keyword or category.
 */
export async function searchMemory(query, options) {
    const entries = await loadEntries();
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 0);
    const results = [];
    for (const entry of entries) {
        if (options?.category && entry.category !== options.category)
            continue;
        if (!options?.includeDeprecated && entry.deprecated)
            continue;
        // Score by keyword match in title, content, tags
        let score = 0;
        const searchText = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
        for (const word of queryWords) {
            if (searchText.includes(word))
                score += 10;
        }
        if (entry.title.toLowerCase().includes(lowerQuery))
            score += 25;
        if (entry.tags.some((t) => t.toLowerCase().includes(lowerQuery)))
            score += 15;
        if (score > 0) {
            results.push({ entry, relevanceScore: score });
        }
    }
    return results
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, options?.limit ?? 20);
}
/**
 * Get entries by category.
 */
export async function getMemoryByCategory(category, limit = 50) {
    const entries = await loadEntries();
    return entries
        .filter((e) => e.category === category && !e.deprecated)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
}
/**
 * Get a specific memory entry.
 */
export async function getMemoryEntry(id) {
    const entries = await loadEntries();
    const entry = entries.find((e) => e.id === id);
    if (entry) {
        entry.accessCount++;
        entry.lastAccessedAt = new Date().toISOString();
        // Update the persisted entry (append updated version)
        await ensureDirs();
        await appendFile(MEMORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
        _entries = null;
    }
    return entry ?? null;
}
/**
 * Deprecate a memory entry (superseded by newer knowledge).
 */
export async function deprecateMemory(id, supersededBy) {
    const entry = await getMemoryEntry(id);
    if (!entry)
        return null;
    entry.deprecated = true;
    entry.supersededBy = supersededBy;
    entry.updatedAt = new Date().toISOString();
    await ensureDirs();
    await appendFile(MEMORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    _entries = null;
    await persistState();
    return entry;
}
/**
 * Record a recurring issue with its proven fix.
 */
export async function recordRecurringIssue(title, description, fix, sourceAgent) {
    return writeMemory('recurring_issue', title, `Issue: ${description}\n\nProven Fix: ${fix}`, 'self-improvement-system', { sourceAgent, importance: 'high', tags: ['recurring', 'fix'] });
}
/**
 * Record an architecture decision.
 */
export async function recordArchitectureDecision(title, decision, rationale, sourceAgent) {
    return writeMemory('architecture', title, `Decision: ${decision}\n\nRationale: ${rationale}`, 'engineering-team', { sourceAgent, importance: 'critical', tags: ['architecture', 'decision'] });
}
/**
 * Get the memory state summary.
 */
export async function getMemoryState() {
    return loadState();
}
/**
 * Get recent memories across all categories.
 */
export async function getRecentMemories(limit = 20) {
    const entries = await loadEntries();
    return entries
        .filter((e) => !e.deprecated)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
}
// ── Category Labels ────────────────────────────────────────────────────────
export const MEMORY_CATEGORY_LABELS = {
    architecture: 'Architecture',
    deployment: 'Deployment History',
    recurring_issue: 'Recurring Issues',
    coding_standard: 'Coding Standards',
    business_decision: 'Business Decisions',
    agent_learning: 'Agent Learnings',
    system_config: 'System Configuration',
    incident_postmortem: 'Incident Postmortems',
    research_finding: 'Research Findings',
    opportunity_insight: 'Opportunity Insights',
};
// ── Validation ─────────────────────────────────────────────────────────────
export async function validateEnterpriseMemory() {
    const entries = await loadEntries();
    const state = await loadState();
    const issues = [];
    if (state.marker !== IVX_ENTERPRISE_MEMORY_MARKER)
        issues.push('State marker mismatch');
    if (state.totalEntries !== entries.length)
        issues.push('State count mismatch with entries');
    return { valid: issues.length === 0, issues };
}
