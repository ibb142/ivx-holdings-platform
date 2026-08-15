import { getIVXOwnerVariableRuntimeValue, type OwnerVariableName } from '../api/ivx-owner-variables';

const AI_OWNER_VARIABLE_ALIASES: readonly OwnerVariableName[] = [
  'IVX_AI_GATEWAY_KEY',
  'AI_GATEWAY_API_KEY',
];

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Load an AI credential without allowing a stale encrypted Owner Variable to
 * overwrite the active production credential supplied by Render.
 *
 * Production priority:
 *   1. Render/process environment (authoritative)
 *   2. Encrypted Owner Variables store (fallback only)
 */
export async function preloadAIProviderCredentialFromOwnerVariables(): Promise<void> {
  const envKey = readTrimmed(process.env.IVX_AI_GATEWAY_KEY)
    || readTrimmed(process.env.AI_GATEWAY_API_KEY);

  if (envKey) {
    process.env.IVX_AI_GATEWAY_KEY = envKey;
    process.env.AI_GATEWAY_API_KEY = envKey;
    return;
  }

  for (const name of AI_OWNER_VARIABLE_ALIASES) {
    try {
      const value = await getIVXOwnerVariableRuntimeValue(name);
      if (!value) continue;
      process.env.IVX_AI_GATEWAY_KEY = value;
      process.env.AI_GATEWAY_API_KEY = value;
      return;
    } catch {
      // Continue to the next supported alias; never expose secret material.
    }
  }
}
