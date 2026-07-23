import { sanitizeDealPhotosForDeal } from '@/constants/deal-photos';
import { resolveCanonicalDealIdentity } from '@/lib/deal-identity';
import { formatCurrencyCompact, formatCurrencyWithDecimals } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { extractExplicitDealSalePrice, resolveDealTrustMarket } from '@/lib/parse-deal';
import type { ParsedJVDeal, DealTrustInfo } from '@/lib/parse-deal';
import { buildTimelineSummary, type TimelineSummary } from '@/lib/timeline-stages';

export interface PublishedDealCardModel {
  id: string;
  title: string;
  projectName: string;
  developerName: string;
  addressShort: string;
  addressFull: string;
  descriptionShort: string;
  totalInvestment: number;
  propertyValue: number;
  expectedROI: number;
  timeline: string;
  partnersCount: number;
  badges: string[];
  minInvestment: number;
  photos: string[];
  dealType: string;
  status: string;
  exitStrategy: string;
  distributionFrequency: string;
  publishedAt: string;
  updatedAt: string;
  createdAt: string;
  displayOrder: number;
  city: string;
  state: string;
  country: string;
  trustVerified: boolean;
  trustIndicators: string[];
  rawTrustInfo?: DealTrustInfo;
  salePrice: number;
  explicitSalePrice?: number;
  fractionalSharePrice: number;
  ownershipPercentAtMinimum: number;
  ownershipText: string;
  timelineSummary: TimelineSummary;
  // ── Pathway fields (admin-controlled) ──
  tokenizedEnabled: boolean;
  tokenizedStatus: string;
  sharePrice: number;
  jvEnabled: boolean;
  jvStatus: string;
  jvMinimumContribution: number;
  buyerEnabled: boolean;
  buyerStatus: string;
  buyerAskingPrice: number;
  publishState: string;
  slug: string | null;
  capitalRaised: number;
  progressPercentage: number;
  featured: boolean;
}

export const CANONICAL_MIN_INVESTMENT = 50;
export const CANONICAL_DISTRIBUTION_LABEL = 'Monthly';
export const CANONICAL_PLATFORM_TAGLINE = 'Access curated real estate opportunities backed by real assets. Start investing from $50 with fractional ownership and build long-term wealth.';

export const CANONICAL_CLAIMS = {
  minInvestment: 50,
  minInvestmentLabel: '$50',
  distributionFrequency: 'Monthly',
  distributionDisclaimer: 'Distribution frequency varies by deal. See deal details for specifics.',
  platformName: 'IVX Holdings LLC',
  riskDisclaimer: 'All investments involve risk. Past performance is not indicative of future results.',
  complianceNote: 'Investments offered through IVX Holdings LLC. Not FDIC insured.',
  noFdicInsurance: true,
  noSecRegistration: true,
  noLiveTradingYet: true,
  disclaimers: [
    'Not FDIC insured. Not bank guaranteed. May lose value.',
    'Securities offered through IVX Holdings LLC. Past performance is not indicative of future results.',
    'Distribution frequency varies by deal type and is subject to change.',
    'Minimum investment amounts may vary by deal.',
  ] as readonly string[],
  removedClaims: [
    'FDIC protected',
    'SEC compliant',
    '24/7 trading',
    '$2.1B Assets Under Management',
    '52K+ Investors',
    '$1 minimum investment',
  ] as readonly string[],
} as const;

export function validatePublicClaim(claim: string): { valid: boolean; reason?: string } {
  const removed = CANONICAL_CLAIMS.removedClaims.map(c => c.toLowerCase());
  const lower = claim.toLowerCase();

  if (removed.some(r => lower.includes(r.toLowerCase()))) {
    return { valid: false, reason: `Claim "${claim}" has been removed from approved messaging` };
  }

  if (lower.includes('fdic') && !lower.includes('not fdic')) {
    return { valid: false, reason: 'FDIC claims are not permitted — platform is not FDIC insured' };
  }

  if (lower.includes('sec compliant') || lower.includes('sec registered')) {
    return { valid: false, reason: 'SEC compliance/registration claims require legal verification' };
  }

  if (lower.includes('24/7 trading') || lower.includes('live trading')) {
    return { valid: false, reason: 'Live/24/7 trading is not yet available' };
  }

  if (lower.includes('$1 minimum') || lower.includes('$1 min')) {
    return { valid: false, reason: `Canonical minimum investment is ${CANONICAL_CLAIMS.minInvestmentLabel}` };
  }

  return { valid: true };
}

