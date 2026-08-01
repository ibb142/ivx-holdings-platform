import { createHash } from 'node:crypto';

/**
 * Structured engineering contract used by the IVX senior-developer runtime.
 * It turns an unstructured owner request into a bounded, auditable execution
 * brief before code mutation, testing, or deployment can begin.
 */
export const IVX_SENIOR_DEVELOPER_CAPABILITY_MARKER = 'ivx-senior-developer-capability-engine-v1-2026-08-01';

export type IVXSeniorDeveloperCapability =
  | 'vague_goal_code_generation'
  | 'log_driven_debugging'
  | 'feature_architecture'
  | 'novel_problem_adaptation'
  | 'continuous_delivery';

export type IVXEngineeringEvidenceKind =
  | 'repository_inspection'
  | 'log_signal'
  | 'hypothesis'
  | 'implementation'
  | 'test_result'
  | 'typecheck_result'
  | 'commit'
  | 'deployment'
  | 'production_verification';

export type IVXEngineeringEvidenceRequirement = {
  kind: IVXEngineeringEvidenceKind;
  required: boolean;
  reason: string;
};

export type IVXSeniorDeveloperTaskContract = {
  marker: typeof IVX_SENIOR_DEVELOPER_CAPABILITY_MARKER;
  goal: string;
  taskId: string;
  capabilities: IVXSeniorDeveloperCapability[];
  summary: string;
  assumptions: string[];
  discoveryQuestions: string[];
  executionStages: string[];
  hypothesis: {
    symptom: string | null;
    likelyCauses: string[];
    falsificationSignals: string[];
  };
  architecture: {
    boundaries: string[];
    interfaces: string[];
    risks: string[];
  };
  adaptation: {
    isNovel: boolean;
    approach: string;
    fallback: string;
  };
  evidenceRequirements: IVXEngineeringEvidenceRequirement[];
  requiresOwnerApprovalForMutation: true;
  requiresOwnerApprovalForDeployment: true;
};

