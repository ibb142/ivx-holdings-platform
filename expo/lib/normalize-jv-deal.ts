/**
 * normalizeJVDeal — ONE canonical view model for every deal surface.
 *
 * Maps legacy and current jv_deals fields into a single typed object.
 * Used by: Admin JV Deal Management, Featured Deals (home/invest), 
 * Deal Details, Reels, Investor Pipeline, Documents, Investment Flow.
 *
 * Rules:
 * - Confirmed zero → 0 (rendered as "$0")
 * - Missing value (null/undefined/empty) → null (rendered as "Not entered")
 * - Invalid value (NaN/non-numeric string) → null with invalidFlag (rendered as "Invalid data")
 * - Never converts missing financial data into zero
 * - Never produces NaN/undefined/$undefined
 */
import { isValidNumber, safeNumber } from './formatters';
import { resolveCanonicalDealIdentity } from './deal-identity';

export interface NormalizedJVDeal {
  // Identity
  id: string;
  propertyId: string | null;
  slug: string | null;
  title: string;
  publicTitle: string;
  projectName: string;
  developerName: string;
  // Location
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  location: string;
  // Classification
  dealType: string;
  status: string;
  published: boolean;
  displayOrder: number;
  // Financials — null means "Not entered", 0 means "confirmed zero"
  capitalRequired: number | null;
  totalInvestment: number | null;
  salePrice: number | null;
  estimatedValue: number | null;
  appraisedValue: number | null;
  targetRoiPercent: number | null;
  expectedRoi: number | null;
  minimumInvestment: number | null;
  minimumOwnershipPercent: number | null;
  partnerCount: number;
  amountRaised: number | null;
  // Media
  photos: string[];
  documents: unknown[];
  partners: unknown[];
  // Timestamps
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  // Invalid data flags (for owner warnings)
  invalidFields: string[];
}

/**
 * Read a numeric field from a raw deal record.
 * Returns null for missing values, 0 for confirmed zero, null for invalid.
 */
function readNumeric(rawDeal: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (key in rawDeal) {
      const val = rawDeal[key];
      if (val === null || val === undefined || val === '') return null;
      if (val === 0 || val === '0') return 0;
      const num = Number(val);
      if (Number.isFinite(num)) return num;
      // Invalid value (NaN or non-numeric string)
      return null;
    }
  }
  return null;
}

/**
 * Read a text field from a raw deal record.
 * Returns empty string for missing values.
 */
function readText(rawDeal: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in rawDeal) {
      const val = rawDeal[key];
      if (typeof val === 'string') return val.trim();
      if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
    }
  }
  return '';
}

/**
 * Read a boolean field from a raw deal record.
 */
function readBool(rawDeal: Record<string, unknown>, key: string, fallback = false): boolean {
  if (key in rawDeal) {
    const val = rawDeal[key];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
  }
  return fallback;
}

/**
 * Read an integer field from a raw deal record.
 */
function readInt(rawDeal: Record<string, unknown>, key: string, fallback = 0): number {
  if (key in rawDeal) {
    const val = rawDeal[key];
    if (val === null || val === undefined || val === '') return fallback;
    const num = Number(val);
    if (Number.isFinite(num)) return Math.round(num);
  }
  return fallback;
}

/**
 * Parse photos from a raw deal record (can be JSON array, comma-separated string, or already array).
 */
function readPhotos(rawDeal: Record<string, unknown>): string[] {
  const raw = rawDeal.photos;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((p: unknown) => typeof p === 'string' && (p as string).startsWith('http'));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((p: unknown) => typeof p === 'string' && (p as string).startsWith('http'));
      }
    } catch {
      // Maybe comma-separated
      return raw.split(',').map((s) => s.trim()).filter((s) => s.startsWith('http'));
    }
  }
  return [];
}

/**
 * Deduplicate photos — the DB had duplicated URLs (all 8 items same URL).
 */
