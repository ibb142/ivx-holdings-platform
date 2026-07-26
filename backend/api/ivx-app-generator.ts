/**
 * IVX Universal App Generator API (owner-only, BLOCKER 1).
 *
 *   GET  /api/ivx/app-generator            → status: marker, supported kinds, registry record
 *   POST /api/ivx/app-generator/generate   { spec } → full app blueprint
 *   POST /api/ivx/app-generator/register   → register + self-verify the tool, return record + sample
 *
 * The generator PROPOSES blueprints; it never writes files or deploys (that stays
 * owner-gated through the GitHub/Render lifecycle).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  APP_GENERATOR_SUPPORTED_KINDS,
  IVX_APP_GENERATOR_MARKER,
  IVX_APP_GENERATOR_TOOL_NAME,
  generateApp,
  getAppGeneratorTool,
  materializeApp,
  registerAndVerifyAppGeneratorTool,
  validateAppSpec,
  type AppGeneratorSpec,
  type GeneratedAppBlueprint,
  type GeneratedFile,
} from '../services/ivx-app-generator';
import { IVX_FACTORY_ENGINE_MARKER } from '../services/ivx-autonomous-coder-factory';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/app-generator — generator status + current registry record. */
export async function handleAppGeneratorStatusRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const tool = await getAppGeneratorTool();
    const registered = Boolean(tool);
    // If not yet registered, attempt a lazy boot registration so the status
    // endpoint is self-healing — no manual /register call needed.
    let bootError: string | null = null;
    if (!registered) {
      try {
        const registration = await registerAndVerifyAppGeneratorTool();
        if (registration.selfTestPassed) {
          return ownerOnlyJson({
            ok: true,
            marker: IVX_APP_GENERATOR_MARKER,
            supportedKinds: APP_GENERATOR_SUPPORTED_KINDS,
            registered: true,
            initialized: true,
            tool: IVX_APP_GENERATOR_TOOL_NAME,
            factory: IVX_FACTORY_ENGINE_MARKER,
            factoryAvailable: true,
            registryReady: true,
            ownerGated: true,
            runtimeReady: true,
            toolRecord: registration.tool as unknown as Record<string, unknown>,
          });
        }
        bootError = 'Self-test failed during lazy registration.';
      } catch (regError) {
        bootError = regError instanceof Error ? regError.message : 'Lazy registration failed.';
      }
    }
    return ownerOnlyJson({
      ok: true,
      marker: IVX_APP_GENERATOR_MARKER,
      supportedKinds: APP_GENERATOR_SUPPORTED_KINDS,
      registered,
      initialized: registered,
      tool: registered ? IVX_APP_GENERATOR_TOOL_NAME : null,
      toolRecord: tool as unknown as Record<string, unknown> | null,
      factory: IVX_FACTORY_ENGINE_MARKER,
      factoryAvailable: true,
      registryReady: registered,
      ownerGated: true,
      runtimeReady: registered,
      bootError,
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read app-generator status.' }, 500);
  }
}

/** POST /api/ivx/app-generator/generate — generate a full blueprint from a spec. */
export async function handleAppGeneratorGenerateRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let body: { spec?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const validation = validateAppSpec(body.spec);
  if (!validation.ok) {
    return ownerOnlyJson({ ok: false, error: validation.error }, 400);
  }

  try {
    const blueprint = generateApp(body.spec as AppGeneratorSpec);
    return ownerOnlyJson({ ok: true, blueprint: blueprint as unknown as Record<string, unknown> });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'App generation failed.' }, 500);
  }
}

/**
 * Shared helper: validate the request body's `spec` and return a generated
 * blueprint, or an error Response. Keeps plan/files-preview/deploy-request DRY.
 */
async function blueprintFromRequest(
  request: Request,
): Promise<{ ok: true; blueprint: GeneratedAppBlueprint } | { ok: false; response: Response }> {
  let body: { spec?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { ok: false, response: ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400) };
  }
  const validation = validateAppSpec(body.spec);
  if (!validation.ok) {
    return { ok: false, response: ownerOnlyJson({ ok: false, error: validation.error }, 400) };
  }
  try {
    const blueprint = generateApp(body.spec as AppGeneratorSpec);
    return { ok: true, blueprint };
  } catch (error) {
    return { ok: false, response: ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'App generation failed.' }, 500) };
  }
}

function fileSummary(file: GeneratedFile): { path: string; kind: GeneratedFile['kind']; purpose: string } {
  return { path: file.path, kind: file.kind, purpose: file.purpose };
}

/**
 * POST /api/ivx/app-generator/plan — owner-gated. Returns the product/architecture
 * plan derived from a spec: brief, architecture, file tree, screens, routes,
 * schema, deployment plan and rollback plan. PROPOSAL ONLY — no writes.
 */
export async function handleAppGeneratorPlanRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  const result = await blueprintFromRequest(request);
  if (!result.ok) return result.response;
  const b = result.blueprint;
  return ownerOnlyJson({
    ok: true,
    marker: b.marker,
    appId: b.appId,
    generatedAt: b.generatedAt,
    plan: {
      productBrief: {
        name: b.spec.name,
        kind: b.spec.kind,
        description: b.spec.description ?? null,
        features: b.spec.features ?? [],
      },
      architecture: b.architecture,
      fileTree: [...b.frontend, ...b.backend, ...b.tests].map(fileSummary),
      screens: b.frontend.map(fileSummary),
      backendRoutes: b.backend.map(fileSummary),
      databaseSchema: b.database,
      deploymentPlan: b.deploymentPlan,
      rollbackPlan: buildRollbackPlan(b),
      validation: b.validation,
      fileCount: b.fileCount,
    },
  });
}

