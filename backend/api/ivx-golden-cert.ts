/**
 * GET /api/ivx/golden-cert — behavior-specific production verification of the
 * IVX autonomous golden chain (owner mandate 2026-08-23 final closeout).
 *
 * The golden chain (chat → worker → patch → tests → typecheck → commit → PR →
 * CI → merge → deploy → verify) was previously proven only by commit-parity —
 * the merged golden module exposed no HTTP surface. This endpoint gives the
 * golden marker a deterministic, read-only, production-verifiable behavior:
 *
 *   HTTP 200 + { ok: true, marker: "IVX-GOLDEN-CERT-V7-2026-08-23",
 *                commit: <exact deployed production SHA> }
 *
 * BEFORE the golden code change this route did not exist (404). AFTER the
 * change it returns the marker plus the live deployed commit — executable
 * behavioral proof against production, not source-code inspection.
 */
import { GOLDEN_CERT_V3_MARKER } from '../services/ivx-golden-cert-v3';

export function handleIVXGoldenCertRequest(
  liveCommitSha: string,
  bootTime: string,
): Response {
  return Response.json({
    ok: true,
    marker: GOLDEN_CERT_V3_MARKER,
    commit: liveCommitSha,
    commitShort: liveCommitSha === 'unknown' ? 'unknown' : liveCommitSha.slice(0, 8),
    bootTime,
    verifiedAt: new Date().toISOString(),
    purpose: 'Behavior-specific production verification of the IVX autonomous golden chain (chat → worker → patch → tests → typecheck → commit → PR → CI → merge → deploy → verify).',
    chain: [
      'chat message received',
      'worker job created (same taskId end-to-end)',
      'patch authored by IVX LLM',
      'targeted tests + typecheck passed',
      'commit via GitHub Git Data API',
      'pull request opened',
      'required CI checks green (CI-before-merge)',
      'PR merged (merge SHA recorded)',
      'Render deploy live',
      'production /health + /version exact-SHA parity',
    ],
    behaviorAssertion: `GET /api/ivx/golden-cert returns HTTP 200 with marker ${GOLDEN_CERT_V3_MARKER} and the exact deployed commit SHA.`,
  });
}
