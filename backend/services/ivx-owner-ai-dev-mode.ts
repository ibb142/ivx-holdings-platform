/**
 * IVX Owner AI Developer Mode — turn the chat into a real executor.
 *
 * Why this exists: the owner explicitly rejected the BLOCKED-only behavior when
 * they ask for development/deploy/audit work. The chat must still refuse to
 * fabricate proof, but it can now trigger a real senior-developer job through
 * the owner-gated worker and stream the proof back into the conversation.
 *
 * Rules:
 *   - No fake proof. The chat only reports what the worker returns.
 *   - Static status/brain answers MUST NOT claim runtime success.
 *   - If the worker returns BLOCKED (missing credentials / owner not signed in),
 *     the chat explains the exact blocker and the required action.
 *   - If the worker succeeds, the chat returns the strict evidence block
 *     (TASK UNDERSTOOD / FILES CHANGED / COMMANDS RUN / STATUS / PROOF).
 */

import { asksToCreateAndShowProof } from './ivx-owner-ai-intent-router';

export type IVXOwnerAIDevModeResult =
  | { mode: 'developer'; ok: boolean; evidence: string; error: string | null };

export function detectSeniorDeveloperModeStatusRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  // A "create and show me" / "build and prove" execution command must NEVER be
  // hijacked by a static Senior Developer status answer. Execution wins.
  if (asksToCreateAndShowProof(text)) {
    return false;
  }
  const statusPhrases = [
    'senior developer mode',
    'senior dev mode',
    'developer mode',
    'dev mode',
    'are you a senior developer',
    'are you in senior',
    'are you in developer',
    'do you in senior',
    'do you in developer',
    'you are senior developer',
    'you are developer',
    'switch to senior developer',
    'switch to developer',
    'enterprise senior developer',
  ];
  return statusPhrases.some((p) => text.includes(p));
}

export function buildSeniorDeveloperModeStatusAnswer(): string {
  return [
    'IVX Senior Developer mode is configured and owner-gated.',
    'RUNTIME STATUS: UNVERIFIED BY THIS STATIC STATUS CHECK.',
    'This answer is not a certificate and does not prove that repository access, patching, GitHub push, Render deploy, or production verification succeeded in this session.',
    'A real task becomes VERIFIED only when runtime evidence contains the applicable files inspected/changed, validation results, commit SHA, deploy result, and live health/version proof.',
    'TO PROVE IT: run “Run a senior developer task: <exact goal>” and require the returned worker/job evidence.',
  ].join('\n');
}

/**
 * Direct senior-developer brain request: this detector is intentionally narrow.
 * It handles meta-questions ABOUT the Senior Developer brain itself.
 *
 * It must NOT capture substantive engineering prompts merely because the owner
 * says "act as a senior developer" or "answer like a senior developer". Those
 * prompts must continue through the normal LLM/intent/worker path so IVX IA can
 * actually reason about the user's technical request instead of returning a
 * canned persona answer.
 */
export function detectSeniorDeveloperBrainRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase();
  if (asksToCreateAndShowProof(text)) {
    return false;
  }
  const brainMetaPhrases = [
    'same brain like you',
    'same brain as you',
    'brain like you',
    'senior developer brain',
    'senior developer is not working',
    'is the senior developer ready',
    'is senior developer ready',
    'senior developer mode ready',
  ];
  return brainMetaPhrases.some((p) => text.includes(p));
}

export function buildSeniorDeveloperBrainAnswer(): string {
  return [
    'IVX IA has an owner-gated Senior Developer execution path.',
    '',
    'STATIC BRAIN STATUS: this response only describes the configured path. It is not proof that IVX IA inspected code, changed a file, ran tests, committed, deployed, or verified production in this conversation.',
    '',
    'For real engineering work, ask the technical question directly or run: “Run a senior developer task: <exact goal>”. The response must be grounded in runtime evidence, not this static message.',
    '',
    'VERIFICATION CONTRACT: no commit/deploy/10-of-10 claim is valid without the applicable worker/job ID, files inspected or changed, validation results, commit SHA, deploy result, and live verification.',
  ].join('\n');
}

export function detectDeveloperModeRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase();
  // Senior-developer mode STATUS and BRAIN meta-questions are handled above.
  if (detectSeniorDeveloperModeStatusRequest(message) || detectSeniorDeveloperBrainRequest(message)) {
    return false;
  }
  // A creation/show-proof command is an explicit execution intent that routes to
  // the owner-gated senior developer worker, not a legacy block.
  if (asksToCreateAndShowProof(text)) {
    return false;
  }
  // Only block explicit, immediate execution commands that require the owner-gated worker.
  const executionTriggers = [
    'deploy now',
    'fix owner login',
    'remove rork',
    'fix supabase',
    'run senior developer task',
    'push to production now',
    'deploy live now',
    'execute now',
  ];
  return executionTriggers.some((t) => text.includes(t));
}

export function buildDeveloperModeBlockedExplanation(blocker: string): string {
  return [
    'BLOCKED — IVX Owner AI cannot fabricate a deployment or code-change claim.',
    `REASON: ${blocker}`,
    'EXACT_ACTION_REQUIRED:',
    '1. Sign in to the IVX app as the owner.',
    '2. Go to Admin → IVX Developer Workspace.',
    '3. Submit the task with owner approval and real credentials (GitHub token, Render API key, Supabase service key).',
    '4. The senior-developer worker will execute, commit, deploy, and return live proof.',
    'No proof = no VERIFIED status.',
  ].join('\n');
}