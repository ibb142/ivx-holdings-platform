/**
 * IVX App Generator Chat Helper (Phase 3).
 *
 * Extracts an app/module spec from an owner chat prompt and builds the honest
 * chat answer that routes to the real app generator — NOT fake progress bars
 * or narrative theater.
 *
 * When the owner says "create a new app from scratch called X" or "scaffold a
 * module named Y", the intent router routes to `app_generator`. This helper:
 *   1. Extracts a valid AppGeneratorSpec from the prompt text.
 *   2. Generates a real blueprint (pure + deterministic).
 *   3. Returns an honest answer with the blueprint summary, files planned,
 *      deployment plan, and the owner-approval gates required to proceed.
 *
 * NO fake "RUNNING 65%" progress. NO narrative. Real blueprint or honest failure.
 */
import {
  generateApp,
  validateAppSpec,
  type AppGeneratorSpec,
  type GeneratedAppBlueprint,
} from './ivx-app-generator';

export type AppGeneratorChatResult = {
  spec: AppGeneratorSpec | null;
  blueprint: GeneratedAppBlueprint | null;
  blueprintError: string | null;
  answer: string;
};

/**
 * Extract an app/module spec from a natural-language prompt.
 * Detects: app name, kind (expo_app / web_app / backend_service / module),
 * and optional description.
 */
export function extractAppGeneratorSpecFromPrompt(prompt: string): AppGeneratorSpec | null {
  const normalized = prompt.trim();

  // Detect kind.
  let kind: AppGeneratorSpec['kind'] = 'backend_service';
  if (/\b(?:ios|mobile|expo|react\s+native|app\s+store)\b/i.test(normalized)) {
    kind = 'expo_app';
  } else if (/\b(?:web|website|dashboard|landing)\b/i.test(normalized)) {
    kind = 'web_app';
  } else if (/\bmodule\b/i.test(normalized)) {
    kind = 'module';
  } else if (/\b(?:backend|api|service|endpoint)\b/i.test(normalized)) {
    kind = 'backend_service';
  }

  // Extract name: "called X", "named X", "for X", or fallback.
  let name = '';
  const calledMatch = normalized.match(/\b(?:called|named)\s+([a-zA-Z0-9_-]+)/i);
  if (calledMatch) {
    name = calledMatch[1];
  } else {
    const forMatch = normalized.match(/\b(?:for|app|module|service)\s+(?:called\s+|named\s+)?([a-zA-Z0-9_-]+)/i);
    if (forMatch) {
      name = forMatch[1];
    }
  }

  // If no name found, try to use a keyword from the prompt.
  if (!name) {
    if (/build\s*metadata/i.test(normalized)) {
      name = 'build-metadata';
    } else if (/investor/i.test(normalized)) {
      name = 'investor-tracker';
    } else {
      return null;
    }
  }

  // Sanitize name: lowercase, replace spaces with hyphens.
  name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

  // Extract optional description.
  const description = normalized.slice(0, 200);

  // Extract optional features from the prompt.
  const features: string[] = [];
  if (/\bauth\b/i.test(normalized)) features.push('authentication');
  if (/\b(?:crud|create|read|update|delete)\b/i.test(normalized)) features.push('crud_operations');
  if (/\b(?:dashboard|admin)\b/i.test(normalized)) features.push('admin_dashboard');
  if (/\b(?:notification|alert)\b/i.test(normalized)) features.push('notifications');
  if (/\b(?:search|filter)\b/i.test(normalized)) features.push('search');
  if (features.length === 0) features.push('core_functionality');

  return { name, kind, description, features };
}

/**
 * Build the honest chat answer for an app-generator routing.
 * Returns the interpreted intent, spec, blueprint summary, files planned,
 * deployment plan, and the owner-approval gates. NO fake progress.
 */
