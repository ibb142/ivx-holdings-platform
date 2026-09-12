import { randomUUID } from 'node:crypto';

// One opaque identity per process. It contains no hostname, token or user data.
// Replays must identify the process serving this response, not the original one.
const processIdentity = randomUUID();

export function ownerRuntimeEvidenceHeaders(): Record<string, string> {
  const source = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || '').trim();
  return {
    'X-IVX-Serving-Instance': processIdentity,
    'X-IVX-Serving-Commit': /^[a-f0-9]{40}$/.test(source) ? source : 'unknown',
  };
}

export function withOwnerRuntimeEvidence(response: Response): Response {
  // Hono's Node adapter lazily materializes Response.body from its original
  // constructor options. Mutating a cached header object can be lost during
  // that conversion. Snapshot all headers before touching body, then supply
  // the complete Headers object at construction. This does not consume SSE.
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ownerRuntimeEvidenceHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
