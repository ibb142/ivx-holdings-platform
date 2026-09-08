import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.env.GITHUB_WORKSPACE || path.resolve(import.meta.dir, '../..');

const MANUAL_ONLY_FLEET_CONTROLLERS = [
  'ivx-112-15min-agent-control.yml',
  'ivx-112-2000h-utilization-sla.yml',
  'ivx-112-continuous-500-cycle.yml',
  'ivx-112-continuous-work.yml',
  'ivx-112-daily-self-upgrade-hour.yml',
  'ivx-112-force-dispatch-now.yml',
  'ivx-112-hard-start-recovery.yml',
  'ivx-112-per-agent-20h-no-sleep-sla.yml',
  'ivx-112-per-agent-timer-control.yml',
  'ivx-112-production-3layer-enforcer.yml',
  'ivx-112-self-upgrade-5h-scheduler.yml',
  'ivx-112-war-room-starter.yml',
  'ivx-autonomous-end-to-end-operational-control.yml',
  'ivx-autonomous-full-body-patrol.yml',
  'ivx-autonomous-nervous-system.yml',
  'ivx-autonomous-out-of-band-rescue.yml',
  'ivx-autonomous-radar-self-heal.yml',
  'ivx-autonomous-regression-scheduler.yml',
  'ivx-no-idle-intelligence.yml',
  'landing-112-3h-enterprise-human-qa.yml',
  'landing-112-agent-autonomous-qa.yml',
  'landing-112-autonomous-3h-scheduler.yml',
] as const;

function triggerBlock(source: string): string {
  const start = source.indexOf('\non:');
  const end = source.indexOf('\npermissions:');
  if (start < 0 || end < 0 || end <= start) return '';
  return source.slice(start, end);
}

describe('IVX fleet control authority workflows', () => {
  test('legacy fleet controllers are manual break-glass tools only', async () => {
    const workflowRoot = path.join(REPO_ROOT, '.github/workflows');
    for (const workflow of MANUAL_ONLY_FLEET_CONTROLLERS) {
      const source = await readFile(path.join(workflowRoot, workflow), 'utf8');
      const triggers = triggerBlock(source);
      expect(triggers, workflow).toContain('workflow_dispatch:');
      expect(triggers, workflow).not.toContain('schedule:');
      expect(triggers, workflow).not.toContain('push:');
      expect(triggers, workflow).not.toContain('workflow_run:');
    }
  });

  test('landing force remains manual and owner audit sync has a bounded separate job', async () => {
    const source = await readFile(path.join(REPO_ROOT, '.github/workflows/landing-112-p0-force-fleet.yml'), 'utf8');
    const force = source.slice(source.indexOf('\n  force-landing-fleet:'), source.indexOf('\n  owner-audit-contract-tests:'));
    const sync = source.slice(source.indexOf('\n  owner-audit-sync:'));
    expect(force).toContain("if: github.event_name == 'workflow_dispatch' && inputs.mode != 'owner_audit_sync'");
    expect(sync).toContain("if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && (github.event_name != 'workflow_dispatch' || inputs.mode == 'owner_audit_sync')");
    expect(sync).toContain('needs: owner-audit-contract-tests');
    expect(sync).toContain('timeout-minutes: 25');
    expect(sync).toContain('contents: read');
    expect(sync).toContain('actions: read');
    expect(sync).not.toContain('contents: write');
    expect(sync).not.toContain('actions/upload-artifact');
    expect(sync).toContain('node qa/landing-owner-audit-sync.mjs');
    expect(triggerBlock(source)).toContain("cron: '*/15 18-23 8 9 *'");
    expect(triggerBlock(source)).toContain("cron: '*/15 0-4 9 9 *'");
    const controller = await readFile(path.join(REPO_ROOT, 'qa/landing-owner-audit-sync.mjs'), 'utf8');
    expect(controller).toContain('Date.now() > Date.parse(m.monitorUntil)');
    expect(controller).toContain('approveGitDeploy: false');
  });

  test('read-only deployment evidence cannot request a deploy', async () => {
    const engine = await readFile(path.join(REPO_ROOT, 'backend/services/ivx-enterprise-deployment-engine.ts'), 'utf8');
    const api = await readFile(path.join(REPO_ROOT, 'backend/api/ivx-deployment-tools.ts'), 'utf8');
    expect(engine).toContain('runDeploymentCycle({ allowDeploy: false })');
    expect(engine).toContain('runDeploymentCycle({ allowDeploy: true })');
    expect(api).toContain('runDeploymentCycle({ allowDeploy: true })');
  });
});
