/**
 * IVX Member Verification Service
 *
 * Generates verification codes, stores them in Supabase with TTL,
 * and provides verification endpoints for email and phone.
 * Email/SMS delivery is handled via the Rork AI gateway for now;
 * connect to SendGrid/Twilio for production.
 *
 * v2 (2026-07-03): The production Supabase schema is missing the
 * `verification_codes` table and the `profiles.email_verified` /
 * `profiles.phone_verified` columns (schema repair requires the
 * service-role key, which is not configured). All operations now
 * fall back to a resilient local store (durable store when
 * configured, filesystem otherwise) so verification works end to
 * end regardless of schema state. Supabase remains the primary
 * path and is used automatically once the schema exists.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

const DEPLOYMENT_MARKER = 'ivx-member-verification-v4-secure-persistence';
const CODE_TTL_MINUTES = 10;
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_COOLDOWN_MS = 60_000;
const CODE_HASH_PREFIX = 'scrypt';

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function canUseFilesystemFallback(): boolean {
  return !isProductionRuntime();
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  // Service-role key first; anon key as a working fallback (service key was rotated).
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

function hashCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(code, salt, 32).toString('hex');
  return `${CODE_HASH_PREFIX}:${salt}:${digest}`;
}

function matchesCode(code: string, storedHash: string): boolean {
  const [algorithm, salt, digest] = storedHash.split(':');
  if (algorithm !== CODE_HASH_PREFIX || !salt || !digest) return false;
  const candidate = scryptSync(code, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Fallback store (used when the Supabase schema is missing/unavailable)
// ---------------------------------------------------------------------------

interface FallbackCodeRecord {
  userId: string;
  type: 'email' | 'phone';
  codeHash: string;
  attempts: number;
  resendCount: number;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
  lastSentAt: string;
}

type FallbackCodesStore = Record<string, FallbackCodeRecord>;
type FallbackStatusStore = Record<string, { emailVerified: boolean; phoneVerified: boolean; updatedAt: string }>;

const STORE_DIR = (): string => path.join(process.cwd(), 'logs', 'audit', 'member-verification');
const CODES_FILE = (): string => path.join(STORE_DIR(), 'verification-codes.json');
const STATUS_FILE = (): string => path.join(STORE_DIR(), 'verification-status.json');

function codeKey(userId: string, type: 'email' | 'phone'): string {
  return `${userId}:${type}`;
}

async function readStore<T>(file: string, fallback: T): Promise<T> {
  if (isDurableStoreConfigured()) {
    try {
      return await readDurableJson<T>(file, fallback);
    } catch {
      return fallback;
    }
  }
  if (!canUseFilesystemFallback()) return fallback;
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeStore<T>(file: string, value: T): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  if (!canUseFilesystemFallback()) {
    throw new Error('Secure verification storage is unavailable.');
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

function pruneExpiredCodes(codes: FallbackCodesStore, now: Date): void {
  for (const [key, record] of Object.entries(codes)) {
    if (record.verifiedAt || new Date(record.expiresAt) < now) {
      delete codes[key];
    }
  }
}

async function fallbackStoreCode(input: StoreCodeInput, code: string, expiresAt: Date): Promise<void> {
  const codes = await readStore<FallbackCodesStore>(CODES_FILE(), {});
  const nowDate = new Date();
  pruneExpiredCodes(codes, nowDate);
  const key = codeKey(input.userId, input.type);
  const existing = codes[key];
  const now = nowDate.toISOString();
  if (existing && !existing.verifiedAt && new Date(existing.expiresAt) >= nowDate) {
    if (nowDate.getTime() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
      throw new Error('Please wait before requesting another verification code.');
    }
    if (existing.resendCount >= MAX_RESENDS) {
      throw new Error('Verification resend limit reached. Please wait for the current code to expire.');
    }
  }
  codes[key] = {
    userId: input.userId,
    type: input.type,
    codeHash: hashCode(code),
    attempts: 0,
    resendCount: existing && !existing.verifiedAt ? existing.resendCount + 1 : 0,
    expiresAt: expiresAt.toISOString(),
    verifiedAt: null,
    createdAt: now,
    lastSentAt: now,
  };
  await writeStore(CODES_FILE(), codes);
}

async function fallbackMarkVerified(userId: string, type: 'email' | 'phone'): Promise<void> {
  const statuses = await readStore<FallbackStatusStore>(STATUS_FILE(), {});
  const current = statuses[userId] ?? { emailVerified: false, phoneVerified: false, updatedAt: '' };
  statuses[userId] = {
    emailVerified: type === 'email' ? true : current.emailVerified,
    phoneVerified: type === 'phone' ? true : current.phoneVerified,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(STATUS_FILE(), statuses);
}

async function fallbackVerifyCode(input: VerifyCodeInput): Promise<VerificationResult> {
  const codes = await readStore<FallbackCodesStore>(CODES_FILE(), {});
  const key = codeKey(input.userId, input.type);
  const record = codes[key];

  if (!record || record.verifiedAt) {
    return {
      success: false,
      message: 'No pending verification found. Please request a new code.',
      verified: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  if (new Date(record.expiresAt) < new Date()) {
    return {
      success: false,
      message: 'Verification code has expired. Please request a new code.',
      verified: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      success: false,
      message: 'Too many failed attempts. Please request a new code.',
      verified: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  record.attempts += 1;

  if (!matchesCode(input.code, record.codeHash)) {
    codes[key] = record;
    await writeStore(CODES_FILE(), codes);
    const remaining = MAX_ATTEMPTS - record.attempts;
    return {
      success: false,
      message: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      verified: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  record.verifiedAt = new Date().toISOString();
  codes[key] = record;
  await writeStore(CODES_FILE(), codes);
  await fallbackMarkVerified(input.userId, input.type);

  // Best-effort: also try updating the Supabase profile (ignored if the
  // columns do not exist yet).
  try {
    const supabase = getSupabaseAdmin();
    const verifiedField = input.type === 'email' ? 'email_verified' : 'phone_verified';
    await supabase
      .from('profiles')
      .update({ [verifiedField]: true, updated_at: record.verifiedAt })
      .eq('id', input.userId);
  } catch {
    // non-critical
  }

  return {
    success: true,
    message: `${input.type === 'email' ? 'Email' : 'Phone'} verified successfully`,
    verified: true,
    deploymentMarker: DEPLOYMENT_MARKER,
  };
}

interface VerificationCodeRecord {
  id: string;
  user_id: string;
  type: 'email' | 'phone';
  /** Legacy database column name; it contains a salted scrypt hash, never plaintext. */
  code: string;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
}

