import { test, expect } from 'bun:test';
import { createApiProviderStartup } from './ivx-api-provider-startup';

test('each API startup schedules one real validation without declaring readiness', async () => {
  let run!: () => Promise<void>, schedules = 0, probes = 0, unrefs = 0;
  const startup = createApiProviderStartup({ processRole: 'api', nodeEnv: 'production',
    probe: async () => { probes++; },
    schedule: (callback, delay) => { schedules++; run = callback; expect(delay).toBe(30_000); return { unref: () => { unrefs++; } }; } });
  expect(startup.start()).toBe(true); expect(startup.start()).toBe(false);
  expect(schedules).toBe(1); expect(unrefs).toBe(1); expect(probes).toBe(0);
  await run(); expect(probes).toBe(1);
});

test('worker and test processes never add a second provider monitor', () => {
  for (const config of [{ processRole: 'worker', nodeEnv: 'production' }, { processRole: 'api', nodeEnv: 'test' }]) {
    const startup = createApiProviderStartup({ ...config, probe: async () => { throw new Error('unexpected probe'); },
      schedule: () => { throw new Error('unexpected timer'); } });
    expect(startup.start()).toBe(false);
  }
});

test('shutdown cancels pending validation and probe failures are contained', async () => {
  let run!: () => Promise<void>, cancellations = 0, reports = 0;
  const make = () => createApiProviderStartup({ processRole: 'api', nodeEnv: 'production',
    probe: async () => { throw new Error('private upstream detail'); },
    schedule: callback => { run = callback; return {}; }, cancel: () => { cancellations++; },
    reportFailure: () => { reports++; } });
  const stopped = make(); stopped.start(); stopped.stop(); await run();
  expect(cancellations).toBe(1); expect(reports).toBe(0);
  const active = make(); active.start(); await run(); expect(reports).toBe(1);
});
