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
import { getLatestMemberAuthCertification, startMemberAuthCertificationScheduler } from './backend/services/ivx-member-auth-certification';
import { preloadAIProviderCredentialFromOwnerVariables } from './backend/services/ivx-ai-owner-variable-preload';
import { mintIVXOutageOwnerSession, verifyIVXOutageOwnerSession } from './backend/services/ivx-outage-owner-session';
import { getIVXOwnerEmailAllowlist } from './expo/shared/ivx/access-control';
import { handleCanonicalReelsFeed } from './backend/api/ivx-canonical-reels-feed';
import {
  autonomousVoiceOptions,
  handleAutonomousVoiceCallback,
  handleAutonomousVoiceLaml,
  handleAutonomousVoiceStatus,
  handleAutonomousVoiceTest,
} from './backend/api/ivx-autonomous-voice';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COMPLETION_CAMPAIGN_INTERVAL_MS = 5 * 60 * 1000;
const OWNER_LOGIN_CERT_MARKER = 'ivx-owner-login-outage-cert-2026-08-15';

console.log('[IVX Server] Starting Hono API server...', {
  host: HOST,
  port: PORT,
  nodeEnv: process.env.NODE_ENV || 'development',
});

// Repair stale host bindings from the existing encrypted Owner Variables store.
// No secret is logged or returned; the AI runtime reads these aliases lazily.
void preloadAIProviderCredentialFromOwnerVariables().catch((error) => {
  console.warn('[IVX Server] AI owner-variable preload unavailable', {
    error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
  });
});

// Non-secret owner-login proof. This validates the same server-signed outage
// session used by emergency owner login and is intentionally independent from
// Supabase availability. It never returns the generated token or signing key.
app.get('/api/ivx/certification/owner-login-public', (c) => {
  try {
    const ownerEmail = (getIVXOwnerEmailAllowlist()[0] || '').trim().toLowerCase();
    const session = ownerEmail ? mintIVXOutageOwnerSession(ownerEmail) : null;
    const verified = session ? verifyIVXOutageOwnerSession(session.token) : null;
    const certified = Boolean(
      session
      && verified
      && verified.userId === session.userId
      && verified.email === ownerEmail
      && verified.role === 'owner'
      && verified.expiresAt === session.expiresAt,
    );
    return c.json({
      ok: certified,
      certified,
      marker: OWNER_LOGIN_CERT_MARKER,
      mode: 'server_signed_owner_outage_session',
      supabaseIndependent: true,
      ownerAllowlistBound: Boolean(ownerEmail),
      tokenMintVerified: certified,
      secretValuesReturned: false,
      commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || '').trim() || null,
      completedAt: new Date().toISOString(),
    }, certified ? 200 : 503);
  } catch {
    return c.json({
      ok: false,
      certified: false,
      marker: OWNER_LOGIN_CERT_MARKER,
      mode: 'server_signed_owner_outage_session',
      supabaseIndependent: true,
      ownerAllowlistBound: false,
      tokenMintVerified: false,
      secretValuesReturned: false,
    }, 503);
  }
});

// Non-secret machine-readable proof produced by the production certification
// scheduler. It intentionally exposes only boolean checks and deployment IDs —
// never credentials, user records, tokens, or diagnostic details.
app.get('/api/ivx/certification/member-auth-public', async (c) => {
  try {
    const certificate = await getLatestMemberAuthCertification();
    if (!certificate) {
      return c.json({ ok: false, certified: false, certificate: null, secretValuesReturned: false }, 503);
    }
    const checks = certificate.checks;
    return c.json({
      ok: true,
      certified: certificate.certified,
      marker: certificate.marker,
      commit: certificate.commit,
      completedAt: certificate.completedAt,
      checks: {
        runtimeConfig: checks.runtimeConfig.ok,
        ownerLogin: checks.ownerLogin.ok,
        memberRegistration: checks.memberRegistration.ok,
        memberLogin: checks.memberLogin.ok,
        memberPersistence: checks.memberPersistence.ok,
        regularClassification: checks.regularClassification.ok,
        vipClassification: checks.vipClassification.ok,
        cleanup: checks.cleanup.ok,
      },
      secretValuesReturned: false,
    });
  } catch {
    return c.json({ ok: false, certified: false, certificate: null, secretValuesReturned: false }, 503);
  }
});

// Autonomous Voice Escalation routes. Status/test are owner-only. LaML and
// provider callback use a short-lived trace signature and never expose secrets.
app.options('/api/ivx/autonomous/voice', () => autonomousVoiceOptions());
app.get('/api/ivx/autonomous/voice', async (c) => handleAutonomousVoiceStatus(c.req.raw));
app.options('/api/ivx/autonomous/voice/test', () => autonomousVoiceOptions());
app.post('/api/ivx/autonomous/voice/test', async (c) => handleAutonomousVoiceTest(c.req.raw));
app.all('/api/ivx/autonomous/voice/laml', async (c) => handleAutonomousVoiceLaml(c.req.raw));
app.all('/api/ivx/autonomous/voice/status', async (c) => handleAutonomousVoiceCallback(c.req.raw));

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
console.log('[IVX Server] Autonomous owner communications initialized', {
  configured: smsStatus.phoneConfigured,
  destination: smsStatus.phoneMasked,
  schedulerRunning: smsStatus.schedulerRunning,
  smsDailyCap: smsStatus.smsDailyCap,
  voiceConfigured: smsStatus.voice.configured,
  voiceDailyCap: smsStatus.voice.dailyCap,
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

const productionFetch: typeof app.fetch = async (request, env, executionCtx) => {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').trim().toLowerCase();
  if (
    request.method === 'GET'
    && url.pathname === '/api/ivx/video-platform/feed'
    && (type === 'reel' || type === 'reels')
  ) {
    return handleCanonicalReelsFeed(request);
  }
  return app.fetch(request, env, executionCtx);
};

serve(
  { fetch: productionFetch, port: PORT, hostname: HOST },
  (info) => {
    console.log('[IVX Server] Hono API server online', { host: HOST, port: info.port, family: info.family });
  },
);
