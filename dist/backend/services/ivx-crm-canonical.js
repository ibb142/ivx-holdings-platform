/**
 * IVX CRM — Canonical company identity, deduplication, VIP tiering, and lead
 * scoring (owner-only, deterministic, no AI/network).
 *
 * One company = one CRM record. Every buyer / investor / JV / tokenized-buyer
 * record resolves to a single `canonicalCompanyId` derived from the strongest
 * available identity signal:
 *
 *   1. cik            — SEC Central Index Key parsed from the source URL/notes
 *   2. website        — first real (non-SEC) http(s) host found in notes/source
 *   3. domain         — email domain
 *   4. legal_name     — explicit company legal name
 *   5. normalized_name— uppercase, punctuation-stripped, suffix-stripped name
 *
 * Dedup is scoped by partyType so the SAME real fund may legitimately exist as
 * BOTH an investor AND a distinct JV partner, while re-runs never duplicate a
 * record of the same type. Pure functions only — fully unit-testable.
 */
/** Company-name suffixes stripped to compute the normalized name. */
const COMPANY_SUFFIXES = [
    'LLC', 'LLP', 'LP', 'LTD', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
    'CO', 'COMPANY', 'DST', 'FUND', 'TRUST', 'HOLDINGS', 'HOLDING', 'PARTNERS',
    'CAPITAL', 'GROUP', 'PLC', 'SA', 'NV', 'GMBH', 'AG',
];
function str(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Normalize a company/legal name into a stable identity token:
 * uppercase, trim, remove punctuation, drop entity suffixes (LLC/LP/INC/...),
 * collapse runs of whitespace.
 */
export function normalizeCompanyName(value) {
    const upper = str(value).toUpperCase();
    if (!upper)
        return '';
    // Replace any non-alphanumeric run with a single space.
    const cleaned = upper.replace(/[^A-Z0-9]+/g, ' ').trim();
    if (!cleaned)
        return '';
    const suffixes = new Set(COMPANY_SUFFIXES);
    const tokens = cleaned.split(' ').filter((t) => t.length > 0);
    // Strip trailing entity suffixes (a fund may end in several, e.g. "X CAPITAL FUND LP").
    while (tokens.length > 1) {
        const last = tokens[tokens.length - 1] ?? '';
        if (suffixes.has(last)) {
            tokens.pop();
        }
        else {
            break;
        }
    }
    return tokens.join(' ');
}
/** Extract a SEC CIK (zero-stripped) from any text containing an EDGAR reference. */
export function extractCik(text) {
    const s = str(text);
    if (!s)
        return null;
    const match = s.match(/cik[=/:_-]?\s*0*(\d{1,10})/i);
    if (match?.[1])
        return String(Number(match[1]));
    const archive = s.match(/edgar\/data\/0*(\d{1,10})/i);
    if (archive?.[1])
        return String(Number(archive[1]));
    return null;
}
/** Extract a usable website host (lowercased, no www) from text, skipping SEC/gov hosts. */
export function extractWebsiteHost(text) {
    const s = str(text);
    if (!s)
        return null;
    const urls = s.match(/https?:\/\/[^\s"')]+/gi) ?? [];
    for (const raw of urls) {
        try {
            const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
            if (!host)
                continue;
            if (/sec\.gov$/.test(host) || /\.gov$/.test(host))
                continue;
            return host;
        }
        catch {
            // ignore malformed URL
        }
    }
    return null;
}
/** Extract the domain from an email address (lowercased, no plus-addressing host change). */
export function extractEmailDomain(email) {
    const s = str(email).toLowerCase();
    const at = s.lastIndexOf('@');
    if (at <= 0 || at === s.length - 1)
        return null;
    const domain = s.slice(at + 1).trim();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain.replace(/^www\./, '') : null;
}
/** Normalized party-type bucket (defaults to 'investor'). */
function partyBucket(value) {
    const v = str(value).toLowerCase();
    return v || 'investor';
}
/**
 * Resolve the canonical company identity for a record using the documented
 * priority. The id is prefixed by party type so dedup never collapses an
 * investor and a JV partner that are the same underlying entity.
 */
export function resolveCanonicalIdentity(input) {
    const party = partyBucket(input.partyType);
    const signalText = `${str(input.sourceDetail)} ${str(input.notes)}`;
    const cik = extractCik(signalText);
    const website = extractWebsiteHost(signalText);
    const domain = extractEmailDomain(input.email);
    const legalName = normalizeCompanyName(input.company);
    const normalizedName = legalName || normalizeCompanyName(input.name);
    let basis = 'unidentified';
    let key = '';
    if (cik) {
        basis = 'cik';
        key = `cik:${cik}`;
    }
    else if (website) {
        basis = 'website';
        key = `web:${website}`;
    }
    else if (domain) {
        basis = 'domain';
        key = `dom:${domain}`;
    }
    else if (legalName) {
        basis = 'legal_name';
        key = `name:${legalName}`;
    }
    else if (normalizedName) {
        basis = 'normalized_name';
        key = `name:${normalizedName}`;
    }
    else {
        // No identity signal at all — fall back to the raw lowercased name so two
        // genuinely empty records still collapse rather than multiply.
        key = `raw:${str(input.name).toLowerCase()}`;
    }
    return {
        canonicalCompanyId: `${party}::${key}`,
        basis,
        cik,
        website,
        domain,
        normalizedName,
    };
}
// ── Capital parsing + VIP tiers ──────────────────────────────────────────────
/**
 * Parse a USD capital figure from free text such as "$100M", "$25M-$100M",
 * "$5,000,000", "2.5 billion". Returns the LARGEST value found (upper bound of
 * a range) so tiering reflects demonstrated capacity, or null if none.
 */
export function parseCapitalUsd(...texts) {
    const joined = texts.map((t) => str(t)).join(' ').toLowerCase();
    if (!joined)
        return null;
    const matches = joined.matchAll(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|m|mm|b|bn|billion|million|thousand)?/gi);
    let best = null;
    for (const m of matches) {
        const rawNum = (m[1] ?? '').replace(/,/g, '');
        const num = Number(rawNum);
        if (!Number.isFinite(num) || num <= 0)
            continue;
        const unit = (m[2] ?? '').toLowerCase();
        let value = num;
        if (unit === 'k' || unit === 'thousand')
            value = num * 1_000;
        else if (unit === 'm' || unit === 'mm' || unit === 'million')
            value = num * 1_000_000;
        else if (unit === 'b' || unit === 'bn' || unit === 'billion')
            value = num * 1_000_000_000;
        // Ignore bare small integers that are almost certainly not capital (e.g. years, counts).
        if (!unit && value < 100_000)
            continue;
        if (best === null || value > best)
            best = value;
    }
    return best;
}
/** Map a USD capital figure to the VIP tier band. Null/unknown capital → EMERGING. */
export function tierForCapital(capitalUsd) {
    if (capitalUsd === null)
        return 'EMERGING';
    if (capitalUsd >= 100_000_000)
        return 'VIP_PLATINUM';
    if (capitalUsd >= 25_000_000)
        return 'VIP_GOLD';
    if (capitalUsd >= 5_000_000)
        return 'VIP_SILVER';
    return 'EMERGING';
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/** Band a 0–100 score into the owner's review buckets. */
export function bandForScore(score) {
    if (score >= 90)
        return 'VIP';
    if (score >= 80)
        return 'TIER1';
    if (score >= 70)
        return 'TIER2';
    if (score >= 50)
        return 'QUALIFIED';
    if (score >= 25)
        return 'COLD';
    return 'REJECT';
}
/**
 * Deterministic, multi-signal lead score (0–100). Replaces the old clustered
 * 38–43 scoring with a real spread driven by capital (AUM), SEC activity, fund
 * age, deal count, market focus, website quality, contactability, and the
 * owner's relationship score.
 */
export function scoreLead(signals) {
    const identityText = `${str(signals.notes)} ${str(signals.sourceDetail)} ${str(signals.typicalCheckSize)}`;
    const capitalUsd = parseCapitalUsd(signals.typicalCheckSize, signals.notes);
    // 1. AUM / capital capacity (0–30) — the dominant signal.
    let aum = 0;
    if (capitalUsd !== null) {
        if (capitalUsd >= 100_000_000)
            aum = 30;
        else if (capitalUsd >= 25_000_000)
            aum = 24;
        else if (capitalUsd >= 5_000_000)
            aum = 16;
        else if (capitalUsd >= 1_000_000)
            aum = 9;
        else
            aum = 4;
    }
    // 2. SEC / public-filing activity (0–18).
    const hasSecSource = /sec\.gov|edgar|form\s*d|cik/i.test(identityText);
    const secActivity = hasSecSource ? 18 : 0;
    // 3. Fund age — older verifiable presence scores higher (0–8).
    let fundAge = 0;
    const created = Date.parse(str(signals.createdAt));
    if (Number.isFinite(created)) {
        const months = (Date.now() - created) / (1000 * 60 * 60 * 24 * 30);
        fundAge = clamp(Math.round(months), 0, 8);
    }
    // 4. Deal / filing count mentioned in notes (0–10).
    const dealMatches = identityText.match(/\b(\d{1,3})\s*(deals?|filings?|offerings?|transactions?)\b/i);
    const dealCount = dealMatches?.[1]
        ? clamp(Math.round(Number(dealMatches[1]) * 1.5), 0, 10)
        : 0;
    // 5. Market focus (0–10) — explicit preferred markets/asset classes.
    const markets = (signals.preferredMarkets ?? []).filter(Boolean).length;
    const assets = (signals.preferredAssetClasses ?? []).filter(Boolean).length;
    const marketFocus = clamp((markets + assets) * 3, 0, 10);
    // 6. Website quality (0–7) — a real corporate domain.
    const website = extractWebsiteHost(identityText);
    const emailDomain = extractEmailDomain(signals.email);
    const websiteQuality = website ? 7 : emailDomain && !/gmail|yahoo|hotmail|outlook|aol/.test(emailDomain) ? 5 : 0;
    // 7. Contactability (0–7) — email + phone.
    let contactability = 0;
    if (extractEmailDomain(signals.email))
        contactability += 4;
    if (str(signals.phone).replace(/[^0-9]/g, '').length >= 7)
        contactability += 3;
    // 8. Owner relationship score (0–10) — owner judgement carries weight.
    const ownerScore = clamp(Math.round(((signals.relationshipScore ?? 0) / 100) * 10), 0, 10);
    const components = {
        aum, secActivity, fundAge, dealCount, marketFocus, websiteQuality, contactability, ownerScore,
    };
    const raw = aum + secActivity + fundAge + dealCount + marketFocus + websiteQuality + contactability + ownerScore;
    const score = clamp(Math.round(raw), 0, 100);
    return { score, band: bandForScore(score), capitalUsd, components };
}
