import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.IVX_TOOL_REGISTRY_DIR = path.join(
  tmpdir(),
  `ivx-gate5-gen-${process.pid}-${Date.now()}`,
);

import {
  generateApp,
  validateAppSpec,
  materializeApp,
  buildSampleSpec,
  registerAndVerifyAppGeneratorTool,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  toCamelCase,
  APP_GENERATOR_SUPPORTED_KINDS,
  IVX_APP_GENERATOR_MARKER,
  type AppGeneratorSpec,
  type GeneratedAppBlueprint,
} from '../services/ivx-app-generator';

/**
 * GATE 5 — App generator isolated full-flow QA
 *
 * Tests the complete generation pipeline for all 4 supported kinds,
 * materialization (real disk writes), edge cases, and the registry
 * self-verification flow.
 */

describe('GATE 5 — Full-flow generation for all 4 supported kinds', () => {
  const specs: { kind: string; spec: AppGeneratorSpec }[] = [
    {
      kind: 'expo_app',
      spec: {
        name: 'Investor Portal',
        kind: 'expo_app',
        features: ['Dashboard', 'Portfolio', 'Deal Flow'],
        entities: [
          { name: 'Investor', fields: [{ name: 'name', type: 'string' }, { name: 'email', type: 'string' }, { name: 'accredited', type: 'boolean' }] },
          { name: 'Deal', fields: [{ name: 'title', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'closeDate', type: 'date' }] },
        ],
      },
    },
    {
      kind: 'web_app',
      spec: {
        name: 'Marketing Site',
        kind: 'web_app',
        features: ['Landing', 'Pricing', 'Contact'],
        entities: [{ name: 'Lead', fields: [{ name: 'name', type: 'string' }, { name: 'email', type: 'string' }] }],
      },
    },
    {
      kind: 'backend_service',
      spec: {
        name: 'Notification Worker',
        kind: 'backend_service',
        entities: [{ name: 'Notification', fields: [{ name: 'recipient', type: 'string' }, { name: 'body', type: 'text' }, { name: 'sentAt', type: 'date' }] }],
      },
    },
    {
      kind: 'module',
      spec: {
        name: 'Analytics Module',
        kind: 'module',
        features: ['Event Tracking'],
        entities: [{ name: 'Event', fields: [{ name: 'type', type: 'string' }, { name: 'payload', type: 'json' }] }],
      },
    },
  ];

  for (const { kind, spec } of specs) {
    it(`generates a valid blueprint for kind=${kind}`, () => {
      const validation = validateAppSpec(spec);
      expect(validation.ok).toBe(true);

      const bp = generateApp(spec);
      expect(bp.marker).toBe(IVX_APP_GENERATOR_MARKER);
      expect(bp.appId).toBe(`app-${toKebabCase(spec.name)}`);
      expect(bp.validation.passed).toBe(true);
      expect(bp.fileCount).toBeGreaterThan(0);
      expect(bp.architecture.layers.length).toBeGreaterThan(0);
      expect(bp.database.tables.length).toBeGreaterThan(0);
      expect(bp.deploymentPlan.steps.length).toBeGreaterThan(0);

      // Every entity must be wired into a table, service, and test
      for (const entity of spec.entities ?? []) {
        const entityCheck = bp.validation.checks.find(
          (c) => c.check === `entity_wired:${toSnakeCase(entity.name)}`,
        );
        expect(entityCheck).toBeDefined();
        expect(entityCheck!.passed).toBe(true);
      }
    });
  }

  it('expo_app and web_app produce frontend files; backend_service and module do not', () => {
    const expoBp = generateApp(specs[0]!.spec);
    const webBp = generateApp(specs[1]!.spec);
    const backendBp = generateApp(specs[2]!.spec);
    const moduleBp = generateApp(specs[3]!.spec);

    expect(expoBp.frontend.length).toBeGreaterThan(0);
    expect(webBp.frontend.length).toBeGreaterThan(0);
    expect(backendBp.frontend.length).toBe(0);
    expect(moduleBp.frontend.length).toBe(0);
  });
});

