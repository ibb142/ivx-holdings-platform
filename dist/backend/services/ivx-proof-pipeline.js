/**
 * IVX Proof-Generation Pipeline
 *
 * Assembles structured, file:line-grounded proof for IVX Senior Developer
 * AI work items. Reuses senior-dev tools (code_read, code_search) plus
 * git/runtime metadata. Never invents evidence — every claim must cite a
 * file, line, or runtime artifact.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { executeSeniorDevTool } from './ivx-senior-dev-tools';
export const IVX_PROOF_PIPELINE_MARKER = 'ivx-proof-pipeline-2026-05-28';
/**
 * Build a structured proof report. Each claim is verified by reading the
 * cited file slice through `executeSeniorDevTool('code_read', ...)`.
 */
export async function buildProofReport(req) {
    const status = req.status ?? 'progress';
    const resolved = [];
    for (const claim of req.claims) {
        try {
            const out = await executeSeniorDevTool('code_read', {
                path: claim.file,
                startLine: claim.startLine,
                endLine: claim.endLine,
            });
            const record = out;
            if (record.ok && Array.isArray(record.lines) && record.lines.length > 0) {
                const snippet = record.lines.map((l) => `${l.n}: ${l.text}`).join('\n').slice(0, 800);
                resolved.push({ ...claim, snippet, resolved: true });
            }
            else {
                resolved.push({ ...claim, resolved: false, reason: record.error ?? 'no lines returned' });
            }
        }
        catch (error) {
            resolved.push({
                ...claim,
                resolved: false,
                reason: error instanceof Error ? error.message : 'proof read failed',
            });
        }
    }
    const ok = resolved.every((c) => c.resolved);
    // Persist proof to disk so the Live Work Visibility panel can read it.
    const proofDir = path.resolve(process.cwd(), 'logs', 'audit', 'proof-reports');
    try {
        await fs.mkdir(proofDir, { recursive: true });
        const file = path.join(proofDir, `${Date.now()}-${slug(req.workItem)}.json`);
        await fs.writeFile(file, JSON.stringify({ workItem: req.workItem, status, resolved }, null, 2), 'utf8');
    }
    catch {
        // Persistence failure must not break the response.
    }
    return {
        ok,
        marker: IVX_PROOF_PIPELINE_MARKER,
        workItem: req.workItem,
        status,
        generatedAt: new Date().toISOString(),
        claims: resolved,
        summary: {
            total: resolved.length,
            resolved: resolved.filter((c) => c.resolved).length,
            unresolved: resolved.filter((c) => !c.resolved).length,
        },
    };
}
/** List the most recent persisted proof reports (newest first, capped). */
export async function listRecentProofReports(limit = 25) {
    const proofDir = path.resolve(process.cwd(), 'logs', 'audit', 'proof-reports');
    try {
        const entries = await fs.readdir(proofDir);
        const sorted = entries.filter((e) => e.endsWith('.json')).sort().reverse().slice(0, limit);
        const rows = [];
        for (const name of sorted) {
            try {
                const text = await fs.readFile(path.join(proofDir, name), 'utf8');
                const parsed = JSON.parse(text);
                rows.push({
                    file: name,
                    workItem: typeof parsed.workItem === 'string' ? parsed.workItem : 'unknown',
                    resolvedAt: name.split('-')[0] ?? '',
                });
            }
            catch {
                continue;
            }
        }
        return rows;
    }
    catch {
        return [];
    }
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}
