/**
 * IVX Owner System API Client
 *
 * Shared helper for calling the platform extensions API endpoints
 * (Points 5-8: owner system, compliance, payments, global core, pilot markets).
 */

import { supabase } from '@/lib/supabase';
import { getDirectApiBaseUrl } from '@/lib/api-base';

export async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function fetchOwnerApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAuthToken();
  const base = getDirectApiBaseUrl();

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => null) as T | null;
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error || `API error: ${res.status}`,
    );
  }
  return data as T;
}

// ---- Type definitions ----

export interface OwnerProfile {
  id: string;
  user_id: string;
  display_name: string;
  legal_name: string | null;
  entity_type: string;
  kyc_status: string;
  kyb_status: string;
  sanctions_status: string;
  accreditation_status: string;
  risk_rating: string;
  total_holdings_value: number;
  total_equity: number;
  total_annual_income: number;
  total_annual_expenses: number;
  total_properties: number;
  is_verified: boolean;
  preferred_currency: string;
  preferred_language: string;
}

export interface OwnerHolding {
  id: string;
  property_title: string;
  acquisition_date: string;
  acquisition_price: number;
  currency_code: string;
  current_value: number;
  outstanding_mortgage: number;
  equity: number;
  ownership_percentage: number;
  annual_rental_income: number;
  annual_expenses: number;
  annual_net_cash_flow: number;
  cap_rate: number | null;
  cash_on_cash_return: number | null;
  status: string;
  is_listed_for_sale: boolean;
  notes: string | null;
}

export interface IncomeExpenseEntry {
  id: string;
  entry_type: 'income' | 'expense';
  category: string;
  description: string | null;
  amount: number;
  currency_code: string;
  entry_date: string;
  recurring: boolean;
}

export interface OwnerDocument {
  id: string;
  document_type: string;
  title: string;
  description: string | null;
  file_url: string;
  is_verified: boolean;
  expiry_date: string | null;
  created_at: string;
}

export interface PortfolioSummary {
  total_properties: number;
  total_holdings_value: number;
  total_outstanding_mortgage: number;
  total_equity: number;
  total_annual_rental_income: number;
  total_annual_expenses: number;
  total_annual_net_cash_flow: number;
  blended_cap_rate: number;
  cash_on_cash_return: number;
}

export interface PortfolioData {
  ok: boolean;
  portfolio: {
    owner: OwnerProfile;
    summary: PortfolioSummary;
    holdings: OwnerHolding[];
    recent_transactions: IncomeExpenseEntry[];
    allocation_by_type: Record<string, number>;
    allocation_by_country: Record<string, number>;
  };
}

export interface ComplianceStep {
  id: string;
  step_name: string;
  step_type: string;
  status: string;
  assigned_role: string | null;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  review_notes: string | null;
  review_decision: string | null;
  risk_score: number;
  sort_order: number;
}

export interface PaymentRecord {
  id: string;
  payment_type: string;
  provider: string;
  provider_transaction_id: string | null;
  amount: number;
  currency_code: string;
  fee_amount: number;
  net_amount: number;
  status: string;
  failure_reason: string | null;
  completed_at: string | null;
  reconciliation_status: string;
  created_at: string;
}

export interface PilotMarket {
  id: string;
  market_name: string;
  country_iso: string;
  region_name: string;
  city: string;
  status: string;
  target_properties: number;
  active_properties: number;
  active_brokers: number;
  verified_properties: number;
  total_offers: number;
  closed_transactions: number;
  total_volume: number;
  total_revenue: number;
  avg_days_to_close: number | null;
  fraud_incidents: number;
  is_active: boolean;
}

// ---- API methods ----

export const ownerApi = {
  // Point 5: Owner system
  getProfile: () => fetchOwnerApi<{ ok: boolean; profile: OwnerProfile }>('/api/ivx/owner/profile'),
  updateProfile: (updates: Record<string, unknown>) =>
    fetchOwnerApi<{ ok: boolean; profile: OwnerProfile }>('/api/ivx/owner/profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  getHoldings: () => fetchOwnerApi<{ ok: boolean; holdings: OwnerHolding[] }>('/api/ivx/owner/holdings'),
  createHolding: (data: Record<string, unknown>) =>
    fetchOwnerApi<{ ok: boolean; holding: OwnerHolding }>('/api/ivx/owner/holdings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getIncomeExpenses: (type?: string) =>
    fetchOwnerApi<{ ok: boolean; entries: IncomeExpenseEntry[] }>(
      `/api/ivx/owner/income-expenses${type ? `?type=${type}` : ''}`,
    ),
  getDocuments: () => fetchOwnerApi<{ ok: boolean; documents: OwnerDocument[] }>('/api/ivx/owner/documents'),
  getPortfolio: () => fetchOwnerApi<PortfolioData>('/api/ivx/owner/portfolio'),
  getSnapshots: () => fetchOwnerApi<{ ok: boolean; snapshots: unknown[] }>('/api/ivx/owner/portfolio/snapshots'),

  // Point 6: Compliance
  getWorkflow: (status?: string) =>
    fetchOwnerApi<{ ok: boolean; steps: ComplianceStep[] }>(
      `/api/ivx/compliance/workflow${status ? `?status=${status}` : ''}`,
    ),
  getConsents: () => fetchOwnerApi<{ ok: boolean; consents: unknown[] }>('/api/ivx/compliance/consents'),
  getPermissions: (role?: string) =>
    fetchOwnerApi<{ ok: boolean; permissions: unknown[] }>(
      `/api/ivx/compliance/permissions${role ? `?role=${role}` : ''}`,
    ),

  // Point 7: Payments
  getPaymentRecords: () => fetchOwnerApi<{ ok: boolean; records: PaymentRecord[] }>('/api/ivx/payments/records'),
  getFeeStructures: () => fetchOwnerApi<{ ok: boolean; fees: unknown[] }>('/api/ivx/payments/fees'),
  getReconciliation: () => fetchOwnerApi<{ ok: boolean; records: unknown[] }>('/api/ivx/payments/reconciliation'),

  // Point 8: Global core
  getLanguages: () => fetchOwnerApi<{ ok: boolean; languages: unknown[] }>('/api/ivx/global/languages'),
  getTimezones: () => fetchOwnerApi<{ ok: boolean; timezones: unknown[] }>('/api/ivx/global/timezones'),
  getTaxRules: (jurisdictionId?: string) =>
    fetchOwnerApi<{ ok: boolean; taxRules: unknown[] }>(
      `/api/ivx/global/tax-rules${jurisdictionId ? `?jurisdictionId=${jurisdictionId}` : ''}`,
    ),

  // Point 10: Pilot markets
  getPilotMarkets: () => fetchOwnerApi<{ ok: boolean; markets: PilotMarket[] }>('/api/ivx/pilot/markets'),
};
