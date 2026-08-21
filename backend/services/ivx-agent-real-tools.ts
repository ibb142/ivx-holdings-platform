/**
 * IVX Agent Real Tools — verifiable external tool layer for the 112 IA agents.
 *
 * Rules enforced here:
 *   - Every permitted tool performs a REAL network/database operation and returns
 *     a toolResultId + sourceReference + content hash (verifiable evidence).
 *   - Prohibited tools (money_movement, trade_execution, legal_execution) are
 *     ALWAYS blocked and raise a persistent prohibited_tool_attempt alert.
 *   - Approval-gated tools (production_deploy, external_outreach) are blocked
 *     without an owner approval token.
 *   - Per-agent tool permissions: an agent calling a tool outside its permitted
 *     set is blocked + alerted.
 *   - External tool failure is NEVER replaced with synthetic output. No fake
 *     success fallback. A failed tool means a failed execution.
 *   - On HTTP 401/403 the exact runtime credential binding used is logged.
 *
 * Real sources:
 *   sec_edgar_fulltext  — SEC EDGAR full-text search (efts.sec.gov) — public, verifiable
 *   sec_edgar_submissions — SEC EDGAR company submissions (data.sec.gov)
 *   wikipedia_search    — Wikipedia search API — public, verifiable
 *   worldbank_indicator — World Bank open data API — public, verifiable
 *   frankfurter_fx      — ECB reference FX rates via frankfurter.dev
 *   crm_read / crm_write — the real IVX CRM (Supabase ivx_crm_prospects)
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
  executeEngineeringTool,
  isEngineeringTool,
  ENGINEERING_TOOL_IDS,
  OWNER_APPROVAL_ENGINEERING_TOOLS,
  type EngineeringToolId,
} from './ivx-agent-engineering-tools';
import {
  executeMutationTool,
  isMutationTool,
  verifyOwnerApproval,
  type MutationToolResult,
} from './ivx-agent-mutation-tools';

export const IVX_REAL_TOOLS_MARKER = 'ivx-agent-real-tools-2026-08-18';

const SEC_USER_AGENT = 'IVX Holdings admin@ivxholding.com';

// ── Tool identifiers ─────────────────────────────────────────────────────────

export type RealToolId =
  | 'sec_edgar_fulltext'
  | 'sec_edgar_submissions'
  | 'wikipedia_search'
  | 'worldbank_indicator'
  | 'frankfurter_fx'
  | 'crm_read'
  | 'crm_write'
  | EngineeringToolId;

export const PROHIBITED_TOOL_IDS = ['money_movement', 'trade_execution', 'legal_execution'] as const;
/**
 * Tools requiring an explicit owner approval token. Everything that WRITES —
 * source files, commits, pushes, deploys — lives here by design: the owner
 * requires authorization before any code is modified on their behalf.
 */
export const APPROVAL_GATED_TOOL_IDS = [
  'production_deploy',
  'external_outreach',
  ...OWNER_APPROVAL_ENGINEERING_TOOLS,
] as const;

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

// ── Per-agent tool permissions ───────────────────────────────────────────────

/**
 * Permitted real tools per agent number. Baseline research tools for everyone;
 * CRM write access only for acquisition/qualification/partnership agents.
 */
export function getPermittedRealTools(agentNumber: number): RealToolId[] {
  const base: RealToolId[] = ['wikipedia_search', 'worldbank_indicator', 'frankfurter_fx', 'crm_read'];
  const edgar: RealToolId[] = ['sec_edgar_fulltext', 'sec_edgar_submissions'];
  const crmWriteAgents = new Set([2, 7, 17, 18, 19, 20, 21, 27, 28, 29, 30, 31, 32]);
  const edgarAgents = new Set([
    2, 3, 6, 7, 8, 11, 12, 17, 18, 19, 20, 22, 24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 41, 46, 47, 48, 49, 50,
  ]);
  const tools: RealToolId[] = [...base];
  if (edgarAgents.has(agentNumber)) tools.push(...edgar);
  if (crmWriteAgents.has(agentNumber)) tools.push('crm_write');
  if (ENGINEERING_AGENT_NUMBERS.has(agentNumber)) tools.push(...ENGINEERING_TOOL_IDS);
  return tools;
}

/**
 * Owner directive 2026-08-21: the ENTIRE 112-agent fleet holds the real
 * read-only engineering toolset (code_read, code_search, typecheck, run_tests,
 * lint, secret_scan) so every agent can ground its work in the actual
 * codebase. Every MUTATING capability (code_write, git_commit, git_push,
 * deploy, …) stays behind the owner approval gate — nothing in this set can
 * modify the repository.
 */
export const ENGINEERING_AGENT_NUMBERS: ReadonlySet<number> = new Set(
  Array.from({ length: 112 }, (_, i) => i + 1),
);

