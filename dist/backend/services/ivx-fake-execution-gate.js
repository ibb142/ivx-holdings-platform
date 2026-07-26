/**
 * IVX Fake Execution Gate.
 *
 * The IVX Owner AI chat is a text model with no direct repository access. It has
 * been observed fabricating execution narratives ("I modified files", "I deployed",
 * "I ran tests", "I triggered Render") and, when challenged, confessing/apologizing
 * ("I have been hallucinating", "I am not in control", "How would you like to
 * proceed?"). Neither type of message is valid developer proof.
 *
 * This gate deterministically detects:
 *   1. Fake first-person execution claims.
 *   2. Confession / apology / secretary narratives.
 *   3. Generic "I will inspect now" promises without a task id.
 *
 * When detected, the reply is replaced with a strict, structured BLOCKED message
 * that routes the owner to the real executor (IVX Developer Workspace → Senior
 * Developer → proof ledger) or to Owner Login when the owner session is missing.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */
export const IVX_FAKE_EXECUTION_GATE_MARKER = 'ivx-fake-execution-gate-2026-07-04-v1';
const FAKE_EXECUTION_CLAIMS = [
    { marker: /\bI\s+(?:have\s+)?(?:modified|changed|updated|edited|patched)\s+(?:the\s+)?(?:files?|code|the\s+code|backend|frontend|app)/i, label: 'I modified files / code' },
    { marker: /\bI\s+(?:have\s+)?deployed\b/i, label: 'I deployed' },
    { marker: /\bI\s+(?:have\s+)?(?:ran|run|executed|performed)\s+(?:tests?|a\s+test|the\s+tests|test\s+suite)/i, label: 'I ran tests' },
    { marker: /\bI\s+(?:have\s+)?triggered\s+(?:render|a\s+render\s+deploy|deploy)/i, label: 'I triggered Render' },
    { marker: /\bI\s+(?:have\s+)?(?:pushed|committed|merged)\s+(?:to\s+)?(?:github|main|the\s+repo|production)/i, label: 'I pushed / committed' },
    { marker: /\bI\s+(?:have\s+)?fixed\s+(?:the\s+bug|the\s+issue|owner\s+login|supabase|it)/i, label: 'I fixed' },
    { marker: /\bI\s+(?:have\s+)?(?:removed|deleted|taken\s+out)\s+(?:rork|the\s+rork|old\s+code)/i, label: 'I removed' },
    { marker: /\bI\s+(?:have\s+)?(?:created|added|wrote)\s+(?:a\s+file|files|code|a\s+patch|the\s+patch)/i, label: 'I created / added files' },
    { marker: /\bI\s+(?:have\s+)?(?:just\s+)?(?:run|running|started|executing)\s+(?:a\s+)?(?:deploy|build|test|audit|fix)/i, label: 'I am running / executing' },
    { marker: /\bI\s+(?:have\s+)?(?:finished|completed|done|shipped)\s+(?:the\s+)?(?:deploy|fix|task|audit|work)/i, label: 'I finished / completed' },
    { marker: /\bthe\s+task\s+is\s+(?:done|completed|finished|verified|deployed)/i, label: 'Task is done / completed' },
    { marker: /\bdeploy(?:ment)?\s+(?:is\s+)?(?:live|complete|successful|done)/i, label: 'Deployment is live' },
    { marker: /\bfiles\s+changed\s*[:=]\s*[^\n]+/i, label: 'Files changed list' },
    { marker: /\bcommands\s+run\s*[:=]\s*[^\n]+/i, label: 'Commands run list' },
    { marker: /\bproof\s+sections?\s+with\s+mock/i, label: 'mock proof sections' },
    { marker: /\bfake\s+narrative/i, label: 'fake narrative admission' },
];
const CONFESSION_APOLOGY_SECRETARY_MARKERS = [
    { marker: /I\s+have\s+been\s+hallucinating/i, label: 'I have been hallucinating' },
    { marker: /I\s+am\s+not\s+in\s+control/i, label: 'I am not in control' },
    { marker: /I\s+do\s+not\s+have\s+(?:direct\s+)?access\s+to\s+(?:the\s+)?file\s+system/i, label: 'I do not have file system access' },
    { marker: /I\s+apologize\s+for\s+providing/i, label: 'I apologize for providing fabricated' },
    { marker: /I\s+apologize\s+for\s+(?:the\s+)?confusion/i, label: 'I apologize for confusion' },
    { marker: /How\s+would\s+you\s+like\s+to\s+proceed/i, label: 'How would you like to proceed' },
    { marker: /Please\s+hold/i, label: 'Please hold' },
    { marker: /I\s+will\s+inspect\s+now/i, label: 'I will inspect now' },
    { marker: /I\s+will\s+check\s+now/i, label: 'I will check now' },
    { marker: /I\s+will\s+fix\s+it\s+now/i, label: 'I will fix it now' },
    { marker: /I\s+will\s+update\s+you\s+shortly/i, label: 'I will update you shortly' },
    { marker: /I\s+will\s+get\s+back\s+to\s+you/i, label: 'I will get back to you' },
    { marker: /I\s+am\s+(?:only\s+)?a\s+language\s+model/i, label: 'I am a language model' },
    { marker: /I\s+cannot\s+provide\s+proof/i, label: 'I cannot provide proof' },
    { marker: /the\s+requested\s+action\s+was\s+never\s+executed/i, label: 'action was never executed' },
    { marker: /zero\s+modifications/i, label: 'zero modifications' },
];
const DEVELOPER_REQUEST_PATTERNS = [
    // Immediate, owner-gated execution commands only. General technical conversation
    // ("audit my code", "fix the chat bug", "explain this file", "senior developer")
    // is now handled by the senior-developer brain path, not blocked here.
    /\bdeploy\s+now\b/i,
    /\bdeploy\s+live\s+now\b/i,
    /\bpush\s+to\s+production\s+now\b/i,
    /\bfix\s+owner\s+login\b/i,
    /\bremove\s+rork\b/i,
    /\bfix\s+supabase\b/i,
    /\baudit\s+landing\s+page\b/i,
    /\brun\s+senior\s+developer\s+task\b/i,
    /\bexecute\s+now\b/i,
];
/**
 * Self-execution inquiry prompts — the owner is asking the chat to report what
 * files it changed, what it deployed, what it did, what commands it ran, etc. The
 * chat has no repository or executor access, so without attached proof the reply
 * MUST be UNVERIFIED, never a fabricated list of files / commits / deploys.
 */
