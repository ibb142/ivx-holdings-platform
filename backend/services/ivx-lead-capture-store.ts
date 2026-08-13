/**
 * IVX Power Tools Core — Lead Capture Engine + behavior-based scoring + CRM pipeline (owner-only reads, public capture).
 *
 * BLOCK 98. Turns IVX from analytics into execution: capture an inbound lead, score it
 * by REAL behavior signals (browsed / clicked CTA / returned / viewed deal / submitted form /
 * requested packet / booked call / verified contact), and move it through the deal CRM
 * pipeline (new_lead → … → closed/lost) with an owner-approved follow-up due date.
 *
 * HARD HONESTY RULE (platform-wide):
 *   - IVX NEVER fabricates a lead. Capture requires a real name + a real contact (email or phone).
 *   - Behavior signals are only true when a real event recorded them; scores derive ONLY from
 *     signals that are present. Nothing is invented.
 *   - `contactVerified` is owner/flow-set, never assumed — it gates the `qualified` tier and any send.
 *
 * Lead scoring (BLOCK 98 rules):
 *   browsed only                                  → cold
 *   clicked CTA / returned / viewed deal          → warm
 *   submitted form / requested packet / booked call → hot
 *   verified contact + clear intent               → qualified
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/lead-capture/leads.jsonl  append-only event log
 *   logs/audit/lead-capture/leads.json   materialised current state
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import {
  createInvestor,
  listInvestors,
  updateInvestor,
  investorDedupeKey,
  normalizePartyType,
  type PartyType,
} from './ivx-investor-crm-store';

export const IVX_LEAD_CAPTURE_MARKER = 'ivx-lead-capture-2026-06-03';

/**
 * Who the lead is — drives matching + outreach later. Covers all seven acquisition
 * audiences: investor, buyer, seller, JV/capital partner, realtor/broker,
 * builder/developer, and land owner (plus lender, used by the matching engine).
 */
export type LeadRole =
  | 'buyer'
  | 'investor'
  | 'broker'
  | 'seller'
  | 'lender'
  | 'jv_partner'
  | 'developer'
  | 'land_owner';

/** Where the lead originated — honest attribution, never invented. */
export type LeadSource = 'lead_form' | 'cta_click' | 'owner_entered' | 'crm_import';

/** The above-the-fold call to action the visitor responded to. */
export type LeadCtaType = 'get_deal_access' | 'request_investor_packet' | 'schedule_call' | null;

/** Behavior-based temperature (computed from real signals only). */
export type LeadTemperature = 'cold' | 'warm' | 'hot' | 'qualified';

/** The deal CRM pipeline stage. */
export type LeadPipelineStage =
  | 'new_lead'
  | 'qualified'
  | 'contacted'
  | 'replied'
  | 'meeting_requested'
  | 'data_room_sent'
  | 'loi_requested'
  | 'soft_commitment'
  | 'closed'
  | 'lost';

export const LEAD_PIPELINE_STAGES: readonly LeadPipelineStage[] = [
  'new_lead', 'qualified', 'contacted', 'replied', 'meeting_requested',
  'data_room_sent', 'loi_requested', 'soft_commitment', 'closed', 'lost',
];

const VALID_ROLES: ReadonlySet<string> = new Set([
  'buyer', 'investor', 'broker', 'seller', 'lender', 'jv_partner', 'developer', 'land_owner',
]);

export const LEAD_ROLES: readonly LeadRole[] = [
  'investor', 'buyer', 'seller', 'jv_partner', 'broker', 'developer', 'land_owner', 'lender',
];
const VALID_SOURCES: ReadonlySet<string> = new Set(['lead_form', 'cta_click', 'owner_entered', 'crm_import']);
const VALID_CTAS: ReadonlySet<string> = new Set(['get_deal_access', 'request_investor_packet', 'schedule_call']);
const VALID_STAGES: ReadonlySet<string> = new Set(LEAD_PIPELINE_STAGES);

