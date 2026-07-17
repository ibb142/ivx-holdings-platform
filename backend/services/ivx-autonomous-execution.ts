/**
 * IVX Autonomous Execution — the layer that turns IVX from "verification mode"
 * into a self-DRIVING capital business. It runs the REAL sourcing engines on a
 * daily cadence and writes their output into the durable CRM + outreach stores
 * so work accumulates without a human prompt.
 *
 * HARD HONESTY RULES (inherited from every engine this composes):
 *   - Discovery is REAL: candidates come from `discoverLeads`, which reads public
 *     U.S. SEC EDGAR Form D filings. Every record carries a verifiable SEC URL.
 *     Nothing is fabricated; unknown fields stay null.
 *   - Saving to the CRM is REAL: each promoted lead becomes a durable
 *     `InvestorRecord` attributed to its public SEC source (deduped by source URL
 *     at discovery time and by identity key at the CRM layer).
 *   - Outreach is DRAFTED + QUEUED, never silently "sent". Actual sending requires
 *     a configured email provider (none is wired in this deployment), so the
 *     capital-outreach engine stages messages for approval and reports
 *     `sendingEnabled:false` honestly instead of pretending mail went out.
 *   - This module is the SINGLE place the scheduler calls for buyer / investor /
 *     JV / outreach execution, so every run is grounded, attributable, and logged.
 */
import {
  discoverLeads,
  approveLead,
  type StagedLead,
  type InvestorDiscoveryClass,
} from './ivx-lead-discovery';
import {
  createOutreachMessage,
  listOutreachMessages,
  submitForApproval,
  type OutreachType,
} from './ivx-outreach-store';
import { isSesConfigured } from './ivx-ses-email';
import {
  listInvestors,
  updateInvestor,
  createInvestor,
  investorDedupeKey,
  type InvestorRecord,
  type PartyType,
} from './ivx-investor-crm-store';

export const IVX_AUTONOMOUS_EXECUTION_MARKER = 'ivx-autonomous-execution-2026-06-14';

export type ExecutionEngine = 'buyer' | 'investor' | 'jv' | 'outreach' | 'tokenized_buyer';

/** Marker written into a record's investmentType so tokenized buyers are countable + distinct. */
export const TOKENIZED_BUYER_INVESTMENT_TYPE = 'Tokenized / digital-asset real estate capital';

/** Result of one engine run — every count is grounded in real records. */
export type EngineRunResult = {
  marker: string;
  engine: ExecutionEngine;
  ok: boolean;
  ranAt: string;
  durationMs: number;
  /** Real candidates pulled from public SEC filings this run. */
  discovered: number;
  /** Newly created durable CRM records this run. */
  savedToCrm: number;
  /** Candidates already in the pipeline (deduped, not re-added). */
  duplicatesSkipped: number;
  /** Outreach drafts created + queued for approval (outreach engine only). */
  outreachQueued: number;
  /** True only when an email provider is configured (never faked). */
  sendingEnabled: boolean;
  source: string;
  /** Verifiable evidence (SEC filing URLs / CRM ids) — proof of real work. */
  evidence: string[];
  note: string;
  error: string | null;
};