interface StoreCodeInput {
  userId: string;
  type: 'email' | 'phone';
}

interface VerifyCodeInput {
  userId: string;
  type: 'email' | 'phone';
  code: string;
}

interface VerificationResult {
  success: boolean;
  message: string;
  verified: boolean;
  deploymentMarker: string;
}

export async function storeVerificationCode(input: StoreCodeInput): Promise<VerificationResult> {
  const supabase = getSupabaseAdmin();
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);

  try {
    const { error } = await supabase.from('verification_codes').upsert(
      {
        user_id: input.userId,
        type: input.type,
        code: hashCode(code),
        attempts: 0,
        expires_at: expiresAt.toISOString(),
        verified_at: null,
        created_at: now.toISOString(),
      },
      { onConflict: 'user_id,type' }
    );

    if (error) {
      console.warn('[MemberVerification] Primary verification storage unavailable; attempting secure fallback.');
      await fallbackStoreCode(input, code, expiresAt);
    } else {
      console.info('[MemberVerification] Verification code stored.');
    }

    return {
      success: true,
      message: `Verification code generated`,
      verified: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  } catch (err) {
    console.warn('[MemberVerification] Primary verification storage request failed; attempting secure fallback.');
    try {
      await fallbackStoreCode(input, code, expiresAt);
      return {
        success: true,
        message: `Verification code generated`,
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    } catch {
      return {
        success: false,
        message: 'Internal error generating verification code',
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }
  }
}

export async function verifyCode(input: VerifyCodeInput): Promise<VerificationResult> {
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('user_id', input.userId)
      .eq('type', input.type)
      .is('verified_at', null)
      .maybeSingle();

    if (error) {
      console.warn('[MemberVerification] Primary verification lookup unavailable; attempting secure fallback.');
      return fallbackVerifyCode(input);
    }

    const record = data as VerificationCodeRecord | null;

    if (!record) {
      // The code may live in the fallback store (schema missing at send time).
      return fallbackVerifyCode(input);
    }

    // Check expiry
    if (new Date(record.expires_at) < new Date()) {
      return {
        success: false,
        message: 'Verification code has expired. Please request a new code.',
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    // Check attempts
    if (record.attempts >= MAX_ATTEMPTS) {
      return {
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    // Increment attempts
    const newAttempts = record.attempts + 1;

    if (!matchesCode(input.code, record.code)) {
      await supabase
        .from('verification_codes')
        .update({ attempts: newAttempts })
        .eq('id', record.id);

      const remaining = MAX_ATTEMPTS - newAttempts;
      return {
        success: false,
        message: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    // Code matches — mark verified
    const now = new Date().toISOString();
    await supabase
      .from('verification_codes')
      .update({ verified_at: now, attempts: newAttempts })
      .eq('id', record.id);

    // Update profile verification status
    const verifiedField = input.type === 'email' ? 'email_verified' : 'phone_verified';
    await supabase
      .from('profiles')
      .update({ [verifiedField]: true, updated_at: now })
      .eq('id', input.userId);

    // Log to audit
    try {
      await supabase.from('audit_logs').insert({
        user_id: input.userId,
        action: `verify_${input.type}`,
        details: JSON.stringify({ type: input.type, success: true }),
        created_at: now,
      });
    } catch {
      // non-critical
    }

    return {
      success: true,
      message: `${input.type === 'email' ? 'Email' : 'Phone'} verified successfully`,
      verified: true,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  } catch (err) {
    console.warn('[MemberVerification] Primary verification request failed; attempting secure fallback.');
    try {
      return await fallbackVerifyCode(input);
    } catch {
      return {
        success: false,
        message: 'Internal verification error',
        verified: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }
  }
}

export async function checkVerificationStatus(
  userId: string
): Promise<{ emailVerified: boolean; phoneVerified: boolean }> {
  const supabase = getSupabaseAdmin();

  let fromProfile: { emailVerified: boolean; phoneVerified: boolean } | null = null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email_verified, phone_verified')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      fromProfile = {
        emailVerified: !!(data as any)?.email_verified,
        phoneVerified: !!(data as any)?.phone_verified,
      };
    }
  } catch {
    fromProfile = null;
  }

  // Merge with the fallback status store (schema may be missing columns).
  try {
    const statuses = await readStore<FallbackStatusStore>(STATUS_FILE(), {});
    const fallback = statuses[userId];
    return {
      emailVerified: (fromProfile?.emailVerified ?? false) || !!fallback?.emailVerified,
      phoneVerified: (fromProfile?.phoneVerified ?? false) || !!fallback?.phoneVerified,
    };
  } catch {
    return fromProfile ?? { emailVerified: false, phoneVerified: false };
  }
}

export async function getRemainingCodeAttempts(
  userId: string,
  type: 'email' | 'phone'
): Promise<{ remaining: number; expiresAt: string | null }> {
  const supabase = getSupabaseAdmin();

  try {
    const { data } = await supabase
      .from('verification_codes')
      .select('attempts, expires_at')
      .eq('user_id', userId)
      .eq('type', type)
      .is('verified_at', null)
      .maybeSingle();

    if (!data) {
      // Check the fallback store before reporting no pending code.
      const codes = await readStore<FallbackCodesStore>(CODES_FILE(), {});
      const record = codes[codeKey(userId, type)];
      if (record && !record.verifiedAt) {
        return {
          remaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
          expiresAt: record.expiresAt,
        };
      }
      return { remaining: 0, expiresAt: null };
    }

    const record = data as { attempts: number; expires_at: string };
    return {
      remaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
      expiresAt: record.expires_at,
    };
  } catch {
    return { remaining: 0, expiresAt: null };
  }
}
