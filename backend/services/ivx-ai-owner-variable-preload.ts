import { getIVXOwnerVariableRuntimeValue, type OwnerVariableName } from '../api/ivx-owner-variables';

const AI_OWNER_VARIABLE_ALIASES: readonly OwnerVariableName[] = [
  'IVX_AI_GATEWAY_KEY',
  'AI_GATEWAY_API_KEY',
];

/**
 * Load an existing owner-stored AI credential into the process runtime without
 * exposing or rewriting the secret.
 *
 * The encrypted Owner Variables store is authoritative for IVX-managed AI
 * credentials. Prefer it over potentially stale Render/process environment
 * aliases, then fall back to the process environment only when no stored value
 * can be read. The AI runtime reads process.env lazily on every request.
 */
export async function preloadAIProviderCredentialFromOwnerVariables(): Promise<void> {
  for (const name of AI_OWNER_VARIABLE_ALIASES) {
    try {
      const value = await getIVXOwnerVariableRuntimeValue(name, { preferStored: true });
      if (!value) continue;

      // Always populate the canonical alias used by the runtime. Keep the
      // alternate alias in sync in-memory only; no secret is logged or written.
      process.env.IVX_AI_GATEWAY_KEY = value;
      process.env.AI_GATEWAY_API_KEY = value;
      return;
    } catch {
      // Continue to the next supported alias; callers never receive secret data.
    }
  }

  // No stored value was readable. Preserve any host-provided credential rather
  // than clearing or rotating it; downstream health checks will validate it.
}
