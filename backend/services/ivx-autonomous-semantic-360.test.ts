import { describe, expect, test } from 'bun:test';
import {
  evaluateSemanticContracts,
  IVX_SEMANTIC_360_EDGES,
} from './ivx-autonomous-semantic-360';

describe('IVX Autonomous Semantic 360', () => {
  test('all declared edges connect when producer and consumer contracts are present', () => {
    const files: Record<string, string> = {};
    for (const edge of IVX_SEMANTIC_360_EDGES) {
      files[edge.producerFile] = `${files[edge.producerFile] ?? ''}\nproducer:${edge.id}`;
      files[edge.consumerFile] = `${files[edge.consumerFile] ?? ''}\n${edge.requiredTokens.join('\n')}`;
    }
    const assessed = evaluateSemanticContracts(files);
    expect(assessed.length).toBe(IVX_SEMANTIC_360_EDGES.length);
    expect(assessed.every((edge) => edge.connected)).toBe(true);
  });

  test('detects an individually present but semantically disconnected capability', () => {
    const target = IVX_SEMANTIC_360_EDGES.find((edge) => edge.id === 'self_improvement_to_semantic_360');
    expect(target).toBeTruthy();
    if (!target) return;

    const assessed = evaluateSemanticContracts({
      [target.producerFile]: 'export function getSelfImprovementState() {}',
      [target.consumerFile]: 'export const semantic360 = true;',
    });
    const edge = assessed.find((item) => item.id === target.id);
    expect(edge?.producerPresent).toBe(true);
    expect(edge?.consumerPresent).toBe(true);
    expect(edge?.connected).toBe(false);
    expect(edge?.missingTokens.length).toBeGreaterThan(0);
  });

  test('required semantic edges are certification gates while side-effectful schedulers stay advisory', () => {
    const required = IVX_SEMANTIC_360_EDGES.filter((edge) => edge.certificationRequired);
    const advisory = IVX_SEMANTIC_360_EDGES.filter((edge) => !edge.certificationRequired);
    expect(required.length).toBeGreaterThan(0);
    expect(advisory.map((edge) => edge.id)).toContain('self_upgrade_runtime_scheduler_boot');
    expect(advisory.map((edge) => edge.id)).toContain('global_intelligence_runtime_ticker_boot');
    expect(advisory.every((edge) => edge.kind === 'scheduler')).toBe(true);
  });

  test('runtime semantic edge requires explicit loop invocation, not only an import', () => {
    const edge = IVX_SEMANTIC_360_EDGES.find((item) => item.id === 'semantic_360_to_runtime');
    expect(edge).toBeTruthy();
    if (!edge) return;

    const importOnly = evaluateSemanticContracts({
      [edge.producerFile]: 'export const marker = true;',
      [edge.consumerFile]: "import './ivx-autonomous-semantic-360';",
    }).find((item) => item.id === edge.id);
    expect(importOnly?.connected).toBe(false);

    const invoked = evaluateSemanticContracts({
      [edge.producerFile]: 'export const marker = true;',
      [edge.consumerFile]: "import './ivx-autonomous-semantic-360'; runAutonomousSemantic360('sha');",
    }).find((item) => item.id === edge.id);
    expect(invoked?.connected).toBe(true);
  });
});
