/** Spread task-claim batches before they acquire a database connection. */
export function enforceMillisecondScatter(): Promise<void> {
  // Schedule 10–150 ms; event-loop load can delay the callback further.
  const delayMs = 10 + Math.floor(Math.random() * 141);
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
