/**
 * IVX Holdings — Production Entry Point
 */
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import app from './backend/hono-extended';
import { handleRealtimeVoiceConnection, getRealtimeVoiceStatus } from './backend/services/ivx-realtime-voice';
import { handleAutonomousDashboardStreamConnection, IVX_AUTONOMOUS_DASHBOARD_STREAM_PATH } from './backend/services/ivx-autonomous-dashboard-stream';
import { startSeniorDevWorker } from './backend/services/ivx-senior-dev-worker';
import { startAutonomousScheduler } from './backend/services/ivx-autonomous-scheduler';
import { startAutonomousIntelligenceMissionScheduler } from './backend/services/ivx-autonomous-intelligence-mission-scheduler';
import { startSmsNotificationScheduler, getSmsNotifierStatus } from './backend/services/ivx-autonomous-sms-notifier';
import { runCompletionCampaignCycle } from './backend/services/ivx-autonomous-completion-campaign';
import { getLatestMemberAuthCertification, startMemberAuthCertificationScheduler } from './backend/services/ivx-member-auth-certification';
import { startAgentHeartbeatLoop } from './backend/services/ivx-agent-persistence';
import { buildHeartbeatRows, resumePendingCertificateRuns } from './backend/services/ivx-real-execution-certificate';
import { preloadAIProviderCredentialFromOwnerVariables } from './backend/services/ivx-ai-owner-variable-preload';
import { mintIVXOutageOwnerSession, verifyIVXOutageOwnerSession } from './backend/services/ivx-outage-owner-session';
import { listAutonomousVoiceCalls, placeAutonomousVoiceCall } from './backend/services/ivx-signalwire-voice';
import { startGitHubActionsExternalSupervisor } from './backend/services/ivx-github-actions-external-supervisor';
import { startAutonomousLiveBootstrap } from './backend/services/ivx-autonomous-live-bootstrap';
import { startAutonomous112RuntimeEnforcer } from './backend/services/ivx-autonomous-runtime-enforcer';
import { getAutonomousTruthSnapshot, applyTruthControl, type TruthControlAction } from './backend/services/ivx-autonomous-truth-control';
import { assertIVXRegisteredOwnerBearer } from './backend/api/owner-only';
import { getIVXOwnerEmailAllowlist } from './expo/shared/ivx/access-control';
import { handleCanonicalReelsFeed } from './backend/api/ivx-canonical-reels-feed';
import { autonomousVoiceOptions, handleAutonomousVoiceCallback, handleAutonomousVoiceLaml, handleAutonomousVoicePublicCertificate, handleAutonomousVoiceStatus, handleAutonomousVoiceTest } from './backend/api/ivx-autonomous-voice';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COMPLETION_CAMPAIGN_INTERVAL_MS = 5 * 60 * 1000;
const OWNER_LOGIN_CERT_MARKER = 'ivx-owner-login-outage-cert-2026-08-15';
const LIVE_VOICE_CERT_TRACE_ID = 'ivx-autonomous-live-voice-cert-20260816-v1';

