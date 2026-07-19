/**
 * IVX Holdings — Production Entry Point
 *
 * Starts the Hono API server (backend/hono.ts via backend/hono-extended.ts,
 * which registers additional owner-only routes on the same app) serving all
 * API routes including engagement APIs, member APIs, deploy tools, and chat.
 *
 * Runtime: Node.js (tsx) on Render (render.yaml dockerCommand override)
 * Port:    PORT env var (default 3000)
 */
import { serve } from '@hono/node-server';
import app from './backend/hono-extended';
import { startSeniorDevWorker } from './backend/services/ivx-senior-dev-worker';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

console.log('[IVX Server] Starting Hono API server...', {
  host: HOST,
  port: PORT,
  nodeEnv: process.env.NODE_ENV || 'development',
});

// Start the autonomous senior developer worker in the background of the API
// server process. It runs independently of HTTP requests and survives Rork
// browser closure. It polls ivx_owner_ai_tasks for senior-dev-* trace_id tasks
// and runs the real 8-phase engineering pipeline. Gated by env flag so it only
// runs when explicitly enabled. Non-fatal if it fails to start.
if (process.env.IVX_SENIOR_DEV_WORKER_ENABLED === 'true') {
  startSeniorDevWorker().catch((error) => {
    console.error('[IVX Server] Senior dev worker failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  },
  (info) => {
    console.log('[IVX Server] Hono API server online', {
      host: HOST,
      port: info.port,
      family: info.family,
    });
  },
);