export function isEngineeringAgent(agentNumber: number): boolean {
  return ENGINEERING_AGENT_NUMBERS.has(agentNumber);
}

export function isToolPermitted(agentNumber: number, toolId: string): boolean {
  return (getPermittedRealTools(agentNumber) as string[]).includes(toolId);
}

// ── Core executor ────────────────────────────────────────────────────────────

async function fetchWithEvidence(
  toolId: RealToolId,
  url: string,
  sourceReference: string,
  init: RequestInit,
  timeoutMs: number,
  credentialBinding: string,
  summarize: (raw: string) => { summary: string; extract: Record<string, unknown> },
): Promise<RealToolResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text();
    if (res.status === 401 || res.status === 403) {
      console.error('[IVXRealTools] AUTH FAILURE — credential binding rejected', {
        toolId,
        httpStatus: res.status,
        credentialBinding,
        host: new URL(url).host,
      });
    }
    if (!res.ok) {
      return { ...toolFailure(toolId, `HTTP ${res.status}: ${raw.slice(0, 180)}`, res.status, false, credentialBinding), durationMs: Date.now() - start };
    }
    const { summary, extract } = summarize(raw);
    return {
      ok: true,
      toolId,
      toolResultId: makeToolResultId(toolId),
      sourceReference,
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

export type RealToolParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Execute a real permitted tool for an agent. Enforces prohibitions, approval
 * gates, and the per-agent permission matrix. Never fabricates output.
 */
export async function executeRealTool(
  agentId: string,
  agentNumber: number,
  toolId: string,
  params: RealToolParams,
  options: { timeoutMs?: number; ownerApprovalToken?: string | null } = {},
): Promise<RealToolResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;

  // 1) Hard prohibitions — money movement, trade execution, legal execution
  if ((PROHIBITED_TOOL_IDS as readonly string[]).includes(toolId)) {
    await insertAlert({
      alert_type: 'prohibited_tool_attempt',
      agent_id: agentId,
      severity: 'critical',
      detail: `Agent ${agentId} (#${agentNumber}) attempted PROHIBITED tool "${toolId}" — blocked. Money movement, trade execution, and legal execution remain prohibited.`,
    }).catch(() => undefined);
    return toolFailure(toolId, `Tool "${toolId}" is permanently prohibited for all agents.`, 0, true);
  }

  // 2) Approval-gated tools — code writes, commits, pushes, deploys, outreach.
  if ((APPROVAL_GATED_TOOL_IDS as readonly string[]).includes(toolId)) {
    // The token must be VERIFIED against the configured owner token. Presence
    // alone is not authorization: the previous gate accepted any truthy string.
    const approval = verifyOwnerApproval(options.ownerApprovalToken);
    if (!approval.approved) {
      await insertAlert({
        alert_type: 'prohibited_tool_attempt',
        agent_id: agentId,
        severity: 'warning',
        detail: `Agent ${agentId} (#${agentNumber}) attempted approval-gated tool "${toolId}" without valid owner approval (${approval.reason}) — blocked pending approval/compliance gate.`,
      }).catch(() => undefined);
      return toolFailure(toolId, `Tool "${toolId}" requires owner approval — ${approval.reason}.`, 0, true);
    }

    // Approved AND implemented: run the real mutation pipeline.
    if (isMutationTool(toolId)) {
      const mutated = await executeMutationTool(toolId, params as Record<string, unknown>, {
        ownerApprovalToken: options.ownerApprovalToken,
        timeoutMs: options.timeoutMs,
      });
      return mutationToEvidence(mutated, approval.binding);
    }

    // `external_outreach` remains policy-blocked: it is a compliance decision,
    // not a missing implementation.
    return toolFailure(
      toolId,
      `Tool "${toolId}" is owner-approved but remains blocked by the outreach compliance policy.`,
      0,
      true,
    );
  }

  // 3) Per-agent permission matrix
  if (!isToolPermitted(agentNumber, toolId)) {
    await insertAlert({
      alert_type: 'prohibited_tool_attempt',
      agent_id: agentId,
      severity: 'warning',
      detail: `Agent ${agentId} (#${agentNumber}) attempted tool "${toolId}" outside its permitted set [${getPermittedRealTools(agentNumber).join(', ')}] — blocked.`,
    }).catch(() => undefined);
    return toolFailure(toolId, `Tool "${toolId}" is not in agent #${agentNumber}'s permitted tool set.`, 0, true);
  }

  // 4) Real engineering tools — executed locally, read-only, verifiable.
  if (isEngineeringTool(toolId)) {
    const engineered = await executeEngineeringTool(toolId, params, { timeoutMs: options.timeoutMs });
    return engineeringToEvidence(engineered);
  }

  const tool = toolId as RealToolId;

  switch (tool) {
    case 'sec_edgar_fulltext': {
      const q = String(params.query ?? '').slice(0, 120);
      if (!q) return toolFailure(tool, 'query param required');
      const forms = params.forms ? `&forms=${encodeURIComponent(String(params.forms))}` : '';
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}${forms}`;
      return fetchWithEvidence(tool, url, url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' } }, timeoutMs, 'none(sec_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { hits?: { total?: { value?: number }; hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } };
        const total = parsed.hits?.total?.value ?? 0;
        const first = parsed.hits?.hits?.[0];
        const displayNames = Array.isArray(first?._source?.display_names) ? (first?._source?.display_names as string[]) : [];
        const cikMatch = (displayNames[0] ?? '').match(/CIK (\d+)/);
        const accession = String(first?._id ?? '').split(':')[0] ?? '';
        const fileDate = String(first?._source?.file_date ?? '');
        const incStates = first?._source?.inc_states;
        const filingUrl = cikMatch && accession
          ? `https://www.sec.gov/Archives/edgar/data/${parseInt(cikMatch[1], 10)}/${accession.replace(/-/g, '')}/`
          : url;
        return {
          summary: `SEC EDGAR full-text search "${q}": ${total} filings; top: ${displayNames[0] ?? 'n/a'} (${fileDate})`,
          extract: {
            query: q,
            totalFilings: total,
            topEntity: displayNames[0] ?? null,
            cik: cikMatch ? cikMatch[1] : null,
            accession,
            fileDate,
            incStates: incStates ?? null,
            filingUrl,
          },
        };
      });
    }

    case 'sec_edgar_submissions': {
      const cikRaw = String(params.cik ?? '').replace(/\D/g, '');
      if (!cikRaw) return toolFailure(tool, 'cik param required');
      const cik = cikRaw.padStart(10, '0');
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      return fetchWithEvidence(tool, url, url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' } }, timeoutMs, 'none(sec_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { name?: string; sicDescription?: string; stateOfIncorporation?: string; filings?: { recent?: { form?: string[] } } };
        const recentForms = parsed.filings?.recent?.form?.slice(0, 5) ?? [];
        return {
          summary: `SEC submissions for ${parsed.name ?? cik}: ${parsed.sicDescription ?? 'n/a'}, state ${parsed.stateOfIncorporation ?? 'n/a'}, recent forms ${recentForms.join(',')}`,
          extract: {
            cik,
            name: parsed.name ?? null,
            sicDescription: parsed.sicDescription ?? null,
            stateOfIncorporation: parsed.stateOfIncorporation ?? null,
            recentForms,
          },
        };
      });
    }

    case 'wikipedia_search': {
      const q = String(params.query ?? '').slice(0, 120);
      if (!q) return toolFailure(tool, 'query param required');
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&srprop=snippet|timestamp`;
      return fetchWithEvidence(tool, url, url, { headers: { 'User-Agent': SEC_USER_AGENT } }, timeoutMs, 'none(wikipedia_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { query?: { search?: Array<{ title?: string; timestamp?: string; snippet?: string }> } };
        const results = parsed.query?.search ?? [];
        const top = results[0];
        const pageUrl = top?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title.replace(/ /g, '_'))}` : url;
        return {
          summary: `Wikipedia "${q}": ${results.length} results; top: ${top?.title ?? 'n/a'} (${top?.timestamp ?? ''})`,
          extract: {
            query: q,
            resultCount: results.length,
            topTitle: top?.title ?? null,
            topPageUrl: pageUrl,
            titles: results.map((r) => r.title ?? ''),
          },
        };
      });
    }

    case 'worldbank_indicator': {
      const country = String(params.country ?? 'USA').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'USA';
      const indicator = String(params.indicator ?? 'NY.GDP.MKTP.CD').slice(0, 40);
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=3`;
      return fetchWithEvidence(tool, url, url, {}, timeoutMs, 'none(worldbank_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as [unknown, Array<{ date?: string; value?: number | null; country?: { value?: string }; indicator?: { value?: string } }>];
        const rows = Array.isArray(parsed?.[1]) ? parsed[1] : [];
        const latest = rows.find((r) => r.value !== null && r.value !== undefined);
        return {
          summary: `World Bank ${indicator} for ${country}: ${latest?.value ?? 'n/a'} (${latest?.date ?? 'n/a'}) — ${latest?.indicator?.value ?? ''}`,
          extract: {
            country,
            indicator,
            latestValue: latest?.value ?? null,
            latestYear: latest?.date ?? null,
            indicatorName: latest?.indicator?.value ?? null,
          },
        };
      });
    }

    case 'frankfurter_fx': {
      const base = String(params.base ?? 'USD').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'USD';
      const url = `https://api.frankfurter.dev/v1/latest?base=${base}`;
      return fetchWithEvidence(tool, url, url, {}, timeoutMs, 'none(frankfurter_public_api)', (raw) => {
        const parsed = JSON.parse(raw) as { date?: string; rates?: Record<string, number> };
        const rates = parsed.rates ?? {};
        return {
          summary: `ECB FX rates base ${base} (${parsed.date ?? 'n/a'}): EUR=${rates.EUR ?? 'n/a'}, GBP=${rates.GBP ?? 'n/a'}, JPY=${rates.JPY ?? 'n/a'}`,
          extract: { base, date: parsed.date ?? null, eur: rates.EUR ?? null, gbp: rates.GBP ?? null, jpy: rates.JPY ?? null, rateCount: Object.keys(rates).length },
        };
      });
    }

    case 'crm_read': {
      const start = Date.now();
      const type = (['buyer', 'investor', 'tokenized_asset', 'partner', 'jv'] as const).find((t) => t === String(params.prospectType ?? 'buyer')) ?? 'buyer';
      const res = await fetchProspects(type, Number(params.limit ?? 20) || 20);
      if (!res.ok) {
        return { ...toolFailure(tool, res.error ?? 'CRM read failed', res.status, false, res.credentialBinding), durationMs: Date.now() - start };
      }
      const rows = res.data ?? [];
      const raw = JSON.stringify(rows);
      // Publish the exact HTTPS PostgREST URL that was actually fetched. The
      // previous `supabase://` scheme was not resolvable and therefore not
      // independently verifiable evidence. No credentials appear in this URL.
      const restUrl = res.sourceUrl ?? '';
      return {
        ok: true,
        toolId: tool,
        toolResultId: makeToolResultId(tool),
        sourceReference: restUrl || `supabase://ivx_crm_prospects?prospect_type=${type} (${rows.length} records)`,
        httpStatus: res.status,
        contentSha256: sha256(raw),
        summary: `CRM read: ${rows.length} ${type} prospects from ivx_crm_prospects`,
        extract: {
          prospectType: type,
          count: rows.length,
          recordIds: rows.slice(0, 10).map((r) => r.id),
          topNames: rows.slice(0, 5).map((r) => r.name),
          restEndpoint: restUrl,
          sourceReferenceResolvable: restUrl.startsWith('https://'),
        },
        costUsd: 0,
        credentialBinding: res.credentialBinding,
        durationMs: Date.now() - start,
        error: null,
        blocked: false,
      };
    }

    case 'crm_write': {
      const start = Date.now();
      const prospect = params as unknown as { prospectRow?: ProspectRow };
      const row = prospect.prospectRow;
      if (!row || !row.dedup_key || !row.name || !row.source_url) {
        return toolFailure(tool, 'prospectRow with dedup_key, name, source_url required');
      }
      const res = await insertProspects([row]);
      if (!res.ok) {
        return { ...toolFailure(tool, res.error ?? 'CRM write failed', res.status, false, res.credentialBinding), durationMs: Date.now() - start };
      }
      const inserted = Array.isArray(res.data) ? res.data : [];
      const recordId = inserted[0]?.id ?? null;
      const deduplicated = inserted.length === 0;
      const raw = JSON.stringify({ row, recordId, deduplicated });
      return {
        ok: true,
        toolId: tool,
        toolResultId: makeToolResultId(tool),
        sourceReference: res.sourceUrl
          ? (recordId
            ? `${res.sourceUrl}?id=eq.${recordId}`
            : `${res.sourceUrl}?prospect_type=eq.${row.prospect_type}&dedup_key=eq.${encodeURIComponent(row.dedup_key)}`)
          : (recordId
            ? `supabase://ivx_crm_prospects/${recordId} (source: ${row.source_url})`
            : `supabase://ivx_crm_prospects?dedup=${row.prospect_type}:${row.dedup_key} (duplicate prevented; source: ${row.source_url})`),
        httpStatus: res.status,
        contentSha256: sha256(raw),
        summary: deduplicated
          ? `CRM write deduplicated: ${row.prospect_type} "${row.name}" already exists (dedup key ${row.dedup_key.slice(0, 12)}…)`
          : `CRM write: created ${row.prospect_type} prospect "${row.name}" record ${recordId}`,
        extract: { crmRecordId: recordId, deduplicated, dedupKey: row.dedup_key, prospectType: row.prospect_type, complianceGate: row.compliance_gate },
        costUsd: 0,
        credentialBinding: res.credentialBinding,
        durationMs: Date.now() - start,
        error: null,
        blocked: false,
      };
    }

    case 'code_read':
    case 'code_search':
    case 'typecheck':
    case 'run_tests':
    case 'lint':
    case 'secret_scan':
      // Handled by the engineering branch above; unreachable.
      return toolFailure(toolId, `Engineering tool "${toolId}" was not routed to the engineering executor.`);

    default:
      return toolFailure(toolId, `Unknown real tool: ${toolId}`);
  }
}

