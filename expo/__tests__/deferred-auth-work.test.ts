import { expect, test } from 'bun:test';
import { deferAuthWork } from '../lib/deferred-auth-work';

test('a nested request can await refresh completion without holding its subscriber', async () => {
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let complete!: () => void;
  const completed = new Promise<void>(resolve => { complete = resolve; });
  let requestCompleted = false;
  const subscriber = async () => {
    deferAuthWork(async () => {
      await refresh;
      requestCompleted = true;
      complete();
    }, error => { throw error; });
  };
  // Auth completes a refresh only after its subscribers return.
  await subscriber();
  expect(requestCompleted).toBe(false);
  releaseRefresh();
  await completed;
  expect(requestCompleted).toBe(true);
});

test('unmount can cancel pending session work', async () => {
  let ran = false;
  const cancel = deferAuthWork(async () => { ran = true; }, () => {});
  cancel();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(ran).toBe(false);
});

test('async validation failures reach the error handler', async () => {
  let complete!: (error: unknown) => void;
  const completed = new Promise<unknown>(resolve => { complete = resolve; });
  const error = new Error('session rejected');
  deferAuthWork(async () => { throw error; }, complete);
  expect(await completed).toBe(error);
});
