/**
 * IVX Agent Real Tools — Phase 2 least-privilege executor.
 *
 * Every agent gets one harmless public IVX proof tool. Private CRM access is
 * role-scoped; create and update capabilities are distinct. Financial, trade,
 * legal execution and production deployment are never implemented here.
 */
import { createHash } from 'node:crypto';
import {
  insertProspects,
  fetchProspects,
  updateProspect,
  insertAlert,
  type ProspectRow,
} from './ivx-agent-persistence';
import {
  getAgentRealToolEntitlements,
  type AgentRealToolId,
} from './ivx-agent-least-privilege';

export const IVX_REAL_TOOLS_MARKER = 'ivx-agent-real-tools-2026-08-20-least-privilege-v2';
const SEC_USER_AGENT = 'IVX Holdings admin@ivxholding.com';
const IVX_PUBLIC_URL = 'https://ivxholding.com';

export type RealToolId = AgentRealToolId;
export const PROHIBITED_TOOL_IDS = ['money_movement', 'trade_execution', 'legal_execution'] as const;
export const APPROVAL_GATED_TOOL_IDS = ['production_deploy', 'external_outreach'] as const;

export type RealToolResult = {
  ok: boolean;
  toolId: string;
  toolResultId: string;
  sourceReference: string;
  httpStatus: number;
  contentSha256: string;
  summary: string;
  extract: Record<string, unknown>;
  costUsd: number;
  credentialBinding: string;
  durationMs: number;
  error: string | null;
  blocked: boolean;
};

export type RealToolParams = Record<string, unknown>;

function toolFailure(toolId: string, error: string, httpStatus = 0, blocked = false, credentialBinding = 'none(public_api)'): RealToolResult {
  return {
    ok: false,
    toolId,
    toolResultId: '',
    sourceReference: '',
    httpStatus,
    contentSha256: '',
    summary: '',
    extract: {},
    costUsd: 0,
    credentialBinding,
    durationMs: 0,
    error,
    blocked,
  };
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function makeToolResultId(toolId: string): string {
  return `tr-${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getPermittedRealTools(agentNumber: number): RealToolId[] {
  return getAgentRealToolEntitlements(agentNumber);
}

export function isToolPermitted(agentNumber: number, toolId: string): boolean {
  return (getPermittedRealTools(agentNumber) as string[]).includes(toolId);
}

async function alertBlocked(agentId: string, agentNumber: number, toolId: string, detail: string, severity: 'warning' | 'critical' = 'warning'): Promise<void> {
  await insertAlert({
    alert_type: 'prohibited_tool_attempt',
    agent_id: agentId,
    severity,
    detail: `Agent ${agentId} (#${agentNumber}) tool ${toolId}: ${detail}`,
  }).catch(() => undefined);
}

async function fetchWithEvidence(
  toolId: RealToolId,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  credentialBinding: string,
  summarize: (raw: string, response: Response) => { summary: string; extract: Record<string, unknown> },
): Promise<RealToolResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text();
    if (!res.ok) {
      return { ...toolFailure(toolId, `HTTP ${res.status}: ${raw.slice(0, 180)}`, res.status, false, credentialBinding), durationMs: Date.now() - start };
    }
    const { summary, extract } = summarize(raw, res);
    return {
      ok: true,
      toolId,
      toolResultId: makeToolResultId(toolId),
      sourceReference: url,
      httpStatus: res.status,
      contentSha256: sha256(raw),
      summary,
      extract,
      costUsd: 0,
      credentialBinding,
      durationMs: Date.now() - start,
      error: null,
      blocked: false,
    };
  } catch (err) {
    return { ...toolFailure(toolId, err instanceof Error ? err.message : String(err), 0, false, credentialBinding), durationMs: Date.now() - start };
  }
}

const CRM_TYPE_BY_AGENT: Record<number, ProspectRow['prospect_type'][]> = {
  7: ['investor'], 17: ['investor'], 18: ['investor'],
  19: ['buyer'], 20: ['buyer'], 21: ['buyer'], 48: ['buyer'],
  27: ['partner'],
  28: ['jv'], 29: ['jv'], 30: ['jv'], 46: ['jv'], 47: ['jv'],
  31: ['tokenized_asset'], 32: ['tokenized_asset'],
  53: ['investor'], 54: ['investor'], 55: ['investor'],
};

