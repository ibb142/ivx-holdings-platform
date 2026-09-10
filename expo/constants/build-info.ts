import Constants from 'expo-constants';
import { getIVXRuntimeInfo } from '@/lib/runtime-environment';
import { SUPABASE_HOST_HINT } from '@/lib/supabase';
import { IVX_CANONICAL_API_BASE_URL } from '@/lib/ivx-supabase-client';

/**
 * Build/bundle identity surfaced on the IVX Diagnostics screen so the owner can
 * confirm — on the live device — which frontend bundle is actually running and
 * that it is NOT a stale cached bundle.
 *
 * Values are sourced from `app.config.ts` `extra` (baked into the JS bundle at
 * build time), so they change only when a NEW bundle is built and shipped. If
 * the device shows an OLD marker after reload, the bundle is stale.
 *
 * Production builds must never show `local` for the Git SHA or `unknown` for the
 * API environment. If the required `extra` values are missing, the build is
 * considered unidentified and diagnostics will report that explicitly.
 */
export interface IVXBuildInfo {
  /** Human build marker, e.g. IVX_BUNDLE_2026_07_15_BUILD_14_OWNER_SESSION_STABILIZED. */
  buildMarker: string;
  /** ISO timestamp the bundle marker was set. */
  buildTimestamp: string;
  /** Watchdog patch identifier (bumped whenever the watchdog/owner-auth logic changes). */
  watchdogPatchVersion: string;
  /** Frontend deploy marker, distinct from the backend /health marker. */
  frontendDeployMarker: string;
  /** App version from app.config.ts. */
  appVersion: string;
  /** Short commit hash from app.config.ts extra.sourceCommitSha. */
  commitShort: string;
  /** Full commit hash from app.config.ts extra.sourceCommitSha. */
  commitFull: string;
  /** Epoch ms when this JS bundle first executed (proves a fresh reload). */
  bundleBootEpochMs: number;
  /** Runtime environment label: development, staging, or production. */
  environment: 'development' | 'staging' | 'production';
  /** Runtime kind: expo-go, dev-client, standalone, web, or unknown. */
  runtimeKind: string;
  /** Canonical API base URL the app is wired to. */
  apiBaseUrl: string;
  /** Redacted Supabase project identifier (host) for diagnostics. */
  supabaseProjectHint: string;
  /** EAS project ID from app.config.ts, redacted in display. */
  easProjectId: string | null;
  /** True when the build identity values are present and valid. */
  isIdentified: boolean;
  /** Human-readable reason if the build is unidentified. */
  unidentifiedReason: string | null;
}

type ExtraShape = {
  buildMarker?: unknown;
  buildTimestamp?: unknown;
  watchdogPatchVersion?: unknown;
  frontendDeployMarker?: unknown;
  sourceCommitSha?: unknown;
  eas?: { projectId?: unknown };
};

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readEnvironment(): IVXBuildInfo['environment'] {
  const devFlag = typeof __DEV__ !== 'undefined' && __DEV__;
  const runtime = getIVXRuntimeInfo();
  if (devFlag || runtime.isExpoGo || runtime.isDevRuntime) {
    return 'development';
  }
  return 'production';
}

function resolveApiBaseUrl(): string {
  const envUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? '').trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  return IVX_CANONICAL_API_BASE_URL;
}

function redactedSupabaseProjectHint(): string {
  const host = SUPABASE_HOST_HINT;
  if (!host) return 'unknown';
  const parts = host.split('.');
  const ref = parts[0] ?? '';
  if (ref.length <= 4) return host;
  return `${ref.slice(0, 3)}…${ref.slice(-3)}.${parts.slice(1).join('.')}`;
}

function redactedEasProjectId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value === '00000000-0000-0000-0000-000000000000') return null;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Epoch ms captured once when the bundle is first evaluated on the device. */
const BUNDLE_BOOT_EPOCH_MS: number = Date.now();

export function getIVXBuildInfo(): IVXBuildInfo {
  const extra = (Constants.expoConfig?.extra ?? {}) as ExtraShape;
  const runtime = getIVXRuntimeInfo();
  const environment = readEnvironment();
  const commitFull = typeof extra.sourceCommitSha === 'string' && extra.sourceCommitSha.length > 0
    ? extra.sourceCommitSha
    : '';
  const commitShort = commitFull ? commitFull.slice(0, 8) : 'local';
  const buildMarker = readString(extra.buildMarker, '');
  const buildTimestamp = readString(extra.buildTimestamp, '');
  const appVersion = readString(Constants.nativeAppVersion || Constants.expoConfig?.version, '0.0.0');
  const apiBaseUrl = resolveApiBaseUrl();
  const supabaseProjectHint = redactedSupabaseProjectHint();
  const easProjectId = redactedEasProjectId(extra.eas?.projectId);

  let isIdentified = true;
  let unidentifiedReason: string | null = null;

  if (!commitFull || commitFull === 'local' || commitFull.length < 8) {
    isIdentified = false;
    unidentifiedReason = 'Missing sourceCommitSha in app.config.ts extra. Production builds must embed the Git SHA.';
  } else if (!buildMarker) {
    isIdentified = false;
    unidentifiedReason = 'Missing buildMarker in app.config.ts extra.';
  } else if (!buildTimestamp) {
    isIdentified = false;
    unidentifiedReason = 'Missing buildTimestamp in app.config.ts extra.';
  }

  return {
    buildMarker: buildMarker || 'unknown-build-marker',
    buildTimestamp: buildTimestamp || 'unknown',
    watchdogPatchVersion: readString(extra.watchdogPatchVersion, 'unknown'),
    frontendDeployMarker: readString(extra.frontendDeployMarker, 'unknown'),
    appVersion,
    commitShort,
    commitFull,
    bundleBootEpochMs: BUNDLE_BOOT_EPOCH_MS,
    environment,
    runtimeKind: runtime.kind,
    apiBaseUrl,
    supabaseProjectHint,
    easProjectId,
    isIdentified,
    unidentifiedReason,
  };
}

/**
 * Throws if the build is unidentified. Call this during app startup in production
 * to surface a fatal configuration error instead of shipping an anonymous build.
 */
export function assertIVXBuildIdentified(): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return;
  }
  const info = getIVXBuildInfo();
  if (!info.isIdentified) {
    throw new Error(info.unidentifiedReason ?? 'Unidentified production build: missing required build identity values.');
  }
}
