/**
 * IVX Compliance Gate — Offering/Solicitation + Outreach Compliance
 *
 * Enforces the offering and solicitation gate (Section 7), outreach compliance
 * (Section 8), and suppression list (Section 8) from the growth engine spec.
 *
 * HARD RULES:
 *   - A prospect list is NOT permission to solicit
 *   - No opportunity-specific promotion until offering fields are approved
 *   - Never contact a suppressed or unsubscribed person
 *   - Email outreach must include truthful sender, opt-out, physical address
 *   - No guaranteed-return language
 */
import { randomUUID } from 'crypto';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, } from './ivx-durable-store';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_COMPLIANCE_GATE_MARKER = 'ivx-compliance-gate-2026-07-23';
export function isOfferingPromotionAllowed(offering) {
    if (offering.legalPath === 'MARKETING_BLOCKED') {
        return { allowed: false, reason: 'Offering is MARKETING_BLOCKED — no promotion permitted.' };
    }
    if (offering.legalPath === 'COUNSEL_REVIEW_REQUIRED' && !offering.counselApprovalDate) {
        return { allowed: false, reason: 'Counsel review required but not yet approved.' };
    }
    if (!offering.approvedCopyVersion) {
        return { allowed: false, reason: 'No approved copy version — promotion blocked until copy is reviewed.' };
    }
    if (offering.approvedChannels.length === 0) {
        return { allowed: false, reason: 'No approved channels — promotion blocked until channels are designated.' };
    }
    return { allowed: true, reason: 'Offering is approved for promotion on designated channels.' };
}
export const BANNED_OUTREACH_PHRASES = [
    'guaranteed return',
    'guaranteed ROI',
    'risk-free',
    'no risk',
    'can\'t lose',
    'cannot lose',
    'sure thing',
    'guaranteed profit',
    'guaranteed income',
    'risk free investment',
    '100% safe',
    'guaranteed appreciation',
];
export function containsBannedOutreachPhrases(text) {
    const lower = text.toLowerCase();
    const found = [];
    for (const phrase of BANNED_OUTREACH_PHRASES) {
        if (lower.includes(phrase)) {
            found.push(phrase);
        }
    }
    return { found: found.length > 0, phrases: found };
}
export function validateOutreachMessage(input) {
    const violations = [];
    // Check prospect contact status
    if (input.prospectContactStatus === 'DO_NOT_CONTACT') {
        violations.push('Prospect has DO_NOT_CONTACT status — outreach blocked.');
    }
    if (input.prospectContactStatus === 'UNSUBSCRIBED') {
        violations.push('Prospect has UNSUBSCRIBED status — outreach blocked.');
    }
    if (input.prospectContactStatus === 'SUPPRESSED') {
        violations.push('Prospect is on suppression list — outreach blocked.');
    }
    if (input.prospectContactStatus === 'NO_CONTACT_AUTHORITY') {
        violations.push('No contact authority — cannot outreach without consent or lawful basis.');
    }
    // Check banned phrases
    const bannedCheck = containsBannedOutreachPhrases(`${input.subject} ${input.body}`);
    if (bannedCheck.found) {
        violations.push(`Banned phrases detected: ${bannedCheck.phrases.join(', ')}`);
    }
    // Check required fields
    if (!input.senderIdentity || input.senderIdentity.trim().length < 2) {
        violations.push('Truthful sender identity required.');
    }
    if (!input.physicalAddress || input.physicalAddress.trim().length < 5) {
        violations.push('Valid physical mailing address required.');
    }
    if (!input.optOutMethod || input.optOutMethod.trim().length < 3) {
        violations.push('Clear opt-out method required.');
    }
    if (!input.ivxBusinessIdentity) {
        violations.push('IVX business identity must be stated.');
    }
    // Truthful subject
    const truthfulSubject = input.subject.length > 0 && !containsBannedOutreachPhrases(input.subject).found;
    if (!truthfulSubject) {
        violations.push('Subject must be truthful and non-deceptive.');
    }
    const message = {
        messageId: `outreach-${randomUUID()}`,
        prospectId: '', // Set by caller
        offeringId: input.offeringId ?? null,
        channel: 'email',
        subject: input.subject,
        body: input.body,
        senderIdentity: input.senderIdentity,
        physicalAddress: input.physicalAddress,
        optOutMethod: input.optOutMethod,
        guaranteesReturn: bannedCheck.found,
        truthfulSubject,
        ivxBusinessIdentity: input.ivxBusinessIdentity,
        status: violations.length > 0 ? 'BLOCKED' : 'PENDING_APPROVAL',
        blockedReason: violations.length > 0 ? violations.join('; ') : null,
        createdAt: new Date().toISOString(),
    };
    return { valid: violations.length === 0, violations, message };
}
const STORE_DIR = auditDir('growth-engine');
const SUPPRESSION_FILE = path.join(STORE_DIR, 'suppression-list.json');
const OFFERING_FILE = path.join(STORE_DIR, 'offerings.json');
const OUTREACH_FILE = path.join(STORE_DIR, 'outreach-messages.json');
let suppressionCache = null;
let offeringCache = null;
let outreachCache = null;
async function loadSuppression() {
    if (suppressionCache)
        return suppressionCache;
    if (isDurableStoreConfigured()) {
        suppressionCache = await readDurableJson(SUPPRESSION_FILE, []);
        return suppressionCache;
    }
    try {
        suppressionCache = JSON.parse(await readFile(SUPPRESSION_FILE, 'utf8'));
        return suppressionCache;
    }
    catch {
        suppressionCache = [];
        return suppressionCache;
    }
}
async function saveSuppression(records) {
    suppressionCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(SUPPRESSION_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(SUPPRESSION_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function addToSuppression(input) {
    const records = await loadSuppression();
    // Check if already suppressed
    const existing = records.find((r) => r.prospectId === input.prospectId);
    if (existing)
        return existing;
    const record = {
        suppressionId: `supp-${randomUUID()}`,
        prospectId: input.prospectId,
        reason: input.reason,
        source: input.source,
        createdAt: new Date().toISOString(),
    };
    records.push(record);
    await saveSuppression(records);
    return record;
}
export async function removeFromSuppression(prospectId) {
    const records = await loadSuppression();
    const filtered = records.filter((r) => r.prospectId !== prospectId);
    if (filtered.length === records.length)
        return false;
    await saveSuppression(filtered);
    return true;
}
export async function isSuppressed(prospectId) {
    const records = await loadSuppression();
    return records.some((r) => r.prospectId === prospectId);
}
export async function listSuppressed() {
    return await loadSuppression();
}
// ─── Offering Store ────────────────────────────────────────────────
async function loadOfferings() {
    if (offeringCache)
        return offeringCache;
    if (isDurableStoreConfigured()) {
        offeringCache = await readDurableJson(OFFERING_FILE, []);
        return offeringCache;
    }
    try {
        offeringCache = JSON.parse(await readFile(OFFERING_FILE, 'utf8'));
        return offeringCache;
    }
    catch {
        offeringCache = [];
        return offeringCache;
    }
}
async function saveOfferings(records) {
    offeringCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(OFFERING_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(OFFERING_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function createOffering(input) {
    const now = new Date().toISOString();
    const record = {
        offeringId: `offering-${randomUUID()}`,
        legalPath: input.legalPath,
        generalSolicitationAllowed: input.generalSolicitationAllowed ?? false,
        audienceRestrictions: input.audienceRestrictions ?? [],
        accreditationRequirement: input.accreditationRequirement ?? false,
        verificationRequirement: input.verificationRequirement ?? false,
        approvedCopyVersion: input.approvedCopyVersion ?? null,
        approvedChannels: input.approvedChannels ?? [],
        counselApprovalDate: input.counselApprovalDate ?? null,
        createdAt: now,
        updatedAt: now,
    };
    const records = await loadOfferings();
    records.push(record);
    await saveOfferings(records);
    return record;
}
export async function getOffering(offeringId) {
    const records = await loadOfferings();
    return records.find((r) => r.offeringId === offeringId) ?? null;
}
export async function listOfferings() {
    return await loadOfferings();
}
export async function updateOffering(offeringId, updates) {
    const records = await loadOfferings();
    const idx = records.findIndex((r) => r.offeringId === offeringId);
    if (idx < 0)
        throw new Error(`Offering not found: ${offeringId}`);
    const updated = {
        ...records[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
    };
    records[idx] = updated;
    await saveOfferings(records);
    return updated;
}
// ─── Outreach Message Store ────────────────────────────────────────
async function loadOutreachMessages() {
    if (outreachCache)
        return outreachCache;
    if (isDurableStoreConfigured()) {
        outreachCache = await readDurableJson(OUTREACH_FILE, []);
        return outreachCache;
    }
    try {
        outreachCache = JSON.parse(await readFile(OUTREACH_FILE, 'utf8'));
        return outreachCache;
    }
    catch {
        outreachCache = [];
        return outreachCache;
    }
}
async function saveOutreachMessages(records) {
    outreachCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(OUTREACH_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(OUTREACH_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function createOutreachMessage(message) {
    const records = await loadOutreachMessages();
    records.push(message);
    await saveOutreachMessages(records);
    return message;
}
export async function listOutreachMessages(filter) {
    const records = await loadOutreachMessages();
    let filtered = records;
    if (filter?.prospectId) {
        filtered = filtered.filter((m) => m.prospectId === filter.prospectId);
    }
    if (filter?.status) {
        filtered = filtered.filter((m) => m.status === filter.status);
    }
    return filtered;
}
const APPROVAL_FILE = path.join(STORE_DIR, 'owner-approvals.json');
let approvalCache = null;
async function loadApprovals() {
    if (approvalCache)
        return approvalCache;
    if (isDurableStoreConfigured()) {
        approvalCache = await readDurableJson(APPROVAL_FILE, []);
        return approvalCache;
    }
    try {
        approvalCache = JSON.parse(await readFile(APPROVAL_FILE, 'utf8'));
        return approvalCache;
    }
    catch {
        approvalCache = [];
        return approvalCache;
    }
}
async function saveApprovals(records) {
    approvalCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(APPROVAL_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(APPROVAL_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function createOwnerApproval(input) {
    const record = {
        approvalId: `approval-${randomUUID()}`,
        type: input.type,
        description: input.description,
        prospectIds: input.prospectIds,
        offeringId: input.offeringId ?? null,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
    };
    const records = await loadApprovals();
    records.push(record);
    await saveApprovals(records);
    return record;
}
export async function resolveOwnerApproval(approvalId, decision) {
    const records = await loadApprovals();
    const idx = records.findIndex((r) => r.approvalId === approvalId);
    if (idx < 0)
        throw new Error(`Approval not found: ${approvalId}`);
    const updated = {
        ...records[idx],
        status: decision,
        resolvedAt: new Date().toISOString(),
    };
    records[idx] = updated;
    await saveApprovals(records);
    return updated;
}
export async function listPendingApprovals() {
    const records = await loadApprovals();
    return records.filter((r) => r.status === 'PENDING');
}
