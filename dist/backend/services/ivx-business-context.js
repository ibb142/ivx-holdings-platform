/**
 * IVX Business Context Engine
 *
 * BLOCK 2 — every Owner / public chat conversation must load IVX business
 * context automatically, so questions like "What is Casa Rosario?" are answered
 * from real business data without the caller having to trigger a manual lookup.
 *
 * It assembles five context buckets into a single model-readable block:
 *   1. Projects        — published rows from the authoritative `jv_deals` source.
 *   2. Deal data       — per-deal economics (price / ROI / timeline / min ownership).
 *   3. Company context — who IVX is and what the platform does.
 *   4. Landing context — the public site the projects are rendered on.
 *   5. Owner context   — the owner identity the assistant reports to.
 *
 * The projects/deal buckets are LIVE (read-only over Supabase REST). The
 * company / landing / owner buckets are static config + env. The block is built
 * defensively so a failed project read never blocks the conversation — it just
 * states the honest reason instead of fabricating data.
 */
import { readLandingProjects } from './ivx-project-data';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** Static company identity used to ground every conversation. */
export function getCompanyContext() {
    return {
        name: 'IVX Holding',
        description: 'IVX is a real-estate joint-venture platform that makes property investing easier to understand and participate in. Investors review a deal (location, price, expected ROI, timeline, ownership minimum), then participate after reading the actual documents.',
        model: 'Real-estate joint ventures (JV deals) with fractional ownership and defined return assumptions.',
    };
}
/** Public landing context (the site the projects are rendered on). */
export function getLandingContext() {
    const url = readTrimmed(process.env.IVX_LANDING_URL) || 'https://ivxholding.com';
    return {
        url,
        description: `The public landing page (${url}) renders the published projects client-side from the authoritative jv_deals source.`,
    };
}
/** Owner identity the assistant reports to. */
export function getOwnerContext() {
    const email = readTrimmed(process.env.EXPO_PUBLIC_OWNER_EMAIL) ||
        readTrimmed(process.env.OWNER_REPAIR_EMAIL) ||
        null;
    return {
        email,
        role: 'IVX owner / operator',
    };
}
/**
 * Load the full business context. Live projects/deal data are fetched read-only;
 * company / landing / owner are resolved from config + env. Never throws — a
 * failed project read is captured in `projects.ok=false` with an honest reason.
 */
export async function loadBusinessContext() {
    let projects;
    try {
        projects = await readLandingProjects();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        projects = {
            ok: false,
            configured: false,
            source: 'supabase:jv_deals',
            fetchedAt: new Date().toISOString(),
            httpStatus: null,
            totalRows: 0,
            publishedCount: 0,
            projects: [],
            projectNames: [],
            error: `Business context project read failed: ${message}`,
            missingEnv: [],
        };
    }
    return {
        loadedAt: new Date().toISOString(),
        projects,
        company: getCompanyContext(),
        landing: getLandingContext(),
        owner: getOwnerContext(),
    };
}
function buildProjectsSection(projects) {
    if (!projects.ok) {
        if (projects.missingEnv.length > 0) {
            return [
                'PROJECTS / DEALS (authoritative source jv_deals): NOT CONFIGURED.',
                `Missing backend env: ${projects.missingEnv.join(', ')}.`,
                'State exactly which configuration is missing. Do NOT invent project names.',
            ];
        }
        return [
            'PROJECTS / DEALS (authoritative source jv_deals): FETCH FAILED.',
            `Reason: ${projects.error ?? 'unknown error'}.`,
            'Say the live project source could not be reached right now. Do NOT invent project names.',
        ];
    }
    if (projects.projects.length === 0) {
        return [
            `PROJECTS / DEALS (authoritative source ${projects.source}): reachable, 0 published projects (${projects.totalRows} total rows).`,
            'Answer truthfully that there are no published projects right now. You CAN access the source — it is simply empty. Do NOT fabricate a list.',
        ];
    }
    const lines = projects.projects.map((project, index) => {
        const details = [
            project.location ? `location: ${project.location}` : null,
            project.price ? `price: ${project.price}` : null,
            project.roi ? `ROI: ${project.roi}` : null,
            project.timeline ? `timeline: ${project.timeline}` : null,
            project.ownershipMinimum ? `min ownership: ${project.ownershipMinimum}` : null,
            project.status ? `status: ${project.status}` : null,
            `media: ${project.mediaCount}`,
        ]
            .filter(Boolean)
            .join(', ');
        return `${index + 1}. ${project.name} (${details})`;
    });
    return [
        `PROJECTS / DEALS (authoritative source ${projects.source}): ${projects.projects.length} published project(s).`,
        ...lines,
        'Answer any project/deal question (including "What is Casa Rosario?") from this list. These are the real, current projects. Do NOT say you cannot access project names.',
    ];
}
/**
 * Render the loaded business context into a single grounding block that is
 * injected at the top of every conversation. Always includes company, landing,
 * and owner identity so the assistant never behaves like a disconnected chatbot.
 */
export function buildBusinessContextBlock(context) {
    const sections = [
        'IVX BUSINESS CONTEXT (loaded automatically for this conversation, read-only):',
        '',
        `COMPANY: ${context.company.name} — ${context.company.description}`,
        `BUSINESS MODEL: ${context.company.model}`,
        '',
        `LANDING PAGE: ${context.landing.description}`,
        '',
        `OWNER: ${context.owner.role}${context.owner.email ? ` (${context.owner.email})` : ''}.`,
        '',
        ...buildProjectsSection(context.projects),
        '',
        'Use this business context to answer directly and specifically. Never reply with a generic "I cannot access" when the data above is present.',
    ];
    return sections.join('\n');
}