console.log('[IVX Server] Starting Hono API server...', { host: HOST, port: PORT, nodeEnv: process.env.NODE_ENV || 'development' });
void preloadAIProviderCredentialFromOwnerVariables().catch((error) => console.warn('[IVX Server] AI owner-variable preload unavailable', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' }));

app.get('/api/ivx/certification/owner-login-public', (c) => {
  try {
    const ownerEmail = (getIVXOwnerEmailAllowlist()[0] || '').trim().toLowerCase();
    const session = ownerEmail ? mintIVXOutageOwnerSession(ownerEmail) : null;
    const verified = session ? verifyIVXOutageOwnerSession(session.token) : null;
    const certified = Boolean(session && verified && verified.userId === session.userId && verified.email === ownerEmail && verified.role === 'owner' && verified.expiresAt === session.expiresAt);
    return c.json({ ok: certified, certified, marker: OWNER_LOGIN_CERT_MARKER, mode: 'server_signed_owner_outage_session', supabaseIndependent: true, ownerAllowlistBound: Boolean(ownerEmail), tokenMintVerified: certified, secretValuesReturned: false, commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || '').trim() || null, completedAt: new Date().toISOString() }, certified ? 200 : 503);
  } catch { return c.json({ ok: false, certified: false, marker: OWNER_LOGIN_CERT_MARKER, secretValuesReturned: false }, 503); }
});

app.get('/api/ivx/certification/member-auth-public', async (c) => {
  try {
    const certificate = await getLatestMemberAuthCertification();
    if (!certificate) return c.json({ ok: false, certified: false, certificate: null, secretValuesReturned: false }, 503);
    const checks = certificate.checks;
    return c.json({ ok: true, certified: certificate.certified, marker: certificate.marker, commit: certificate.commit, completedAt: certificate.completedAt, checks: { runtimeConfig: checks.runtimeConfig.ok, ownerLogin: checks.ownerLogin.ok, memberRegistration: checks.memberRegistration.ok, memberLogin: checks.memberLogin.ok, memberPersistence: checks.memberPersistence.ok, regularClassification: checks.regularClassification.ok, vipClassification: checks.vipClassification.ok, cleanup: checks.cleanup.ok }, secretValuesReturned: false });
  } catch { return c.json({ ok: false, certified: false, certificate: null, secretValuesReturned: false }, 503); }
});

app.get('/api/ivx/autonomous/truth', async (c) => c.json(await getAutonomousTruthSnapshot()));
app.post('/api/ivx/autonomous/control', async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const action = String((body as any).action || '') as TruthControlAction;
  const allowed: TruthControlAction[] = ['start_all','stop_all','pause_all','resume_all','pause_agent','resume_agent','disable_agent','enable_agent','retry_agent'];
  if (!allowed.includes(action)) return c.json({ ok: false, error: `action must be one of: ${allowed.join(', ')}` }, 400);
  try {
    const auth = await assertIVXRegisteredOwnerBearer(c.req.raw, `autonomous_control:${action}`);
    const snapshot = await applyTruthControl(action, typeof (body as any).agentId === 'string' ? (body as any).agentId : undefined, typeof (body as any).agentNumber === 'number' ? (body as any).agentNumber : undefined);
    return c.json({ ok: true, action, authorization: auth.approval, snapshot });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status);
  }
});

app.options('/api/ivx/autonomous/voice', () => autonomousVoiceOptions());
app.get('/api/ivx/autonomous/voice', async (c) => handleAutonomousVoiceStatus(c.req.raw));
app.options('/api/ivx/autonomous/voice/test', () => autonomousVoiceOptions());
app.post('/api/ivx/autonomous/voice/test', async (c) => handleAutonomousVoiceTest(c.req.raw));
app.all('/api/ivx/autonomous/voice/laml', async (c) => handleAutonomousVoiceLaml(c.req.raw));
app.all('/api/ivx/autonomous/voice/status', async (c) => handleAutonomousVoiceCallback(c.req.raw));
app.get('/api/ivx/certification/autonomous-voice-public', async (c) => handleAutonomousVoicePublicCertificate(c.req.raw));

startAutonomousScheduler();
startAutonomousIntelligenceMissionScheduler();
startGitHubActionsExternalSupervisor();
startAutonomousLiveBootstrap();
startAutonomous112RuntimeEnforcer();

const runCompletionCycleSafely = async (reason: string): Promise<void> => {
  try { const state = await runCompletionCampaignCycle(4); console.log('[IVX Completion Campaign]', { reason, phase: state.phase, verifiedAgents: state.totals.verifiedAgents }); }
  catch (error) { console.error('[IVX Completion Campaign] cycle failed', { reason, error: error instanceof Error ? error.message : String(error) }); }
};
const campaignBootKick = setTimeout(() => { void runCompletionCycleSafely('boot'); }, 20_000); campaignBootKick.unref?.();
const campaignTimer = setInterval(() => { void runCompletionCycleSafely('interval'); }, COMPLETION_CAMPAIGN_INTERVAL_MS); campaignTimer.unref?.();

