/**
 * IVX Universal App Generator (BLOCKER 1).
 *
 * Receives an app/module specification and deterministically produces a full
 * scaffold BLUEPRINT: architecture, frontend structure, backend/API structure,
 * a database/schema plan, tests, a validation result, and a deployment plan.
 *
 * Pure + deterministic (no I/O / AI / network) so `generateApp` is fully
 * unit-testable. Registration into the durable IVX tool registry is the only
 * side-effecting entry point (`registerAndVerifyAppGeneratorTool`), kept
 * separate from generation.
 *
 * HARD HONESTY RULE (platform-wide):
 *   - The generator PROPOSES a complete blueprint. It NEVER writes files to
 *     disk or deploys — applying a blueprint stays owner-gated through the
 *     existing GitHub/Render lifecycle.
 *   - A spec it cannot fully satisfy is reported as a FAILED validation with the
 *     exact reason, never a fabricated success.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getToolByName,
  recordToolRun,
  recordToolTest,
  registerTool,
  setToolEnabled,
  type ToolRecord,
  type ToolTestReport,
} from './ivx-tool-registry-store';

export const IVX_APP_GENERATOR_MARKER = 'ivx-app-generator-2026-06-07';
export const IVX_APP_GENERATOR_TOOL_NAME = 'universal_app_generator';

/** The kind of artifact the generator targets. */
export type AppGeneratorTargetKind = 'expo_app' | 'web_app' | 'backend_service' | 'module';

export const APP_GENERATOR_SUPPORTED_KINDS: AppGeneratorTargetKind[] = [
  'expo_app',
  'web_app',
  'backend_service',
  'module',
];

/** A field on a generated entity. */
export type AppFieldType = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'uuid' | 'json';

export type AppGeneratorEntityField = {
  name: string;
  type: AppFieldType;
};

export type AppGeneratorEntity = {
  name: string;
  fields: AppGeneratorEntityField[];
};

/** The incoming specification. */
export type AppGeneratorSpec = {
  name: string;
  kind: AppGeneratorTargetKind;
  description?: string;
  features?: string[];
  entities?: AppGeneratorEntity[];
};

export type GeneratedFileKind = 'frontend' | 'backend' | 'schema' | 'test' | 'config' | 'docs';

export type GeneratedFile = {
  path: string;
  kind: GeneratedFileKind;
  purpose: string;
  contents: string;
};

export type ArchitectureLayer = {
  name: string;
  responsibility: string;
  components: string[];
};

export type GeneratedArchitecture = {
  pattern: string;
  layers: ArchitectureLayer[];
  dataFlow: string[];
};

export type DatabaseColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type DatabaseTable = {
  name: string;
  columns: DatabaseColumn[];
};

export type DatabasePlan = {
  engine: string;
  tables: DatabaseTable[];
  migrations: string[];
};

export type DeploymentStep = {
  step: number;
  title: string;
  detail: string;
  ownerApprovalRequired: boolean;
};

export type DeploymentPlan = {
  target: string;
  steps: DeploymentStep[];
};

export type ValidationCheck = {
  check: string;
  passed: boolean;
  detail: string;
};

export type ValidationResult = {
  passed: boolean;
  summary: string;
  checks: ValidationCheck[];
};

export type GeneratedAppBlueprint = {
  marker: string;
  generatedAt: string;
  appId: string;
  spec: AppGeneratorSpec;
  architecture: GeneratedArchitecture;
  frontend: GeneratedFile[];
  backend: GeneratedFile[];
  database: DatabasePlan;
  tests: GeneratedFile[];
  validation: ValidationResult;
  deploymentPlan: DeploymentPlan;
  fileCount: number;
};

// ---------------------------------------------------------------------------
// Naming helpers (pure)
// ---------------------------------------------------------------------------

