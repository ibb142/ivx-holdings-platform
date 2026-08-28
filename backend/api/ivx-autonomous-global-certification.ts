/**
 * GET /api/ivx/autonomous/global-certification — the Autonomous GLOBAL
 * SUPERVISOR endpoint (owner mandate 2026-08-28).
 *
 * Collects the status of EVERY required certification workflow on the current
 * MAIN SHA, enforces the SAME-SHA invariant against production /health, returns
 * the global verdict (GREEN / RED / PENDING — never a claim while RED) and
 * automatically opens a low-risk repair mission for every RED gate.
 * High-risk operations remain OWNER-GATED inside the worker.
 *
 * Auth: trusted GitHub Actions OIDC (read-only machine identity) or the
 * registered owner bearer — identical to the autonomous control-plane GET.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import {
  IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
  resolveMainSha,
  runGlobalCertificationSupervision,
} from '../services/ivx-global-certification-supervisor';

export function autonomousGlobalCertificationOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleAutonomousGlobalCertificationGet(request: Request): Promise<Response> {
  try {
    const trustedMachine = await verifyIVXGitHubActionsOIDCRequest(request);
    if (!trustedMachine) await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'IVX owner authentication required.' }, 401);
  }

  try {
    const mainSha = await resolveMainSha();
    if (!mainSha) {
      // Fail-closed: without GitHub collection there is NO certification — never GREEN.
      return ownerOnlyJson({
        ok: true,
        marker: IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
        status: 'PENDING',
        certified: false,
        reason: 'MAIN SHA could not be resolved from GitHub (token missing or API failure) — certification fail-closed PENDING.',
        policy: 'Autonomous can never certify without same-SHA collection of every required workflow.',
      });
    }
    const { result, dispatches } = await runGlobalCertificationSupervision(mainSha);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
      generatedAt: new Date().toISOString(),
      status: result.status,
      certified: result.certified,
      mainSha: result.mainSha,
      failedRequired: result.failedRequired,
      shaParity: result.shaParity,
      production: result.production,
      collector: result.collector,
      collectorError: result.collectorError,
      gates: result.gates,
      repairDispatches: dispatches,
      repairMissions: result.repairMissions,
      policy: result.policy,
    });
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
      status: 'PENDING',
      certified: false,
      error: error instanceof Error ? error.message : 'Global certification supervision failed (fail-closed PENDING).',
    }, 500);
  }
}
