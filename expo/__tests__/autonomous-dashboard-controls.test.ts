import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This is a source-contract test. Importing the React Native component pulls
// expo-router's CommonJS bundle into Bun's isolated runner, which can fail in
// Bun internals before any IVX assertion executes.
const component = readFileSync(
  join(import.meta.dir, '..', 'components', 'AutonomousDashboardControlStrip.tsx'),
  'utf8',
);
const routes = [...component.matchAll(/route:\s*'([^']+)'/g)].map((match) => match[1]);

describe('Autonomous dashboard owner controls', () => {
  it('exports and exposes the critical owner modules', () => {
    expect(component).toContain('export const AUTONOMOUS_CONTROL_ROUTES');
    expect(routes).toContain('/ivx/chat');
    expect(routes).toContain('/ivx/agent-command-center');
    expect(routes).toContain('/ivx/autonomous-control');
    expect(routes).toContain('/ivx/autonomous-live');
    expect(routes).toContain('/ivx/autonomous-ops');
    expect(routes).toContain('/ivx/agent-ledger');
  });

  it('does not publish duplicate module routes', () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
