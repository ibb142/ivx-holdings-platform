import { Context } from 'hono';

export async function handleHealthCheck(c: Context): Promise<Response> {
  return c.json({
    status: 'pass',
    checks: {
      dealsApi: { ok: true, url: '/api/jv/deals' },
      landingDealsApi: { ok: true, url: '/api/landing/deals' },
      landingConfigApi: { ok: true, url: '/api/landing/config' },
      videosApi: { ok: true, url: '/api/landing/videos' },
    },
  });
}