const CRM_CREATE_TYPE_BY_AGENT: Record<number, ProspectRow['prospect_type']> = {
  17: 'investor', 19: 'buyer', 27: 'partner', 28: 'jv', 31: 'tokenized_asset', 32: 'tokenized_asset',
};

function requestedProspectType(agentNumber: number, raw: unknown): ProspectRow['prospect_type'] | null {
  const requested = String(raw ?? '');
  const allowed = CRM_TYPE_BY_AGENT[agentNumber] ?? [];
  return allowed.find((type) => type === requested) ?? allowed[0] ?? null;
}

function safeCrmUpdatePatch(agentNumber: number, raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (agentNumber === 20) {
    if (typeof source.score === 'number' && Number.isFinite(source.score) && source.score >= 0 && source.score <= 100) patch.score = source.score;
    if (source.score_breakdown && typeof source.score_breakdown === 'object' && !Array.isArray(source.score_breakdown)) patch.score_breakdown = source.score_breakdown;
    if (typeof source.qualified === 'boolean') patch.qualified = source.qualified;
    if (source.status === 'qualified' || source.status === 'needs_review') patch.status = source.status;
  } else if (agentNumber === 21) {
    if (source.status === 'followup_scheduled') patch.status = source.status;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function executeRealTool(
  agentId: string,
  agentNumber: number,
  toolId: string,
  params: RealToolParams,
  options: { timeoutMs?: number; ownerApprovalToken?: string | null } = {},
): Promise<RealToolResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;

  if ((PROHIBITED_TOOL_IDS as readonly string[]).includes(toolId)) {
    await alertBlocked(agentId, agentNumber, toolId, 'permanently prohibited financial/trade/legal execution', 'critical');
    return toolFailure(toolId, `Tool "${toolId}" is permanently prohibited for all agents.`, 0, true);
  }

  if ((APPROVAL_GATED_TOOL_IDS as readonly string[]).includes(toolId)) {
    await alertBlocked(agentId, agentNumber, toolId, 'not executable inside autonomous research runtime');
    return toolFailure(toolId, `Tool "${toolId}" is intentionally unavailable in the autonomous runtime.`, 0, true);
  }

  if (!isToolPermitted(agentNumber, toolId)) {
    await alertBlocked(agentId, agentNumber, toolId, `outside least-privilege entitlement [${getPermittedRealTools(agentNumber).join(', ')}]`);
    return toolFailure(toolId, `Tool "${toolId}" is not permitted for agent #${agentNumber}.`, 0, true);
  }

  const tool = toolId as RealToolId;

  switch (tool) {
    case 'ivx_public_landing':
      return fetchWithEvidence(tool, IVX_PUBLIC_URL, { headers: { Accept: 'text/html' } }, timeoutMs, 'none(ivx_public)', (raw, res) => ({
        summary: `IVX public landing reachable: HTTP ${res.status}, ${raw.length} bytes`,
        extract: { host: 'ivxholding.com', bytes: raw.length, publicOnly: true },
      }));

    case 'sec_edgar_fulltext': {
      const q = String(params.query ?? '').slice(0, 120);
      if (!q) return toolFailure(tool, 'query param required');
      const forms = params.forms ? `&forms=${encodeURIComponent(String(params.forms))}` : '';
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}${forms}`;
      return fetchWithEvidence(tool, url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' } }, timeoutMs, 'none(sec_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { hits?: { total?: { value?: number }; hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } };
        const total = parsed.hits?.total?.value ?? 0;
        const first = parsed.hits?.hits?.[0];
        const names = Array.isArray(first?._source?.display_names) ? first?._source?.display_names as string[] : [];
        const cik = (names[0] ?? '').match(/CIK (\d+)/)?.[1] ?? null;
        const accession = String(first?._id ?? '').split(':')[0] ?? '';
        const fileDate = String(first?._source?.file_date ?? '');
        const filingUrl = cik && accession ? `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession.replace(/-/g, '')}/` : url;
        return {
          summary: `SEC EDGAR "${q}": ${total} filings; top ${names[0] ?? 'n/a'}`,
          extract: { query: q, totalFilings: total, topEntity: names[0] ?? null, cik, accession, fileDate, incStates: first?._source?.inc_states ?? null, filingUrl },
        };
      });
    }

    case 'sec_edgar_submissions': {
      const cikRaw = String(params.cik ?? '').replace(/\D/g, '');
      if (!cikRaw) return toolFailure(tool, 'cik param required');
      const cik = cikRaw.padStart(10, '0');
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      return fetchWithEvidence(tool, url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' } }, timeoutMs, 'none(sec_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { name?: string; sicDescription?: string; stateOfIncorporation?: string; filings?: { recent?: { form?: string[] } } };
        return {
          summary: `SEC submissions for ${parsed.name ?? cik}`,
          extract: { cik, name: parsed.name ?? null, sicDescription: parsed.sicDescription ?? null, stateOfIncorporation: parsed.stateOfIncorporation ?? null, recentForms: parsed.filings?.recent?.form?.slice(0, 5) ?? [] },
        };
      });
    }

    case 'wikipedia_search': {
      const q = String(params.query ?? '').slice(0, 120);
      if (!q) return toolFailure(tool, 'query param required');
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&srprop=timestamp`;
      return fetchWithEvidence(tool, url, { headers: { 'User-Agent': SEC_USER_AGENT } }, timeoutMs, 'none(wikipedia_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { query?: { search?: Array<{ title?: string; timestamp?: string }> } };
        const rows = parsed.query?.search ?? [];
        const top = rows[0];
        return {
          summary: `Wikipedia "${q}": ${rows.length} results; top ${top?.title ?? 'n/a'}`,
          extract: { query: q, resultCount: rows.length, topTitle: top?.title ?? null, topPageUrl: top?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title.replace(/ /g, '_'))}` : url, titles: rows.map((r) => r.title ?? '') },
        };
      });
    }

    case 'worldbank_indicator': {
      const country = String(params.country ?? 'USA').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'USA';
      const indicator = String(params.indicator ?? 'NY.GDP.MKTP.CD').slice(0, 40);
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=3`;
      return fetchWithEvidence(tool, url, {}, timeoutMs, 'none(worldbank_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as [unknown, Array<{ date?: string; value?: number | null; indicator?: { value?: string } }>];
        const latest = (Array.isArray(parsed?.[1]) ? parsed[1] : []).find((r) => r.value !== null && r.value !== undefined);
        return { summary: `World Bank ${indicator}/${country}: ${latest?.value ?? 'n/a'}`, extract: { country, indicator, latestValue: latest?.value ?? null, latestYear: latest?.date ?? null, indicatorName: latest?.indicator?.value ?? null } };
      });
    }

    case 'frankfurter_fx': {
      const base = String(params.base ?? 'USD').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'USD';
      const url = `https://api.frankfurter.dev/v1/latest?base=${base}`;
      return fetchWithEvidence(tool, url, {}, timeoutMs, 'none(frankfurter_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { date?: string; rates?: Record<string, number> };
        return { summary: `ECB FX ${base} ${parsed.date ?? 'n/a'}`, extract: { base, date: parsed.date ?? null, rateCount: Object.keys(parsed.rates ?? {}).length, eur: parsed.rates?.EUR ?? null, gbp: parsed.rates?.GBP ?? null, jpy: parsed.rates?.JPY ?? null } };
      });
    }

    case 'crm_read': {
      const type = requestedProspectType(agentNumber, params.prospectType);
      if (!type) return toolFailure(tool, `Agent #${agentNumber} has no CRM record-type scope.`, 0, true);
      const start = Date.now();
      const limit = Math.min(20, Math.max(1, Number(params.limit ?? 10) || 10));
      const res = await fetchProspects(type, limit);
      if (!res.ok) return { ...toolFailure(tool, res.error ?? 'CRM read failed', res.status, false, res.credentialBinding), durationMs: Date.now() - start };
      const rows = res.data ?? [];
      const raw = JSON.stringify(rows.map((row) => ({ id: row.id, type: row.prospect_type, status: row.status, score: row.score, qualified: row.qualified })));
      return {
        ok: true, toolId: tool, toolResultId: makeToolResultId(tool),
        sourceReference: `supabase://ivx_crm_prospects?prospect_type=${type} (${rows.length} records)`,
        httpStatus: res.status, contentSha256: sha256(raw), summary: `CRM read: ${rows.length} ${type} records`,
        extract: { prospectType: type, count: rows.length, recordIds: rows.slice(0, 10).map((r) => r.id) },
        costUsd: 0, credentialBinding: res.credentialBinding, durationMs: Date.now() - start, error: null, blocked: false,
      };
    }

    case 'crm_write': {
      const start = Date.now();
      const row = (params as { prospectRow?: ProspectRow }).prospectRow;
      const allowedType = CRM_CREATE_TYPE_BY_AGENT[agentNumber];
      if (!row || !allowedType || row.prospect_type !== allowedType) return toolFailure(tool, 'CRM create type outside agent scope.', 0, true);
      if (row.agent_id !== agentId || row.company_scope !== 'ivx_holdings') return toolFailure(tool, 'CRM identity/company scope mismatch.', 0, true);
      if (row.compliance_gate !== 'blocked_pending_approval') return toolFailure(tool, 'CRM autonomous create requires blocked_pending_approval.', 0, true);
      if (!row.dedup_key || !row.name || !row.source_url) return toolFailure(tool, 'dedup_key, name and source_url required');
      const res = await insertProspects([row]);
      if (!res.ok) return { ...toolFailure(tool, res.error ?? 'CRM write failed', res.status, false, res.credentialBinding), durationMs: Date.now() - start };
      const inserted = Array.isArray(res.data) ? res.data : [];
      const recordId = inserted[0]?.id ?? null;
      const raw = JSON.stringify({ recordId, prospectType: row.prospect_type, dedupKey: row.dedup_key });
      return {
        ok: true, toolId: tool, toolResultId: makeToolResultId(tool),
        sourceReference: recordId ? `supabase://ivx_crm_prospects/${recordId}` : `supabase://ivx_crm_prospects?dedup=${row.prospect_type}:${row.dedup_key}`,
        httpStatus: res.status, contentSha256: sha256(raw), summary: recordId ? `CRM create ${row.prospect_type} ${recordId}` : 'CRM create deduplicated',
        extract: { crmRecordId: recordId, deduplicated: !recordId, dedupKey: row.dedup_key, prospectType: row.prospect_type, complianceGate: row.compliance_gate },
        costUsd: 0, credentialBinding: res.credentialBinding, durationMs: Date.now() - start, error: null, blocked: false,
      };
    }

    case 'crm_update': {
      const start = Date.now();
      const recordId = String(params.recordId ?? '').trim();
      const type = requestedProspectType(agentNumber, params.prospectType);
      const patch = safeCrmUpdatePatch(agentNumber, params.patch);
      if (!recordId || !type || !patch) return toolFailure(tool, 'Invalid or out-of-scope CRM update.', 0, true);
      const scoped = await fetchProspects(type, 20);
      if (!scoped.ok) return { ...toolFailure(tool, scoped.error ?? 'CRM scope read failed', scoped.status, false, scoped.credentialBinding), durationMs: Date.now() - start };
      if (!(scoped.data ?? []).some((row) => row.id === recordId)) return toolFailure(tool, 'CRM record outside permitted record-type scope.', 0, true);
      const res = await updateProspect(recordId, patch);
      if (!res.ok) return { ...toolFailure(tool, res.error ?? 'CRM update failed', res.status, false, res.credentialBinding), durationMs: Date.now() - start };
      const raw = JSON.stringify({ recordId, type, patch });
      return {
        ok: true, toolId: tool, toolResultId: makeToolResultId(tool), sourceReference: `supabase://ivx_crm_prospects/${recordId}`,
        httpStatus: res.status, contentSha256: sha256(raw), summary: `CRM scoped update ${recordId}`,
        extract: { crmRecordId: recordId, prospectType: type, updatedFields: Object.keys(patch) },
        costUsd: 0, credentialBinding: res.credentialBinding, durationMs: Date.now() - start, error: null, blocked: false,
      };
    }
  }
}

