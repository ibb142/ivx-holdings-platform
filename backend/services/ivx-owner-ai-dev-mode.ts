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
  // hijacked by the static Senior Developer mode status answer, even if the owner
  // also includes a phrase like "I want to see if you are senior developer". When
  // both an execution signal and a status phrase are present, execution wins.
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
    'YES — IVX Enterprise Senior Developer mode is live and owner-gated.',
    'CAPABILITIES: end-to-end repo inspection, safe code patch, test/build runner, GitHub commit/push, Render deploy, production health verify, proof ledger.',
    'REQUIRED: owner sign-in + real GitHub/Render/Supabase credentials.',
    'TO USE IT:',
    '1. Make sure you are signed in as the IVX owner.',
    '2. Ask: "Run a senior developer task: <goal>" or go to Admin → IVX Developer Workspace.',
    '3. The worker will execute, commit, deploy, and return live proof.',
    'No proof = no VERIFIED status.',
  ].join('\n');
}

/**
 * Direct senior-developer brain request: the owner wants the AI to answer, audit,
 * or reason like a real senior developer (same brain as the IVX agent). This is a
 * CONVERSATIONAL / ADVISORY intent, not an execution command. It must pass through
 * the gates and return a direct, useful answer instead of a BLOCKED proof ledger
 * message. Execution (commit/deploy) still requires the owner-gated worker.
 */
export function detectSeniorDeveloperBrainRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase();
  // A "create and show me" / "build and prove" execution command must NEVER be
  // hijacked by the conversational brain answer, even if the owner also asks the
  // AI to "act as a senior developer" or "you are a senior developer". Execution
  // wins over advisory/persona mode.
  if (asksToCreateAndShowProof(text)) {
    return false;
  }
  const brainPhrases = [
    'same brain like you',
    'same brain as you',
    'brain like you',
    'senior developer brain',
    'enterprise senior developer',
    'act as senior developer',
    'act as a senior developer',
    'you are senior developer',
    'you are a senior developer',
    'behave like a senior developer',
    'answer like a senior developer',
    'answer exactly what i ask',
    'audit and fix senior developer',
    'audit and fix the senior developer',
    'fix senior developer',
    'senior developer is not working',
    'real senior developer ready',
    'senior developer ready to start',
    'ready to start work now',
    'senior developer mode ready',
    'senior developer answer',
  ];
  return brainPhrases.some((p) => text.includes(p));
}

export function buildSeniorDeveloperBrainAnswer(): string {
  return [
    'I am IVX Enterprise Senior Developer mode — same brain as the IVX agent, owner-gated, live now.',
    '',
    'What I do as an enterprise senior developer:',
    '- Answer architecture, code, security, and infrastructure questions directly.',
    '- Audit the codebase, Supabase, GitHub, Render, and AWS setup and tell you what is wrong.',
    '- Propose exact patches, file paths, and commands.',
    '- Execute end-to-end when you tell me to: inspect, patch, test, commit, deploy, and verify — returning a strict evidence block (task_id, files changed, commands run, status, proof).',
    '',
    'What I do NOT do without your explicit owner approval:',
    '- Write files, commit, push, deploy, or change production schema/data.',
    '- Those actions route through the owner-gated Senior Developer Worker so you always see real proof (task_id, commit_sha, render_deploy_id, live_http_status).',
    '',
    'How to use me right now:',
    '1. Ask me anything technical: "audit my auth flow", "why is the chat slow?", "review my Supabase RLS", etc.',
    '2. If you want me to actually change code, say: "Run a senior developer task: <exact goal>" or "fix X and deploy live with proof" and I will execute end-to-end with real evidence.',
    '',
    'STATUS: READY. No BLOCKED state. I answer exactly what you ask.',
  ].join('\n');
}

export function detectDeveloperModeRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase();
  // Senior-developer mode STATUS and BRAIN questions are handled above, not blocked.
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