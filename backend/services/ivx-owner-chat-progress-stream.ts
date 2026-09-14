/** Bound the HTTP transport without cancelling an admitted durable owner task. */
export function createOwnerChatProgressStream(options: {
  signal: AbortSignal;
  startedAt: number;
  requestId: string | null;
  execute: (emitDelta: (delta: string) => void) => Promise<Response>;
  onSettled?: (status: number) => void | Promise<void>;
  timeoutMs?: number;
  heartbeatMs?: number;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    clearInterval(heartbeat); clearTimeout(deadline);
    options.signal.removeEventListener('abort', abort);
  };
  const close = () => {
    if (closed) return;
    closed = true; dispose(); controller.close();
  };
  const abort = () => close();
  const send = (payload: Record<string, unknown>) => {
    if (closed) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };
  const fail = (status: number, error: string) => send({
    type: 'final', status, ok: false,
    body: { ok: false, error, requestId: options.requestId, executionConfirmed: false },
  });
  return new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      if (options.signal.aborted) { close(); return; }
      options.signal.addEventListener('abort', abort, { once: true });
      send({ type: 'start', startedAt: new Date(options.startedAt).toISOString() });
      send({ type: 'stage', stage: 'request_received' });
      heartbeat = setInterval(() => send({ type: 'heartbeat', elapsedMs: Date.now() - options.startedAt }), options.heartbeatMs ?? 3000);
      deadline = setTimeout(() => {
        fail(504, 'OWNER_CHAT_OUTCOME_UNCONFIRMED'); close();
      }, options.timeoutMs ?? 150_000);
      void (async () => {
        let status = 500;
        try {
          const response = await options.execute(delta => send({ type: 'delta', delta }));
          status = response.status;
          let body: unknown;
          try { body = await response.json(); }
          catch { status = 502; fail(status, 'OWNER_CHAT_INVALID_RESPONSE'); return; }
          send({ type: 'stage', stage: response.ok ? 'provider_ok' : 'provider_failed' });
          send({ type: 'final', status, ok: response.ok, body });
        } catch {
          fail(status, 'OWNER_CHAT_EXECUTION_FAILED');
        } finally {
          close();
          // This records the real execution outcome, even after disconnection.
          // It never upgrades a transport timeout to a completed owner task.
          try { await options.onSettled?.(status); } catch { /* audit cannot reopen the stream */ }
        }
      })();
    },
    cancel() { closed = true; dispose(); },
  });
}
