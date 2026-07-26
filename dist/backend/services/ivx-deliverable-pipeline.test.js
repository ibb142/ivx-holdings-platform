/**
 * Tests for the PHASE 2 Real Deliverable System — the parts that are pure /
 * deterministic and can run without network (CSV, PDF, the durable store's
 * proof-gated completion, notifications, and the evidence-gate signal).
 */
import { describe, expect, it } from 'bun:test';
import { buildCsv } from './ivx-csv-export';
import { generateReportPdf } from './ivx-pdf-generator';
import { createDeliverableJob, markDeliverableComplete, markDeliverableFailed, getDeliverable, conversationHasRealDeliverable, listDeliverableNotifications, } from './ivx-deliverable-store';
describe('ivx-csv-export', () => {
    it('builds a header + rows with inferred columns', () => {
        const result = buildCsv([
            { name: 'Casa Rosario', roi: 30 },
            { name: 'Perez', roi: 18 },
        ]);
        expect(result.columns).toEqual(['name', 'roi']);
        expect(result.rowCount).toBe(2);
        expect(result.text.split('\r\n')[0]).toBe('name,roi');
        expect(result.byteLength).toBeGreaterThan(0);
    });
    it('escapes commas, quotes and newlines per RFC 4180', () => {
        const result = buildCsv([{ note: 'Pembroke Pines, FL', quote: 'He said "hi"', multi: 'a\nb' }]);
        const dataLine = result.text.split('\r\n')[1];
        expect(dataLine).toContain('"Pembroke Pines, FL"');
        expect(dataLine).toContain('"He said ""hi"""');
        expect(dataLine).toContain('"a\nb"');
    });
    it('honors an explicit column list', () => {
        const result = buildCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a']);
        expect(result.columns).toEqual(['c', 'a']);
        expect(result.text.split('\r\n')[0]).toBe('c,a');
        expect(result.text.split('\r\n')[1]).toBe('3,1');
    });
    it('handles an empty row set without throwing', () => {
        const result = buildCsv([]);
        expect(result.rowCount).toBe(0);
        expect(result.columns).toEqual([]);
    });
});
describe('ivx-pdf-generator', () => {
    it('produces real PDF bytes with the %PDF header', async () => {
        const result = await generateReportPdf({
            title: 'Buyer and JV Report',
            subtitle: 'IVX Holdings',
            meta: 'Generated 2026-06-01',
            sections: [
                { heading: 'Summary', body: ['Casa Rosario is a Pembroke Pines luxury JV.', 'Projected ROI 30%.'] },
                { heading: 'Risks', body: ['Limited diligence media.'] },
            ],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.byteLength).toBeGreaterThan(500);
            expect(result.pageCount).toBeGreaterThanOrEqual(1);
            // PDF magic header bytes "%PDF"
            expect(result.bytes[0]).toBe(0x25);
            expect(result.bytes[1]).toBe(0x50);
            expect(result.bytes[2]).toBe(0x44);
            expect(result.bytes[3]).toBe(0x46);
        }
    });
    it('wraps very long lines across pages without throwing', async () => {
        const longBody = Array.from({ length: 200 }, (_, i) => `Line ${i} ${'word '.repeat(40)}`);
        const result = await generateReportPdf({ title: 'Long', sections: [{ heading: 'Body', body: longBody }] });
        expect(result.ok).toBe(true);
        if (result.ok)
            expect(result.pageCount).toBeGreaterThan(1);
    });
});
describe('ivx-deliverable-store proof-gated completion', () => {
    const fullProof = () => ({
        filename: 'report.pdf',
        bucket: 'ivx-deliverables',
        storagePath: 'reports/2026/06/report.pdf',
        fileSize: 4096,
        contentType: 'application/pdf',
        signedUrl: 'https://example.supabase.co/storage/v1/object/sign/ivx-deliverables/reports/2026/06/report.pdf?token=abc',
        signedUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        downloadHttpStatus: 200,
        downloadVerifiedSize: 4096,
        executionTraceId: 'trace_xyz',
    });
    it('refuses to mark complete when proof is missing (BLOCK 33 hard rule)', async () => {
        const job = await createDeliverableJob({ kind: 'pdf', title: 'Incomplete', conversationId: 'conv-missing' });
        const proof = fullProof();
        // Strip the signed URL + a valid download status → must be rejected.
        const result = await markDeliverableComplete(job.id, { ...proof, signedUrl: '', downloadHttpStatus: 0 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missing).toContain('signedUrl');
            expect(result.missing).toContain('downloadHttpStatus(200|206)');
        }
        const after = await getDeliverable(job.id);
        expect(after?.status).not.toBe('complete');
        // And the conversation must NOT report a real deliverable.
        expect(await conversationHasRealDeliverable('conv-missing')).toBe(false);
    });
    it('marks complete with full proof, fires a notification, and flips the evidence-gate signal', async () => {
        const job = await createDeliverableJob({ kind: 'pdf', title: 'Buyer and JV Report', conversationId: 'conv-real' });
        const result = await markDeliverableComplete(job.id, fullProof());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.record.status).toBe('complete');
            expect(result.record.downloadVerified).toBe(true);
            expect(result.record.fileSize).toBe(4096);
            expect(result.record.signedUrl).toContain('https://');
            // audit trail captured the completion event
            expect(result.record.events.some((e) => e.status === 'complete')).toBe(true);
        }
        // notification fired
        const notifs = await listDeliverableNotifications(20);
        expect(notifs.some((n) => n.deliverableId === job.id)).toBe(true);
        // evidence-gate signal now true for this conversation
        expect(await conversationHasRealDeliverable('conv-real')).toBe(true);
    });
    it('marks a job failed with an honest reason', async () => {
        const job = await createDeliverableJob({ kind: 'csv', title: 'Will fail' });
        const failed = await markDeliverableFailed(job.id, 'Upload failed: HTTP 500');
        expect(failed?.status).toBe('failed');
        expect(failed?.error).toContain('HTTP 500');
    });
});
