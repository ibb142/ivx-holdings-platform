import { resolveWireAuthenticatedMember } from './ivx-wire-transfer';

const ALLOWED_REASONS = new Set(['investment', 'resale_purchase', 'withdrawal']);

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Authorization',
  };
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: headers() });
}

export function handleSecureWalletOptions(): Response {
  return new Response(null, { status: 204, headers: headers() });
}

function serviceConfig(): { url: string; key: string } | null {
  const url = readTrimmed(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  return url && key ? { url, key } : null;
}

async function callAtomicDebit(input: {
  userId: string;
  amount: number;
  reason: string;
  description: string;
  referenceId?: string;
  referenceType?: string;
  fee: number;
}): Promise<{ success: boolean; message: string; transactionId?: string }> {
  const config = serviceConfig();
  if (!config) return { success: false, message: 'Financial settlement service is unavailable.' };

  const response = await fetch(`${config.url}/rest/v1/rpc/atomic_wallet_operation`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: input.userId,
      p_amount: input.amount,
      p_operation: 'debit',
      p_reason: input.reason,
      p_description: input.description,
      p_reference_id: input.referenceId ?? null,
      p_reference_type: input.referenceType ?? null,
      p_fee: input.fee,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    return { success: false, message: `Financial operation rejected (${response.status}).` };
  }

  const row = Array.isArray(payload) ? payload[0] : payload;
  const record = row && typeof row === 'object' ? row as Record<string, unknown> : {};
  return {
    success: record.success === true,
    message: readTrimmed(record.message) || (record.success === true ? 'OK' : 'Financial operation failed.'),
    transactionId: readTrimmed(record.transaction_id) || undefined,
  };
}

export async function handleSecureWalletDebit(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleSecureWalletOptions();
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  const member = await resolveWireAuthenticatedMember(request);
  if (!member) return json({ ok: false, authenticated: false, error: 'Authentication required.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const amount = Number(body.amount);
  const fee = body.fee == null ? 0 : Number(body.fee);
  const reason = readTrimmed(body.reason);
  const description = readTrimmed(body.description).slice(0, 240);
  const referenceId = readTrimmed(body.referenceId).slice(0, 160) || undefined;
  const referenceType = readTrimmed(body.referenceType).slice(0, 80) || undefined;

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return json({ ok: false, error: 'Invalid amount.' }, 400);
  }
  if (!Number.isFinite(fee) || fee < 0 || fee > amount) {
    return json({ ok: false, error: 'Invalid fee.' }, 400);
  }
  if (!ALLOWED_REASONS.has(reason)) {
    return json({ ok: false, error: 'Financial operation is not permitted from a member client.' }, 403);
  }
  if (!description) {
    return json({ ok: false, error: 'Description is required.' }, 400);
  }

  const result = await callAtomicDebit({
    userId: member.userId,
    amount,
    reason,
    description,
    referenceId,
    referenceType,
    fee,
  });

  return json(
    { ok: result.success, authenticated: true, transactionId: result.transactionId, message: result.message },
    result.success ? 200 : 409,
  );
}
