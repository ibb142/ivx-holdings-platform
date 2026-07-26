/**
 * IVX Capital Deployment Platform — CRM bulk-import (owner-only).
 *
 * BLOCK 67. The mechanism the owner needs to LOAD real contact data into the
 * Investor CRM at scale — investors, buyers, brokers, developers, lenders, and
 * partners — from CSV (the format Excel exports natively) or from manually
 * entered rows.
 *
 * HARD HONESTY RULE (platform-wide, enforced here):
 *   - This tool NEVER fabricates a contact. It only maps rows the OWNER supplies
 *     (a real import file / pasted spreadsheet / manual entry) into records.
 *   - Every imported row carries `source: 'crm_import'` + `sourceDetail` (the file
 *     name / pasted-on date) for honest attribution.
 *   - Rows with no usable name are SKIPPED and reported — never invented.
 *
 * Pure + deterministic (no I/O, no AI, no network) → fully unit-testable. The
 * durable write happens in `ivx-investor-crm-store.importInvestors`.
 */
import { normalizePartyType, } from './ivx-investor-crm-store';
/**
 * Parse RFC-4180-ish CSV text into a matrix of string cells.
 * Handles quoted fields, embedded commas/newlines, and "" escaped quotes.
 */
export function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const pushField = () => {
        row.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        rows.push(row);
        row = [];
    };
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        }
        else if (char === ',') {
            pushField();
        }
        else if (char === '\n') {
            pushRow();
        }
        else if (char === '\r') {
            // swallow; a following \n triggers the row break, otherwise handle lone \r
            if (text[i + 1] !== '\n')
                pushRow();
        }
        else {
            field += char;
        }
    }
    // flush the trailing field/row if there is any pending content
    if (field.length > 0 || row.length > 0)
        pushRow();
    // drop fully-empty trailing rows
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
/** Map of accepted header aliases (lowercased, non-alphanumeric stripped) → field. */
const HEADER_ALIASES = {
    name: 'name',
    fullname: 'name',
    contact: 'name',
    contactname: 'name',
    company: 'company',
    companyname: 'company',
    organization: 'company',
    org: 'company',
    firm: 'company',
    email: 'email',
    emailaddress: 'email',
    mail: 'email',
    phone: 'phone',
    phonenumber: 'phone',
    mobile: 'phone',
    cell: 'phone',
    tel: 'phone',
    location: 'location',
    city: 'location',
    market: 'location',
    region: 'location',
    investmenttype: 'investmentType',
    type: 'investmentType',
    category: 'investmentType',
    checksize: 'typicalCheckSize',
    typicalchecksize: 'typicalCheckSize',
    budget: 'typicalCheckSize',
    capacity: 'typicalCheckSize',
    timeline: 'investmentTimeline',
    investmenttimeline: 'investmentTimeline',
    notes: 'notes',
    note: 'notes',
    comments: 'notes',
    partytype: 'partyType',
    role: 'partyType',
    kind: 'partyType',
};
function normalizeHeader(header) {
    const key = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    return HEADER_ALIASES[key] ?? null;
}
/**
 * Map parsed CSV rows (header row + data rows) into validated create-inputs.
 * The first row MUST be a header row. Rows without a usable name are skipped
 * and reported — IVX never invents a contact name.
 */
export function mapCsvToInvestorInputs(rows, options) {
    const skippedRows = [];
    if (rows.length === 0) {
        return { inputs: [], skippedRows, recognizedColumns: [], totalRows: 0 };
    }
    const header = rows[0];
    const columnMap = header.map((h) => normalizeHeader(h));
    const recognizedColumns = columnMap.filter((c) => c !== null);
    const dataRows = rows.slice(1);
    const inputs = [];
    const defaultParty = options.partyType ?? 'investor';
    dataRows.forEach((cells, index) => {
        const rowNumber = index + 2; // 1-based, +1 for the header row
        const values = {};
        columnMap.forEach((field, colIndex) => {
            if (!field)
                return;
            const raw = (cells[colIndex] ?? '').trim();
            if (raw)
                values[field] = raw;
        });
        const name = values.name ?? '';
        if (!name) {
            // Skip blank/header-only lines silently; report rows that have data but no name.
            const hasAnyData = Object.keys(values).length > 0;
            if (hasAnyData) {
                skippedRows.push({ row: rowNumber, reason: 'No name column value — IVX never fabricates a contact name.' });
            }
            return;
        }
        inputs.push({
            name,
            source: 'crm_import',
            sourceDetail: options.sourceDetail,
            partyType: values.partyType ? normalizePartyType(values.partyType) : defaultParty,
            company: values.company,
            email: values.email,
            phone: values.phone,
            location: values.location,
            investmentType: values.investmentType,
            typicalCheckSize: values.typicalCheckSize,
            investmentTimeline: values.investmentTimeline,
            notes: values.notes,
        });
    });
    return { inputs, skippedRows, recognizedColumns, totalRows: dataRows.length };
}
/** Convenience: parse CSV text and map it in one call. */
export function parseCsvToInvestorInputs(csv, options) {
    return mapCsvToInvestorInputs(parseCsv(csv), options);
}
/**
 * Normalize an array of already-structured manual rows (e.g. from a form/JSON)
 * into create-inputs, applying the same no-fabrication rule.
 */
export function mapManualRowsToInvestorInputs(rows, options) {
    const skippedRows = [];
    const inputs = [];
    const defaultParty = options.partyType ?? 'investor';
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    rows.forEach((raw, index) => {
        const name = str(raw.name);
        if (!name) {
            skippedRows.push({ row: index + 1, reason: 'No name — IVX never fabricates a contact name.' });
            return;
        }
        inputs.push({
            name,
            source: 'crm_import',
            sourceDetail: options.sourceDetail,
            partyType: raw.partyType ? normalizePartyType(raw.partyType) : defaultParty,
            company: str(raw.company) || undefined,
            email: str(raw.email) || undefined,
            phone: str(raw.phone) || undefined,
            location: str(raw.location) || undefined,
            investmentType: str(raw.investmentType) || undefined,
            typicalCheckSize: str(raw.typicalCheckSize) || undefined,
            investmentTimeline: str(raw.investmentTimeline) || undefined,
            notes: str(raw.notes) || undefined,
        });
    });
    return { inputs, skippedRows, recognizedColumns: [], totalRows: rows.length };
}