function deduplicatePhotos(photos: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of photos) {
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

/**
 * Build a display location string from city/state/country.
 */
function buildLocation(city: string, state: string, country: string): string {
  const parts = [city, state, country].filter((p) => p && p.length > 0);
  return parts.join(', ');
}

/**
 * Generate a slug from a title.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * THE canonical normalization function.
 * Maps any raw jv_deals record (legacy or current schema) into one typed view model.
 */
export function normalizeJVDeal(rawDeal: Record<string, unknown>): NormalizedJVDeal {
  const identity = resolveCanonicalDealIdentity(rawDeal);
  const invalidFields: string[] = [];

  // Detect invalid numeric values (non-null, non-undefined, but NaN/non-numeric)
  const numericChecks: Array<[string, ...string[]]> = [
    ['total_investment', 'totalInvestment', 'total_investment'],
    ['expected_roi', 'expectedROI', 'expected_roi'],
    ['propertyValue', 'propertyValue', 'property_value', 'estimated_value'],
    ['sale_price', 'salePrice', 'sale_price'],
    ['min_investment', 'minInvestment', 'min_investment', 'minimumInvestment', 'minimum_investment'],
  ];
  for (const [label, ...keys] of numericChecks) {
    for (const key of keys) {
      if (key in rawDeal) {
        const val = rawDeal[key];
        if (val !== null && val !== undefined && val !== '' && val !== 0) {
          const num = Number(val);
          if (!Number.isFinite(num)) {
            invalidFields.push(label);
          }
        }
      }
    }
  }

  const photos = deduplicatePhotos(readPhotos(rawDeal));
  const partners = Array.isArray(rawDeal.partners) ? rawDeal.partners : [];
  const documents = Array.isArray(rawDeal.documents) ? rawDeal.documents : [];

  const city = readText(rawDeal, 'city');
  const state = readText(rawDeal, 'state');
  const country = readText(rawDeal, 'country');
  const zipCode = readText(rawDeal, 'zip_code', 'zipCode');

  const title = identity.title || readText(rawDeal, 'title', 'name') || 'Untitled Deal';
  const projectName = identity.projectName || readText(rawDeal, 'project_name', 'projectName') || title;
  const developerName = identity.developerName || readText(rawDeal, 'partner_name', 'partnerName', 'developer_name', 'developerName');

  return {
    // Identity
    id: readText(rawDeal, 'id'),
    propertyId: readText(rawDeal, 'property_id', 'propertyId') || null,
    slug: readText(rawDeal, 'slug') || slugify(title) || null,
    title,
    publicTitle: projectName || title,
    projectName,
    developerName,

    // Location
    propertyAddress: readText(rawDeal, 'property_address', 'propertyAddress'),
    city,
    state,
    zipCode,
    country,
    location: buildLocation(city, state, country),

    // Classification
    dealType: readText(rawDeal, 'type', 'deal_type', 'dealType') || 'jv',
    status: readText(rawDeal, 'status') || 'active',
    published: readBool(rawDeal, 'published', false),
    displayOrder: readInt(rawDeal, 'display_order', 0),

    // Financials — null = "Not entered", 0 = "confirmed zero"
    capitalRequired: readNumeric(rawDeal, 'total_investment', 'totalInvestment', 'capital_required', 'capitalRequired'),
    totalInvestment: readNumeric(rawDeal, 'total_investment', 'totalInvestment'),
    salePrice: readNumeric(rawDeal, 'sale_price', 'salePrice'),
    estimatedValue: readNumeric(rawDeal, 'estimated_value', 'estimatedValue', 'propertyValue', 'property_value'),
    appraisedValue: readNumeric(rawDeal, 'appraised_value', 'appraisedValue'),
    targetRoiPercent: readNumeric(rawDeal, 'expected_roi', 'expectedROI', 'target_roi', 'targetRoi'),
    expectedRoi: readNumeric(rawDeal, 'expected_roi', 'expectedROI'),
    minimumInvestment: readNumeric(rawDeal, 'min_investment', 'minInvestment', 'minimumInvestment', 'minimum_investment'),
    minimumOwnershipPercent: readNumeric(rawDeal, 'minimum_ownership', 'minimumOwnership', 'minimum_ownership_percent'),
    partnerCount: Array.isArray(partners) ? partners.length : safeNumber(rawDeal.partner_count),
    amountRaised: readNumeric(rawDeal, 'amount_raised', 'amountRaised'),

    // Media
    photos,
    documents,
    partners,

    // Timestamps
    createdAt: readText(rawDeal, 'created_at', 'createdAt'),
    updatedAt: readText(rawDeal, 'updated_at', 'updatedAt'),
    publishedAt: readText(rawDeal, 'published_at', 'publishedAt') || null,

    // Invalid data flags
    invalidFields,
  };
}

/**
 * Format a normalized deal field for display.
 * Never returns NaN, undefined, $undefined, null%.
 */
export function formatDealField(value: number | null, type: 'currency' | 'percent', compact = false): string {
  if (value === null) return 'Not entered';
  if (!Number.isFinite(value)) return 'Invalid data';
  if (type === 'currency') {
    if (compact) {
      if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
      if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
      return `$${value.toFixed(0)}`;
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  // percent
  return `${value >= 0 ? '' : ''}${value.toFixed(1)}%`;
}

/**
 * Check if two normalized deals are the same canonical record (by ID, not title).
 */
export function isSameDeal(a: NormalizedJVDeal, b: NormalizedJVDeal): boolean {
  return a.id === b.id && a.id.length > 0;
}
