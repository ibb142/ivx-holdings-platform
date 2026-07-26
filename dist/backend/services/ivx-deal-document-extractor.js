/**
 * IVX Deal-Room Document Text Extraction (BLOCK 5 — OCR / document reading)
 *
 * BLOCK 4 forwarded a document URL to the model, but `gpt-4o-mini` cannot open
 * PDF bytes — so attached budgets / appraisals / proformas produced an honest
 * "I can't read this document". This service makes the documents actually
 * readable by extracting their text SERVER-SIDE before the model is called:
 *
 *   - PDFs with a text layer  → real text via `unpdf` (pure-JS PDF.js build).
 *   - CSV / TXT spreadsheets  → decoded directly.
 *   - Image-only / scanned PDFs (no text layer) → detected and flagged so the
 *     model says so honestly and points the owner to the working OCR path
 *     (upload the page as an image → the BLOCK 3 vision layer OCRs it).
 *
 * The extracted text is injected into the model prompt, so the BLOCK 4 analyst
 * instructions finally operate on real figures instead of an unreadable URL.
 *
 * Pure functions (status classification, content-block rendering, text decode)
 * are separated from I/O and the network/PDF parser is injectable, so the whole
 * pipeline is unit-testable without the AI gateway, the network, or unpdf.
 */
/** Max document size we will download for extraction (12 MB). */
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
/** Per-document extracted-text cap so the prompt stays bounded. */
export const MAX_TEXT_CHARS_PER_DOCUMENT = 12_000;
/** Total extracted-text cap across all documents in one request. */
export const MAX_TOTAL_EXTRACTED_CHARS = 24_000;
/**
 * Below this many non-whitespace characters a "PDF" is treated as scanned /
 * image-only rather than having a real text layer.
 */
const SCANNED_TEXT_THRESHOLD = 24;
const PDF_KINDS = new Set([
    'pdf',
    'proforma',
    'appraisal',
    'budget',
]);
function isPdfDocument(doc) {
    const mime = (doc.mimeType ?? '').toLowerCase();
    const name = (doc.name ?? '').toLowerCase();
    if (mime.includes('pdf') || name.endsWith('.pdf')) {
        return true;
    }
    // budget/appraisal/proforma can be spreadsheets too — only treat as PDF when
    // the mime/name doesn't say spreadsheet/csv.
    if (PDF_KINDS.has(doc.kind) && !/(csv|sheet|excel|xls)/.test(`${mime} ${name}`)) {
        return doc.kind !== 'spreadsheet';
    }
    return false;
}
function isTextDocument(doc) {
    const mime = (doc.mimeType ?? '').toLowerCase();
    const name = (doc.name ?? '').toLowerCase();
    return (mime.startsWith('text/') ||
        mime.includes('csv') ||
        name.endsWith('.csv') ||
        name.endsWith('.txt') ||
        name.endsWith('.tsv'));
}
/**
 * Detect an Office Open XML document (DOCX/XLSX/PPTX) from its mime/filename and
 * return which family it is, or null when it is not an Office file.
 */