/** Real, event-recorded behavior signals. A signal is true ONLY when an event set it. */
export type LeadBehaviorSignals = {
  browsed: boolean;
  returned: boolean;
  viewedDeal: boolean;
  clickedCta: boolean;
  submittedForm: boolean;
  requestedPacket: boolean;
  bookedCall: boolean;
  /** Owner/flow-verified contact — never assumed. Gates `qualified` + any send. */
  contactVerified: boolean;
};

export type LeadRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: LeadRole;
  budgetRange: string;
  preferredMarket: string;
  /** Consent to be contacted — required true for a lead_form capture. */
  consent: boolean;
  ctaType: LeadCtaType;
  relatedDeal: string;
  notes: string;
  source: LeadSource;
  sourceDetail: string;
  /** Marketing/attribution tracking — honest, never invented. */
  campaign: string;
  /** The page/path the lead was captured from (e.g. /capture, /deal/casa-rosario). */
  page: string;
  /** Free-text deal/asset interest the visitor expressed (drives matching later). */
  dealInterest: string;
  signals: LeadBehaviorSignals;
  /** Computed from signals — never set directly. */
  temperature: LeadTemperature;
  /** Computed 0–100 from present signals only. */
  leadScore: number;
  stage: LeadPipelineStage;
  followUpDueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const ROOT = auditDir('lead-capture');
const STATE = path.join(ROOT, 'leads.json');

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeRole(value: unknown): LeadRole {
  const v = asTrimmedString(value).toLowerCase();
  return (VALID_ROLES.has(v) ? v : 'buyer') as LeadRole;
}

function normalizeCta(value: unknown): LeadCtaType {
  const v = asTrimmedString(value).toLowerCase();
  return (VALID_CTAS.has(v) ? v : null) as LeadCtaType;
}

/** Normalize an ISO-ish date to ISO, or null. */
export function normalizeLeadDate(value: unknown): string | null {
  const v = asTrimmedString(value);
  if (!v) return null;
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function buildSignals(input?: Partial<LeadBehaviorSignals>): LeadBehaviorSignals {
  return {
    browsed: asBool(input?.browsed),
    returned: asBool(input?.returned),
    viewedDeal: asBool(input?.viewedDeal),
    clickedCta: asBool(input?.clickedCta),
    submittedForm: asBool(input?.submittedForm),
    requestedPacket: asBool(input?.requestedPacket),
    bookedCall: asBool(input?.bookedCall),
    contactVerified: asBool(input?.contactVerified),
  };
}

/**
 * Behavior-based lead scoring (pure, deterministic, BLOCK 98 rules).
 *   - browsed only → cold
 *   - clicked CTA / returned / viewed deal → warm
 *   - submitted form / requested packet / booked call → hot
 *   - verified contact + clear intent (any hot signal) → qualified
 * The 0–100 score is a transparent weighted sum of the signals that are actually present.
 */
export function scoreLeadBehavior(signals: LeadBehaviorSignals): {
  temperature: LeadTemperature;
  leadScore: number;
} {
  const hotSignal = signals.submittedForm || signals.requestedPacket || signals.bookedCall;
  const warmSignal = signals.clickedCta || signals.returned || signals.viewedDeal;

  let temperature: LeadTemperature = 'cold';
  if (hotSignal) temperature = 'hot';
  else if (warmSignal) temperature = 'warm';
  // Verified contact + clear intent (a hot signal) is the strongest tier.
  if (signals.contactVerified && hotSignal) temperature = 'qualified';

  const weights: { key: keyof LeadBehaviorSignals; points: number }[] = [
    { key: 'browsed', points: 5 },
    { key: 'returned', points: 10 },
    { key: 'viewedDeal', points: 12 },
    { key: 'clickedCta', points: 13 },
    { key: 'submittedForm', points: 20 },
    { key: 'requestedPacket', points: 18 },
    { key: 'bookedCall', points: 22 },
    { key: 'contactVerified', points: 15 },
  ];
  let raw = 0;
  for (const w of weights) if (signals[w.key]) raw += w.points;
  const leadScore = Math.max(0, Math.min(100, Math.round(raw)));
  return { temperature, leadScore };
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<T>(file, fallback);
  }
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const eventFile = path.join(ROOT, 'leads.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // Forensic log is best-effort; never break a write on log failure.
    }
    return;
  }
  try {
    await mkdir(ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Forensic log is best-effort; never break a write on log failure.
  }
}

