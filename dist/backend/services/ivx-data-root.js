/**
 * IVX durable data root resolver.
 *
 * THE DATA-LOSS FIX (2026-06-07):
 *   Every IVX business store (leads, deals, investor CRM, outreach, capital
 *   pipeline, etc.) historically wrote to `process.cwd()/logs/audit/...`. On
 *   Render that path lives on the EPHEMERAL container filesystem, so every deploy
 *   or restart wiped all business data back to zero — deals 3 → 0, CRM → 0, leads
 *   reset. Meanwhile the chat SQLite correctly lives on the mounted PERSISTENT
 *   disk at `/app/data` (see render.yaml `disk.mountPath: /app/data` and
 *   `CHAT_DATABASE_PATH=/app/data/chat-room.sqlite`).
 *
 *   This module centralises the durable base directory so all stores write under
 *   the persistent disk and survive restarts/deploys.
 *
 * Resolution order:
 *   1. `IVX_DATA_DIR` env var, if set (explicit override; set to /app/data in prod).
 *   2. The mounted persistent disk `/app/data`, if it exists and is writable.
 *   3. `process.cwd()` (local dev / tests — keeps the existing layout).
 *
 * The chosen root is cached after the first resolve so every store agrees on one
 * location for the life of the process.
 */
import { existsSync, mkdirSync, accessSync, constants, cpSync } from 'node:fs';
import path from 'node:path';
let cachedRoot = null;
function isUsableDir(dir) {
    try {
        if (!existsSync(dir)) {
            // Try to create it — the mount point may exist but the subdir may not.
            mkdirSync(dir, { recursive: true });
        }
        accessSync(dir, constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve the durable base directory for all IVX persistent business data.
 * Stores should build their paths as `path.join(resolveDataRoot(), 'logs', 'audit', '<store>')`.
 */
export function resolveDataRoot() {
    if (cachedRoot)
        return cachedRoot;
    const explicit = typeof process.env.IVX_DATA_DIR === 'string' ? process.env.IVX_DATA_DIR.trim() : '';
    if (explicit && isUsableDir(explicit)) {
        cachedRoot = explicit;
        return cachedRoot;
    }
    const renderDisk = '/app/data';
    if (isUsableDir(renderDisk)) {
        cachedRoot = renderDisk;
        return cachedRoot;
    }
    cachedRoot = process.cwd();
    return cachedRoot;
}
/** Convenience: build a path under the durable audit root, e.g. auditDir('lead-capture'). */
export function auditDir(...segments) {
    return path.join(resolveDataRoot(), 'logs', 'audit', ...segments);
}
/**
 * Business-data store subdirectories under logs/audit that must persist. Used by the
 * one-time migration to carry pre-fix data from the old ephemeral location
 * (process.cwd()) onto the durable disk without overwriting anything already there.
 */
const DURABLE_STORE_DIRS = [
    'lead-capture',
    'investor-crm',
    'deal-tracking',
    'deal-packet',
    'outreach',
    'capital-pipeline',
    'capital-network',
];
let migrationDone = false;
/**
 * One-time, idempotent migration: if the durable root differs from process.cwd()
 * (i.e. we're on the Render persistent disk) and a business store exists in the old
 * cwd location but NOT yet on the durable disk, copy it over so historical leads,
 * deals, and CRM contacts are preserved on the first boot after the data-loss fix.
 * Never overwrites existing durable data. Best-effort: failures never block boot.
 */
export function migrateLegacyDataIntoDataRoot() {
    const migrated = [];
    const skipped = [];
    if (migrationDone)
        return { migrated, skipped };
    migrationDone = true;
    const root = resolveDataRoot();
    const legacyRoot = process.cwd();
    // Nothing to do when the durable root IS the cwd (local dev / tests).
    if (path.resolve(root) === path.resolve(legacyRoot))
        return { migrated, skipped };
    for (const store of DURABLE_STORE_DIRS) {
        try {
            const from = path.join(legacyRoot, 'logs', 'audit', store);
            const to = path.join(root, 'logs', 'audit', store);
            if (!existsSync(from))
                continue;
            // Never overwrite durable data that already exists.
            if (existsSync(to)) {
                skipped.push(store);
                continue;
            }
            mkdirSync(path.dirname(to), { recursive: true });
            cpSync(from, to, { recursive: true, errorOnExist: false, force: false });
            migrated.push(store);
        }
        catch {
            // Best-effort: a single store failing must never block boot.
        }
    }
    return { migrated, skipped };
}
