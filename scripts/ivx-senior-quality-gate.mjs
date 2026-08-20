/**
 * IVX Senior Developer Quality Gate
 *
 * Replaces the defective acceptance rule `quality_ok = ok && evidence_ok`,
 * which accepted an agent as "senior developer 10/10" merely because an HTTP
 * call returned ok=true and two evidence strings were non-empty.
 *
 * Governing principle: MISSING EVIDENCE IS A FAILURE.
 * A requirement that was never reported is NOT satisfied. There is no
 * "assume pass", no "not applicable by omission", and no catch-all success.
 *
 * The gate is intentionally pure and synchronous so it can be unit tested
 * without network, clock or filesystem access.
 */

/** Exact status vocabulary. No generic SUCCESS is permitted. */
export const AGENT_STATUS = Object.freeze({
  WORKING: 'WORKING',
  PASS_SENIOR_GATE: 'PASS_SENIOR_GATE',
  FAIL_CODE: 'FAIL_CODE',
  FAIL_TESTS: 'FAIL_TESTS',
  FAIL_TYPECHECK: 'FAIL_TYPECHECK',
  FAIL_LINT: 'FAIL_LINT',
  FAIL_SECURITY: 'FAIL_SECURITY',
  FAIL_PERFORMANCE: 'FAIL_PERFORMANCE',
  FAIL_ACCESSIBILITY: 'FAIL_ACCESSIBILITY',
  FAIL_DEPLOYMENT: 'FAIL_DEPLOYMENT',
  BLOCKED_AUTH: 'BLOCKED_AUTH',
  BLOCKED_API: 'BLOCKED_API',
  BLOCKED_CONTRACT: 'BLOCKED_CONTRACT',
  BLOCKED_DEPENDENCY: 'BLOCKED_DEPENDENCY',
  NO_TASK: 'NO_TASK',
  STALE: 'STALE',
  UNVERIFIED: 'UNVERIFIED',
});

const ACCEPTED_FINAL_STATUS = new Set(['completed', 'success', 'succeeded']);

