/**
 * IVX Critical File Protection Manifest
 * Declares every critical capability file. CI fails if any are deleted.
 */
import type { CriticalFile } from './ivx-qa-types';

export const CRITICAL_FILES: CriticalFile[] = [
  // P0 — Core conversation & routing
  { path: 'backend/api/ivx-owner-ai.ts', capability: 'IVX IA router + conversation state machine', protectionLevel: 'P0', description: 'Main owner AI chat endpoint — routes intents, preserves context, executes read-only and deployment actions', requiredByTests: ['QA-CONV-001', 'QA-CONV-002', 'QA-ROUTE-001', 'QA-MEM-001', 'QA-AUTH-001'] },
  { path: 'backend/services/ivx-owner-conversation-state.ts', capability: 'Conversation state machine + owner memory', protectionLevel: 'P0', description: 'Multi-turn context, pending actions, approval/denial detection, memory recall', requiredByTests: ['QA-CONV-002', 'QA-CONV-003', 'QA-MEM-001', 'QA-MEM-002'] },
  { path: 'backend/services/ivx-senior-engineer-persona.ts', capability: 'Senior engineer persona prompt builder', protectionLevel: 'P0', description: 'V5 persona with full owner-authorized access, live context injection', requiredByTests: ['QA-CONV-001'] },
  { path: 'backend/services/ivx-property-queries.ts', capability: 'Property/database query engine', protectionLevel: 'P0', description: 'Supabase property queries with table priority (jv_deals first)', requiredByTests: ['QA-DB-001', 'QA-DB-002', 'QA-DB-003'] },
  { path: 'backend/hono.ts', capability: 'Main API server + route registry', protectionLevel: 'P0', description: 'Hono server with all route registrations, health endpoint, health markers', requiredByTests: ['QA-DEPLOY-001', 'QA-DEPLOY-002', 'QA-SEC-001'] },

  // P0 — Autonomous developer
  { path: 'backend/services/ivx-autonomous-coder.ts', capability: 'Autonomous LLM patch engine', protectionLevel: 'P0', description: 'LLM-powered code generation, patch application, iterative revision', requiredByTests: ['QA-CODE-001', 'QA-CODE-002', 'QA-PATCH-001'] },
  { path: 'backend/api/ivx-senior-developer-worker.ts', capability: 'Senior developer worker queue', protectionLevel: 'P0', description: 'Durable worker that executes autonomous coding tasks end-to-end', requiredByTests: ['QA-WORK-001', 'QA-WORK-002', 'QA-CODE-001'] },

  // P0 — Deployment
  { path: 'backend/api/ivx-developer-deploy-control.ts', capability: 'Deployment control endpoint', protectionLevel: 'P0', description: 'Owner-gated deploy actions: render_trigger_deploy, github_commit_multi_file, status queries', requiredByTests: ['QA-DEPLOY-001', 'QA-DEPLOY-002'] },

  // P1 — QA & security
  { path: 'qa/ivx-qa-runner.ts', capability: 'Unified QA runner', protectionLevel: 'P1', description: 'Authoritative QA test matrix runner with stable test IDs', requiredByTests: ['QA-SYSTEM-001'] },
  { path: 'qa/ivx-qa-types.ts', capability: 'QA shared types', protectionLevel: 'P1', description: 'TypeScript types for QA results, evidence artifacts, critical files', requiredByTests: ['QA-SYSTEM-001'] },
  { path: 'qa/ivx-critical-files.ts', capability: 'Critical file manifest', protectionLevel: 'P1', description: 'This file — declares all protected capability files', requiredByTests: ['QA-SYSTEM-002'] },
  { path: 'qa/ivx-evidence-generator.ts', capability: 'Fresh evidence generator', protectionLevel: 'P1', description: 'Generates evidence package from current production state', requiredByTests: ['QA-EVID-001'] },

  // P1 — Auth & member systems
  { path: 'backend/api/ivx-auth-qa-scheduler.ts', capability: 'Auth QA scheduler', protectionLevel: 'P1', description: 'Scheduled auth certification runs', requiredByTests: ['QA-AUTH-002'] },
  { path: 'backend/services/ivx-qa-chat-reporter.ts', capability: 'QA chat reporter', protectionLevel: 'P1', description: 'Reports QA results into owner chat', requiredByTests: ['QA-CONV-004'] },
  { path: 'backend/services/ivx-senior-developer-qa-runtime.ts', capability: 'Senior developer QA runtime', protectionLevel: 'P1', description: 'Runtime QA checks for senior developer capabilities', requiredByTests: ['QA-WORK-003'] },

  // P1 — Web QA
  { path: 'backend/services/chat-web-qa-runner.ts', capability: 'Web QA runner', protectionLevel: 'P1', description: 'Playwright-based cross-viewport web QA (restored from git history)', requiredByTests: ['QA-LANDING-001', 'QA-LANDING-002'] },

  // P2 — Tests
  { path: 'backend/api/ivx-senior-developer-worker.test.ts', capability: 'Worker test suite', protectionLevel: 'P2', description: 'Unit tests for senior developer worker (restored from git history)', requiredByTests: ['QA-WORK-001'] },
  { path: 'backend/ivx-auth-certification.test.ts', capability: 'Auth certification tests', protectionLevel: 'P2', description: 'Authentication certification test suite', requiredByTests: ['QA-AUTH-001'] },
  { path: 'backend/ivx-autonomous-coder.test.ts', capability: 'Autonomous coder tests', protectionLevel: 'P2', description: 'Unit tests for LLM patch engine', requiredByTests: ['QA-CODE-001'] },

  // P0 — Worker access (restored V6.17)
  { path: 'backend/api/ivx-worker-access.ts', capability: 'Worker access control', protectionLevel: 'P0', description: 'Access control for senior developer worker API (restored from git history)', requiredByTests: ['QA-WORK-001'] },
  { path: 'backend/services/ivx-worker-access-token.ts', capability: 'Worker access token service', protectionLevel: 'P0', description: 'Token generation/validation for worker access (restored from git history)', requiredByTests: ['QA-WORK-001'] },
];

export const P0_FILES = CRITICAL_FILES.filter(f => f.protectionLevel === 'P0');
export const P1_FILES = CRITICAL_FILES.filter(f => f.protectionLevel === 'P1');
export const P2_FILES = CRITICAL_FILES.filter(f => f.protectionLevel === 'P2');

export function getCriticalFile(path: string): CriticalFile | undefined {
  return CRITICAL_FILES.find(f => f.path === path);
}

export function isCriticalFile(path: string): boolean {
  return CRITICAL_FILES.some(f => f.path === path);
}
