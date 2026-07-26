/**
 * IVX PDF generation service — PHASE 2 (Real Deliverable System).
 *
 * Produces a REAL multi-page PDF byte buffer from a structured report spec
 * using `pdf-lib` (pure-JS, Bun/Node-compatible — no native deps, no browser).
 * The deliverable pipeline uploads these bytes to Supabase Storage and signs a
 * download URL, so a "report" is a real file with a real size — never a
 * placeholder link.
 *
 * Layout: A4 portrait, wrapped paragraph text, automatic page breaks, a title
 * block, optional subtitle/meta line, and section headings. Never throws an
 * un-typed error — `generateReportPdf` surfaces an honest failure result.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export const IVX_PDF_GENERATOR_MARKER = 'ivx-pdf-generator-2026-06-01';
const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TITLE_SIZE = 22;
const SUBTITLE_SIZE = 13;
const META_SIZE = 9;
const HEADING_SIZE = 14;
const BODY_SIZE = 11;
const LINE_GAP = 4;
/** Strip characters that the standard WinAnsi PDF fonts cannot encode. */
function sanitizeText(value) {
    if (typeof value !== 'string')
        return '';
    // pdf-lib StandardFonts encode WinAnsi; drop anything outside that range to
    // avoid a hard encode error on emoji / exotic unicode.
    return value.replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '').replace(/\r\n?/g, '\n');
}
/** Greedily wrap a single line of text to fit the content width at a font size. */
function wrapLine(text, font, size) {
    const clean = sanitizeText(text);
    if (clean.length === 0)
        return [''];
    const words = clean.split(/\s+/).filter((w) => w.length > 0);
    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current.length === 0 ? word : `${current} ${word}`;
        const width = font.widthOfTextAtSize(candidate, size);
        if (width > CONTENT_WIDTH && current.length > 0) {
            lines.push(current);
            current = word;
        }
        else {
            current = candidate;
        }
    }
    if (current.length > 0)
        lines.push(current);
    return lines.length > 0 ? lines : [''];
}
/**
 * Generate a real PDF from a report spec. Returns the encoded bytes + page
 * count. Never throws — any failure becomes `{ ok: false, error }`.
 */
export async function generateReportPdf(spec) {
    try {
        const doc = await PDFDocument.create();
        doc.setTitle(sanitizeText(spec.title) || 'IVX Report');
        doc.setProducer('IVX Deliverable Pipeline');
        doc.setCreator('IVX Holdings');
        doc.setCreationDate(new Date());
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        let cursorY = PAGE_HEIGHT - MARGIN;
        const newPage = () => {
            page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            cursorY = PAGE_HEIGHT - MARGIN;
        };
        const draw = (text, drawFont, size, color = rgb(0.1, 0.12, 0.16)) => {
            const lines = wrapLine(text, drawFont, size);
            for (const line of lines) {
                if (cursorY - size < MARGIN)
                    newPage();
                page.drawText(line, { x: MARGIN, y: cursorY - size, size, font: drawFont, color });
                cursorY -= size + LINE_GAP;
            }
        };
        // Title block
        draw(spec.title, bold, TITLE_SIZE, rgb(0.05, 0.07, 0.1));
        cursorY -= 4;
        if (spec.subtitle)
            draw(spec.subtitle, font, SUBTITLE_SIZE, rgb(0.27, 0.3, 0.36));
        if (spec.meta)
            draw(spec.meta, font, META_SIZE, rgb(0.45, 0.48, 0.54));
        // Divider
        cursorY -= 6;
        if (cursorY - 1 < MARGIN)
            newPage();
        page.drawLine({
            start: { x: MARGIN, y: cursorY },
            end: { x: PAGE_WIDTH - MARGIN, y: cursorY },
            thickness: 0.75,
            color: rgb(0.8, 0.82, 0.86),
        });
        cursorY -= 16;
        // Sections
        for (const section of spec.sections) {
            cursorY -= 6;
            draw(section.heading, bold, HEADING_SIZE, rgb(0.08, 0.1, 0.14));
            cursorY -= 2;
            for (const paragraph of section.body) {
                draw(paragraph, font, BODY_SIZE);
                cursorY -= 2;
            }
        }
        const bytes = await doc.save();
        return { ok: true, bytes, byteLength: bytes.byteLength, pageCount: doc.getPageCount() };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'PDF generation failed.' };
    }
}
