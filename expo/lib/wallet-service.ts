import { supabase } from './supabase';
import type { WalletRow } from '@/types/database';

export type WalletTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'investment'
  | 'sale_proceeds'
  | 'dividend'
  | 'refund'
  | 'fee'
  | 'resale_purchase'
  | 'resale_sale';

export type WalletTransactionDirection = 'credit' | 'debit';
export type WalletTransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface WalletTransaction {
  id: string;
  wallet_id?: string;
  user_id: string;
  type: WalletTransactionType;
  amount: number;
  direction: WalletTransactionDirection;
  status: WalletTransactionStatus;
  reference_id?: string;
  reference_type?: string;
  description: string;
  fee?: number;
  net_amount?: number;
  payment_method?: string;
  created_at: string;
}

export interface WalletBalance {
  available: number;
  pending: number;
  invested: number;
  total: number;
  currency: string;
}

const DEFAULT_BALANCE: WalletBalance = {
  available: 0,
  pending: 0,
  invested: 0,
  total: 0,
  currency: 'USD',
};

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

async function getAuthUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function getAuthenticatedWalletHeaders(userId: string): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user || user.id !== userId) return null;

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchWalletBalance(userId?: string): Promise<WalletBalance> {
  try {
    const authUser = await getAuthUser();
    const uid = userId || authUser?.id;
    if (!uid || !authUser || authUser.id !== uid) return DEFAULT_BALANCE;

    const { data, error } = await supabase
      .from('wallets')
      .select('available,pending,invested,total,currency')
      .eq('user_id', uid)
      .single();

    if (error || !data) return DEFAULT_BALANCE;
    const wallet = data as unknown as WalletRow;
    return {
      available: wallet.available ?? 0,
      pending: wallet.pending ?? 0,
      invested: wallet.invested ?? 0,
      total: wallet.total ?? (wallet.available ?? 0) + (wallet.invested ?? 0),
      currency: wallet.currency ?? 'USD',
    };
  } catch (err) {
    console.log('[WalletService] fetchWalletBalance error:', (err as Error)?.message);
    return DEFAULT_BALANCE;
  }
}

/**
 * Read-only wallet initialization contract. Browser/mobile clients do not create
 * or mutate wallet rows. The first settled backend operation creates the row.
 */
export async function ensureWallet(userId: string): Promise<WalletBalance> {
  return fetchWalletBalance(userId);
}

/**
 * Client-side ledger writes are intentionally disabled. Kept only for API
 * compatibility with older callers; new financial entries must be emitted by a
 * server-side atomic operation.
 */
export async function recordWalletTransaction(
  _tx: Omit<WalletTransaction, 'id' | 'created_at'>,
): Promise<string | null> {
  console.warn('[WalletService] Direct ledger write blocked; server settlement is required.');
  return null;
}

export async function fetchWalletTransactions(
  userId: string,
  limit: number = 30,
  offset: number = 0,
): Promise<WalletTransaction[]> {
  try {
    const authUser = await getAuthUser();
    if (!authUser || authUser.id !== userId) return [];

    const { data: wtxData, error: wtxError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!wtxError && wtxData && wtxData.length > 0) {
      return wtxData as unknown as WalletTransaction[];
    }

    const { data: txData, error: txError } = await supabase
      .from('transactions')
      .select('id,type,amount,status,description,property_id,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (txError || !txData) return [];
    return (txData as any[]).map((tx: any): WalletTransaction => ({
      id: tx.id,
      user_id: userId,
      type: tx.type as WalletTransactionType,
      amount: Math.abs(tx.amount ?? 0),
      direction: (tx.amount ?? 0) >= 0 ? 'credit' : 'debit',
      status: (tx.status as WalletTransactionStatus) || 'completed',
      reference_id: tx.property_id,
      reference_type: tx.property_id ? 'property' : undefined,
      description: tx.description || '',
      created_at: tx.created_at || new Date().toISOString(),
    }));
  } catch (err) {
    console.log('[WalletService] fetchWalletTransactions error:', (err as Error)?.message);
    return [];
  }
}

async function secureMemberDebit(input: {
  userId: string;
  amount: number;
  reason: 'investment' | 'resale_purchase' | 'withdrawal';
  description: string;
  referenceId?: string;
  referenceType?: string;
  fee?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: 'Invalid amount' };
  }

  const headers = await getAuthenticatedWalletHeaders(input.userId);
  if (!headers) return { success: false, error: 'Authentication required' };

  try {
    const response = await fetch(`${API_BASE}/api/ivx/wallet/debit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: input.amount,
        reason: input.reason,
        description: input.description,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        fee: input.fee ?? 0,
      }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || payload.ok !== true) {
      return { success: false, error: String(payload.message || payload.error || 'Financial operation was rejected') };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error)?.message || 'Financial service unavailable' };
  }
}

/** Credits are settlement-only. A member client can never mint balance. */
export async function creditWallet(
  _userId: string,
  _amount: number,
  _reason: WalletTransactionType,
  _description: string,
  _referenceId?: string,
  _referenceType?: string,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Credit requires verified server-side settlement.' };
}

export async function debitWallet(
  userId: string,
  amount: number,
  reason: WalletTransactionType,
  description: string,
  referenceId?: string,
  referenceType?: string,
): Promise<{ success: boolean; error?: string }> {
  if (reason !== 'investment' && reason !== 'resale_purchase' && reason !== 'withdrawal') {
    return { success: false, error: 'This debit type is not permitted from a member client.' };
  }
  return secureMemberDebit({
    userId,
    amount,
    reason,
    description,
    referenceId,
    referenceType,
  });
}

export async function processInvestmentDebit(
  userId: string,
  amount: number,
  propertyName: string,
  propertyId: string,
): Promise<{ success: boolean; error?: string }> {
  return secureMemberDebit({
    userId,
    amount,
    reason: 'investment',
    description: `Investment in ${propertyName}`,
    referenceId: propertyId,
    referenceType: 'property',
  });
}

/** Sale proceeds are credited only by a verified backend settlement workflow. */
export async function processSaleCredit(
  _userId: string,
  _netProceeds: number,
  _investedReduction: number,
  _propertyName: string,
  _propertyId: string,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Sale proceeds are credited after server-side settlement verification.' };
}

/** Deposits/wires cannot self-credit from the member client. */
export async function processDepositCredit(
  _userId: string,
  _amount: number,
  _fee: number,
  _paymentMethod: string,
  _transactionId: string,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Deposit credit requires verified settlement confirmation.' };
}

export async function processWithdrawalDebit(
  userId: string,
  amount: number,
  fee: number,
  withdrawMethod: string,
  withdrawalId: string,
): Promise<{ success: boolean; error?: string }> {
  return secureMemberDebit({
    userId,
    amount,
    reason: 'withdrawal',
    description: `Withdrawal via ${withdrawMethod}`,
    referenceId: withdrawalId,
    referenceType: 'withdrawal',
    fee,
  });
}
