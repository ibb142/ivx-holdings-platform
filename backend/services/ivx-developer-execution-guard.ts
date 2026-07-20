/**
 * IVX Developer Execution Output Guard
 *
 * Final safety net for the self-developer route. The router already sends
 * development commands to the senior-developer runtime, and
 * `buildSeniorDeveloperExecutionAnswer` already renders the strict evidence
 * format. This module is the LAST line of defence: it inspects the answer
 * that is about to be returned to the owner and BLOCKS it when it is narrative-only
 * or makes a claim it has not proven.
 *
 * Owner-mandated answer format (6 sections):
 *   TASK ID
 *   STATUS
 *   FILES CHANGED
 *   COMMANDS
 *   TESTS
 *   DEPLOYED PROOF
 *
 * Hard rules enforced here (owner spec):
 *   - No narrative-only answers. The 6 section headers must be present.
 *   - No "reviewed/prepared/initialized/awaiting approval/development phase/
 *     schema planning" prose unless real proof (raw command output) is present.
 *   - No "verified" claim without raw command output (`$ ... exit code:`).
 *   - No "deployed" claim without a live endpoint / commit proof line.
 *   - No "done/complete" claim without a real file diff.
 *
 * Pure and deterministic (no network / filesystem / AI) so it is fully unit
 * testable.
 */

/**
 * Sentinel embedded in a guard-blocked answer. When present (together with a
 * BLOCKED status and NO CODE CHANGED), the answer is a recognised compliant
 * terminal state: it makes no success claims, so validation must not re-trigger
 * on the violation reasons it quotes (which legitimately mention words like
 * "verified"/"deployed"). This keeps the guard idempotent.
 */
export const DEVELOPER_EXECUTION_GUARD_MARKER = 'failed developer-execution enforcement';

/** Section headers every development-task answer must contain, in order. */
export const REQUIRED_DEVELOPER_SECTIONS: readonly string[] = [
  'TASK ID:',
  'STATUS:',
  'FILES CHANGED:',
  'COMMANDS:',
  'TESTS:',
  'DEPLOYED PROOF:',
];

/**
 * Narrative phrases the owner explicitly banned. They are only allowed when the
 * answer also carries real proof (raw command output), because a genuine run can
 * legitimately say e.g. "reviewed" alongside the evidence.
 *
 * IMPORTANT: Only phrases that indicate a promise-only / planning-only response
 * with no execution are banned. Phrases like "starting implementation" or
 * "inspecting files" are valid in-progress states and must NOT be blocked —
 * they are the developer worker reporting its progress. The guard runs AFTER
 * execution, so if the worker produced real proof alongside these phrases,
 * they are fine. If the worker produced ONLY these phrases with no proof,
 * the missing-sections check (no COMMANDS / no TESTS) already
 * catches that — the phrase ban is a secondary safety net.
 */
export const BANNED_NARRATIVE_PHRASES: readonly string[] = [
  'awaiting approval',
  'once approved',
  'architecture proposal',
  'execution plan',
  'implementation plan',
  'development plan',
  'next steps required',
  'next steps:',
];

export type DeveloperExecutionGuardResult = {
  ok: boolean;
  violations: string[];
  hasAllSections: boolean;
  hasRawCommandOutput: boolean;
};

/** Raw command output looks like `$ <cmd> ... exit code: N`. */
export function hasRawCommandOutput(answer: string): boolean {
  const text = answer ?? '';
  const hasCommandLine = /^\s*\$\s+\S+/m.test(text);
  const hasExitCode = /\bexit\s+code:\s*\S+/i.test(text) || /->\s*exit\s+\S+/i.test(text);
  return hasCommandLine && hasExitCode;
}

/** A positive "verified" claim (not the allowed "NOT VERIFIED — ..." line). */
export function claimsVerified(answer: string): boolean {
  const text = (answer ?? '').toLowerCase();
  // Strip the explicit honest negatives so they never count as a claim.
  const stripped = text
    .replace(/not\s+verified[^\n]*/g, '')
    .replace(/typecheck\s+result:/g, '')
    .replace(/test\s+result:/g, '');
  return /\bverified\b|\bverification\s+passed\b|\ball\s+checks\s+pass(?:ed)?\b/.test(stripped);
}

/** A "deployed/live in production" claim. */
export function claimsDeployed(answer: string): boolean {
  const text = (answer ?? '').toLowerCase();
  const stripped = text
    .replace(/local\s+only/g, '')
    .replace(/not\s+deployed/g, '')
    .replace(/deploy\s+attempted/g, '');
  return /\bstatus:\s*\n?\s*deployed\b/.test(stripped)
    || /\bdeployed\s+to\s+(?:prod|production|live|render)\b/.test(stripped)
    || /\blive\s+in\s+production\b/.test(stripped);
}

