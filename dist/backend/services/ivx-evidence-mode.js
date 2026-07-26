/**
 * IVX Structured Evidence Mode
 *
 * Single endpoint that bundles proof, test reports, OTEL status,
 * repo-search status, and a recent-incidents slice into one
 * machine-readable evidence document. Powers the Live Work Visibility
 * panel.
 */
import { listIncidents } from './ivx-incident-store';
import { listRecentProofReports } from './ivx-proof-pipeline';
import { runStructuredTestReport } from './ivx-test-reporter';
import { getOTelStatus } from './ivx-otel';
import { searchAcrossIVXRepos } from './ivx-repo-search';
import { getE2EPlan } from './ivx-e2e-pipeline';
export const IVX_EVIDENCE_MODE_MARKER = 'ivx-evidence-mode-2026-05-28';
export async function buildEvidenceMode(opts = {}) {
    const includeTypecheck = opts.includeTypecheck === true;
    const repoSearchQuery = opts.repoSearchQuery ?? 'IVX_SENIOR_DEV_TOOLS_MARKER';
    const [proofs, otel, repoSearchProbe, e2ePlan] = await Promise.all([
        listRecentProofReports(10),
        Promise.resolve(getOTelStatus()),
        searchAcrossIVXRepos(repoSearchQuery, { perPage: 3 }),
        Promise.resolve(getE2EPlan()),
    ]);
    const typecheck = includeTypecheck ? await runStructuredTestReport('typecheck') : null;
    let recentIncidents = [];
    try {
        const rows = await Promise.resolve(listIncidents(20));
        recentIncidents = rows.map((r) => ({
            id: r.id,
            severity: r.severity,
            status: r.status,
            createdAt: r.createdAt,
            checkpoint: r.checkpoint ?? '',
        }));
    }
    catch {
        recentIncidents = [];
    }
    return {
        ok: true,
        marker: IVX_EVIDENCE_MODE_MARKER,
        generatedAt: new Date().toISOString(),
        proofs,
        tests: { typecheck },
        otel,
        repoSearchProbe,
        e2ePlan,
        recentIncidents,
    };
}
