/**
 * IVX Wire Transfer API
 *
 * Serves wire instructions securely from environment variables (never from
 * frontend code or GitHub) and records incoming wire notifications from
 * investors and app users. Sends an SMS to the owner when a new wire is
 * reported so funds can be matched and credited.
 *
 * Marker: ivx-wire-transfer-2026-08-20-bank-privacy
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

export function generateWireReferenceCode(userId: string): string {
  const base = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'IVX';
  const random = Math.floor(1000 + Math.random() * 8999);
  return `IVX-${base}-${random}`;
}

export async function recordWireSubmission(input: WireSubmissionInput): Promise<WireSubmissionResult> {
  try {
    // Durable persistence (Supabase-backed document store, survives restarts/deploys).
    const { record, duplicate, persisted } = await saveWireSubmission(input);
    const id = record.id;

    // Do not log investor email, bank name, account suffix or notes.
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