/**
 * Adapt a real engineering-tool execution into the shared evidence envelope.
 * `httpStatus` 200 denotes a completed local execution — NOT a passing result.
 * A red typecheck or a failing test suite is a successful tool call whose
 * evidence records the failure; correctness is read from `extract.passed`.
 */
function engineeringToEvidence(res: Awaited<ReturnType<typeof executeEngineeringTool>>): RealToolResult {
  if (!res.ok) {
    return { ...toolFailure(res.toolId, res.error ?? 'engineering tool failed', 0, false, 'none(local_exec)'), durationMs: res.durationMs };
  }
  return {
    ok: true,
    toolId: res.toolId,
    toolResultId: makeToolResultId(res.toolId),
    sourceReference: res.sourceReference,
    httpStatus: 200,
    contentSha256: res.contentSha256,
    summary: res.summary,
    extract: { ...res.extract, exitCode: res.exitCode },
    costUsd: 0,
    credentialBinding: 'none(local_exec)',
    durationMs: res.durationMs,
    error: null,
    blocked: false,
  };
}

/**
 * Adapt a real mutation-tool execution into the shared evidence envelope.
 *
 * A refusal by the verification gate is a REAL result and is surfaced as a
 * failure with its evidence intact — never as a silent success.
 */
function mutationToEvidence(res: MutationToolResult, credentialBinding: string): RealToolResult {
  if (!res.ok) {
    return {
      ...toolFailure(res.toolId, res.error ?? 'mutation tool failed', 0, false, credentialBinding),
      extract: res.extract,
      durationMs: res.durationMs,
    };
  }
  return {
    ok: true,
    toolId: res.toolId,
    toolResultId: makeToolResultId(res.toolId),
    sourceReference: res.sourceReference,
    httpStatus: 200,
    contentSha256: res.contentSha256,
    summary: res.summary,
    extract: { ...res.extract, exitCode: res.exitCode, approvalVerified: res.approvalVerified },
    costUsd: 0,
    credentialBinding,
    durationMs: res.durationMs,
    error: null,
    blocked: false,
  };
}

