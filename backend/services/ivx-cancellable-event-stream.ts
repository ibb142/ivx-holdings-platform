/** Tie an event stream's producer to both HTTP abort and reader cancellation. */
export function createCancellableEventStream(
  requestSignal: AbortSignal,
  produce: (signal: AbortSignal, send: (payload: unknown) => boolean) => Promise<void>,
): ReadableStream<Uint8Array> {
  const operation = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const dispose = () => requestSignal.removeEventListener('abort', requestAborted);
  const close = () => {
    if (closed) return;
    closed = true;
    controller.close();
  };
  const requestAborted = () => {
    operation.abort(requestSignal.reason);
    dispose();
    close();
  };

  return new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      if (requestSignal.aborted) {
        requestAborted();
        return;
      }
      requestSignal.addEventListener('abort', requestAborted, { once: true });
      // Do not make stream cancellation wait for a pending provider operation.
      void Promise.resolve().then(async () => {
        if (operation.signal.aborted) return;
        await produce(operation.signal, payload => {
          if (closed || operation.signal.aborted) return false;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          return true;
        });
      }).catch(error => {
        if (!closed) {
          closed = true;
          controller.error(error);
        }
      }).finally(() => {
        dispose();
        close();
      });
    },
    cancel(reason) {
      closed = true;
      operation.abort(reason);
      dispose();
    },
  });
}
