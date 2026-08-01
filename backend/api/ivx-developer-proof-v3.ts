import type { Context } from 'hono';

export async function handleDeveloperProofV3(c: Context): Promise<Response> {
  return c.json({
    sha: process.env.RENDER_GIT_COMMIT ?? 'unknown',
    workerVersion: 'v6.16',
    deployStatus: 'live',
    timestamp: new Date().toISOString(),
  });
}
