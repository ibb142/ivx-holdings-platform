import { afterEach, expect, spyOn, test } from 'bun:test';
import * as runtime from './ivx-agent-runtime';
import * as manager from './ivx-autonomous-work-manager';
import * as semantic from './ivx-autonomous-semantic-360';
import * as quality from './ivx-autonomous-decision-quality';
import { refreshAutonomousPlanning } from './ivx-autonomous-runtime-enforcer';

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });
function setup() {
  const states = spyOn(runtime, 'getAllExecutionStates').mockReturnValue([
    { agentId: 'ivx_holdings_1', agentNumber: 1, health: 'healthy', pauseState: false, disabledState: false },
    { agentId: 'ivx_holdings_2', agentNumber: 2, health: 'healthy', pauseState: true, disabledState: false },
    { agentId: 'ivx_holdings_3', agentNumber: 3, health: 'healthy', pauseState: false, disabledState: true },
    { agentId: 'ivx_holdings_4', agentNumber: 4, health: 'failed', pauseState: false, disabledState: false },
  ] as ReturnType<typeof runtime.getAllExecutionStates>);
  const plan = spyOn(manager, 'ensureAutonomousManagerBacklog').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof manager.ensureAutonomousManagerBacklog>>);
  const scan = spyOn(semantic, 'runAutonomousSemantic360').mockResolvedValue(undefined as never);
  const decide = spyOn(quality, 'runAutonomousDecisionQualityLoop').mockResolvedValue(undefined as never);
  restores.push(() => states.mockRestore(), () => plan.mockRestore(), () => scan.mockRestore(), () => decide.mockRestore());
  return { plan, scan, decide };
}

test('Landing priority continues bounded planning for eligible lanes', async () => {
  const { plan, scan, decide } = setup();
  await refreshAutonomousPlanning('a'.repeat(40), { enabled: true, landingMission: true });
  expect(plan).toHaveBeenCalledWith({ sourceSha: 'a'.repeat(40), agents: [{ agentId: 'ivx_holdings_1', agentNumber: 1 }] });
  expect(plan).toHaveBeenCalledTimes(1);
  expect(scan).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
});

test('disabled continuity does not create work or run the heavier planning loops', async () => {
  const { plan, scan, decide } = setup();
  await refreshAutonomousPlanning('a'.repeat(40), { enabled: false, landingMission: false });
  expect(plan).not.toHaveBeenCalled();
  expect(scan).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
});

test('the general mission retains semantic and decision-quality planning', async () => {
  const { plan, scan, decide } = setup();
  await refreshAutonomousPlanning('a'.repeat(40), { enabled: true, landingMission: false });
  expect(plan).toHaveBeenCalledTimes(1);
  expect(scan).toHaveBeenCalledWith('a'.repeat(40));
  expect(decide).toHaveBeenCalledWith('a'.repeat(40));
});
