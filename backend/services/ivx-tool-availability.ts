/**
 * IVX Tool Availability Checker.
 *
 * Step 3 of the autonomous lifecycle: BEFORE planning or executing a task, IVX
 * must verify the real tools/access it actually has. This module introspects the
 * runtime environment + always-on in-process capabilities and reports, per tool:
 * whether it is available, the lifecycle steps that depend on it, the env it
 * requires, exactly what is missing, and an honest detail line.
 *
 * It NEVER returns a secret value — only presence/absence of the configuring env.
 * Pure + deterministic apart from reading `process.env`, so it is unit-testable
 * by injecting an env snapshot.
 */

export const IVX_TOOL_AVAILABILITY_MARKER = 'ivx-tool-availability-2026-06-01';

export type ToolCategory =
  | 'execution'
  | 'deploy'
  | 'data'
  | 'ai'
  | 'storage'
  | 'verification';

export type ToolAvailability = {
  /** Stable tool id. */
  tool: string;
  /** Human-readable tool name. */
  label: string;
  category: ToolCategory;
  available: boolean;
  /** Lifecycle steps that depend on this tool. */
  requiredForSteps: string[];
  /** Env vars that configure this tool (presence-checked, never read for value). */
  requiredEnv: string[];
  /** The subset of `requiredEnv` that is missing/empty. */
  missingEnv: string[];
  /** Honest one-line status. */
  detail: string;
};

export type ToolAvailabilityReport = {
  marker: string;
  generatedAt: string;
  total: number;
  available: number;
  unavailable: number;
  tools: ToolAvailability[];
  /** Lifecycle step names that are blocked because a required tool is missing. */
  blockedSteps: string[];
  /** True when every tool needed for autonomous deploy+verify is present. */
  canExecuteEndToEnd: boolean;
};

type EnvSnapshot = Record<string, string | undefined>;

