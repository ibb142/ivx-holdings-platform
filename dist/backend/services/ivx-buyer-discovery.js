/**
 * IVX Buyer Discovery Engine — REAL named buyers/acquirers from public SEC filings.
 *
 * This is the buyer-side counterpart to `ivx-investor-discovery`. It reuses the
 * same LEGAL, verifiable SEC EDGAR Form D source (every U.S. Reg D private
 * placement is a public federal filing with the issuer's real legal name,
 * principals, business address, and offering amount), then deterministically
 * CLASSIFIES each discovered entity into one of the seven buyer types the owner
 * asked for:
 *
 *   cash_buyer · family_office · developer · operator · acquisition_group ·
 *   broker · reit
 *
 * Nothing is fabricated: every buyer record carries the original SEC filing link
 * for verification. The classification is a transparent, rule-based read of the
 * filer's public entity name + declared industry/entity type — never a guess
 * presented as fact (the matched signal is returned on every record).
 *
 * Read-only. No personal mobile numbers, no scraped private data — only the
 * business contact information the filer chose to make public on a federal form.
 */
import { discoverInvestors, } from './ivx-investor-discovery';
export const IVX_BUYER_DISCOVERY_MARKER = 'ivx-buyer-discovery-2026-06-12';
export const BUYER_TYPES = [
    'cash_buyer',
    'family_office',
    'developer',
    'operator',
    'acquisition_group',
    'broker',
    'reit',
];
export const BUYER_TYPE_LABEL = {
    cash_buyer: 'Cash buyer / private capital',
    family_office: 'Family office',
    developer: 'Developer',
    operator: 'Operator',
    acquisition_group: 'Acquisition group / fund',
    broker: 'Broker / realty',
    reit: 'REIT',
};
/** Case-insensitive whole/loose token test against an entity name. */
function nameHas(name, ...tokens) {
    const lower = name.toLowerCase();
    for (const token of tokens) {
        if (lower.includes(token.toLowerCase()))
            return token;
    }
    return null;
}
/**
 * Deterministically classify a discovered entity into a buyer type using only
 * public filing data (entity name + declared industry group). Pure + ordered:
 * the most specific signals win first. Returns the matched signal for proof.
 */
export function classifyBuyerType(investor) {
    const name = investor.entityName ?? '';
    const industry = (investor.industryGroup ?? '').toLowerCase();
    // REIT — strongest, most specific signal.
    const reitToken = nameHas(name, 'REIT', 'Real Estate Investment Trust');
    if (reitToken || industry.includes('reit')) {
        return { buyerType: 'reit', classificationSignal: reitToken ?? `industry:${industry}` };
    }
    // Family office.
    const familyToken = nameHas(name, 'Family Office', 'Family Partners', 'Family Holdings', 'Family Trust');
    if (familyToken) {
        return { buyerType: 'family_office', classificationSignal: familyToken };
    }
    // Broker / realty / brokerage.
    const brokerToken = nameHas(name, 'Brokerage', 'Realty', 'Realtors', 'Brokers');
    if (brokerToken) {
        return { buyerType: 'broker', classificationSignal: brokerToken };
    }
    // Developer.
    const developerToken = nameHas(name, 'Development', 'Developers', 'Developer', 'Builders', 'Homes', 'Construction');
    if (developerToken) {
        return { buyerType: 'developer', classificationSignal: developerToken };
    }
    // Operator (property/asset operations).
    const operatorToken = nameHas(name, 'Operating', 'Operators', 'Management', 'Property Management', 'Communities', 'Residential');
    if (operatorToken) {
        return { buyerType: 'operator', classificationSignal: operatorToken };
    }
    // Acquisition group / fund / capital vehicle.
    const acqToken = nameHas(name, 'Acquisition', 'Acquisitions', 'Capital', 'Partners', 'Fund', 'Equity', 'Ventures', 'Holdings', 'Group');
    if (acqToken) {
        return { buyerType: 'acquisition_group', classificationSignal: acqToken };
    }
    // Default: a real-estate private-capital entity with no narrower signal.
    return { buyerType: 'cash_buyer', classificationSignal: 'default:private-capital-entity' };
}
function emptyCounts() {
    return {
        cash_buyer: 0,
        family_office: 0,
        developer: 0,
        operator: 0,
        acquisition_group: 0,
        broker: 0,
        reit: 0,
    };
}
function normalizeRequestedTypes(types) {
    if (!Array.isArray(types) || types.length === 0)
        return [];
    return BUYER_TYPES.filter((t) => types.includes(t));
}
/**
 * Discover and classify real buyer entities from public SEC Form D filings.
 * Returns an honest `ok:false` + reason on failure; never throws.
 */
export async function discoverBuyers(options = {}) {
    const requestedTypes = normalizeRequestedTypes(options.buyerTypes);
    const discovery = await discoverInvestors({
        query: options.query ?? 'real estate',
        discoveryClass: options.discoveryClass ?? 'buyers',
        minOfferingUsd: options.minOfferingUsd,
        limit: options.limit,
        fetchImpl: options.fetchImpl,
        delayMs: options.delayMs,
    });
    const countsByType = emptyCounts();
    const classified = discovery.investors.map((investor) => {
        const { buyerType, classificationSignal } = classifyBuyerType(investor);
        return {
            ...investor,
            buyerType,
            buyerTypeLabel: BUYER_TYPE_LABEL[buyerType],
            classificationSignal,
        };
    });
    const buyers = requestedTypes.length > 0
        ? classified.filter((b) => requestedTypes.includes(b.buyerType))
        : classified;
    for (const buyer of buyers) {
        countsByType[buyer.buyerType] += 1;
    }
    return {
        ok: discovery.ok,
        marker: IVX_BUYER_DISCOVERY_MARKER,
        query: discovery.query,
        minOfferingUsd: discovery.minOfferingUsd,
        source: discovery.source,
        fetchedAt: discovery.fetchedAt,
        totalFilingsMatched: discovery.totalFilingsMatched,
        scannedFilings: discovery.scannedFilings,
        buyers,
        resultCount: buyers.length,
        countsByType,
        requestedTypes,
        error: discovery.error,
        complianceNote: discovery.complianceNote,
    };
}
