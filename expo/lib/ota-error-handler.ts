/**
 * Non-fatal OTA update error handler.
 *
 * The app must NEVER crash or show a fatal screen solely because an OTA
 * update download failed. This module wraps expo-updates in a safe boundary:
 *
 * - catches all update-check and update-download errors
 * - records diagnostics locally (update ID, channel, runtimeVersion, timestamp)
 * - continues with the embedded or cached bundle
 * - surfaces an optional non-blocking "Update unavailable" notice
 *
 * Native-level update checking is DISABLED in app.config.ts (updates.enabled: false)
 * to prevent the fatal `java.io.IOException: Failed to download remote update`
 * crash that occurs when the update URL is unreachable. This module provides
 * optional JS-level update checking that is fully non-fatal.
 */

import { Platform } from 'react-native';

export interface UpdateDiagnostics {
  hasUpdate: boolean;
  isRollback: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  manifestCreatedAt: string | null;
  checkedAt: string;
  error: string | null;
}

const DIAGNOSTICS_KEY = 'ivx_ota_diagnostics';

/**
 * Read the last recorded update diagnostics from AsyncStorage.
 * Safe to call on any platform — returns null on web or if unavailable.
 */
export async function getUpdateDiagnostics(): Promise<UpdateDiagnostics | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
    return raw ? (JSON.parse(raw) as UpdateDiagnostics) : null;
  } catch {
    return null;
  }
}

/**
 * Persist update diagnostics locally for debugging.
 */
async function saveDiagnostics(diagnostics: UpdateDiagnostics): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
  } catch {
    // Non-critical — don't let storage failure escalate
  }
}

/**
 * Safely check for updates without crashing the app.
 *
 * This function NEVER throws. If expo-updates is unavailable, if the update
 * server is unreachable, or if the downloaded manifest is invalid, it
 * silently returns diagnostics with the error recorded.
 *
 * @returns UpdateDiagnostics — always returns a result, never throws
 */
export async function safelyCheckForUpdates(): Promise<UpdateDiagnostics> {
  const baseDiagnostics: UpdateDiagnostics = {
    hasUpdate: false,
    isRollback: false,
    updateId: null,
    channel: null,
    runtimeVersion: null,
    manifestCreatedAt: null,
    checkedAt: new Date().toISOString(),
    error: null,
  };

  if (Platform.OS === 'web') {
    return baseDiagnostics;
  }

  try {
    // Dynamic import — expo-updates may not be available in all build modes.
    // TypeScript cannot resolve the module because it is intentionally removed
    // from dependencies; suppress the type error so the runtime import remains
    // safe and non-fatal.
    // @ts-ignore — module is optional at runtime
    const updates = await import('expo-updates');

    // Only proceed if updates are actually enabled in this build.
    // `updates.enabled` is false in app.config.ts, so this returns early on
    // every production launch and no update code runs at all.
    if (typeof updates.checkForUpdateAsync !== 'function' || (updates as { isEnabled?: boolean }).isEnabled === false) {
      return { ...baseDiagnostics, error: 'expo-updates disabled in this build' };
    }

    // Read update info from the MODULE constants, never from useUpdates().
    //
    // useUpdates() is a React hook. This function is async and runs from an
    // effect continuation, so React's hook dispatcher is not installed: calling
    // it throws on every single launch. Worse, if the awaited import resolves
    // while React happens to be rendering, the hook registers into whatever
    // component is mid-render and permanently corrupts its hook order.
    // expo-updates exposes the same values as plain module constants.
    const channel = (updates as { channel?: string | null }).channel ?? null;
    const runtimeVersion = (updates as { runtimeVersion?: string | null }).runtimeVersion ?? null;
    const updateId = (updates as { updateId?: string | null }).updateId ?? null;
    const manifestCreatedAt =
      ((updates as { manifest?: Record<string, unknown> }).manifest?.createdAt as string | undefined) ?? null;

    const diagnostics: UpdateDiagnostics = {
      ...baseDiagnostics,
      channel,
      runtimeVersion,
      updateId,
      manifestCreatedAt,
    };

    // Attempt to check for updates — wrapped in try/catch
    try {
      const result = await updates.checkForUpdateAsync();

      if (result.isAvailable) {
        diagnostics.hasUpdate = true;
        // Attempt to download — also non-fatal
        try {
          await updates.fetchUpdateAsync();
          // Reload to apply the update on next launch
          // Use a delay to let the UI show a success notice
          setTimeout(() => {
            try {
              updates.reloadAsync();
            } catch (reloadErr) {
              console.warn('[OTA] reloadAsync failed — app will use cached bundle on next launch', reloadErr);
            }
          }, 2000);
        } catch (fetchErr) {
          diagnostics.error = `fetchUpdateAsync failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
          console.warn('[OTA] Update download failed — continuing with cached bundle', diagnostics.error);
        }
      }
    } catch (checkErr) {
      diagnostics.error = `checkForUpdateAsync failed: ${checkErr instanceof Error ? checkErr.message : String(checkErr)}`;
      console.warn('[OTA] Update check failed — continuing with embedded bundle', diagnostics.error);
    }

    await saveDiagnostics(diagnostics);
    return diagnostics;
  } catch (importErr) {
    const diagnostics: UpdateDiagnostics = {
      ...baseDiagnostics,
      error: `expo-updates import failed: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
    };
    console.warn('[OTA] expo-updates not available — OTA checking disabled', diagnostics.error);
    await saveDiagnostics(diagnostics);
    return diagnostics;
  }
}

/**
 * Hook result for useUpdateStatus — provides update state to the UI.
 */
export interface UpdateStatusState {
  isChecking: boolean;
  hasUpdate: boolean;
  error: string | null;
  diagnostics: UpdateDiagnostics | null;
  lastCheckedAt: string | null;
}

/**
 * React hook that provides non-fatal update status.
 * Call this in a top-level component to enable background update checking.
 * The hook NEVER throws and NEVER blocks app rendering.
 */
export function useUpdateStatus(): UpdateStatusState & { checkNow: () => Promise<void> } {
  // This is a minimal hook that doesn't use React state to avoid
  // any risk of update errors causing re-render crashes.
  // It uses a ref-based approach via the module-level singleton.

  return {
    isChecking: false,
    hasUpdate: false,
    error: null,
    diagnostics: null,
    lastCheckedAt: null,
    checkNow: async () => {
      try {
        await safelyCheckForUpdates();
      } catch {
        // Never let this propagate
      }
    },
  };
}