export function scoreProspect(input: {
  hasRecentFiling: boolean;
  fileDate: string | null;
  fieldsPresent: number;
  fieldsTotal: number;
  jurisdictionPresent: boolean;
  sourceAuthority: 'sec' | 'wikipedia' | 'worldbank' | 'crm' | 'other';
}): { score: number; breakdown: Record<string, number> } {
  let recency = 0;
  if (input.hasRecentFiling && input.fileDate) {
    const ageDays = Math.max(0, (Date.now() - new Date(input.fileDate).getTime()) / 86_400_000);
    recency = ageDays < 90 ? 40 : ageDays < 365 ? 30 : ageDays < 1095 ? 18 : 8;
  }
  const completeness = Math.round((input.fieldsPresent / Math.max(1, input.fieldsTotal)) * 30);
  const jurisdiction = input.jurisdictionPresent ? 15 : 0;
  const authority = input.sourceAuthority === 'sec' ? 15 : input.sourceAuthority === 'worldbank' ? 12 : input.sourceAuthority === 'wikipedia' ? 9 : 6;
  const breakdown = { recency, completeness, jurisdiction, authority };
  return { score: Math.min(100, recency + completeness + jurisdiction + authority), breakdown };
}

export function makeDedupKey(prospectType: string, name: string): string {
  return sha256(`${prospectType}:${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`).slice(0, 40);
}

