/**
 * External uptime probe.
 *
 * Pings a configurable list of public endpoints, records per-target latency +
 * status, and persists a rolling JSONL log under logs/audit/uptime/. A separate
 * cron / scheduler can call `runUptimeProbe()` every N minutes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const UPTIME_DIR = path.resolve(process.cwd(), 'logs/audit/uptime');
const UPTIME_FILE = path.join(UPTIME_DIR, 'probe.jsonl');
function readEnv(name) {
    const v = process.env[name];
    return typeof v === 'string' ? v.trim() : '';
}
/** Default targets derived from public env. Easy to extend. */
export function getDefaultUptimeTargets() {
    const targets = [];
    const apiBase = readEnv('PRODUCTION_BASE_URL') || readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') || readEnv('EXPO_PUBLIC_API_BASE_URL');
    if (apiBase) {
        targets.push({ name: 'api_health', url: `${apiBase.replace(/\/+$/, '')}/health` });
        targets.push({ name: 'api_readiness', url: `${apiBase.replace(/\/+$/, '')}/readiness` });
    }
    const ownerAI = readEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL');
    if (ownerAI && !targets.some((t) => t.url.startsWith(ownerAI))) {
        targets.push({ name: 'owner_ai_health', url: `${ownerAI.replace(/\/+$/, '')}/health` });
    }
    return targets;
}
async function probeTarget(target) {
    const checkedAt = new Date().toISOString();
    const timeoutMs = target.timeoutMs ?? 8000;
    const accepted = target.acceptedStatusRange ?? [200, 299];
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(target.url, {
            method: target.method || 'GET',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        const latencyMs = Date.now() - start;
        const httpStatus = response.status;
        const ok = httpStatus >= accepted[0] && httpStatus <= accepted[1];
        return { name: target.name, url: target.url, ok, httpStatus, latencyMs, checkedAt };
    }
    catch (error) {
        const latencyMs = Date.now() - start;
        return {
            name: target.name,
            url: target.url,
            ok: false,
            httpStatus: 0,
            latencyMs,
            checkedAt,
            error: error instanceof Error ? error.message : 'probe_failed',
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function appendProbeRecord(report) {
    try {
        await fs.mkdir(UPTIME_DIR, { recursive: true });
        await fs.appendFile(UPTIME_FILE, `${JSON.stringify(report)}\n`, 'utf8');
    }
    catch {
        // Persistence is best-effort.
    }
}
export async function runUptimeProbe(targets) {
    const scheduledAt = new Date().toISOString();
    const start = Date.now();
    const list = (targets && targets.length > 0 ? targets : getDefaultUptimeTargets());
    const results = await Promise.all(list.map((t) => probeTarget(t)));
    const upCount = results.filter((r) => r.ok).length;
    const downCount = results.length - upCount;
    const report = {
        scheduledAt,
        durationMs: Date.now() - start,
        results,
        upCount,
        downCount,
    };
    await appendProbeRecord(report);
    return report;
}
export async function readRecentUptimeProbes(limit = 50) {
    try {
        const content = await fs.readFile(UPTIME_FILE, 'utf8');
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        const slice = lines.slice(-Math.max(1, Math.min(500, limit)));
        const reports = [];
        for (const line of slice) {
            try {
                reports.push(JSON.parse(line));
            }
            catch { /* skip */ }
        }
        return reports;
    }
    catch {
        return [];
    }
}
