/**
 * IVX Wire Transfer API
 *
 * Bank-grade contract:
 * - bank/routing/account details are never public and never stored in source
 * - every full instruction request requires a verified Supabase member JWT
 * - wire submission identity is derived from the verified JWT, never the body
 * - reference codes are bound to the authenticated member
 * - durable storage remains backend service-role only
 *
 * Marker: ivx-wire-transfer-2026-08-20-bank-privacy-v2
 */

import { createClient } from '@supabase/supabase-js';
import { sendSnsSms } from '../services/ivx-sns-sms';
import { saveWireSubmission } from '../services/ivx-wire-submission-store';
import type { WireSubmissionStatus } from '../services/ivx-wire-submission-store';

export type WireInstructions = {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  accountName: string;
  bankAddress: string;
  beneficiaryAddress: string;
  swiftCode?: string;
  referenceCode?: string;
  note?: string;
};

export type WireSubmissionInput = {
  userId?: string;
  email?: string;
  name?: string;
  amount: string;
  currency: string;
  sentAt: string;
  referenceCode: string;
  senderBankName?: string;
  senderAccountLast4?: string;
  receiptUrl?: string;
  notes?: string;
};

export type WireSubmissionResult = {
  ok: boolean;
  id?: string;
  status?: WireSubmissionStatus;
  persisted?: boolean;
  duplicate?: boolean;
  error?: string;
};

export type WireAuthenticatedMember = {
  userId: string;
  email?: string;
  name?: string;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wireHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin, Authorization',
  };
}

function wireJson(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: wireHeaders() });
}

export function handleWireOptions(): Response {
  return new Response(null, { status: 204, headers: wireHeaders() });
}

