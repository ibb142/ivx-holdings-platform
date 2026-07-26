/**
 * IVX Capital Deployment Platform — Deal Pipeline seeder from REAL jv_deals.
 *
 * BLOCK 67 (Phase 2). The genuinely-missing bridge: the Deal Tracking and
 * Capital Pipeline modules were built (BLOCK 22 / 26) but starved of data, while
 * the authoritative `jv_deals` table already holds REAL, owner-published projects
 * (Casa Rosario, PEREZ RESIDENCE, ONE STOP CONSTRUCTORS INC — verified live in
 * BLOCK 3/17/18). This seeder turns those real projects into Deal Tracking +
 * Capital Pipeline entries so "current JV opportunities / active acquisitions"
 * appear in the pipeline from real data.
 *
 * HARD HONESTY RULE (platform-wide, enforced here):
 *   - NOTHING is fabricated. Every seeded record originates from a real published
 *     `jv_deals` row and is attributed `source: 'verified_deal'` with
 *     `sourceDetail: 'jv_deals:<id>'`.
 *   - IDEMPOTENT: a deal already present (matched by case-insensitive name) is
 *     SKIPPED, never duplicated — so the seeder is safe to re-run.
 *   - Unknown economics stay null (capital target only set when the real project
 *     carries a parseable price). Never guessed.
 *
 * Deterministic core (`selectProjectsToSeed`, `projectToDealInput`,
 * `projectToPipelineInput`) is pure + unit-testable; the orchestrator does the
 * real I/O against the authoritative reader + the two durable stores.
 */
import { readLandingProjects, } from './ivx-project-data';
import { createDeal, listDeals, } from './ivx-deal-tracking-store';
import { createPipelineEntry, listPipelineEntries, normalizeAmount, } from './ivx-capital-pipeline-store';
export const IVX_DEAL_PIPELINE_SEED_MARKER = 'ivx-deal-pipeline-seed-2026-06-03';
/** Normalize a name for idempotent matching (case-insensitive, trimmed). */
export function normalizeDealKey(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Build the attribution detail for a seeded record. */
function sourceDetailFor(project) {
    return `jv_deals:${project.id}`;
}
/** Compose a human-readable note from the real project fields (no fabrication). */
function noteFor(project) {
    const parts = [];
    if (project.location)
        parts.push(project.location);
    if (project.price)
        parts.push(`value ${project.price}`);
    if (project.roi)
        parts.push(`ROI ${project.roi}`);
    if (project.timeline)
        parts.push(`timeline ${project.timeline}`);
    if (project.ownershipMinimum)
        parts.push(`min ${project.ownershipMinimum}`);
    return parts.length > 0 ? `Seeded from jv_deals — ${parts.join(' · ')}` : 'Seeded from jv_deals.';
}
/** Map a real published project to a Deal Tracking create-input. */
export function projectToDealInput(project) {
    return {
        dealName: project.name,
        source: 'verified_deal',
        sourceDetail: sourceDetailFor(project),
        status: 'open',
        capitalTarget: project.price ? normalizeAmount(project.price) : null,
        notes: noteFor(project),
    };
}
/** Map a real published project to a Capital Pipeline create-input (capital raise). */
export function projectToPipelineInput(project) {
    return {
        name: `${project.name} — capital raise`,
        source: 'verified_deal',
        sourceDetail: sourceDetailFor(project),
        partyType: 'investor',
        dealName: project.name,
        stage: 'lead',
        capitalRequested: project.price ? normalizeAmount(project.price) : null,
        capitalCommitted: null,
        closeProbability: 0,
        notes: noteFor(project),
    };
}
/**
 * Pure idempotency planner: given the real published projects and the current
 * store contents, decide which Deal Tracking / Capital Pipeline records still
 * need to be created (matched by case-insensitive deal name).
 */
export function selectProjectsToSeed(projects, existingDeals, existingPipeline) {
    const existingDealNames = new Set(existingDeals.map((d) => normalizeDealKey(d.dealName)));
    const existingPipelineDealNames = new Set(existingPipeline.map((p) => normalizeDealKey(p.dealName || p.name)));
    const dealsToCreate = [];
    const pipelineToCreate = [];
    const dealsSkipped = [];
    const pipelineSkipped = [];
    for (const project of projects) {
        const key = normalizeDealKey(project.name);
        if (existingDealNames.has(key))
            dealsSkipped.push(project.name);
        else
            dealsToCreate.push(project);
        if (existingPipelineDealNames.has(key))
            pipelineSkipped.push(project.name);
        else
            pipelineToCreate.push(project);
    }
    return { dealsToCreate, pipelineToCreate, dealsSkipped, pipelineSkipped };
}
/**
 * Seed the Deal Tracking + Capital Pipeline stores from the REAL published
 * `jv_deals` projects. Idempotent and never fabricates — only real published
 * deals are seeded, attributed `verified_deal`. Honest failure (with the exact
 * missing env) when the authoritative source is unconfigured/unreachable.
 */
export async function seedDealPipelineFromJvDeals() {
    const base = {
        marker: IVX_DEAL_PIPELINE_SEED_MARKER,
        ok: false,
        error: null,
        missingEnv: [],
        publishedProjects: 0,
        dealsCreated: 0,
        dealsSkipped: 0,
        pipelineCreated: 0,
        pipelineSkipped: 0,
        createdDeals: [],
        createdPipeline: [],
    };
    const source = await readLandingProjects();
    if (!source.ok) {
        return {
            ...base,
            error: source.error ?? 'Could not read the authoritative jv_deals source.',
            missingEnv: source.missingEnv,
        };
    }
    const projects = source.projects;
    const [existingDeals, existingPipeline] = await Promise.all([
        listDeals(),
        listPipelineEntries(),
    ]);
    const selection = selectProjectsToSeed(projects, existingDeals, existingPipeline);
    const createdDeals = [];
    for (const project of selection.dealsToCreate) {
        const result = await createDeal(projectToDealInput(project));
        if (result.ok)
            createdDeals.push(result.deal);
    }
    const createdPipeline = [];
    for (const project of selection.pipelineToCreate) {
        const result = await createPipelineEntry(projectToPipelineInput(project));
        if (result.ok)
            createdPipeline.push(result.entry);
    }
    return {
        ...base,
        ok: true,
        publishedProjects: projects.length,
        dealsCreated: createdDeals.length,
        dealsSkipped: selection.dealsSkipped.length,
        pipelineCreated: createdPipeline.length,
        pipelineSkipped: selection.pipelineSkipped.length,
        createdDeals,
        createdPipeline,
    };
}
