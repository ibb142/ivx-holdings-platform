/**
 * IVX Capital Deployment Platform — Investor CRM API (owner-only).
 *
 * BLOCK 20. Full CRUD over owner-managed investor records:
 *   GET    /api/ivx/investors            → list investors (newest first) + summary
 *   POST   /api/ivx/investors            → create an investor (name + real source required)
 *   GET    /api/ivx/investors/:id        → read one investor
 *   POST   /api/ivx/investors/:id        → update an investor (partial)
 *   POST   /api/ivx/investors/:id/status → move pipeline status
 *   POST   /api/ivx/investors/:id/delete → delete an investor
 *
 * Owner-only. IVX never fabricates investor data — `name` + a real `source`
 * (owner_entered | submitted_form | crm_import | public_source | verified_deal)
 * are required on create; public_source / crm_import also require attribution.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  createInvestor,
  deleteInvestor,
  getInvestor,
  importInvestors,
  listInvestors,
  listInvestorsWithSummary,
  normalizePartyType,
  setInvestorStatus,
  summarizeInvestors,
  updateInvestor,
  type AccreditedStatus,
  type CreateInvestorInput,
  type InvestorSource,
  type InvestorStatus,
  type PartyType,
  type UpdateInvestorInput,
} from '../services/ivx-investor-crm-store';
import {
  mapManualRowsToInvestorInputs,
  parseCsvToInvestorInputs,
} from '../services/ivx-crm-import';

export const OPTIONS = (): Response => ownerOnlyOptions();

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STATUS: ReadonlySet<string> = new Set([
  'prospect', 'contacted', 'meeting_scheduled', 'active', 'invested',
]);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v)).filter(Boolean);
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
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

/** Map a JSON body to an UpdateInvestorInput, omitting absent fields. */
function bodyToUpdateInput(body: Record<string, unknown>): UpdateInvestorInput {
  const patch: UpdateInvestorInput = {};
  if (body.name !== undefined) patch.name = asString(body.name);
  if (body.company !== undefined) patch.company = asString(body.company);
  if (body.email !== undefined) patch.email = asString(body.email);
  if (body.phone !== undefined) patch.phone = asString(body.phone);
  if (body.location !== undefined) patch.location = asString(body.location);
  if (body.investmentType !== undefined) patch.investmentType = asString(body.investmentType);
  if (body.accreditedStatus !== undefined) patch.accreditedStatus = asString(body.accreditedStatus) as AccreditedStatus;
  const markets = asOptionalStringArray(body.preferredMarkets);
  if (markets !== undefined) patch.preferredMarkets = markets;
  const assets = asOptionalStringArray(body.preferredAssetClasses);
  if (assets !== undefined) patch.preferredAssetClasses = assets;
  if (body.typicalCheckSize !== undefined) patch.typicalCheckSize = asString(body.typicalCheckSize);
  if (body.investmentTimeline !== undefined) patch.investmentTimeline = asString(body.investmentTimeline);
  if (body.notes !== undefined) patch.notes = asString(body.notes);
  if (body.lastContactDate !== undefined) patch.lastContactDate = body.lastContactDate === null ? null : asString(body.lastContactDate);
  const lead = asOptionalNumber(body.leadScore);
  if (lead !== undefined) patch.leadScore = lead;
  const rel = asOptionalNumber(body.relationshipScore);
  if (rel !== undefined) patch.relationshipScore = rel;
  if (body.status !== undefined && VALID_STATUS.has(asString(body.status))) patch.status = asString(body.status) as InvestorStatus;
  if (body.source !== undefined && VALID_SOURCES.has(asString(body.source))) patch.source = asString(body.source) as InvestorSource;
  if (body.sourceDetail !== undefined) patch.sourceDetail = asString(body.sourceDetail);
  return patch;
}

export async function handleInvestorListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get('limit') ?? '200', 10);
  const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  // Single durable read: avoid loading the large investor JSON twice in parallel.
  const { investors: allInvestors, total, summary } = await listInvestorsWithSummary();
  const investors = allInvestors.slice(offset, offset + limit);
  return ownerOnlyJson({ ok: true, investors, summary, total, limit, offset, hasMore: offset + limit < total });
}

export async function handleInvestorCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const input: CreateInvestorInput = {
    name: asString(body.name),
    source: asString(body.source) as InvestorSource,
    sourceDetail: asString(body.sourceDetail),
    company: asString(body.company),
    email: asString(body.email),
    phone: asString(body.phone),
    location: asString(body.location),
    investmentType: asString(body.investmentType),
    accreditedStatus: asString(body.accreditedStatus) as AccreditedStatus,
    preferredMarkets: asOptionalStringArray(body.preferredMarkets) ?? [],
    preferredAssetClasses: asOptionalStringArray(body.preferredAssetClasses) ?? [],
    typicalCheckSize: asString(body.typicalCheckSize),
    investmentTimeline: asString(body.investmentTimeline),
    notes: asString(body.notes),
    lastContactDate: body.lastContactDate === null ? null : asString(body.lastContactDate) || null,
    leadScore: asOptionalNumber(body.leadScore),
    relationshipScore: asOptionalNumber(body.relationshipScore),
    status: VALID_STATUS.has(asString(body.status)) ? (asString(body.status) as InvestorStatus) : undefined,
  };
  const result = await createInvestor(input);
  if (!result.ok) {
    return ownerOnlyJson({ ok: false, error: result.error }, 400);
  }
  return ownerOnlyJson({ ok: true, investor: result.investor }, 201);
}