function extractShortAddress(deal: {
  city?: string;
  state?: string;
  propertyAddress?: string;
  property_address?: string;
}): string {
  const city = (deal.city || '').trim();
  const state = (deal.state || '').trim();
  if (city && state) return `${city}, ${state}`;
  const address = (deal.propertyAddress || deal.property_address || '').trim();
  if (address) {
    const parts = address.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
    }
    return address;
  }
  return '';
}

function extractTimeline(deal: {
  trustInfo?: DealTrustInfo | Record<string, unknown>;
  trust_info?: string | Record<string, unknown>;
}): string {
  let trustInfo: DealTrustInfo | undefined;
  if (deal.trustInfo && typeof deal.trustInfo === 'object') {
    trustInfo = deal.trustInfo as DealTrustInfo;
  } else if (deal.trust_info) {
    if (typeof deal.trust_info === 'string') {
      try { trustInfo = JSON.parse(deal.trust_info) as DealTrustInfo; } catch { trustInfo = undefined; }
    } else {
      trustInfo = deal.trust_info as unknown as DealTrustInfo;
    }
  }

  if (trustInfo) {
    if (trustInfo.timelineMin && trustInfo.timelineMax) {
      const unit = trustInfo.timelineUnit === 'years' ? 'yr' : 'mo';
      return `${trustInfo.timelineMin}\u2013${trustInfo.timelineMax} ${unit}`;
    }
    if (trustInfo.timelineMax) {
      const unit = trustInfo.timelineUnit === 'years' ? 'yr' : 'mo';
      return `${trustInfo.timelineMax} ${unit}`;
    }
  }
  return '';
}

function extractRawTrustInfo(deal: Record<string, unknown>): DealTrustInfo | undefined {
  if (deal.trustInfo && typeof deal.trustInfo === 'object') {
    return deal.trustInfo as DealTrustInfo;
  }
  if (deal.trust_info) {
    if (typeof deal.trust_info === 'string') {
      try { return JSON.parse(deal.trust_info) as DealTrustInfo; } catch { return undefined; }
    }
    if (typeof deal.trust_info === 'object') {
      return deal.trust_info as unknown as DealTrustInfo;
    }
  }
  return undefined;
}

function extractBadges(deal: Record<string, unknown>): string[] {
  const badges: string[] = [];
  const type = (typeof deal.type === 'string' ? deal.type : '').toLowerCase();
  if (type) {
    const formatted = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    badges.push(formatted);
  }

  let trustInfo: DealTrustInfo | undefined;
  if (deal.trustInfo && typeof deal.trustInfo === 'object') {
    trustInfo = deal.trustInfo as DealTrustInfo;
  }

  if (trustInfo?.titleVerified) badges.push('Title Verified');
  if (trustInfo?.insuranceCoverage) badges.push('Insured');
  if (trustInfo?.escrowProtected) badges.push('Escrow Protected');
  if (trustInfo?.permitStatus === 'approved') badges.push('Permitted');
  if (trustInfo?.thirdPartyAudit) badges.push('Audited');

  return badges;
}

function extractTrustIndicators(deal: Record<string, unknown>): string[] {
  const indicators: string[] = [];
  let trustInfo: DealTrustInfo | undefined;
  if (deal.trustInfo && typeof deal.trustInfo === 'object') {
    trustInfo = deal.trustInfo as DealTrustInfo;
  }
  if (trustInfo?.titleVerified) indicators.push('title_verified');
  if (trustInfo?.insuranceCoverage) indicators.push('insured');
  if (trustInfo?.escrowProtected) indicators.push('escrow');
  if (trustInfo?.permitStatus === 'approved') indicators.push('permitted');
  if (trustInfo?.thirdPartyAudit) indicators.push('audited');
  return indicators;
}

function getPartnersCount(partners: unknown): number {
  if (typeof partners === 'number') return partners;
  if (Array.isArray(partners)) return partners.length;
  if (typeof partners === 'string') {
    try {
      const p = JSON.parse(partners);
      return Array.isArray(p) ? p.length : 0;
    } catch { return 0; }
  }
  return 0;
}

