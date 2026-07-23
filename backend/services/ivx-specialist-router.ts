/**
 * IVX Specialist Agent Router — Phase 7
 *
 * 12 internal specialists. One owner-facing conversation, one primary task ID.
 * Specialists operate as internal workers with limited permissions.
 * No specialist may declare the complete task VERIFIED.
 * Only the Proof Verifier can recommend VERIFIED.
 * Only the orchestrator returns the final answer.
 */

export type IVXSpecialistRole =
  | 'architect'
  | 'senior_developer'
  | 'mobile_engineer'
  | 'backend_engineer'
  | 'database_engineer'
  | 'devops_engineer'
  | 'qa_engineer'
  | 'security_engineer'
  | 'product_analyst'
  | 'investor_analyst'
  | 'proof_verifier'
  | 'response_editor';

export type IVXSpecialist = {
  role: IVXSpecialistRole;
  name: string;
  capabilities: string[];
  canWriteCode: boolean;
  canDeploy: boolean;
  canVerify: boolean; // Only proof_verifier
  canReturnFinalAnswer: boolean; // Only orchestrator (not a specialist)
  permissions: string[];
};

export const SPECIALISTS: Record<IVXSpecialistRole, IVXSpecialist> = {
  architect: {
    role: 'architect',
    name: 'IVX Architect',
    capabilities: ['system design', 'architecture review', 'planning', 'risk assessment', 'dependency analysis'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'read_infrastructure', 'create_plan'],
  },
  senior_developer: {
    role: 'senior_developer',
    name: 'IVX Senior Developer',
    capabilities: ['code generation', 'debugging', 'refactoring', 'code inspection', 'test generation'],
    canWriteCode: true,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'write_code', 'run_tests', 'commit_code'],
  },
  mobile_engineer: {
    role: 'mobile_engineer',
    name: 'IVX Mobile Engineer',
    capabilities: ['Android APK build', 'iOS build', 'mobile UI', 'React Native', 'Expo'],
    canWriteCode: true,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'write_code', 'build_apk'],
  },
  backend_engineer: {
    role: 'backend_engineer',
    name: 'IVX Backend Engineer',
    capabilities: ['API design', 'backend logic', 'middleware', 'routing', 'server-side validation'],
    canWriteCode: true,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'write_code', 'run_tests'],
  },
  database_engineer: {
    role: 'database_engineer',
    name: 'IVX Database Engineer',
    capabilities: ['SQL', 'migrations', 'schema design', 'RLS policies', 'constraints', 'indexing'],
    canWriteCode: true,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_schema', 'write_migrations', 'execute_sql'],
  },
  devops_engineer: {
    role: 'devops_engineer',
    name: 'IVX DevOps Engineer',
    capabilities: ['deployment', 'CI/CD', 'CloudFront', 'S3', 'Render', 'infrastructure'],
    canWriteCode: false,
    canDeploy: true,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['deploy', 'invalidate_cdn', 'upload_s3', 'read_logs'],
  },
  qa_engineer: {
    role: 'qa_engineer',
    name: 'IVX QA Engineer',
    capabilities: ['test execution', 'regression testing', 'integration testing', 'test planning'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['run_tests', 'read_code', 'report_bugs'],
  },
  security_engineer: {
    role: 'security_engineer',
    name: 'IVX Security Engineer',
    capabilities: ['security audit', 'vulnerability assessment', 'RLS review', 'secret scanning', 'injection prevention'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'read_infrastructure', 'report_vulnerabilities'],
  },
  product_analyst: {
    role: 'product_analyst',
    name: 'IVX Product Analyst',
    capabilities: ['user flow analysis', 'feature prioritization', 'product metrics', 'UX review'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_code', 'read_metrics', 'analyze_flows'],
  },
  investor_analyst: {
    role: 'investor_analyst',
    name: 'IVX Investor Analyst',
    capabilities: ['deal analysis', 'ROI calculation', 'investor qualification', 'risk classification', 'capital requirements'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['read_deals', 'read_investors', 'calculate_metrics'],
  },
  proof_verifier: {
    role: 'proof_verifier',
    name: 'IVX Proof Verifier',
    capabilities: ['live verification', 'SHA matching', 'endpoint probing', 'evidence validation', 'uncertainty labeling'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: true, // ONLY this specialist can recommend VERIFIED
    canReturnFinalAnswer: false,
    permissions: ['verify_live', 'check_sha', 'probe_endpoints', 'label_uncertainty'],
  },
  response_editor: {
    role: 'response_editor',
    name: 'IVX Response Editor',
    capabilities: ['response formatting', 'clarity editing', 'evidence inclusion', 'duplicate suppression'],
    canWriteCode: false,
    canDeploy: false,
    canVerify: false,
    canReturnFinalAnswer: false,
    permissions: ['format_response', 'edit_clarity'],
  },
};

export type IVXSpecialistAssignment = {
  specialist: IVXSpecialist;
  task: string;
  taskNodeId: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'blocked' | 'failed';
  result?: string;
  canDeclareVerified: boolean;
};

export function assignSpecialist(role: IVXSpecialistRole, task: string, taskNodeId: string): IVXSpecialistAssignment {
  const specialist = SPECIALISTS[role];
  return {
    specialist,
    task,
    taskNodeId,
    status: 'assigned',
    canDeclareVerified: specialist.canVerify,
  };
}

export function canSpecialistDeclareVerified(role: IVXSpecialistRole): boolean {
  return SPECIALISTS[role].canVerify;
}

export function getSpecialistsForIntent(intentType: string, complexity: string): IVXSpecialistRole[] {
  const roles: IVXSpecialistRole[] = [];

  switch (intentType) {
    case 'bug_fix':
      roles.push('senior_developer', 'qa_engineer');
      if (complexity === 'complex') roles.push('architect', 'security_engineer');
      roles.push('proof_verifier');
      break;
    case 'feature':
    case 'module':
      roles.push('architect', 'senior_developer', 'qa_engineer');
      if (complexity === 'complex') roles.push('security_engineer', 'devops_engineer');
      roles.push('proof_verifier');
      break;
    case 'database':
      roles.push('database_engineer', 'qa_engineer');
      roles.push('proof_verifier');
      break;
    case 'deployment':
      roles.push('devops_engineer');
      roles.push('proof_verifier');
      break;
    case 'destructive':
      roles.push('security_engineer', 'devops_engineer');
      roles.push('proof_verifier');
      break;
    case 'business_analysis':
    case 'investor_workflow':
      roles.push('investor_analyst', 'product_analyst');
      break;
    case 'qa':
      roles.push('qa_engineer', 'proof_verifier');
      break;
    default:
      if (complexity === 'complex') roles.push('architect');
      roles.push('senior_developer');
      break;
  }

  // Always add response editor
  roles.push('response_editor');

  return roles;
}

export const IVX_SPECIALIST_ROUTER_MARKER = 'ivx-specialist-router-2026-07-23-v1';
