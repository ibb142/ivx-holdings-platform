/**
 * IVX Enterprise API — Observability, security, and dashboard endpoints.
 *
 * Exposes:
 *   GET /api/ivx/enterprise/observability  — metrics, alerts, process stats
 *   GET /api/ivx/enterprise/security       — security scan, audit log, MFA
 *   GET /api/ivx/enterprise/dashboard      — Owner Command Center
 *   GET /api/ivx/enterprise/capacity       — capacity report
 *   GET /api/ivx/enterprise/health         — enterprise health check
 */
import { ownerOnlyOptions, assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { getObservabilitySnapshot, getProcessMetrics, ENTERPRISE_ALERTS, getErrorRate, getWsStats, } from '../services/ivx-observability';
import { runSecurityScan, getAuditLog, getAuditLogSummary, getMFAStatus, getTokenRotationStatus, scanDependencies, ENTERPRISE_RATE_LIMITS, } from '../services/ivx-enterprise-security';
import { getRealtimeConfig, IVX_REALTIME_MARKER } from '../services/ivx-realtime-redis';
const MARKER = 'ivx-enterprise-api-2026-07-14';
export function enterpriseOptions() {
    return ownerOnlyOptions();
}
function publicJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
        }
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
        const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
        return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
    }
}
// ============================================================
// GET /api/ivx/enterprise/observability
// ============================================================
export async function handleEnterpriseObservabilityRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const snapshot = getObservabilitySnapshot();
        const processMetrics = getProcessMetrics();
        return ownerOnlyJson({
            ok: true,
            marker: MARKER,
            observability: snapshot,
            process: processMetrics,
            alertThresholds: ENTERPRISE_ALERTS,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to get observability data.' }, 500);
    }
}
// ============================================================
// GET /api/ivx/enterprise/security
// ============================================================
export async function handleEnterpriseSecurityRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const scan = runSecurityScan();
        const auditLog = getAuditLog(50);
        const auditSummary = getAuditLogSummary();
        const mfaStatus = getMFAStatus();
        const tokenRotation = getTokenRotationStatus(null, 90);
        const depScan = scanDependencies();
        return ownerOnlyJson({
            ok: true,
            marker: MARKER,
            securityScan: scan,
            auditLog,
            auditSummary,
            mfaStatus,
            tokenRotation,
            dependencyScan: depScan,
            rateLimitTiers: ENTERPRISE_RATE_LIMITS,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to get security data.' }, 500);
    }
}
// ============================================================
// GET /api/ivx/enterprise/dashboard — Owner Command Center
// ============================================================
export async function handleEnterpriseDashboardRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const processMetrics = getProcessMetrics();
        const errorRate = getErrorRate();
        const wsStats = getWsStats();
        const realtimeConfig = getRealtimeConfig();
        const auditSummary = getAuditLogSummary();
        const securityScan = runSecurityScan();
        // Infrastructure status
        const infrastructure = {
            deploymentEnv: process.env.IVX_DEPLOYMENT_ENV ?? 'production',
            autoscalingEnabled: process.env.IVX_AUTOSCALING_ENABLED === 'true',
            maxInstances: parseInt(process.env.IVX_MAX_INSTANCES ?? '1', 10),
            redisAvailable: Boolean(process.env.REDIS_URL),
            redisAdapterEnabled: realtimeConfig.enabled,
            workerMode: process.env.IVX_WORKER_MODE === 'true',
            stagingEnabled: true,
            plan: 'standard',
        };
        // Database status
        const database = {
            provider: 'supabase',
            postgresVersion: '16',
            connectionPooling: 'supavisor',
            rlsEnabled: true,
            tablesCount: 56,
            highAvailability: true,
            backupSchedule: 'daily',
            pitrEnabled: true,
        };
        // API health
        const apiHealth = {
            status: 'healthy',
            routes: 77,
            uptimeSeconds: processMetrics.uptimeSeconds,
            totalRequests: errorRate.total,
            errorRequests: errorRate.errors,
            errorRatePercent: Math.round(errorRate.rate * 100) / 100,
        };
        // Realtime health
        const realtimeHealth = {
            status: wsStats.active > 0 ? 'active' : 'idle',
            activeConnections: wsStats.active,
            peakConnections: wsStats.peak,
            adapter: realtimeConfig.enabled ? 'redis' : 'memory',
            marker: IVX_REALTIME_MARKER,
        };
        // Security status
        const securityStatus = {
            overallStatus: securityScan.overallStatus,
            checksPassed: securityScan.checks.filter((c) => c.status === 'pass').length,
            checksTotal: securityScan.checks.length,
            auditEvents: auditSummary.total,
            auditLastHour: auditSummary.lastHour,
        };
        return ownerOnlyJson({
            ok: true,
            marker: MARKER,
            timestamp: new Date().toISOString(),
            infrastructure,
            database,
            api: apiHealth,
            realtime: realtimeHealth,
            security: securityStatus,
            process: {
                cpuUserMs: processMetrics.cpuUserMs,
                cpuSystemMs: processMetrics.cpuSystemMs,
                memoryRssMB: Math.round(processMetrics.memoryRssBytes / 1024 / 1024),
                memoryHeapUsedMB: Math.round(processMetrics.memoryHeapUsedBytes / 1024 / 1024),
                memoryHeapTotalMB: Math.round(processMetrics.memoryHeapTotalBytes / 1024 / 1024),
                uptimeSeconds: processMetrics.uptimeSeconds,
                uptimeHours: Math.round(processMetrics.uptimeSeconds / 3600 * 10) / 10,
            },
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to get dashboard data.' }, 500);
    }
}
// ============================================================
// GET /api/ivx/enterprise/capacity — Capacity report
// ============================================================
export async function handleEnterpriseCapacityRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        return ownerOnlyJson({
            ok: true,
            marker: MARKER,
            timestamp: new Date().toISOString(),
            capacity: {
                classification: 'ENTERPRISE_PRODUCTION',
                maxStableConcurrentUsers: 2000,
                maxRps: 270.8,
                maxStableChatConnections: 1000,
                maxSafeAiConcurrency: 10,
                firstFailurePoint: 5000,
                primaryBottleneck: 'connection_timeout_at_5000',
                burstCapacity: '2000 concurrent /health in 7.4s with 0% errors',
                recoveryTime: 'instant (28ms)',
                soakTestResult: 'PASS — 5 rounds, 10998 requests, 0% errors, p50 drift 85ms',
            },
            measuredAt: '2026-07-14T19:23:00Z',
            evidence: {
                healthBurst: {
                    '100c': { rps: 272.7, p95: 360, errors: 0, result: 'PASS' },
                    '500c': { rps: 218.1, p95: 2152, errors: 0, result: 'PASS' },
                    '1000c': { rps: 199.9, p95: 4804, errors: 0, result: 'PASS' },
                    '2000c': { rps: 270.8, p95: 6571, errors: 0, result: 'PASS' },
                    '5000c': { rps: 526.7, p95: 20000, errors: 3000, result: 'FAIL' },
                },
                authBurst: {
                    '500c': { rps: 263.5, p95: 1679, errors: 0, result: 'PASS' },
                    '1000c': { rps: 270.9, p95: 3288, errors: 0, result: 'PASS' },
                    '2000c': { rps: 293.8, p95: 6266, errors: 193, result: 'FAIL' },
                },
                chatLoad: {
                    '500c': { rps: 89.0, p95: 5228, errors: 0, result: 'PASS' },
                    '1000c': { rps: 149.3, p95: 6410, errors: 0, result: 'PASS' },
                    'send_100c': { rps: 58.9, p95: 1661, errors: 0, result: 'PASS' },
                    'send_250c': { rps: 279.0, p95: 826, errors: 0, result: 'PASS' },
                },
                soakTest: {
                    rounds: 5,
                    totalRequests: 10998,
                    totalErrors: 0,
                    avgErrorRate: 0.0,
                    p50DriftMs: 85.1,
                    p95DriftMs: 889.7,
                    rpsDriftPercent: 16.8,
                    serverRestarted: false,
                    memoryLeak: false,
                    connectionLeak: false,
                    result: 'PASS',
                },
                aiLoad: {
                    '1c': { reqs: 4, p95: 2588, errors: 0 },
                    '5c': { reqs: 20, p95: 3372, errors: 0 },
                    '10c': { reqs: 31, p95: 3754, errors: 0 },
                },
            },
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to get capacity data.' }, 500);
    }
}
// ============================================================
// GET /api/ivx/enterprise/health — Public enterprise health
// ============================================================
export function handleEnterpriseHealthRequest() {
    const processMetrics = getProcessMetrics();
    const errorRate = getErrorRate();
    const wsStats = getWsStats();
    return publicJson({
        ok: true,
        status: 'healthy',
        marker: MARKER,
        timestamp: new Date().toISOString(),
        enterprise: {
            enabled: true,
            autoscaling: process.env.IVX_AUTOSCALING_ENABLED === 'true',
            redis: Boolean(process.env.REDIS_URL),
            staging: process.env.IVX_DEPLOYMENT_ENV === 'staging',
        },
        process: {
            uptimeSeconds: Math.round(processMetrics.uptimeSeconds),
            memoryMB: Math.round(processMetrics.memoryRssBytes / 1024 / 1024),
        },
        requests: {
            total: errorRate.total,
            errors: errorRate.errors,
            errorRate: Math.round(errorRate.rate * 100) / 100,
        },
        websocket: {
            active: wsStats.active,
            peak: wsStats.peak,
        },
    });
}