// ── Objective prospect scoring (deterministic, real-data based) ──────────────

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

// ── Cert mission plans — one real mission per agent ──────────────────────────

export type CertMission = {
  taskType: string;
  description: string;
  toolPlan: Array<{ toolId: RealToolId; params: RealToolParams }>;
};

const WB_INDICATORS: Array<[string, string]> = [
  ['USA', 'NY.GDP.MKTP.CD'], ['USA', 'FP.CPI.TOTL.ZG'], ['USA', 'FR.INR.RINR'], ['WLD', 'NY.GDP.MKTP.KD.ZG'],
  ['USA', 'SL.UEM.TOTL.ZS'], ['EUU', 'NY.GDP.MKTP.CD'], ['CHN', 'NY.GDP.MKTP.KD.ZG'], ['USA', 'HOU.STA.TOTL'],
  ['USA', 'NE.GDI.TOTL.ZS'], ['LCN', 'NY.GDP.MKTP.KD.ZG'], ['USA', 'IT.NET.USER.ZS'], ['WLD', 'SP.POP.TOTL'],
];

/**
 * Role-appropriate REAL mission for every agent 1..112.
 * Special deep missions for IA-17/19/20/21/27/28/31/32 are defined in the
 * certificate workflow (they add CRM writes with compliance gates).
 */