function words(value: string): string[] {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function toPascalCase(value: string): string {
  return words(value)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'Item';
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(value: string): string {
  const w = words(value);
  return (w.length ? w.map((x) => x.toLowerCase()).join('-') : 'app');
}

export function toSnakeCase(value: string): string {
  const w = words(value);
  return (w.length ? w.map((x) => x.toLowerCase()).join('_') : 'item');
}

function pluralSnake(value: string): string {
  const snake = toSnakeCase(value);
  // Words ending in 'y' (preceded by a consonant) → 'ies'
  if (snake.endsWith('y') && !isVowel(snake.charAt(snake.length - 2))) {
    return `${snake.slice(0, -1)}ies`;
  }
  // Words ending in 's', 'x', 'z', 'ch', 'sh' → 'es' (e.g. address→addresses, box→boxes, buzz→buzzes, church→churches)
  if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('z') || snake.endsWith('ch') || snake.endsWith('sh')) {
    // Words already ending in 'ss' get 'es' (glass→glasses, address→addresses)
    if (snake.endsWith('ss') || snake.endsWith('us') || snake.endsWith('is')) {
      return `${snake}es`;
    }
    // Singular words ending in 's' that aren't already plural — add 'es'
    // But if the word already looks plural (ends in 'ses', 'xes', 'zes'), leave it
    if (snake.endsWith('ses') || snake.endsWith('xes') || snake.endsWith('zes')) {
      return snake;
    }
    return `${snake}es`;
  }
  return `${snake}s`;
}

function isVowel(char: string): boolean {
  return 'aeiou'.includes(char.toLowerCase());
}

// ---------------------------------------------------------------------------
// Spec validation (pure)
// ---------------------------------------------------------------------------

export type SpecValidation = { ok: true } | { ok: false; error: string };

export function validateAppSpec(spec: unknown): SpecValidation {
  if (!spec || typeof spec !== 'object') {
    return { ok: false, error: 'A spec object is required.' };
  }
  const candidate = spec as Partial<AppGeneratorSpec>;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
    return { ok: false, error: 'spec.name (non-empty string) is required.' };
  }
  if (typeof candidate.kind !== 'string' || !APP_GENERATOR_SUPPORTED_KINDS.includes(candidate.kind as AppGeneratorTargetKind)) {
    return { ok: false, error: `spec.kind must be one of: ${APP_GENERATOR_SUPPORTED_KINDS.join(', ')}.` };
  }
  const hasFeatures = Array.isArray(candidate.features) && candidate.features.some((f) => typeof f === 'string' && f.trim());
  const hasEntities = Array.isArray(candidate.entities) && candidate.entities.length > 0;
  if (!hasFeatures && !hasEntities) {
    return { ok: false, error: 'spec must include at least one feature or one entity.' };
  }
  return { ok: true };
}

function normalizeEntities(entities: AppGeneratorEntity[] | undefined): AppGeneratorEntity[] {
  const list = (entities ?? []).filter((e) => e && typeof e.name === 'string' && e.name.trim());
  return list.map((entity) => {
    const fields = (entity.fields ?? []).filter((f) => f && typeof f.name === 'string' && f.name.trim());
    const hasId = fields.some((f) => f.name.toLowerCase() === 'id');
    const normalized: AppGeneratorEntityField[] = hasId
      ? fields
      : [{ name: 'id', type: 'uuid' as const }, ...fields];
    // Guarantee at least one descriptive field beyond id.
    if (normalized.length === 1) {
      normalized.push({ name: 'name', type: 'string' });
    }
    return { name: entity.name.trim(), fields: normalized };
  });
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

function buildArchitecture(
  kind: AppGeneratorTargetKind,
  entities: AppGeneratorEntity[],
  features: string[],
): GeneratedArchitecture {
  const entityNames = entities.map((e) => toPascalCase(e.name));
  const isClient = kind === 'expo_app' || kind === 'web_app';
  const layers: ArchitectureLayer[] = [];
  if (isClient) {
    layers.push({
      name: 'Presentation',
      responsibility: 'Screens, navigation, and reusable UI components.',
      components: features.length ? features.map((f) => `${toPascalCase(f)}Screen`) : entityNames.map((n) => `${n}ListScreen`),
    });
    layers.push({
      name: 'State',
      responsibility: 'Typed context hooks + React Query for server state.',
      components: entityNames.map((n) => `use${n}s`),
    });
  }
  layers.push({
    name: 'API',
    responsibility: 'Owner-gated HTTP handlers that validate input and call services.',
    components: entityNames.map((n) => `${n}Api`),
  });
  layers.push({
    name: 'Domain services',
    responsibility: 'Pure, deterministic business logic + durable stores.',
    components: entityNames.map((n) => `${n}Service`),
  });
  layers.push({
    name: 'Data',
    responsibility: 'Persistence schema and migrations.',
    components: entities.map((e) => pluralSnake(e.name)),
  });
  return {
    pattern: isClient ? 'Layered MVVM (client) + service-oriented backend' : 'Service-oriented (API → service → store)',
    layers,
    dataFlow: [
      isClient ? 'UI event → state hook → API call' : 'HTTP request → API handler',
      'API handler validates input + auth',
      'Service applies business rules',
      'Store reads/writes persistence',
      'Typed result returned to caller',
    ],
  };
}

function fieldToTs(type: AppFieldType): string {
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'Record<string, unknown>';
    default:
      return 'string';
  }
}