/** A "done/complete/finished" success claim. */
export function claimsDone(answer: string): boolean {
  const text = (answer ?? '').toLowerCase();
  const stripped = text.replace(/no\s+development\s+was\s+completed/g, '');
  return /\b(?:task\s+)?(?:done|completed|complete|finished|shipped)\b/.test(stripped);
}

/** True when the answer proves a real file diff (changed paths in PROOF). */
export function hasFileDiffProof(answer: string): boolean {
  const text = answer ?? '';
  if (/NO CODE CHANGED/.test(text)) {
    return false;
  }
  // git diff --stat (applied patch) followed by a " path | summary" line, or a
  // git status --short " M path" line.
  return /git\s+diff\s+--stat[^\n]*\n\s*\S+\s*\|/i.test(text)
    || /git\s+status\s+--short:[\s\S]*\n\s*[AM]\s+\S+/i.test(text);
}

/** True when a live endpoint / commit proof line is present. */
export function hasDeploymentProof(answer: string): boolean {
  const text = answer ?? '';
  return /\bcommit:\s*[0-9a-f]{6,}/i.test(text)
    || /production\s+\/health:\s*healthy/i.test(text)
    || /changed\s+route:\s*live/i.test(text)
    || /deploy:\s*\S+/i.test(text);
}

/**
 * Validate that a candidate answer is a real developer-execution response and not
 * narrative-only or an unproven claim.
 */
export function validateDeveloperExecutionAnswer(answer: string): DeveloperExecutionGuardResult {
  const text = answer ?? '';

  // A guard-blocked answer is a recognised compliant terminal state. It carries
  // the sentinel marker, a BLOCKED status, and NO CODE CHANGED — it makes no
  // success claims, so it passes without re-triggering on the violation reasons
  // it quotes. This guarantees enforcement is idempotent.
  if (text.includes(DEVELOPER_EXECUTION_GUARD_MARKER) && /STATUS:\s*\n?\s*BLOCKED/.test(text) && text.includes('NO CODE CHANGED')) {
    return { ok: true, violations: [], hasAllSections: true, hasRawCommandOutput: false };
  }

  const violations: string[] = [];

  const missingSections = REQUIRED_DEVELOPER_SECTIONS.filter((header) => !text.includes(header));
  const hasAllSections = missingSections.length === 0;
  if (!hasAllSections) {
    violations.push(`missing required sections: ${missingSections.join(', ')}`);
  }

  const rawOutput = hasRawCommandOutput(text);

  // Banned narrative phrases are only tolerated when real proof accompanies them.
  if (!rawOutput) {
    const lower = text.toLowerCase();
    for (const phrase of BANNED_NARRATIVE_PHRASES) {
      if (lower.includes(phrase)) {
        violations.push(`narrative phrase without proof: "${phrase}"`);
      }
    }
  }

  if (claimsVerified(text) && !rawOutput) {
    violations.push('claims "verified" without raw command output');
  }

  if (claimsDeployed(text) && !hasDeploymentProof(text)) {
    violations.push('claims "deployed" without live endpoint / commit proof');
  }

  if (claimsDone(text) && !hasFileDiffProof(text)) {
    violations.push('claims "done/complete" without a real file diff');
  }

  return {
    ok: violations.length === 0,
    violations,
    hasAllSections,
    hasRawCommandOutput: rawOutput,
  };
}

/**
 * Replacement message returned to the owner when a development answer fails the
 * guard. Keeps the strict format so the client renders it consistently and the
 * owner immediately sees it was blocked rather than a fake success.
 */
export function buildBlockedDeveloperExecutionAnswer(violations: string[]): string {
  const reasons = violations.length > 0 ? violations.map((v) => ` - ${v}`).join('\n') : ' - narrative-only response blocked';
  return [
    `TASK ID:\n(blocked)`,
    'STATUS:\nBLOCKED',
    'FILES CHANGED:\nNO CODE CHANGED — no development was completed.',
    'COMMANDS:\nNONE — no commands were executed.',
    'TESTS:\nNOT VERIFIED — tests were not run.',
    `DEPLOYED PROOF:\nBLOCKED — the generated answer ${DEVELOPER_EXECUTION_GUARD_MARKER}:\n${reasons}`,
  ].join('\n\n');
}

/**
 * Enforce developer-execution mode on a candidate answer. Returns the original
 * answer when it passes, otherwise a BLOCKED replacement. Never lets a
 * narrative-only / unproven answer reach the owner.
 */
export function enforceDeveloperExecutionAnswer(answer: string): {
  answer: string;
  enforced: boolean;
  result: DeveloperExecutionGuardResult;
} {
  const result = validateDeveloperExecutionAnswer(answer);
  if (result.ok) {
    return { answer, enforced: false, result };
  }
  return {
    answer: buildBlockedDeveloperExecutionAnswer(result.violations),
    enforced: true,
    result,
  };
}
