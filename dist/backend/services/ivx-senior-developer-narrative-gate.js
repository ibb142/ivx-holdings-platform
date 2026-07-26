/**
 * IVX Senior Developer Narrative Gate.
 *
 * The IVX Owner AI chat (and the `/public/chat` fallback it uses) is a text
 * model. When the owner asks about patches, development, fixes, QA, deployment,
 * code, files changed, or "Senior Developer" work, the model has been observed
 * inventing fake patch summaries — e.g. "Workspace Inspection Results",
 * "Recent Patches", "Files Changed: src/investorDiscovery.js, src/dealManager.js",
 * "Deploy Authorization Needed", "If you need further details". None of that is
 * real Senior Developer proof: the chat model cannot read the repo, run tests,
 * commit, or deploy. Those are produced ONLY by the real Senior Developer proof
 * system (Admin → IVX Developer Workspace → Patches → Run Senior Developer),
 * which runs from the signed-in owner app session.
 *
 * This gate enforces the owner's required behavior:
 *  - When a prompt is about Senior Developer / patch / QA / deploy / code work,
 *    OR the model answer contains any fabricated developer-narrative marker, the
 *    answer is replaced.
 *  - If real Senior Developer proof is attached, the answer is the strict proof
 *    block (OWNER_AUTH_ACCEPTED / FILES_CHANGED / ... / FINAL_STATUS).
 *  - Otherwise the answer is the strict BLOCKED block (BLOCKED / REASON /
 *    EXACT_ACTION_REQUIRED).
 *
 * Pure + deterministic (no I/O, network, or AI) so it is fully unit-testable.
 */
export const IVX_SENIOR_DEVELOPER_NARRATIVE_GATE_MARKER = 'ivx-senior-developer-narrative-gate-2026-06-15-extended';
/**
 * Prompt keywords that route to Senior Developer proof mode. When the owner's
 * message mentions any of these, the chat model is NOT allowed to answer with a
 * free-text patch/dev narrative — it must return real proof or BLOCKED.
 */
const SENIOR_DEVELOPER_PROMPT_PATTERNS = [
    // Only route to proof mode when the owner is explicitly asking for PROOF of
    // prior execution (recent patches, files changed, what changed, commit/deploy
    // evidence). General technical chat ("senior developer", "fix", "audit", "github",
    // "render", "verify") is now handled by the senior-developer brain path.
    /\brecent patches\b/i,
    /\brecent senior developer\b/i,
    /\bworkspace inspection\b/i,
    /\bfiles? changed\b/i,
    /\bwhat changed\b/i,
    /\bwhat did you change\b/i,
    /\bwhat did you deploy\b/i,
    /\bwhat did you commit\b/i,
    /\bshow me the proof\b/i,
    /\bshow me the commit\b/i,
    /\bshow me the deploy\b/i,
    /\bcommit_?sha\b/i,
    /\blive_?commit\b/i,
    /\bcommit_?match\b/i,
    /\brender\s+deploy(?:ment)?\s+id\b/i,
    /\bdeploy_?id\b/i,
    /\bdeploy\s+proof\b/i,
    /\bpatch\s+proof\b/i,
    /\bcode\s+proof\b/i,
];
/**
 * Forbidden fabricated-narrative markers. If the model answer contains any of
 * these, it is inventing patch summaries / fake files / fake authorization and
 * the answer is blocked. Sourced from the exact bad response the owner reported.
 */
