/** Release the Auth subscriber before any nested Supabase request begins. */
export function deferAuthWork(work: () => Promise<void>, onError: (error: unknown) => void): () => void {
  const timer = setTimeout(() => { void work().catch(onError); }, 0);
  return () => clearTimeout(timer);
}
