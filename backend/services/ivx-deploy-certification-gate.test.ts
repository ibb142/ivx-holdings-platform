/**
 * Tests for the IVX Deploy Certification Gate.
 *
 * Verifies the gate engine produces a real 16-module report with honest
 * PASS/FAIL/WARN verdicts, the ledger persists reports, and the aggregate
 * verdict logic is correct.
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  runDeployCertificationGate,
  getLatestCertificationReport,
  getRecentCertificationReports,
  CERTIFICATION_GATE_MARKER,
  type CertificationReport,
} from './ivx-deploy-certification-gate';

// Mock external fetch calls so the test doesn't hit the network
const originalFetch = globalThis.fetch;

function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const u = url.toLowerCase();
  if (u.includes('/health') && !u.includes('enterprise')) {
    const res = new Response(JSON.stringify({ commit: 'abc123def456', status: 'healthy' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('api.github.com')) {
    const res = new Response(JSON.stringify({ sha: 'abc123def456789abc', commit: { message: 'test' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/owner-passwordless-login')) {
    const res = new Response(JSON.stringify({ accessToken: 'mock-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/worker/jobs') && init?.headers && (init.headers as Record<string,string>)['Authorization']) {
    const res = new Response(JSON.stringify({ ok: true, jobs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/worker/jobs')) {
    const res = new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/owner-ai') && init?.headers && (init.headers as Record<string,string>)['Authorization']) {
    const res = new Response(JSON.stringify({ ok: true, reply: '4' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/owner-ai')) {
    const res = new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/enterprise/dashboard') || u.includes('/enterprise/security')) {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('/enterprise/health')) {
    const res = new Response(JSON.stringify({ ok: true, marker: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return Promise.resolve(res);
  }
  if (u.includes('ivxholding.com/apk/')) {
    const res = new Response(null, { status: 200, headers: { 'content-length': '82963199' } });
    return Promise.resolve(res);
  }
  if (u === 'https://ivxholding.com/' || u === 'https://ivxholding.com') {
    const res = new Response(null, { status: 200 });
    return Promise.resolve(res);
  }
  // Default: empty 200
  const res = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  return Promise.resolve(res);
}

describe('IVX Deploy Certification Gate', () => {
  test('CERTIFICATION_GATE_MARKER is stable', () => {
    expect(CERTIFICATION_GATE_MARKER).toBe('ivx-deploy-certification-gate-2026-07-21');
  });

  test('runDeployCertificationGate produces a 16-module report', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'manual',
        triggerSource: 'test',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      expect(report.modules.length).toBe(16);
      expect(report.marker).toBe(CERTIFICATION_GATE_MARKER);
      expect(report.reportId).toMatch(/^cert-\d+-/);
      expect(report.triggeredBy).toBe('manual');
      expect(report.startedAt).toBeTruthy();
      expect(report.finishedAt).toBeTruthy();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('every module has an id, name, verdict, checks, and summary', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'manual',
        triggerSource: 'test',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      for (const m of report.modules) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(['PASS', 'FAIL', 'WARN', 'NOT_RUN']).toContain(m.verdict);
        expect(Array.isArray(m.checks)).toBe(true);
        expect(m.summary).toBeTruthy();
        expect(m.durationMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('module IDs match the 16 required enterprise audits', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'manual',
        triggerSource: 'test',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      const expectedIds = [
        'source_code', 'security', 'authentication', 'database', 'api',
        'chat', 'autonomous_developer', 'enterprise_modules', 'mobile_qa',
        'performance', 'regression', 'disaster_recovery', 'production_health',
        'owner_dashboard', 'member_investor', 'monitoring_alerts',
      ];
      const actualIds = report.modules.map((m) => m.id);
      expect(actualIds.sort()).toEqual(expectedIds.sort());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('counts (pass+fail+warn+notRun) equal 16', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'manual',
        triggerSource: 'test',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      expect(report.passCount + report.failCount + report.warnCount + report.notRunCount).toBe(16);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('certifiable is true when failCount is 0', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'manual',
        triggerSource: 'test',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      expect(report.certifiable).toBe(report.failCount === 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ledger persists reports and getLatestCertificationReport returns the most recent', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const r1 = await runDeployCertificationGate({ triggeredBy: 'manual', triggerSource: 'test1', apiBase: 'https://api.ivxholding.com', ownerToken: 'mock-token' });
      const r2 = await runDeployCertificationGate({ triggeredBy: 'manual', triggerSource: 'test2', apiBase: 'https://api.ivxholding.com', ownerToken: 'mock-token' });
      const latest = getLatestCertificationReport();
      expect(latest).not.toBeNull();
      expect(latest?.reportId).toBe(r2.reportId);
      const recent = getRecentCertificationReports(5);
      expect(recent.length).toBeGreaterThanOrEqual(2);
      expect(recent[0].reportId).toBe(r2.reportId);
      expect(recent[1].reportId).toBe(r1.reportId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('post_deploy trigger type is supported', async () => {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    try {
      const report = await runDeployCertificationGate({
        triggeredBy: 'post_deploy',
        triggerSource: 'render_trigger_deploy',
        deployId: 'dep-123',
        apiBase: 'https://api.ivxholding.com',
        ownerToken: 'mock-token',
      });
      expect(report.triggeredBy).toBe('post_deploy');
      expect(report.deployId).toBe('dep-123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
