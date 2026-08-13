/**
 * IVX Power Tools Core API — Lead Capture Engine + CRM pipeline + Deal Packet Builder + dashboard.
 *
 * BLOCK 98. Capture is PUBLIC (an anonymous visitor submits the above-the-fold lead form);
 * every management/read route is owner-gated like the rest of the developer surface.
 *
 *   POST /api/ivx/leads/capture            → PUBLIC inbound lead capture (name + real contact)
 *   GET  /api/ivx/leads                    → owner: list leads + summary
 *   GET  /api/ivx/leads/:id                → owner: read one lead
 *   POST /api/ivx/leads/:id/behavior       → owner: record behavior signals (rescores)
 *   POST /api/ivx/leads/:id/stage          → owner: move CRM pipeline stage
 *   POST /api/ivx/leads/:id/follow-up      → owner: set/clear follow-up due date
 *   POST /api/ivx/leads/:id/delete         → owner: delete a lead
 *   GET  /api/ivx/deal-packets             → owner: list packets + summary
 *   POST /api/ivx/deal-packets             → owner: create a packet
 *   GET  /api/ivx/deal-packets/:id         → owner: read one packet
 *   POST /api/ivx/deal-packets/:id/item    → owner: set a packet item status/reference
 *   POST /api/ivx/deal-packets/:id/delete  → owner: delete a packet
 *   GET  /api/ivx/power-tools/dashboard    → owner: unified Power Tools dashboard counts
 *   POST /api/ivx/power-tools/draft        → owner: Gmail-first outreach draft gate
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  captureLead,
  deleteLead,
  followUpDateInDays,
  getLead,
  listLeads,
  recordLeadBehavior,
  setLeadFollowUp,
  setLeadStage,
  summarizeLeads,
  LEAD_PIPELINE_STAGES,
  type CaptureLeadInput,
  type LeadBehaviorSignals,
  type LeadCtaType,
  type LeadPipelineStage,
  type LeadRole,
} from '../services/ivx-lead-capture-store';
import {
  createDealPacket,
  deleteDealPacket,
  getDealPacket,
  listDealPackets,
  setPacketItem,
  summarizeDealPackets,
  type PacketItemStatus,
} from '../services/ivx-deal-packet-store';
import { buildPowerToolsDashboard, prepareOutreachDraft, type PrepareDraftInput } from '../services/ivx-power-tools-dashboard';
import type { OutreachType } from '../services/ivx-outreach-drafter';
import {
  createInvestor,
  updateInvestor,
  listInvestors,
  investorDedupeKey,
  type CreateInvestorInput,
  type InvestorRecord,
  type PartyType,
} from '../services/ivx-investor-crm-store';
import type { LeadRecord } from '../services/ivx-lead-capture-store';

export const OPTIONS = (): Response => ownerOnlyOptions();

const VALID_STAGES: ReadonlySet<string> = new Set(LEAD_PIPELINE_STAGES);
const VALID_ITEM_STATUS: ReadonlySet<string> = new Set(['pending', 'ready', 'not_applicable']);
const VALID_OUTREACH_TYPES: ReadonlySet<string> = new Set([
  'email_campaign', 'follow_up', 'investor_intro', 'buyer_intro', 'meeting_request', 'deal_update',
]);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

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

function bodyToSignals(value: unknown): Partial<LeadBehaviorSignals> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  const out: Partial<LeadBehaviorSignals> = {};
  const keys: (keyof LeadBehaviorSignals)[] = [
    'browsed', 'returned', 'viewedDeal', 'clickedCta', 'submittedForm', 'requestedPacket', 'bookedCall', 'contactVerified',
  ];
  for (const k of keys) if (s[k] !== undefined) out[k] = asBool(s[k]);
  return out;
}

/** Map a lead's role to the CRM party type. Roles without a dedicated party type
 * (seller, land owner, JV partner) map to 'partner'; the precise role is preserved
 * in the contact's investmentType + notes so no information is lost. */
function leadRoleToPartyType(role: LeadRole): PartyType {
  switch (role) {
    case 'investor': return 'investor';
    case 'buyer': return 'buyer';
    case 'broker': return 'broker';
    case 'developer': return 'developer';
    case 'lender': return 'lender';
    case 'jv_partner': return 'partner';
    case 'seller': return 'partner';
    case 'land_owner': return 'partner';
    default: return 'investor';
  }
}

/**
 * Bridge a captured lead into the Investor CRM so the CRM count reflects real leads.
 * Deduplicates on the CRM's stable key (party type + name + email/phone), updating an
 * existing contact instead of creating a duplicate. Never fabricates data — it only
 * carries the lead's real, owner/visitor-supplied fields through. Best-effort: a CRM
 * sync failure never breaks the public capture (the lead is already persisted).
 */
