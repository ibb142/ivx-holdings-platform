import { requestIVXAIText } from '../ivx-ai-runtime';
import type { IVXFactoryOperation, IVXFactoryOperationKind } from './ivx-autonomous-coder-factory';

const FACTORY_OPERATION_KINDS: ReadonlySet<IVXFactoryOperationKind> = new Set([
  'create_directory',
  'create_module',
  'install_dependency',
  'run_supabase_migration',
  'run_build',
  'create_tool',
  'upgrade_self',
]);

const SAFE_FACTORY_ROOTS = new Set(['backend', 'expo', 'apps', 'modules', 'tools', 'docs']);
const FORBIDDEN_PATH_PARTS = new Set(['.git', '.rork', 'node_modules', '.expo', 'dist', 'build', 'coverage']);
const MAX_OPERATIONS = 24;
const MAX_FILES_PER_MODULE = 48;
const MAX_FILE_CONTENT_CHARS = 120_000;

export type IVXFactoryPlan = {
  operations: IVXFactoryOperation[];
  planner: 'ivx_ai';
  rejectedOperations: string[];
};

export type IVXFactoryPlannerCaller = (system: string, prompt: string) => Promise<string>;

function cleanJsonText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const path = value.trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.includes('..')) return false;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0 || !SAFE_FACTORY_ROOTS.has(parts[0]!)) return false;
  return !parts.some((part) => FORBIDDEN_PATH_PARTS.has(part));
}

function explicitPermissionForKind(goal: string, kind: IVXFactoryOperationKind): boolean {
  const normalized = goal.toLowerCase();
  if (kind === 'run_supabase_migration') {
    return /\b(database|supabase|schema|migration|table|column|index|rls|sql)\b/.test(normalized);
  }
  if (kind === 'run_build') {
    return /\b(apk|aab|ipa|web build|build artifact|release build|compile|build the app)\b/.test(normalized);
  }
  if (kind === 'create_tool') {
    return /\b(create|build|add)\b.{0,30}\btool\b/.test(normalized);
  }
  if (kind === 'upgrade_self') {
    return /\b(upgrade|extend|add)\b.{0,40}\b(self|capability|capabilities|autonomous coder|factory engine)\b/.test(normalized);
  }
  return true;
}

function normalizeOperation(raw: unknown, goal: string): IVXFactoryOperation | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind as IVXFactoryOperationKind : null;
  if (!kind || !FACTORY_OPERATION_KINDS.has(kind) || !explicitPermissionForKind(goal, kind)) return null;

  const reason = typeof record.reason === 'string' && record.reason.trim()
    ? record.reason.trim().slice(0, 1000)
    : `Factory operation for owner goal: ${goal.slice(0, 240)}`;

  if (kind === 'create_directory') {
    if (!isSafeRelativePath(record.target)) return null;
    return { kind, target: record.target.trim(), reason };
  }

  if (kind === 'create_module') {
    const files = Array.isArray(record.files) ? record.files : [];
    const normalizedFiles = files
      .slice(0, MAX_FILES_PER_MODULE)
      .map((file) => {
        if (!file || typeof file !== 'object') return null;
        const fileRecord = file as Record<string, unknown>;
        if (!isSafeRelativePath(fileRecord.path) || typeof fileRecord.content !== 'string') return null;
        if (fileRecord.content.length > MAX_FILE_CONTENT_CHARS) return null;
        return { path: fileRecord.path.trim(), content: fileRecord.content };
      })
      .filter((file): file is { path: string; content: string } => file !== null);
    if (normalizedFiles.length === 0) return null;
    const target = isSafeRelativePath(record.target) ? record.target.trim() : undefined;
    return { kind, target, files: normalizedFiles, reason };
  }

  if (kind === 'install_dependency') {
    const dependency = record.dependency && typeof record.dependency === 'object'
      ? record.dependency as Record<string, unknown>
      : null;
    const name = typeof dependency?.name === 'string' ? dependency.name.trim() : '';
    if (!name || !/^[a-zA-Z0-9@._/-]+$/.test(name)) return null;
    const version = typeof dependency?.version === 'string' ? dependency.version.trim() : undefined;
    const packageJsonPath = typeof dependency?.packageJsonPath === 'string'
      ? dependency.packageJsonPath.trim()
      : undefined;
    if (packageJsonPath && !isSafeRelativePath(packageJsonPath)) return null;
    return { kind, dependency: { name, version, packageJsonPath }, reason };
  }

  if (kind === 'run_supabase_migration') {
    const sql = typeof record.sql === 'string' ? record.sql.trim() : '';
    if (!sql) return null;
    const migrationName = typeof record.migrationName === 'string' && record.migrationName.trim()
      ? record.migrationName.trim().slice(0, 120)
      : 'owner-chat-factory-migration';
    return { kind, sql, migrationName, reason };
  }

  if (kind === 'run_build') {
    const buildTarget = record.buildTarget;
    if (buildTarget !== 'apk' && buildTarget !== 'aab' && buildTarget !== 'ipa' && buildTarget !== 'web') return null;
    return { kind, buildTarget, reason };
  }

  if (kind === 'create_tool') {
    const tool = record.tool && typeof record.tool === 'object' ? record.tool as Record<string, unknown> : null;
    if (!tool) return null;
    const name = typeof tool.name === 'string' ? tool.name.trim() : '';
    const version = typeof tool.version === 'string' ? tool.version.trim() : '1.0.0';
    const capability = typeof tool.capability === 'string' ? tool.capability.trim() : '';
    if (!name || !capability) return null;
    return {
      kind,
      tool: {
        name,
        version,
        capability,
        handlerName: typeof tool.handlerName === 'string' ? tool.handlerName.trim() : undefined,
        registeredAt: new Date().toISOString(),
        approvedBy: 'owner-chat',
      },
      reason,
    };
  }

  if (kind === 'upgrade_self') {
    const capability = record.capability && typeof record.capability === 'object'
      ? record.capability as Record<string, unknown>
      : null;
    if (!capability) return null;
    const id = typeof capability.id === 'string' ? capability.id.trim() : '';
    const label = typeof capability.label === 'string' ? capability.label.trim() : '';
    const version = typeof capability.version === 'string' ? capability.version.trim() : '1.0.0';
    const operations = Array.isArray(capability.operations)
      ? capability.operations.filter((value): value is IVXFactoryOperationKind => typeof value === 'string' && FACTORY_OPERATION_KINDS.has(value as IVXFactoryOperationKind))
      : [];
    if (!id || !label) return null;
    return { kind, capability: { id, label, version, operations, addedAt: new Date().toISOString() }, reason };
  }

  return null;
}

