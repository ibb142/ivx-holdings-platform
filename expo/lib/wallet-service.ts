import { supabase } from './supabase';
import type { WalletRow } from '@/types/database';
import { rpcAtomicWalletOp } from '@/lib/stored-procedures';

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

async function getAuthUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function fetchWalletBalance(userId?: string): Promise<WalletBalance> {
  try {
    const uid = userId || (await getAuthUser())?.id;
    if (!uid) {
      console.log('[WalletService] No user ID for balance fetch');
      return DEFAULT_BALANCE;
    }

    const { data, error } = await supabase
      .from('wallets')
      .select('available,pending,invested,total,currency')
      .eq('user_id', uid)
      .single();

    if (error || !data) {
      console.log('[WalletService] No wallet found, returning defaults');
      return DEFAULT_BALANCE;
    }

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

export async function ensureWallet(userId: string): Promise<WalletBalance> {
  const { data: wallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (wallet) {
    const w = wallet as unknown as WalletRow;
    return {
      available: w.available ?? 0,
      pending: w.pending ?? 0,
      invested: w.invested ?? 0,
      total: w.total ?? 0,
      currency: w.currency ?? 'USD',
    };
  }

  const { error } = await supabase
    .from('wallets')
    .insert({
      user_id: userId,
      available: 0,
      pending: 0,
      invested: 0,
      total: 0,
      currency: 'USD',
    });

  if (error) {
    console.log('[WalletService] Failed to create wallet:', error?.message);
  }

  return DEFAULT_BALANCE;
}

export async function recordWalletTransaction(tx: Omit<WalletTransaction, 'id' | 'created_at'>): Promise<string | null> {
  const txId = `wtx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    const { error } = await supabase
      .from('wallet_transactions')
      .insert({
        id: txId,
        wallet_id: tx.wallet_id,
        user_id: tx.user_id,
        type: tx.type,
        amount: tx.amount,
        direction: tx.direction,
        status: tx.status,
        reference_id: tx.reference_id,
        reference_type: tx.reference_type,
        description: tx.description,
        fee: tx.fee ?? 0,
        net_amount: tx.net_amount ?? tx.amount,
        payment_method: tx.payment_method,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.log('[WalletService] wallet_transactions insert failed (using transactions fallback):', error?.message);
      await supabase.from('transactions').insert({
        id: txId,
        user_id: tx.user_id,
        type: tx.type,
        amount: tx.direction === 'debit' ? -tx.amount : tx.amount,
        status: tx.status,
        description: tx.description,
        created_at: new Date().toISOString(),
      });
    }

    console.log('[WalletService] Transaction recorded:', txId, tx.type, tx.direction, tx.amount);
    return txId;
  } catch (err) {
    console.log('[WalletService] recordWalletTransaction error:', (err as Error)?.message);
    return null;
  }
}

export async function fetchWalletTransactions(
  userId: string,
  limit: number = 30,
  offset: number = 0
): Promise<WalletTransaction[]> {
  try {
    const { data: wtxData, error: wtxError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!wtxError && wtxData && wtxData.length > 0) {
      console.log('[WalletService] Loaded wallet_transactions:', wtxData.length);
      return (wtxData as unknown as WalletTransaction[]);
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
      direction: (tx.amount ?? 0) >= 0 ? 'credit' as const : 'debit' as const,
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

export async function creditWallet(
  userId: string,
  amount: number,
  reason: WalletTransactionType,
  description: string,
  referenceId?: string,
  referenceType?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Wallet credit is a SETTLEMENT operation. It runs exclusively through the
    // server-side atomic RPC, which is executable by service_role only.
    //
    // There is deliberately NO client-side fallback here. A previous revision fell
    // back to writing `wallets.available` / `wallets.total` directly from the client
    // whenever the RPC was unavailable — which is a member self-credit path: any
    // client able to reach the table could mint balance without a verified deposit.
    // Hardening the database (revoking EXECUTE from anon/authenticated) makes the RPC
    // refuse, and the old code treated that refusal as a reason to do the write
    // client-side anyway, defeating the hardening. It now FAILS CLOSED.
    const rpcResult = await rpcAtomicWalletOp({
      p_user_id: userId,
      p_amount: amount,
      p_operation: 'credit',
      p_reason: reason,
      p_description: description,
      p_reference_id: referenceId,
      p_reference_type: referenceType,
    });

    if (rpcResult.success) {
      console.log('[WalletService] Atomic settlement credit applied:', amount, reason);
      return { success: true };
    }

    console.log('[WalletService] Atomic settlement credit refused:', rpcResult.message);
    return {
      success: false,
      error: rpcResult.message || 'Wallet credit requires verified server-side settlement.',
    };
  } catch (err) {
    console.log('[WalletService] creditWallet error:', (err as Error)?.message);
    return { success: false, error: 'Wallet credit requires verified server-side settlement.' };
  }
}

export async function debitWallet(
  userId: string,
  amount: number,
  reason: WalletTransactionType,
  description: string,
  referenceId?: string,
  referenceType?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Wallet debit is also a LEDGER WRITE and runs exclusively through the
    // server-side atomic RPC. The removed client-side fallback recomputed the
    // balance in the client and wrote it back, so a tampered client could set an
    // arbitrary `available` value. Balance arithmetic must never be client-authored.
    // FAILS CLOSED.
    const rpcResult = await rpcAtomicWalletOp({
      p_user_id: userId,
      p_amount: amount,
      p_operation: 'debit',
      p_reason: reason,
      p_description: description,
      p_reference_id: referenceId,
      p_reference_type: referenceType,
    });

    if (rpcResult.success) {
      console.log('[WalletService] Atomic settlement debit applied:', amount, reason);
      return { success: true };
    }

    console.log('[WalletService] Atomic settlement debit refused:', rpcResult.message);
    return {
      success: false,
      error: rpcResult.message || 'Wallet debit requires verified server-side settlement.',
    };
  } catch (err) {
    console.log('[WalletService] debitWallet error:', (err as Error)?.message);
    return { success: false, error: 'Wallet debit requires verified server-side settlement.' };
  }
}

export async function processInvestmentDebit(
  userId: string,
  amount: number,
  propertyName: string,
  propertyId: string,
): Promise<{ success: boolean; error?: string }> {
  return debitWallet(
    userId,
    amount,
    'investment',
    `Investment in ${propertyName}`,
    propertyId,
    'property',
  );
}

export async function processSaleCredit(
  userId: string,
  netProceeds: number,
  investedReduction: number,
  propertyName: string,
  propertyId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Sale proceeds are a CREDIT plus an invested-balance reduction. Both are ledger
    // arithmetic and are performed server-side by the atomic settlement function,
    // which derives the invested adjustment from the reason code. The previous
    // client-side read-modify-write let a tampered client choose its own
    // `available` / `invested` values. FAILS CLOSED.
    void investedReduction;
    const rpcResult = await rpcAtomicWalletOp({
      p_user_id: userId,
      p_amount: netProceeds,
      p_operation: 'credit',
      p_reason: 'sale_proceeds',
      p_description: `Sale proceeds from ${propertyName}`,
      p_reference_id: propertyId,
      p_reference_type: 'property',
    });

    if (rpcResult.success) {
      console.log('[WalletService] Sale credit settled server-side:', netProceeds);
      return { success: true };
    }

    console.log('[WalletService] Sale credit refused:', rpcResult.message);
    return {
      success: false,
      error: rpcResult.message || 'Sale proceeds require verified server-side settlement.',
    };
  } catch (err) {
    console.log('[WalletService] processSaleCredit error:', (err as Error)?.message);
    return { success: false, error: 'Sale proceeds require verified server-side settlement.' };
  }
}

export async function processDepositCredit(
  userId: string,
  amount: number,
  fee: number,
  paymentMethod: string,
  transactionId: string,
): Promise<{ success: boolean; error?: string }> {
  const netAmount = amount - fee;
  try {
    const result = await creditWallet(
      userId,
      netAmount,
      'deposit',
      `Deposit via ${paymentMethod}`,
      transactionId,
      'deposit',
    );

    if (result.success && fee > 0) {
      await recordWalletTransaction({
        user_id: userId,
        type: 'fee',
        amount: fee,
        direction: 'debit',
        status: 'completed',
        reference_id: transactionId,
        reference_type: 'deposit_fee',
        description: `Processing fee for deposit via ${paymentMethod}`,
        fee,
        net_amount: 0,
        payment_method: paymentMethod,
      });
    }

    return result;
  } catch (err) {
    console.log('[WalletService] processDepositCredit error:', (err as Error)?.message);
    return { success: false, error: (err as Error)?.message };
  }
}

export async function processWithdrawalDebit(
  userId: string,
  amount: number,
  fee: number,
  withdrawMethod: string,
  withdrawalId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Withdrawal is a ledger DEBIT. The sufficient-funds check and the balance
    // arithmetic both run server-side inside the atomic settlement function: a
    // client-side balance check is advisory only and trivially bypassed. The
    // previous read-modify-write is removed. FAILS CLOSED.
    const rpcResult = await rpcAtomicWalletOp({
      p_user_id: userId,
      p_amount: amount,
      p_operation: 'debit',
      p_reason: 'withdrawal',
      p_description: `Withdrawal via ${withdrawMethod}`,
      p_reference_id: withdrawalId,
      p_reference_type: 'withdrawal',
      p_fee: fee,
    });

    if (rpcResult.success) {
      console.log('[WalletService] Withdrawal settled server-side:', amount, '| method:', withdrawMethod);
      return { success: true };
    }

    console.log('[WalletService] Withdrawal refused:', rpcResult.message);
    return {
      success: false,
      error: rpcResult.message || 'Withdrawal requires verified server-side settlement.',
    };
  } catch (err) {
    console.log('[WalletService] processWithdrawalDebit error:', (err as Error)?.message);
    return { success: false, error: 'Withdrawal requires verified server-side settlement.' };
  }
}
