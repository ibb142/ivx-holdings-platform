/**
 * IVX Supabase Restart — resumes a paused/stopped Supabase project.
 *
 * When the Supabase project is paused (all endpoints time out, status=000),
 * this endpoint calls the Management API to restart it.
 *
 * Route: POST /api/ivx/auth/restart-supabase
 */
import { ownerOnlyOptions } from './owner-only';
import { getIVXOwnerVariableRuntimeValue } from './ivx-owner-variables';

const DEPLOYMENT_MARKER = 'ivx-supabase-restart-owner-variable-binding-2026-08-15';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getSupabaseProjectRef(): string {
  return (readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL))
    .match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? 'kvclcdjmjghndxsngfzb';
}

export function ivxSupabaseRestartOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXSupabaseRestart(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, error: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 405, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  // Prefer the encrypted Owner Variables value because it is owner-rotatable at
  // runtime. A stale process.env value remains only as a fallback. No secret is
  // returned or logged.
  const accessToken = await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN', { preferStored: true });
  if (!accessToken) {
    return Response.json(
      { ok: false, error: 'Supabase Management API token is not available in Owner Variables or backend runtime.', errorCode: 'no_access_token', tokenSource: 'unavailable', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const projectRef = getSupabaseProjectRef();

  try {
    // 1. Check project status
    const statusController = new AbortController();
    const statusTimeout = setTimeout(() => statusController.abort(), 10_000);
    let projectStatus = 'unknown';
    try {
      const statusResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: statusController.signal,
      });
      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as { status?: string; region?: string; name?: string };
        projectStatus = statusData.status ?? 'unknown';
        console.log(`[IVX Supabase Restart] Project status: ${projectStatus}, name: ${statusData.name}, region: ${statusData.region}`);
        const normalizedStatus = projectStatus.trim().toUpperCase();
        if (normalizedStatus === 'ACTIVE_HEALTHY' || normalizedStatus === 'ACTIVE') {
          return Response.json(
            {
              ok: true,
              message: 'Supabase Management API authorization verified; project is already healthy.',
              projectRef,
              previousStatus: projectStatus,
              action: 'noop',
              managementAuthorized: true,
              secretValuesReturned: false,
              deploymentMarker: DEPLOYMENT_MARKER,
              timestamp: new Date().toISOString(),
            },
            { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
          );
        }
      } else if (statusResponse.status === 401 || statusResponse.status === 403) {
        const detail = await statusResponse.text().catch(() => '');
        return Response.json(
          {
            ok: false,
            error: `Supabase Management API token rejected during validation (HTTP ${statusResponse.status}).`,
            errorCode: 'management_token_rejected',
            managementHttpStatus: statusResponse.status,
            managementResponse: detail.slice(0, 180),
            projectRef,
            secretValuesReturned: false,
            deploymentMarker: DEPLOYMENT_MARKER,
          },
          { status: 502, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
        );
      }
    } catch (e) {
      console.log('[IVX Supabase Restart] Status check failed:', (e as Error)?.message);
    } finally {
      clearTimeout(statusTimeout);
    }

    // 2. Restart the project
    const restartController = new AbortController();
    const restartTimeout = setTimeout(() => restartController.abort(), 30_000);
    try {
      const restartResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/restart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: restartController.signal,
      });

      const restartText = await restartResponse.text().catch(() => '');

      if (restartResponse.ok || restartResponse.status === 202) {
        console.log(`[IVX Supabase Restart] Restart initiated for project ${projectRef}`);
        return Response.json(
          {
            ok: true,
            message: 'Supabase project restart initiated. It may take 1-3 minutes to come back online.',
            projectRef,
            previousStatus: projectStatus,
            statusCode: restartResponse.status,
            deploymentMarker: DEPLOYMENT_MARKER,
            timestamp: new Date().toISOString(),
          },
          { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
        );
      } else {
        // If restart fails, try restore (for paused projects)
        console.log(`[IVX Supabase Restart] Restart returned ${restartResponse.status}, trying restore...`);
        const restoreController = new AbortController();
        const restoreTimeout = setTimeout(() => restoreController.abort(), 30_000);
        try {
          const restoreResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/restore`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            signal: restoreController.signal,
          });
          const restoreText = await restoreResponse.text().catch(() => '');

          if (restoreResponse.ok || restoreResponse.status === 202) {
            console.log(`[IVX Supabase Restart] Restore initiated for project ${projectRef}`);
            return Response.json(
              {
                ok: true,
                message: 'Supabase project restore initiated (was paused). It may take 1-3 minutes to come back online.',
                projectRef,
                previousStatus: projectStatus,
                action: 'restore',
                deploymentMarker: DEPLOYMENT_MARKER,
                timestamp: new Date().toISOString(),
              },
              { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
            );
          }

          return Response.json(
            {
              ok: false,
              error: `Both restart and restore failed. Restart: HTTP ${restartResponse.status}, Restore: HTTP ${restoreResponse.status}`,
              restartResponse: restartText.slice(0, 300),
              restoreResponse: restoreText.slice(0, 300),
              projectRef,
              previousStatus: projectStatus,
              deploymentMarker: DEPLOYMENT_MARKER,
            },
            { status: 502, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
          );
        } finally {
          clearTimeout(restoreTimeout);
        }
      }
    } finally {
      clearTimeout(restartTimeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during restart.';
    console.error('[IVX Supabase Restart] Error:', message);
    return Response.json(
      { ok: false, error: message, errorCode: 'restart_failed', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }
}
