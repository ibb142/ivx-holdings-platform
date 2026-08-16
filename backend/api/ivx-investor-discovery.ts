/**
 * IVX Investor Discovery API (owner-only).
 *
 * Real, named investors/buyers sourced from public SEC EDGAR Form D filings — the
 * legal, verifiable alternative to harvesting private contact data. Every record
 * carries a direct SEC filing link for proof.
 *
 *   GET  /api/ivx/investor-discovery        → run a discovery scan (query params)
 *   POST /api/ivx/investor-discovery/scan   → run a discovery scan (JSON body)
 *
 * Owner-only. No personal mobile numbers, no scraped private data.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  discoverInvestors,
  type InvestorDiscoveryClass,
  type InvestorDiscoveryOptions,
} from '../services/ivx-investor-discovery';
import { generateInvestorReport } from '../services/ivx-investor-report';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<Response | null> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
    const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeClass(value: unknown): InvestorDiscoveryClass | undefined {
  if (value === 'buyers' || value === 'jv_deals') return value;
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function buildOptions(source: Record<string, unknown>): InvestorDiscoveryOptions {
  const options: InvestorDiscoveryOptions = {};
  const query = source.query;
  if (typeof query === 'string' && query.trim()) options.query = query.trim();
  const discoveryClass = normalizeClass(source.discoveryClass ?? source.class);
  if (discoveryClass) options.discoveryClass = discoveryClass;
  const minOffering = toPositiveNumber(source.minOfferingUsd ?? source.minOffering);
  if (minOffering !== undefined) options.minOfferingUsd = minOffering;
  const limit = toPositiveNumber(source.limit);
  if (limit !== undefined) options.limit = limit;
  return options;
}

export async function handleInvestorDiscoveryGetRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const source: Record<string, unknown> = {
    query: url.searchParams.get('query') ?? undefined,
    discoveryClass: url.searchParams.get('discoveryClass') ?? url.searchParams.get('class') ?? undefined,
    minOfferingUsd: url.searchParams.get('minOfferingUsd') ?? url.searchParams.get('minOffering') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  };
  const result = await discoverInvestors(buildOptions(source));
  return ownerOnlyJson({ ok: result.ok, discovery: result as unknown as Record<string, unknown> });
}

export async function handleInvestorDiscoveryScanRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const result = await discoverInvestors(buildOptions(body));
  return ownerOnlyJson({ ok: result.ok, discovery: result as unknown as Record<string, unknown> });
}

/**
 * Run a real discovery AND generate a downloadable CSV report from it. This is
 * the endpoint IVX IA calls when the owner asks it to "do the report": it only
 * produces a file when real records exist, and the deliverable pipeline only
 * marks it complete after a verified download — never a fake/placeholder link.
 */
export async function handleInvestorReportRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const options = buildOptions(body);
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
  const requestId = typeof body.requestId === 'string' ? body.requestId : null;
  const waitForCompletion = body.waitForCompletion === true;
  const report = await generateInvestorReport({
    ...options,
    conversationId,
    requestId,
    waitForCompletion,
  });
  return ownerOnlyJson({ ok: report.ok, report: report as unknown as Record<string, unknown> }, report.ok ? 200 : 422);
}