/** A check sub-object counts only when it explicitly executed AND passed. */
function checkExecutedAndPassed(node) {
  if (!node || typeof node !== 'object') return { ok: false, reason: 'missing' };
  if (node.executed !== true) return { ok: false, reason: 'not_executed' };
  if (node.passed !== true) return { ok: false, reason: 'not_passed' };
  return { ok: true, reason: '' };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

/** Strict boolean true. `undefined` never satisfies a requirement. */
function isTrue(v) {
  return v === true;
}

/**
 * Evaluate one agent result against the senior developer hard gate.
 * @param {object} r raw agent result record
 * @returns {{acceptedBySeniorGate:boolean, status:string, rejectionReasons:string[], applicable:object}}
 */
export function evaluateSeniorGate(r) {
  const rec = r && typeof r === 'object' ? r : {};
  const reasons = [];

  // ---- Applicability: derived from what the agent reports it changed ----
  const changedFiles = Array.isArray(rec.changedFiles) ? rec.changedFiles : [];
  const codeChanged = isTrue(rec.codeChanged) || isNonEmptyString(rec.commitSha) || changedFiles.length > 0;

  const touches = (re) => changedFiles.some((f) => re.test(String(f)));
  const securityChanged = isTrue(rec.securityRelevant)
    || touches(/(auth|login|session|token|secret|credential|payment|billing|wire|bank|owner)/i);
  const uiChanged = isTrue(rec.uiChanged)
    || touches(/\.(tsx|jsx)$|(^|\/)(app|components|screens|ui)\//i);
  const perfSensitive = isTrue(rec.performanceSensitive)
    || touches(/(query|queries|feed|list|loop|worker|queue|cache|index|migration)/i);

  const applicable = { codeChanged, securityChanged, uiChanged, perfSensitive };

  // ---- Blocking / non-productive classifications take precedence ----
  const runHttp = Number(rec.runHttp ?? rec.httpStatus ?? 0);
  const contractHttp = Number(rec.contractHttp ?? 0);

  if (contractHttp && contractHttp !== 200) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.BLOCKED_CONTRACT,
      rejectionReasons: [`contract_http_${contractHttp}`], applicable };
  }
  if (runHttp === 401 || runHttp === 403) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.BLOCKED_AUTH,
      rejectionReasons: [`run_http_${runHttp}`], applicable };
  }
  if (rec.finalStatus === 'no_task' || isTrue(rec.noTask)) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.NO_TASK,
      rejectionReasons: ['agent_had_no_task'], applicable };
  }
  if (isTrue(rec.stale)) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.STALE,
      rejectionReasons: ['heartbeat_stale'], applicable };
  }
  if (rec.finalStatus === 'running' || rec.finalStatus === 'in_progress') {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.WORKING,
      rejectionReasons: ['still_running_at_audit_time'], applicable };
  }
  // A record that never produced a run result at all is UNVERIFIED, not failed.
  if (!runHttp && rec.ok === undefined && !isNonEmptyString(rec.finalStatus)) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.UNVERIFIED,
      rejectionReasons: ['no_run_result_recorded'], applicable };
  }
  if (runHttp && runHttp !== 200) {
    return { acceptedBySeniorGate: false, status: AGENT_STATUS.BLOCKED_API,
      rejectionReasons: [`run_http_${runHttp}`], applicable };
  }

  // ---- BASE REQUIREMENTS (always applicable) ----
  if (runHttp !== 200) reasons.push('runHttp!=200');
  if (!isTrue(rec.ok)) reasons.push('ok!=true');
  if (!ACCEPTED_FINAL_STATUS.has(String(rec.finalStatus))) {
    reasons.push(`finalStatus=${rec.finalStatus ?? 'missing'}`);
  }
  if (!isNonEmptyString(rec.sourceReference)) reasons.push('sourceReference_missing');
  if (!isNonEmptyString(rec.toolResultId)) reasons.push('toolResultId_missing');
  // simulated / fakeSuccess must be explicitly false. Absent => cannot prove real.
  if (rec.simulated !== false) reasons.push('simulated_not_proven_false');
  if (rec.fakeSuccess !== false) reasons.push('fakeSuccess_not_proven_false');

  // ---- CODE CHANGED ----
  let failCategory = null;
  if (codeChanged) {
    if (!isNonEmptyString(rec.commitSha)) reasons.push('commitSha_missing');
    if (!isNonEmptyArray(rec.changedFiles)) reasons.push('changedFiles_empty');

    const t = checkExecutedAndPassed(rec.tests);
    if (!t.ok) { reasons.push(`tests_${t.reason}`); failCategory ??= AGENT_STATUS.FAIL_TESTS; }

    const tc = checkExecutedAndPassed(rec.typecheck);
    if (!tc.ok) { reasons.push(`typecheck_${tc.reason}`); failCategory ??= AGENT_STATUS.FAIL_TYPECHECK; }

    const l = checkExecutedAndPassed(rec.lint);
    if (!l.ok) { reasons.push(`lint_${l.reason}`); failCategory ??= AGENT_STATUS.FAIL_LINT; }
  }

  // ---- SECURITY / AUTH / PAYMENTS CHANGED ----
  if (securityChanged) {
    const s = checkExecutedAndPassed(rec.securityReview);
    if (!s.ok) { reasons.push(`securityReview_${s.reason}`); failCategory ??= AGENT_STATUS.FAIL_SECURITY; }
    if (!isTrue(rec.negativeAuthTestsPassed)) {
      reasons.push('negativeAuthTests_not_passed'); failCategory ??= AGENT_STATUS.FAIL_SECURITY;
    }
    if (rec.secretExposure !== false) {
      reasons.push('secretExposure_not_proven_false'); failCategory ??= AGENT_STATUS.FAIL_SECURITY;
    }
    if (rec.authorizationRegression !== false) {
      reasons.push('authorizationRegression_not_proven_false'); failCategory ??= AGENT_STATUS.FAIL_SECURITY;
    }
  }

  // ---- UI CHANGED ----
  if (uiChanged) {
    const a = checkExecutedAndPassed(rec.accessibilityReview ?? rec.accessibility);
    if (!a.ok) { reasons.push(`accessibility_${a.reason}`); failCategory ??= AGENT_STATUS.FAIL_ACCESSIBILITY; }
    if (!isTrue(rec.mobileSmokeTestPassed)) {
      reasons.push('mobileSmokeTest_not_passed'); failCategory ??= AGENT_STATUS.FAIL_ACCESSIBILITY;
    }
    if (rec.blackScreen !== false) {
      reasons.push('blackScreen_not_proven_false'); failCategory ??= AGENT_STATUS.FAIL_ACCESSIBILITY;
    }
    if (rec.brokenNavigation !== false) {
      reasons.push('brokenNavigation_not_proven_false'); failCategory ??= AGENT_STATUS.FAIL_ACCESSIBILITY;
    }
    if (!isTrue(rec.statesVerified)) {
      reasons.push('loading_error_empty_states_not_verified'); failCategory ??= AGENT_STATUS.FAIL_ACCESSIBILITY;
    }
  }

  // ---- PERFORMANCE SENSITIVE ----
  if (perfSensitive) {
    const p = checkExecutedAndPassed(rec.performanceReview);
    if (!p.ok) { reasons.push(`performanceReview_${p.reason}`); failCategory ??= AGENT_STATUS.FAIL_PERFORMANCE; }
    if (rec.performanceRegression !== false) {
      reasons.push('performanceRegression_not_proven_false'); failCategory ??= AGENT_STATUS.FAIL_PERFORMANCE;
    }
  }

  // ---- DEPLOYMENT (when the agent claims a deployment) ----
  if (rec.deploymentEvidence !== undefined && rec.deploymentEvidence !== null) {
    const d = rec.deploymentEvidence;
    const healthy = d && (d.health === 'healthy' || d.healthy === true);
    const shaMatch = d && isNonEmptyString(d.versionCommit) && d.versionCommit === rec.commitSha;
    if (!healthy) { reasons.push('deployment_health_not_healthy'); failCategory ??= AGENT_STATUS.FAIL_DEPLOYMENT; }
    if (!shaMatch) { reasons.push('deployment_version_sha_mismatch'); failCategory ??= AGENT_STATUS.FAIL_DEPLOYMENT; }
  }

  if (reasons.length === 0) {
    return { acceptedBySeniorGate: true, status: AGENT_STATUS.PASS_SENIOR_GATE, rejectionReasons: [], applicable };
  }

  const status = failCategory ?? AGENT_STATUS.FAIL_CODE;
  return { acceptedBySeniorGate: false, status, rejectionReasons: reasons, applicable };
}