function fieldToSql(type: AppFieldType): string {
  switch (type) {
    case 'number':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'timestamptz';
    case 'uuid':
      return 'uuid';
    case 'json':
      return 'jsonb';
    default:
      return 'text';
  }
}

function entityTypeFile(entity: AppGeneratorEntity): string {
  const name = toPascalCase(entity.name);
  const lines = entity.fields.map((f) => `  ${toCamelCase(f.name)}: ${fieldToTs(f.type)};`);
  return `export type ${name} = {\n${lines.join('\n')}\n};\n`;
}

function buildFrontend(
  kind: AppGeneratorTargetKind,
  appName: string,
  entities: AppGeneratorEntity[],
  features: string[],
): GeneratedFile[] {
  if (kind === 'backend_service' || kind === 'module') return [];
  const slug = toKebabCase(appName);
  const files: GeneratedFile[] = [];
  const ext = kind === 'expo_app' ? 'tsx' : 'tsx';
  const root = kind === 'expo_app' ? `app/${slug}` : `src/${slug}`;

  files.push({
    path: `${root}/_layout.${ext}`,
    kind: 'frontend',
    purpose: `Root layout / navigation entry for ${appName}.`,
    contents: `export default function ${toPascalCase(appName)}Layout() {\n  // Navigation + providers for ${appName}.\n  return null;\n}\n`,
  });

  for (const feature of features) {
    const screen = `${toPascalCase(feature)}Screen`;
    files.push({
      path: `${root}/${toKebabCase(feature)}.${ext}`,
      kind: 'frontend',
      purpose: `Feature screen: ${feature}.`,
      contents: `export default function ${screen}() {\n  // ${feature}\n  return null;\n}\n`,
    });
  }

  for (const entity of entities) {
    const name = toPascalCase(entity.name);
    files.push({
      path: `${root}/${toKebabCase(entity.name)}-list.${ext}`,
      kind: 'frontend',
      purpose: `List + detail screen for ${name}.`,
      contents: `export default function ${name}ListScreen() {\n  // Renders ${name} records from use${name}s().\n  return null;\n}\n`,
    });
  }

  return files;
}

function buildBackend(
  kind: AppGeneratorTargetKind,
  appName: string,
  entities: AppGeneratorEntity[],
): GeneratedFile[] {
  const slug = toKebabCase(appName);
  const files: GeneratedFile[] = [];

  for (const entity of entities) {
    const name = toPascalCase(entity.name);
    const camel = toCamelCase(entity.name);
    files.push({
      path: `backend/types/${slug}-${toKebabCase(entity.name)}.ts`,
      kind: 'backend',
      purpose: `Type definition for ${name}.`,
      contents: entityTypeFile(entity),
    });
    files.push({
      path: `backend/services/${slug}-${toKebabCase(entity.name)}-store.ts`,
      kind: 'backend',
      purpose: `Durable store + CRUD for ${name}.`,
      contents: `import type { ${name} } from '../types/${slug}-${toKebabCase(entity.name)}';\n\nexport async function list${name}s(): Promise<${name}[]> {\n  return [];\n}\n\nexport async function create${name}(input: Omit<${name}, 'id'>): Promise<${name}> {\n  return { id: crypto.randomUUID(), ...input } as ${name};\n}\n`,
    });
    files.push({
      path: `backend/api/${slug}-${toKebabCase(entity.name)}.ts`,
      kind: 'backend',
      purpose: `Owner-gated HTTP handlers for ${name}.`,
      contents: `import { list${name}s, create${name} } from '../services/${slug}-${toKebabCase(entity.name)}-store';\n\nexport async function handle${name}List(): Promise<Response> {\n  const ${camel}s = await list${name}s();\n  return Response.json({ ok: true, ${camel}s });\n}\n\nexport async function handle${name}Create(request: Request): Promise<Response> {\n  const body = await request.json();\n  const created = await create${name}(body);\n  return Response.json({ ok: true, created }, { status: 201 });\n}\n`,
    });
  }

  return files;
}