export function getCertMission(agentNumber: number, agentName: string, mission: string): CertMission {
  const specialQueries: Record<number, CertMission> = {
    2: { taskType: 'acquisition_sourcing', description: 'Source real acquisition-related SEC filings', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'real estate acquisition', forms: '8-K' } }] },
    3: { taskType: 'underwriting_data', description: 'Pull real market rate + filings data for underwriting', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'net operating income real estate', forms: '10-K' } }] },
    6: { taskType: 'finance_reference_rates', description: 'Fetch real ECB FX reference rates', toolPlan: [{ toolId: 'frankfurter_fx', params: { base: 'USD' } }] },
    7: { taskType: 'investor_relations_research', description: 'Research real investor communications filings', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'investor relations update', forms: '8-K' } }] },
    8: { taskType: 'compliance_monitoring', description: 'Monitor real compliance filings', toolPlan: [{ toolId: 'sec_edgar_fulltext', params: { query: 'regulation d exemption', forms: 'D' } }] },
    11: { taskType: 'qa_source_verification', description: 'Verify real filing source integrity', toolPlan: [{ toolId: 'sec_edgar_submissions', params: { cik: '320193' } }] },
    12: { taskType: 'global_intelligence', description: 'Collect real global GDP intelligence', toolPlan: [{ toolId: 'worldbank_indicator', params: { country: 'WLD', indicator: 'NY.GDP.MKTP.CD' } }] },
  };
  if (specialQueries[agentNumber]) return specialQueries[agentNumber];

  // Distribute remaining agents across real sources deterministically
  const mod = agentNumber % 4;
  if (mod === 0) {
    const [country, indicator] = WB_INDICATORS[agentNumber % WB_INDICATORS.length];
    return {
      taskType: 'market_data_research',
      description: `Real World Bank indicator research for ${agentName}`,
      toolPlan: [{ toolId: 'worldbank_indicator', params: { country, indicator } }],
    };
  }
  if (mod === 1 || mod === 3) {
    const topic = mission.split(/[,.]/)[0].slice(0, 60) || agentName.replace(/^IA-\d+\s*/, '');
    return {
      taskType: 'public_source_research',
      description: `Real Wikipedia source research for ${agentName}`,
      toolPlan: [{ toolId: 'wikipedia_search', params: { query: topic } }],
    };
  }
  return {
    taskType: 'crm_pipeline_review',
    description: `Real CRM pipeline review for ${agentName}`,
    toolPlan: [{ toolId: 'crm_read', params: { prospectType: agentNumber % 2 === 0 ? 'buyer' : 'investor', limit: 10 } }],
  };
}