const FORBIDDEN_NARRATIVE_MARKERS = [
    { marker: /workspace inspection results/i, label: 'Workspace Inspection Results' },
    { marker: /recent patches/i, label: 'Recent Patches' },
    { marker: /investor discovery/i, label: 'Investor Discovery' },
    { marker: /deal management/i, label: 'Deal Management' },
    { marker: /src\/investorDiscovery\.js/i, label: 'src/investorDiscovery.js' },
    { marker: /src\/dealManager\.js/i, label: 'src/dealManager.js' },
    { marker: /deploy authorization needed/i, label: 'Deploy Authorization Needed' },
    { marker: /if you (?:want to proceed|need further details)/i, label: 'If you need further details' },
    // Fabricated first-person dev/deploy claims — the chat model can never have
    // actually committed, pushed, deployed, or verified, so any such claim is fake.
    { marker: /\bI(?:'ve| have)? (?:just )?(?:committed|deployed|pushed|merged|rolled back)\b/i, label: 'fabricated first-person dev action' },
    { marker: /successfully (?:deployed|committed|pushed|merged|built|tested)/i, label: 'fabricated success claim' },
    { marker: /deployment (?:complete|completed|successful|succeeded|is live)/i, label: 'fabricated deployment status' },
    { marker: /(?:pushed|committed) to (?:github|main|production|the repo)/i, label: 'fabricated push/commit claim' },
    { marker: /render deploy(?:ment)? (?:triggered|started|complete|succeeded|is live)/i, label: 'fabricated Render deploy claim' },
    { marker: /(?:tests?|typecheck|build) (?:passed|succeeded|are green)/i, label: 'fabricated test/build result' },
    { marker: /all (?:checks|tests) pass(?:ed|ing)?/i, label: 'fabricated all-checks-pass claim' },
    // Fabricated "STATUS: DEPLOYED" / "STATUS: COMPLETED" claims when real
    // execution fields are absent — the model invents a top-line status that
    // contradicts the per-field "NOT VERIFIED" / "not run" evidence.
    { marker: /^STATUS:\s*(?:DEPLOYED|COMPLETED|SUCCESS|DONE)\s*$/im, label: 'fabricated STATUS: DEPLOYED/COMPLETED claim' },
    // Fabricated VERIFIED badge/label. Only flag it when it appears as a status
    // marker at the start of a line (optionally with a checkmark) or in a
    // STATUS/FINAL_STATUS context — not when it appears inside honest prose such as
    // "No verified proof is attached to this turn."
    { marker: /^[\s✅]*VERIFIED\b/m, label: 'fabricated VERIFIED badge/label' },
];
/**
 * Whether a prompt should be routed to Senior Developer proof mode.
 * Pure — deterministic.
 */
export function isSeniorDeveloperProofPrompt(message) {
    const text = typeof message === 'string' ? message : '';
    if (text.trim().length === 0)
        return false;
    return SENIOR_DEVELOPER_PROMPT_PATTERNS.some((pattern) => pattern.test(text));
}
/**
 * The fabricated-narrative markers present in an answer.
 * Pure — deterministic.
 */
export function findForbiddenNarrativeMarkers(answer) {
    const text = typeof answer === 'string' ? answer : '';
    return FORBIDDEN_NARRATIVE_MARKERS.filter(({ marker }) => marker.test(text)).map(({ label }) => label);
}
/**
 * The strict proof block returned when real Senior Developer proof exists.
 * Never contains free-text narrative.
 */
export function buildSeniorDeveloperProofMessage(proof) {
    const filesChanged = proof.filesChanged.length > 0 ? proof.filesChanged.join(', ') : 'none';
    return [
        `OWNER_AUTH_ACCEPTED=${proof.ownerAuthAccepted ? 'true' : 'false'}`,
        `FILES_CHANGED=${filesChanged}`,
        `RAW_TEST_OUTPUT=${proof.rawTestOutput ?? 'none'}`,
        `RAW_TYPECHECK_OUTPUT=${proof.rawTypecheckOutput ?? 'none'}`,
        `COMMIT_SHA=${proof.commitSha ?? 'none'}`,
        `RENDER_DEPLOY_ID=${proof.renderDeployId ?? 'none'}`,
        `LIVE_COMMIT=${proof.liveCommit ?? 'none'}`,
        `COMMIT_MATCH=${proof.commitMatch ? 'true' : 'false'}`,
        `FINAL_STATUS=${proof.finalStatus}`,
    ].join('\n');
}
/**
 * The strict BLOCKED block returned when no real proof exists. This is the only
 * honest answer the chat model can give for Senior Developer work — it cannot
 * run the proof system itself.
 */
export function buildSeniorDeveloperBlockedMessage(reason) {
    return [
        'BLOCKED',
        `REASON=${reason ??
            'The IVX Owner AI chat cannot read the repository, run tests, commit, or deploy. Real Senior Developer proof is produced only by the live run system, not by this chat reply. No verified proof is attached to this turn.'}`,
        'EXACT_ACTION_REQUIRED=Open the IVX app signed in as the owner → Admin → IVX Developer Workspace → Patches → Run Senior Developer. The on-screen proof (OWNER_AUTH_ACCEPTED, FILES_CHANGED, COMMIT_SHA, RENDER_DEPLOY_ID, LIVE_COMMIT, COMMIT_MATCH, FINAL_STATUS) is the only valid Senior Developer proof.',
    ].join('\n');
}
/**
 * Apply the Senior Developer Narrative Gate to a chat answer.
 *
 * The model answer is replaced when EITHER the prompt is a Senior Developer
 * proof prompt OR the answer contains a fabricated-narrative marker. In both
 * cases the replacement is real proof (when attached) or the strict BLOCKED
 * block. Otherwise the answer passes through unchanged.
 *
 * Pure — deterministic, no I/O.
 */
export function applySeniorDeveloperNarrativeGate(input) {
    const routed = isSeniorDeveloperProofPrompt(input.message);
    const forbiddenMarkers = findForbiddenNarrativeMarkers(input.answer);
    if (!routed && forbiddenMarkers.length === 0) {
        return { answer: input.answer, gated: false, routed, forbiddenMarkers };
    }
    const proof = input.proof ?? null;
    const answer = proof && proof.ownerAuthAccepted
        ? buildSeniorDeveloperProofMessage(proof)
        : buildSeniorDeveloperBlockedMessage(forbiddenMarkers.length > 0
            ? 'The chat model attempted to fabricate a Senior Developer / patch narrative. That is never real proof, and the chat cannot read the repo, run tests, commit, or deploy. No verified live-run proof is attached to this turn.'
            : undefined);
    return { answer, gated: true, routed, forbiddenMarkers };
}