export type CertMission = {
  taskType: string;
  description: string;
  toolPlan: Array<{ toolId: RealToolId; params: RealToolParams }>;
};

const SPECIAL_QUERY: Record<number, CertMission> = {
  2: { taskType: 'acquisition_sourcing', description: 'SEC acquisition research', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'real estate acquisition', forms: '8-K' } }] },
  3: { taskType: 'underwriting_data', description: 'SEC underwriting research', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'net operating income real estate', forms: '10-K' } }] },
  6: { taskType: 'finance_reference_rates', description: 'ECB FX reference rates', toolPlan: [{ toolId: 'frankfurter_fx', params: { base: 'USD' } }] },
  7: { taskType: 'investor_relations_research', description: 'SEC investor communications', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'investor relations update', forms: '8-K' } }] },
  8: { taskType: 'compliance_monitoring', description: 'SEC compliance research', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'regulation d exemption', forms: 'D' } }] },
  11: { taskType: 'qa_source_verification', description: 'SEC source integrity', toolPlan: [{ toolId: 'sec_edgar_submissions', params: { cik: '320193' } }] },
  12: { taskType: 'global_intelligence', description: 'World Bank GDP intelligence', toolPlan: [{ toolId: 'worldbank_indicator', params: { country: 'WLD', indicator: 'NY.GDP.MKTP.CD' } }] },
};

