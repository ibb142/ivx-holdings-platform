import { expect, test } from 'bun:test';
import { AppFactoryEngine } from './app-factory-engine';

const submission = { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId: 'fixture-owner', instructions: 'Build a test application.' };
test('invalid dates, names and request identities fail before taking a database connection', async () => {
  let connections = 0;
  const engine = new AppFactoryEngine({ connect: async () => { connections++; throw new Error('must not connect'); } });
  for (const days of [NaN, Infinity, -Infinity, 9, 31, 10.5, '10' as unknown as number]) {
    await expect(engine.submitAppBuildTarget('Fixture', days, submission)).rejects.toThrow('FACTORY_INVALID_DELIVERY_DAYS');
  }
  for (const name of ['', '   ', 'x'.repeat(121), 'bad\u0000name']) {
    await expect(engine.submitAppBuildTarget(name, 10, submission)).rejects.toThrow('FACTORY_INVALID_APP_NAME');
  }
  await expect(engine.submitAppBuildTarget('Fixture', 10, { ...submission, requestId: 'sixhex' })).rejects.toThrow('FACTORY_INVALID_REQUEST_ID');
  await expect(engine.submitAppBuildTarget('Fixture', 10, { ...submission, ownerId: '' })).rejects.toThrow('FACTORY_INVALID_OWNER_ID');
  await expect(engine.submitAppBuildTarget('Fixture', 10, { ...submission, instructions: '' })).rejects.toThrow('FACTORY_INVALID_INSTRUCTIONS');
  expect(connections).toBe(0);
});

test('connection failure propagates a safe unavailable error and makes no automatic retry', async () => {
  let connections = 0;
  const engine = new AppFactoryEngine({ connect: async () => {
    connections++; throw new Error('postgres://fixture-private-binding');
  } });
  await expect(engine.submitAppBuildTarget('Fixture', 30, submission))
    .rejects.toThrow('FACTORY_SUBMISSION_UNAVAILABLE_RETRY_SAME_REQUEST_ID');
  expect(connections).toBe(1);
});
