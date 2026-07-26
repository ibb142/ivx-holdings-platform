/**
 * IVX Investor Report generator — the BRIDGE that turns a real investor/buyer
 * discovery into a REAL, downloadable CSV report with full proof.
 *
 * The owner asked: "I want IVX IA to DO the report when I request it, and never
 * provide a fake statement." Two real subsystems already existed independently —
 *   1. `ivx-investor-discovery` → real, named investors/buyers from public SEC
 *      EDGAR Form D filings (every record carries a direct SEC filing link).
 *   2. `ivx-deliverable-pipeline` → generate CSV/PDF → upload to Supabase Storage
 *      → sign URL → verify download → mark COMPLETE only with full proof.
 * — but NOTHING connected them, so "do the report" had no path that produced a
 * downloadable file. This service is that bridge.
 *
 * HARD HONESTY RULE (BLOCK 33 / PHASE 2 alignment):
 *   - The discovery runs against the LIVE SEC API. A network/API failure returns
 *     an honest `ok:false` + the exact reason — never a fabricated report.
 *   - When the discovery returns ZERO real investors, NO report is generated and
 *     the result says so plainly ("Report not generated — 0 real records").
 *   - A report is only ever `complete` when the deliverable pipeline proves a real
 *     uploaded file + size + bucket + signed URL + a passing download test. The
 *     completion proof is surfaced verbatim so the chat can show a REAL link.
 */
import { discoverInvestors, } from './ivx-investor-discovery';
import { enqueueDeliverable, runDeliverableNow } from './ivx-deliverable-pipeline';
export const IVX_INVESTOR_REPORT_MARKER = 'ivx-investor-report-2026-06-03';
/** Stable CSV column order so every report is consistent + analyst-friendly. */
export const INVESTOR_REPORT_COLUMNS = [
    'entityName',
    'entityType',
    'jurisdiction',
    'industryGroup',
    'totalOfferingAmountUsd',
    'totalAmountSoldUsd',
    'minimumInvestmentUsd',
    'investorsAlreadyInvested',
    'businessStreet',
    'businessCity',
    'businessState',
    'businessZip',
    'businessPhone',
    'namedPrincipals',
    'filingDate',
    'dateOfFirstSale',
    'cik',
    'accessionNumber',
    'secFilingUrl',
];
/** Flatten one real discovered investor into a CSV row (named principals joined). */
export function investorToCsvRow(investor) {
    const principals = investor.relatedPersons
        .map((p) => {
        const roles = p.relationships.length > 0 ? ` (${p.relationships.join(', ')})` : '';
        return `${p.fullName}${roles}`;
    })
        .join('; ');
    return {
        entityName: investor.entityName,
        entityType: investor.entityType ?? '',
        jurisdiction: investor.jurisdiction ?? '',
        industryGroup: investor.industryGroup ?? '',
        totalOfferingAmountUsd: investor.totalOfferingAmountUsd ?? '',
        totalAmountSoldUsd: investor.totalAmountSoldUsd ?? '',
        minimumInvestmentUsd: investor.minimumInvestmentUsd ?? '',
        investorsAlreadyInvested: investor.investorsAlreadyInvested ?? '',
        businessStreet: investor.businessStreet ?? '',
        businessCity: investor.businessCity ?? '',
        businessState: investor.businessState ?? '',
        businessZip: investor.businessZip ?? '',
        businessPhone: investor.businessPhone ?? '',
        namedPrincipals: principals,
        filingDate: investor.filingDate ?? '',
        dateOfFirstSale: investor.dateOfFirstSale ?? '',
        cik: investor.cik,
        accessionNumber: investor.accessionNumber,
        secFilingUrl: investor.filingUrl,
    };
}
/** Build the rows for a discovery result (pure, deterministic, testable). */
export function buildInvestorReportRows(result) {
    return result.investors.map(investorToCsvRow);
}
function reportTitle(discoveryClass, query, count) {
    const label = discoveryClass === 'buyers' ? 'Buyers ($10M+)' : 'JV / Investors';
    const q = query.trim() ? ` — ${query.trim()}` : '';
    return `IVX ${label} Report${q} (${count} real SEC records)`;
}
/**
 * Generate a REAL investor/buyer report on request:
 *   1. run the live SEC discovery
 *   2. if it failed → honest `discovery_failed` (no report)
 *   3. if 0 real records → honest `no_records` (no report)
 *   4. otherwise build a CSV of the real records and run it through the
 *      proof-gated deliverable pipeline (enqueue, or await full proof).
 * Never throws and never fabricates a link.
 */
export async function generateInvestorReport(options = {}) {
    const discovery = await discoverInvestors({
        query: options.query,
        discoveryClass: options.discoveryClass,
        minOfferingUsd: options.minOfferingUsd,
        limit: options.limit,
        fetchImpl: options.fetchImpl,
        delayMs: options.delayMs,
    });
    const base = {
        marker: IVX_INVESTOR_REPORT_MARKER,
        discoveryClass: discovery.discoveryClass,
        query: discovery.query,
        source: discovery.source,
        discovery,
    };
    if (!discovery.ok) {
        return {
            ...base,
            ok: false,
            status: 'discovery_failed',
            message: `Report not generated — the live SEC discovery failed: ${discovery.error ?? 'unknown error'}. No valid report or link exists yet.`,
            rowCount: 0,
            jobId: null,
            deliverable: null,
        };
    }
    const rows = buildInvestorReportRows(discovery);
    if (rows.length === 0) {
        return {
            ...base,
            ok: false,
            status: 'no_records',
            message: `Report not generated — 0 real ${discovery.discoveryClass === 'buyers' ? 'buyer' : 'investor'} records matched these filters (${discovery.totalFilingsMatched} Form D filings scanned). Broaden the query or lower the minimum, then run again. No valid link exists.`,
            rowCount: 0,
            jobId: null,
            deliverable: null,
        };
    }
    const title = reportTitle(discovery.discoveryClass, discovery.query, rows.length);
    if (options.waitForCompletion) {
        const record = await runDeliverableNow({
            kind: 'csv',
            title,
            rows,
            columns: INVESTOR_REPORT_COLUMNS,
            conversationId: options.conversationId ?? null,
            requestId: options.requestId ?? null,
            taskId: options.taskId ?? null,
        });
        if (record && record.status === 'complete') {
            return {
                ...base,
                ok: true,
                status: 'completed',
                message: `Report COMPLETE — ${rows.length} real records, ${record.fileSize ?? 0} bytes, download-verified (HTTP ${record.downloadHttpStatus}). Real signed link ready.`,
                rowCount: rows.length,
                jobId: record.id,
                deliverable: record,
            };
        }
        return {
            ...base,
            ok: false,
            status: 'generation_failed',
            message: `Report generation failed — ${record?.error ?? 'the deliverable pipeline could not produce a verified file'}. No valid link exists.`,
            rowCount: rows.length,
            jobId: record?.id ?? null,
            deliverable: record,
        };
    }
    const enqueued = await enqueueDeliverable({
        kind: 'csv',
        title,
        rows,
        columns: INVESTOR_REPORT_COLUMNS,
        conversationId: options.conversationId ?? null,
        requestId: options.requestId ?? null,
        taskId: options.taskId ?? null,
    });
    return {
        ...base,
        ok: true,
        status: 'queued',
        message: `Generating a real report from ${rows.length} verified SEC records (job ${enqueued.jobId}). The signed download link appears only after the file is uploaded and the download is verified — no placeholder link will be shown.`,
        rowCount: rows.length,
        jobId: enqueued.jobId,
        deliverable: null,
    };
}