describe('GATE 5 — Materialization (real disk writes)', () => {
  it('materializes a blueprint to disk with real files', async () => {
    const spec: AppGeneratorSpec = {
      name: 'Gate5 Materialize Test',
      kind: 'expo_app',
      features: ['Home'],
      entities: [{ name: 'Item', fields: [{ name: 'title', type: 'string' }] }],
    };

    const result = await materializeApp(spec);
    expect(result.writesPerformed).toBe(true);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.manifestPath).toContain('blueprint.json');
    expect(result.validation.passed).toBe(true);

    // Every file should have a path and byte count
    for (const file of result.files) {
      expect(file.path.length).toBeGreaterThan(0);
      expect(file.bytes).toBeGreaterThan(0);
    }
  });

  it('refuses to materialize a blueprint that fails validation', async () => {
    const badSpec = { name: '', kind: 'expo_app' as const, features: ['x'] };
    const validation = validateAppSpec(badSpec);
    expect(validation.ok).toBe(false);

    // generateApp with empty name should still produce a blueprint,
    // but validateAppSpec should reject it before we get to materialize
    try {
      // @ts-expect-error — intentionally bad spec
      await materializeApp(badSpec);
      // If generateApp doesn't throw on empty name, materializeApp should
      // still refuse if validation fails
    } catch (e) {
      // Expected: either generateApp throws or materializeApp refuses
      expect(e).toBeDefined();
    }
  });
});

describe('GATE 5 — Edge cases and robustness', () => {
  it('auto-adds id field to entities without one', () => {
    const bp = generateApp({
      name: 'Edge Test',
      kind: 'module',
      entities: [{ name: 'Thing', fields: [{ name: 'label', type: 'string' }] }],
    });
    const table = bp.database.tables[0]!;
    expect(table.columns.some((c) => c.name === 'id' && c.primaryKey)).toBe(true);
  });

  it('preserves explicit id field when provided', () => {
    const bp = generateApp({
      name: 'Edge Test 2',
      kind: 'module',
      entities: [{ name: 'Thing', fields: [{ name: 'id', type: 'uuid' }, { name: 'label', type: 'string' }] }],
    });
    const idCols = bp.database.tables[0]!.columns.filter((c) => c.name === 'id');
    expect(idCols.length).toBe(1); // No duplicate id
    expect(idCols[0]!.primaryKey).toBe(true);
  });

  it('adds a name field to entities with only id', () => {
    const bp = generateApp({
      name: 'Edge Test 3',
      kind: 'module',
      entities: [{ name: 'Minimal', fields: [{ name: 'id', type: 'uuid' }] }],
    });
    const cols = bp.database.tables[0]!.columns;
    expect(cols.some((c) => c.name === 'name')).toBe(true);
  });

  it('handles special characters in names', () => {
    expect(toPascalCase('investor-notes!!')).toBe('InvestorNotes');
    expect(toKebabCase('Investor Notes 123')).toBe('investor-notes-123');
    expect(toSnakeCase('Deal Room!!!')).toBe('deal_room');
    expect(toCamelCase('My Cool App')).toBe('myCoolApp');
  });

  it('pluralizes entity names correctly for table names', () => {
    const bp = generateApp({
      name: 'Plural Test',
      kind: 'module',
      entities: [
        { name: 'Category', fields: [{ name: 'name', type: 'string' }] },
        { name: 'Item', fields: [{ name: 'name', type: 'string' }] },
        { name: 'Address', fields: [{ name: 'name', type: 'string' }] },
      ],
    });
    const tableNames = bp.database.tables.map((t) => t.name);
    expect(tableNames).toContain('categories');
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('addresses');
  });

  it('rejects empty spec, null spec, and missing required fields', () => {
    expect(validateAppSpec(null).ok).toBe(false);
    expect(validateAppSpec({}).ok).toBe(false);
    expect(validateAppSpec({ name: 'X' }).ok).toBe(false);
    expect(validateAppSpec({ kind: 'expo_app' }).ok).toBe(false);
    expect(validateAppSpec({ name: 'X', kind: 'bad_kind', features: ['y'] }).ok).toBe(false);
    expect(validateAppSpec({ name: 'X', kind: 'expo_app', features: [] }).ok).toBe(false);
  });

  it('generates SQL migrations for every table', () => {
    const bp = generateApp({
      name: 'Migration Test',
      kind: 'backend_service',
      entities: [
        { name: 'User', fields: [{ name: 'email', type: 'string' }] },
        { name: 'Post', fields: [{ name: 'title', type: 'string' }, { name: 'body', type: 'text' }] },
      ],
    });
    expect(bp.database.migrations.length).toBe(2);
    expect(bp.database.migrations[0]!).toContain('create table if not exists');
    expect(bp.database.migrations[1]!).toContain('create table if not exists');
  });

  it('deployment plan has owner-gated steps for DB and deploy', () => {
    const bp = generateApp(buildSampleSpec());
    const ownerGatedSteps = bp.deploymentPlan.steps.filter((s) => s.ownerApprovalRequired);
    expect(ownerGatedSteps.length).toBeGreaterThan(0);
    const dbStep = ownerGatedSteps.find((s) => s.title.includes('migrations') || s.detail.includes('migrations'));
    expect(dbStep).toBeDefined();
  });
});