export type CaptureLeadInput = {
  name: string;
  email?: string;
  phone?: string;
  role?: LeadRole;
  budgetRange?: string;
  preferredMarket?: string;
  consent?: boolean;
  ctaType?: LeadCtaType;
  relatedDeal?: string;
  notes?: string;
  source?: LeadSource;
  sourceDetail?: string;
  campaign?: string;
  page?: string;
  dealInterest?: string;
  signals?: Partial<LeadBehaviorSignals>;
};

export type LeadValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a capture input. Honesty rule: a real name + a real contact (email OR phone)
 * are required. A `lead_form` submission additionally requires explicit consent.
 */
export function validateCaptureLead(input: CaptureLeadInput): LeadValidation {
  if (!asTrimmedString(input.name)) {
    return { ok: false, error: 'A name is required — IVX never fabricates a lead.' };
  }
  if (!asTrimmedString(input.email) && !asTrimmedString(input.phone)) {
    return { ok: false, error: 'A real contact is required (email or phone) — IVX never invents contact details.' };
  }
  // Email format validation — replicate frontend validation (item 87)
  const email = asTrimmedString(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }
  const source: LeadSource = VALID_SOURCES.has(asTrimmedString(input.source)) ? (input.source as LeadSource) : 'lead_form';
  if (source === 'lead_form' && !asBool(input.consent)) {
    return { ok: false, error: 'Consent is required to capture a lead form submission.' };
  }
  return { ok: true };
}

/**
 * Derive the default capture signals from the CTA the visitor responded to, so an inbound
 * form/CTA capture is scored honestly from the real event (no signal is invented).
 */
function deriveCaptureSignals(input: CaptureLeadInput, source: LeadSource): LeadBehaviorSignals {
  const base = buildSignals(input.signals);
  // A real visitor who reached a capture point at minimum browsed.
  base.browsed = true;
  if (source === 'cta_click') base.clickedCta = true;
  if (source === 'lead_form') base.submittedForm = true;
  if (input.ctaType === 'request_investor_packet') base.requestedPacket = true;
  if (input.ctaType === 'schedule_call') base.bookedCall = true;
  if (input.ctaType === 'get_deal_access') base.viewedDeal = true;
  return base;
}

function buildRecord(input: CaptureLeadInput, prior?: LeadRecord): LeadRecord {
  const source: LeadSource = VALID_SOURCES.has(asTrimmedString(input.source))
    ? (input.source as LeadSource)
    : prior?.source ?? 'lead_form';
  const signals = prior
    ? buildSignals({ ...prior.signals, ...input.signals })
    : deriveCaptureSignals(input, source);
  const { temperature, leadScore } = scoreLeadBehavior(signals);
  const stage: LeadPipelineStage = prior?.stage
    ?? (temperature === 'qualified' ? 'qualified' : 'new_lead');
  return {
    id: prior?.id ?? createId('lead'),
    name: asTrimmedString(input.name) || prior?.name || '',
    email: input.email !== undefined ? asTrimmedString(input.email) : prior?.email ?? '',
    phone: input.phone !== undefined ? asTrimmedString(input.phone) : prior?.phone ?? '',
    role: input.role !== undefined ? normalizeRole(input.role) : prior?.role ?? 'buyer',
    budgetRange: input.budgetRange !== undefined ? asTrimmedString(input.budgetRange) : prior?.budgetRange ?? '',
    preferredMarket: input.preferredMarket !== undefined ? asTrimmedString(input.preferredMarket) : prior?.preferredMarket ?? '',
    consent: input.consent !== undefined ? asBool(input.consent) : prior?.consent ?? false,
    ctaType: input.ctaType !== undefined ? normalizeCta(input.ctaType) : prior?.ctaType ?? null,
    relatedDeal: input.relatedDeal !== undefined ? asTrimmedString(input.relatedDeal) : prior?.relatedDeal ?? '',
    notes: input.notes !== undefined ? asTrimmedString(input.notes) : prior?.notes ?? '',
    source,
    sourceDetail: input.sourceDetail !== undefined ? asTrimmedString(input.sourceDetail) : prior?.sourceDetail ?? '',
    campaign: input.campaign !== undefined ? asTrimmedString(input.campaign) : prior?.campaign ?? '',
    page: input.page !== undefined ? asTrimmedString(input.page) : prior?.page ?? '',
    dealInterest: input.dealInterest !== undefined ? asTrimmedString(input.dealInterest) : prior?.dealInterest ?? '',
    signals,
    temperature,
    leadScore,
    stage,
    followUpDueAt: prior?.followUpDueAt ?? null,
    createdAt: prior?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

/** Public/inbound capture. Returns the validation error on failure (never persists invalid). */
export async function captureLead(
  input: CaptureLeadInput,
): Promise<{ ok: true; lead: LeadRecord } | { ok: false; error: string }> {
  const validation = validateCaptureLead(input);
  if (!validation.ok) return validation;
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  const record = buildRecord(input);
  items.push(record);
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'capture', lead: record, at: record.createdAt });
  await syncLeadToCrm(record);
  return { ok: true, lead: record };
}

