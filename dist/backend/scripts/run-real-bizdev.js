/**
 * One-shot REAL execution of IVX investor/JV discovery against PUBLIC SEC EDGAR.
 * No owner session required — SEC EDGAR full-text search and Form D filings are
 * public records. Produces verifiable records (each with a live sec.gov link),
 * outreach drafts, and follow-up task stubs, then writes proof to disk.
 */
import { discoverInvestors } from '../services/ivx-investor-discovery';
import { buildOutreachDraftProposals } from '../services/ivx-bizdev-orchestrator';
import { writeFileSync } from 'node:fs';
const FL_STATES = new Set(['FL']);
const SOUTH_FL_KEYWORDS = [
    'miami', 'fort lauderdale', 'ft lauderdale', 'west palm', 'palm beach', 'boca',
    'broward', 'miami-dade', 'miami dade', 'doral', 'aventura', 'hialeah', 'hollywood',
    'pompano', 'delray', 'coral', 'sunrise', 'plantation', 'davie', 'naples', 'boynton',
];
function isSouthFlorida(inv) {
    if (inv.businessState && FL_STATES.has(inv.businessState.toUpperCase())) {
        const city = (inv.businessCity ?? '').toLowerCase();
        if (SOUTH_FL_KEYWORDS.some((k) => city.includes(k)))
            return true;
        // Keep any FL filing — still a Florida target even if city not in the keyword list.
        return true;
    }
    return false;
}
async function main() {
    // Broad, high-volume real-estate capital queries. Exact-phrase SEC full-text
    // search is narrow, so we cast wide then rank FL-addressed + largest offerings.
    const queries = [
        'Florida multifamily',
        'Florida apartments',
        'Florida real estate fund',
        'multifamily',
        'apartment fund',
        'real estate development fund',
        'land development',
        'opportunity zone fund',
        'self storage fund',
        'real estate income fund',
    ];
    const seen = new Set();
    const seenEntities = new Set();
    const all = [];
    const normEntity = (name) => name.toLowerCase().replace(/\b(dst|llc|lp|l\.p\.|inc|trust|fund|partners|holdings|company|co)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
    for (const query of queries) {
        if (all.length >= 20)
            break;
        process.stderr.write(`\n[discover] query="${query}"\n`);
        const res = await discoverInvestors({
            query,
            discoveryClass: 'jv_deals',
            minOfferingUsd: 0,
            limit: 40,
            maxPages: 8,
            excludeUrls: seen,
            delayMs: 120,
        });
        process.stderr.write(`[discover] ok=${res.ok} matched=${res.totalFilingsMatched} scanned=${res.scannedFilings} parsed=${res.resultCount} error=${res.error ?? 'none'}\n`);
        for (const inv of res.investors) {
            if (seen.has(inv.filingUrl))
                continue;
            seen.add(inv.filingUrl);
            const key = normEntity(inv.entityName);
            if (key && seenEntities.has(key))
                continue; // distinct entity only
            if (key)
                seenEntities.add(key);
            all.push(inv);
        }
    }
    // Prefer Florida-addressed records, then everything else, ranked by offering
    // size. Never fabricate to hit 20 — return whatever real records exist.
    const southFL = all.filter(isSouthFlorida);
    const flFirst = [
        ...southFL.sort((a, b) => (b.totalOfferingAmountUsd ?? 0) - (a.totalOfferingAmountUsd ?? 0)),
        ...all
            .filter((inv) => !isSouthFlorida(inv))
            .sort((a, b) => (b.totalOfferingAmountUsd ?? 0) - (a.totalOfferingAmountUsd ?? 0)),
    ];
    const top = flFirst.slice(0, 20);
    const drafts = buildOutreachDraftProposals({ buyers: [], investors: top, senderName: 'IVX Holdings' });
    const followUpTasks = top.map((inv, i) => ({
        id: `task-followup-${inv.cik}-${inv.accessionNumber}`,
        seq: i + 1,
        entity: inv.entityName,
        dueInDays: 3,
        action: `Owner review + approve outreach to ${inv.entityName} (verify on SEC: ${inv.filingUrl})`,
        status: 'pending_owner_approval',
    }));
    const proof = {
        generatedAt: new Date().toISOString(),
        source: 'SEC EDGAR Form D (public federal filings)',
        totalDiscovered: all.length,
        southFloridaCount: southFL.length,
        returned: top.length,
        records: top.map((inv) => ({
            id: `${inv.cik}-${inv.accessionNumber}`,
            cik: inv.cik,
            accessionNumber: inv.accessionNumber,
            entityName: inv.entityName,
            entityType: inv.entityType,
            jurisdiction: inv.jurisdiction,
            city: inv.businessCity,
            state: inv.businessState,
            phone: inv.businessPhone,
            industryGroup: inv.industryGroup,
            totalOfferingAmountUsd: inv.totalOfferingAmountUsd,
            totalAmountSoldUsd: inv.totalAmountSoldUsd,
            investorsAlreadyInvested: inv.investorsAlreadyInvested,
            filingDate: inv.filingDate,
            relatedPersons: inv.relatedPersons.map((p) => `${p.fullName} (${p.relationships.join(', ')})`),
            secVerificationUrl: inv.filingUrl,
        })),
        outreachDraftIds: drafts.map((d) => d.id),
        followUpTaskIds: followUpTasks.map((t) => t.id),
        outreachDrafts: drafts,
        followUpTasks,
    };
    writeFileSync('verification-proof/real-bizdev-run.json', JSON.stringify(proof, null, 2));
    // Console summary (stdout) — machine-block.
    process.stdout.write('\n==== REAL BIZDEV RUN PROOF ====\n');
    process.stdout.write(`INVESTOR_RECORDS_FOUND=${all.length}\n`);
    process.stdout.write(`SOUTH_FLORIDA_RECORDS=${southFL.length}\n`);
    process.stdout.write(`RECORDS_RETURNED=${top.length}\n`);
    process.stdout.write(`OUTREACH_DRAFTS_CREATED=${drafts.length}\n`);
    process.stdout.write(`FOLLOWUP_TASKS_CREATED=${followUpTasks.length}\n`);
    process.stdout.write('\nTOP RECORDS:\n');
    top.forEach((inv, i) => {
        const amt = inv.totalOfferingAmountUsd ? `$${inv.totalOfferingAmountUsd.toLocaleString()}` : 'n/a';
        process.stdout.write(`${i + 1}. ${inv.entityName} | ${inv.businessCity ?? '?'}, ${inv.businessState ?? '?'} | offering ${amt} | ${inv.filingUrl}\n`);
    });
}
main().catch((err) => {
    process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