startAgentHeartbeatLoop(buildHeartbeatRows);
const certResumeKick = setTimeout(() => { void resumePendingCertificateRuns().then((r) => { if (r.resumed > 0) console.log('[IVX Server] Real-execution tasks resumed after restart', r); }).catch((error) => console.warn('[IVX Server] Real-execution resume failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' })); }, 25_000); certResumeKick.unref?.();

startSmsNotificationScheduler();
const smsStatus = getSmsNotifierStatus();
console.log('[IVX Server] Autonomous owner communications initialized', { configured: smsStatus.phoneConfigured, destination: smsStatus.phoneMasked, schedulerRunning: smsStatus.schedulerRunning, smsDailyCap: smsStatus.smsDailyCap, voiceConfigured: smsStatus.voice.configured, voiceDailyCap: smsStatus.voice.dailyCap });

const liveVoiceCertKick = setTimeout(() => { void (async () => {
  try {
    const existing = (await listAutonomousVoiceCalls(200)).find((row) => row.traceId === LIVE_VOICE_CERT_TRACE_ID && row.requestStatus === 'queued' && Boolean(row.callSid));
    if (existing) return;
    await placeAutonomousVoiceCall({ traceId: LIVE_VOICE_CERT_TRACE_ID, message: 'Hello. This is IVX Autonomous. This is our live end to end voice certification call.' });
  } catch (error) { console.warn('[IVX Voice Cert] Call attempt failed', { traceId: LIVE_VOICE_CERT_TRACE_ID, error: error instanceof Error ? error.message.slice(0, 180) : 'unknown' }); }
})(); }, 60_000); liveVoiceCertKick.unref?.();

startMemberAuthCertificationScheduler();
if (process.env.IVX_SENIOR_DEV_WORKER_ENABLED === 'true') startSeniorDevWorker().catch((error) => console.error('[IVX Server] Senior dev worker failed to start', { error: error instanceof Error ? error.message : String(error) }));

const productionFetch: typeof app.fetch = async (request, env, executionCtx) => {
  const url = new URL(request.url); const type = (url.searchParams.get('type') || '').trim().toLowerCase();
  if (request.method === 'GET' && url.pathname === '/api/ivx/video-platform/feed' && (type === 'reel' || type === 'reels')) {
    const canonical = await handleCanonicalReelsFeed(request);
    try { const payload = await canonical.clone().json() as { count?: number; total?: number; videos?: unknown[] }; const reelCount = Array.isArray(payload.videos) ? payload.videos.length : (payload.count ?? payload.total ?? 0); if (reelCount > 0) return canonical; } catch {}
    return app.fetch(request, env, executionCtx);
  }
  return app.fetch(request, env, executionCtx);
};

app.get('/api/ivx/realtime-voice/status', (c) => c.json(getRealtimeVoiceStatus()));
app.options('/api/ivx/realtime-voice/status', (c) => c.body(null, 204));

const voiceWss = new WebSocketServer({ noServer: true });
voiceWss.on('connection', (ws, request) => { void handleRealtimeVoiceConnection(ws as any, request); });
const dashboardWss = new WebSocketServer({ noServer: true });
dashboardWss.on('connection', (ws, request) => { void handleAutonomousDashboardStreamConnection(ws as any, request); });

const httpServer = serve({ fetch: productionFetch, port: PORT, hostname: HOST }, (info) => console.log('[IVX Server] Hono API server online', { host: HOST, port: info.port, family: info.family }));
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/ivx/realtime-voice') {
    voiceWss.handleUpgrade(request, socket, head, (ws) => { voiceWss.emit('connection', ws, request); });
    return;
  }
  if (url.pathname === IVX_AUTONOMOUS_DASHBOARD_STREAM_PATH) {
    dashboardWss.handleUpgrade(request, socket, head, (ws) => { dashboardWss.emit('connection', ws, request); });
    return;
  }
  socket.destroy();
});
console.log('[IVX Server] Realtime Voice WebSocket endpoint: ws://.../api/ivx/realtime-voice');
console.log('[IVX Server] Autonomous Dashboard WebSocket endpoint:', IVX_AUTONOMOUS_DASHBOARD_STREAM_PATH);