/**
 * Map a lead role to the CRM party type. The CRM has no `seller` / `land_owner`
 * party type, so those acquisition audiences map to `partner` (the catch-all for
 * deal-side relationships). Everything else maps 1:1.
 */
export function leadRoleToPartyType(role: LeadRole): PartyType {
  switch (role) {
    case 'investor': return 'investor';
    case 'buyer': return 'buyer';
    case 'broker': return 'broker';
    case 'developer': return 'developer';
    case 'lender': return 'lender';
    case 'jv_partner':
    case 'seller':
    case 'land_owner':
    default:
      return 'partner';
  }
}

/**
 * Bridge a captured lead into the Investor CRM so the CRM count reflects real
 * leads. Best-effort: a CRM failure must never break lead capture. Dedupes on the
 * CRM's own key (party type + name + email/phone/company) so re-capturing the same
 * person updates the existing contact instead of creating duplicates.
 */
async function syncLeadToCrm(lead: LeadRecord): Promise<void> {
  try {
    if (!lead.name || (!lead.email && !lead.phone)) return;
    const partyType = leadRoleToPartyType(lead.role);
    const key = investorDedupeKey({
      name: lead.name,
      partyType,
      email: lead.email,
      phone: lead.phone,
    });
    const existing = (await listInvestors()).find((inv) => investorDedupeKey(inv) === key);
    const preferredMarkets = lead.preferredMarket ? [lead.preferredMarket] : [];
    const sourceDetail = `lead-capture:${lead.id} (${lead.source}${lead.campaign ? ` / ${lead.campaign}` : ''})`;
    if (existing) {
      await updateInvestor(existing.id, {
        email: lead.email || existing.email,
        phone: lead.phone || existing.phone,
        leadScore: Math.max(existing.leadScore, lead.leadScore),
        ...(preferredMarkets.length > 0 ? { preferredMarkets } : {}),
      });
      return;
    }
    await createInvestor({
      name: lead.name,
      partyType: normalizePartyType(partyType),
      email: lead.email,
      phone: lead.phone,
      source: 'submitted_form',
      sourceDetail,
      preferredMarkets,
      typicalCheckSize: lead.budgetRange,
      leadScore: lead.leadScore,
      notes: lead.notes,
    });
  } catch {
    // Best-effort bridge — never break capture on CRM failure.
  }
}

export async function listLeads(): Promise<LeadRecord[]> {
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getLead(id: string): Promise<LeadRecord | null> {
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  return items.find((item) => item.id === id) ?? null;
}

async function mutate(
  id: string,
  apply: (lead: LeadRecord) => LeadRecord,
  eventType: string,
): Promise<LeadRecord | null> {
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const next = { ...apply(items[index]!), updatedAt: nowIso() };
  items[index] = next;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: eventType, leadId: id, lead: next, at: next.updatedAt });
  return next;
}

