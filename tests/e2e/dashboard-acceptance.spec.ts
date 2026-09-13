import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { parseLiveFleetPayload } from '../../expo/shared/ivx/live-fleet-dashboard';

const apiBase = process.env.IVX_DASHBOARD_API_BASE ?? 'https://api.ivxholding.com';
const endpoint = new URL('/api/ivx/live-work/agents?enterpriseDashboard=1&view=live', apiBase).href;

async function deployedSha(request: APIRequestContext) {
  const response = await request.get(new URL('/version', apiBase).href, { timeout: 15_000, maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const version = await response.json();
  expect(version.ok).toBe(true);
  expect(version.commit).toMatch(/^[a-f0-9]{40}$/);
  return version.commit as string;
}

test('API rejects an anonymous dashboard read', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext();
  try {
    const response = await anonymous.get(endpoint, { timeout: 15_000, maxRedirects: 0 });
    expect([401, 403]).toContain(response.status());
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.dashboard).toBeUndefined();
  } finally { await anonymous.dispose(); }
});

test('API serves six simultaneous owner observations with complete identities on the deployed SHA', async ({ request }) => {
  const token = process.env.IVX_OWNER_TOKEN?.trim();
  expect(token, 'IVX_OWNER_TOKEN is required; missing authentication is not a passing test.').toBeTruthy();
  const sha = await deployedSha(request);
  const observations = await Promise.all(Array.from({ length: 6 }, async () => {
    const startedAt = Date.now();
    const response = await request.get(endpoint, { headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000, maxRedirects: 0 }).catch(() => { throw new Error('OWNER_TELEMETRY_HTTP_REQUEST_FAILED'); });
    expect(response.status()).toBe(200);
    const payload = parseLiveFleetPayload(await response.json());
    expect(payload.dashboard.fleetSignals.commitSha).toBe(sha);
    return { observedAt: payload.dashboard.generatedAt, durationMs: Date.now() - startedAt };
  }));
  expect(observations).toHaveLength(6);
  expect(await deployedSha(request)).toBe(sha);
});

function uiUrl() {
  expect(process.env.IVX_OWNER_STORAGE_STATE, 'Provide an existing authenticated owner browser state.').toBeTruthy();
  expect(process.env.IVX_DASHBOARD_WEB_BASE, 'Provide the Expo web app origin, not the API or public landing origin.').toBeTruthy();
  return new URL('/ivx/landing-workers-live', process.env.IVX_DASHBOARD_WEB_BASE!).href;
}
function isDashboardResponse(url: string) {
  const value = new URL(url), expected = new URL(endpoint);
  return value.origin === expected.origin && value.pathname === expected.pathname && value.searchParams.get('view') === 'live';
}
async function openDashboard(page: Page) {
  const url = uiUrl();
  const [response, navigation] = await Promise.all([
    page.waitForResponse(response => isDashboardResponse(response.url()), { timeout: 20_000 }),
    page.goto(url),
  ]);
  expect(navigation?.ok()).toBe(true);
  return response;
}

test('UI maps the app request to all 112 distinct agent cards', async ({ page }) => {
  const response = await openDashboard(page);
  expect(response.status()).toBe(200);
  const payload = parseLiveFleetPayload(await response.json());
  const grid = page.getByTestId('agent-telemetry-grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('[data-testid^="agent-telemetry-card-"]')).toHaveCount(112);
  const ids = await grid.locator('[data-testid^="agent-telemetry-card-"]').evaluateAll(cards => cards.map(card => card.getAttribute('data-testid')).sort());
  expect(ids).toEqual(payload.dashboard.agents.map(agent => `agent-telemetry-card-${agent.agentNumber}`).sort());
  await expect(page.getByTestId('fleet-telemetry-status')).toHaveCount(0);
});

test('UI shows a controlled outage and removes agent cards when telemetry returns 503', async ({ page }) => {
  await page.route(url => isDashboardResponse(url.href), route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'FLEET_TELEMETRY_UNAVAILABLE', retryable: true }),
  }));
  const response = await openDashboard(page);
  expect(response.status()).toBe(503);
  await expect(page.getByTestId('fleet-telemetry-status')).toContainText('Telemetría no disponible');
  await expect(page.getByTestId('fleet-live-state')).toHaveText('SIN TELEMETRÍA');
  await expect(page.getByTestId('agent-telemetry-grid')).toHaveCount(0);
  await expect(page.locator('[data-testid^="agent-telemetry-card-"]')).toHaveCount(0);
});
