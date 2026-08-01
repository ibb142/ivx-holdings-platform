import { createHash } from 'node:crypto';
import {
  consumeWorkerAccessToken,
  generateWorkerAccessToken,
  revokeWorkerAccessToken,
  WorkerAccessTokenError,
  type WorkerAccessTokenRecord,
} from './ivx-worker-access-token';

const records = new Map<string, unknown>();

const testStore = {
  readJson: async <T>(file: string, fallback: T): Promise<T> => (records.has(file) ? records.get(file) as T : fallback),
  writeJson: async (file: string, value: unknown): Promise<void> => {
    records.set(file, value);
  },
};

const commitSha = 'a'.repeat(40);
const otherCommitSha = 'b'.repeat(40);
const workerId = 'ivx-senior-dev-01';

beforeEach(() => {
  records.clear();
});

describe('worker access tokens', () => {
  test('mints a token, stores only its hash, and returns the raw value once', async () => {
    const { rawToken, record } = await generateWorkerAccessToken({
      ownerId: 'owner-1',
      action: 'QA_ONLY',
      commitSha,
      requestId: 'req-1',
    }, testStore);

    expect(rawToken.length).toBeGreaterThan(20);
    expect(record.ownerId).toBe('owner-1');
    expect(record.action).toBe('QA_ONLY');
    expect(record.commitSha).toBe(commitSha);
    expect(record.usedAt).toBeNull();
    expect('tokenHash' in record).toBe(false);

    const stored = records.get('logs/audit/worker-access-tokens/tokens.json') as WorkerAccessTokenRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(createHash('sha256').update(rawToken, 'utf8').digest('hex'));
    // Raw token must never appear anywhere in the persisted record.
    expect(JSON.stringify(stored[0])).not.toContain(rawToken);
  });

  test('rejects minting with an invalid commit SHA', async () => {
    await expect(generateWorkerAccessToken({
      ownerId: 'owner-1',
      action: 'QA_ONLY',
      commitSha: 'not-a-sha',
      requestId: 'req-2',
    }, testStore)).rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 400, code: 'INVALID_COMMIT_SHA' });
  });

  test('rejects minting with a disallowed action', async () => {
    await expect(generateWorkerAccessToken({
      ownerId: 'owner-1',
      // @ts-expect-error intentionally invalid for the test
      action: 'DELETE_EVERYTHING',
      commitSha,
      requestId: 'req-3',
    }, testStore)).rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 400, code: 'INVALID_ACTION' });
  });

  test('clamps TTL into the 5-15 minute window', async () => {
    const tooLong = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-4', ttlMinutes: 999 }, testStore);
    const tooShort = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-5', ttlMinutes: 0 }, testStore);
    const longMinutes = (Date.parse(tooLong.record.expiresAt) - Date.parse(tooLong.record.issuedAt)) / 60_000;
    const shortMinutes = (Date.parse(tooShort.record.expiresAt) - Date.parse(tooShort.record.issuedAt)) / 60_000;
    expect(longMinutes).toBeCloseTo(15, 0);
    expect(shortMinutes).toBeCloseTo(5, 0);
  });

  test('consumes a valid token exactly once and rejects replay', async () => {
    const { rawToken } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-6' }, testStore);

    const consumed = await consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId }, testStore);
    expect(consumed.ownerId).toBe('owner-1');

    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 409, code: 'TOKEN_REPLAY' });
  });

  test('rejects an unknown/invalid raw token', async () => {
    await expect(consumeWorkerAccessToken({ rawToken: 'not-a-real-token', action: 'QA_ONLY', commitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 401, code: 'TOKEN_INVALID' });
  });

  test('rejects an expired token', async () => {
    const { rawToken, record } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-7', ttlMinutes: 5 }, testStore);
    const stored = records.get('logs/audit/worker-access-tokens/tokens.json') as WorkerAccessTokenRecord[];
    const index = stored.findIndex((item) => item.id === record.id);
    stored[index] = { ...stored[index]!, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    records.set('logs/audit/worker-access-tokens/tokens.json', stored);

    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 401, code: 'TOKEN_EXPIRED' });
  });

  test('rejects an action mismatch', async () => {
    const { rawToken } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-8' }, testStore);
    await expect(consumeWorkerAccessToken({ rawToken, action: 'RENDER_DEPLOY', commitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 403, code: 'ACTION_MISMATCH' });
  });

  test('rejects a commit SHA mismatch', async () => {
    const { rawToken } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-9' }, testStore);
    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha: otherCommitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 403, code: 'COMMIT_MISMATCH' });
  });

  test('rejects a worker-ID mismatch when the token is worker-bound', async () => {
    const { rawToken } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-10', workerId }, testStore);
    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId: 'some-other-worker' }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 403, code: 'WORKER_MISMATCH' });
  });

  test('allows any worker to consume a token that is not worker-bound', async () => {
    const { rawToken } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-11' }, testStore);
    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId: 'any-worker-id' }, testStore))
      .resolves.toMatchObject({ ownerId: 'owner-1' });
  });

  test('rejects a revoked token', async () => {
    const { rawToken, record } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-12' }, testStore);
    const revoked = await revokeWorkerAccessToken(record.id, 'owner requested cancellation', testStore);
    expect(revoked).toBe(true);

    await expect(consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId }, testStore))
      .rejects.toMatchObject<Partial<WorkerAccessTokenError>>({ status: 403, code: 'TOKEN_REVOKED' });
  });

  test('does not allow revoking an already-used token', async () => {
    const { rawToken, record } = await generateWorkerAccessToken({ ownerId: 'owner-1', action: 'QA_ONLY', commitSha, requestId: 'req-13' }, testStore);
    await consumeWorkerAccessToken({ rawToken, action: 'QA_ONLY', commitSha, workerId }, testStore);
    const revoked = await revokeWorkerAccessToken(record.id, 'too late', testStore);
    expect(revoked).toBe(false);
  });
});
