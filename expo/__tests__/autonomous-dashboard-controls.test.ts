import { describe, expect, it } from 'bun:test';
import { AUTONOMOUS_CONTROL_ROUTES } from '@/components/AutonomousDashboardControlStrip';

describe('Autonomous dashboard owner controls', () => {
  it('exposes the critical owner modules', () => {
    const routes = AUTONOMOUS_CONTROL_ROUTES.map((item) => item.route);
    expect(routes).toContain('/ivx/chat');
    expect(routes).toContain('/ivx/agent-command-center');
    expect(routes).toContain('/ivx/autonomous-control');
    expect(routes).toContain('/ivx/autonomous-live');
    expect(routes).toContain('/ivx/autonomous-ops');
    expect(routes).toContain('/ivx/agent-ledger');
  });

  it('does not publish duplicate module routes', () => {
    const routes = AUTONOMOUS_CONTROL_ROUTES.map((item) => item.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
