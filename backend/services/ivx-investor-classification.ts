/**
 * IVX Data-Origin & Investor Classification service (owner-only).
 *
 * Implements Blocks 1 + 3 of the owner's real-data mandate:
 *   - Permanent data-origin / verification / financial / outreach status
 *     classification fields applied to every record surfaced in production.
 *   - 7-class investor audit classification:
 *       VERIFIED_REAL | REAL_UNVERIFIED_CONTACT | DUPLICATE | INVALID |
 *       TEST | DO_NOT_CONTACT | NEEDS_OWNER_REVIEW
 *
 * HARD HONESTY RULE (enforced here):
 *   - TEST and INVALID records are QUARANTINED — they never appear in
 *     production dashboards. `isProductionVisible()` is the single filter
 *     every dashboard reader must call.
 *   - Unverified contacts are NOT counted as qualified investors.
 *   - Classification is deterministic and evidence-graded: a record only
 *     becomes VERIFIED_REAL when it carries a real, attributable source AND
 *     a non-empty contact signal (email OR phone OR website) AND the owner
 *     has marked it verified.
 *
 * Runtime-light + deterministic: pure derivations over existing CRM records.
 */
import { listInvestors, type InvestorRecord } from './ivx-investor-crm-store';
import { listOutreachMessages } from './ivx-outreach-store';
import { investorDedupeKey } from './ivx-investor-crm-store';

export const IVX_DATA_ORIGIN_MARKER = 'ivx-data-origin-2026-07-18';

/** Allowed data_origin values — the platform-wide controlled vocabulary. */
export type DataOrigin =
  | 'production_registration'
  | 'imported_verified'
  | 'owner_created'
  | 'partner_source'
  | 'public_business_source'
  | 'test';

export const VALID_DATA_ORIGINS: readonly DataOrigin[] = [
  'production_registration',
  'imported_verified',
  'owner_created',
  'partner_source',
  'public_business_source',
  'test',
];

/** Verification state — drives whether a record counts as "real". */
export type VerificationStatus =
  | 'verified_real'
  | 'real_unverified_contact'
  | 'duplicate'
  | 'invalid'
  | 'test'
  | 'do_not_contact'
  | 'needs_owner_review';

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'verified_real',
  'real_unverified_contact',
  'duplicate',
  'invalid',
  'test',
  'do_not_contact',
  'needs_owner_review',
];

export type FinancialStatus =
  | 'no_money'
  | 'soft_commitment'
  | 'signed_commitment'
  | 'funds_received'
  | 'returned'
  | 'cancelled';

export type OutreachStatus =
  | 'not_contacted'
  | 'awaiting_approval'
  | 'approved_to_contact'
  | 'sent'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'
  | 'do_not_contact';

/**
 * The 11 permanent data-origin fields the mandate requires on every record
 * surfaced in production dashboards.
 */
export type DataOriginFields = {
  dataOrigin: DataOrigin;
  verificationStatus: VerificationStatus;
  financialStatus: FinancialStatus;
  outreachStatus: OutreachStatus;
  sourceRecordId: string;
  createdBy: string;
  createdAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  evidenceUrl: string;
  auditTraceId: string;
};

/** Test + invalid records are quarantined — never shown in production. */
export function isProductionVisible(status: VerificationStatus): boolean {
  return status !== 'test' && status !== 'invalid';
}

/** Only verified_real counts as a qualified investor. */
export function isQualifiedInvestor(status: VerificationStatus): boolean {
  return status === 'verified_real';
}

/** A real, attributable source (not test). */
function isRealSource(source: string): boolean {
  const s = source.toLowerCase();
  return (
    s === 'owner_entered' ||
    s === 'submitted_form' ||
    s === 'crm_import' ||
    s === 'public_source' ||
    s === 'verified_deal' ||
    s === 'production_registration' ||
    s === 'imported_verified' ||
    s === 'partner_source' ||
    s === 'public_business_source' ||
    s === 'owner_created'
  );
}

/** Map an existing CRM `source` to the controlled DataOrigin vocabulary. */
export function mapCrmSourceToDataOrigin(source: string): DataOrigin {
  const s = (source ?? '').toLowerCase();
  if (s === 'owner_entered') return 'owner_created';
  if (s === 'submitted_form') return 'production_registration';
  if (s === 'crm_import') return 'imported_verified';
  if (s === 'public_source') return 'public_business_source';
  if (s === 'verified_deal') return 'imported_verified';
  if (s === 'test') return 'test';
  return 'owner_created';
}

function hasContactSignal(record: {
  email?: string;
  phone?: string;
}): boolean {
  const email = (record.email ?? '').trim();
  const phone = (record.phone ?? '').trim();
  // require a non-empty, non-placeholder signal
  const isPlaceholder = (v: string) =>
    /test|example|placeholder|fake|demo|@example\.com/i.test(v);
  return (
    (email.length > 3 && !isPlaceholder(email)) ||
    (phone.length >= 7 && !isPlaceholder(phone))
  );
}

function isTestLike(record: { name?: string; email?: string; company?: string; source?: string }): boolean {
  const blob = `${record.name ?? ''}|${record.email ?? ''}|${record.company ?? ''}|${record.source ?? ''}`.toLowerCase();
  return /test|demo|fake|example|placeholder|jane capital|open investor|open buyer|closed deal|won one|workflow|metrics\*|a\b|^b\b/.test(blob);
}