export async function handleInvestorGetRequest(request: Request, investorId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const investor = await getInvestor(investorId);
  if (!investor) {
    return ownerOnlyJson({ ok: false, error: 'Investor not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, investor });
}

export async function handleInvestorUpdateRequest(request: Request, investorId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const updated = await updateInvestor(investorId, bodyToUpdateInput(body));
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Investor not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, investor: updated });
}

export async function handleInvestorStatusRequest(request: Request, investorId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const status = asString(body.status) as InvestorStatus;
  if (!VALID_STATUS.has(status)) {
    return ownerOnlyJson({ ok: false, error: 'Invalid status. Use prospect | contacted | meeting_scheduled | active | invested.' }, 400);
  }
  const updated = await setInvestorStatus(investorId, status);
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Investor not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, investor: updated });
}

export async function handleInvestorDeleteRequest(request: Request, investorId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const removed = await deleteInvestor(investorId);
  if (!removed) {
    return ownerOnlyJson({ ok: false, error: 'Investor not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, deleted: true, id: investorId });
}

/**
 * Owner-approved bulk import. Accepts either pasted CSV text (the format Excel
 * exports natively) via `csv`, or structured `rows` for manual entry. Every
 * imported record is attributed `crm_import` with the required `sourceDetail`,
 * and the response always reports the exact imported / skipped counts so the
 * owner sees the real result after every import. Never fabricates a contact.
 */
export async function handleInvestorImportRequest(request: Request): Promise<Response> {
  // Auth first — never 500 on an auth failure (requireOwner maps to 401/403).
  const denied = await requireOwner(request);
  if (denied) return denied;
  try {
    return await runInvestorImport(request);
  } catch (error) {
    // Defensive: a genuine processing fault must surface as an honest server
    // error with a structured body, never an opaque unhandled 500.
    const message = error instanceof Error ? error.message : 'Import failed unexpectedly.';
    console.error('[ivx-investor-crm] import failed', message);
    return ownerOnlyJson({ ok: false, error: `Import failed: ${message}` }, 500);
  }
}

async function runInvestorImport(request: Request): Promise<Response> {
  const body = await readJsonBody(request);

  const partyTypeRaw = asString(body.partyType);
  const partyType: PartyType = partyTypeRaw ? normalizePartyType(partyTypeRaw) : 'investor';
  const sourceDetail = asString(body.sourceDetail) || (typeof body.fileName === 'string' ? asString(body.fileName) : '');
  if (!sourceDetail) {
    return ownerOnlyJson(
      { ok: false, error: 'sourceDetail is required (the import file name or "pasted YYYY-MM-DD") for honest attribution.' },
      400,
    );
  }

  const csv = typeof body.csv === 'string' ? body.csv : '';
  const rows = Array.isArray(body.rows) ? (body.rows as unknown[]) : null;

  let parsed;
  if (csv.trim()) {
    parsed = parseCsvToInvestorInputs(csv, { partyType, sourceDetail });
  } else if (rows) {
    const recordRows = rows.filter(
      (r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r),
    );
    parsed = mapManualRowsToInvestorInputs(recordRows, { partyType, sourceDetail });
  } else {
    return ownerOnlyJson(
      { ok: false, error: 'Provide either `csv` (text) or `rows` (array of records) to import.' },
      400,
    );
  }

  if (parsed.inputs.length === 0) {
    return ownerOnlyJson(
      {
        ok: false,
        error: 'No importable rows found — every row was missing a name. IVX never fabricates a contact.',
        imported: 0,
        skipped: parsed.skippedRows.length,
        skippedRows: parsed.skippedRows,
        recognizedColumns: parsed.recognizedColumns,
      },
      400,
    );
  }

  const result = await importInvestors(parsed.inputs);
  const summary = await summarizeInvestors();
  // Owner-facing import receipt: total rows seen, real records imported,
  // duplicates skipped (same name + email/phone/company), invalid rows skipped,
  // and the resulting total contacts now in the CRM.
  return ownerOnlyJson(
    {
      ok: true,
      partyType,
      total: parsed.totalRows,
      imported: result.imported,
      duplicates: result.duplicates,
      invalid: result.skipped + parsed.skippedRows.length,
      skipped: result.skipped + result.duplicates + parsed.skippedRows.length,
      totalContacts: summary.total,
      recognizedColumns: parsed.recognizedColumns,
      duplicateRows: result.duplicateRows.map((d) => ({ row: d.index + 1, reason: d.reason })),
      invalidRows: [...parsed.skippedRows, ...result.errors.map((e) => ({ row: e.index + 1, reason: e.error }))],
      records: result.records,
      summary,
    },
    201,
  );
}