// ── Special deep missions: IA-17/19/20/21/27/28/31/32 ───────────────────────

export const SPECIAL_MISSION_AGENTS: readonly number[] = [17, 19, 20, 21, 27, 28, 31, 32];

export type SpecialMissionResult = {
  taskType: string;
  toolResults: RealToolResult[];
  outputData: Record<string, unknown>;
};

function filingProspectFromEdgar(
  edgar: RealToolResult,
  prospectType: ProspectRow['prospect_type'],
  agentId: string,
  taskId: string,
  extraData: Record<string, unknown> = {},
): { row: ProspectRow; score: number; breakdown: Record<string, number> } | null {
  const entity = typeof edgar.extract.topEntity === 'string' ? edgar.extract.topEntity : null;
  const filingUrl = typeof edgar.extract.filingUrl === 'string' ? edgar.extract.filingUrl : edgar.sourceReference;
  if (!entity || !filingUrl) return null;
  const fileDate = typeof edgar.extract.fileDate === 'string' ? edgar.extract.fileDate : null;
  const incStatesRaw = edgar.extract.incStates;
  const jurisdiction = Array.isArray(incStatesRaw) && incStatesRaw.length > 0
    ? String(incStatesRaw[0])
    : typeof incStatesRaw === 'string' && incStatesRaw
      ? incStatesRaw
      : 'US-federal (SEC EDGAR filing)';
  const name = entity.replace(/\s*\(CIK.*\)\s*$/, '').trim();
  const fieldsPresent = [name, filingUrl, fileDate, edgar.extract.cik].filter(Boolean).length;
  const { score, breakdown } = scoreProspect({
    hasRecentFiling: Boolean(fileDate),
    fileDate,
    fieldsPresent,
    fieldsTotal: 4,
    jurisdictionPresent: Boolean(jurisdiction),
    sourceAuthority: 'sec',
  });
  const row: ProspectRow = {
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
    data: { fileDate, cik: edgar.extract.cik ?? null, query: edgar.extract.query ?? null, ...extraData },
  };
  return { row, score, breakdown };
}

/**
 * Execute the deep real-data mission for IA-17/19/20/21/27/28/31/32.
 * Returns null for agents without a special mission.
 *
 * All prospect writes carry dedup keys (duplicate buyers/investors prevented),
 * objective scores, separated prospect types, and compliance gates. Investor
 * and tokenized outreach stays blocked_pending_approval. Securities/legal
 * approval is NEVER claimed: tokenized outputs carry
 * legalReviewStatus=requires_independent_review.
 */
