/**
 * Detect when a public-chat message is asking about IVX projects / deals / the
 * landing page so the answer can be grounded on the authoritative `jv_deals`
 * source instead of letting the model guess or refuse.
 */
export function asksAboutProjects(message) {
    const normalized = message.toLowerCase();
    const signals = [
        'project',
        'projects',
        'deal',
        'deals',
        'casa rosario',
        'property',
        'properties',
        'listing',
        'landing page',
        'jv ',
        'joint venture',
        'portfolio',
    ];
    return signals.some((signal) => normalized.includes(signal));
}
/**
 * Build a grounding block from the live authoritative project source. Returns a
 * model-readable summary plus an instruction that forbids generic refusals when
 * the data was fetched successfully (even when the result is zero projects).
 */
export function buildProjectGrounding(projectData) {
    if (!projectData.ok) {
        if (projectData.missingEnv.length > 0) {
            return [
                'AUTHORITATIVE PROJECT SOURCE (Supabase jv_deals): NOT CONFIGURED.',
                `Missing backend env: ${projectData.missingEnv.join(', ')}.`,
                'Tell the user exactly which configuration is missing. Do NOT invent project names.',
            ].join('\n');
        }
        return [
            'AUTHORITATIVE PROJECT SOURCE (Supabase jv_deals): FETCH FAILED.',
            `Reason: ${projectData.error ?? 'unknown error'}.`,
            'State that the live project source could not be reached right now. Do NOT invent project names.',
        ].join('\n');
    }
    if (projectData.projects.length === 0) {
        return [
            `AUTHORITATIVE PROJECT SOURCE (Supabase ${projectData.source}): reachable, but it currently contains 0 published projects (${projectData.totalRows} total rows).`,
            'Answer truthfully that there are no published projects in the project database right now.',
            'Do NOT claim you cannot access projects — you can; the source is simply empty. Do NOT fabricate a project list.',
        ].join('\n');
    }
    const lines = projectData.projects.map((project, index) => {
        const details = [
            project.location ? `location: ${project.location}` : null,
            project.price ? `price: ${project.price}` : null,
            project.roi ? `ROI: ${project.roi}` : null,
            project.timeline ? `timeline: ${project.timeline}` : null,
            project.ownershipMinimum ? `min ownership: ${project.ownershipMinimum}` : null,
            project.status ? `status: ${project.status}` : null,
            `media: ${project.mediaCount}`,
        ].filter(Boolean).join(', ');
        return `${index + 1}. ${project.name} (${details})`;
    });
    return [
        `AUTHORITATIVE PROJECT SOURCE (Supabase ${projectData.source}): ${projectData.projects.length} published project(s).`,
        ...lines,
        'Answer project questions from this list. These are the real, current projects. Do NOT say you cannot access project names.',
    ].join('\n');
}
