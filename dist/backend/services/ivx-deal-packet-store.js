/**
 * IVX Power Tools Core — Deal Packet Builder (owner-only).
 *
 * BLOCK 98. Every deal needs a complete investor/buyer packet before outreach can credibly
 * progress. This builder tracks the REQUIRED packet items as a per-deal checklist, computes
 * readiness, and never fabricates a document — an item is only `ready` when the owner marks
 * it so (optionally attaching an owner-supplied reference/URL). Unknown items stay `pending`.
 *
 * Required items (BLOCK 98 spec):
 *   deal one-pager · investor teaser · property brochure/photos/renders · proforma ·
 *   NOI / cap rate / ROI · risk disclosures · data room checklist ·
 *   offering/accreditation summary · AML/KYC/source-of-funds checklist
 *
 * Durable layout (mirrors the proven store pattern):
 *   logs/audit/deal-packet/packets.jsonl  append-only event log
 *   logs/audit/deal-packet/packets.json   materialised current state
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_DEAL_PACKET_MARKER = 'ivx-deal-packet-2026-06-03';
/** The canonical required-item set for every deal packet. */
export const PACKET_ITEM_TEMPLATES = [
    { key: 'deal_one_pager', label: 'Deal one-pager', required: true },
    { key: 'investor_teaser', label: 'Investor teaser', required: true },
    { key: 'property_media', label: 'Property brochure / photos / renders', required: true },
    { key: 'proforma', label: 'Proforma', required: true },
    { key: 'noi_cap_roi', label: 'NOI / cap rate / ROI', required: true },
    { key: 'risk_disclosures', label: 'Risk disclosures', required: true },
    { key: 'data_room_checklist', label: 'Data room checklist', required: true },
    { key: 'offering_accreditation', label: 'Offering / accreditation summary', required: true },
    { key: 'aml_kyc', label: 'AML / KYC / source-of-funds checklist', required: true },
];
const VALID_ITEM_KEYS = new Set(PACKET_ITEM_TEMPLATES.map((t) => t.key));
const VALID_ITEM_STATUS = new Set(['pending', 'ready', 'not_applicable']);
const ROOT = auditDir('deal-packet');
const STATE = path.join(ROOT, 'packets.json');
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function readJsonFile(file, fallback) {
    if (isDurableStoreConfigured()) {
        return readDurableJson(file, fallback);
    }
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeJsonFile(file, value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(ROOT, 'packets.jsonl');
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // Forensic log is best-effort; never break a write on log failure.
        }
        return;
    }
    try {
        await mkdir(ROOT, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a write on log failure.
    }
}
function freshItems() {
    const at = nowIso();
    return PACKET_ITEM_TEMPLATES.map((t) => ({
        key: t.key,
        label: t.label,
        required: t.required,
        status: 'pending',
        reference: '',
        updatedAt: at,
    }));
}
/**
 * Compute readiness (0–100) + completeness from the item list. A `not_applicable`
 * required item counts toward completeness (owner explicitly excluded it) but not
 * toward the "ready document" numerator, so readiness reflects real prepared docs.
 */
export function computePacketReadiness(items) {
    const required = items.filter((i) => i.required);
    if (required.length === 0)
        return { readiness: 0, complete: false };
    const ready = required.filter((i) => i.status === 'ready').length;
    const resolved = required.filter((i) => i.status === 'ready' || i.status === 'not_applicable').length;
    const readiness = Math.round((ready / required.length) * 100);
    return { readiness, complete: resolved === required.length };
}
function rebuild(packet) {
    const { readiness, complete } = computePacketReadiness(packet.items);
    return { ...packet, readiness, complete, updatedAt: nowIso() };
}
export async function listDealPackets() {
    const items = await readJsonFile(STATE, []);
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getDealPacket(id) {
    const items = await readJsonFile(STATE, []);
    return items.find((item) => item.id === id) ?? null;
}
/** Create a fresh packet (all required items pending) for a deal. Requires a deal name. */
export async function createDealPacket(input) {
    const dealName = asTrimmedString(input.dealName);
    if (!dealName)
        return { ok: false, error: 'A deal name is required to start a packet.' };
    const items = await readJsonFile(STATE, []);
    const packet = rebuild({
        id: createId('packet'),
        dealName,
        relatedDealId: asTrimmedString(input.relatedDealId),
        items: freshItems(),
        readiness: 0,
        complete: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    });
    items.push(packet);
    await writeJsonFile(STATE, items);
    await appendEvent({ type: 'create', packet, at: packet.createdAt });
    return { ok: true, packet };
}
/** Set the status (and optional owner reference) of one packet item. */
export async function setPacketItem(packetId, itemKey, status, reference) {
    if (!VALID_ITEM_KEYS.has(itemKey) || !VALID_ITEM_STATUS.has(status))
        return null;
    const items = await readJsonFile(STATE, []);
    const index = items.findIndex((p) => p.id === packetId);
    if (index === -1)
        return null;
    const packet = items[index];
    const nextItems = packet.items.map((it) => it.key === itemKey
        ? { ...it, status, reference: reference !== undefined ? asTrimmedString(reference) : it.reference, updatedAt: nowIso() }
        : it);
    const next = rebuild({ ...packet, items: nextItems });
    items[index] = next;
    await writeJsonFile(STATE, items);
    await appendEvent({ type: 'item', packetId, itemKey, status, at: next.updatedAt });
    return next;
}
export async function deleteDealPacket(id) {
    const items = await readJsonFile(STATE, []);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length)
        return false;
    await writeJsonFile(STATE, next);
    await appendEvent({ type: 'delete', packetId: id, at: nowIso() });
    return true;
}
export async function summarizeDealPackets() {
    const items = await readJsonFile(STATE, []);
    const total = items.length;
    const complete = items.filter((p) => p.complete).length;
    const avgReadiness = total > 0 ? Math.round(items.reduce((s, p) => s + p.readiness, 0) / total) : 0;
    return { marker: IVX_DEAL_PACKET_MARKER, generatedAt: nowIso(), total, complete, avgReadiness };
}