/**
 * Fleet-level rollup. The certificate may only be issued when every one of the
 * expected agents is accepted; anything else yields NOT-CERTIFIED with reasons.
 */
export function summarizeFleet(results, expected = 112) {
  const list = Array.isArray(results) ? results : [];
  const evaluated = list.map((r) => ({ ...r, ...evaluateSeniorGate(r) }));

  const accepted = evaluated.filter((e) => e.acceptedBySeniorGate);
  const blocked = evaluated.filter((e) => e.status.startsWith('BLOCKED_'));
  const unverified = evaluated.filter((e) => e.status === AGENT_STATUS.UNVERIFIED);
  const failed = evaluated.filter(
    (e) => !e.acceptedBySeniorGate && !e.status.startsWith('BLOCKED_') && e.status !== AGENT_STATUS.UNVERIFIED,
  );

  const withSourceReference = evaluated.filter((e) => isNonEmptyString(e.sourceReference)).length;
  const withToolResultId = evaluated.filter((e) => isNonEmptyString(e.toolResultId)).length;

  const ok =
    evaluated.length === expected &&
    accepted.length === expected &&
    failed.length === 0 &&
    blocked.length === 0 &&
    unverified.length === 0 &&
    withSourceReference === expected &&
    withToolResultId === expected;

  return {
    ok,
    totalAgents: evaluated.length,
    expected,
    acceptedBySeniorGate: accepted.length,
    failed: failed.length,
    blocked: blocked.length,
    unverified: unverified.length,
    agentsWithSourceReference: withSourceReference,
    agentsWithToolResultId: withToolResultId,
    failures: [...failed, ...blocked, ...unverified]
      .sort((a, b) => (a.agentNumber ?? 0) - (b.agentNumber ?? 0))
      .map((e) => ({ agentNumber: e.agentNumber, agentId: e.agentId, status: e.status, rejectionReasons: e.rejectionReasons })),
    evaluated,
  };
}