function present(env: EnvSnapshot, name: string): boolean {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function missingOf(env: EnvSnapshot, names: string[]): string[] {
  return names.filter((name) => !present(env, name));
}

type ToolSpec = {
  tool: string;
  label: string;
  category: ToolCategory;
  requiredForSteps: string[];
  requiredEnv: string[];
  /** Tools backed by in-process capability (filesystem / tsx) are always available. */
  alwaysAvailable?: boolean;
  detailWhenAvailable: string;
  detailWhenMissing: string;
};

const TOOL_SPECS: ToolSpec[] = [
  {
    tool: 'ai_gateway',
    label: 'AI reasoning gateway',
    category: 'ai',
    requiredForSteps: ['classify intent', 'create execution plan', 'execute'],
    requiredEnv: ['IVX_AI_GATEWAY_KEY'],
    detailWhenAvailable: 'AI gateway key present — IVX can reason, plan, and synthesize.',
    detailWhenMissing: 'IVX_AI_GATEWAY_KEY missing — reasoning/synthesis falls back to deterministic routing only.',
  },
  {
    tool: 'test_runner',
    label: 'Test / validation runner',
    category: 'verification',
    requiredForSteps: ['run tests', 'detect failure'],
    requiredEnv: [],
    alwaysAvailable: true,
    detailWhenAvailable: 'In-process tsx import-smoke + typecheck/lint suites run without external deps.',
    detailWhenMissing: '',
  },
  {
    tool: 'execution_trace',
    label: 'Execution trace + evidence store',
    category: 'verification',
    requiredForSteps: ['return proof'],
    requiredEnv: [],
    alwaysAvailable: true,
    detailWhenAvailable: 'Durable execution-trace + evidence-gate store (filesystem) — every action is traceable.',
    detailWhenMissing: '',
  },
  {
    tool: 'self_heal',
    label: 'Self-heal / fix-and-verify loop',
    category: 'execution',
    requiredForSteps: ['execute', 'retry or self-heal'],
    requiredEnv: [],
    alwaysAvailable: true,
    detailWhenAvailable: 'Self-heal cycle (prioritize → fix safely → test → verify → rollback → resume) is wired in-process.',
    detailWhenMissing: '',
  },
  {
    tool: 'github_write',
    label: 'GitHub commit / branch / PR / merge',
    category: 'deploy',
    requiredForSteps: ['execute', 'deploy if allowed'],
    requiredEnv: ['GITHUB_TOKEN', 'GITHUB_REPO_URL'],
    detailWhenAvailable: 'GitHub write lifecycle available (branch → commit → PR → merge → rollback tag).',
    detailWhenMissing: 'GITHUB_TOKEN / GITHUB_REPO_URL missing — code application + push is blocked.',
  },
  {
    tool: 'render_deploy',
    label: 'Render deploy + rollback control',
    category: 'deploy',
    requiredForSteps: ['deploy if allowed', 'verify production', 'roll back if needed'],
    requiredEnv: ['RENDER_API_KEY', 'RENDER_SERVICE_ID'],
    detailWhenAvailable: 'Render API control available — direct deploy + one-call rollback.',
    detailWhenMissing: 'RENDER_API_KEY / RENDER_SERVICE_ID missing — push-to-main still auto-deploys, but direct deploy/rollback control is unavailable.',
  },
  {
    tool: 'supabase_actions',
    label: 'Supabase data actions',
    category: 'data',
    requiredForSteps: ['execute'],
    requiredEnv: ['SUPABASE_SERVICE_ROLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL'],
    detailWhenAvailable: 'Supabase migration + read/write over HTTPS (ivx_exec_sql RPC + PostgREST) available.',
    detailWhenMissing: 'SUPABASE_SERVICE_ROLE_KEY / EXPO_PUBLIC_SUPABASE_URL missing — DB actions are blocked.',
  },
  {
    tool: 'deliverable_pipeline',
    label: 'Deliverable artifact pipeline (PDF/CSV → storage → signed URL)',
    category: 'storage',
    requiredForSteps: ['execute', 'return proof'],
    requiredEnv: ['SUPABASE_SERVICE_ROLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL'],
    detailWhenAvailable: 'PDF/CSV generation + Supabase Storage upload + signed-URL + download verification available.',
    detailWhenMissing: 'SUPABASE_SERVICE_ROLE_KEY / EXPO_PUBLIC_SUPABASE_URL missing — real downloadable deliverables cannot be produced (placeholder links stay blocked).',
  },
  {
    tool: 'owner_auth_guard',
    label: 'Owner authorization guard',
    category: 'verification',
    requiredForSteps: ['receive task', 'request approval'],
    requiredEnv: ['IVX_OWNER_REGISTRATION_EMAILS'],
    detailWhenAvailable: 'Owner allowlist configured — privileged actions are gated to the owner.',
    detailWhenMissing: 'IVX_OWNER_REGISTRATION_EMAILS missing — owner allowlist not configured (auth promotion will reject).',
  },
];

/**
 * Check tool/access availability from an env snapshot (defaults to process.env).
 * Read-only; returns presence-only signals — never a secret value.
 */
export function checkToolAvailability(env: EnvSnapshot = process.env): ToolAvailabilityReport {
  const tools: ToolAvailability[] = TOOL_SPECS.map((spec) => {
    const missingEnv = spec.alwaysAvailable ? [] : missingOf(env, spec.requiredEnv);
    const available = spec.alwaysAvailable === true || missingEnv.length === 0;
    return {
      tool: spec.tool,
      label: spec.label,
      category: spec.category,
      available,
      requiredForSteps: spec.requiredForSteps,
      requiredEnv: spec.requiredEnv,
      missingEnv,
      detail: available ? spec.detailWhenAvailable : spec.detailWhenMissing,
    };
  });

  const blockedSteps = Array.from(
    new Set(
      tools
        .filter((t) => !t.available)
        .flatMap((t) => t.requiredForSteps),
    ),
  );

  const availableCount = tools.filter((t) => t.available).length;
  // End-to-end autonomy needs: AI, test runner, self-heal, execution trace, and at
  // least one deploy path (github_write OR render_deploy — push-to-main still works).
  const deployPathReady = tools.some((t) => (t.tool === 'github_write' || t.tool === 'render_deploy') && t.available);
  const coreReady = tools
    .filter((t) => ['ai_gateway', 'test_runner', 'self_heal', 'execution_trace'].includes(t.tool))
    .every((t) => t.available);

  return {
    marker: IVX_TOOL_AVAILABILITY_MARKER,
    generatedAt: new Date().toISOString(),
    total: tools.length,
    available: availableCount,
    unavailable: tools.length - availableCount,
    tools,
    blockedSteps,
    canExecuteEndToEnd: coreReady && deployPathReady,
  };
}

/** True when a specific tool id is available right now. */
export function isToolAvailable(tool: string, env: EnvSnapshot = process.env): boolean {
  return checkToolAvailability(env).tools.find((t) => t.tool === tool)?.available ?? false;
}
