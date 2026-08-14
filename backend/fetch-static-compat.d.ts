/**
 * Type-only compatibility for custom fetch wrappers used by Supabase.
 *
 * Bun's global fetch type exposes a static `preconnect` helper. Plain fetch
 * wrapper functions do not need that helper at runtime, but TypeScript still
 * requires it when a wrapper is passed where `typeof fetch` is expected.
 * Supabase only invokes the callable fetch signature; it does not call this
 * static helper. Declaring the Function member keeps the wrapper structurally
 * compatible without weakening the 5s AbortController timeout behavior.
 */
interface Function {
  preconnect(...args: any[]): void;
}