export function detectOfficeDocumentType(doc) {
    const mime = (doc.mimeType ?? '').toLowerCase();
    const name = (doc.name ?? '').toLowerCase();
    if (name.endsWith('.docx') || mime.includes('wordprocessingml')) {
        return 'docx';
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || mime.includes('spreadsheetml')) {
        return 'xlsx';
    }
    if (name.endsWith('.pptx') || mime.includes('presentationml')) {
        return 'pptx';
    }
    return null;
}
/** Collapse runs of whitespace and trim — keeps extracted text compact. */
export function normalizeExtractedText(raw) {
    return raw
        .replace(/\u0000/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Decode raw bytes as UTF-8 text (for CSV / TXT documents). */
export function decodeTextBytes(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    catch {
        return '';
    }
}
/** Truncate to a char budget, appending an explicit truncation marker. */
export function truncateExtractedText(text, max = MAX_TEXT_CHARS_PER_DOCUMENT) {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}\n…[truncated: ${text.length - max} more characters not shown]`;
}
/**
 * Decide the extraction status for a parsed document. Pure + deterministic so
 * the scanned/extracted boundary is unit-testable.
 */
export function classifyExtractionStatus(input) {
    const nonWhitespace = input.normalizedText.replace(/\s/g, '').length;
    if (input.isPdf) {
        return nonWhitespace >= SCANNED_TEXT_THRESHOLD ? 'extracted' : 'scanned';
    }
    if (input.isText) {
        return nonWhitespace > 0 ? 'extracted' : 'unsupported';
    }
    return 'unsupported';
}
async function defaultFetchBytes(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        return null;
    }
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENT_BYTES) {
        return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
        return null;
    }
    return {
        bytes: new Uint8Array(buffer),
        contentType: response.headers.get('content-type'),
    };
}
async function defaultParsePdf(bytes) {
    // Lazy import keeps unpdf out of the read-only / test paths.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n') : text;
    return { text: merged ?? '', pageCount: totalPages ?? 0 };
}
/** Extract readable text from the XML payload of a PPTX/DOCX part (`<a:t>`/`<w:t>`/`<t>` runs). */
export function extractOoxmlTextNodes(xml) {
    const matches = xml.match(/<(?:a:t|w:t|t)[^>]*>([\s\S]*?)<\/(?:a:t|w:t|t)>/g);
    if (!matches) {
        return '';
    }
    return matches
        .map((node) => node
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'"))
        .join(' ');
}
/**
 * Default Office (DOCX/XLSX/PPTX) parser. DOCX uses mammoth's raw-text path,
 * XLSX is rendered sheet-by-sheet to CSV via SheetJS, and PPTX is unzipped with
 * fflate and each slide's text runs are concatenated. Lazy-imported so these
 * heavy parsers stay out of the read-only/test paths.
 */
async function defaultParseOffice(bytes, type) {
    if (type === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return { text: result.value ?? '', pageCount: null };
    }
    if (type === 'xlsx') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheets = workbook.SheetNames.map((sheetName) => {
            const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
            return `### Sheet: ${sheetName}\n${csv}`;
        });
        return { text: sheets.join('\n\n'), pageCount: workbook.SheetNames.length };
    }
    // pptx — unzip and read each slide's text runs in slide order.
    const { unzipSync, strFromU8 } = await import('fflate');
    const archive = unzipSync(bytes);
    const slidePaths = Object.keys(archive)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => {
        const numA = Number.parseInt(a.replace(/\D/g, ''), 10);
        const numB = Number.parseInt(b.replace(/\D/g, ''), 10);
        return numA - numB;
    });
    const slides = slidePaths.map((path, index) => {
        const text = extractOoxmlTextNodes(strFromU8(archive[path]));
        return `### Slide ${index + 1}\n${text}`;
    });
    return { text: slides.join('\n\n'), pageCount: slidePaths.length };
}
/** Guess an OCR mediaType for the document bytes (defaults to PDF). */
function ocrMediaType(doc) {
    const mime = (doc.mimeType ?? '').toLowerCase();
    if (mime.startsWith('image/') || mime === 'application/pdf') {
        return mime;
    }
    const name = (doc.name ?? '').toLowerCase();
    if (name.endsWith('.png'))
        return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg'))
        return 'image/jpeg';
    if (name.endsWith('.webp'))
        return 'image/webp';
    return 'application/pdf';
}
/**
 * Read and extract the text of a single deal-room document. Never throws — any
 * failure is reported as an `ExtractedDocument` with a `failed`/`scanned`/
 * `unsupported` status and an honest reason.
 */