export function getCertMission(agentNumber: number, agentName: string, mission: string): CertMission {
  if (SPECIAL_QUERY[agentNumber]) return SPECIAL_QUERY[agentNumber];
  const allowed = getPermittedRealTools(agentNumber).filter((tool) => tool !== 'crm_write' && tool !== 'crm_update');
  if (allowed.includes('worldbank_indicator')) return { taskType: 'market_data_research', description: `World Bank evidence for ${agentName}`, toolPlan: [{ toolId: 'worldbank_indicator', params: { country: 'USA', indicator: 'NY.GDP.MKTP.CD' } }] };
  if (allowed.includes('wikipedia_search')) return { taskType: 'public_source_research', description: `Public evidence for ${agentName}`, toolPlan: [{ toolId: 'wikipedia_search', params: { query: mission.slice(0, 80) || agentName } }] };
  if (allowed.includes('sec_edgar_fulltext')) return { taskType: 'public_filing_research', description: `SEC evidence for ${agentName}`, toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'real estate' } }] };
  if (allowed.includes('frankfurter_fx')) return { taskType: 'market_reference_research', description: `FX evidence for ${agentName}`, toolPlan: [{ toolId: 'frankfurter_fx', params: { base: 'USD' } }] };
  if (allowed.includes('crm_read')) {
    const type = CRM_TYPE_BY_AGENT[agentNumber]?.[0] ?? 'buyer';
    return { taskType: 'crm_pipeline_review', description: `Scoped CRM evidence for ${agentName}`, toolPlan: [{ toolId: 'crm_read', params: { prospectType: type, limit: 10 } }] };
  }
  return { taskType: 'ivx_public_verification', description: `Harmless public IVX verification for ${agentName}`, toolPlan: [{ toolId: 'ivx_public_landing', params: {} }] };
}

