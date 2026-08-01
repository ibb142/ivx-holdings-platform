import { describe, expect, it } from 'bun:test';
import {
  assembleIndependenceReport,
  IVX_INDEPENDENCE_MARKER,
  type ExternalDependency,
  type CutoverTooling,
} from './ivx-rork-independence';
import type { ToolAvailabilityReport } from './ivx-tool-availability';
import type { HandoffManifest } from './ivx-handoff';

function tool(id: string, available: boolean) {
  return {
    tool: id,
    label: id,
    category: 'execution' as const,
    available,
    requiredForSteps: [],
    requiredEnv: [],
    missingEnv: [],
    detail: '',
  };
}

function toolsReport(allAvailable: boolean): ToolAvailabilityReport {
  const ids = [
    'ai_gateway', 'test_runner', 'execution_trace', 'self_heal',
    'github_write', 'render_deploy', 'supabase_actions', 'deliverable_pipeline', 'owner_auth_guard',
  ];
  const tools = ids.map((id) => tool(id, allAvailable));
  return {
    marker: 'test',
    generatedAt: new Date().toISOString(),
    total: tools.length,
    available: tools.filter((t) => t.available).length,
    unavailable: tools.filter((t) => !t.available).length,
    tools,
    blockedSteps: allAvailable ? [] : ['execute'],
    canExecuteEndToEnd: allAvailable,
  };
}

function handoff(ready: boolean): HandoffManifest {
  return {
    marker: 'test',
    generatedAt: new Date().toISOString(),
    handoffReady: ready,
    summary: { total: 10, ready: ready ? 10 : 6, partial: ready ? 0 : 4, blocked: ready ? 0 : 0, operatorIsRorkIndependent: ready },
    environment: {} as HandoffManifest['environment'],
    capabilities: [],
    ownerActionsRequired: [],
  };
}

function cutover(ready: boolean): CutoverTooling {
  return {
    ready,
    cutoverScript: 'expo/scripts/rork-independence-cutover.mjs',
    cutoverScriptPresent: ready,
    standaloneMetroConfig: 'expo/metro.config.independent.js',
    standaloneMetroConfigPresent: ready,
    ownerBuildPipeline: 'deploy/ci/ivx-independent-build.yml',
    ownerBuildPipelinePresent: ready,
    runCommand: 'IVX_ALLOW_RORK_CUTOVER=1 node expo/scripts/rork-independence-cutover.mjs',
    detail: '',
  };
}

function deps(opts: { sdk: boolean; envs: boolean; config: boolean }): ExternalDependency[] {
  return [
    { dependency: '@rork-ai/toolkit-sdk (expo/package.json)', present: opts.sdk, risk: 'high', detail: '', removalAction: '' },
    { dependency: 'EXPO_PUBLIC_RORK_* / EXPO_PUBLIC_TOOLKIT_URL runtime envs', present: opts.envs, risk: 'high', detail: '', removalAction: '' },
    { dependency: 'rork.json project config', present: opts.config, risk: 'low', detail: '', removalAction: '' },
    { dependency: '.rorkignore', present: opts.config, risk: 'low', detail: '', removalAction: '' },
  ];
}