async function syncLeadToCrmContact(lead: LeadRecord): Promise<InvestorRecord | null> {
  try {
    const partyType = leadRoleToPartyType(lead.role);
    const attribution = [lead.source, lead.campaign, lead.page]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
      .join(' · ') || 'lead_form';
    const base: CreateInvestorInput = {
      name: lead.name,
      source: 'submitted_form',
      sourceDetail: `Lead capture (${lead.role}) — ${attribution}`,
      partyType,
      email: lead.email,
      phone: lead.phone,
      investmentType: `Lead role: ${lead.role}`,
      preferredMarkets: lead.preferredMarket ? [lead.preferredMarket] : [],
      typicalCheckSize: lead.budgetRange,
      leadScore: lead.leadScore,
      notes: [lead.notes, lead.dealInterest ? `Deal interest: ${lead.dealInterest}` : '']
        .filter(Boolean).join(' | '),
    };
    const dedupeKey = investorDedupeKey({
      name: base.name, partyType, email: base.email, phone: base.phone,
    });
    const existing = (await listInvestors()).find(
      (c) => investorDedupeKey(c) === dedupeKey,
    );
    if (existing) {
      return await updateInvestor(existing.id, {
        sourceDetail: base.sourceDetail,
        leadScore: Math.max(existing.leadScore, base.leadScore ?? 0),
        notes: base.notes || existing.notes,
      });
    }
    const created = await createInvestor(base);
    return created.ok ? created.investor : null;
  } catch {
    // CRM bridge is best-effort; the lead itself is already durably captured.
    return null;
  }
}

/** PUBLIC — an anonymous visitor submits the above-the-fold lead form. No auth. */
export async function handleLeadCaptureRequest(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    // Honeypot check — if filled, silently reject (item 89, defense in depth)
    if (asString(body.company_website)) {
      return ownerOnlyJson({ ok: false, error: 'Invalid submission.' }, 400);
    }
    const input: CaptureLeadInput = {
      name: asString(body.name),
      email: asString(body.email),
      phone: asString(body.phone),
      role: (asString(body.role) || undefined) as LeadRole | undefined,
      budgetRange: asString(body.budgetRange),
      preferredMarket: asString(body.preferredMarket),
      consent: asBool(body.consent),
      ctaType: (asString(body.ctaType) || null) as LeadCtaType,
      relatedDeal: asString(body.relatedDeal),
      notes: asString(body.notes),
      source: (asString(body.source) || 'lead_form') as CaptureLeadInput['source'],
      sourceDetail: asString(body.sourceDetail),
      campaign: asString(body.campaign),
      page: asString(body.page),
      dealInterest: asString(body.dealInterest),
      signals: bodyToSignals(body.signals),
    };
    const result = await captureLead(input);
    if (!result.ok) {
      return ownerOnlyJson({ ok: false, error: result.error }, 400);
    }
    // Bridge: every real captured lead also creates/updates a matching CRM contact,
    // so the CRM count reflects actual leads instead of staying at 0. Never fabricates —
    // it carries the lead's real name + contact straight through.
    const crmContact = await syncLeadToCrmContact(result.lead);
    // Canonical Members sync — every landing lead becomes one deduped member row.
    try {
      const { upsertCanonicalMember } = await import('../services/ivx-canonical-members');
      await upsertCanonicalMember({
        fullName: result.lead.name,
        email: result.lead.email,
        phone: result.lead.phone,
        memberType: result.lead.role,
        source: 'landing_page',
        sourceDetail: `lead_capture:${result.lead.id}${result.lead.sourceDetail ? ` (${result.lead.sourceDetail})` : ''}`,
        investorInterest: result.lead.dealInterest || '',
        budgetRange: result.lead.budgetRange || '',
        preferredZipcode: result.lead.preferredMarket || '',
        landingSubmissionId: result.lead.id,
        createdAt: result.lead.createdAt,
      });
    } catch (syncErr) {
      console.error('[LeadCapture] Canonical member sync failed (non-fatal):', syncErr);
    }
    return ownerOnlyJson({ ok: true, lead: result.lead, crmContact }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead capture failed.';
    return ownerOnlyJson({ ok: false, error: `Lead capture failed: ${message}` }, 500);
  }
}

export async function handleLeadListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const [leads, summary] = await Promise.all([listLeads(), summarizeLeads()]);
  return ownerOnlyJson({ ok: true, leads, summary });
}

