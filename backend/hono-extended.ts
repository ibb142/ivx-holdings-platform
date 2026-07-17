/**
 * IVX Hono Extended — route extension layer on top of backend/hono.ts.
 *
 * WHY THIS FILE EXISTS:
 * backend/hono.ts (306KB) exceeds the Cloudflare WAF request-size ceiling
 * (~100–200KB) enforced on the owner deploy API, so new routes cannot be
 * registered by re-committing the full file through the guarded pipeline.
 * This small module imports the existing app and registers additional routes.
 * server.ts imports THIS module, so all original routes remain untouched.
 *
 * Routes registered here:
 *   GET  /api/ivx/autonomous/ledger         — owner-only W1–W12 job ledger
 *   POST /api/ivx/autonomous/ledger/update  — owner-approved job state change
 */
import app from './hono';
import {
  autonomousJobLedgerOptions,
  handleAutonomousJobLedgerGet,
  handleAutonomousJobLedgerUpdate,
} from './api/ivx-autonomous-job-ledger';

app.options('/api/ivx/autonomous/ledger', () => autonomousJobLedgerOptions());
app.get('/api/ivx/autonomous/ledger', async (context) => handleAutonomousJobLedgerGet(context.req.raw));
app.options('/api/ivx/autonomous/ledger/update', () => autonomousJobLedgerOptions());
app.post('/api/ivx/autonomous/ledger/update', async (context) => handleAutonomousJobLedgerUpdate(context.req.raw));

export default app;