describe('assembleRorkIndependenceReport', () => {
  it('carries the marker and all four ordered phases', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: false, envs: false, config: false }),
    });
    expect(report.marker).toBe(IVX_INDEPENDENCE_MARKER);
    expect(report.phases.map((p) => p.order)).toEqual([1, 2, 3, 4]);
    expect(report.phases.map((p) => p.id)).toEqual(['shadow', 'ivx_primary', 'independence', 'final_removal']);
  });

  it('achieves all four phases when tools+handoff are ready and external deps are gone', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: false, envs: false, config: false }),
    });
    expect(report.phases.every((p: { readiness: string }) => p.readiness === 'achieved')).toBe(true);
    expect(report.currentPhase).toBe('final_removal');
    expect(report.currentPhaseOrder).toBe(4);
    expect(report.nextPhase).toBeNull();
    expect(report.summary.rorkOptional).toBe(true);
    expect(report.summary.rorkRequiredForNormalWorkflow).toBe(false);
  });

  it('blocks Independence (phase 3) while the external SDK is still declared, but achieves Shadow + Primary', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: true, envs: true, config: true }),
    });
    const byId = Object.fromEntries(report.phases.map((p: { id: string; readiness: string }) => [p.id, p]));
    expect(byId.shadow.readiness).toBe('achieved');
    expect(byId.ivx_primary.readiness).toBe('achieved');
    expect(byId.independence.readiness).toBe('in_progress');
    expect(byId.final_removal.readiness).toBe('blocked');
    expect(report.currentPhase).toBe('ivx_primary');
    expect(report.currentPhaseOrder).toBe(2);
    expect(report.nextPhase).toBe('independence');
    expect(report.summary.rorkRequiredForNormalWorkflow).toBe(true);
    expect(report.summary.rorkOptional).toBe(false);
  });

  it('reports next actions naming the exact remaining external dependency', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: true, envs: false, config: false }),
    });
    expect(report.nextActions.some((a: string) => /toolkit-sdk/i.test(a))).toBe(true);
  });

  it('reports a not-ready cutover by default and carries the provided cutover tooling when supplied', () => {
    const withoutCutover = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: true, envs: true, config: true }),
    });
    expect(withoutCutover.cutoverTooling.ready).toBe(false);
    expect(withoutCutover.cutoverTooling.cutoverScript).toBe('expo/scripts/rork-independence-cutover.mjs');

    const withCutover = assembleIndependenceReport({
      tools: toolsReport(true), manifest: handoff(true), rorkDeps: deps({ sdk: true, envs: true, config: true }), cutover: cutover(true),
    });
    expect(withCutover.cutoverTooling.ready).toBe(true);
    expect(withCutover.cutoverTooling.ownerBuildPipelinePresent).toBe(true);
    expect(withCutover.cutoverTooling.runCommand).toContain('IVX_ALLOW_RORK_CUTOVER=1');
  });

  it('blocks every phase past Shadow when the lifecycle is not end-to-end capable', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(false), manifest: handoff(false), rorkDeps: deps({ sdk: true, envs: true, config: true }),
    });
    const byId = Object.fromEntries(report.phases.map((p: { id: string; readiness: string }) => [p.id, p]));
    expect(byId.shadow.readiness).not.toBe('achieved');
    expect(byId.ivx_primary.readiness).toBe('blocked');
    expect(report.currentPhaseOrder).toBe(0);
    expect(report.currentPhase).toBe('shadow');
  });

  it('maps the six owner-required capabilities and degrades canModifyCode when github_write is down', () => {
    const tools = toolsReport(true);
    tools.tools = tools.tools.map((t) => (t.tool === 'github_write' ? { ...t, available: false } : t));
    const report = assembleIndependenceReport({ tools, manifest: handoff(true), rorkDeps: deps({ sdk: false, envs: false, config: false }) });
    expect(report.ownerCapabilities).toHaveLength(6);
    expect(report.summary.canModifyCode).toBe(false);
    expect(report.summary.canReceiveOwnerCommands).toBe(true);
    expect(report.summary.canStoreProof).toBe(true);
  });

  it('lists the eight kept systems with GitHub/Render/Supabase/AI flagged unavailable when their tools are down', () => {
    const report = assembleIndependenceReport({
      tools: toolsReport(false), manifest: handoff(false), rorkDeps: deps({ sdk: true, envs: true, config: true }),
    });
    expect(report.keptSystems).toHaveLength(8);
    const backend = report.keptSystems.find((k: { system: string; available: boolean }) => k.system === 'IVX backend');
    expect(backend?.available).toBe(true);
    const github = report.keptSystems.find((k: { system: string; available: boolean; missing: string | null }) => k.system === 'GitHub');
    expect(github?.available).toBe(false);
    expect(github?.missing).toBeTruthy();
  });
});