function str(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

export function mapDealToCardModel(deal: Record<string, unknown>): PublishedDealCardModel {
  const identity = resolveCanonicalDealIdentity(deal);
  const photos = extractPhotos({ ...deal, title: identity.title, projectName: identity.projectName, project_name: identity.projectName });
  const description = str(deal.description_short) || str(deal.description);
  const descShort = description.trim().length > 200 ? description.trim().substring(0, 197) + '...' : description.trim();
  const rawTrustInfo = identity.trustInfo ?? extractRawTrustInfo(deal);
  const trustIndicators = extractTrustIndicators({ ...deal, trustInfo: rawTrustInfo });
  const trustMarket = resolveDealTrustMarket(deal, rawTrustInfo);
  const explicitSalePrice = extractExplicitDealSalePrice(deal, rawTrustInfo);
  const ownershipSnapshot = buildOwnershipSnapshot(trustMarket.minInvestment, trustMarket.salePrice);

  return {
    id: str(deal.id),
    title: identity.title,
    projectName: identity.projectName,
    developerName: identity.developerName,
    addressShort: extractShortAddress(deal as any),
    addressFull: str(deal.propertyAddress) || str(deal.property_address) || str(deal.address_full) || str(deal.address),
    descriptionShort: descShort,
    totalInvestment: Number(deal.totalInvestment || deal.total_investment || 0),
    propertyValue: Number(deal.propertyValue || deal.property_value || deal.estimated_value || 0),
    expectedROI: Number(deal.expectedROI || deal.expected_roi || 0),
    timeline: extractTimeline({ ...(deal as any), trustInfo: rawTrustInfo }),
    partnersCount: Number(deal.partnersCount ?? deal.partners_count ?? getPartnersCount(deal.partners)),
    badges: extractBadges({ ...deal, trustInfo: rawTrustInfo }),
    minInvestment: trustMarket.minInvestment || CANONICAL_MIN_INVESTMENT,
    photos,
    dealType: str(deal.deal_type) || str(deal.type, 'development'),
    status: str(deal.status, 'active'),
    exitStrategy: str(deal.exitStrategy) || str(deal.exit_strategy) || 'Sale upon completion',
    distributionFrequency: str(deal.distributionFrequency) || str(deal.distribution_frequency) || CANONICAL_DISTRIBUTION_LABEL,
    publishedAt: str(deal.publishedAt) || str(deal.published_at),
    updatedAt: str(deal.updatedAt) || str(deal.updated_at) || str(deal.publishedAt) || str(deal.published_at),
    createdAt: str(deal.createdAt) || str(deal.created_at) || str(deal.publishedAt) || str(deal.published_at),
    displayOrder: Number(deal.displayOrder ?? deal.display_order ?? 999),
    city: str(deal.city),
    state: str(deal.state),
    country: str(deal.country),
    trustVerified: trustIndicators.length >= 3,
    trustIndicators,
    rawTrustInfo,
    salePrice: trustMarket.salePrice,
    explicitSalePrice,
    fractionalSharePrice: trustMarket.fractionalSharePrice,
    ownershipPercentAtMinimum: ownershipSnapshot.ownershipPercent,
    ownershipText: rawTrustInfo?.ownershipLabel || ownershipSnapshot.ownershipText,
    timelineSummary: buildTimelineSummary(
      trustMarket.timelineMin,
      trustMarket.timelineMax,
      trustMarket.timelineUnit,
      (deal.timeline_stages as any) ?? null,
      str(deal.created_at) || str(deal.createdAt) || str(deal.publishedAt) || str(deal.published_at) || null,
    ),
    // ── Pathway fields (admin-controlled, from jv_deals columns) ──
    tokenizedEnabled: Boolean(deal.tokenized_enabled ?? false),
    tokenizedStatus: str(deal.tokenized_status, 'TOKENIZED_COMING_SOON'),
    sharePrice: Number(deal.share_price ?? 50),
    jvEnabled: Boolean(deal.jv_enabled ?? true),
    jvStatus: str(deal.jv_status, 'JV_OPEN'),
    jvMinimumContribution: Number(deal.jv_minimum_contribution ?? 20000),
    buyerEnabled: Boolean(deal.buyer_enabled ?? true),
    buyerStatus: str(deal.buyer_status, 'BUYER_OPEN'),
    buyerAskingPrice: Number(deal.buyer_asking_price ?? trustMarket.salePrice ?? 0),
    publishState: str(deal.publish_state, 'published'),
    slug: deal.slug ? str(deal.slug) : null,
    capitalRaised: Number(deal.capital_raised ?? 0),
    progressPercentage: Number(deal.progress_percentage ?? 0),
    featured: Boolean(deal.featured ?? false),
  };
}

function extractPhotos(deal: Record<string, unknown>): string[] {
  let raw: unknown = deal.photos;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];

  const PLACEHOLDER_DOMAINS = [
    'picsum.photos', 'via.placeholder.com', 'placehold.co',
    'placekitten.com', 'loremflickr.com', 'dummyimage.com',
    'fakeimg.pl', 'lorempixel.com', 'placeholder.com',
  ];

  const filtered = (raw as string[]).filter((p: string) => {
    if (typeof p !== 'string' || p.length <= 5) return false;
    if (!p.startsWith('http://') && !p.startsWith('https://')) return false;
    const lower = p.toLowerCase();
    if (lower.startsWith('data:image/')) return false;
    return !PLACEHOLDER_DOMAINS.some(domain => lower.includes(domain));
  });

  const photoVersion = str(deal.updatedAt) || str(deal.updated_at) || str(deal.publishedAt) || str(deal.published_at) || str(deal.createdAt) || str(deal.created_at);
  const appendVersion = (photoUrl: string): string => {
    if (!photoVersion) return photoUrl;
    try {
      const parsedUrl = new URL(photoUrl);
      parsedUrl.searchParams.set('ivxv', photoVersion);
      return parsedUrl.toString();
    } catch {
      const joiner = photoUrl.includes('?') ? '&' : '?';
      return `${photoUrl}${joiner}ivxv=${encodeURIComponent(photoVersion)}`;
    }
  };

  const identity = resolveCanonicalDealIdentity(deal);

  return sanitizeDealPhotosForDeal({
    title: identity.title,
    projectName: identity.projectName,
    project_name: identity.projectName,
  }, filtered).map(appendVersion);
}