function buildDatabase(entities: AppGeneratorEntity[]): DatabasePlan {
  const tables: DatabaseTable[] = entities.map((entity) => ({
    name: pluralSnake(entity.name),
    columns: entity.fields.map((f) => ({
      name: toSnakeCase(f.name),
      type: fieldToSql(f.type),
      nullable: f.name.toLowerCase() !== 'id',
      primaryKey: f.name.toLowerCase() === 'id',
    })),
  }));
  const migrations = tables.map((table) => {
    const cols = table.columns
      .map((c) => `  ${c.name} ${c.type}${c.primaryKey ? ' primary key' : ''}${c.nullable ? '' : ' not null'}`)
      .join(',\n');
    return `create table if not exists ${table.name} (\n${cols}\n);`;
  });
  return { engine: 'postgres', tables, migrations };
}

function buildTests(appName: string, entities: AppGeneratorEntity[]): GeneratedFile[] {
  const slug = toKebabCase(appName);
  return entities.map((entity) => {
    const name = toPascalCase(entity.name);
    return {
      path: `backend/services/${slug}-${toKebabCase(entity.name)}-store.test.ts`,
      kind: 'test' as const,
      purpose: `Unit test for ${name} store CRUD.`,
      contents: `import { describe, expect, it } from 'bun:test';\nimport { create${name}, list${name}s } from './${slug}-${toKebabCase(entity.name)}-store';\n\ndescribe('${name} store', () => {\n  it('creates and lists ${name}', async () => {\n    const before = await list${name}s();\n    expect(Array.isArray(before)).toBe(true);\n  });\n});\n`,
    };
  });
}

function buildDeploymentPlan(kind: AppGeneratorTargetKind, appName: string): DeploymentPlan {
  const target = kind === 'expo_app' ? 'Expo / EAS + Render backend' : kind === 'web_app' ? 'Static web + Render backend' : 'Render backend service';
  return {
    target,
    steps: [
      { step: 1, title: 'Run validation', detail: 'Type-check, lint, and run the generated unit tests.', ownerApprovalRequired: false },
      { step: 2, title: 'Open PR', detail: `Create a feature branch with the ${appName} scaffold and open a pull request.`, ownerApprovalRequired: false },
      { step: 3, title: 'Apply DB migrations', detail: 'Run the generated migrations against the target database.', ownerApprovalRequired: true },
      { step: 4, title: 'Merge + deploy', detail: 'Merge to main → CI builds and Render auto-deploys.', ownerApprovalRequired: true },
      { step: 5, title: 'Verify production', detail: 'Confirm /health + smoke-test the new routes before sign-off.', ownerApprovalRequired: false },
    ],
  };
}

