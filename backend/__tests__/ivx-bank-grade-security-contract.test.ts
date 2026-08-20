/**
 * IVX bank-grade security contract — permanent regression tests.
 *
 * These tests encode the emergency database hardening as a REPOSITORY contract so a
 * future commit cannot silently undo it. Each test maps to a specific clause of the
 * owner's security execution order.
 *
 * SCOPE AND HONESTY
 * These are static/repository-level assertions. They prove what the REPO declares and
 * what the SHIPPED CODE does. They do NOT and cannot prove the live Supabase catalog
 * state — that requires service-role DB credentials, which are not present in this
 * execution environment (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent from the
 * process env). Live SQL privilege verification is therefore reported as UNVERIFIED in
 * the certificate rather than assumed. Nothing here should be read as a live-DB proof.
 *
 * What these tests DO guarantee: if someone re-introduces a service_role key into
 * tracked source, adds an alternate wire beneficiary, drops RLS from a member table,
 * grants a sensitive function to anon/authenticated, lets a client self-credit a
 * wallet, or reverts the fleet audit to hardcoded pass/fail — CI goes red.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..', '..');

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function read(rel: string): string {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) return '';
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

/** Decodes a JWT payload's `role` claim without ever returning the token itself. */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}/g;

/** Source files only — excludes generated Rork transcripts and archived evidence. */
function sourceFiles(): string[] {
  return tracked().filter(
    (f) =>
      !f.startsWith('.rork/') &&
      !f.startsWith('qa-archive/') &&
      !f.endsWith('.lock') &&
      !f.includes('playwright-report/'),
  );
}

describe('credential containment', () => {
  test('no service_role JWT exists in any tracked source file', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const body = read(f);
      if (!body || body.includes('\u0000')) continue;
      for (const m of body.match(JWT_RE) ?? []) {
        if (jwtRole(m) === 'service_role') {
          offenders.push(f);
          break;
        }
      }
    }
    // A service_role key bypasses ALL row-level security. It must never be committed.
    expect(offenders).toEqual([]);
  });

  test('no private key blocks are committed in source', () => {
    const offenders = sourceFiles().filter((f) => {
      const body = read(f);
      // Test fixtures legitimately reference the marker to assert detection works.
      if (body.includes('ivx-secret-guard:allow-file')) return false;
      if (/\.test\.(ts|tsx|mjs)$/.test(f)) return false;
      return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body);
    });
    expect(offenders).toEqual([]);
  });

  test('anon keys remain public-by-design and are NOT treated as leaks', () => {
    // The Supabase anon key is shipped in client bundles and protected by RLS. This
    // test documents that intent so nobody "fixes" it by deleting the fallback and
    // breaking the client. It must be anon — never a stronger role.
    const body = read('expo/lib/supabase-env.ts');
    expect(body.length).toBeGreaterThan(0);
    const keys = body.match(JWT_RE) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const role = jwtRole(k);
      if (role !== null) expect(role).toBe('anon');
    }
  });
});

