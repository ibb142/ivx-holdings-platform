/**
 * IVX Senior Developer Certification App — Isolated Backend
 *
 * Completely isolated from IVX production. Uses in-memory SQLite.
 * No access to Supabase, no production credentials, no business data.
 */
import { Hono } from 'hono';
import { createCertDatabase, type CertDB } from './database';

export const CERT_APP_VERSION = '1.0.0';
export const CERT_APP_MARKER = 'ivx-cert-app-2026-07-17';

const CERT_AUTH_TOKEN = 'cert-app-test-token-CHANGEME';

type CertUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
};

type CertItem = {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

type CertContext = {
  Variables: {
    user: CertUser | null;
    traceId: string;
  };
};

function generateId(): string {
  return `cert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTraceId(): string {
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rateLimitStore(): Map<string, { count: number; resetAt: number }> {
  return (globalThis as Record<string, unknown>)._certRateLimit as Map<string, { count: number; resetAt: number }> ?? new Map();
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const store = rateLimitStore();
  const now = Date.now();
  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    store.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt };
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
}

function authMiddleware(c: any, next: any): Promise<any> {
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== CERT_AUTH_TOKEN) {
    return c.json({
      ok: false,
      error: 'Unauthorized: invalid or missing bearer token.',
      traceId: c.get('traceId'),
      timestamp: new Date().toISOString(),
    }, 401);
  }
  const user: CertUser = {
    id: 'cert-user-001',
    email: 'cert@ivx-cert.local',
    name: 'Certification User',
    createdAt: '2026-07-17T00:00:00Z',
  };
  c.set('user', user);
  return next();
}

export function createCertApp(): Hono<CertContext> {
  const app = new Hono<CertContext>();
  const db: CertDB = createCertDatabase();

  // Seed data for isolated QA
  db.seedTestData();

  // Trace ID middleware
  app.use('*', async (c, next) => {
    const traceId = c.req.header('X-Trace-Id') ?? generateTraceId();
    c.set('traceId', traceId);
    c.header('X-Trace-Id', traceId);
    return next();
  });

  // Rate limiting
  app.use('/api/*', async (c, next) => {
    const ip = c.req.header('X-Forwarded-For') ?? 'unknown';
    const rl = checkRateLimit(ip);
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    c.header('X-RateLimit-Reset', String(rl.resetAt));
    if (!rl.allowed) {
      return c.json({
        ok: false,
        error: 'Rate limit exceeded. Try again later.',
        traceId: c.get('traceId'),
        retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
      }, 429);
    }
    return next();
  });

  // ── Health & Readiness ──

  app.get('/api/cert-app/health', (c) => {
    return c.json({
      ok: true,
      status: 'healthy',
      service: 'ivx-cert-app',
      version: CERT_APP_VERSION,
      marker: CERT_APP_MARKER,
      commit: process.env.CERT_APP_COMMIT ?? 'local',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/cert-app/readiness', (c) => {
    const dbOk = db.isReady();
    return c.json({
      ok: dbOk,
      ready: dbOk,
      status: dbOk ? 'ready' : 'not_ready',
      service: 'ivx-cert-app',
      version: CERT_APP_VERSION,
      checks: {
        database: dbOk,
        memory: true,
      },
      traceId: c.get('traceId'),
      timestamp: new Date().toISOString(),
    }, dbOk ? 200 : 503);
  });

  // ── Auth ──

  app.post('/api/cert-app/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { email, password } = body as Record<string, string>;

    if (!email || !password) {
      return c.json({
        ok: false,
        error: 'Email and password are required.',
        traceId: c.get('traceId'),
      }, 400);
    }

    // Isolated cert auth — accepts any email with the cert password
    if (password !== 'cert-app-password') {
      return c.json({
        ok: false,
        error: 'Invalid credentials.',
        traceId: c.get('traceId'),
      }, 401);
    }

    return c.json({
      ok: true,
      token: CERT_AUTH_TOKEN,
      user: {
        id: 'cert-user-001',
        email,
        name: 'Certification User',
        createdAt: '2026-07-17T00:00:00Z',
      },
      traceId: c.get('traceId'),
    });
  });

  // ── Authenticated CRUD ──

  app.get('/api/cert-app/items', authMiddleware, (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '10', 10)));
    const status = c.req.query('status') ?? undefined;
    const q = c.req.query('q') ?? undefined;

    const result = db.listItems({ page, limit, status, q });
    return c.json({
      ok: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      traceId: c.get('traceId'),
    });
  });

  app.get('/api/cert-app/items/:id', authMiddleware, (c) => {
    const id = c.req.param('id');
    const item = db.getItem(id);
    if (!item) {
      return c.json({
        ok: false,
        error: `Item ${id} not found.`,
        traceId: c.get('traceId'),
      }, 404);
    }
    return c.json({
      ok: true,
      data: item,
      traceId: c.get('traceId'),
    });
  });

  app.post('/api/cert-app/items', authMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { title, description, status } = body as Record<string, string>;

    // Validation
    const errors: string[] = [];
    if (!title || title.trim().length === 0) errors.push('Title is required.');
    if (title && title.length > 200) errors.push('Title must be 200 characters or less.');
    if (status && !['draft', 'active', 'archived'].includes(status)) {
      errors.push('Status must be draft, active, or archived.');
    }
    if (errors.length > 0) {
      return c.json({
        ok: false,
        error: 'Validation failed.',
        details: errors,
        traceId: c.get('traceId'),
      }, 400);
    }

    const user = c.get('user') as CertUser;
    const item = db.createItem({
      title: title.trim(),
      description: (description ?? '').trim(),
      status: (status as 'draft' | 'active' | 'archived') ?? 'draft',
      ownerId: user.id,
    });

    return c.json({
      ok: true,
      data: item,
      traceId: c.get('traceId'),
    }, 201);
  });

  app.put('/api/cert-app/items/:id', authMiddleware, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { title, description, status } = body as Record<string, string>;

    const errors: string[] = [];
    if (title !== undefined && title.trim().length === 0) errors.push('Title cannot be empty.');
    if (title && title.length > 200) errors.push('Title must be 200 characters or less.');
    if (status && !['draft', 'active', 'archived'].includes(status)) {
      errors.push('Status must be draft, active, or archived.');
    }
    if (errors.length > 0) {
      return c.json({
        ok: false,
        error: 'Validation failed.',
        details: errors,
        traceId: c.get('traceId'),
      }, 400);
    }

    const existing = db.getItem(id);
    if (!existing) {
      return c.json({
        ok: false,
        error: `Item ${id} not found.`,
        traceId: c.get('traceId'),
      }, 404);
    }

    const updated = db.updateItem(id, {
      title: title?.trim(),
      description: description?.trim(),
      status: status as 'draft' | 'active' | 'archived' | undefined,
    });

    return c.json({
      ok: true,
      data: updated,
      traceId: c.get('traceId'),
    });
  });

  app.delete('/api/cert-app/items/:id', authMiddleware, (c) => {
    const id = c.req.param('id');
    const deleted = db.deleteItem(id);
    if (!deleted) {
      return c.json({
        ok: false,
        error: `Item ${id} not found.`,
        traceId: c.get('traceId'),
      }, 404);
    }
    return c.json({
      ok: true,
      data: { id, deleted: true },
      traceId: c.get('traceId'),
    });
  });

  // ── Error handling ──

  app.notFound((c) => {
    return c.json({
      ok: false,
      error: `Route not found: ${c.req.method} ${c.req.path}`,
      traceId: c.get('traceId'),
      timestamp: new Date().toISOString(),
    }, 404);
  });

  app.onError((err, c) => {
    console.error(`[cert-app] error: ${err.message}`, { traceId: c.get('traceId') });
    return c.json({
      ok: false,
      error: 'Internal server error.',
      detail: err.message.slice(0, 200),
      traceId: c.get('traceId'),
      timestamp: new Date().toISOString(),
    }, 500);
  });

  return app;
}