export async function extractDealDocumentContent(doc, deps = {}) {
    const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
    const parsePdf = deps.parsePdf ?? defaultParsePdf;
    const parseOffice = deps.parseOffice ?? defaultParseOffice;
    const base = {
        url: doc.url,
        name: doc.name,
        kind: doc.kind,
        text: '',
        charCount: 0,
        pageCount: null,
    };
    const officeType = detectOfficeDocumentType(doc);
    const isPdf = !officeType && isPdfDocument(doc);
    const isText = !officeType && isTextDocument(doc);
    if (!officeType && !isPdf && !isText) {
        return {
            ...base,
            status: 'unsupported',
            reason: `Unsupported document type (${doc.mimeType ?? 'unknown'}). Text extraction supports PDF, DOCX, XLSX, PPTX, CSV, and TXT.`,
        };
    }
    let fetched;
    try {
        fetched = await fetchBytes(doc.url);
    }
    catch (error) {
        return {
            ...base,
            status: 'failed',
            reason: `Could not download the document: ${error instanceof Error ? error.message : 'unknown error'}.`,
        };
    }
    if (!fetched) {
        return {
            ...base,
            status: 'failed',
            reason: 'Document could not be downloaded (not reachable, blocked, or larger than the 12 MB limit).',
        };
    }
    if (fetched.bytes.byteLength > MAX_DOCUMENT_BYTES) {
        return { ...base, status: 'too-large', reason: 'Document exceeds the 12 MB extraction limit.' };
    }
    let rawText = '';
    let pageCount = null;
    if (officeType) {
        try {
            const parsed = await parseOffice(fetched.bytes, officeType);
            rawText = parsed.text;
            pageCount = parsed.pageCount;
        }
        catch (error) {
            return {
                ...base,
                status: 'failed',
                reason: `${officeType.toUpperCase()} could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}.`,
            };
        }
    }
    else if (isPdf) {
        try {
            const parsed = await parsePdf(fetched.bytes);
            rawText = parsed.text;
            pageCount = parsed.pageCount;
        }
        catch (error) {
            return {
                ...base,
                status: 'failed',
                reason: `PDF could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}.`,
            };
        }
    }
    else {
        rawText = decodeTextBytes(fetched.bytes);
    }
    const normalized = normalizeExtractedText(rawText);
    const status = classifyExtractionStatus({ isPdf, isText: isText || officeType !== null, normalizedText: normalized });
    if (status === 'scanned') {
        // Real OCR path: a scanned/image-only PDF has no text layer, so hand the raw
        // bytes to the vision model for true OCR instead of only flagging it. Falls
        // back to the honest scanned message when OCR is unavailable or empty.
        if (deps.ocrDocument) {
            try {
                const ocrText = await deps.ocrDocument(fetched.bytes, ocrMediaType(doc), doc.name);
                const normalizedOcr = normalizeExtractedText(ocrText ?? '');
                if (normalizedOcr.replace(/\s/g, '').length >= SCANNED_TEXT_THRESHOLD) {
                    const cappedOcr = truncateExtractedText(normalizedOcr);
                    return {
                        ...base,
                        status: 'extracted',
                        text: cappedOcr,
                        charCount: cappedOcr.length,
                        pageCount,
                        reason: 'Extracted via OCR (scanned/image-only PDF read by the vision model).',
                    };
                }
            }
            catch (error) {
                console.log('[DocExtractor] OCR fallback failed:', error instanceof Error ? error.message : 'unknown');
            }
        }
        return {
            ...base,
            status,
            pageCount,
            reason: 'This PDF has no selectable text layer (it looks scanned / image-only) and OCR could not read it. ' +
                'To analyze it, export the page(s) as an image (PNG/JPG) and attach the image — the vision layer will OCR it.',
        };
    }
    if (status === 'unsupported') {
        return { ...base, status, pageCount, reason: 'No readable text could be extracted from the document.' };
    }
    const capped = truncateExtractedText(normalized);
    return {
        ...base,
        status: 'extracted',
        text: capped,
        charCount: capped.length,
        pageCount,
        reason: null,
    };
}
/**
 * Extract every attached deal-room document (bounded total budget). Documents
 * are read in parallel; honest per-document statuses are preserved.
 */
export async function extractDealDocumentsContent(documents, deps = {}) {
    if (documents.length === 0) {
        return [];
    }
    const results = await Promise.all(documents.map((doc) => extractDealDocumentContent(doc, deps)));
    // Enforce a total extracted-character budget across documents so a stack of
    // big files cannot blow the prompt. Earlier documents keep priority.
    let remaining = MAX_TOTAL_EXTRACTED_CHARS;
    return results.map((result) => {
        if (result.status !== 'extracted' || result.text.length === 0) {
            return result;
        }
        if (remaining <= 0) {
            return {
                ...result,
                text: '',
                charCount: 0,
                reason: 'Extracted text omitted — total document content budget reached for this request.',
            };
        }
        if (result.text.length <= remaining) {
            remaining -= result.text.length;
            return result;
        }
        const trimmed = truncateExtractedText(result.text, remaining);
        remaining = 0;
        return { ...result, text: trimmed, charCount: trimmed.length };
    });
}
/**
 * Render the extracted document content as one model-readable grounding block.
 * Pure + deterministic. Returns null when there is nothing to add.
 */
export function buildExtractedDocumentContentBlock(results) {
    if (results.length === 0) {
        return null;
    }
    const sections = results.map((doc, index) => {
        const header = `DOCUMENT ${index + 1}: ${doc.name ?? doc.url} [${doc.kind}] — status: ${doc.status}`;
        if (doc.status === 'extracted' && doc.text.length > 0) {
            const pages = doc.pageCount ? ` (${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'})` : '';
            return `${header}${pages}\n----- BEGIN EXTRACTED CONTENT -----\n${doc.text}\n----- END EXTRACTED CONTENT -----`;
        }
        return `${header}\n(No readable content — ${doc.reason ?? 'unavailable'})`;
    });
    return [
        'EXTRACTED DEAL-ROOM DOCUMENT CONTENT: the following text was read directly from the attached document(s) server-side.',
        'Base every figure you cite on this extracted content (and the IVX deal data above). Quote exact numbers; never invent figures that are not present.',
        'If a document shows status "scanned" or "failed", state plainly that it could not be read and which figures are therefore unverified — and give the next step from its reason.',
        '',
        sections.join('\n\n'),
    ].join('\n');
}
/** True when at least one document yielded usable extracted text. */
export function hasReadableExtractedContent(results) {
    return results.some((doc) => doc.status === 'extracted' && doc.text.length > 0);
}
