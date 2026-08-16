import { describe, test, expect } from 'bun:test';
import { handleSeniorDeveloperReadiness } from './senior-developer-readiness';

async function mockRequest() {
  return { headers: new Headers(), json: async () => ({}) };
}

describe('handleSeniorDeveloperReadiness', () => {
  test('returns readiness report', async () => {
    const request = await mockRequest();
    const response = await handleSeniorDeveloperReadiness(request);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.readinessReport).toStrictEqual({
      routing: 'Checked',
      permissions: 'Checked',
      toolBindings: 'Checked',
      runtimeIntegration: 'Checked',
      tests: 'Checked',
      securityBoundaries: 'Checked',
      evidencePath: 'Checked',
      nextSteps: 'Run focused tests',
    });
  });
});