function getSupabaseAuthConfig(): { url: string; anonKey: string } | null {
  const url = readTrimmed(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const anonKey = readTrimmed(process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function resolveWireAuthenticatedMember(request: Request): Promise<WireAuthenticatedMember | null> {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const config = getSupabaseAuthConfig();
  if (!config) return null;

  try {
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user?.id) return null;

    const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const firstName = readTrimmed(metadata.first_name ?? metadata.firstName);
    const lastName = readTrimmed(metadata.last_name ?? metadata.lastName);
    const fullName = readTrimmed(metadata.full_name ?? metadata.name) || [firstName, lastName].filter(Boolean).join(' ');

    return {
      userId: data.user.id,
      email: readTrimmed(data.user.email) || undefined,
      name: fullName || undefined,
    };
  } catch {
    return null;
  }
}

export function getWireInstructions(): WireInstructions | null {
  const bankName = readTrimmed(process.env.IVX_WIRE_BANK_NAME);
  const routingNumber = readTrimmed(process.env.IVX_WIRE_ROUTING_NUMBER);
  const accountNumber = readTrimmed(process.env.IVX_WIRE_ACCOUNT_NUMBER);
  const accountName = readTrimmed(process.env.IVX_WIRE_ACCOUNT_NAME);
  const bankAddress = readTrimmed(process.env.IVX_WIRE_BANK_ADDRESS);
  const beneficiaryAddress = readTrimmed(process.env.IVX_WIRE_BENEFICIARY_ADDRESS);
  const swiftCode = readTrimmed(process.env.IVX_WIRE_SWIFT_CODE) || undefined;

  if (!bankName || !routingNumber || !accountNumber || !accountName || !bankAddress || !beneficiaryAddress) {
    return null;
  }

  return {
    bankName,
    routingNumber,
    accountNumber,
    accountName,
    bankAddress,
    beneficiaryAddress,
    swiftCode,
    note: swiftCode
      ? 'Include the SWIFT code for international wires. For domestic wires, use the routing number only.'
      : undefined,
  };
}

function memberReferencePrefix(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'IVX';
}

export function generateWireReferenceCode(userId: string): string {
  const base = memberReferencePrefix(userId);
  const random = Math.floor(1000 + Math.random() * 8999);
  return `IVX-${base}-${random}`;
}

export function isWireReferenceForMember(referenceCode: string, userId: string): boolean {
  const expectedPrefix = `IVX-${memberReferencePrefix(userId)}-`;
  return referenceCode.startsWith(expectedPrefix) && /^IVX-[A-Z0-9]{1,8}-\d{4}$/.test(referenceCode);
}

function validWireAmount(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function validIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return date.getTime() <= tomorrow.getTime();
}

export async function handleSecureWireInstructions(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleWireOptions();
  if (request.method !== 'GET') return wireJson({ ok: false, error: 'Method not allowed' }, 405);

  const member = await resolveWireAuthenticatedMember(request);
  if (!member) {
    return wireJson({
      ok: false,
      authenticated: false,
      error: 'Authentication required to view wire instructions.',
      cta: 'Sign in to view secure wire instructions',
    }, 401);
  }

  const instructions = getWireInstructions();
  if (!instructions) {
    return wireJson({
      ok: false,
      authenticated: true,
      error: 'Wire instructions are temporarily unavailable.',
    }, 503);
  }

  const referenceCode = generateWireReferenceCode(member.userId);
  console.log('[IVXWire] Secure instructions requested', { userIdPrefix: `${member.userId.slice(0, 6)}***` });
  return wireJson({
    ok: true,
    authenticated: true,
    instructions: { ...instructions, referenceCode },
    timestamp: new Date().toISOString(),
  });
}

export async function handleSecureWireSubmission(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleWireOptions();
  if (request.method !== 'POST') return wireJson({ ok: false, error: 'Method not allowed' }, 405);

  const member = await resolveWireAuthenticatedMember(request);
  if (!member) {
    return wireJson({ ok: false, authenticated: false, error: 'Authentication required.' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return wireJson({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const amount = readTrimmed(body.amount);
  const referenceCode = readTrimmed(body.referenceCode).toUpperCase();
  const sentAt = readTrimmed(body.sentAt);
  const currency = (readTrimmed(body.currency) || 'USD').toUpperCase();
  const senderBankName = readTrimmed(body.senderBankName).slice(0, 120) || undefined;
  const senderAccountLast4Raw = readTrimmed(body.senderAccountLast4);
  const senderAccountLast4 = senderAccountLast4Raw || undefined;
  const receiptUrl = readTrimmed(body.receiptUrl).slice(0, 1000) || undefined;
  const notes = readTrimmed(body.notes).slice(0, 1000) || undefined;

  if (!validWireAmount(amount)) {
    return wireJson({ ok: false, error: 'A valid positive wire amount is required.' }, 400);
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return wireJson({ ok: false, error: 'Currency must be a 3-letter ISO code.' }, 400);
  }
  if (!validIsoDate(sentAt)) {
    return wireJson({ ok: false, error: 'sentAt must be a valid YYYY-MM-DD date and cannot be in the future.' }, 400);
  }
  if (!isWireReferenceForMember(referenceCode, member.userId)) {
    return wireJson({ ok: false, error: 'Wire reference code does not belong to the authenticated member.' }, 403);
  }
  if (senderAccountLast4 && !/^\d{4}$/.test(senderAccountLast4)) {
    return wireJson({ ok: false, error: 'Sender account last four must contain exactly 4 digits.' }, 400);
  }

  const result = await recordWireSubmission({
    userId: member.userId,
    email: member.email,
    name: member.name,
    amount,
    currency,
    sentAt,
    referenceCode,
    senderBankName,
    senderAccountLast4,
    receiptUrl,
    notes,
  });

  return wireJson({ ...result, authenticated: true }, result.ok ? 200 : 500);
}

export async function recordWireSubmission(input: WireSubmissionInput): Promise<WireSubmissionResult> {
  try {
    const { record, duplicate, persisted } = await saveWireSubmission(input);
    const id = record.id;

    // Never log email, full user ID, sender bank, account suffix, receipt URL or notes.
    console.log('[IVXWireTransfer] submission recorded', {
      id,
      userIdPrefix: input.userId ? `${input.userId.slice(0, 6)}***` : undefined,
      amount: input.amount,
      currency: input.currency,
      sentAt: input.sentAt,
      referenceCode: input.referenceCode,
      duplicate,
      persisted,
    });

    const ownerPhone = readTrimmed(process.env.IVX_OWNER_RECOVERY_PHONE);
    if (ownerPhone && !duplicate) {
      const message = [
        'IVX WIRE ALERT:',
        input.name || 'Investor',
        `reported a $${input.amount} ${input.currency} wire`,
        `sent ${input.sentAt}`,
        `ref: ${input.referenceCode}`,
      ].filter(Boolean).join(' ').slice(0, 320);
      await sendSnsSms({ to: ownerPhone, message, senderId: 'IVX' }).catch(() => {});
    }

    return { ok: true, id, status: record.status, persisted, duplicate };
  } catch (error) {
    console.error('[IVXWireTransfer] recordWireSubmission failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Failed to record wire submission' };
  }
}