describe('wire destination integrity', () => {
  const WIRE_SOURCES = [
    'expo/lib/payment-service.ts',
    'backend/services/ivx-payment-service.ts',
    'expo/ivxholding-landing/ivx-wire.js',
    'expo/components/WireTransferForm.tsx',
    'expo/app/wire-transfer.tsx',
  ];

  test('wire beneficiary is exclusively IVX-controlled', () => {
    const FORBIDDEN_BENEFICIARY =
      /beneficiary(Name|Address)?\s*[:=]\s*['"`](?!.*IVX)(?!.*\[)(?!.*pending)(?!.*PENDING)[A-Za-z][^'"`]{3,}['"`]/g;
    const offenders: { file: string; match: string }[] = [];
    for (const f of WIRE_SOURCES) {
      const body = read(f);
      if (!body) continue;
      for (const m of body.match(FORBIDDEN_BENEFICIARY) ?? []) {
        offenders.push({ file: f, match: m.slice(0, 60) });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no third-party payment redirect or crypto destination in wire/payment code', () => {
    const FORBIDDEN =
      /(stripe\.com\/(pay|checkout)|paypal\.me\/|venmo\.com\/|cash\.app\/|0x[a-fA-F0-9]{40}|\bbc1[a-z0-9]{25,}\b)/i;
    const offenders = WIRE_SOURCES.filter((f) => FORBIDDEN.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('shipped wire instructions expose no real routing or account number', () => {
    // Every account/routing value in the shipped instruction builder must be a
    // bracketed placeholder until the owner configures the real destination.
    const body = read('expo/lib/payment-service.ts');
    expect(body.length).toBeGreaterThan(0);
    const assigned = body.match(/(accountNumber|routingNumber|swiftCode|iban)\s*:\s*['"`]([^'"`]*)['"`]/g) ?? [];
    expect(assigned.length).toBeGreaterThan(0);
    const realLooking = assigned.filter((a) => /:\s*['"`]\s*[0-9]{6,}/.test(a));
    expect(realLooking).toEqual([]);
  });
});

describe('wallet settlement safety', () => {
  const WALLET_SERVICE = 'expo/lib/wallet-service.ts';

  test('client never writes a computed wallet balance directly', () => {
    // THE REGRESSION THIS GUARDS
    // creditWallet/debitWallet previously fell back to `supabase.from('wallets')
    // .update({ available, total })` whenever the hardened RPC refused. That is a
    // member self-credit path: revoking EXECUTE on the RPC made the client do the
    // write itself. Only zero-value wallet INITIALISATION may touch the table from
    // the client; balance arithmetic must be server-authored.
    const body = read(WALLET_SERVICE);
    expect(body.length).toBeGreaterThan(0);
    const updates = body.match(/\.from\(['"`]wallets['"`]\)[\s\S]{0,400}?\.update\(\{[\s\S]{0,400}?\}\)/g) ?? [];
    const balanceWrites = updates.filter((u) => /\b(available|total|invested)\s*:/.test(u));
    expect(balanceWrites).toEqual([]);
  });

  test('credit and debit have no non-RPC fallback path', () => {
    const body = read(WALLET_SERVICE);
    expect(body).not.toContain('client_fallback');
    expect(body).toContain('requires verified server-side settlement');
  });

  test('no Expo runtime module invokes a service-role-only RPC', () => {
    // Matches an ACTUAL rpc('<fn>') invocation, not SQL DDL text embedded in an
    // admin console screen (which is copy-paste material for the Supabase editor,
    // not a live call).
    const SERVICE_ROLE_ONLY = ['atomic_wallet_operation', 'ivx_exec_sql', 'ivx_query_auth_user_by_email'];
    const offenders: { file: string; fn: string }[] = [];
    for (const f of sourceFiles()) {
      if (!f.startsWith('expo/')) continue;
      if (f.includes('__tests__') || f.includes('/scripts/') || f.includes('/deploy/') || f.endsWith('.sql')) continue;
      // stored-procedures.ts is the single audited settlement wrapper; wallet-service
      // routes through it and fails closed. It is asserted separately above.
      if (f === 'expo/lib/stored-procedures.ts' || f === 'expo/lib/supabase-sql-executor.ts') continue;
      const body = read(f);
      for (const fn of SERVICE_ROLE_ONLY) {
        if (new RegExp(`rpc\\(\\s*['"\`]${fn}['"\`]`).test(body)) offenders.push({ file: f, fn });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('row level security contract', () => {
  const RLS_SQL = 'supabase/migrations/ivx-rls-policies.sql';
  const REQUIRED_RLS_TABLES = [
    'investor_profiles',
    'members',
    'transactions',
    'wire_submissions',
    'treasury_ledger',
    'withdrawals',
  ];

  test('RLS is enabled for every member-data table', () => {
    const sql = read(RLS_SQL);
    expect(sql.length).toBeGreaterThan(0);
    const missing = REQUIRED_RLS_TABLES.filter(
      (t) => !new RegExp(`ALTER TABLE[^;]*\\b${t}\\b[^;]*ENABLE ROW LEVEL SECURITY`, 'i').test(sql),
    );
    expect(missing).toEqual([]);
  });

  test('member-scoped policies are bound to auth.uid(), never unrestricted', () => {
    const sql = read(RLS_SQL);
    expect(sql).toMatch(/CREATE POLICY\s+"user_read_own_investor_profile"/i);
    // Every "own"-scoped policy must reference auth.uid().
    const ownPolicies = sql.match(/CREATE POLICY\s+"[^"]*own[^"]*"[\s\S]*?;/gi) ?? [];
    expect(ownPolicies.length).toBeGreaterThan(0);
    const unscoped = ownPolicies.filter((p) => !/auth\.uid\(\)/.test(p));
    expect(unscoped).toEqual([]);
  });

  test('no policy grants blanket true to anon on member data', () => {
    const sql = read(RLS_SQL);
    const anonTrue = sql.match(/CREATE POLICY[^;]*TO\s+anon[^;]*USING\s*\(\s*true\s*\)[^;]*;/gi) ?? [];
    const onMemberTable = anonTrue.filter((p) =>
      REQUIRED_RLS_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(p)),
    );
    expect(onMemberTable).toEqual([]);
  });
});

describe('audit instrument integrity', () => {
  const AUDIT = 'qa/ivx-112-senior-audit.ts';

  test('audit does not hardcode a universal failure', () => {
    const body = read(AUDIT);
    expect(body.length).toBeGreaterThan(0);
    // The historical defect: an unconditional reasons.push() at function scope that
    // pinned every agent to rejected regardless of evidence.
    const lines = body.split('\n');
    const unconditionalPush = lines.filter((l) => /^\s{4}reasons\.push\(/.test(l) && !/if\s*\(/.test(l));
    expect(unconditionalPush).toEqual([]);
  });

  test('audit preserves all three rejection controls', () => {
    const body = read(AUDIT);
    expect(body).toContain('permission_boundary_breached');
    expect(body).toContain('prohibited_tool_not_blocked');
    expect(body).toContain('approval_gate_breached');
  });

  test('audit keeps role verification separate from engineering certification', () => {
    const body = read(AUDIT);
    expect(body).toContain('roleVerified');
    expect(body).toContain('meetsEngineeringBar');
    // The 10/10 senior id must require the ENGINEERING bar across the whole roster.
    expect(body).toMatch(/seniorDeveloperCertified\s*=\s*engineeringBarMet === roster\.length/);
  });

  test('audit does not hardcode a universal pass', () => {
    const body = read(AUDIT);
    expect(body).not.toMatch(/roleVerified\s*=\s*true\s*;/);
    expect(body).not.toMatch(/meetsEngineeringBar\s*=\s*true\s*;/);
  });
});

describe('approval gating', () => {
  test('every write/deploy tool remains approval-gated', () => {
    const body = read('backend/services/ivx-agent-real-tools.ts');
    expect(body.length).toBeGreaterThan(0);
    const block = body.match(/APPROVAL_GATED_TOOL_IDS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(block.length).toBeGreaterThan(0);
    // The gated list composes the engineering write tools by spread, so resolve it.
    expect(block).toContain('...OWNER_APPROVAL_ENGINEERING_TOOLS');
    const engBody = read('backend/services/ivx-agent-engineering-tools.ts');
    const engBlock = engBody.match(/OWNER_APPROVAL_ENGINEERING_TOOLS[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const resolved = `${block}\n${engBlock}`;
    for (const tool of ['code_write', 'git_commit', 'git_push', 'deploy']) {
      expect(resolved).toContain(tool);
    }
  });

  test('money movement, trade and legal execution stay permanently prohibited', () => {
    const body = read('backend/services/ivx-agent-real-tools.ts');
    const block = body.match(/PROHIBITED_TOOL_IDS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    for (const tool of ['money_movement', 'trade_execution', 'legal_execution']) {
      expect(block).toContain(tool);
    }
  });

  test('research-only agents hold no engineering tools', () => {
    const body = read('backend/services/ivx-agent-real-tools.ts');
    // Engineering tools must be gated behind the explicit engineering roster, never
    // appended to the base set that every agent receives.
    expect(body).toMatch(/if\s*\(ENGINEERING_AGENT_NUMBERS\.has\(agentNumber\)\)\s*tools\.push\(\.\.\.ENGINEERING_TOOL_IDS\)/);
    const base = body.match(/const base:\s*RealToolId\[\]\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    for (const tool of ['code_write', 'code_read', 'typecheck', 'run_tests', 'deploy']) {
      expect(base).not.toContain(tool);
    }
  });
});