export function mapParsedDealToCardModel(deal: ParsedJVDeal): PublishedDealCardModel {
  return mapDealToCardModel(deal as unknown as Record<string, unknown>);
}

export function generateLandingDealHtml(card: PublishedDealCardModel): string {
  const explicitSalePrice = card.explicitSalePrice || 0;
  const salePriceLabel = explicitSalePrice > 0 ? formatCurrencyCompact(explicitSalePrice) : '';
  const marketValueForInvestModal = explicitSalePrice || card.propertyValue || card.totalInvestment || 0;
  const investmentLabel = formatCurrencyCompact(card.totalInvestment || 0);
  const fractionalSharePriceLabel = formatCurrencyWithDecimals(card.fractionalSharePrice || card.minInvestment || CANONICAL_MIN_INVESTMENT);
  const minimumOwnershipLabel = card.ownershipPercentAtMinimum > 0 ? `${card.ownershipPercentAtMinimum.toFixed(4)}% min` : 'Live sync pending';
  const fractionalFromLabel = `from ${formatCurrencyWithDecimals(card.minInvestment || CANONICAL_MIN_INVESTMENT)}`;
  const showEntryPill = Math.abs((card.fractionalSharePrice || card.minInvestment || CANONICAL_MIN_INVESTMENT) - (card.minInvestment || CANONICAL_MIN_INVESTMENT)) > 0.009;
  const safePhotos = Array.isArray(card.photos) ? card.photos : [];
  const renderablePhotos = safePhotos.filter(isRenderablePhotoUrl);
  const photoHtml = renderablePhotos.length > 0
    ? renderablePhotos.map(p => `<img src="${escapeHtml(p)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" onerror="this.closest('.live-deal-gallery')?.classList.add('live-deal-gallery-empty');this.remove();" />`).join('')
    : `<div class="live-deal-no-photo"><span>\u{1F3D7}\u{FE0F}</span><span>Photos coming soon</span></div>`;

  const hasGallery = renderablePhotos.length > 1;
  const galleryDotsHtml = hasGallery
    ? `<div class="live-deal-photo-dots">${renderablePhotos.map((_, i) => `<div class="live-deal-photo-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></div>`).join('')}</div>`
    : '';

  const photoCounter = renderablePhotos.length > 1
    ? `<div class="live-deal-photo-count">1/${renderablePhotos.length}</div>`
    : '';

  const verifiedCount = card.trustIndicators.length;
  const verifiedBadge = verifiedCount >= 3
    ? `<div class="live-deal-verified-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00C48C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> VERIFIED</div>`
    : '';

  const trustBadgesHtml = card.trustIndicators.map(ind => {
    const config: Record<string, { label: string; icon: string }> = {
      title_verified: { label: 'Title Verified', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00C48C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' },
      insured: { label: 'Insured', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
      escrow: { label: 'Escrow', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' },
      permitted: { label: 'Permitted', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00C48C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
      audited: { label: 'Audited', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00C48C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' },
    };
    const c = config[ind];
    if (!c) return '';
    return `<span class="live-deal-trust-badge">${c.icon} ${c.label}</span>`;
  }).join('');

  return `
    <div class="live-deal-card" data-deal-id="${escapeHtml(card.id)}">
      <div class="live-deal-gallery">
        ${hasGallery ? `<div class="live-deal-gallery-slider cr-slider">${photoHtml}</div>` : photoHtml}
        ${galleryDotsHtml}
        <div class="live-deal-overlay-badge"><div class="live-deal-overlay-dot"></div> LIVE</div>
        ${verifiedBadge}
        ${photoCounter}
      </div>
      <div class="live-deal-content">
        <div class="live-deal-header-row" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div class="live-deal-title">${escapeHtml(card.title || card.developerName)}</div>
            ${card.addressShort ? `<div class="live-deal-location"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6A6A6A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHtml(card.addressShort)}</div>` : ''}
          </div>
          ${explicitSalePrice > 0 ? `<div class="live-deal-market-pill live-deal-sale-pill" style="min-width:118px;background:rgba(255,215,0,0.08);border-color:rgba(255,215,0,0.22);">
            <div class="live-deal-market-pill-label">Sale Price</div>
            <div class="live-deal-market-pill-value" style="color:#FFD700;">${escapeHtml(salePriceLabel)}</div>
            <div class="live-deal-market-pill-label" style="color:#00C784;">${escapeHtml(minimumOwnershipLabel)}</div>
          </div>` : ''}
        </div>
        <div class="live-deal-divider"></div>
        <div class="live-deal-metrics">
          <div class="live-deal-metric">
            <div class="live-deal-metric-val">${escapeHtml(investmentLabel)}</div>
            <div class="live-deal-metric-lbl">Investment</div>
          </div>
          <div class="live-deal-metric-div"></div>
          <div class="live-deal-metric">
            <div class="live-deal-metric-val">${card.expectedROI}%</div>
            <div class="live-deal-metric-lbl">ROI</div>
          </div>
          <div class="live-deal-metric-div"></div>
          <div class="live-deal-metric">
            <div class="live-deal-metric-val">${escapeHtml(card.timeline)}</div>
            <div class="live-deal-metric-lbl">Timeline</div>
          </div>
        </div>
        <div class="live-deal-divider"></div>
        <div class="live-deal-market-strip">
          <div class="live-deal-market-pill">
            <div class="live-deal-market-pill-label">Fractional</div>
            <div class="live-deal-market-pill-value">${escapeHtml(fractionalFromLabel)}</div>
          </div>
          ${showEntryPill ? `<div class="live-deal-market-pill">
            <div class="live-deal-market-pill-label">Entry</div>
            <div class="live-deal-market-pill-value">${escapeHtml(fractionalSharePriceLabel)}</div>
          </div>` : ''}
          <div class="live-deal-market-pill">
            <div class="live-deal-market-pill-label">Ownership</div>
            <div class="live-deal-market-pill-value">${escapeHtml(minimumOwnershipLabel)}</div>
          </div>
        </div>
        <div class="live-deal-divider"></div>
        <div class="live-deal-developer-row">
          <div class="live-deal-developer-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v3h4v-3h3v3h4c.6 0 1-.4 1-1v-3"/><path d="M2 18V8c0-.6.4-1 1-1h18c.6 0 1 .4 1 1v10"/><path d="M9 7V4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v3"/></svg></div>
          <span class="live-deal-developer-text">Developed by <span class="live-deal-developer-name">${escapeHtml(card.developerName)}</span></span>
        </div>
        ${card.timelineSummary ? `<div class="live-deal-divider"></div>
        <div class="live-deal-timeline-box" style="background:rgba(36,36,36,0.6);border-radius:12px;padding:12px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style="color:#fff;font-size:13px;font-weight:700;">Project Timeline</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <div style="flex:1;">
              <div style="color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Current Stage</div>
              <div style="color:#fff;font-size:12px;font-weight:700;">${escapeHtml(card.timelineSummary.currentStage || 'Pending')}</div>
            </div>
            <div style="flex:1;">
              <div style="color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Progress</div>
              <div style="color:#fff;font-size:12px;font-weight:700;">${card.timelineSummary.completionPercentage}%</div>
            </div>
            <div style="flex:1;">
              <div style="color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Est. Completion</div>
              <div style="color:#fff;font-size:12px;font-weight:700;">${card.timelineSummary.estimatedCompletionDate ? new Date(card.timelineSummary.estimatedCompletionDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Not available'}</div>
            </div>
          </div>
          <div style="height:4px;background:#2A2A2A;border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(100,Math.max(0,card.timelineSummary.completionPercentage))}%;background:#FFD700;border-radius:2px;"></div>
          </div>
          ${card.timelineSummary.stages.length > 0 ? `<details style="margin-top:10px;">
            <summary style="cursor:pointer;color:#909090;font-size:12px;font-weight:600;list-style:none;display:flex;align-items:center;gap:6px;">View All Stages</summary>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #2A2A2A;">
              ${card.timelineSummary.stages.map((s) => {
                const sc = s.status === 'COMPLETE' ? '#00C48C' : s.status === 'ACTIVE' ? '#FFD700' : s.status === 'DELAYED' ? '#F59E0B' : '#555555';
                const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Not available';
                return `<div style="display:flex;gap:12px;margin-bottom:16px;">
                  <div style="width:16px;flex-shrink:0;">${s.status === 'COMPLETE' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+sc+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+sc+'" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg>'}</div>
                  <div style="flex:1;">
                    <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:4px;">${escapeHtml(s.name)}</div>
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                      <span style="background:${sc}22;color:${sc};font-size:9px;font-weight:700;letter-spacing:0.4px;padding:2px 6px;border-radius:6px;">${s.status}</span>
                      ${s.percentComplete > 0 && s.status !== 'COMPLETE' ? `<span style="color:#909090;font-size:11px;font-weight:600;">${s.percentComplete}%</span>` : ''}
                    </div>
                    <div style="color:#909090;font-size:11px;margin-top:2px;">Start: ${fmtD(s.startDate)}</div>
                    <div style="color:#909090;font-size:11px;">Est. Completion: ${fmtD(s.estimatedCompletionDate)}</div>
                    ${s.actualCompletionDate ? `<div style="color:#00C48C;font-size:11px;font-weight:600;">Completed: ${fmtD(s.actualCompletionDate)}</div>` : ''}
                    ${s.note ? `<div style="color:#555;font-size:11px;font-style:italic;margin-top:4px;">${escapeHtml(s.note)}</div>` : ''}
                  </div>
                </div>`;
              }).join('')}
            </div>
          </details>` : ''}
        </div>` : ''}
        <div class="live-deal-trust-indicators">
          ${trustBadgesHtml}
        </div>
        <div class="live-deal-actions">
          <button class="live-deal-details-btn" onclick="openInvestModal('${escapeHtml(card.id)}','${escapeJs(card.title)}',${card.totalInvestment},${card.expectedROI},'${escapeJs(card.addressShort)}',${marketValueForInvestModal},${card.minInvestment},${card.fractionalSharePrice || 0})">Details</button>
          <button class="live-deal-invest-btn" onclick="openInvestModal('${escapeHtml(card.id)}','${escapeJs(card.title)}',${card.totalInvestment},${card.expectedROI},'${escapeJs(card.addressShort)}',${marketValueForInvestModal},${card.minInvestment},${card.fractionalSharePrice || 0})">Invest Now</button>
        </div>
        <div class="live-deal-min-invest">Invest from <strong>${card.minInvestment}</strong> · ${escapeHtml(card.ownershipText)}</div>
      </div>
    </div>`;
}

function isRenderablePhotoUrl(photoUrl: string): boolean {
  const trimmed = photoUrl.trim();
  return trimmed.length > 0 && !trimmed.startsWith('data:image/gif;base64,R0lGODlhAQABA');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

export function generateLandingInvestModalJs(supabaseUrl: string, supabaseAnonKey: string): string {
  const d = '$';
  return `
<script>
var _activeDeal = null;
var _supabaseUrl = '${supabaseUrl}';
var _supabaseAnonKey = '${supabaseAnonKey}';

function openInvestModal(dealId, dealTitle, totalInvestment, expectedRoi, address, propertyValue, minInvestment, fractionalSharePrice) {
  console.log('[Landing] openInvestModal called:', dealId, dealTitle, totalInvestment, expectedRoi, address, 'propertyValue:', propertyValue, 'minInvestment:', minInvestment, 'fractionalSharePrice:', fractionalSharePrice);
  _activeDeal = {
    deal_id: dealId,
    deal_name: dealTitle,
    total_investment: totalInvestment,
    expected_roi: expectedRoi,
    address: address,
    property_value: propertyValue || 0,
    min_investment: minInvestment || 50,
    fractional_share_price: fractionalSharePrice || minInvestment || 50
  };
  var modal = document.getElementById('ivx-invest-modal');
  if (!modal) { console.error('[Landing] invest modal element not found'); return; }
  var titleEl = modal.querySelector('.invest-modal-deal-name');
  if (titleEl) titleEl.textContent = dealTitle || 'Unknown Deal';
  var addrEl = modal.querySelector('.invest-modal-address');
  if (addrEl) addrEl.textContent = address || '';
  var investEl = modal.querySelector('.invest-modal-total');
  if (investEl) investEl.textContent = '${d}' + Number(propertyValue || totalInvestment || 0).toLocaleString();
  var roiEl = modal.querySelector('.invest-modal-roi');
  if (roiEl) roiEl.textContent = (expectedRoi || 0) + '% ROI';
  updateOwnershipCalc();
  modal.style.display = 'flex';
}

function closeInvestModal() {
  var modal = document.getElementById('ivx-invest-modal');
  if (modal) modal.style.display = 'none';
  _activeDeal = null;
}

function updateOwnershipCalc() {
  var amountInput = document.getElementById('invest-amount-input');
  if (!amountInput || !_activeDeal) return;
  var amount = parseFloat(amountInput.value.replace(/[^0-9.]/g, '')) || 0;
  var propVal = _activeDeal.property_value || _activeDeal.total_investment || 0;
  var ownership = propVal > 0 ? (amount / propVal) * 100 : 0;
  var roi = _activeDeal.expected_roi || 0;
  var profit = amount * (roi / 100);
  var ownerEl = document.getElementById('invest-ownership');
  if (ownerEl) ownerEl.textContent = ownership.toFixed(2) + '%';
  var profitEl = document.getElementById('invest-profit');
  if (profitEl) profitEl.textContent = '${d}' + profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  var payoutEl = document.getElementById('invest-payout');
  if (payoutEl) payoutEl.textContent = '${d}' + (amount + profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function submitLandingInvestment() {
  if (!_activeDeal) { alert('No deal selected. Please click Invest on a deal card.'); return; }
  var form = document.getElementById('invest-form');
  if (!form) return;
  var fullName = (form.querySelector('[name="full_name"]') || {}).value || '';
  var email = (form.querySelector('[name="email"]') || {}).value || '';
  var phone = (form.querySelector('[name="phone"]') || {}).value || '';
  var amountInput = document.getElementById('invest-amount-input');
  var amount = parseFloat((amountInput ? amountInput.value : '0').replace(/[^0-9.]/g, '')) || 0;
  if (!fullName || !email || amount <= 0) {
    alert('Please fill in your name, email, and investment amount.');
    return;
  }
  var propVal = _activeDeal.property_value || _activeDeal.total_investment || 0;
  var ownership = propVal > 0 ? (amount / propVal) * 100 : 0;
  var payload = {
    source: 'landing_page',
    deal_id: _activeDeal.deal_id,
    deal_name: _activeDeal.deal_name,
    investment_type: 'fractional_shares',
    investment_amount: amount,
    ownership_percent: parseFloat(ownership.toFixed(4)),
    expected_roi: _activeDeal.expected_roi,
    full_name: fullName,
    email: email,
    phone: phone,
    status: 'pending',
    submitted_at: new Date().toISOString()
  };
  console.log('[Landing] Submitting investment:', JSON.stringify(payload));
  var submitBtn = document.getElementById('invest-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }
  fetch(_supabaseUrl + '/rest/v1/landing_submissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': _supabaseAnonKey,
      'Authorization': 'Bearer ' + _supabaseAnonKey,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(payload)
  }).then(function(res) {
    console.log('[Landing] Submit response:', res.status);
    if (res.ok) {
      showInvestSuccess(payload);
    } else {
      res.text().then(function(t) { console.error('[Landing] Submit error:', t); });
      alert('Submission failed. Please try again or contact support.');
    }
  }).catch(function(err) {
    console.error('[Landing] Submit network error:', err);
    alert('Network error. Please check your connection and try again.');
  }).finally(function() {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Confirm Investment'; }
  });
}

function showInvestSuccess(payload) {
  var modal = document.getElementById('ivx-invest-modal');
  if (!modal) return;
  var content = modal.querySelector('.invest-modal-content');
  if (content) {
    content.innerHTML = '<div style="text-align:center;padding:40px 20px">' +
      '<div style="font-size:48px;margin-bottom:16px">\u2705</div>' +
      '<h3 style="color:#00C48C;margin-bottom:8px">Investment Submitted</h3>' +
      '<p style="color:#999;margin-bottom:16px">Your investment of ${d}' + payload.investment_amount.toLocaleString() + ' in ' + (payload.deal_name || 'this deal') + ' has been submitted for review.</p>' +
      '<p style="color:#666;font-size:13px">We will contact you at ' + payload.email + ' to finalize your investment.</p>' +
      '<button onclick="closeInvestModal()" style="margin-top:24px;padding:12px 32px;background:#00C48C;color:#000;border:none;border-radius:12px;font-weight:700;cursor:pointer">Done</button>' +
      '</div>';
  }
}

function submitLandingRegistration() {
  var form = document.getElementById('register-form');
  if (!form) return;
  var fullName = (form.querySelector('[name="full_name"]') || {}).value || '';
  var email = (form.querySelector('[name="email"]') || {}).value || '';
  var phone = (form.querySelector('[name="phone"]') || {}).value || '';
  if (!fullName || !email) {
    alert('Please fill in your name and email.');
    return;
  }
  var payload = {
    source: 'landing_page',
    type: 'registration',
    full_name: fullName,
    email: email,
    phone: phone,
    status: 'pending',
    submitted_at: new Date().toISOString()
  };
  console.log('[Landing] Submitting registration:', JSON.stringify(payload));
  var submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }
  fetch(_supabaseUrl + '/rest/v1/landing_submissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': _supabaseAnonKey,
      'Authorization': 'Bearer ' + _supabaseAnonKey,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(payload)
  }).then(function(res) {
    console.log('[Landing] Registration response:', res.status);
    if (res.ok) {
      alert('Registration submitted! We will be in touch.');
      form.reset();
    } else {
      res.text().then(function(t) { console.error('[Landing] Registration error:', t); });
      alert('Registration failed. Please try again.');
    }
  }).catch(function(err) {
    console.error('[Landing] Registration network error:', err);
    alert('Network error. Please check your connection.');
  }).finally(function() {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign Up'; }
  });
}
</script>`;
}

export function generateCanonicalDealJson(card: PublishedDealCardModel): Record<string, unknown> {
  return {
    id: card.id,
    title: card.title,
    developer_name: card.developerName,
    address_short: card.addressShort,
    address_full: card.addressFull,
    description_short: card.descriptionShort,
    total_investment: card.totalInvestment,
    property_value: card.propertyValue || 0,
    sale_price: card.explicitSalePrice || 0,
    fractional_share_price: card.fractionalSharePrice,
    ownership_percent_at_minimum: card.ownershipPercentAtMinimum,
    ownership_text: card.ownershipText,
    expected_roi: card.expectedROI,
    timeline: card.timeline,
    partners_count: card.partnersCount,
    badges: card.badges,
    min_investment: card.minInvestment,
    photos: card.photos,
    deal_type: card.dealType,
    status: card.status,
    exit_strategy: card.exitStrategy,
    distribution_frequency: card.distributionFrequency,
    published_at: card.publishedAt,
    display_order: card.displayOrder,
    city: card.city,
    state: card.state,
    country: card.country,
    trust_verified: card.trustVerified,
    trust_indicators: card.trustIndicators,
    timeline_stages: card.timelineSummary?.stages ?? [],
    current_timeline_stage: card.timelineSummary?.currentStage ?? null,
    project_completion_percent: card.timelineSummary?.completionPercentage ?? 0,
    estimated_completion_date: card.timelineSummary?.estimatedCompletionDate ?? null,
  };
}
