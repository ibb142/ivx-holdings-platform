/**
 * IVX Wire Transfer API
 *
 * Serves wire instructions securely from environment variables (never from
 * frontend code or GitHub) and records incoming wire notifications from
 * investors and app users. Sends an SMS to the owner when a new wire is
 * reported so funds can be matched and credited.
 *
 * Marker: ivx-wire-transfer-2026-08-12
 */

import { sendSnsSms } from '../services/ivx-sns-sms';

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
  error?: string;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    const id = `wire_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // TODO: persist to Supabase/DB here once schema is created.
    // For now, log a sanitized record and alert the owner via SMS.
    console.log('[IVXWireTransfer] submission received', {
      id,
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      sentAt: input.sentAt,
      referenceCode: input.referenceCode,
    });

    const ownerPhone = readTrimmed(process.env.IVX_OWNER_RECOVERY_PHONE);
    if (ownerPhone) {
      const message = [
        'IVX WIRE ALERT:',
        `${input.name || 'Investor'} ${input.email ? `(${input.email})` : ''}`,
        `reported a $${input.amount} ${input.currency} wire`,
        `sent ${input.sentAt}`,
        `ref: ${input.referenceCode}`,
      ].filter(Boolean).join(' ').slice(0, 320);
      await sendSnsSms({ to: ownerPhone, message, senderId: 'IVX' }).catch(() => {});
    }

    return { ok: true, id };
  } catch (error) {
    console.error('[IVXWireTransfer] recordWireSubmission failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Failed to record wire submission' };
  }
}
