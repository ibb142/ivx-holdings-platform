import { describe, expect, test } from 'bun:test';
import { buildDocumentAnalysisInstructionBlock, classifyDealDocument, extractDealDocuments, } from './ivx-deal-documents';
describe('classifyDealDocument', () => {
    test('classifies by filename keywords', () => {
        expect(classifyDealDocument('Casa-Rosario-proforma.pdf', 'application/pdf')).toBe('proforma');
        expect(classifyDealDocument('appraisal-report.pdf', 'application/pdf')).toBe('appraisal');
        expect(classifyDealDocument('construction-budget.xlsx', 'application/vnd.ms-excel')).toBe('budget');
        expect(classifyDealDocument('contract.pdf', 'application/pdf')).toBe('pdf');
        expect(classifyDealDocument('data.csv', 'text/csv')).toBe('spreadsheet');
        expect(classifyDealDocument('notes', null)).toBe('other');
    });
});
describe('extractDealDocuments', () => {
    test('extracts pdf documents from documents[]', () => {
        const docs = extractDealDocuments({
            documents: [{ url: 'https://x/casa-proforma.pdf', mimeType: 'application/pdf' }],
        });
        expect(docs).toHaveLength(1);
        expect(docs[0].kind).toBe('proforma');
        expect(docs[0].name).toBe('casa-proforma.pdf');
    });
    test('extracts from attachments[] and files[] with varied keys', () => {
        const docs = extractDealDocuments({
            attachments: [{ fileUrl: 'https://x/budget.xlsx', contentType: 'application/vnd.ms-excel' }],
            files: ['https://x/appraisal.pdf'],
        });
        expect(docs.map((d) => d.kind).sort()).toEqual(['appraisal', 'budget']);
    });
    test('extracts a single documentUrl with inferred name', () => {
        const docs = extractDealDocuments({ documentUrl: 'https://x/deal-room/proforma-2026.pdf' });
        expect(docs[0].kind).toBe('proforma');
        expect(docs[0].name).toBe('proforma-2026.pdf');
    });
    test('drops images and videos (not documents)', () => {
        const docs = extractDealDocuments({
            attachments: [
                { url: 'https://x/photo.png', mimeType: 'image/png' },
                { url: 'https://x/clip.mp4', mimeType: 'video/mp4' },
            ],
        });
        expect(docs).toEqual([]);
    });
    test('de-dups by url and ignores invalid input', () => {
        const docs = extractDealDocuments({ files: ['https://x/a.pdf', 'https://x/a.pdf'] });
        expect(docs).toHaveLength(1);
        expect(extractDealDocuments(null)).toEqual([]);
        expect(extractDealDocuments({})).toEqual([]);
    });
});
describe('buildDocumentAnalysisInstructionBlock', () => {
    test('lists the documents and instructs analyst-grade extraction', () => {
        const block = buildDocumentAnalysisInstructionBlock([
            { url: 'https://x/proforma.pdf', name: 'proforma.pdf', mimeType: 'application/pdf', kind: 'proforma' },
        ]);
        expect(block).toContain('DEAL-ROOM DOCUMENT ANALYSIS');
        expect(block).toContain('PROFORMA');
        expect(block).toContain('APPRAISAL');
        expect(block).toContain('BUDGET');
        expect(block.toLowerCase()).toContain('never invent');
    });
});