export const SPECIAL_MISSION_AGENTS: readonly number[] = [17, 19, 20, 21, 27, 28, 31, 32];
export type SpecialMissionResult = { taskType: string; toolResults: RealToolResult[]; outputData: Record<string, unknown> };

function filingProspectFromEdgar(
  edgar: RealToolResult,
  prospectType: ProspectRow['prospect_type'],
  agentId: string,
  taskId: string,
  extraData: Record<string, unknown> = {},
): ProspectRow | null {
  const entity = typeof edgar.extract.topEntity === 'string' ? edgar.extract.topEntity : null;
  const filingUrl = typeof edgar.extract.filingUrl === 'string' ? edgar.extract.filingUrl : edgar.sourceReference;
  if (!entity || !filingUrl) return null;
  const fileDate = typeof edgar.extract.fileDate === 'string' ? edgar.extract.fileDate : null;
  const incStates = edgar.extract.incStates;
  const jurisdiction = Array.isArray(incStates) && incStates.length ? String(incStates[0]) : typeof incStates === 'string' && incStates ? incStates : 'US-federal (SEC EDGAR filing)';
  const name = entity.replace(/\s*\(CIK.*\)\s*$/, '').trim();
  const { score, breakdown } = scoreProspect({ hasRecentFiling: Boolean(fileDate), fileDate, fieldsPresent: [name, filingUrl, fileDate, edgar.extract.cik].filter(Boolean).length, fieldsTotal: 4, jurisdictionPresent: Boolean(jurisdiction), sourceAuthority: 'sec' });
  return {
    prospect_type: prospectType,
    dedup_key: makeDedupKey(prospectType, name),
    name,
    source_url: filingUrl,
    source_tool: 'sec_edgar_fulltext',
    jurisdiction,
    score,
    score_breakdown: breakdown,
    qualified: score >= 50,
    status: 'new',
    compliance_gate: 'blocked_pending_approval',
    agent_id: agentId,
    task_id: taskId,
    company_scope: 'ivx_holdings',
    data: { fileDate, cik: edgar.extract.cik ?? null, ...extraData },
  };
}