function normalized(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stableTaskId(goal: string): string {
  return createHash('sha256').update(goal.trim()).digest('hex').slice(0, 16);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Identifies the concrete engineering modes an owner request requires. */
export function classifySeniorDeveloperCapabilities(goal: string): IVXSeniorDeveloperCapability[] {
  const text = normalized(goal);
  const capabilities: IVXSeniorDeveloperCapability[] = [];
  const debug = /\b(debug|diagnos|root cause|logs?|trace|stack trace|crash|error|failure|broken|failing|timeout|exception)\b/.test(text);
  const architecture = /\b(architect|architecture|end[- ]to[- ]end|new feature|new system|platform|workflow|design)\b/.test(text);
  const delivery = /\b(build|test|verify|commit|deploy|ship|production|release|continuous)\b/.test(text);
  const novel = /\b(novel|unfamiliar|unknown|never (?:seen|built)|new kind|not designed)\b/.test(text);
  const vagueBuild = /\b(build|create|make|implement|add|generate|write)\b/.test(text)
    && !/\bfrom ['"`].+['"`] to ['"`].+['"`]\b/.test(text);

  if (vagueBuild) capabilities.push('vague_goal_code_generation');
  if (debug) capabilities.push('log_driven_debugging');
  if (architecture) capabilities.push('feature_architecture');
  if (novel) capabilities.push('novel_problem_adaptation');
  if (delivery || capabilities.length === 0) capabilities.push('continuous_delivery');
  return unique(capabilities);
}

function findSymptom(goal: string): string | null {
  const match = goal.match(/(?:because|when|where|that|is|are)\s+([^.!?]{4,180}(?:crash|error|fail|broken|slow|stuck|timeout|blank|loading)[^.!?]*)/i);
  if (match?.[1]) return match[1].trim();
  const explicit = goal.match(/\b(?:crash|error|failure|timeout|blank screen|stuck loading|not loading)\b[^.!?]*/i);
  return explicit?.[0]?.trim() ?? null;
}

/**
 * Creates a deterministic task contract. The runtime stores this contract with
 * the execution proof, so a result can be audited without trusting narrative.
 */
export function buildSeniorDeveloperTaskContract(goal: string): IVXSeniorDeveloperTaskContract {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error('A goal is required to build an engineering task contract.');
  const capabilities = classifySeniorDeveloperCapabilities(trimmedGoal);
  const hasDebug = capabilities.includes('log_driven_debugging');
  const hasArchitecture = capabilities.includes('feature_architecture');
  const hasNovel = capabilities.includes('novel_problem_adaptation');
  const hasVagueBuild = capabilities.includes('vague_goal_code_generation');
  const symptom = findSymptom(trimmedGoal);

  const assumptions = [
    'The current repository is the source of truth for implementation decisions.',
    'No secret-bearing file may be read into an execution report or modified by an automated patch.',
  ];
  if (hasVagueBuild) assumptions.push('Unspecified product details will be expressed as explicit assumptions and implemented as the smallest testable vertical slice.');
  if (hasDebug) assumptions.push('A symptom is not treated as a root cause until repository evidence or runtime logs falsify competing explanations.');
  if (hasNovel) assumptions.push('Novel requests are decomposed into known primitives before implementation; unsupported dependencies are surfaced rather than invented.');

  const discoveryQuestions = [
    'Which existing files, routes, and tests own the affected behavior?',
    'What is the smallest observable acceptance condition for this task?',
  ];
  if (hasDebug) discoveryQuestions.push('Which log line, stack frame, request trace, or failing assertion distinguishes the leading hypothesis from alternatives?');
  if (hasArchitecture) discoveryQuestions.push('Which data boundary, API contract, client state, and rollback path are required for the feature to be complete?');

  const executionStages = [
    'inspect_repository',
    ...(hasDebug ? ['collect_and_normalize_signals', 'form_and_falsify_hypotheses'] : []),
    ...(hasArchitecture ? ['define_interfaces_and_failure_modes'] : []),
    ...(hasVagueBuild ? ['implement_smallest_testable_vertical_slice'] : ['prepare_safe_patch']),
    'run_targeted_tests',
    'run_typecheck_or_build',
    'review_evidence',
    'commit_and_deploy_when_explicitly_approved',
    'verify_live_health_and_requested_commit',
  ];

  const likelyCauses = hasDebug
    ? ['Regression in the owning code path.', 'Invalid or missing runtime configuration.', 'Unexpected external dependency response.', 'Incorrect state or data-shape assumption.']
    : [];
  const falsificationSignals = hasDebug
    ? ['A focused test reproduces the failure.', 'A relevant log or stack trace points to the owning path.', 'A minimal change removes the failure without masking the signal.']
    : [];

  const evidenceRequirements: IVXEngineeringEvidenceRequirement[] = [
    { kind: 'repository_inspection', required: true, reason: 'Implementation choices must be grounded in current source.' },
    { kind: 'implementation', required: true, reason: 'A completion claim requires an actual changed-file record.' },
    { kind: 'test_result', required: true, reason: 'The requested behavior needs a reproducible validation result.' },
    { kind: 'typecheck_result', required: true, reason: 'The changed code must pass the applicable static or build check.' },
    { kind: 'commit', required: true, reason: 'A deployable result must identify the immutable source revision.' },
    { kind: 'deployment', required: true, reason: 'Production claims require a deployment result.' },
    { kind: 'production_verification', required: true, reason: 'A deployment alone does not prove the requested behavior is live.' },
  ];
  if (hasDebug) {
    evidenceRequirements.splice(1, 0,
      { kind: 'log_signal', required: true, reason: 'Debugging requires a real observed signal, not a guessed cause.' },
      { kind: 'hypothesis', required: true, reason: 'The chosen fix must state what evidence would have disproved it.' },
    );
  }

  return {
    marker: IVX_SENIOR_DEVELOPER_CAPABILITY_MARKER,
    goal: trimmedGoal,
    taskId: stableTaskId(trimmedGoal),
    capabilities,
    summary: `Engineering contract for ${capabilities.join(', ')}.`,
    assumptions,
    discoveryQuestions,
    executionStages,
    hypothesis: { symptom, likelyCauses, falsificationSignals },
    architecture: {
      boundaries: hasArchitecture ? ['client presentation', 'owner-authorized API', 'durable data', 'deployment verification'] : ['affected module boundary'],
      interfaces: hasArchitecture ? ['request contract', 'response contract', 'failure contract', 'evidence contract'] : ['existing affected interfaces'],
      risks: ['unsafe broad patch', 'unrelated pre-existing test failures', 'deployment verification timeout'],
    },
    adaptation: {
      isNovel: hasNovel,
      approach: hasNovel ? 'Map the unfamiliar request to repository primitives, validate assumptions with a focused spike, then promote only verified behavior into the patch.' : 'Use existing repository conventions and narrow the task to an observable behavior.',
      fallback: 'Stop before mutation when the repository or evidence contradicts the contract; report the missing evidence and retain the audit trail.',
    },
    evidenceRequirements,
    requiresOwnerApprovalForMutation: true,
    requiresOwnerApprovalForDeployment: true,
  };
}