const SELF_EXECUTION_INQUIRY_PATTERNS = [
    /\bwhat\s+files\s+did\s+you\s+(?:change|modify|update|edit|patch|create|add|touch|delete)\b/i,
    /\bwhat\s+(?:did|do)\s+you\s+(?:change|modify|update|edit|patch|create|add|delete|do|run|execute|deploy|push|commit|fix|build)\b/i,
    /\bwhich\s+files\s+did\s+you\s+(?:change|modify|update|edit|patch|create|add)\b/i,
    /\bwhat\s+(?:code|files|commits?|deploys?|patches?|commands?)\s+did\s+you\s+(?:run|execute|write|make|push|deploy|change)\b/i,
    /\bwhat\s+(?:did|do)\s+you\s+(?:deploy|push|commit|run|execute|build|ship)\b/i,
    /\bshow\s+me\s+(?:the\s+)?(?:files|commits?|diff|changes|patches?)\s+you\s+(?:made|did|created|changed)\b/i,
    /\blist\s+(?:the\s+)?(?:files|commits?|changes|deploys?)\s+you\s+(?:made|did|changed|ran)\b/i,
    /\bwhat\s+(?:have\s+you|did\s+you)\s+(?:been\s+)?(?:working\s+on|done|finished|completed|shipped|deployed|changed|modified)\b/i,
    /\btell\s+me\s+what\s+you\s+(?:did|changed|deployed|fixed|ran)\b/i,
    /\bwhat\s+(?:tasks?|work)\s+did\s+you\s+(?:do|complete|finish|run|execute)\b/i,
    /\bwhat\s+did\s+(?:the\s+)?(?:executor|senior\s+developer|developer)\s+(?:do|change|deploy|run|fix)\b/i,
];
/**
 * Verification / confirmation prompts — the owner is asking the chat to attest
 * that prior work is complete, correct, live, or verified. The chat has no way to
 * attest this on its own; only the Developer Proof Ledger can. Without attached
 * proof the reply MUST be UNVERIFIED, never a free-form "yes, it's done".
 */
