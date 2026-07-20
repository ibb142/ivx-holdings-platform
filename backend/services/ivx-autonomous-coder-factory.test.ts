/**
 * IVX Autonomous Coder — Factory Engine Extension — Regression Tests.
 *
 * Covers the owner's mandate: the autonomous coder must be able to build apps
 * from scratch, install dependencies, provision Supabase, run builds, create
 * its own tools, and upgrade its own capability set — all owner-gated.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  IVX_FACTORY_APPROVAL_PHRASE,
  IVX_FACTORY_ENGINE_MARKER,
  IVX_FACTORY_ENGINE_VERSION,
  isFactoryApprovalValid,
  getCapabilityManifest,
  hasCapability,
  getRegisteredTools,
  registerToolHandler,
  getToolHandler,
  BASE_CAPABILITY_MANIFEST,
  runIVXFactoryJob,
  buildFactoryJobAnswer,
  type IVXFactoryOperation,
  type IVXToolDescriptor,
  type IVXCapabilityDescriptor,
} from './ivx-autonomous-coder-factory';

// ── Approval guard ─────────────────────────────────────────────────────────────

describe('IVX Factory Engine — approval guard', () => {
  test('accepts the exact approval phrase', () => {
    expect(isFactoryApprovalValid(IVX_FACTORY_APPROVAL_PHRASE)).toBe(true);
  });

  test('rejects missing phrase', () => {
    expect(isFactoryApprovalValid(undefined)).toBe(false);
    expect(isFactoryApprovalValid('')).toBe(false);
  });

  test('rejects wrong phrase', () => {
    expect(isFactoryApprovalValid('CONFIRM_IVX_GITHUB_WRITE')).toBe(false);
    expect(isFactoryApprovalValid('CONFIRM_IVX_RENDER_DEPLOY')).toBe(false);
    expect(isFactoryApprovalValid('CONFIRM_IVX_FACTORY')).toBe(false);
  });
});

// ── Marker + version ──────────────────────────────────────────────────────────

describe('IVX Factory Engine — marker + version', () => {
  test('exposes a stable marker', () => {
    expect(IVX_FACTORY_ENGINE_MARKER).toBe('ivx-factory-engine-2026-07-19');
  });
  test('exposes a stable version', () => {
    expect(IVX_FACTORY_ENGINE_VERSION).toBe('1.0.0');
  });
});

// ── Capability manifest ───────────────────────────────────────────────────────

describe('IVX Factory Engine — capability manifest', () => {
  test('ships with the 8 base capabilities', () => {
    const ids = getCapabilityManifest().map((c) => c.id);
    expect(ids).toContain('patch_engine');
    expect(ids).toContain('directory_factory');
    expect(ids).toContain('module_factory');
    expect(ids).toContain('dependency_installer');
    expect(ids).toContain('supabase_provisioner');
    expect(ids).toContain('build_runner');
    expect(ids).toContain('tool_creator');
    expect(ids).toContain('self_upgrader');
    expect(BASE_CAPABILITY_MANIFEST.length).toBe(8);
  });

  test('hasCapability returns true for base capabilities', () => {
    expect(hasCapability('patch_engine')).toBe(true);
    expect(hasCapability('directory_factory')).toBe(true);
    expect(hasCapability('module_factory')).toBe(true);
    expect(hasCapability('dependency_installer')).toBe(true);
    expect(hasCapability('supabase_provisioner')).toBe(true);
    expect(hasCapability('build_runner')).toBe(true);
    expect(hasCapability('tool_creator')).toBe(true);
    expect(hasCapability('self_upgrader')).toBe(true);
  });

  test('hasCapability returns false for unknown capabilities', () => {
    expect(hasCapability('repo_factory_v2')).toBe(false);
    expect(hasCapability('nonexistent')).toBe(false);
  });
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe('IVX Factory Engine — tool registry', () => {
  test('registerToolHandler + getToolHandler round-trips a handler', async () => {
    registerToolHandler('echo-handler', async (input) => ({ echoed: input }));
    const handler = getToolHandler('echo-handler');
    expect(typeof handler).toBe('function');
    const result = await handler?.({ hello: 'world' });
    expect(result).toEqual({ echoed: { hello: 'world' } });
  });

  test('getToolHandler returns undefined for unregistered handlers', () => {
    expect(getToolHandler('nonexistent-handler')).toBeUndefined();
  });

  test('getRegisteredTools lists registered tools', () => {
    // The list may contain tools from prior tests in this run; just verify shape.
    for (const tool of getRegisteredTools()) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.version).toBe('string');
      expect(typeof tool.capability).toBe('string');
    }
  });
});

// ── create_directory ──────────────────────────────────────────────────────────

describe('IVX Factory Engine — create_directory', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'ivx-factory-'));
  });

  test('creates a sanctioned top-level directory under apps/', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_directory',
      target: 'apps/ivx-investor-tracker/src',
      reason: 'Scaffold the new investor tracker app directory.',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dir-1',
      goal: 'create a new apps/ivx-investor-tracker directory',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.filesCreated).toContain('apps/ivx-investor-tracker/src');
    expect(existsSync(path.join(tmpRoot, 'apps/ivx-investor-tracker/src'))).toBe(true);
  });

  test('rejects a path outside sanctioned roots', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_directory',
      target: 'secrets/private',
      reason: 'should be rejected',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dir-2',
      goal: 'create a forbidden directory',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('outside sanctioned roots');
  });

  test('rejects a path traversal attempt', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_directory',
      target: 'apps/../../../etc/evil',
      reason: 'path traversal',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dir-3',
      goal: 'path traversal',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('Unsafe factory path');
  });

  test('rejects a forbidden segment (node_modules)', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_directory',
      target: 'apps/node_modules/evil',
      reason: 'forbidden segment',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dir-4',
      goal: 'forbidden segment',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('forbidden segment');
  });
});

// ── create_module ─────────────────────────────────────────────────────────────

describe('IVX Factory Engine — create_module', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'ivx-factory-'));
  });

  test('writes multiple files in one operation', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_module',
      target: 'apps/ivx-investor-tracker',
      files: [
        { path: 'apps/ivx-investor-tracker/index.ts', content: "export const VERSION = '1.0.0';\n" },
        { path: 'apps/ivx-investor-tracker/types.ts', content: "export type Investor = { id: string; name: string };\n" },
        { path: 'apps/ivx-investor-tracker/store.ts', content: "export const investors: Investor[] = [];\n" },
      ],
      reason: 'Scaffold the investor tracker module (3 files).',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-mod-1',
      goal: 'scaffold a 3-file module',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.filesCreated.length).toBe(3);
    const content = await readFile(path.join(tmpRoot, 'apps/ivx-investor-tracker/index.ts'), 'utf8');
    expect(content).toContain("VERSION = '1.0.0'");
  });

  test('fails when files array is empty', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_module',
      target: 'apps/empty',
      files: [],
      reason: 'empty module',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-mod-2',
      goal: 'empty module',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('at least one file');
  });
});

// ── install_dependency ────────────────────────────────────────────────────────

describe('IVX Factory Engine — install_dependency', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'ivx-factory-'));
    await writeFile(path.join(tmpRoot, 'package.json'), '{}');
  });

  test('uses injected dependency runner', async () => {
    const op: IVXFactoryOperation = {
      kind: 'install_dependency',
      dependency: { name: 'express', version: '4.18.2', packageJsonPath: 'package.json' },
      reason: 'install express',
    };
    let captured: { name: string; version?: string; packageJsonPath?: string } | null = null;
    const proof = await runIVXFactoryJob({
      taskId: 'test-dep-1',
      goal: 'install express',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
      dependencyRunner: async (spec) => {
        captured = spec;
        return { ok: true, output: `installed ${spec.name}@${spec.version}`, error: null };
      },
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.dependenciesInstalled).toEqual([{ name: 'express', version: '4.18.2' }]);
    expect(captured).toEqual({ name: 'express', version: '4.18.2', packageJsonPath: 'package.json' });
  });

  test('blocks when dependency runner returns failure', async () => {
    const op: IVXFactoryOperation = {
      kind: 'install_dependency',
      dependency: { name: 'nonexistent-pkg-xyz', version: '1.0.0' },
      reason: 'install a package that does not exist',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dep-2',
      goal: 'install nonexistent package',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
      dependencyRunner: async () => ({ ok: false, output: '', error: 'package not found' }),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toBe('package not found');
  });

  test('fails when no dependency spec provided', async () => {
    const op: IVXFactoryOperation = {
      kind: 'install_dependency',
      reason: 'missing spec',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-dep-3',
      goal: 'missing spec',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('dependency spec');
  });
});

// ── run_supabase_migration ────────────────────────────────────────────────────

describe('IVX Factory Engine — run_supabase_migration', () => {
  test('uses injected migration runner', async () => {
    const op: IVXFactoryOperation = {
      kind: 'run_supabase_migration',
      sql: 'CREATE TABLE investors (id uuid primary key default gen_random_uuid());',
      migrationName: '001_create_investors',
      reason: 'create investors table',
    };
    let capturedSql = '';
    let capturedName = '';
    const proof = await runIVXFactoryJob({
      taskId: 'test-mig-1',
      goal: 'create investors table',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      migrationRunner: async (sql, name) => {
        capturedSql = sql;
        capturedName = name;
        return { ok: true, output: 'applied', error: null };
      },
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(capturedSql).toContain('CREATE TABLE investors');
    expect(capturedName).toBe('001_create_investors');
    expect(proof.migrationsApplied).toEqual([{ name: '001_create_investors', ok: true }]);
  });

  test('blocks when migration runner fails', async () => {
    const op: IVXFactoryOperation = {
      kind: 'run_supabase_migration',
      sql: 'INVALID SQL;',
      migrationName: 'bad',
      reason: 'invalid sql',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-mig-2',
      goal: 'invalid migration',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      migrationRunner: async () => ({ ok: false, output: '', error: 'syntax error' }),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toBe('syntax error');
  });
});

// ── run_build ─────────────────────────────────────────────────────────────────

describe('IVX Factory Engine — run_build', () => {
  test('uses injected build runner and records artifact', async () => {
    const op: IVXFactoryOperation = {
      kind: 'run_build',
      buildTarget: 'apk',
      reason: 'build the APK',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-build-1',
      goal: 'build apk',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      buildRunner: async (target) => ({
        ok: true,
        artifactPath: `build/outputs/apk/release/app-${target}.apk`,
        output: `BUILD SUCCESSFUL for ${target}`,
        error: null,
      }),
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.buildsProduced).toEqual([{ target: 'apk', ok: true }]);
  });

  test('blocks when build runner reports failure (missing owner credentials)', async () => {
    const op: IVXFactoryOperation = {
      kind: 'run_build',
      buildTarget: 'ipa',
      reason: 'build iOS',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-build-2',
      goal: 'build ipa without apple credentials',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
      buildRunner: async () => ({ ok: false, output: '', error: 'Apple credentials required' }),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.operationProofs[0].ok).toBe(false);
    expect(proof.operationProofs[0].error).toContain('Apple credentials');
  });
});

// ── create_tool ───────────────────────────────────────────────────────────────

describe('IVX Factory Engine — create_tool', () => {
  test('registers a new IVX-owned tool', async () => {
    const toolName = `ivx-test-tool-${Date.now()}`;
    const op: IVXFactoryOperation = {
      kind: 'create_tool',
      tool: {
        name: toolName,
        version: '1.0.0',
        capability: 'Test tool — echoes its input back.',
        handlerName: 'echo-handler',
        registeredAt: new Date().toISOString(),
        approvedBy: 'iperez4242@gmail.com',
      },
      reason: 'register a new test tool',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-tool-1',
      goal: 'create a new tool',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.toolsRegistered).toContain(toolName);
    // The registry now contains the tool
    const registered = getRegisteredTools().find((t) => t.name === toolName);
    expect(registered).toBeDefined();
    expect(registered?.approvedBy).toBe('iperez4242@gmail.com');
  });

  test('fails when registering a duplicate tool', async () => {
    const toolName = `ivx-dup-tool-${Date.now()}`;
    const op: IVXFactoryOperation = {
      kind: 'create_tool',
      tool: { name: toolName, version: '1.0.0', capability: 'dup', registeredAt: new Date().toISOString(), approvedBy: 'iperez4242@gmail.com' },
      reason: 'first registration',
    };
    const proof1 = await runIVXFactoryJob({
      taskId: 'test-tool-2a',
      goal: 'first registration',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
    });
    expect(proof1.finalStatus).toBe('COMPLETED');
    // Second registration of the same name should fail
    const proof2 = await runIVXFactoryJob({
      taskId: 'test-tool-2b',
      goal: 'duplicate registration',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
    });
    expect(proof2.finalStatus).toBe('FAILED');
    expect(proof2.operationProofs[0].error).toContain('already registered');
  });
});

// ── upgrade_self ──────────────────────────────────────────────────────────────

describe('IVX Factory Engine — upgrade_self', () => {
  test('appends a new capability to the manifest', async () => {
    const capId = `custom-cap-${Date.now()}`;
    const op: IVXFactoryOperation = {
      kind: 'upgrade_self',
      capability: {
        id: capId,
        label: 'Custom capability added via self-upgrade',
        version: '1.0.0',
        operations: ['create_directory'],
        addedAt: new Date().toISOString(),
      },
      reason: 'extend the engine capability set',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-up-1',
      goal: 'add a new capability',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs[0].ok).toBe(true);
    expect(proof.capabilitiesAdded).toContain(capId);
    expect(hasCapability(capId)).toBe(true);
  });

  test('fails when appending a duplicate capability id+version', async () => {
    const op: IVXFactoryOperation = {
      kind: 'upgrade_self',
      capability: {
        id: 'patch_engine',
        label: 'Patch existing files',
        version: '1.0.0',
        operations: [],
        addedAt: new Date().toISOString(),
      },
      reason: 'duplicate capability',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-up-2',
      goal: 'duplicate capability',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [op],
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs[0].error).toContain('already in manifest');
  });
});

// ── Approval gate blocks all operations ───────────────────────────────────────

describe('IVX Factory Engine — approval gate blocks all operations without phrase', () => {
  test('returns BLOCKED with no operations executed when phrase missing', async () => {
    const op: IVXFactoryOperation = {
      kind: 'create_directory',
      target: 'apps/blocked',
      reason: 'should not run',
    };
    const proof = await runIVXFactoryJob({
      taskId: 'test-gate-1',
      goal: 'should be blocked',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: 'WRONG_PHRASE',
      operations: [op],
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.approved).toBe(false);
    expect(proof.operationProofs).toEqual([]);
    expect(proof.error).toContain(IVX_FACTORY_APPROVAL_PHRASE);
  });
});

// ── Multi-operation pipeline ──────────────────────────────────────────────────

describe('IVX Factory Engine — multi-operation pipeline', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'ivx-factory-'));
  });

  test('runs a full scaffold+module+migration pipeline', async () => {
    const ops: IVXFactoryOperation[] = [
      {
        kind: 'create_directory',
        target: 'apps/ivx-investor-tracker/src',
        reason: 'create the app directory',
      },
      {
        kind: 'create_module',
        target: 'apps/ivx-investor-tracker',
        files: [
          { path: 'apps/ivx-investor-tracker/index.ts', content: "export const APP = 'ivx-investor-tracker';\n" },
          { path: 'apps/ivx-investor-tracker/types.ts', content: "export type Investor = { id: string };\n" },
        ],
        reason: 'scaffold the module files',
      },
      {
        kind: 'run_supabase_migration',
        sql: 'CREATE TABLE investors (id uuid primary key);',
        migrationName: '001_investors',
        reason: 'provision the investors table',
      },
    ];
    const proof = await runIVXFactoryJob({
      taskId: 'test-pipe-1',
      goal: 'scaffold + migrate',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: ops,
      projectRoot: tmpRoot,
      migrationRunner: async () => ({ ok: true, output: 'applied', error: null }),
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.operationProofs.length).toBe(3);
    expect(proof.operationProofs.every((p) => p.ok)).toBe(true);
    expect(proof.filesCreated.length).toBe(3); // 1 dir + 2 files
    expect(proof.migrationsApplied).toEqual([{ name: '001_investors', ok: true }]);
  });

  test('stops at first failure — no phantom continuation', async () => {
    const ops: IVXFactoryOperation[] = [
      {
        kind: 'create_directory',
        target: 'forbidden/evil',
        reason: 'this will fail',
      },
      {
        kind: 'create_directory',
        target: 'apps/should-not-run',
        reason: 'this should not run after the failure',
      },
    ];
    const proof = await runIVXFactoryJob({
      taskId: 'test-pipe-2',
      goal: 'stop at first failure',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: ops,
      projectRoot: tmpRoot,
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.operationProofs.length).toBe(1); // only the first op ran
    expect(proof.filesCreated).toEqual([]); // nothing created
  });
});

// ── Answer format ─────────────────────────────────────────────────────────────

describe('IVX Factory Engine — answer format', () => {
  test('renders the owner-mandated proof sections', async () => {
    const proof = await runIVXFactoryJob({
      taskId: 'test-fmt-1',
      goal: 'format test',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: IVX_FACTORY_APPROVAL_PHRASE,
      operations: [
        {
          kind: 'create_directory',
          target: 'apps/format-test',
          reason: 'format test',
        },
      ],
      projectRoot: await mkdtemp(path.join(tmpdir(), 'ivx-factory-')),
    });
    const answer = buildFactoryJobAnswer(proof);
    expect(answer).toContain('TASK ID:');
    expect(answer).toContain('STATUS:');
    expect(answer).toContain('MODE:\nfactory');
    expect(answer).toContain('APPROVED:\nYES');
    expect(answer).toContain('CAPABILITIES AVAILABLE:');
    expect(answer).toContain('TOOLS AVAILABLE:');
    expect(answer).toContain('OPERATIONS:');
    expect(answer).toContain('FILES CREATED:');
    expect(answer).toContain('ERROR:');
  });

  test('answer for a blocked job shows NOT approved', async () => {
    const proof = await runIVXFactoryJob({
      taskId: 'test-fmt-2',
      goal: 'blocked format test',
      ownerId: 'iperez4242@gmail.com',
      approvalPhrase: 'WRONG',
      operations: [],
    });
    const answer = buildFactoryJobAnswer(proof);
    expect(answer).toContain('APPROVED:\nNO');
    expect(answer).toContain('STATUS:\nBLOCKED');
  });
});

// Helper for the install_dependency tests.
async function writeFile(filePath: string, content: string): Promise<void> {
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(filePath, content, 'utf8');
}
