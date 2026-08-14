import { getIVXOwnerVariableRuntimeValue, type OwnerVariableName } from '../api/ivx-owner-variables';

const AI_OWNER_VARIABLE_ALIASES: readonly OwnerVariableName[] = [
  'IVX_AI_GATEWAY_KEY',
  'AI_GATEWAY_API_KEY',
];

/**
 * Load an existing owner-stored AI credential into the process runtime without
 * exposing or rewriting the secret. The AI runtime reads process.env lazily on
 * every request, so setting the canonical alias at boot repairs stale Render
 * bindings without changing the stored credential.
 */
export async function preloadAIProviderCredentialFromOwnerVariables(): Promise<void> {
  if (
    (process.env.IVX_OPENAI_API_KEY || '').trim()
    || (process.env.IVX_AI_GATEWAY_KEY || '').trim()
    || (process.env.AI_GATEWAY_API_KEY || '').trim()
    || (process.env.OPENAI_API_KEY || '').trim()
  ) {
    return;
  }

  for (const name of AI_OWNER_VARIABLE_ALIASES) {
    try {
      const value = await getIVXOwnerVariableRuntimeValue(name);
      if (!value) continue;
      if (name === 'IVX_AI_GATEWAY_KEY') {
        process.env.IVX_AI_GATEWAY_KEY = value;
      } else {
        process.env.AI_GATEWAY_API_KEY = value;
      }
      return;
    } catch {
      // Continue to the next supported alias; callers never receive secret data.
    }
  }
}