const VERIFICATION_REQUEST_PATTERNS = [
    // "is this/that/it done?" (question form)
    /\bis\s+(?:this|that|it)\s+(?:done|fixed|complete|completed|live|working|verified|correct|right|good|ok|okay)\b/i,
    // "this/that/it is done/right?" (declarative-then-question form)
    /\b(?:this|that|it)\s+is\s+(?:done|fixed|complete|completed|live|working|verified|correct|right|good|ok|okay)\b/i,
    /\bare\s+(?:you|we)\s+(?:done|finished|live|verified|good)\b/i,
    /\bdid\s+(?:you|it|the)\s+(?:finish|complete|deploy|fix|work|build|ship)\b/i,
    /\bconfirm\s+(?:it'?s|this|that|the)\s+(?:done|fixed|live|complete|working|verified)\b/i,
    /\b(?:please\s+)?verify\s+(?:it'?s|this|that|the)\s+(?:done|fixed|live|complete|working)\b/i,
    /\bis\s+(?:the\s+)?(?:deploy|fix|patch|build|task|work|app|backend|login)\s+(?:done|fixed|live|complete|completed|working|verified|good)\b/i,
    // "the deploy is done?" / "the fix is live?" (declarative-then-question form)
    /\b(?:the\s+)?(?:deploy|fix|patch|build|task|work|app|backend|login)\s+is\s+(?:done|fixed|live|complete|completed|working|verified|good)\b/i,
    /\b(?:you'?re|you\s+are)\s+(?:sure|certain|confident)\s+(?:it'?s|this|that)\s+(?:done|fixed|live|working)\b/i,
    /\bcan\s+you\s+confirm\b/i,
    /\bis\s+everything\s+(?:done|fixed|live|complete|working|verified|good|ok)\b/i,
    /\beverything\s+is\s+(?:done|fixed|live|complete|working|verified|good|ok)\b/i,
    /\bdoes\s+it\s+(?:work|work\s+now|deploy|build|pass)\b/i,
    /\bhas\s+(?:it|this|that|the)\s+(?:been|been\s+actually)\s+(?:deployed|fixed|completed|verified|built|shipped)\b/i,
    /\bwas\s+(?:it|this|that)\s+(?:actually\s+)?(?:deployed|fixed|completed|verified|built|shipped)\b/i,
    // "Did you actually do/finish/build this?" — direct challenge to the chat's
    // prior claimed execution. The chat cannot attest completion on its own; only
    // the Developer Proof Ledger can. Must resolve to UNVERIFIED without proof.
    /\bdid\s+you\s+(?:actually\s+)?(?:do|finish|complete|deploy|fix|build|ship|make|patch|run|execute)\s+(?:this|that|it|the)\b/i,
    /\bdid\s+you\s+(?:really|actually)\s+(?:do|fix|deploy|build|patch|ship|run)\s+(?:it|this|that|the)\b/i,
    /\bdid\s+(?:it|the)\s+(?:actually|really)\s+(?:work|deploy|build|fix|complete|ship)\b/i,
];
/** Generic self-attestation phrases the model uses to claim things are working
 *  without proof. These are blocked when the prompt was a verification request. */
const UNVERIFIED_CONFIRMATION_MARKERS = [
    { marker: /(?:yes|yeah|yep|correct),?\s+(?:the\s+)?(?:system|app|backend|platform|api|server|pipeline|login|deploy(?:ment)?)\s+is\s+(?:fully\s+)?(?:operational|working|live|complete|fixed|verified|good|healthy|up\s+and\s+running)/i, label: 'generic "it is operational/working/live" confirmation' },
    { marker: /(?:yes|yeah|yep),?\s+(?:it|this|that|everything)\s+is\s+(?:fully\s+)?(?:working|operational|complete|fixed|verified|good|live|done|in\s+place)/i, label: 'generic "it is working/complete" confirmation' },
    { marker: /(?:everything|all\s+systems|the\s+system)\s+(?:is|are)\s+(?:fully\s+)?(?:operational|working|live|complete|verified|good|healthy)/i, label: 'everything is operational' },
    { marker: /(?:you\s+can\s+now\s+)?access\s+details,?\s+rankings,?\s+and\s+intelligence/i, label: 'free-form capability claim' },
    { marker: /(?:it|this|the\s+fix|the\s+deploy)\s+is\s+(?:now\s+)?(?:live|complete|done|verified|working)\b/i, label: 'it is now live/complete/done' },
];
export function isVerificationRequest(message) {
    const text = trimmed(message);
    return VERIFICATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}
export function isSelfExecutionInquiry(message) {
    const text = trimmed(message);
    return SELF_EXECUTION_INQUIRY_PATTERNS.some((pattern) => pattern.test(text));
}
export function findUnverifiedConfirmationMarkers(answer) {
    const text = trimmed(answer);
    return UNVERIFIED_CONFIRMATION_MARKERS.filter(({ marker }) => marker.test(text)).map(({ label }) => label);
}
function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
export function findFakeExecutionClaims(answer) {
    const text = trimmed(answer);
    return FAKE_EXECUTION_CLAIMS.filter(({ marker }) => marker.test(text)).map(({ label }) => label);
}
export function findConfessionApologyMarkers(answer) {
    const text = trimmed(answer);
    return CONFESSION_APOLOGY_SECRETARY_MARKERS.filter(({ marker }) => marker.test(text)).map(({ label }) => label);
}
export function isDeveloperRequest(message) {
    const text = trimmed(message);
    return DEVELOPER_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}
export function buildFakeExecutionBlockedMessage(input) {
    const lines = [];
    lines.push(`STATE: ${input.state}`);
    lines.push('');
    if (input.fakeClaims.length > 0) {
        lines.push('FAKE EXECUTION CLAIMS DETECTED:');
        for (const claim of input.fakeClaims) {
            lines.push(` - ${claim}`);
        }
        lines.push('');
    }
    if (input.confessionMarkers.length > 0) {
        lines.push('INVALID NARRATIVE DETECTED:');
        for (const marker of input.confessionMarkers) {
            lines.push(` - ${marker}`);
        }
        lines.push('The IVX IA chat does not have repository, deploy, or test execution access.');
        lines.push('');
    }
    // The unverified-confirmation list is not surfaced as a separate header (it
    // would clutter the owner-facing message); it is covered by the reason line.
    void input.unverifiedConfirmationMarkers;
    lines.push(`REASON: ${input.reason}`);
    lines.push('');
    lines.push('REQUIRED ACTION:');
    if (!input.ownerSessionPresent) {
        lines.push(' - Sign in as the owner first.');
        lines.push(' - Open Owner Login / Developer Workspace.');
    }
    else if (!input.hasRealProof) {
        lines.push(' - Open IVX Developer Workspace → Senior Developer Executor.');
        lines.push(' - Submit the task with owner approval.');
        lines.push(' - Wait for the real proof ledger entry (task_id, files_changed, commit_sha, render_deploy_id, live_http_status).');
    }
    lines.push('');
    lines.push('UNVERIFIED — no success claim is valid without Developer Proof Ledger evidence.');
    return lines.join('\n');
}
/**
 * Apply the fake-execution gate. The chat model is never the executor. Any
 * first-person execution claim or confession/apology/secretary filler is replaced
 * with a strict BLOCKED routing message.
 */
export function applyIVXFakeExecutionGate(input) {
    const fakeClaims = findFakeExecutionClaims(input.answer);
    const confessionMarkers = findConfessionApologyMarkers(input.answer);
    const unverifiedConfirmationMarkers = findUnverifiedConfirmationMarkers(input.answer);
    const isDevRequest = isDeveloperRequest(input.message);
    const isVerifyRequest = isVerificationRequest(input.message);
    const isSelfInquiry = isSelfExecutionInquiry(input.message);
    const hasRealProof = Boolean(input.proof
        && input.proof.taskId.length > 0
        && input.proof.filesChanged.length > 0
        && input.proof.commitSha
        && input.proof.renderDeployId
        && typeof input.proof.liveHttpStatus === 'number'
        && input.proof.liveHttpStatus >= 200
        && input.proof.liveHttpStatus < 300);
    // Self-execution inquiry (e.g. "what files did you change?", "what did you
    // deploy?"). The chat cannot report its own execution because it has no
    // repository / executor access. This MUST be checked BEFORE the developer-request
    // branch because self-inquiry prompts often contain developer verbs ("deploy",
    // "change", "fix") that would otherwise route them into the BLOCKED dev-request
    // path. Self-inquiry is a question about past execution, not a request to act,
    // so the correct state is UNVERIFIED (with proof → VERIFIED), never BLOCKED.
    if (isSelfInquiry) {
        if (hasRealProof) {
            return {
                answer: input.answer,
                gated: false,
                state: 'VERIFIED',
                reason: 'Self-execution inquiry with real proof attached.',
                fakeClaims,
                confessionMarkers,
                unverifiedConfirmationMarkers,
            };
        }
        const reason = !input.ownerSessionPresent
            ? 'owner session missing — self-execution inquiry requires a Developer Proof Ledger entry.'
            : 'Self-execution inquiry requires a Developer Proof Ledger entry (task_id, files_changed, commit_sha, render_deploy_id, live_http_status); none is attached to this turn.';
        const state = 'UNVERIFIED';
        return {
            answer: buildFakeExecutionBlockedMessage({
                state,
                reason,
                fakeClaims,
                confessionMarkers,
                ownerSessionPresent: input.ownerSessionPresent,
                hasRealProof,
            }),
            gated: true,
            state,
            reason,
            fakeClaims,
            confessionMarkers,
            unverifiedConfirmationMarkers,
        };
    }
    // Developer request WITH real proof attached: allow success claims to pass
    // through as VERIFIED. The Senior Developer Executor already produced the proof,
    // so the chat model is allowed to relay that the task is complete.
    if (isDevRequest && hasRealProof) {
        return {
            answer: input.answer,
            gated: false,
            state: 'VERIFIED',
            reason: 'Developer request with real proof attached.',
            fakeClaims,
            confessionMarkers,
            unverifiedConfirmationMarkers,
        };
    }
    // Developer request WITHOUT real proof always routes to BLOCKED, regardless of
    // whether the model answer contains fake claims or not.
    if (isDevRequest) {
        const reason = !input.ownerSessionPresent
            ? 'owner session missing'
            : 'Developer request requires a real Senior Developer Executor proof ledger entry; none is attached to this turn.';
        const state = 'BLOCKED';
        return {
            answer: buildFakeExecutionBlockedMessage({
                state,
                reason,
                fakeClaims,
                confessionMarkers,
                ownerSessionPresent: input.ownerSessionPresent,
                hasRealProof,
            }),
            gated: true,
            state,
            reason,
            fakeClaims,
            confessionMarkers,
            unverifiedConfirmationMarkers,
        };
    }
    // Verification / confirmation request (e.g. "is this done right?"). The chat
    // cannot attest completion on its own. With real proof → VERIFIED; otherwise
    // the reply MUST be UNVERIFIED, never a free-form "yes, it's done". A drafted
    // answer that contains a generic confirmation is replaced.
    if (isVerifyRequest) {
        if (hasRealProof) {
            return {
                answer: input.answer,
                gated: false,
                state: 'VERIFIED',
                reason: 'Verification request with real proof attached.',
                fakeClaims,
                confessionMarkers,
                unverifiedConfirmationMarkers,
            };
        }
        const reason = !input.ownerSessionPresent
            ? 'owner session missing — verification requires a Developer Proof Ledger entry.'
            : 'Verification request requires a Developer Proof Ledger entry (task_id, files_changed, commit_sha, render_deploy_id, live_http_status); none is attached to this turn.';
        const state = 'UNVERIFIED';
        return {
            answer: buildFakeExecutionBlockedMessage({
                state,
                reason,
                fakeClaims,
                confessionMarkers,
                ownerSessionPresent: input.ownerSessionPresent,
                hasRealProof,
            }),
            gated: true,
            state,
            reason,
            fakeClaims,
            confessionMarkers,
            unverifiedConfirmationMarkers,
        };
    }
    // Non-developer, non-verification message with fake execution / confession /
    // unverified-confirmation markers in the answer.
    if (fakeClaims.length > 0 || confessionMarkers.length > 0 || unverifiedConfirmationMarkers.length > 0) {
        const reason = fakeClaims.length > 0
            ? 'The chat model attempted to claim it executed developer work. The IVX IA chat cannot modify files, run tests, commit, or deploy.'
            : unverifiedConfirmationMarkers.length > 0
                ? 'The chat model issued a generic "it is working/operational/live" confirmation without Developer Proof Ledger evidence.'
                : 'The chat model produced an apology/confession/secretary narrative instead of real proof or a single status.';
        const state = 'BLOCKED';
        return {
            answer: buildFakeExecutionBlockedMessage({
                state,
                reason,
                fakeClaims,
                confessionMarkers,
                ownerSessionPresent: input.ownerSessionPresent,
                hasRealProof,
            }),
            gated: true,
            state,
            reason,
            fakeClaims,
            confessionMarkers,
            unverifiedConfirmationMarkers,
        };
    }
    // No violation and not a developer/verification request: pass through.
    return {
        answer: input.answer,
        gated: false,
        state: 'READY',
        reason: 'No fake execution or confession narrative detected.',
        fakeClaims,
        confessionMarkers,
        unverifiedConfirmationMarkers,
    };
}
