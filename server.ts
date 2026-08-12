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
import { startAutonomousScheduler } from './backend/services/ivx-autonomous-scheduler';
import { startSmsNotificationScheduler, getSmsNotifierStatus } from './backend/services/ivx-autonomous-sms-notifier';
import { runCompletionCampaignCycle } from './backend/services/ivx-autonomous-completion-campaign';
import { startMemberAuthCertificationScheduler } from './backend/services/ivx-member-auth-certification';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COMPLETION_CAMPAIGN_INTERVAL_MS = 5 * 60 * 1000;

console.log('[IVX Server] Starting Hono API server...', {
  host: HOST,
  port: PORT,
  nodeEnv: process.env.NODE_ENV || 'development',
});

startAutonomousScheduler();

const runCompletionCycleSafely = async (reason: string): Promise<void> => {
  try {
    const state = await runCompletionCampaignCycle(4);
    console.log('[IVX Completion Campaign]', {
      reason,
      phase: state.phase,
      verifiedSpecialists: state.totals.verifiedSpecialists,
      verifiedDivisionA: state.totals.verifiedDivisionA,
      verifiedDivisionB: state.totals.verifiedDivisionB,
    });
  } catch (error) {
    console.error('[IVX Completion Campaign] cycle failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
const campaignBootKick = setTimeout(() => { void runCompletionCycleSafely('boot'); }, 20_000);
campaignBootKick.unref?.();
const campaignTimer = setInterval(() => { void runCompletionCycleSafely('interval'); }, COMPLETION_CAMPAIGN_INTERVAL_MS);
campaignTimer.unref?.();

startSmsNotificationScheduler();
const smsStatus = getSmsNotifierStatus();
console.log('[IVX Server] Autonomous SMS notifier initialized', {
  configured: smsStatus.phoneConfigured,
  destination: smsStatus.phoneMasked,
  schedulerRunning: smsStatus.schedulerRunning,
  dailyCap: smsStatus.smsDailyCap,
});

// Production member/auth certificate runner. It performs a real synthetic
// registration + member sign-in, verifies owner password grant, executes the
// authoritative REGULAR/VIP classification logic, removes the synthetic user,
// and persists only non-secret proof. Boot run starts after the API is online;
// subsequent audits run every six hours.
startMemberAuthCertificationScheduler();

if (process.env.IVX_SENIOR_DEV_WORKER_ENABLED === 'true') {
  startSeniorDevWorker().catch((error) => {
    console.error('[IVX Server] Senior dev worker failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    console.log('[IVX Server] Hono API server online', { host: HOST, port: info.port, family: info.family });
  },
);
