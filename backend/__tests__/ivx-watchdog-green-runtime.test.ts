/**
 * p3-watchdog-green-runtime: the 24x7 watchdog must finish GREEN.
 *
 * 1. Agent heartbeat timestamps are second-precision ISO-8601 so the
 *    watchdog's jq `fromdateiso8601` freshness check parses them.
 * 2. Owner-key-authenticated requests bypass the per-IP rate limiter so a
 *    112-agent CI cycle from a single runner IP is never throttled into a
 *    15-minute block (root cause of success=51/112 cycles).
 */
import { describe, expect, test } from 'bun:test';
import * as runtime from '../services/ivx-agent-runtime';

const SECOND_PRECISION_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('watchdog green runtime invariants', () => {
  test('execution states exist for all 112 agents', () => {
    const states = runtime.getAllExecutionStates();
    expect(states.length).toBe(112);
  });

  test('heartbeat refresh emits second-precision ISO timestamps (jq fromdateiso8601 compatible)', () => {
    const states = runtime.getAllExecutionStates();
    const agentId = states[0].agentId;
    const res = runtime.updateExecutionState(agentId, {});
    expect(res.ok).toBe(true);
    const hb = runtime.getExecutionState(agentId)?.lastHeartbeat;
    expect(typeof hb).toBe('string');
    expect(hb as string).toMatch(SECOND_PRECISION_ISO);
    expect(hb as string).not.toContain('.');
  });

  test('security middleware keeps anonymous 100/min limit and adds owner-key bypass', async () => {
    const src = await Bun.file(new URL('../services/ivx-security-middleware.ts', import.meta.url)).text();
    // Anonymous traffic keeps the exact same limit.
    expect(src).toContain('checkRateLimit(ipRateStore, ip, 60 * 1000, 100)');
    // Trusted fleet traffic is authenticated against the active system secret.
    expect(src).toContain('isTrustedOwnerKeyRequest');
    expect(src).toContain('resolveActiveIVXSystemSecret');
    expect(src).toContain("c.req.header('x-ivx-owner-key')");
  });
});