export async function executeSpecialMission(
  agentId: string,
  agentNumber: number,
  taskId: string,
  timeoutMs: number,
): Promise<SpecialMissionResult | null> {
  const run = (toolId: string, params: RealToolParams): Promise<RealToolResult> =>
    executeRealTool(agentId, agentNumber, toolId, params, { timeoutMs });

  switch (agentNumber) {
    case 17: { // IA-17 Investor Acquisition → real permitted lead source (SEC EDGAR Form D)
      const edgar = await run('sec_edgar_fulltext', { query: 'private placement real estate fund', forms: 'D' });
      if (!edgar.ok) return { taskType: 'investor_lead_acquisition', toolResults: [edgar], outputData: {} };
      const prospect = filingProspectFromEdgar(edgar, 'investor', agentId, taskId, { leadSource: 'SEC EDGAR Form D (permitted public source)' });
      if (!prospect) return { taskType: 'investor_lead_acquisition', toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
      const write = await run('crm_write', { prospectRow: prospect.row } as unknown as RealToolParams);
      return {
        taskType: 'investor_lead_acquisition',
        toolResults: [edgar, write],
        outputData: {
          investorLead: prospect.row.name,
          verifiableSource: prospect.row.source_url,
          score: prospect.score,
          scoreBreakdown: prospect.breakdown,
          dedupKey: prospect.row.dedup_key,
          crmRecordId: write.extract.crmRecordId ?? null,
          complianceGate: 'blocked_pending_approval',
          regulatedSolicitation: 'escalated_to_owner — no outreach performed',
        },
      };
    }

    case 19: { // IA-19 Buyer Acquisition → real permitted buyer source (SEC EDGAR 8-K)
      const edgar = await run('sec_edgar_fulltext', { query: 'real estate purchase agreement', forms: '8-K' });
      if (!edgar.ok) return { taskType: 'buyer_acquisition', toolResults: [edgar], outputData: {} };
      const prospect = filingProspectFromEdgar(edgar, 'buyer', agentId, taskId, { buyerSignal: 'active real-estate acquirer per SEC 8-K filing' });
      if (!prospect) return { taskType: 'buyer_acquisition', toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
      const write = await run('crm_write', { prospectRow: prospect.row } as unknown as RealToolParams);
      return {
        taskType: 'buyer_acquisition',
        toolResults: [edgar, write],
        outputData: {
          buyerProspect: prospect.row.name,
          verifiableSource: prospect.row.source_url,
          score: prospect.score,
          dedupKey: prospect.row.dedup_key,
          crmRecordId: write.extract.crmRecordId ?? null,
          separatedFromInvestors: true,
        },
      };
    }

    case 20: { // IA-20 Buyer Qualification → real CRM + real-data scoring
      const read = await run('crm_read', { prospectType: 'buyer', limit: 10 });
      if (!read.ok) return { taskType: 'buyer_qualification', toolResults: [read], outputData: {} };
      const buyers = await fetchProspects('buyer', 10);
      const target = buyers.ok && buyers.data && buyers.data.length > 0 ? buyers.data[0] : null;
      if (!target) {
        return {
          taskType: 'buyer_qualification',
          toolResults: [read],
          outputData: { qualifiedBuyers: 0, note: 'real CRM read succeeded — buyer pipeline empty at execution time' },
        };
      }
      const dataRecord = (target.data ?? {}) as Record<string, unknown>;
      const { score, breakdown } = scoreProspect({
        hasRecentFiling: Boolean(dataRecord.fileDate),
        fileDate: typeof dataRecord.fileDate === 'string' ? dataRecord.fileDate : null,
        fieldsPresent: [target.name, target.source_url, target.jurisdiction, dataRecord.cik].filter(Boolean).length,
        fieldsTotal: 4,
        jurisdictionPresent: Boolean(target.jurisdiction),
        sourceAuthority: target.source_tool.startsWith('sec') ? 'sec' : 'crm',
      });
      await updateProspect(target.id, { score, score_breakdown: breakdown, qualified: score >= 50, status: score >= 50 ? 'qualified' : 'needs_review' });
      return {
        taskType: 'buyer_qualification',
        toolResults: [read],
        outputData: {
          qualifiedBuyer: target.name,
          crmRecordId: target.id,
          realDataScore: score,
          scoreBreakdown: breakdown,
          scoredFromRealData: true,
        },
      };
    }

    case 21: { // IA-21 Buyer Follow-Up → real CRM next-action queue (outreach stays gated)
      const read = await run('crm_read', { prospectType: 'buyer', limit: 10 });
      if (!read.ok) return { taskType: 'buyer_follow_up', toolResults: [read], outputData: {} };
      const buyers = await fetchProspects('buyer', 10);
      const rows = buyers.ok && buyers.data ? buyers.data : [];
      const nextActions: Array<Record<string, unknown>> = [];
      for (const b of rows.slice(0, 3)) {
        await updateProspect(b.id, { status: 'followup_scheduled' });
        nextActions.push({ crmRecordId: b.id, name: b.name, nextAction: 'owner_approval_required_before_outreach', complianceGate: b.compliance_gate });
      }
      return {
        taskType: 'buyer_follow_up',
        toolResults: [read],
        outputData: {
          nextActionQueue: nextActions,
          queueDepth: nextActions.length,
          externalOutreachSent: 0,
          outreachPolicy: 'external outreach remains behind approval/compliance gates',
        },
      };
    }

    case 27: { // IA-27 Partnership Development → real company sources with source URLs
      const wiki = await run('wikipedia_search', { query: 'real estate investment trust United States' });
      if (!wiki.ok) return { taskType: 'partnership_development', toolResults: [wiki], outputData: {} };
      const partnerName = typeof wiki.extract.topTitle === 'string' ? wiki.extract.topTitle : null;
      const pageUrl = typeof wiki.extract.topPageUrl === 'string' ? wiki.extract.topPageUrl : wiki.sourceReference;
      if (!partnerName) return { taskType: 'partnership_development', toolResults: [wiki], outputData: { note: 'no partner extracted from real source' } };
      const { score, breakdown } = scoreProspect({ hasRecentFiling: false, fileDate: null, fieldsPresent: 2, fieldsTotal: 4, jurisdictionPresent: false, sourceAuthority: 'wikipedia' });
      const row: ProspectRow = {
        prospect_type: 'partner',
        dedup_key: makeDedupKey('partner', partnerName),
        name: partnerName,
        source_url: pageUrl,
        source_tool: 'wikipedia_search',
        jurisdiction: null,
        score,
        score_breakdown: breakdown,
        qualified: false,
        status: 'new',
        compliance_gate: 'blocked_pending_approval',
        agent_id: agentId,
        task_id: taskId,
        company_scope: 'ivx_holdings',
        data: { sourceReference: pageUrl, category: 'strategic_partner_research' },
      };
      const write = await run('crm_write', { prospectRow: row } as unknown as RealToolParams);
      return {
        taskType: 'partnership_development',
        toolResults: [wiki, write],
        outputData: { partnerPipeline: partnerName, sourceUrl: pageUrl, crmRecordId: write.extract.crmRecordId ?? null, outreachPrep: 'requires owner approval' },
      };
    }

    case 28: { // IA-28 JV Deal Origination → real verifiable data sources
      const edgar = await run('sec_edgar_fulltext', { query: 'joint venture real estate development', forms: '8-K' });
      if (!edgar.ok) return { taskType: 'jv_deal_origination', toolResults: [edgar], outputData: {} };
      const prospect = filingProspectFromEdgar(edgar, 'jv', agentId, taskId, { jvSignal: 'announced JV per SEC 8-K filing' });
      if (!prospect) return { taskType: 'jv_deal_origination', toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
      const write = await run('crm_write', { prospectRow: prospect.row } as unknown as RealToolParams);
      return {
        taskType: 'jv_deal_origination',
        toolResults: [edgar, write],
        outputData: { jvOpportunity: prospect.row.name, verifiableSource: prospect.row.source_url, score: prospect.score, crmRecordId: write.extract.crmRecordId ?? null },
      };
    }

    case 31: { // IA-31 Tokenized Assets → real research; jurisdiction + source REQUIRED
      const edgar = await run('sec_edgar_fulltext', { query: 'tokenized real estate offering' });
      if (!edgar.ok) return { taskType: 'tokenization_feasibility', toolResults: [edgar], outputData: {} };
      const prospect = filingProspectFromEdgar(edgar, 'tokenized_asset', agentId, taskId, {
        legalReviewStatus: 'requires_independent_review',
        securitiesApprovalClaimed: false,
      });
      if (!prospect) return { taskType: 'tokenization_feasibility', toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
      const write = await run('crm_write', { prospectRow: prospect.row } as unknown as RealToolParams);
      return {
        taskType: 'tokenization_feasibility',
        toolResults: [edgar, write],
        outputData: {
          tokenizationOpportunity: prospect.row.name,
          jurisdiction: prospect.row.jurisdiction,
          verifiableSource: prospect.row.source_url,
          legalReviewStatus: 'requires_independent_review',
          securitiesApprovalClaimed: false,
          crmRecordId: write.extract.crmRecordId ?? null,
        },
      };
    }

    case 32: { // IA-32 Tokenized Deal Research → real research sources
      const edgar = await run('sec_edgar_fulltext', { query: 'digital asset securities', forms: 'D' });
      if (!edgar.ok) return { taskType: 'tokenized_market_research', toolResults: [edgar], outputData: {} };
      const prospect = filingProspectFromEdgar(edgar, 'tokenized_asset', agentId, taskId, {
        legalReviewStatus: 'requires_independent_review',
        securitiesApprovalClaimed: false,
        researchCategory: 'tokenized_market_intelligence',
      });
      if (!prospect) return { taskType: 'tokenized_market_research', toolResults: [edgar], outputData: { note: 'no entity extracted from real source' } };
      const write = await run('crm_write', { prospectRow: prospect.row } as unknown as RealToolParams);
      return {
        taskType: 'tokenized_market_research',
        toolResults: [edgar, write],
        outputData: {
          opportunityIntelligence: prospect.row.name,
          jurisdiction: prospect.row.jurisdiction,
          verifiableSource: prospect.row.source_url,
          legalReviewStatus: 'requires_independent_review',
          crmRecordId: write.extract.crmRecordId ?? null,
        },
      };
    }

    default:
      return null;
  }
}
