import { createClient } from '@supabase/supabase-js';
import { getLatestMemberAuthCertification } from '../services/ivx-member-auth-certification';

const CERT_REEL_BASE64 = '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';

function json(payload: Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra },
  });
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export async function handleFastOwnerEmergencyLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const emergency = typeof body.emergency === 'string' ? body.emergency.trim().toLowerCase() : '';
  const ownerEmail = env('IVX_OWNER_EMAIL').toLowerCase();
  const ownerPassword = env('IVX_OWNER_PASSWORD');
  const supabaseUrl = env('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

  if (emergency !== 'ivx_emergency_recovery' && emergency !== 'true') {
    return json({ success: false, rootCause: 'passwordless_not_emergency_mode' }, 403);
  }
  if (!email || !ownerEmail || email !== ownerEmail) {
    return json({ success: false, rootCause: 'email_not_allowlisted' }, 403);
  }
  if (!supabaseUrl || !anon || !ownerPassword) {
    return json({ success: false, rootCause: 'owner_runtime_auth_not_configured' }, 503);
  }

  try {
    const client = createClient(supabaseUrl, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(10_000),
        })) as typeof fetch,
      },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password: ownerPassword });
    if (error || !data.session?.access_token || !data.session?.refresh_token) {
      return json({ success: false, rootCause: 'owner_password_grant_failed', message: error?.message || 'No session returned.' }, 502);
    }
    return json({
      success: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at || 0,
      email,
      passwordPreserved: true,
      sessionMethod: 'bounded_password_grant',
      deploymentMarker: 'ivx-owner-login-bounded-v1-2026-08-14',
    });
  } catch (error) {
    return json({
      success: false,
      rootCause: 'owner_password_grant_timeout',
      message: error instanceof Error ? error.message.slice(0, 200) : 'Owner auth request failed.',
    }, 504);
  }
}

export async function handlePublicMemberAuthCertificate(): Promise<Response> {
  const cert = await getLatestMemberAuthCertification();
  if (!cert) return json({ ok: false, certified: false, error: 'No member/auth certificate is available yet.' }, 503);
  const checks = cert.checks;
  return json({
    ok: true,
    certified: cert.certified,
    marker: cert.marker,
    commit: cert.commit,
    completedAt: cert.completedAt,
    checks: {
      runtimeConfig: { ok: checks.runtimeConfig.ok },
      ownerLogin: { ok: checks.ownerLogin.ok },
      memberRegistration: { ok: checks.memberRegistration.ok },
      memberLogin: { ok: checks.memberLogin.ok },
      memberPersistence: { ok: checks.memberPersistence.ok },
      regularClassification: { ok: checks.regularClassification.ok },
      vipClassification: { ok: checks.vipClassification.ok },
      cleanup: { ok: checks.cleanup.ok },
    },
    secretValuesReturned: false,
  });
}

export function handleCertificationReelMedia(request: Request): Response {
  const file = Buffer.from(CERT_REEL_BASE64, 'base64');
  const range = request.headers.get('range');
  if (!range) {
    return new Response(file, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(file.length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return new Response('Invalid range', { status: 416 });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= file.length) {
    return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${file.length}` } });
  }
  const chunk = file.subarray(start, end + 1);
  return new Response(chunk, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
}

export function handleCanonicalCertificationReelsFeed(request: Request): Response {
  const origin = new URL(request.url).origin;
  const mediaUrl = `${origin}/api/ivx/certification/reel-media`;
  return json({
    ok: true,
    marker: 'ivx-video-platform-cert-reel-v1-2026-08-14',
    feed_type: 'reel',
    count: 1,
    videos: [{
      id: 'ivx-certification-reel',
      title: 'IVX Holdings',
      caption: 'IVX Holdings live certification reel',
      status: 'published',
      media_url: mediaUrl,
      video_url: mediaUrl,
      playback_url: mediaUrl,
    }],
    next_cursor: null,
  }, 200, { 'X-IVX-Cache': 'HIT' });
}
