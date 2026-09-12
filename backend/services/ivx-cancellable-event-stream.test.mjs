import test from 'node:test';
import assert from 'node:assert/strict';
import { createCancellableEventStream } from './ivx-cancellable-event-stream.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('normal completion preserves SSE events and removes the request listener', async () => {
  const request = new AbortController();
  let providerSignal;
  const stream = createCancellableEventStream(request.signal, async (signal, send) => {
    providerSignal = signal;
    send({ type: 'start' });
    send({ type: 'delta', delta: 'observed output' });
    send({ type: 'done' });
  });
  const text = await new Response(stream).text();
  assert.deepEqual(text.trim().split('\n\n').map(line => JSON.parse(line.slice(6))), [
    { type: 'start' }, { type: 'delta', delta: 'observed output' }, { type: 'done' },
  ]);
  request.abort(new Error('after completion'));
  assert.equal(providerSignal.aborted, false);
});

test('an already disconnected request never starts the producer', async () => {
  const request = new AbortController();
  request.abort();
  let calls = 0;
  const stream = createCancellableEventStream(request.signal, async () => { calls++; });
  assert.equal(await new Response(stream).text(), '');
  assert.equal(calls, 0);
});

test('reader cancellation before admission prevents producer work', async () => {
  let calls = 0;
  const stream = createCancellableEventStream(new AbortController().signal, async () => { calls++; });
  await stream.cancel('consumer left');
  assert.equal(calls, 0);
});

for (const source of ['request', 'reader']) {
  test(`${source} cancellation aborts a producer waiting for its first token`, async () => {
    const request = new AbortController();
    const started = deferred();
    const released = deferred();
    let providerSignal;
    let releases = 0;
    let lateSend;
    const reason = new Error('client disconnected');
    const stream = createCancellableEventStream(request.signal, async (signal, send) => {
      providerSignal = signal;
      const stopped = new Promise(done => signal.addEventListener('abort', done, { once: true }));
      started.resolve();
      try {
        await stopped;
        lateSend = send({ type: 'done', text: 'must not be emitted' });
      } finally {
        releases++;
        released.resolve();
      }
    });
    const reader = stream.getReader();
    await started.promise;
    if (source === 'request') request.abort(reason);
    else await reader.cancel(reason);
    await released.promise;
    assert.equal(providerSignal.aborted, true);
    assert.equal(providerSignal.reason, reason);
    assert.equal(releases, 1);
    assert.equal(lateSend, false);
    assert.deepEqual(await reader.read(), { value: undefined, done: true });
  });
}

test('cancellation suppresses late errors without an unhandled producer rejection', async () => {
  const request = new AbortController();
  const started = deferred();
  const finish = deferred();
  const stream = createCancellableEventStream(request.signal, async () => {
    started.resolve();
    await finish.promise;
    throw new Error('late provider failure');
  });
  const reader = stream.getReader();
  await started.promise;
  await reader.cancel();
  finish.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

test('a producer failure remains a failure and detaches the request listener', async () => {
  const request = new AbortController();
  let providerSignal;
  const stream = createCancellableEventStream(request.signal, async signal => {
    providerSignal = signal;
    throw new Error('producer failed');
  });
  await assert.rejects(new Response(stream).text(), /producer failed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  request.abort();
  assert.equal(providerSignal.aborted, false);
});
