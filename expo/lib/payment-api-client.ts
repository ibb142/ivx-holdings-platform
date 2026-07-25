/**
 * IVX Payment API Client — mobile-side helper for calling payment endpoints.
 *
 * All financial calculations happen server-side. This client only:
 * - Sends the user's selection (pathway, share count, payment method)
 * - Receives the server-calculated amount + Stripe client secret
 * - Displays payment status from server (never assumes success from client)
 */

import { DIRECT_API_BASE_URL } from './public-api';

export interface PaymentConfigResponse {
  ok: boolean;
  config: {
    provider: 'stripe';
    environment: 'test' | 'live' | 'not_configured';
    stripeConfigured: boolean;
    testMode: boolean;
    webhookConfigured: boolean;
    publishableKey: string;
    capabilities: {
      card: boolean;
      ach: boolean;
      financialConnections: boolean;
      refunds: boolean;
    };
  };
}

export interface CreatePaymentRequest {
  dealId: string;
  pathway: 'tokenized' | 'jv' | 'buyer_deposit' | 'buyer_application_fee';
  paymentMethod: 'card' | 'ach_debit';
  shareCount?: number;
  amountCents?: number;
  acceptedTerms: boolean;
  idempotencyKey: string;
}

export interface CreatePaymentResponse {
  ok: boolean;
  paymentId?: string;
  providerPaymentIntentId?: string;
  clientSecret?: string;
  amountCents: number;
  state: string;
  traceId: string;
  error?: string;
  code?: string;
  testMode: boolean;
}

export interface PaymentStatusResponse {
  ok: boolean;
  payment?: {
    id: string;
    state: string;
    amountCents: number;
    pathway: string;
    providerPaymentIntentId: string | null;
    dealId: string;
    shareCount: number | null;
  };
  investment?: {
    id: string;
    state: string;
    sharesAllocated: number | null;
    ownershipPercent: number | null;
  };
  traceId: string;
}

export interface PortfolioResponse {
  ok: boolean;
  portfolio: Array<{
    id: string;
    dealId: string;
    dealTitle: string;
    dealSlug: string | null;
    pathway: string;
    sharesAllocated: number | null;
    ownershipPercent: number;
    amountCents: number;
    state: string;
    investmentState: string;
    createdAt: string;
  }>;
  traceId: string;
}

export interface JVApplicationRequest {
  dealId: string;
  amountCents: number;
  contributionType?: string;
  company?: string;
  experience?: string;
  proposedTerms?: string;
  requestedOwnership?: number;
  projectRole?: string;
  proofOfFundsUrl?: string;
  acceptedTerms: boolean;
}

export interface BuyerOfferRequest {
  dealId: string;
  offerAmountCents: number;
  financingType?: 'cash' | 'financing';
  downPaymentCents?: number;
  proofOfFundsUrl?: string;
  preapprovalUrl?: string;
  earnestMoneyCents?: number;
  inspectionPeriodDays?: number;
  closingDate?: string;
  contingencies?: string;
  brokerName?: string;
  offerExpirationDays?: number;
  message?: string;
  acceptedTerms: boolean;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

function buildUrl(path: string): string {
  const base = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';
  return `${base}${path}`;
}

export async function fetchPaymentConfig(): Promise<PaymentConfigResponse> {
  const res = await fetch(buildUrl('/api/ivx/payments/config'));
  return res.json() as Promise<PaymentConfigResponse>;
}

export async function createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/create'), {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });
  return res.json() as Promise<CreatePaymentResponse>;
}

export async function getPaymentStatus(paymentId: string): Promise<PaymentStatusResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl(`/api/ivx/payments/${paymentId}`), { headers });
  return res.json() as Promise<PaymentStatusResponse>;
}

export async function createBankLinkSession(): Promise<{ ok: boolean; clientSecret?: string; traceId: string; error?: string; testMode: boolean }> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/bank-link'), {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/portfolio'), { headers });
  return res.json() as Promise<PortfolioResponse>;
}

export async function fetchTransactions(): Promise<{ ok: boolean; transactions: any[]; traceId: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/transactions'), { headers });
  return res.json();
}

export async function submitJVApplication(req: JVApplicationRequest): Promise<{ ok: boolean; application?: any; message?: string; traceId: string; error?: string; code?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/jv-application'), {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });
  return res.json();
}

export async function submitBuyerOffer(req: BuyerOfferRequest): Promise<{ ok: boolean; offer?: any; message?: string; traceId: string; error?: string; code?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(buildUrl('/api/ivx/payments/buyer-offer'), {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });
  return res.json();
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateIdempotencyKey(userId: string, dealId: string): string {
  return `ivx-pay-${userId.slice(0, 12)}-${dealId.slice(0, 20)}-${Date.now()}`;
}
