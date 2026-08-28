import fs from 'node:fs';

const failures = [];
const evidence = [];

function read(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    failures.push({ type: 'missing_file', path, message: String(error?.message || error) });
    return '';
  }
}

function functionSlice(source, signature, max = 9000) {
  const start = source.indexOf(signature);
  if (start < 0) return '';
  return source.slice(start, start + max);
}

// Contract 1: the canonical investment card must expose a real View Deal press path.
const investmentCard = read('expo/components/InvestmentCard.tsx');
const cardHasViewDeal = investmentCard.includes('onPress={handleViewDeal}') && investmentCard.includes('onOpenDeal(data)');
evidence.push({ contract: 'investment_card_view_deal_press', ok: cardHasViewDeal });
if (!cardHasViewDeal) {
  failures.push({
    type: 'navigation_contract',
    path: 'expo/components/InvestmentCard.tsx',
    message: 'InvestmentCard View Deal CTA is not wired through handleViewDeal -> onOpenDeal(data).',
  });
}

// Contract 2: landing View Deal navigation and destination resolver must share a survivable source of truth.
// Landing uses the canonical/public published-deal source. The destination resolver may prefer Supabase/local,
// but it must also have a canonical/public API fallback before returning null.
const landing = read('expo/app/landing.tsx');
const jvStorage = read('expo/lib/jv-storage.ts');
const landingUsesCanonical = landing.includes('fetchCanonicalDeals(');
const landingRoutesToJvInvest = landing.includes("router.push(`/jv-invest?jvId=${d.dealId}`") || landing.includes("pathname: '/jv-invest'");
const fetchById = functionSlice(jvStorage, 'export async function fetchJVDealById');
const resolverUsesPublicFallback = fetchById.includes('getLandingDealsReadUrls()') || fetchById.includes('published deals API fallback');

evidence.push({ contract: 'landing_uses_canonical_deals', ok: landingUsesCanonical });
evidence.push({ contract: 'landing_routes_view_deal_to_jv_invest', ok: landingRoutesToJvInvest });
evidence.push({ contract: 'destination_resolver_has_public_fallback', ok: resolverUsesPublicFallback });

if (landingUsesCanonical && landingRoutesToJvInvest && !resolverUsesPublicFallback) {
  failures.push({
    type: 'cross_screen_data_source_drift',
    path: 'expo/lib/jv-storage.ts',
    message: 'Landing can render a canonical/public deal that fetchJVDealById cannot resolve. Add the canonical/public published-deals fallback to fetchJVDealById before returning null.',
    source: 'expo/app/landing.tsx',
    destination: 'expo/app/jv-invest.tsx',
    resolver: 'expo/lib/jv-storage.ts#fetchJVDealById',
    severity: 'high',
    repairClass: 'low_risk_code',
  });
}

// Contract 3: Home feed and Landing must route by stable deal ID, never title/index.
const homeFeed = read('expo/components/InvestorFirstFeed.tsx');
const homeRoutesById = homeFeed.includes('goToDeal(d.dealId)') || homeFeed.includes('goToDeal(block.deal.id)');
evidence.push({ contract: 'home_routes_by_stable_deal_id', ok: homeRoutesById });
if (!homeRoutesById) {
  failures.push({
    type: 'identity_contract',
    path: 'expo/components/InvestorFirstFeed.tsx',
    message: 'Home feed View Deal navigation is not proven to use the stable deal ID.',
  });
}

// Contract 4: any public deal loader that can render a CTA must never silently swallow a resolver mismatch.
const jvInvest = read('expo/app/jv-invest.tsx');
const destinationConsumesJvId = jvInvest.includes("useLocalSearchParams<{ jvId: string }>") && jvInvest.includes('fetchJVDealById(jvId)');
evidence.push({ contract: 'jv_invest_consumes_jv_id', ok: destinationConsumesJvId });
if (!destinationConsumesJvId) {
  failures.push({
    type: 'destination_contract',
    path: 'expo/app/jv-invest.tsx',
    message: 'JV destination does not clearly resolve the routed jvId through fetchJVDealById.',
  });
}

const result = {
  ok: failures.length === 0,
  auditedAt: new Date().toISOString(),
  audit: 'IVX autonomous route/data contract patrol',
  evidence,
  failures,
};

fs.mkdirSync('/tmp/ivx-radar', { recursive: true });
fs.writeFileSync('/tmp/ivx-radar/route-data-contract.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) process.exit(17);
