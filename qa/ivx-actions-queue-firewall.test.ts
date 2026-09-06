import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = (name: string) => readFileSync(`.github/workflows/${name}`, 'utf8');

describe('GitHub Actions queue firewall', () => {
  test('high-frequency observers are deduplicated and run no faster than every 15 minutes', () => {
    for (const name of [
      'ivx-content-integrity-patrol.yml',
      'ivx-360-early-warning.yml',
      'ivx-112-per-agent-20h-no-sleep-sla.yml',
      'ivx-no-idle-intelligence.yml',
      'ivx-autonomous-radar-self-heal.yml',
    ]) {
      const text = workflow(name);
      expect(text).not.toContain("cron: '*/5 * * * *'");
      expect(text).toContain('cancel-in-progress: true');
    }
  });

  test('fanout-prone autonomous observers do not recursively trigger from workflow completion', () => {
    for (const name of [
      'ivx-autonomous-radar-self-heal.yml',
      'ivx-autonomous-nervous-system.yml',
      'ivx-autonomous-regression-scheduler.yml',
      'ivx-autonomous-certificate-trust-guard.yml',
      'ivx-autonomous-out-of-band-rescue.yml',
    ]) {
      expect(workflow(name)).not.toContain('workflow_run:');
    }
  });

  test('autonomous recovery observers are hourly at most and deduplicate active runs', () => {
    for (const name of [
      'ivx-autonomous-regression-scheduler.yml',
      'ivx-autonomous-certificate-trust-guard.yml',
      'ivx-autonomous-out-of-band-rescue.yml',
    ]) {
      const text = workflow(name);
      expect(text).not.toContain("cron: '*/5 * * * *'");
      expect(text).not.toContain("cron: '*/15 * * * *'");
      expect(text).not.toContain("cron: '*/30 * * * *'");
      expect(text).toContain('cancel-in-progress: true');
    }
  });

  test('expired launch-day war room is manual only', () => {
    const text = workflow('landing-war-room-today.yml');
    expect(text).toContain('workflow_dispatch:');
    expect(text).not.toContain('schedule:');
    expect(text).not.toContain('push:');
  });

  test('112 real work remains scheduled and manually dispatchable without every-push duplication', () => {
    const text = workflow('ivx-112-continuous-work.yml');
    expect(text).toContain("cron: '*/15 * * * *'");
    expect(text).toContain('workflow_dispatch:');
    expect(text).not.toContain('  push:');
  });
});
