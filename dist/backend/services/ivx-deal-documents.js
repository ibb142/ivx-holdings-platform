/**
 * IVX Deal-Room Document Intelligence
 *
 * BLOCK 4 — lets the Owner AI ingest deal-room documents (PDFs, budgets,
 * appraisals, proformas) attached to a chat message and reason about them the
 * way an acquisition analyst reviews a data room.
 *
 * Runtime-free + deterministic so it can be unit-tested without the AI gateway:
 *   - `extractDealDocuments()` normalizes arbitrary attachment shapes into a
 *     typed list of documents, classifying each by kind (budget / appraisal /
 *     proforma / pdf / spreadsheet / other) from its MIME type and filename.
 *   - `buildDocumentAnalysisInstructionBlock()` produces the analyst instruction
 *     appended to the system prompt when documents are present.
 *
 * The document URL(s) are forwarded to the model; bytes never touch the client.
 */
const DOCUMENT_MIME_PREFIXES = ['application/pdf', 'application/vnd', 'application/msword', 'text/csv', 'application/octet-stream'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.csv', '.xls', '.xlsx', '.doc', '.docx', '.txt'];
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function fileNameFromUrl(url) {
    try {
        const path = new URL(url).pathname;
        const last = path.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last) : null;
    }
    catch {
        const last = url.split('?')[0]?.split('/').filter(Boolean).pop();
        return last ?? null;
    }
}
function looksLikeDocument(url, mime) {
    const lowerMime = mime.toLowerCase();
    if (lowerMime && DOCUMENT_MIME_PREFIXES.some((prefix) => lowerMime.startsWith(prefix))) {
        return true;
    }
    if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) {
        return false;
    }
    const lowerUrl = url.toLowerCase().split('?')[0] ?? '';
    return DOCUMENT_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext));
}
/** Classify a document by filename/mime keywords into an analyst-relevant kind. */
export function classifyDealDocument(name, mime) {
    const haystack = `${name ?? ''} ${mime ?? ''}`.toLowerCase();
    if (/proforma|pro[-\s]?forma|cash[-\s]?flow|cashflow/.test(haystack)) {
        return 'proforma';
    }
    if (/appraisal|valuation|comp\b|comparable|bpo/.test(haystack)) {
        return 'appraisal';
    }
    if (/budget|cost|construction|rehab|scope|draw/.test(haystack)) {
        return 'budget';
    }
    const lowerMime = (mime ?? '').toLowerCase();
    if (lowerMime.includes('pdf') || (name ?? '').toLowerCase().endsWith('.pdf')) {
        return 'pdf';
    }
    if (/csv|spreadsheet|excel|sheet|xls/.test(haystack)) {
        return 'spreadsheet';
    }
    return 'other';
}
/**
 * Normalize arbitrary attachment input into deal-room document attachments.
 * Accepts `documents[]`, `attachments[]`, `files[]`, `fileUrls[]`, and single
 * `documentUrl`/`fileUrl` shapes. Keeps only non-image/non-AV document types and
 * de-dups by URL.
 */
export function extractDealDocuments(input) {
    if (!input || typeof input !== 'object') {
        return [];
    }
    const out = [];
    const push = (url, name, mime) => {
        const trimmedUrl = readTrimmed(url);
        if (!trimmedUrl) {
            return;
        }
        const trimmedMime = readTrimmed(mime);
        if (!looksLikeDocument(trimmedUrl, trimmedMime)) {
            return;
        }
        const resolvedName = readTrimmed(name) || fileNameFromUrl(trimmedUrl);
        out.push({
            url: trimmedUrl,
            name: resolvedName || null,
            mimeType: trimmedMime || null,
            kind: classifyDealDocument(resolvedName, trimmedMime || null),
        });
    };
    const record = input;
    const arrays = [];
    if (Array.isArray(record.documents))
        arrays.push(...record.documents);
    if (Array.isArray(record.attachments))
        arrays.push(...record.attachments);
    if (Array.isArray(record.files))
        arrays.push(...record.files);
    for (const item of arrays) {
        if (typeof item === 'string') {
            push(item, null, null);
            continue;
        }
        if (item && typeof item === 'object') {
            const a = item;
            push(a.url ?? a.documentUrl ?? a.fileUrl ?? a.attachmentUrl ?? a.uri, a.name ?? a.fileName ?? a.filename ?? a.title, a.mimeType ?? a.mime ?? a.contentType ?? a.attachmentMime ?? a.type);
        }
    }
    if (Array.isArray(record.fileUrls)) {
        for (const u of record.fileUrls)
            push(u, null, null);
    }
    const single = record.documentUrl ?? record.fileUrl;
    if (single)
        push(single, record.fileName ?? record.documentName, record.documentMime ?? record.fileMime ?? record.mimeType);
    const seen = new Set();
    return out.filter((doc) => (seen.has(doc.url) ? false : (seen.add(doc.url), true)));
}
/**
 * Analyst instruction appended to the system prompt when deal-room documents are
 * present. Directs the model to read each document as an acquisition analyst and
 * extract the figures that feed the deal-intelligence scoring.
 */
export function buildDocumentAnalysisInstructionBlock(documents) {
    const inventory = documents
        .map((doc, index) => `${index + 1}. ${doc.name ?? doc.url} [${doc.kind}]`)
        .join('\n');
    return [
        `DEAL-ROOM DOCUMENT ANALYSIS: ${documents.length} document(s) are attached. Review them as an acquisition analyst / investment-committee member.`,
        inventory,
        'For each document:',
        '- BUDGET: extract total project cost, hard vs soft costs, contingency %, and any line items that look under- or over-budgeted. Flag a missing contingency.',
        '- APPRAISAL / valuation: extract the appraised/as-is and as-completed value, comparables used, and whether the purchase price is supported by the valuation.',
        '- PROFORMA / cash flow: extract projected revenue, expenses, NOI, expected ROI / IRR, and the exit/timeline assumptions. State whether the proforma ROI matches the deal\'s stated ROI.',
        '- PDF / other: extract the key figures, dates, parties, and obligations.',
        'Then reconcile the documents against the IVX deal data above: confirm or challenge the stated price, ROI, and timeline, and call out any inconsistency between the marketing numbers and the documents.',
        'Never invent figures that are not in the documents. If a document URL cannot be read, say so plainly and state which figures are therefore unverified. Always remind the owner this is decision support, not a guaranteed return or a substitute for legal/financial review.',
    ].join('\n');
}
