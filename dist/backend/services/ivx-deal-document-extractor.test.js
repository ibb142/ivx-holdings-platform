import { describe, expect, test } from 'bun:test';
import { buildExtractedDocumentContentBlock, classifyExtractionStatus, decodeTextBytes, extractDealDocumentContent, extractDealDocumentsContent, hasReadableExtractedContent, normalizeExtractedText, truncateExtractedText, } from './ivx-deal-document-extractor';
const toBytes = (text) => new TextEncoder().encode(text);
const pdfDoc = (overrides = {}) => ({
    url: 'https://x/casa-proforma.pdf',
    name: 'casa-proforma.pdf',
    mimeType: 'application/pdf',
    kind: 'proforma',
    ...overrides,
});
describe('normalizeExtractedText', () => {
    test('collapses whitespace and trims', () => {
        expect(normalizeExtractedText('  a   b\t\tc \n\n\n d  ')).toBe('a b c\nd');
        expect(normalizeExtractedText('line1  \n\n  line2')).toBe('line1\nline2');
    });
});
describe('decodeTextBytes', () => {
    test('decodes utf-8 csv bytes', () => {
        expect(decodeTextBytes(toBytes('a,b,c\n1,2,3'))).toBe('a,b,c\n1,2,3');
    });
});
describe('truncateExtractedText', () => {
    test('appends a truncation marker when over budget', () => {
        const out = truncateExtractedText('x'.repeat(50), 10);
        expect(out.startsWith('x'.repeat(10))).toBe(true);
        expect(out).toContain('truncated: 40 more characters');
    });
    test('leaves short text untouched', () => {
        expect(truncateExtractedText('short', 100)).toBe('short');
    });
});
describe('classifyExtractionStatus', () => {
    test('pdf with real text layer is extracted', () => {
        expect(classifyExtractionStatus({ isPdf: true, isText: false, normalizedText: 'Total project cost $1,400,000 NOI 200000' })).toBe('extracted');
    });
    test('pdf with no text layer is scanned', () => {
        expect(classifyExtractionStatus({ isPdf: true, isText: false, normalizedText: '  ' })).toBe('scanned');
    });
    test('text document with content is extracted', () => {
        expect(classifyExtractionStatus({ isPdf: false, isText: true, normalizedText: 'a,b,c' })).toBe('extracted');
    });
    test('empty text document is unsupported', () => {
        expect(classifyExtractionStatus({ isPdf: false, isText: true, normalizedText: '' })).toBe('unsupported');
    });
});
describe('extractDealDocumentContent', () => {
    test('extracts text from a text-layer PDF (injected parser)', async () => {
        const result = await extractDealDocumentContent(pdfDoc(), {
            fetchBytes: async () => ({ bytes: toBytes('%PDF-1.4 bytes'), contentType: 'application/pdf' }),
            parsePdf: async () => ({ text: 'Projected NOI $200,000\nExpected ROI 30%\nTimeline 18 months', pageCount: 3 }),
        });
        expect(result.status).toBe('extracted');
        expect(result.text).toContain('Projected NOI $200,000');
        expect(result.text).toContain('Expected ROI 30%');
        expect(result.pageCount).toBe(3);
        expect(result.charCount).toBeGreaterThan(0);
    });
    test('flags an image-only / scanned PDF honestly', async () => {
        const result = await extractDealDocumentContent(pdfDoc({ name: 'scanned-appraisal.pdf', kind: 'appraisal' }), {
            fetchBytes: async () => ({ bytes: toBytes('%PDF scanned'), contentType: 'application/pdf' }),
            parsePdf: async () => ({ text: '   ', pageCount: 5 }),
        });
        expect(result.status).toBe('scanned');
        expect(result.text).toBe('');
        expect(result.reason).toContain('scanned');
        expect(result.reason).toContain('image');
    });
    test('extracts CSV/spreadsheet text directly without a PDF parser', async () => {
        const result = await extractDealDocumentContent({ url: 'https://x/budget.csv', name: 'budget.csv', mimeType: 'text/csv', kind: 'spreadsheet' }, { fetchBytes: async () => ({ bytes: toBytes('item,cost\nfoundation,50000\nroof,30000'), contentType: 'text/csv' }) });
        expect(result.status).toBe('extracted');
        expect(result.text).toContain('foundation,50000');
    });
    test('reports a download failure honestly (never throws)', async () => {
        const result = await extractDealDocumentContent(pdfDoc(), { fetchBytes: async () => null });
        expect(result.status).toBe('failed');
        expect(result.reason).toContain('could not be downloaded');
    });
    test('reports unsupported document types', async () => {
        const result = await extractDealDocumentContent({ url: 'https://x/file.bin', name: 'file.bin', mimeType: 'application/octet-stream', kind: 'other' }, { fetchBytes: async () => ({ bytes: toBytes('binary'), contentType: 'application/octet-stream' }) });
        expect(result.status).toBe('unsupported');
    });
    test('surfaces a PDF parse error as failed, not a crash', async () => {
        const result = await extractDealDocumentContent(pdfDoc(), {
            fetchBytes: async () => ({ bytes: toBytes('%PDF'), contentType: 'application/pdf' }),
            parsePdf: async () => {
                throw new Error('corrupt pdf');
            },
        });
        expect(result.status).toBe('failed');
        expect(result.reason).toContain('corrupt pdf');
    });
});
describe('extractDealDocumentsContent', () => {
    test('extracts multiple documents in parallel', async () => {
        const results = await extractDealDocumentsContent([pdfDoc(), { url: 'https://x/notes.txt', name: 'notes.txt', mimeType: 'text/plain', kind: 'other' }], {
            fetchBytes: async (url) => ({
                bytes: toBytes(url.endsWith('.txt') ? 'plain notes content' : '%PDF'),
                contentType: url.endsWith('.txt') ? 'text/plain' : 'application/pdf',
            }),
            parsePdf: async () => ({ text: 'Projected NOI 200000, expected ROI 30%, timeline 18 months', pageCount: 1 }),
        });
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.status === 'extracted')).toBe(true);
        expect(hasReadableExtractedContent(results)).toBe(true);
    });
    test('returns empty array for no documents', async () => {
        expect(await extractDealDocumentsContent([])).toEqual([]);
    });
});
describe('buildExtractedDocumentContentBlock', () => {
    const extracted = {
        url: 'https://x/proforma.pdf',
        name: 'proforma.pdf',
        kind: 'proforma',
        status: 'extracted',
        text: 'Projected NOI $200,000\nExpected ROI 30%',
        charCount: 38,
        pageCount: 2,
        reason: null,
    };
    test('renders extracted content with begin/end markers', () => {
        const block = buildExtractedDocumentContentBlock([extracted]);
        expect(block).toContain('EXTRACTED DEAL-ROOM DOCUMENT CONTENT');
        expect(block).toContain('BEGIN EXTRACTED CONTENT');
        expect(block).toContain('Projected NOI $200,000');
        expect(block).toContain('(2 pages)');
        expect(block?.toLowerCase()).toContain('never invent figures');
    });
    test('renders the honest reason for unreadable documents', () => {
        const scanned = {
            url: 'https://x/scan.pdf',
            name: 'scan.pdf',
            kind: 'appraisal',
            status: 'scanned',
            text: '',
            charCount: 0,
            pageCount: 4,
            reason: 'This PDF has no selectable text layer (it looks scanned / image-only).',
        };
        const block = buildExtractedDocumentContentBlock([scanned]);
        expect(block).toContain('status: scanned');
        expect(block).toContain('No readable content');
        expect(block).toContain('scanned');
    });
    test('returns null for no documents', () => {
        expect(buildExtractedDocumentContentBlock([])).toBeNull();
    });
});
