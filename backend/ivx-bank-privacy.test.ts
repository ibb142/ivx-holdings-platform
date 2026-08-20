import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  handleSecureWireInstructions,
  handleSecureWireSubmission,
  isWireReferenceForMember,
} from './api/ivx-wire-transfer';

const ROOT = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const server = read('server.ts');
const wireSource = read('backend/api/ivx-wire-transfer.ts');
const directAuth = read('backend/api/ivx-direct-auth.ts');
const migration = read('backend/supabase/migrations/20260820143000_bank_privacy_hardening.sql');
const landingWire = read('expo/ivxholding-landing/ivx-wire.js');
const landingPortal = read('expo/ivxholding-landing/ivx-portal.js');

describe('IVX bank privacy hard gate', () => {
  it('fails closed and leaks zero wire-bank fields without authentication', async () => {
    const response = await handleSecureWireInstructions(new Request('https://api.ivxholding.com/api/ivx/wire-instructions'));
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toContain('Authentication required');
    expect(body).not.toContain('bankName');
    expect(body).not.toContain('routingNumber');
    expect(body).not.toContain('accountNumber');
    expect(body).not.toContain('beneficiaryAddress');
  });

  it('rejects unauthenticated wire submissions even when identity is spoofed in the body', async () => {
    const request = new Request('https://api.ivxholding.com/api/ivx/wire-submission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'victim-user',
        email: 'victim@example.com',
        name: 'Victim',
        amount: '1000',
        sentAt: '2026-08-20',
        referenceCode: 'IVX-VICTIMUS-1234',
      }),
    });
    const response = await handleSecureWireSubmission(request);
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Authentication required');
  });

  it('binds every wire reference to the authenticated member identifier', () => {
    const alice = 'abcdef12-1111-2222-3333-444444444444';
    const bob = '99999999-1111-2222-3333-444444444444';
    expect(isWireReferenceForMember('IVX-ABCDEF12-1234', alice)).toBe(true);
    expect(isWireReferenceForMember('IVX-ABCDEF12-1234', bob)).toBe(false);
    expect(isWireReferenceForMember('IVX-ABCDEF12-12', alice)).toBe(false);
  });

  it('derives wire identity only from a verified Supabase bearer token', () => {
    expect(wireSource).toContain('client.auth.getUser(token)');
    expect(wireSource).toContain('userId: member.userId');
    expect(wireSource).toContain('email: member.email');
    expect(wireSource).toContain('name: member.name');
    expect(wireSource).not.toContain('userId: body.userId');
    expect(wireSource).not.toContain('email: body.email');
    expect(wireSource).not.toContain('name: body.name');
  });

  it('intercepts wire routes before the legacy Hono router in production', () => {
    const instructionsGuard = server.indexOf("url.pathname === '/api/ivx/wire-instructions'");
    const submissionGuard = server.indexOf("url.pathname === '/api/ivx/wire-submission'");
    const fallback = server.indexOf('return app.fetch(request, env, executionCtx)');
    expect(instructionsGuard).toBeGreaterThan(0);
    expect(submissionGuard).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(instructionsGuard);
    expect(fallback).toBeGreaterThan(submissionGuard);
    expect(server).toContain('handleSecureWireInstructions(request)');
    expect(server).toContain('handleSecureWireSubmission(request)');
  });

  it('keeps direct-auth password-hash lookup service-role only', () => {
    expect(directAuth).toContain('SET search_path = public, auth, pg_temp');
    expect(directAuth).toContain('REVOKE ALL ON FUNCTION public.ivx_query_auth_user_by_email(text) FROM PUBLIC');
    expect(directAuth).toContain('FROM anon');
    expect(directAuth).toContain('FROM authenticated');
    expect(directAuth).toContain('TO service_role');
    expect(directAuth).not.toContain("'Access-Control-Allow-Origin': '*'");
  });

  it('persists service-role-only access for canonical member and financial stores', () => {
    for (const table of [
      'public.members',
      'public.investor_profiles',
      'public.member_financial_summary',
      'public.classification_audit',
      'public.ivx_durable_documents',
      'public.ivx_durable_events',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE ${table} FROM anon`);
      expect(migration).toContain(`REVOKE ALL ON TABLE ${table} FROM authenticated`);
      expect(migration).toContain(`GRANT ALL ON TABLE ${table} TO service_role`);
    }
    expect(migration).toContain("v_role <> 'service_role'");
    expect(migration).toContain('v_uid IS DISTINCT FROM p_user_id');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.ivx_exec_sql(text) FROM PUBLIC');
  });

  it('keeps landing auth tab-scoped and scrubs wire details on auth loss', () => {
    expect(landingWire).toContain("sessionStorage.getItem('ivx_portal_session')");
    expect(landingWire).not.toContain("localStorage.getItem('ivx_portal_session')");
    expect(landingWire).toContain("'Authorization': 'Bearer ' + token");
    expect(landingWire).toContain('scrubWireDetails');
    expect(landingWire).toContain("grid.style.display = 'none'");
    expect(landingWire).not.toContain('j.preview.bankName');

    expect(landingPortal).toContain("sessionStorage.getItem('ivx_portal_session')");
    expect(landingPortal).toContain("sessionStorage.setItem('ivx_portal_session'");
    expect(landingPortal).toContain("sessionStorage.removeItem('ivx_portal_session')");
    expect(landingPortal).toContain('persistSession: false');
    expect(landingPortal).toContain('autoRefreshToken: false');
    expect(landingPortal).toContain('detectSessionInUrl: false');
    expect(landingPortal).not.toContain("localStorage.setItem('ivx_portal_session'");
    expect(landingPortal).not.toContain("localStorage.getItem('ivx_portal_session'");
    expect(landingPortal).toContain('syncSecureWireSurface()');
    expect(landingPortal).toContain('scrubSecureWireSurface()');
  });

  it('contains no hard-coded receiving bank account identifiers in runtime source', () => {
    expect(wireSource).toContain('process.env.IVX_WIRE_BANK_NAME');
    expect(wireSource).toContain('process.env.IVX_WIRE_ROUTING_NUMBER');
    expect(wireSource).toContain('process.env.IVX_WIRE_ACCOUNT_NUMBER');
    expect(wireSource).toContain('process.env.IVX_WIRE_ACCOUNT_NAME');
    expect(wireSource).not.toMatch(/\b\d{9}\b/);
  });
});
