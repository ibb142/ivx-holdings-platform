import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

function walk(dir: string): string[] {
  const absolute = resolve(ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(absolute)) {
    const full = resolve(absolute, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(relative(ROOT, full)));
    else out.push(relative(ROOT, full));
  }
  return out;
}

describe('Autonomous mobile 360 observability guard', () => {
  test('client fatal/render errors enter the autonomous incident pipeline', () => {
    const tracker = read('expo/lib/error-tracking.ts');
    const bridge = read('expo/lib/autonomous-incident-bridge.ts');
    expect(tracker).toContain('reportAutonomousIncident');
    expect(bridge).toContain('/api/ivx/incidents');
    expect(bridge).toContain("'silent_failure'");
    expect(bridge).toContain("'critical'");
  });

  test('legacy realtime API is only a compatibility facade over the canonical hook', () => {
    const legacy = read('expo/lib/realtime.ts');
    expect(legacy).toContain("from '@/hooks/useRealtimeChannel'");
    expect(legacy).not.toContain('.channel(');
    expect(legacy).not.toContain('.subscribe(');
  });

  test('autonomous dashboard exposes owner control modules and mission control', () => {
    const dashboard = read('expo/app/autonomous-dashboard.tsx');
    expect(dashboard).toContain('OWNER CONTROL MODULES');
    expect(dashboard).toContain('/ivx/chat');
    expect(dashboard).toContain('/ivx/agent-command-center');
    expect(dashboard).toContain('/ivx/autonomous-control');
    expect(dashboard).toContain('LandingWorkersLiveScreen');
  });

  test('all Expo route files are visible to 360 inventory', () => {
    const routes = walk('expo/app').filter((path) => /\.(tsx|ts)$/.test(path));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((path) => path.endsWith('autonomous-dashboard.tsx'))).toBe(true);
    expect(routes.some((path) => path.includes('/ivx/') && path.endsWith('chat.tsx')) || routes.some((path) => path.endsWith('/ivx/index.tsx'))).toBe(true);
  });
});