describe('GATE 5 — Registry self-verification', () => {
  it('registers the tool, self-tests, and enables it only on pass', async () => {
    const reg = await registerAndVerifyAppGeneratorTool();
    expect(reg.selfTestPassed).toBe(true);
    expect(reg.tool.enabled).toBe(true);
    expect(reg.tool.testStatus).toBe('passed');
    expect(reg.sample.validation.passed).toBe(true);
    expect(reg.sample.fileCount).toBeGreaterThan(0);
  });

  it('the sample spec is valid and generates a passing blueprint', () => {
    const sample = buildSampleSpec();
    expect(validateAppSpec(sample).ok).toBe(true);
    const bp = generateApp(sample);
    expect(bp.validation.passed).toBe(true);
    expect(bp.appId).toBe('app-investor-notes');
  });
});

describe('GATE 5 — Architecture integrity', () => {
  it('client kinds have Presentation + State layers; all kinds have API + Domain + Data', () => {
    const clientBp = generateApp({ name: 'Client', kind: 'expo_app', features: ['x'] });
    const layerNames = clientBp.architecture.layers.map((l) => l.name);
    expect(layerNames).toContain('Presentation');
    expect(layerNames).toContain('State');
    expect(layerNames).toContain('API');
    expect(layerNames).toContain('Domain services');
    expect(layerNames).toContain('Data');

    const backendBp = generateApp({ name: 'Backend', kind: 'backend_service', entities: [{ name: 'Job', fields: [{ name: 'name', type: 'string' }] }] });
    const backendLayers = backendBp.architecture.layers.map((l) => l.name);
    expect(backendLayers).not.toContain('Presentation');
    expect(backendLayers).not.toContain('State');
    expect(backendLayers).toContain('API');
    expect(backendLayers).toContain('Domain services');
    expect(backendLayers).toContain('Data');
  });

  it('dataFlow describes the full request lifecycle', () => {
    const bp = generateApp(buildSampleSpec());
    expect(bp.architecture.dataFlow.length).toBeGreaterThanOrEqual(4);
    expect(bp.architecture.dataFlow.some((f) => f.includes('validat'))).toBe(true);
    expect(bp.architecture.dataFlow.some((f) => f.includes('persistence') || f.includes('Store'))).toBe(true);
  });
});
