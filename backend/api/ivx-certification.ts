/**
 * IVX Deploy Certification Gate API — exposes the permanent certification pipeline.
 *
 * Endpoints:
 *   GET  /api/ivx/certification/latest       — most recent certification report
 *   GET  /api/ivx/certification/reports       — ledger of recent reports (?limit=10)
 *   POST /api/ivx/certification/run           — manually trigger a full 16-module audit
 *   GET  /api/ivx/certigation/status          — public summary (no auth)
 */
import { ownerOnlyOptions, ownerOnlyJson, assertIVXOwnerOnly } from './owner-only';
import {
  runDeployCertificationGate,
  getLatestCertificationReport,
  getRecentCertificationReports,
  type CertificationReport,
} from '../services/ivx-deploy-certification-gate';

const MARKER = 'ivx-certification-api-2026-07-21';

export function certificationOptions(): Response {
  return ownerOnlyOptions();
}

function publicJson(data: unknown, status: number = 200): Response {
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

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/certification/latest — owner-only; most recent report. */
export async function handleCertificationLatestRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  const report = getLatestCertificationReport();
  if (!report) {
    return ownerOnlyJson({ ok: true, marker: MARKER, report: null, message: 'No certification report yet. POST /api/ivx/certification/run to generate one.' });
  }
  return ownerOnlyJson({ ok: true, marker: MARKER, report });
}

/** GET /api/ivx/certification/reports — owner-only; ledger of recent reports. */
export async function handleCertificationReportsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10) || 10, 50);
  const reports = getRecentCertificationReports(limit);
  return ownerOnlyJson({ ok: true, marker: MARKER, count: reports.length, reports });
}

/** POST /api/ivx/certification/run — owner-only; manually trigger full 16-module audit. */
export async function handleCertificationRunRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const apiBase = url.searchParams.get('apiBase') ?? 'https://api.ivxholding.com';
    // Reuse owner token from request for downstream authenticated probes
    const ownerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const report = await runDeployCertificationGate({
      triggeredBy: 'manual',
      triggerSource: 'api:/api/ivx/certification/run',
      apiBase,
      ownerToken,
    });
    return ownerOnlyJson({ ok: true, marker: MARKER, report });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Certification run failed.' }, 500);
  }
}

/** GET /api/ivx/certification/status — public summary (no auth). */
export function handleCertificationStatusRequest(): Response {
  const report = getLatestCertificationReport();
  if (!report) {
    return publicJson({ ok: true, marker: MARKER, certified: false, message: 'No certification report yet.' });
  }
  return publicJson({
    ok: true,
    marker: MARKER,
    certified: report.certifiable,
    overallVerdict: report.overallVerdict,
    reportId: report.reportId,
    triggeredBy: report.triggeredBy,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    passCount: report.passCount,
    failCount: report.failCount,
    warnCount: report.warnCount,
    notRunCount: report.notRunCount,
    modules: report.modules.map((m) => ({
      id: m.id,
      name: m.name,
      verdict: m.verdict,
      summary: m.summary,
    })),
  });
}
