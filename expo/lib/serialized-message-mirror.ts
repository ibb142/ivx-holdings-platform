/** Serialize read/merge/write so an older remote snapshot cannot erase a reply. */
export function createSerializedMessageMirror<T>(
  read: () => Promise<T[]>,
  write: (messages: T[]) => Promise<void>,
  merge: (existing: T[], incoming: T[]) => T[],
): (messages: T[]) => Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  return (messages) => {
    const incoming = [...messages];
    const operation = pending.then(async () => {
      const existing = await read();
      await write(merge(existing, incoming));
    });
    pending = operation.catch(() => undefined);
    return operation;
  };
}
