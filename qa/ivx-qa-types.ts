/**
 * IVX QA System — Shared Types
 * Used by the unified QA runner, evidence generator, and critical file manifest.
 */

export type TestCategory =
  | 'conversation'
  | 'intent_routing'
  | 'context'
  | 'owner_memory'
  | 'approval'
  | 'autonomous'
  | 'worker'
  | 'code_generation'
  | 'patch_validation'
  | 'typecheck'
  | 'unit_tests'
  | 'regression'
  | 'deployment'
  | 'restart_recovery'
  | 'zombie_recovery'
  | 'owner_auth'
  | 'member_registration'
  | 'investor_verification'
  | 'buyers'
  | 'jv_deals'
  | 'tokenized_users'
  | 'reels'
  | 'landing_page'
  | 'supabase'
  | 'render'
  | 'github'
  | 'security'
  | 'performance';

export type TestStatus = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';

export interface QATestResult {
  testId: string;
  category: TestCategory;
  name: string;
  expected: string;
  actual: string;
  status: TestStatus;
  timestamp: string;
  commitSha: string;
  evidenceRef: string;
  durationMs: number;
  errorDetail?: string;
}

export interface QARunSummary {
  runId: string;
  generatedAt: string;
  commitSha: string;
  productionSha: string;
  environment: string;
  runnerVersion: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  results: QATestResult[];
  evidenceHash: string;
}

export interface CriticalFile {
  path: string;
  capability: string;
  requiredByTests: string[];
  protectionLevel: 'P0' | 'P1' | 'P2';
  description: string;
}

export interface EvidenceArtifact {
  name: string;
  generatedAt: string;
  commitSha: string;
  environment: string;
  runnerVersion: string;
  result: TestStatus;
  sourceCommand: string;
  evidenceHash: string;
  data: Record<string, unknown>;
}

export const RUNNER_VERSION = 'ivx-qa-v1.0.0';
export const PRODUCTION_API = 'https://api.ivxholding.com';
export const LANDING_URL = 'https://ivxholding.com';
