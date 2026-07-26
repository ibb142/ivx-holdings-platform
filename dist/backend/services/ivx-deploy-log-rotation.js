/**
 * Deploy-log rotation utility.
 *
 * `logs/deploy/` accumulates per-deploy folders + transient files. This module
 * provides a safe, idempotent rotator that compresses (rename to .archived/)
 * anything older than `keepDays` and deletes archives older than `purgeDays`.
 *
 * Read-only by default — call `rotateDeployLogs({ apply: true })` to act.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const DAY_MS = 24 * 60 * 60 * 1000;
export async function rotateDeployLogs(options = {}) {
    const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), 'logs/deploy'));
    const keepDays = Math.max(1, options.keepDays ?? 14);
    const purgeDays = Math.max(keepDays + 1, options.purgeDays ?? 60);
    const apply = options.apply === true;
    const scannedAt = new Date().toISOString();
    const actions = [];
    const archivedDir = path.join(rootDir, '.archived');
    try {
        await fs.stat(rootDir);
    }
    catch {
        return { ok: true, rootDir, apply, keepDays, purgeDays, scannedAt, actions };
    }
    try {
        if (apply)
            await fs.mkdir(archivedDir, { recursive: true });
        const now = Date.now();
        const entries = await fs.readdir(rootDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === '.archived')
                continue;
            const entryPath = path.join(rootDir, entry.name);
            const stat = await fs.stat(entryPath);
            const ageDays = (now - stat.mtimeMs) / DAY_MS;
            if (ageDays >= keepDays) {
                const target = path.join(archivedDir, `${Date.now()}-${entry.name}`);
                actions.push({ kind: 'archive', from: entryPath, to: target });
                if (apply) {
                    try {
                        await fs.rename(entryPath, target);
                    }
                    catch (error) {
                        actions.push({ kind: 'skip', path: entryPath, reason: error instanceof Error ? error.message : 'rename_failed' });
                    }
                }
            }
        }
        try {
            const archivedEntries = await fs.readdir(archivedDir, { withFileTypes: true });
            for (const entry of archivedEntries) {
                const entryPath = path.join(archivedDir, entry.name);
                const stat = await fs.stat(entryPath);
                const ageDays = (now - stat.mtimeMs) / DAY_MS;
                if (ageDays >= purgeDays) {
                    actions.push({ kind: 'purge', path: entryPath });
                    if (apply) {
                        try {
                            await fs.rm(entryPath, { recursive: true, force: true });
                        }
                        catch (error) {
                            actions.push({ kind: 'skip', path: entryPath, reason: error instanceof Error ? error.message : 'rm_failed' });
                        }
                    }
                }
            }
        }
        catch {
            // archived dir may not exist yet on dry-run
        }
        return { ok: true, rootDir, apply, keepDays, purgeDays, scannedAt, actions };
    }
    catch (error) {
        return {
            ok: false,
            rootDir,
            apply,
            keepDays,
            purgeDays,
            scannedAt,
            actions,
            error: error instanceof Error ? error.message : 'Rotation failed.',
        };
    }
}
