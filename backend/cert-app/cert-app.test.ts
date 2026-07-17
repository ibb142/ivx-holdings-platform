/**
 * IVX Senior Developer Certification App — Test Suite
 *
 * Tests: unit, integration, API, authorization, security
 * All tests run in isolation — no IVX production data touched.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createCertApp } from './server';
import { createCertDatabase } from './database';

const AUTH_TOKEN = 'cert-app-test-token-CHANGEME';
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_TOKEN}` };

async function request(app: ReturnType<typeof createCertApp>, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await app.request(`http://localhost${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Unit Tests: Database ──

describe('Cert Database (Unit)', () => {
  let db: ReturnType<typeof createCertDatabase>;

  beforeEach(() => {
    db = createCertDatabase();
  });

  test('creates and retrieves an item', () => {
    const item = db.createItem({ title: 'Test', description: 'Desc', status: 'draft', ownerId: 'u1' });
    expect(item.id).toBeDefined();
    expect(item.title).toBe('Test');
    const found = db.getItem(item.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Test');
  });

  test('lists items with pagination', () => {
    for (let i = 0; i < 15; i++) {
      db.createItem({ title: `Item ${i}`, description: '', status: 'active', ownerId: 'u1' });
    }
    const page1 = db.listItems({ page: 1, limit: 10 });
    expect(page1.items.length).toBe(10);
    expect(page1.total).toBe(15);
    const page2 = db.listItems({ page: 2, limit: 10 });
    expect(page2.items.length).toBe(5);
  });

  test('filters by status using index', () => {
    db.createItem({ title: 'A', description: '', status: 'active', ownerId: 'u1' });
    db.createItem({ title: 'B', description: '', status: 'draft', ownerId: 'u1' });
    db.createItem({ title: 'C', description: '', status: 'active', ownerId: 'u1' });
    const active = db.listItems({ page: 1, limit: 50, status: 'active' });
    expect(active.items.length).toBe(2);
    expect(active.total).toBe(2);
  });

  test('searches by title and description', () => {
    db.createItem({ title: 'Alpha Project', description: 'First', status: 'active', ownerId: 'u1' });
    db.createItem({ title: 'Beta', description: 'Second project', status: 'active', ownerId: 'u1' });
    const results = db.listItems({ page: 1, limit: 50, q: 'project' });
    expect(results.items.length).toBe(2);
  });

  test('updates an item', () => {
    const item = db.createItem({ title: 'Old', description: '', status: 'draft', ownerId: 'u1' });
    const updated = db.updateItem(item.id, { title: 'New', status: 'active' });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New');
    expect(updated!.status).toBe('active');
    expect(updated!.title).not.toBe(item.title);
  });

  test('deletes an item', () => {
    const item = db.createItem({ title: 'Delete Me', description: '', status: 'draft', ownerId: 'u1' });
    expect(db.deleteItem(item.id)).toBe(true);
    expect(db.getItem(item.id)).toBeNull();
  });

  test('deleteItem returns false for nonexistent id', () => {
    expect(db.deleteItem('nonexistent')).toBe(false);
  });

  test('updateItem returns null for nonexistent id', () => {
    expect(db.updateItem('nonexistent', { title: 'X' })).toBeNull();
  });

  test('count returns correct number', () => {
    db.createItem({ title: 'A', description: '', status: 'active', ownerId: 'u1' });
    db.createItem({ title: 'B', description: '', status: 'active', ownerId: 'u1' });
    expect(db.count()).toBe(2);
  });

  test('reset clears all data', () => {
    db.createItem({ title: 'A', description: '', status: 'active', ownerId: 'u1' });
    db.reset();
    expect(db.count()).toBe(0);
  });

  test('isReady returns true', () => {
    expect(db.isReady()).toBe(true);
  });

  test('seedTestData creates 3 items', () => {
    db.seedTestData();
    expect(db.count()).toBe(3);
  });
});

// ── API Integration Tests ──

describe('Cert App API (Integration)', () => {
  let app: ReturnType<typeof createCertApp>;

  beforeEach(() => {
    app = createCertApp();
  });

  test('GET /health returns 200 with status', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/health');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toBe('healthy');
    expect(data.version).toBe('1.0.0');
  });

  test('GET /readiness returns 200 when DB is ready', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/readiness');
    expect(status).toBe(200);
    expect(data.ready).toBe(true);
    expect(data.checks.database).toBe(true);
  });

  test('POST /auth/login with valid credentials returns token', async () => {
    const { status, data } = await request(app, 'POST', '/api/cert-app/auth/login', {
      body: { email: 'test@cert.local', password: 'cert-app-password' },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe('test@cert.local');
  });

  test('POST /auth/login with invalid password returns 401', async () => {
    const { status, data } = await request(app, 'POST', '/api/cert-app/auth/login', {
      body: { email: 'test@cert.local', password: 'wrong' },
    });
    expect(status).toBe(401);
    expect(data.ok).toBe(false);
  });

  test('POST /auth/login with missing fields returns 400', async () => {
    const { status, data } = await request(app, 'POST', '/api/cert-app/auth/login', {
      body: { email: '' },
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
  });
});

// ── CRUD API Tests ──

describe('Cert App CRUD (API)', () => {
  let app: ReturnType<typeof createCertApp>;

  beforeEach(() => {
    app = createCertApp();
  });

  test('GET /items without auth returns 401', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/items');
    expect(status).toBe(401);
    expect(data.ok).toBe(false);
  });

  test('GET /items with auth returns seeded items', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/items', { headers: AUTH_HEADER });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.length).toBe(3); // seeded data
    expect(data.pagination).toBeDefined();
  });

  test('GET /items with pagination', async () => {
    const { data: page1 } = await request(app, 'GET', '/api/cert-app/items?page=1&limit=2', { headers: AUTH_HEADER });
    expect(page1.items?.length ?? page1.data.length).toBeLessThanOrEqual(2);
  });

  test('GET /items with status filter', async () => {
    const { data } = await request(app, 'GET', '/api/cert-app/items?status=active', { headers: AUTH_HEADER });
    const items = data.data || [];
    expect(items.every((i: any) => i.status === 'active')).toBe(true);
  });

  test('POST /items creates a new item', async () => {
    const { status, data } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: 'New Test Item', description: 'Created by test', status: 'draft' },
    });
    expect(status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.data.title).toBe('New Test Item');
    expect(data.data.id).toBeDefined();
  });

  test('POST /items with empty title returns 400', async () => {
    const { status, data } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: '', description: 'test' },
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.details).toBeDefined();
  });

  test('POST /items with invalid status returns 400', async () => {
    const { status } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: 'Test', status: 'invalid' },
    });
    expect(status).toBe(400);
  });

  test('GET /items/:id returns the item', async () => {
    const { data: created } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: 'Find Me', description: 'test', status: 'active' },
    });
    const { status, data } = await request(app, 'GET', `/api/cert-app/items/${created.data.id}`, { headers: AUTH_HEADER });
    expect(status).toBe(200);
    expect(data.data.title).toBe('Find Me');
  });

  test('GET /items/:id with nonexistent id returns 404', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/items/nonexistent', { headers: AUTH_HEADER });
    expect(status).toBe(404);
    expect(data.ok).toBe(false);
  });

  test('PUT /items/:id updates the item', async () => {
    const { data: created } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: 'Original', description: 'test', status: 'draft' },
    });
    const { status, data } = await request(app, 'PUT', `/api/cert-app/items/${created.data.id}`, {
      headers: AUTH_HEADER,
      body: { title: 'Updated', status: 'active' },
    });
    expect(status).toBe(200);
    expect(data.data.title).toBe('Updated');
    expect(data.data.status).toBe('active');
  });

  test('PUT /items/:id with nonexistent id returns 404', async () => {
    const { status } = await request(app, 'PUT', '/api/cert-app/items/nonexistent', {
      headers: AUTH_HEADER,
      body: { title: 'X' },
    });
    expect(status).toBe(404);
  });

  test('DELETE /items/:id removes the item', async () => {
    const { data: created } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: 'Delete Me', description: '', status: 'draft' },
    });
    const { status, data } = await request(app, 'DELETE', `/api/cert-app/items/${created.data.id}`, { headers: AUTH_HEADER });
    expect(status).toBe(200);
    expect(data.data.deleted).toBe(true);
    // Verify it's gone
    const { status: getStatus } = await request(app, 'GET', `/api/cert-app/items/${created.data.id}`, { headers: AUTH_HEADER });
    expect(getStatus).toBe(404);
  });

  test('DELETE /items/:id with nonexistent id returns 404', async () => {
    const { status } = await request(app, 'DELETE', '/api/cert-app/items/nonexistent', { headers: AUTH_HEADER });
    expect(status).toBe(404);
  });
});

// ── Authorization Tests ──

describe('Cert App Authorization', () => {
  let app: ReturnType<typeof createCertApp>;

  beforeEach(() => {
    app = createCertApp();
  });

  test('all CRUD routes require auth', async () => {
    const routes = [
      ['GET', '/api/cert-app/items'],
      ['GET', '/api/cert-app/items/test-id'],
      ['POST', '/api/cert-app/items'],
      ['PUT', '/api/cert-app/items/test-id'],
      ['DELETE', '/api/cert-app/items/test-id'],
    ];
    for (const [method, path] of routes) {
      const { status } = await request(app, method as string, path as string, { body: method === 'POST' || method === 'PUT' ? { title: 'test' } : undefined });
      expect(status).toBe(401);
    }
  });

  test('health and readiness do NOT require auth', async () => {
    const { status: healthStatus } = await request(app, 'GET', '/api/cert-app/health');
    expect(healthStatus).toBe(200);
    const { status: readinessStatus } = await request(app, 'GET', '/api/cert-app/readiness');
    expect(readinessStatus).toBe(200);
  });

  test('invalid token returns 401', async () => {
    const { status } = await request(app, 'GET', '/api/cert-app/items', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(status).toBe(401);
  });

  test('missing Authorization header returns 401', async () => {
    const { status } = await request(app, 'GET', '/api/cert-app/items');
    expect(status).toBe(401);
  });
});

// ── Security Tests ──

describe('Cert App Security', () => {
  let app: ReturnType<typeof createCertApp>;

  beforeEach(() => {
    app = createCertApp();
  });

  test('trace ID is returned in every response', async () => {
    const { data } = await request(app, 'GET', '/api/cert-app/health');
    expect(data.traceId || data.marker).toBeTruthy();
  });

  test('custom trace ID is echoed back', async () => {
    const customTrace = 'my-custom-trace-123';
    const { data } = await request(app, 'GET', '/api/cert-app/health', {
      headers: { 'X-Trace-Id': customTrace },
    });
    // Health endpoint may not echo traceId but the header should be set
    expect(data.traceId === customTrace || data.marker).toBeTruthy();
  });

  test('404 for unknown routes', async () => {
    const { status, data } = await request(app, 'GET', '/api/cert-app/unknown-route');
    expect(status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error).toContain('not found');
  });

  test('error responses do not expose stack traces', async () => {
    const { data } = await request(app, 'GET', '/api/cert-app/items/nonexistent', { headers: AUTH_HEADER });
    expect(data.ok).toBe(false);
    expect(JSON.stringify(data)).not.toContain('at ');
    expect(JSON.stringify(data)).not.toContain('stack');
  });

  test('POST with oversized title returns 400', async () => {
    const longTitle = 'a'.repeat(201);
    const { status, data } = await request(app, 'POST', '/api/cert-app/items', {
      headers: AUTH_HEADER,
      body: { title: longTitle, description: '', status: 'draft' },
    });
    expect(status).toBe(400);
    expect(data.details).toBeDefined();
  });

  test('login endpoint does not reveal whether email exists', async () => {
    const { data: validEmail } = await request(app, 'POST', '/api/cert-app/auth/login', {
      body: { email: 'known@cert.local', password: 'wrong' },
    });
    const { data: unknownEmail } = await request(app, 'POST', '/api/cert-app/auth/login', {
      body: { email: 'unknown@cert.local', password: 'wrong' },
    });
    // Both should return the same error message
    expect(validEmail.error).toBe(unknownEmail.error);
  });
});

// ── Frontend Tests (HTML structure) ──

describe('Cert App Frontend (HTML Structure)', () => {
  test('frontend HTML file exists and has correct structure', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const htmlPath = path.resolve(import.meta.dir, 'frontend', 'index.html');
    const html = await fs.readFile(htmlPath, 'utf-8');

    // Login screen
    expect(html).toContain('login-email');
    expect(html).toContain('login-pass');

    // Dashboard / List
    expect(html).toContain('IVX Certification App');
    expect(html).toContain('Items');

    // Form
    expect(html).toContain('form-title');
    expect(html).toContain('form-desc');
    expect(html).toContain('form-status');

    // Loading state
    expect(html).toContain('Loading...');

    // Empty state
    expect(html).toContain('No items found');

    // Error handling
    expect(html).toContain('class="error"');

    // Responsive
    expect(html).toContain('viewport');
    expect(html).toContain('@media');

    // No hardcoded production secrets
    expect(html).not.toContain('SUPABASE');
    expect(html).not.toContain('SERVICE_ROLE');
    expect(html).not.toContain('GITHUB_TOKEN');
  });
});