export async function handleLeadGetRequest(request: Request, leadId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const lead = await getLead(leadId);
  if (!lead) return ownerOnlyJson({ ok: false, error: 'Lead not found.' }, 404);
  return ownerOnlyJson({ ok: true, lead });
}

export async function handleLeadBehaviorRequest(request: Request, leadId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const signals = bodyToSignals(body.signals) ?? bodyToSignals(body) ?? {};
  const lead = await recordLeadBehavior(leadId, signals);
  if (!lead) return ownerOnlyJson({ ok: false, error: 'Lead not found.' }, 404);
  return ownerOnlyJson({ ok: true, lead });
}

export async function handleLeadStageRequest(request: Request, leadId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const stage = asString(body.stage) as LeadPipelineStage;
  if (!VALID_STAGES.has(stage)) {
    return ownerOnlyJson({ ok: false, error: `Invalid stage. Use one of: ${LEAD_PIPELINE_STAGES.join(' | ')}.` }, 400);
  }
  const lead = await setLeadStage(leadId, stage);
  if (!lead) return ownerOnlyJson({ ok: false, error: 'Lead not found.' }, 404);
  return ownerOnlyJson({ ok: true, lead });
}

export async function handleLeadFollowUpRequest(request: Request, leadId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  let followUpDueAt: string | null;
  if (body.dueInDays !== undefined) {
    const days = Number(body.dueInDays);
    followUpDueAt = Number.isFinite(days) ? followUpDateInDays(days) : null;
  } else {
    followUpDueAt = body.followUpDueAt === null ? null : asString(body.followUpDueAt) || null;
  }
  const lead = await setLeadFollowUp(leadId, followUpDueAt);
  if (!lead) return ownerOnlyJson({ ok: false, error: 'Lead not found.' }, 404);
  return ownerOnlyJson({ ok: true, lead });
}

export async function handleLeadDeleteRequest(request: Request, leadId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const removed = await deleteLead(leadId);
  if (!removed) return ownerOnlyJson({ ok: false, error: 'Lead not found.' }, 404);
  return ownerOnlyJson({ ok: true, deleted: true, id: leadId });
}

export async function handleDealPacketListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const [packets, summary] = await Promise.all([listDealPackets(), summarizeDealPackets()]);
  return ownerOnlyJson({ ok: true, packets, summary });
}

export async function handleDealPacketCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const result = await createDealPacket({ dealName: asString(body.dealName), relatedDealId: asString(body.relatedDealId) });
  if (!result.ok) return ownerOnlyJson({ ok: false, error: result.error }, 400);
  return ownerOnlyJson({ ok: true, packet: result.packet }, 201);
}

export async function handleDealPacketGetRequest(request: Request, packetId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const packet = await getDealPacket(packetId);
  if (!packet) return ownerOnlyJson({ ok: false, error: 'Deal packet not found.' }, 404);
  return ownerOnlyJson({ ok: true, packet });
}

export async function handleDealPacketItemRequest(request: Request, packetId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const itemKey = asString(body.itemKey);
  const status = asString(body.status) as PacketItemStatus;
  if (!itemKey || !VALID_ITEM_STATUS.has(status)) {
    return ownerOnlyJson({ ok: false, error: 'A valid itemKey and status (pending | ready | not_applicable) are required.' }, 400);
  }
  const packet = await setPacketItem(packetId, itemKey, status, asString(body.reference));
  if (!packet) return ownerOnlyJson({ ok: false, error: 'Deal packet or item not found.' }, 404);
  return ownerOnlyJson({ ok: true, packet });
}

export async function handleDealPacketDeleteRequest(request: Request, packetId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const removed = await deleteDealPacket(packetId);
  if (!removed) return ownerOnlyJson({ ok: false, error: 'Deal packet not found.' }, 404);
  return ownerOnlyJson({ ok: true, deleted: true, id: packetId });
}

export async function handlePowerToolsDashboardRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const dashboard = await buildPowerToolsDashboard();
  return ownerOnlyJson({ ok: true, dashboard });
}

export async function handlePowerToolsDraftRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const type = asString(body.type) as OutreachType;
  if (!VALID_OUTREACH_TYPES.has(type)) {
    return ownerOnlyJson({ ok: false, error: 'A valid outreach type is required.' }, 400);
  }
  const input: PrepareDraftInput = {
    type,
    recipientName: asString(body.recipientName),
    recipientCompany: asString(body.recipientCompany),
    recipientContact: asString(body.recipientContact),
    relatedDeal: asString(body.relatedDeal),
    contextNote: asString(body.contextNote),
    senderName: asString(body.senderName),
    contactVerified: asBool(body.contactVerified),
  };
  const draft = prepareOutreachDraft(input);
  return ownerOnlyJson({ ok: true, draft });
}