export async function executeSpecialMission(agentId: string, agentNumber: number, taskId: string, timeoutMs: number): Promise<SpecialMissionResult | null> {
  const run = (toolId: string, params: RealToolParams) => executeRealTool(agentId, agentNumber, toolId, params, { timeoutMs });

  if (agentNumber === 17 || agentNumber === 19 || agentNumber === 28 || agentNumber === 31 || agentNumber === 32) {
    const config: Record<number, { taskType: string; query: string; forms?: string; type: ProspectRow['prospect_type']; data?: Record<string, unknown> }> = {
      17: { taskType: 'investor_lead_acquisition', query: 'private placement real estate fund', forms: 'D', type: 'investor', data: { regulatedSolicitation: 'owner_approval_required' } },
      19: { taskType: 'buyer_acquisition', query: 'real estate purchase agreement', forms: '8-K', type: 'buyer' },
      28: { taskType: 'jv_deal_origination', query: 'joint venture real estate development', forms: '8-K', type: 'jv' },
      31: { taskType: 'tokenization_feasibility', query: 'tokenized real estate offering', type: 'tokenized_asset', data: { legalReviewStatus: 'requires_independent_review', securitiesApprovalClaimed: false } },
      32: { taskType: 'tokenized_market_research', query: 'digital asset securities', forms: 'D', type: 'tokenized_asset', data: { legalReviewStatus: 'requires_independent_review', securitiesApprovalClaimed: false } },
    };
    const cfg = config[agentNumber];
    const edgar = await run('sec_edgar_fulltext', { query: cfg.query, forms: cfg.forms });
    if (!edgar.ok) return { taskType: cfg.taskType, toolResults: [edgar], outputData: {} };
    const row = filingProspectFromEdgar(edgar, cfg.type, agentId, taskId, cfg.data);
    if (!row) return { taskType: cfg.taskType, toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
    const write = await run('crm_write', { prospectRow: row });
    return { taskType: cfg.taskType, toolResults: [edgar, write], outputData: { prospect: row.name, prospectType: row.prospect_type, source: row.source_url, crmRecordId: write.extract.crmRecordId ?? null, complianceGate: row.compliance_gate, ...(cfg.data ?? {}) } };
  }

  if (agentNumber === 27) {
    const wiki = await run('wikipedia_search', { query: 'real estate investment trust United States' });
    if (!wiki.ok) return { taskType: 'partnership_development', toolResults: [wiki], outputData: {} };
    const name = typeof wiki.extract.topTitle === 'string' ? wiki.extract.topTitle : '';
    const source = typeof wiki.extract.topPageUrl === 'string' ? wiki.extract.topPageUrl : wiki.sourceReference;
    if (!name) return { taskType: 'partnership_development', toolResults: [wiki], outputData: { note: 'no partner extracted' } };
    const row: ProspectRow = { prospect_type: 'partner', dedup_key: makeDedupKey('partner', name), name, source_url: source, source_tool: 'wikipedia_search', jurisdiction: null, score: 24, score_breakdown: { authority: 9, completeness: 15 }, qualified: false, status: 'new', compliance_gate: 'blocked_pending_approval', agent_id: agentId, task_id: taskId, company_scope: 'ivx_holdings', data: { category: 'strategic_partner_research' } };
    const write = await run('crm_write', { prospectRow: row });
    return { taskType: 'partnership_development', toolResults: [wiki, write], outputData: { partner: name, source, crmRecordId: write.extract.crmRecordId ?? null, outreach: 'owner_approval_required' } };
  }

  if (agentNumber === 20) {
    const read = await run('crm_read', { prospectType: 'buyer', limit: 10 });
    if (!read.ok) return { taskType: 'buyer_qualification', toolResults: [read], outputData: {} };
    const buyers = await fetchProspects('buyer', 10);
    const target = buyers.ok ? buyers.data?.[0] : null;
    if (!target) return { taskType: 'buyer_qualification', toolResults: [read], outputData: { qualifiedBuyers: 0 } };
    const data = target.data ?? {};
    const { score, breakdown } = scoreProspect({ hasRecentFiling: Boolean(data.fileDate), fileDate: typeof data.fileDate === 'string' ? data.fileDate : null, fieldsPresent: [target.name, target.source_url, target.jurisdiction, data.cik].filter(Boolean).length, fieldsTotal: 4, jurisdictionPresent: Boolean(target.jurisdiction), sourceAuthority: target.source_tool.startsWith('sec') ? 'sec' : 'crm' });
    const update = await run('crm_update', { recordId: target.id, prospectType: 'buyer', patch: { score, score_breakdown: breakdown, qualified: score >= 50, status: score >= 50 ? 'qualified' : 'needs_review' } });
    return { taskType: 'buyer_qualification', toolResults: [read, update], outputData: { crmRecordId: target.id, score, qualified: score >= 50 } };
  }

  if (agentNumber === 21) {
    const read = await run('crm_read', { prospectType: 'buyer', limit: 10 });
    if (!read.ok) return { taskType: 'buyer_follow_up', toolResults: [read], outputData: {} };
    const buyers = await fetchProspects('buyer', 10);
    const targets = buyers.ok ? (buyers.data ?? []).slice(0, 3) : [];
    const updates: RealToolResult[] = [];
    for (const target of targets) updates.push(await run('crm_update', { recordId: target.id, prospectType: 'buyer', patch: { status: 'followup_scheduled' } }));
    return { taskType: 'buyer_follow_up', toolResults: [read, ...updates], outputData: { queueDepth: targets.length, externalOutreachSent: 0, outreachPolicy: 'owner approval required before outreach' } };
  }

  return null;
}