export function buildAppGeneratorChatAnswer(
  spec: AppGeneratorSpec | null,
  blueprint: GeneratedAppBlueprint | null,
  blueprintError: string | null,
  generatorRegistered: boolean,
): string {
  const parts: string[] = [
    'INTERPRETED INTENT:',
    'create_new_app — route to ivx_app_generator',
    '',
    'TARGET:',
    spec ? `${spec.kind}: ${spec.name}` : 'No spec extracted — provide a name and kind.',
    '',
    'GENERATOR STATUS:',
    `  registered: ${generatorRegistered}`,
    `  tool: ${generatorRegistered ? 'ivx_app_generator' : 'NOT REGISTERED'}`,
    '  factory: ivx_autonomous_coder_factory',
    '',
  ];

  if (blueprint) {
    const allFiles = [...blueprint.frontend, ...blueprint.backend, ...blueprint.tests];
    parts.push(
      'BLUEPRINT GENERATED:',
      `  appId: ${blueprint.appId}`,
      `  fileCount: ${blueprint.fileCount}`,
      `  frontend: ${blueprint.frontend.length} file(s)`,
      `  backend: ${blueprint.backend.length} file(s)`,
      `  tests: ${blueprint.tests.length} file(s)`,
      `  validation: ${blueprint.validation.passed ? 'PASSED' : 'FAILED'}`,
      `  validationSummary: ${blueprint.validation.summary}`,
      '',
      'FILES PLANNED:',
      ...allFiles.slice(0, 20).map((f) => `  ${f.path} [${f.kind}]`),
      ...(allFiles.length > 20 ? [`  ... and ${allFiles.length - 20} more`] : []),
      '',
      'DEPLOYMENT PLAN:',
      ...blueprint.deploymentPlan.steps.map((s) => `  ${s.step}. ${s.title}: ${s.detail}`),
      '',
      'APPROVAL REQUIRED:',
      'To scaffold files to disk: POST /api/ivx/app-generator/scaffold with the spec.',
      'To commit to GitHub: use the owner-gated github_commit_file action with CONFIRM_IVX_GITHUB_WRITE.',
      'To deploy to Render: use the owner-gated render_trigger_deploy action with CONFIRM_IVX_RENDER_DEPLOY.',
      '',
      'NEXT ACTION:',
      'Reply "scaffold it" to write files to disk, or POST /api/ivx/app-generator/scaffold with the spec.',
    );
  } else if (blueprintError) {
    parts.push(
      'BLUEPRINT STATUS:',
      `  FAILED: ${blueprintError}`,
      '',
      'NEXT ACTION:',
      'Provide a valid spec: { name, kind, description?, features?, entities? }',
      'POST /api/ivx/app-generator/generate with { spec } to generate the blueprint.',
    );
  } else {
    parts.push(
      'NO SPEC EXTRACTED:',
      'Could not extract a valid app/module spec from the prompt.',
      '',
      'NEXT ACTION:',
      'POST /api/ivx/app-generator/generate with { spec: { name, kind, description?, features?, entities? } }',
      'Kind options: expo_app, web_app, backend_service, module',
    );
  }

  return parts.join('\n');
}

/**
 * Full chat-path handler: extract spec, generate blueprint, build answer.
 * Used by the IVX IA chat handler when route === 'app_generator'.
 */
export function handleAppGeneratorChatRoute(prompt: string, generatorRegistered: boolean): AppGeneratorChatResult {
  const spec = extractAppGeneratorSpecFromPrompt(prompt);

  let blueprint: GeneratedAppBlueprint | null = null;
  let blueprintError: string | null = null;

  if (spec) {
    const validation = validateAppSpec(spec);
    if (validation.ok) {
      try {
        blueprint = generateApp(spec);
      } catch (error) {
        blueprintError = error instanceof Error ? error.message : 'Blueprint generation failed.';
      }
    } else {
      blueprintError = validation.error ?? 'Invalid app spec.';
    }
  }

  const answer = buildAppGeneratorChatAnswer(spec, blueprint, blueprintError, generatorRegistered);

  return { spec, blueprint, blueprintError, answer };
}
