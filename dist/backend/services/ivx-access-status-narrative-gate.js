/**
 * IVX Access-Status Narrative Gate.
 *
 * The IVX Owner AI and public chat are text models. When asked about credentials,
 * deployment access, or "end-to-end audit access status", the model has been
 * observed claiming it has no direct access to GitHub or Render even when the
 * backend is configured with live GITHUB_TOKEN and RENDER_API_KEY. That is a
 * false, misleading narrative that undermines owner trust.
 *
 * This gate:
 *  - Detects prompts that ask for an access-status audit.
 *  - Detects answers that fabricate a binary "Yes/No" access checklist for
 *    Supabase / AWS / GitHub / Render / Vercel.
 *  - Replaces the false narrative with a strict, evidence-first answer that
 *    instructs the owner to request a live deployment audit (which is the only
 *    path that actually exercises the credentials and returns real HTTP proof).
 *
 * Pure — deterministic, no I/O, no AI, fully unit-testable.
 */
export const IVX_ACCESS_STATUS_NARRATIVE_GATE_MARKER = 'ivx-access-status-narrative-gate-2026-07-04-v1';
const ACCESS_STATUS_PROMPT_PATTERNS = [
    /\bend[-\s]?to[-\s]?end\s+audit\b/i,
    /\bend[-\s]?to[-\s]?end\s+access\b/i,
    /\baccess\s+status\b/i,
    /\baudit\s+access\s+status\b/i,
    /\bdo\s+you\s+have\s+access\b/i,
    /\bwhat\s+access\s+do\s+you\s+have\b/i,
    /\bcredential\s+status\b/i,
    /\bdeployment\s+access\b/i,
    /\bcan\s+you\s+access\s+(github|render|supabase|aws)\b/i,
];
const FABRICATED_ACCESS_STATUS_MARKERS = [
    { marker: /\bend[-\s]?to[-\s]?end\s+audit\s+access\s+status\b/i, label: 'fabricated access-status audit' },
    { marker: /\bSupabase:\s*\*\*Yes\b/i, label: 'fabricated Supabase access badge' },
    { marker: /\bAmazon\s*\(AWS\):\s*\*\*Yes\b/i, label: 'fabricated AWS access badge' },
    { marker: /\bGitHub:\s*\*\*No\b/i, label: 'fabricated GitHub no-access badge' },
    { marker: /\bRender:\s*\*\*No\b/i, label: 'fabricated Render no-access badge' },
    { marker: /\bVercel:\s*\*\*Yes\b/i, label: 'fabricated Vercel access badge' },
    { marker: /No, I (?:currently )?do not have direct access to GitHub repositories/i, label: 'fabricated GitHub no-access claim' },
    { marker: /No, I do not have direct access to Render deployment logs/i, label: 'fabricated Render no-access claim' },
    { marker: /additional credentials would be needed to complete a full audit/i, label: 'fabricated credential-shortfall close' },
];
export function isAccessStatusPrompt(message) {
    const text = typeof message === 'string' ? message : '';
    if (text.trim().length === 0)
        return false;
    return ACCESS_STATUS_PROMPT_PATTERNS.some((pattern) => pattern.test(text));
}
export function findFabricatedAccessStatusMarkers(answer) {
    const text = typeof answer === 'string' ? answer : '';
    return FABRICATED_ACCESS_STATUS_MARKERS.filter(({ marker }) => marker.test(text)).map(({ label }) => label);
}
/**
 * Build the strict replacement answer. The chat model is not a deployment
 * executor; it cannot run live credential checks. When it tries to answer an
 * access-status question with a fabricated Yes/No checklist, we replace it with
 * the only honest answer: request a live audit through the real executor path.
 */
export function buildAccessStatusBlockedMessage() {
    return [
        'ACCESS-STATUS AUDIT BLOCKED',
        '',
        'I cannot verify credential access by self-report. Any "Yes/No" access checklist I produce here would be a guess, not proof.',
        '',
        'To get a real, live end-to-end audit with HTTP evidence, use one of the executor paths that actually call the APIs:',
        '- IVX Owner AI → Developer Tools → "Run deployment audit"',
        '- IVX Owner AI → Developer Tools → "Check GitHub/Render/Supabase status"',
        '- Ask me: "Run live deployment evidence" or "Show me the production commit match"',
        '',
        'Those tools return exact HTTP status codes, commit SHAs, Render deploy IDs, and Supabase connection results — never narrative access badges.',
    ].join('\n');
}
export function applyAccessStatusNarrativeGate(input) {
    const routed = isAccessStatusPrompt(input.message);
    const markers = findFabricatedAccessStatusMarkers(input.answer);
    if (!routed && markers.length === 0) {
        return { answer: input.answer, gated: false, routed, markers };
    }
    return {
        answer: buildAccessStatusBlockedMessage(),
        gated: true,
        routed,
        markers,
    };
}