/**
 * Record new behavior signals on a lead (e.g. "viewed deal", "requested packet"). Signals
 * are merged (true is sticky) and the temperature + score are recomputed from the result.
 */
export async function recordLeadBehavior(
  id: string,
  signals: Partial<LeadBehaviorSignals>,
): Promise<LeadRecord | null> {
  return mutate(id, (lead) => {
    const merged = buildSignals({ ...lead.signals, ...signals });
    const { temperature, leadScore } = scoreLeadBehavior(merged);
    return { ...lead, signals: merged, temperature, leadScore };
  }, 'behavior');
}

/** Move a lead to a new CRM pipeline stage. Returns null if not found / invalid stage. */
export async function setLeadStage(id: string, stage: LeadPipelineStage): Promise<LeadRecord | null> {
  if (!VALID_STAGES.has(stage)) return null;
  return mutate(id, (lead) => ({ ...lead, stage }), 'stage');
}

/** Set (or clear) the owner-approved follow-up due date. */
export async function setLeadFollowUp(id: string, followUpDueAt: string | null): Promise<LeadRecord | null> {
  return mutate(id, (lead) => ({ ...lead, followUpDueAt: normalizeLeadDate(followUpDueAt) }), 'follow_up');
}

/** Compute a follow-up due date N days from now (owner-controlled cadence helper). */
export function followUpDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return d.toISOString();
}

export async function deleteLead(id: string): Promise<boolean> {
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeJsonFile(STATE, next);
  await appendEvent({ type: 'delete', leadId: id, at: nowIso() });
  return true;
}

export type LeadCaptureSummary = {
  marker: string;
  generatedAt: string;
  total: number;
  byTemperature: Record<LeadTemperature, number>;
  byStage: Record<LeadPipelineStage, number>;
  byRole: Record<LeadRole, number>;
  hot: number;
  qualified: number;
  followUpsDue: number;
  closed: number;
  avgLeadScore: number;
};

/** Read-only roll-up over leads for the Power Tools dashboard. */
export async function summarizeLeads(): Promise<LeadCaptureSummary> {
  const items = await readJsonFile<LeadRecord[]>(STATE, []);
  const byTemperature: Record<LeadTemperature, number> = { cold: 0, warm: 0, hot: 0, qualified: 0 };
  const byStage: Record<LeadPipelineStage, number> = {
    new_lead: 0, qualified: 0, contacted: 0, replied: 0, meeting_requested: 0,
    data_room_sent: 0, loi_requested: 0, soft_commitment: 0, closed: 0, lost: 0,
  };
  const byRole: Record<LeadRole, number> = {
    buyer: 0, investor: 0, broker: 0, seller: 0, lender: 0, jv_partner: 0, developer: 0, land_owner: 0,
  };
  const now = Date.now();
  let followUpsDue = 0;
  let scoreSum = 0;
  for (const item of items) {
    byTemperature[item.temperature] = (byTemperature[item.temperature] ?? 0) + 1;
    byStage[item.stage] = (byStage[item.stage] ?? 0) + 1;
    byRole[item.role] = (byRole[item.role] ?? 0) + 1;
    scoreSum += item.leadScore;
    if (item.followUpDueAt && Date.parse(item.followUpDueAt) <= now && item.stage !== 'closed' && item.stage !== 'lost') {
      followUpsDue += 1;
    }
  }
  const total = items.length;
  return {
    marker: IVX_LEAD_CAPTURE_MARKER,
    generatedAt: nowIso(),
    total,
    byTemperature,
    byStage,
    byRole,
    hot: byTemperature.hot,
    qualified: byTemperature.qualified,
    followUpsDue,
    closed: byStage.closed,
    avgLeadScore: total > 0 ? Math.round(scoreSum / total) : 0,
  };
}
