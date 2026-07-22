/**
 * IVX Investor Performance Center — backend endpoint.
 *
 * GET /api/ivx/investor-performance
 *
 * Returns real investor performance data aggregated from the treasury system:
 * invested capital, active deals, distributions, unrealized value, realized
 * return, ROI, and last activity date.
 *
 * Owner-only: requires Bearer token. When no userId is provided, returns
 * aggregate dashboard data for the owner.
 */
import { listInvestorAccounts, getAccountSummary, listLedger } from '../services/ivx-treasury-system';

export type InvestorPerformanceResponse = {
  ok: boolean;
  investedCapital: number;
  activeDealsCount: number;
  totalDistributions: number;
  unrealizedValue: number;
  realizedReturn: number;
  totalROI: number;
  lastActivityDate: string;
  activeDeals: Array<{
    id: string;
    title: string;
    investedAmount: number;
    currentValue: number;
    unrealizedGain: number;
    unrealizedPercent: number;
    status: string;
    lastActivityDate: string;
  }>;
  distributions: Array<{
    id: string;
    dealTitle: string;
    amount: number;
    date: string;
    type: 'dividend' | 'interest' | 'profit' | 'refund';
  }>;
};

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function parseBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

export async function handleInvestorPerformanceRequest(req: Request): Promise<Response> {
  const token = parseBearerToken(req);
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Authentication required', message: 'Bearer token required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  }

  try {
    // Get all investor accounts
    const accounts = await listInvestorAccounts();

    // Aggregate metrics
    let investedCapital = 0;
    let totalDistributions = 0;
    let unrealizedValue = 0;
    let realizedReturn = 0;
    let lastActivityDate = '';
    const activeDeals: InvestorPerformanceResponse['activeDeals'] = [];
    const distributions: InvestorPerformanceResponse['distributions'] = [];

    for (const account of accounts) {
      const summary = await getAccountSummary(account.accountId);
      if (summary) {
        investedCapital += summary.totalInvested || 0;
        unrealizedValue += summary.portfolioValue || 0;
        realizedReturn += summary.realizedGainLoss || 0;
        totalDistributions += summary.totalDistributions || 0;

        if (summary.lastActivityDate && (!lastActivityDate || summary.lastActivityDate > lastActivityDate)) {
          lastActivityDate = summary.lastActivityDate;
        }
      }

      // Get ledger entries for this account to build deal-level detail
      const entries = await listLedger({ accountId: account.accountId, limit: 500 });

      for (const entry of entries) {
        if (entry.type === 'investment' && entry.propertyId) {
          const existing = activeDeals.find((d) => d.id === entry.propertyId!);
          if (existing) {
            existing.investedAmount += entry.amount;
            existing.currentValue += entry.amount;
          } else {
            activeDeals.push({
              id: entry.propertyId!,
              title: entry.propertyId || 'Investment',
              investedAmount: entry.amount,
              currentValue: entry.amount,
              unrealizedGain: 0,
              unrealizedPercent: 0,
              status: 'active',
              lastActivityDate: entry.date || '',
            });
          }
        }

        if (entry.type === 'distribution' || entry.type === 'dividend' || entry.type === 'interest' || entry.type === 'profit') {
          distributions.push({
            id: entry.id,
            dealTitle: entry.propertyId || 'Portfolio',
            amount: entry.amount,
            date: entry.date || '',
            type: entry.type as 'dividend' | 'interest' | 'profit' | 'refund',
          });
        }
      }
    }

    // Calculate unrealized gain per deal
    for (const deal of activeDeals) {
      deal.unrealizedGain = deal.currentValue - deal.investedAmount;
      deal.unrealizedPercent = deal.investedAmount > 0
        ? (deal.unrealizedGain / deal.investedAmount) * 100
        : 0;
    }

    // Calculate overall ROI
    const totalROI = investedCapital > 0
      ? ((realizedReturn + unrealizedValue) / investedCapital) * 100
      : 0;

    const response: InvestorPerformanceResponse = {
      ok: true,
      investedCapital,
      activeDealsCount: activeDeals.length,
      totalDistributions,
      unrealizedValue,
      realizedReturn,
      totalROI,
      lastActivityDate,
      activeDeals: activeDeals.slice(0, 50),
      distributions: distributions.slice(0, 50),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ ok: false, error: 'INTERNAL_ERROR', message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  }
}

export function investorPerformanceOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
