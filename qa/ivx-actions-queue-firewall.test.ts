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

  test('queue firewall preserves owner repair PR validation while cancelling autonomous branch noise', () => {
    const supervisor = readFileSync('backend/services/ivx-github-actions-external-supervisor.ts', 'utf8');
    expect(supervisor).toContain("const PR_VALIDATION_WORKFLOWS=new Set(['IVX QA Suite','IVX E2E Acceptance Pipeline','IVX Secret Leak Scanner'])");
    expect(supervisor).toContain("run.event==='pull_request'");
    expect(supervisor).toContain("!run.head_branch?.startsWith('ivx-autonomous-')");
    expect(supervisor).toContain("process.env.IVX_OWNER_FOCUS_QUEUE_MODE||'off'");
  });

  test('provider health probes are observe-only unless auto-repair is explicitly enabled', () => {
    const manager = readFileSync('backend/services/ivx-autonomous-provider-manager.ts', 'utf8');
    expect(manager).toContain("process.env.IVX_PROVIDER_AUTO_REPAIR_ENABLED === 'true'");
    expect(manager).toContain('AUTO_REPAIR_ENABLED && !supabaseOk');
    expect(manager).toContain("'provider-degraded-observe-only'");
  });

  test('landing orchestrator honors its 3h contract and deduplicates overlapping runs', () => {
    const text = workflow('landing-112-autonomous-3h-scheduler.yml');
    expect(text).toContain("cron: '0 */3 * * *'");
    expect(text).toContain('cancel-in-progress: true');
    expect(text).not.toContain("cron: '*/5 * * * *'");
  });

  test('only the dedicated force-dispatch recovery loop may remain at five-minute cadence', () => {
    const forceDispatch = workflow('ivx-112-force-dispatch-now.yml');
    expect(forceDispatch).toContain("cron: '*/5 * * * *'");
    expect(forceDispatch).toContain('cancel-in-progress: true');

    for (const name of [
      'ivx-112-hard-start-recovery.yml',
      'ivx-112-production-3layer-enforcer.yml',
      'landing-112-autonomous-3h-scheduler.yml',
    ]) {
      expect(workflow(name)).not.toContain("cron: '*/5 * * * *'");
    }
  });
});