export function parseFactoryPlan(goal: string, rawText: string): IVXFactoryPlan {
  const parsed = JSON.parse(cleanJsonText(rawText)) as { operations?: unknown[] };
  const rawOperations = Array.isArray(parsed.operations) ? parsed.operations.slice(0, MAX_OPERATIONS) : [];
  const operations: IVXFactoryOperation[] = [];
  const rejectedOperations: string[] = [];
  for (const raw of rawOperations) {
    const normalized = normalizeOperation(raw, goal);
    if (normalized) operations.push(normalized);
    else rejectedOperations.push(JSON.stringify(raw).slice(0, 500));
  }
  if (operations.length === 0) {
    throw new Error('Factory planner returned no executable operations.');
  }
  return { operations, planner: 'ivx_ai', rejectedOperations };
}

export async function planFactoryOperationsFromGoal(
  goal: string,
  llmCaller?: IVXFactoryPlannerCaller,
): Promise<IVXFactoryPlan> {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error('Factory planning requires a non-empty owner goal.');

  const system = [
    'You are IVX IA Senior Developer Factory Planner.',
    'Return STRICT JSON only with shape {"operations":[...]}.',
    'You are planning REAL executable operations for the IVX factory engine.',
    'Allowed kinds: create_directory, create_module, install_dependency, run_supabase_migration, run_build, create_tool, upgrade_self.',
    'For a new app/module, create the actual source files with create_module; do not return narrative placeholders.',
    'All file paths must be repo-relative and begin with backend/, expo/, apps/, modules/, tools/, or docs/.',
    'Never write .git, .rork, node_modules, build, dist, coverage, secrets, credentials, or environment values.',
    'Use run_supabase_migration ONLY when the owner explicitly requests database/schema/Supabase changes.',
    'Use run_build ONLY when the owner explicitly asks for a build artifact or compile/release build.',
    'Use create_tool or upgrade_self ONLY when explicitly requested.',
    'Keep the operation set minimal but complete enough to create a working implementation.',
  ].join('\n');
  const prompt = `OWNER GOAL:\n${trimmedGoal}\n\nCreate the executable factory plan now.`;

  const text = llmCaller
    ? await llmCaller(system, prompt)
    : (await requestIVXAIText({
        module: 'ivx-factory-chat-planner',
        requestId: `factory-plan-${Date.now()}`,
        system,
        prompt,
        maxOutputTokens: 12000,
      })).text;

  return parseFactoryPlan(trimmedGoal, text);
}