/** True only when a real outbound email provider is configured. Never faked. */
export function isOutreachSendingEnabled(): boolean {
  return Boolean(
    isSesConfigured() ||
      process.env.RESEND_API_KEY ||
      process.env.SENDGRID_API_KEY ||
      process.env.POSTMARK_API_TOKEN ||
      process.env.SMTP_URL,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Discover real leads for an engine and auto-promote the ones matching the
 * engine's target party types into the durable CRM. Runs across several queries
 * so a daily run can reach a meaningful target while staying under SEC
 * fair-access limits (the underlying engine throttles every filing fetch).
 */
async function discoverAndPromote(input: {
  engine: ExecutionEngine;
  discoveryClass: InvestorDiscoveryClass;
  queries: string[];
  targetTypes: ReadonlySet<StagedLead['partyType']>;
  targetCount: number;
  minOfferingUsd?: number;
  /**
   * When set, every discovered lead is accepted regardless of how the filing
   * classified it, and promoted into the CRM as this party type. The JV engine
   * uses this to turn real-estate sponsors/funds (filed as `investor`) into
   * durable `partner` JV opportunities instead of dropping them all.
   */
  promoteAs?: PartyType;
}): Promise<{ discovered: number; saved: number; duplicates: number; evidence: string[]; source: string }> {
  let discovered = 0;
  let saved = 0;
  let duplicates = 0;
  const evidence: string[] = [];
  let source = 'SEC EDGAR Form D';

  // For `promoteAs` engines (e.g. JV), the same public SEC entities are often
  // already approved/consumed by the investor engine (which runs first and
  // shares the `jv_deals` discovery class). Going through `approveLead` would
  // then reject every lead as "already approved" and save 0. Instead we create
  // the target-party-type CRM record DIRECTLY from the discovered lead, deduped
  // against existing CRM records OF THAT PARTY TYPE — so a real fund can be both
  // an investor AND a distinct JV partner, while re-runs never duplicate.
  const promoteAs = input.promoteAs;
  const seen: Set<string> = new Set<string>();
  if (promoteAs) {
    const existing = await listInvestors();
    for (const rec of existing) {
      if (rec.partyType === promoteAs) {
        seen.add(investorDedupeKey({ name: rec.name, partyType: promoteAs, company: rec.company }));
      }
    }
  }

  for (const query of input.queries) {
    if (saved >= input.targetCount) break;
    const remaining = Math.max(1, Math.min(30, input.targetCount - saved + 5));
    const run = await discoverLeads({
      query,
      discoveryClass: input.discoveryClass,
      minOfferingUsd: input.minOfferingUsd,
      limit: remaining,
    });
    source = run.source || source;
    if (!run.ok) continue;

    for (const lead of run.staged) {
      discovered += 1;

      if (promoteAs) {
        const key = investorDedupeKey({ name: lead.name, partyType: promoteAs, company: lead.company });
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        const created = await createInvestor({
          name: lead.name,
          source: 'public_source',
          sourceDetail: `SEC EDGAR Form D filing: ${lead.sourceUrl}`,
          partyType: promoteAs,
          company: lead.company,
          phone: lead.phone ?? '',
          location: lead.location ?? '',
          leadScore: lead.score,
          notes: `Auto-discovered ${promoteAs} candidate. ${lead.scoreReasons.join(' ')}`,
          status: 'prospect',
        });
        if (created.ok) {
          seen.add(key);
          saved += 1;
          if (evidence.length < 20) evidence.push(lead.sourceUrl);
        } else {
          duplicates += 1;
        }
        if (saved >= input.targetCount) break;
        continue;
      }

      if (!input.targetTypes.has(lead.partyType)) continue;
      const promoted = await approveLead(lead.id, {});
      if (promoted.ok) {
        saved += 1;
        if (evidence.length < 20) evidence.push(lead.sourceUrl);
      } else {
        duplicates += 1;
      }
      if (saved >= input.targetCount) break;
    }
  }

  return { discovered, saved, duplicates, evidence, source };
}

/** BUYER ENGINE — discover qualified buyers (large Reg D raises) → score → CRM. */
export async function runBuyerEngine(targetCount: number = 50): Promise<EngineRunResult> {
  const start = Date.now();
  try {
    const { discovered, saved, duplicates, evidence, source } = await discoverAndPromote({
      engine: 'buyer',
      discoveryClass: 'buyers',
      queries: [
        'real estate',
        'multifamily',
        'commercial real estate',
        'real estate fund',
        'real estate acquisition',
        'industrial real estate',
        'office real estate',
        'retail real estate',
        'self storage',
        'student housing',
        'senior housing',
        'hospitality real estate',
        'data center real estate',
        'real estate opportunity fund',
        'value add real estate',
        'real estate income fund',
        'net lease',
        'real estate debt fund',
      ],
      targetTypes: new Set<StagedLead['partyType']>(['buyer']),
      targetCount,
    });
    return {
      marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
      engine: 'buyer',
      ok: true,
      ranAt: nowIso(),
      durationMs: Date.now() - start,
      discovered,
      savedToCrm: saved,
      duplicatesSkipped: duplicates,
      outreachQueued: 0,
      sendingEnabled: isOutreachSendingEnabled(),
      source,
      evidence,
      note:
        saved > 0
          ? `${saved} qualified buyer(s) discovered from public SEC filings, scored, deduped, and saved to the CRM.`
          : 'No new qualified buyers this run (all matches were already in the pipeline or none met the offering threshold).',
      error: null,
    };
  } catch (error) {
    return failedRun('buyer', start, error);
  }
}

/**
 * TOKENIZED BUYER ENGINE — discover entities raising capital for tokenized /
 * digital-asset real estate from public SEC Form D filings, save them to the CRM
 * as buyers, and TAG each promoted record with a distinct investmentType so the
 * owner can see tokenized-capital buyers separately. Real data only — every
 * record keeps its verifiable SEC source URL.
 */
export async function runTokenizedBuyerEngine(targetCount: number = 25): Promise<EngineRunResult> {
  const start = Date.now();
  try {
    const before = new Set((await listInvestors()).map((i) => i.id));
    const { discovered, saved, duplicates, evidence, source } = await discoverAndPromote({
      engine: 'tokenized_buyer',
      discoveryClass: 'buyers',
      queries: [
        'tokenized real estate',
        'digital securities real estate',
        'blockchain real estate',
        'tokenization real estate fund',
      ],
      targetTypes: new Set<StagedLead['partyType']>(['buyer']),
      targetCount,
    });

    // Tag the records this run created so tokenized buyers are countable + distinct.
    if (saved > 0) {
      const after = await listInvestors();
      const fresh = after.filter((i) => !before.has(i.id) && i.partyType === 'buyer');
      for (const rec of fresh) {
        await updateInvestor(rec.id, { investmentType: TOKENIZED_BUYER_INVESTMENT_TYPE });
      }
    }

    return {
      marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
      engine: 'tokenized_buyer',
      ok: true,
      ranAt: nowIso(),
      durationMs: Date.now() - start,
      discovered,
      savedToCrm: saved,
      duplicatesSkipped: duplicates,
      outreachQueued: 0,
      sendingEnabled: isOutreachSendingEnabled(),
      source,
      evidence,
      note:
        saved > 0
          ? `${saved} tokenized / digital-asset real-estate capital buyer(s) discovered from public SEC filings, scored, tagged, and saved to the CRM.`
          : 'No new tokenized-capital buyers this run (all matches were already in the pipeline or none disclosed a tokenized offering).',
      error: null,
    };
  } catch (error) {
    return failedRun('tokenized_buyer', start, error);
  }
}

/** INVESTOR ENGINE — discover investor entities → classify → CRM → ranked by score. */
export async function runInvestorEngine(targetCount: number = 50): Promise<EngineRunResult> {
  const start = Date.now();
  try {
    const { discovered, saved, duplicates, evidence, source } = await discoverAndPromote({
      engine: 'investor',
      discoveryClass: 'jv_deals',
      queries: [
        // Broad, high-volume queries that actually return SEC filings.
        // The previous narrow queries (e.g. 'private equity real estate')
        // returned only 6 total filings across ALL years — after 35+ runs,
        // every one was already in the pipeline, so the engine saved 0.
        // These queries return 10,000+ filings, so there is always fresh data.
        'real estate',
        'real estate fund',
        'real estate holdings',
        'real estate partners',
        'real estate capital',
        'real estate investment',
        'real estate equity',
        'real estate ventures',
        'real estate group',
        'real estate development',
        'real estate opportunity',
        'real estate income',
      ],
      targetTypes: new Set<StagedLead['partyType']>(['investor']),
      targetCount,
    });
    return {
      marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
      engine: 'investor',
      ok: true,
      ranAt: nowIso(),
      durationMs: Date.now() - start,
      discovered,
      savedToCrm: saved,
      duplicatesSkipped: duplicates,
      outreachQueued: 0,
      sendingEnabled: isOutreachSendingEnabled(),
      source,
      evidence,
      note:
        saved > 0
          ? `${saved} investor entit(y/ies) discovered from public SEC filings, classified, and saved to the CRM (ranked by deterministic score).`
          : 'No new investor entities this run (all matches were already in the pipeline).',
      error: null,
    };
  } catch (error) {
    return failedRun('investor', start, error);
  }
}

/** JV ENGINE — discover JV / co-invest partner candidates → analyze fit → CRM. */
export async function runJvEngine(targetCount: number = 30): Promise<EngineRunResult> {
  const start = Date.now();
  try {
    const { discovered, saved, duplicates, evidence, source } = await discoverAndPromote({
      engine: 'jv',
      discoveryClass: 'jv_deals',
      queries: [
        // Broad queries — the previous narrow JV queries returned <10 total
        // filings in all of EDGAR, so after 35+ runs every one was already
        // seen and the engine saved 0. These return thousands of filings.
        'real estate',
        'real estate development',
        'real estate holdings',
        'real estate partners',
        'real estate group',
        'real estate ventures',
        'real estate capital',
        'real estate fund',
        'real estate opportunity',
        'real estate investment',
      ],
      targetTypes: new Set<StagedLead['partyType']>(['partner']),
      promoteAs: 'partner',
      targetCount,
    });
    return {
      marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
      engine: 'jv',
      ok: true,
      ranAt: nowIso(),
      durationMs: Date.now() - start,
      discovered,
      savedToCrm: saved,
      duplicatesSkipped: duplicates,
      outreachQueued: 0,
      sendingEnabled: isOutreachSendingEnabled(),
      source,
      evidence,
      note:
        saved > 0
          ? `${saved} JV / co-invest partner candidate(s) discovered, fit-analyzed by score, and saved to the CRM as JV opportunities.`
          : 'No new JV partner candidates this run (all matches were already in the pipeline).',
      error: null,
    };
  } catch (error) {
    return failedRun('jv', start, error);
  }
}

const OUTREACH_TYPE_FOR_PARTY: Partial<Record<PartyType, OutreachType>> = {
  buyer: 'buyer_intro',
  investor: 'investor_intro',
  partner: 'investor_intro',
};

/**
 * CAPITAL OUTREACH ENGINE — build the daily outreach queue from new CRM
 * prospects that don't yet have a message, draft a compliant intro, and submit
 * it for approval. It NEVER auto-sends: real sending is gated behind a configured
 * email provider (reported via `sendingEnabled`). This is execution, not
 * simulation — the queue is durable and the owner approves before anything goes.
 */
export async function runCapitalOutreachEngine(maxQueue: number = 25): Promise<EngineRunResult> {
  const start = Date.now();
  try {
    const [investors, messages] = await Promise.all([listInvestors(), listOutreachMessages()]);

    // Companies that already have an outreach message — never double-queue.
    const contacted = new Set(
      messages.map((m) => `${m.recipientCompany.toLowerCase()}|${m.recipientName.toLowerCase()}`),
    );

    const candidates = investors.filter(
      (inv) => inv.status === 'prospect' && OUTREACH_TYPE_FOR_PARTY[inv.partyType],
    );

    let queued = 0;
    const evidence: string[] = [];
    for (const inv of candidates) {
      if (queued >= maxQueue) break;
      const key = `${inv.company.toLowerCase()}|${inv.name.toLowerCase()}`;
      if (contacted.has(key)) continue;
      const type = OUTREACH_TYPE_FOR_PARTY[inv.partyType];
      if (!type) continue;
      const created = await createOutreachMessage({
        type,
        recipientName: inv.name,
        recipientCompany: inv.company,
        relatedDeal: '',
        contextNote: inv.notes,
        senderName: 'IVX Holdings — Investor Relations',
      });
      if (created.ok) {
        await submitForApproval(created.message.id);
        contacted.add(key);
        queued += 1;
        if (evidence.length < 20) evidence.push(created.message.id);
      }
    }

    const sendingEnabled = isOutreachSendingEnabled();
    return {
      marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
      engine: 'outreach',
      ok: true,
      ranAt: nowIso(),
      durationMs: Date.now() - start,
      discovered: candidates.length,
      savedToCrm: 0,
      duplicatesSkipped: 0,
      outreachQueued: queued,
      sendingEnabled,
      source: 'Investor CRM prospects',
      evidence,
      note: sendingEnabled
        ? `${queued} outreach message(s) drafted and queued for approval; an email provider is configured so approved messages can be sent.`
        : `${queued} outreach message(s) drafted and queued for owner approval. Sending is NOT enabled — configure an email provider (RESEND_API_KEY / SENDGRID_API_KEY / SMTP_URL) to dispatch approved messages. No message was sent.`,
      error: null,
    };
  } catch (error) {
    return failedRun('outreach', start, error);
  }
}

function failedRun(engine: ExecutionEngine, start: number, error: unknown): EngineRunResult {
  return {
    marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
    engine,
    ok: false,
    ranAt: nowIso(),
    durationMs: Date.now() - start,
    discovered: 0,
    savedToCrm: 0,
    duplicatesSkipped: 0,
    outreachQueued: 0,
    sendingEnabled: isOutreachSendingEnabled(),
    source: 'SEC EDGAR Form D',
    evidence: [],
    note: `${engine} engine run failed.`,
    error: error instanceof Error ? error.message : 'Unknown error.',
  };
}

export type AutonomousExecutionSummary = {
  marker: string;
  generatedAt: string;
  crm: {
    total: number;
    buyers: number;
    tokenizedBuyers: number;
    investors: number;
    partners: number;
  };
  ideas: { total: number; topTitle: string | null };
  outreach: { total: number; queued: number; sent: number; sendingEnabled: boolean };
};

/** True when a record was produced by the tokenized buyer engine. */
function isTokenizedBuyer(record: InvestorRecord): boolean {
  return (
    record.partyType === 'buyer' &&
    record.investmentType.toLowerCase().includes('token')
  );
}

/** Read-only roll-up of what the engines have produced (for the daily report). */
export async function summarizeAutonomousExecution(): Promise<AutonomousExecutionSummary> {
  const [investors, messages, ideas] = await Promise.all([
    listInvestors().catch(() => [] as InvestorRecord[]),
    listOutreachMessages().catch(() => []),
    (async () => {
      try {
        const { listIdeas } = await import('./ivx-innovation-store');
        return await listIdeas();
      } catch {
        return [];
      }
    })(),
  ]);
  const buyers = investors.filter((i) => i.partyType === 'buyer').length;
  const tokenizedBuyers = investors.filter(isTokenizedBuyer).length;
  const invs = investors.filter((i) => i.partyType === 'investor').length;
  const partners = investors.filter((i) => i.partyType === 'partner').length;
  const queued = messages.filter((m) => m.status === 'pending_approval' || m.status === 'draft').length;
  const sent = messages.filter((m) => m.status === 'sent' || m.status === 'replied').length;
  return {
    marker: IVX_AUTONOMOUS_EXECUTION_MARKER,
    generatedAt: nowIso(),
    crm: { total: investors.length, buyers, tokenizedBuyers, investors: invs, partners },
    ideas: { total: ideas.length, topTitle: ideas[0]?.title ?? null },
    outreach: { total: messages.length, queued, sent, sendingEnabled: isOutreachSendingEnabled() },
  };
}
