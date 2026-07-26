import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Isolate the durable tool registry so this suite never pollutes the shared
// production-shaped store (and never leaks into other suites' assertions).
process.env.IVX_TOOL_REGISTRY_DIR = path.join(tmpdir(), `ivx-app-generator-registry-${process.pid}-${Date.now()}`);
import { APP_GENERATOR_SUPPORTED_KINDS, IVX_APP_GENERATOR_MARKER, buildSampleSpec, generateApp, registerAndVerifyAppGeneratorTool, toKebabCase, toPascalCase, toSnakeCase, validateAppSpec, } from './ivx-app-generator';
describe('ivx-app-generator — naming helpers', () => {
    it('normalizes names across casings', () => {
        expect(toPascalCase('investor notes')).toBe('InvestorNotes');
        expect(toKebabCase('Investor Notes')).toBe('investor-notes');
        expect(toSnakeCase('Deal Room')).toBe('deal_room');
    });
    it('never produces empty identifiers', () => {
        expect(toPascalCase('!!!')).toBe('Item');
        expect(toKebabCase('')).toBe('app');
        expect(toSnakeCase('')).toBe('item');
    });
});
describe('ivx-app-generator — spec validation', () => {
    it('rejects missing name / invalid kind / empty spec', () => {
        expect(validateAppSpec(null).ok).toBe(false);
        expect(validateAppSpec({ kind: 'expo_app', features: ['x'] }).ok).toBe(false);
        expect(validateAppSpec({ name: 'X', kind: 'not_a_kind', features: ['x'] }).ok).toBe(false);
        expect(validateAppSpec({ name: 'X', kind: 'expo_app' }).ok).toBe(false);
    });
    it('accepts a spec with at least one feature or entity', () => {
        expect(validateAppSpec({ name: 'X', kind: 'module', features: ['y'] }).ok).toBe(true);
        expect(validateAppSpec({ name: 'X', kind: 'backend_service', entities: [{ name: 'Z', fields: [] }] }).ok).toBe(true);
    });
    it('supports exactly the advertised kinds', () => {
        expect(APP_GENERATOR_SUPPORTED_KINDS).toEqual(['expo_app', 'web_app', 'backend_service', 'module']);
    });
});
describe('ivx-app-generator — generation', () => {
    const spec = {
        name: 'Deal Tracker',
        kind: 'expo_app',
        features: ['Dashboard'],
        entities: [{ name: 'Deal', fields: [{ name: 'title', type: 'string' }, { name: 'amount', type: 'number' }] }],
    };
    it('produces architecture, frontend, backend, schema, tests, validation, deployment plan', () => {
        const bp = generateApp(spec);
        expect(bp.marker).toBe(IVX_APP_GENERATOR_MARKER);
        expect(bp.appId).toBe('app-deal-tracker');
        expect(bp.architecture.layers.length).toBeGreaterThan(0);
        expect(bp.frontend.length).toBeGreaterThan(0);
        expect(bp.backend.length).toBeGreaterThan(0);
        expect(bp.database.tables.length).toBe(1);
        expect(bp.tests.length).toBe(1);
        expect(bp.deploymentPlan.steps.length).toBeGreaterThan(0);
        expect(bp.fileCount).toBe(bp.frontend.length + bp.backend.length + bp.tests.length);
    });
    it('wires every entity into a table, service, and test (validation passes)', () => {
        const bp = generateApp(spec);
        expect(bp.validation.passed).toBe(true);
        const table = bp.database.tables[0];
        expect(table.name).toBe('deals');
        expect(table.columns.some((c) => c.primaryKey)).toBe(true);
    });
    it('always adds an id column to entities that omit it', () => {
        const bp = generateApp({ name: 'X', kind: 'module', entities: [{ name: 'Thing', fields: [{ name: 'label', type: 'string' }] }] });
        expect(bp.database.tables[0].columns.some((c) => c.name === 'id' && c.primaryKey)).toBe(true);
    });
    it('module/backend kinds produce no frontend files but still validate', () => {
        const bp = generateApp({ name: 'Worker', kind: 'backend_service', entities: [{ name: 'Job', fields: [{ name: 'name', type: 'string' }] }] });
        expect(bp.frontend.length).toBe(0);
        expect(bp.validation.passed).toBe(true);
    });
});
describe('ivx-app-generator — registry self-verification', () => {
    it('registers, self-tests, enables, and records a run', async () => {
        const reg = await registerAndVerifyAppGeneratorTool();
        expect(reg.selfTestPassed).toBe(true);
        expect(reg.tool.name).toBe('universal_app_generator');
        expect(reg.tool.testStatus).toBe('passed');
        expect(reg.tool.enabled).toBe(true);
        expect(reg.tool.runCount).toBeGreaterThan(0);
        expect(reg.sample.validation.passed).toBe(true);
    });
    it('the sample spec is a valid, generatable spec', () => {
        const sample = buildSampleSpec();
        expect(validateAppSpec(sample).ok).toBe(true);
        expect(generateApp(sample).validation.passed).toBe(true);
    });
});