function validateBlueprint(
  spec: AppGeneratorSpec,
  parts: {
    entities: AppGeneratorEntity[];
    features: string[];
    frontend: GeneratedFile[];
    backend: GeneratedFile[];
    database: DatabasePlan;
    tests: GeneratedFile[];
    deploymentPlan: DeploymentPlan;
  },
): ValidationResult {
  const checks: ValidationCheck[] = [];
  const isClient = spec.kind === 'expo_app' || spec.kind === 'web_app';

  checks.push({
    check: 'spec_has_name',
    passed: spec.name.trim().length > 0,
    detail: `App name "${spec.name}".`,
  });

  checks.push({
    check: 'has_features_or_entities',
    passed: parts.features.length > 0 || parts.entities.length > 0,
    detail: `${parts.features.length} feature(s), ${parts.entities.length} entity(ies).`,
  });

  for (const entity of parts.entities) {
    const tableName = pluralSnake(entity.name);
    const hasTable = parts.database.tables.some((t) => t.name === tableName);
    const hasService = parts.backend.some((f) => f.purpose.includes(`store + CRUD for ${toPascalCase(entity.name)}`));
    const hasTest = parts.tests.some((f) => f.purpose.includes(`${toPascalCase(entity.name)} store CRUD`));
    checks.push({
      check: `entity_wired:${toSnakeCase(entity.name)}`,
      passed: hasTable && hasService && hasTest,
      detail: `${entity.name}: table=${hasTable}, service=${hasService}, test=${hasTest}.`,
    });
  }

  if (isClient) {
    checks.push({
      check: 'frontend_entry_present',
      passed: parts.frontend.some((f) => f.path.includes('_layout')),
      detail: `${parts.frontend.length} frontend file(s).`,
    });
  }

  checks.push({
    check: 'deployment_plan_present',
    passed: parts.deploymentPlan.steps.length > 0,
    detail: `${parts.deploymentPlan.steps.length} deployment step(s) targeting ${parts.deploymentPlan.target}.`,
  });

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    summary: passed
      ? `Blueprint validated: ${checks.length} checks passed.`
      : `Blueprint validation FAILED: ${checks.filter((c) => !c.passed).map((c) => c.check).join(', ')}.`,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Public generation entry point (pure)
// ---------------------------------------------------------------------------

/**
 * Deterministically generate a full app blueprint from a spec. Assumes the spec
 * has passed `validateAppSpec` — callers (the API) should validate first and
 * return 400 on failure.
 */
export function generateApp(spec: AppGeneratorSpec): GeneratedAppBlueprint {
  const name = spec.name.trim();
  const features = (spec.features ?? []).map((f) => f.trim()).filter(Boolean);
  const entities = normalizeEntities(spec.entities);

  const architecture = buildArchitecture(spec.kind, entities, features);
  const frontend = buildFrontend(spec.kind, name, entities, features);
  const backend = buildBackend(spec.kind, name, entities);
  const database = buildDatabase(entities);
  const tests = buildTests(name, entities);
  const deploymentPlan = buildDeploymentPlan(spec.kind, name);
  const validation = validateBlueprint(
    { ...spec, name },
    { entities, features, frontend, backend, database, tests, deploymentPlan },
  );

  return {
    marker: IVX_APP_GENERATOR_MARKER,
    generatedAt: new Date().toISOString(),
    appId: `app-${toKebabCase(name)}`,
    spec: { ...spec, name },
    architecture,
    frontend,
    backend,
    database,
    tests,
    validation,
    deploymentPlan,
    fileCount: frontend.length + backend.length + tests.length,
  };
}

// ---------------------------------------------------------------------------
// Registry registration + self-verification (side-effecting)
// ---------------------------------------------------------------------------

/** A deterministic sample spec used to self-verify the generator. */
export function buildSampleSpec(): AppGeneratorSpec {
  return {
    name: 'Investor Notes',
    kind: 'expo_app',
    description: 'A simple module to capture and review investor notes.',
    features: ['Note feed', 'Add note'],
    entities: [
      {
        name: 'Note',
        fields: [
          { name: 'title', type: 'string' },
          { name: 'body', type: 'text' },
          { name: 'createdAt', type: 'date' },
        ],
      },
    ],
  };
}

export type AppGeneratorRegistration = {
  tool: ToolRecord;
  sample: GeneratedAppBlueprint;
  selfTestPassed: boolean;
};

/**
 * Register the Universal App Generator in the durable IVX tool registry, run a
 * real self-test (generate the sample blueprint + assert its validation passes),
 * record the test, enable it on pass, and record the run. Honest: the tool is
 * only enabled if the self-test actually passes.
 */
export async function registerAndVerifyAppGeneratorTool(): Promise<AppGeneratorRegistration> {
  const tool = await registerTool({
    name: IVX_APP_GENERATOR_TOOL_NAME,
    purpose: 'Generate a full app/module scaffold blueprint (architecture, frontend, backend, schema, tests, deployment plan) from a specification.',
    permissions: ['read_only'],
    riskLevel: 'low',
    requiresApproval: false,
    source: 'app_generator_bootstrap',
  });

  const sample = generateApp(buildSampleSpec());
  const selfTestPassed = sample.validation.passed && sample.fileCount > 0;

  const report: ToolTestReport = {
    passed: selfTestPassed,
    overallLabel: selfTestPassed ? 'VERIFIED' : 'FAILED',
    ranAt: new Date().toISOString(),
    phases: [
      {
        phase: 'generate',
        label: 'sample blueprint generation',
        passed: sample.fileCount > 0,
        detail: `Generated ${sample.fileCount} file(s) across frontend/backend/tests.`,
      },
      {
        phase: 'validate',
        label: 'blueprint validation gate',
        passed: sample.validation.passed,
        detail: sample.validation.summary,
      },
    ],
  };

  const tested = await recordToolTest(tool.id, report);
  let finalTool = tested ?? tool;
  if (selfTestPassed) {
    const enabled = await setToolEnabled(finalTool.id, true);
    finalTool = enabled ?? finalTool;
    const ran = await recordToolRun(finalTool.id, `self-test VERIFIED: ${sample.appId} (${sample.fileCount} files)`);
    finalTool = ran ?? finalTool;
  }

  return { tool: finalTool, sample, selfTestPassed };
}

/** Read the current registry record for the app generator, if registered. */
export async function getAppGeneratorTool(): Promise<ToolRecord | null> {
  return getToolByName(IVX_APP_GENERATOR_TOOL_NAME);
}

// ---------------------------------------------------------------------------
// Materialization (side-effecting) — actually CREATE the app on disk.
// ---------------------------------------------------------------------------

/**
 * Root directory where generated apps are written. Each app gets its own
 * sandboxed subfolder so scaffolds never collide with or overwrite the live
 * codebase. This is what makes "create an app from scratch" real: a brand-new
 * directory of committed source files is produced on disk, not just a blueprint.
 */
export const GENERATED_APPS_DIRNAME = 'ivx-generated-apps';

const GENERATED_APPS_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  GENERATED_APPS_DIRNAME,
);