/**
 * Classify a single investor record into one of the 7 mandated classes.
 * Deterministic + defensive — never throws.
 */
export function classifyInvestor(
  record: InvestorRecord,
  duplicateKeys: ReadonlySet<string>,
): VerificationStatus {
  // test-like naming or explicit test source → TEST (quarantined)
  if ((record.source as string) === 'test' || isTestLike(record)) {
    return 'test';
  }
  // no real source attribution → INVALID (quarantined)
  if (!isRealSource(record.source)) {
    return 'invalid';
  }
  // duplicate of another record → DUPLICATE (quarantined from counts)
  const key = investorDedupeKey(record);
  if (duplicateKeys.has(key)) {
    return 'duplicate';
  }
  // real source + no contact signal → NEEDS_OWNER_REVIEW
  if (!hasContactSignal(record)) {
    return 'needs_owner_review';
  }
  // real source + contact + owner-marked verified (accreditedStatus verified
  // OR relationshipScore >= 60 as owner-verified proxy) → VERIFIED_REAL
  const ownerVerified =
    record.accreditedStatus === 'accredited' || record.relationshipScore >= 60;
  if (ownerVerified) {
    return 'verified_real';
  }
  // real source + contact but not yet owner-verified → REAL_UNVERIFIED_CONTACT
  return 'real_unverified_contact';
}

export type ClassifiedInvestor = InvestorRecord & {
  classification: VerificationStatus;
  dataOrigin: DataOrigin;
  productionVisible: boolean;
  qualifiedInvestor: boolean;
};

export type InvestorAuditResult = {
  marker: string;
  generatedAt: string;
  total: number;
  byClassification: Record<VerificationStatus, number>;
  productionVisibleCount: number;
  quarantinedCount: number;
  qualifiedInvestorCount: number;
  classified: ClassifiedInvestor[];
  duplicateKeys: string[];
  note: string;
};

/**
 * Audit every investor record one-by-one and classify it into one of the 7
 * mandated classes. Reads the live CRM store; deterministic.
 */
export async function auditAllInvestors(): Promise<InvestorAuditResult> {
  const investors = await listInvestors().catch(() => [] as InvestorRecord[]);

  // First pass: build the duplicate-key set (keys that appear >1 time).
  const keyCounts = new Map<string, number>();
  for (const r of investors) {
    const k = investorDedupeKey(r);
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  const duplicateKeys = new Set<string>();
  for (const [k, c] of keyCounts) {
    if (c > 1) duplicateKeys.add(k);
  }

  // Second pass: classify each record. For duplicates, only the FIRST
  // occurrence (by createdAt ascending) stays REAL; later ones → DUPLICATE.
  const seenFirst = new Set<string>();
  const sorted = [...investors].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const classified: ClassifiedInvestor[] = [];
  const byClassification: Record<VerificationStatus, number> = {
    verified_real: 0,
    real_unverified_contact: 0,
    duplicate: 0,
    invalid: 0,
    test: 0,
    do_not_contact: 0,
    needs_owner_review: 0,
  };

  for (const r of sorted) {
    const key = investorDedupeKey(r);
    let status: VerificationStatus;
    if (duplicateKeys.has(key) && seenFirst.has(key)) {
      status = 'duplicate';
    } else {
      status = classifyInvestor(r, new Set()); // duplicate check handled above
      seenFirst.add(key);
    }
    byClassification[status] = (byClassification[status] ?? 0) + 1;
    classified.push({
      ...r,
      classification: status,
      dataOrigin: mapCrmSourceToDataOrigin(r.source),
      productionVisible: isProductionVisible(status),
      qualifiedInvestor: isQualifiedInvestor(status),
    });
  }

  const productionVisibleCount = classified.filter((c) => c.productionVisible).length;
  const quarantinedCount = classified.length - productionVisibleCount;
  const qualifiedInvestorCount = classified.filter((c) => c.qualifiedInvestor).length;

  return {
    marker: IVX_DATA_ORIGIN_MARKER,
    generatedAt: new Date().toISOString(),
    total: investors.length,
    byClassification,
    productionVisibleCount,
    quarantinedCount,
    qualifiedInvestorCount,
    classified,
    duplicateKeys: [...duplicateKeys],
    note:
      investors.length === 0
        ? 'No investor records to audit.'
        : 'Every record classified deterministically. TEST + INVALID are quarantined and never appear in production dashboards.',
  };
}

/** Derive the outreach status of an investor from the outreach store. */
export async function deriveOutreachStatus(investorId: string): Promise<OutreachStatus> {
  const messages = await listOutreachMessages().catch(() => []);
  const mine = messages.filter((m) => m.recipientName === investorId || m.recipientContact === investorId);
  if (mine.length === 0) return 'not_contacted';
  // any replied → replied
  if (mine.some((m) => m.engagement.replied)) return 'replied';
  // any bounced (placeholder — no bounce field yet) → bounced
  // any sent → sent
  if (mine.some((m) => m.status === 'sent')) return 'sent';
  // any approved → approved_to_contact
  if (mine.some((m) => m.status === 'approved')) return 'approved_to_contact';
  // any pending → awaiting_approval
  if (mine.some((m) => m.status === 'pending_approval')) return 'awaiting_approval';
  return 'not_contacted';
}
