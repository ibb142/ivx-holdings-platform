import { describe, expect, it } from 'bun:test';
import {
  IVX_AUTONOMOUS_FLEET_SIZE,
  selectNextManagedModule,
  selectNextSecondaryPath,
} from './ivx-autonomous-work-manager';

const SHA = 'manager-test-sha';

type TaskIndexRecord = {
  taskId: string;
  idempotencyKey: string;
  assignedAgentNumber: number | null;
  state: 'QUEUED' | 'VERIFIED' | 'CANCELLED' | 'EXPIRED';
  title: string;
};

function task(idempotencyKey: string, agentNumber: number, state: TaskIndexRecord['state'] = 'VERIFIED'): TaskIndexRecord {
  return {
    taskId: `task-${agentNumber}-${idempotencyKey}`,
    idempotencyKey,
    assignedAgentNumber: agentNumber,
    state,
    title: idempotencyKey,
  };
}

describe('Autonomous Manager work-block selection', () => {
  it('partitions primary module patrol across 112 lanes without overlap', () => {
    const modules = Array.from({ length: 336 }, (_, index) => `backend/services/module-${index + 1}.ts`);
    const first = new Set<string>();
    for (let agentNumber = 1; agentNumber <= IVX_AUTONOMOUS_FLEET_SIZE; agentNumber += 1) {
      const selected = selectNextManagedModule(modules, [], SHA, `ivx_holdings_${agentNumber}`, agentNumber);
      expect(selected).toBe(modules[agentNumber - 1]);
      first.add(selected!);
    }
    expect(first.size).toBe(112);
  });

  it('advances a lane to the next unseen real module after VERIFIED work', () => {
    const modules = Array.from({ length: 336 }, (_, index) => `backend/services/module-${index + 1}.ts`);
    const agentNumber = 3;
    const agentId = 'ivx_holdings_3';
    const first = modules[2];
    const tasks = [task(`module-audit:${SHA}:${agentId}:${agentNumber}:${first}`, agentNumber)];
    const next = selectNextManagedModule(modules, tasks, SHA, agentId, agentNumber);
    expect(next).toBe(modules[2 + IVX_AUTONOMOUS_FLEET_SIZE]);
  });

  it('does not manufacture duplicate work when a lane has exhausted its primary modules', () => {
    const modules = ['a.ts', 'b.ts', 'c.ts'];
    const agentNumber = 1;
    const agentId = 'ivx_holdings_1';
    const tasks = [task(`module-audit:${SHA}:${agentId}:${agentNumber}:a.ts`, agentNumber)];
    expect(selectNextManagedModule(modules, tasks, SHA, agentId, agentNumber)).toBeNull();
  });

  it('uses the secondary list only as a distinct fallback sequence', () => {
    const paths = Array.from({ length: 224 }, (_, index) => `.github/workflows/control-${index + 1}.yml`);
    const agentNumber = 2;
    const first = paths[1];
    const tasks = [task(`autonomous-secondary:${SHA}:${agentNumber}:${first}`, agentNumber)];
    const next = selectNextSecondaryPath(paths, tasks, SHA, agentNumber);
    expect(next).toBe(paths[1 + IVX_AUTONOMOUS_FLEET_SIZE]);
  });

  it('ignores cancelled/expired history so abandoned blocks can be materialised again', () => {
    const modules = ['a.ts'];
    const agentNumber = 1;
    const agentId = 'ivx_holdings_1';
    const cancelled = [task(`module-audit:${SHA}:${agentId}:${agentNumber}:a.ts`, agentNumber, 'CANCELLED')];
    expect(selectNextManagedModule(modules, cancelled, SHA, agentId, agentNumber)).toBe('a.ts');
  });
});