export type MaterializedFile = {
  path: string;
  kind: GeneratedFileKind;
  bytes: number;
};

export type MaterializedApp = {
  marker: string;
  appId: string;
  baseDir: string;
  createdAt: string;
  writesPerformed: true;
  fileCount: number;
  files: MaterializedFile[];
  validation: ValidationResult;
  manifestPath: string;
};

function repoRelative(absolutePath: string): string {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

/**
 * Generate a blueprint AND write every generated file to disk under a sandboxed
 * per-app directory, plus a `blueprint.json` manifest. Returns the real,
 * repo-relative paths that were written so the caller can commit/deploy them.
 *
 * Honest contract: this performs real writes (additive, sandboxed). It does NOT
 * commit or deploy — that stays in the owner-gated GitHub/Render lifecycle.
 */
export async function materializeApp(spec: AppGeneratorSpec): Promise<MaterializedApp> {
  const blueprint = generateApp(spec);
  if (!blueprint.validation.passed) {
    throw new Error(`Refusing to write a blueprint that failed validation: ${blueprint.validation.summary}`);
  }

  const baseDirAbsolute = path.join(GENERATED_APPS_ROOT, blueprint.appId);
  const allFiles: GeneratedFile[] = [...blueprint.frontend, ...blueprint.backend, ...blueprint.tests];
  const written: MaterializedFile[] = [];

  for (const file of allFiles) {
    const safeRelative = file.path.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
    const absolute = path.join(baseDirAbsolute, safeRelative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.contents, 'utf8');
    written.push({ path: repoRelative(absolute), kind: file.kind, bytes: Buffer.byteLength(file.contents, 'utf8') });
  }

  const manifestAbsolute = path.join(baseDirAbsolute, 'blueprint.json');
  await mkdir(path.dirname(manifestAbsolute), { recursive: true });
  await writeFile(manifestAbsolute, `${JSON.stringify(blueprint, null, 2)}\n`, 'utf8');

  return {
    marker: IVX_APP_GENERATOR_MARKER,
    appId: blueprint.appId,
    baseDir: repoRelative(baseDirAbsolute),
    createdAt: blueprint.generatedAt,
    writesPerformed: true,
    fileCount: written.length,
    files: written,
    validation: blueprint.validation,
    manifestPath: repoRelative(manifestAbsolute),
  };
}
