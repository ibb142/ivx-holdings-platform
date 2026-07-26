/**
 * IVX Technology Discovery API (owner-only, read/derive only).
 *
 *   GET  /api/ivx/technology-discovery        → marker + supported sources
 *   POST /api/ivx/technology-discovery/scan   { includeExternal? } → ranked candidates
 *
 * Owner-only. Never writes files, never deploys. External sources only run when
 * `includeExternal: true`; missing credentials are reported as BLOCKED with the
 * exact env var(s) required — never faked.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { IVX_TECHNOLOGY_DISCOVERY_MARKER, runTechnologyDiscoveryScan, } from '../services/ivx-technology-discovery';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
/** GET — discovery status + the source catalog it can scan. */
export async function handleTechnologyDiscoveryStatusRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    return ownerOnlyJson({
        ok: true,
        marker: IVX_TECHNOLOGY_DISCOVERY_MARKER,
        sources: [
            { source: 'internal-innovation', external: false, requiredEnv: [] },
            { source: 'github', external: true, requiredEnv: ['GITHUB_TOKEN'] },
            { source: 'arxiv', external: true, requiredEnv: [] },
            { source: 'openai-updates', external: true, requiredEnv: ['OPENAI_RESEARCH_FEED_URL'] },
            { source: 'anthropic-updates', external: true, requiredEnv: ['ANTHROPIC_RESEARCH_FEED_URL'] },
            { source: 'google-ai-updates', external: true, requiredEnv: ['GOOGLE_AI_RESEARCH_FEED_URL'] },
        ],
        rankingDimensions: ['usefulnessToIvx', 'implementationDifficulty', 'securityRisk', 'businessValue', 'cost'],
    });
}
/** POST /scan — run a ranked technology-discovery scan. */
export async function handleTechnologyDiscoveryScanRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    let body = {};
    try {
        const text = await request.text();
        if (text.trim().length > 0) {
            body = JSON.parse(text);
        }
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    try {
        const result = await runTechnologyDiscoveryScan({ includeExternal: body.includeExternal === true });
        return ownerOnlyJson({ ok: true, result: result });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Technology discovery scan failed.' }, 500);
    }
}