/**
 * POST /api/ivx/app-generator/files-preview — owner-gated. Returns the full set
 * of generated files (path, kind, purpose, contents). PROPOSAL ONLY — nothing is
 * written to disk.
 */
export async function handleAppGeneratorFilesPreviewRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  const result = await blueprintFromRequest(request);
  if (!result.ok) return result.response;
  const b = result.blueprint;
  const files: GeneratedFile[] = [...b.frontend, ...b.backend, ...b.tests];
  return ownerOnlyJson({
    ok: true,
    appId: b.appId,
    fileCount: files.length,
    writesPerformed: false,
    files: files as unknown as Record<string, unknown>[],
  });
}

/**
 * POST /api/ivx/app-generator/deploy-request — owner-gated. Returns a dry-run
 * deployment request: files that WOULD change, the owner-approval gates, the
 * deployment plan and a rollback plan. Never writes or deploys; honors
 * `{ dryRun: true }` (the only supported mode — non-dry-run is explicitly
 * rejected because applying stays in the GitHub/Render owner lifecycle).
 */
export async function handleAppGeneratorDeployRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let raw: { spec?: unknown; dryRun?: unknown };
  try {
    raw = (await request.clone().json()) as typeof raw;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }
  const dryRun = raw.dryRun !== false; // default to dry-run
  if (!dryRun) {
    return ownerOnlyJson({
      ok: false,
      error: 'Non-dry-run deployment is not performed here. Applying a blueprint stays owner-gated through the GitHub/Render lifecycle.',
      requiresOwnerLifecycle: true,
    }, 409);
  }

  const result = await blueprintFromRequest(request);
  if (!result.ok) return result.response;
  const b = result.blueprint;
  const files: GeneratedFile[] = [...b.frontend, ...b.backend, ...b.tests];
  return ownerOnlyJson({
    ok: true,
    dryRun: true,
    writesPerformed: false,
    deployPerformed: false,
    appId: b.appId,
    filesChanged: files.map(fileSummary),
    fileCount: files.length,
    validation: b.validation,
    deploymentPlan: b.deploymentPlan,
    rollbackPlan: buildRollbackPlan(b),
    ownerApprovalRequired: true,
    securityGates: [
      'Owner authentication enforced (assertIVXOwnerOnly).',
      'Dry-run only — no file writes, no GitHub commit, no Render deploy.',
      'Database migrations and merge/deploy steps require explicit owner approval.',
    ],
  });
}

/** Build a deterministic rollback plan for a generated blueprint. */
function buildRollbackPlan(blueprint: GeneratedAppBlueprint): { step: number; title: string; detail: string }[] {
  return [
    { step: 1, title: 'Revert PR', detail: `Revert the feature branch / PR for ${blueprint.appId} before merge if validation fails.` },
    { step: 2, title: 'Roll back migrations', detail: `Drop the ${blueprint.database.tables.length} generated table(s): ${blueprint.database.tables.map((t) => t.name).join(', ') || 'none'}.` },
    { step: 3, title: 'Redeploy previous commit', detail: 'Trigger a Render deploy of the last known-good commit if production regressed.' },
    { step: 4, title: 'Verify /health', detail: 'Confirm /health reports the restored commit and the app is healthy.' },
  ];
}

/**
 * POST /api/ivx/app-generator/scaffold — owner-gated. Actually CREATES the app
 * from scratch: generates the blueprint AND writes every file to disk under a
 * sandboxed per-app directory, returning the real repo-relative paths written.
 * This is the end-to-end "create a new app from scratch" capability — real file
 * writes, not a proposal. Commit/deploy stays in the owner GitHub/Render flow.
 */
export async function handleAppGeneratorScaffoldRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let body: { spec?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const validation = validateAppSpec(body.spec);
  if (!validation.ok) {
    return ownerOnlyJson({ ok: false, error: validation.error }, 400);
  }

  try {
    const materialized = await materializeApp(body.spec as AppGeneratorSpec);
    return ownerOnlyJson({
      ok: true,
      writesPerformed: true,
      appId: materialized.appId,
      baseDir: materialized.baseDir,
      manifestPath: materialized.manifestPath,
      fileCount: materialized.fileCount,
      files: materialized.files,
      validation: materialized.validation,
      createdAt: materialized.createdAt,
    }, 201);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'App scaffold failed.' }, 500);
  }
}

/** POST /api/ivx/app-generator/register — register + self-verify the tool. */
export async function handleAppGeneratorRegisterRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const registration = await registerAndVerifyAppGeneratorTool();
    return ownerOnlyJson({
      ok: true,
      selfTestPassed: registration.selfTestPassed,
      tool: registration.tool as unknown as Record<string, unknown>,
      sample: registration.sample as unknown as Record<string, unknown>,
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'App-generator registration failed.' }, 500);
  }
}
