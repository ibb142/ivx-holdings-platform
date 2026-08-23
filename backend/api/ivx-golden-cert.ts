import { GOLDEN_CERT_V3_MARKER } from '../services/ivx-golden-cert-v3';

/**
 * Public, read-only production behavior proof for the Autonomous golden chain.
 * No credentials or user data are exposed. The marker is compiled from the
 * same source file changed by the golden Autonomous job, while commit reports
 * the Render runtime SHA so certification can assert behavior + exact parity.
 */
export function handleGoldenCertGet(): Response {
  const commit = (
    process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT_SHA
    || process.env.SOURCE_VERSION
    || ''
  ).trim() || null;

  return Response.json({
    ok: true,
    marker: GOLDEN_CERT_V3_MARKER,
    commit,
    verification: 'live-production-behavior',
    secretValuesReturned: false,
  }, { status: 200 });
}
