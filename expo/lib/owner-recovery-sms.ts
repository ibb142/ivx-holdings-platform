/**
 * IVX Owner Login Recovery via SMS — Expo/React Native client.
 *
 * Calls the backend AWS-SNS-backed recovery endpoints:
 *   POST /api/ivx/owner-recovery/request  → texts a 6-digit code to the owner phone
 *   POST /api/ivx/owner-recovery/verify   → verifies the code, returns a recovery token,
 *                                            optionally repairs the owner password
 *   GET  /api/ivx/owner-recovery/status   → SNS readiness (no secrets)
 *
 * Secondary owner access path. AWS SNS is the active transport.
 */
import { envConfig } from './environment';

const RECOVERY_BACKEND_VERSION = 'V1-SNS';

export type OwnerRecoveryStatus = {
  ok: boolean;
  ready: boolean;
  transport: 'aws_sns';
  snsConfigured: boolean;
  awsCredentialsConfigured: boolean;
  awsRegion: string;
  recoveryPhoneConfigured: boolean;
  ownerEmailAllowlistConfigured: boolean;
  message?: string;
};

export type OwnerRecoveryRequestResult = {
  ok: boolean;
  message: string;
  phoneMasked: string | null;
  codeTtlSeconds?: number;
  messageId?: string;
  snsStatus?: string;
};

export type OwnerRecoveryVerifyResult = {
  ok: boolean;
  message: string;
  recoveryToken?: string;
  recoveryTokenTtlSeconds?: number;
  passwordRepaired?: boolean;
  phoneMasked?: string | null;
};

async function postJson(path: string, body: Record<string, unknown>, timeoutMs = 60000): Promise<Record<string, unknown>> {
  const base = (envConfig.apiBaseUrl || 'https://api.ivxholding.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { ok: false, message: `Non-JSON response: ${text.slice(0, 200)}` };
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(path: string, timeoutMs = 30000): Promise<Record<string, unknown>> {
  const base = (envConfig.apiBaseUrl || 'https://api.ivxholding.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { ok: false, message: `Non-JSON response: ${text.slice(0, 200)}` };
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/ivx/owner-recovery/status */
export async function fetchOwnerRecoverySmsStatus(): Promise<OwnerRecoveryStatus> {
  const raw = await getJson('/api/ivx/owner-recovery/status');
  return {
    ok: Boolean(raw.ok),
    ready: Boolean(raw.ready),
    transport: 'aws_sns',
    snsConfigured: Boolean(raw.snsConfigured),
    awsCredentialsConfigured: Boolean(raw.awsCredentialsConfigured),
    awsRegion: typeof raw.awsRegion === 'string' ? raw.awsRegion : 'us-east-1',
    recoveryPhoneConfigured: Boolean(raw.recoveryPhoneConfigured),
    ownerEmailAllowlistConfigured: Boolean(raw.ownerEmailAllowlistConfigured),
    message: typeof raw.message === 'string' ? raw.message : undefined,
  };
}

/** POST /api/ivx/owner-recovery/request */
export async function requestOwnerRecoverySms(email: string): Promise<OwnerRecoveryRequestResult> {
  const raw = await postJson('/api/ivx/owner-recovery/request', { email }, 90000);
  return {
    ok: Boolean(raw.ok),
    message: typeof raw.message === 'string' ? raw.message : 'Recovery request failed.',
    phoneMasked: typeof raw.phoneMasked === 'string' ? raw.phoneMasked : null,
    codeTtlSeconds: typeof raw.codeTtlSeconds === 'number' ? raw.codeTtlSeconds : undefined,
    messageId: typeof raw.messageId === 'string' ? raw.messageId : undefined,
    snsStatus: typeof raw.snsStatus === 'string' ? raw.snsStatus : undefined,
  };
}

/** POST /api/ivx/owner-recovery/verify */
export async function verifyOwnerRecoverySms(
  email: string,
  code: string,
  newPassword?: string,
): Promise<OwnerRecoveryVerifyResult> {
  const payload: Record<string, unknown> = { email, code };
  if (newPassword && newPassword.trim()) {
    payload.newPassword = newPassword.trim();
  }
  const raw = await postJson('/api/ivx/owner-recovery/verify', payload, 90000);
  return {
    ok: Boolean(raw.ok),
    message: typeof raw.message === 'string' ? raw.message : 'Verification failed.',
    recoveryToken: typeof raw.recoveryToken === 'string' ? raw.recoveryToken : undefined,
    recoveryTokenTtlSeconds: typeof raw.recoveryTokenTtlSeconds === 'number' ? raw.recoveryTokenTtlSeconds : undefined,
    passwordRepaired: Boolean(raw.passwordRepaired),
    phoneMasked: typeof raw.phoneMasked === 'string' ? raw.phoneMasked : null,
  };
}

export const OWNER_RECOVERY_SMS_BACKEND_VERSION = RECOVERY_BACKEND_VERSION;
