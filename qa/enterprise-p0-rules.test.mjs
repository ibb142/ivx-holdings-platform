import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hasHardcodedSecret, hasTypecheckDisable } from './enterprise-p0-rules.mjs';

const analytics = 'backend/services/ivx-analytics-brain.ts';
const session = 'expo/lib/owner-session-resilience.ts';
const credential = 'synthetic-credential-fixture-123456';

test('the three reviewed identifiers are not credentials', () => {
  assert.equal(hasHardcodedSecret("  token: 'interest_tokenized_assets',", analytics), false);
  assert.equal(hasHardcodedSecret("  ACCESS_TOKEN: 'ivx_owner_resilient_access_token',", session), false);
  assert.equal(hasHardcodedSecret('  REFRESH_TOKEN: "ivx_owner_resilient_refresh_token",', session), false);
});

test('exceptions cannot hide a changed value, another path or a second credential', () => {
  assert.equal(hasHardcodedSecret(`  ACCESS_TOKEN: '${credential}', // ivx-audit-ok`, session), true);
  assert.equal(hasHardcodedSecret("token: 'interest_tokenized_assets',", 'backend/api/payment.ts'), true);
  assert.equal(hasHardcodedSecret(`token: 'interest_tokenized_assets', password: '${credential}'`, analytics), true);
  assert.equal(hasHardcodedSecret(`password: '${credential}' // ivx-audit-ok: safe`, analytics), true);
  assert.equal(hasHardcodedSecret("token: 'interest_tokenized_assets' + secretSuffix,", analytics), true);
});

test('private keys and AWS keys remain critical even beside reviewed identifiers', () => {
  assert.equal(hasHardcodedSecret("token: 'interest_tokenized_assets', // AKIA1234567890ABCDEF", analytics), true);
  assert.equal(hasHardcodedSecret('-----BEGIN PRIVATE KEY-----', analytics), true);
  assert.equal(hasHardcodedSecret('-----BEGIN RSA PRIVATE KEY-----', analytics), true);
});

test('actual source directives still fail for TypeScript and JavaScript', () => {
  for (const file of ['backend/example.ts', 'expo/example.tsx', 'qa/example.mjs', 'qa/example.js', 'qa/example.cts']) {
    for (const directive of ['// @ts-nocheck', '  /* @ts-nocheck */', ' * @ts-nocheck', '/// @ts-nocheck']) {
      assert.equal(hasTypecheckDisable(directive, file), true, `${file}: ${directive}`);
    }
  }
});

test('historical evidence, quoted mentions and detection expressions are not directives', () => {
  assert.equal(hasTypecheckDisable('{ "fix": "@ts-nocheck removed" }', 'qa/evidence/report.json'), false);
  assert.equal(hasTypecheckDisable('test: (line) => /@ts-nocheck/.test(line),', 'qa/audit.mjs'), false);
  assert.equal(hasTypecheckDisable("const note = '@ts-nocheck';", 'backend/example.ts'), false);
  assert.equal(hasTypecheckDisable('// @ts-nocheck', 'qa/evidence/report.json'), false);
});

test('the real audit still rejects P1 and newly introduced P0 after reviewed false positives are removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'ivx-line-audit-'));
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  try {
    execFileSync('git', ['init', '-q', root]);
    write('qa/placeholder.md', 'isolated audit fixture');
    for (const file of ['ivx-enterprise-line-audit.mjs', 'enterprise-p0-rules.mjs']) {
      copyFileSync(new URL(file, import.meta.url), join(root, 'qa', file));
    }
    write(analytics, "const categories = {\n  token: 'interest_tokenized_assets',\n};\n");
    write(session, "const keys = {\n  ACCESS_TOKEN: 'ivx_owner_resilient_access_token',\n  REFRESH_TOKEN: 'ivx_owner_resilient_refresh_token',\n};\n");
    write('qa/evidence/historical.json', JSON.stringify({ fix: '@ts-nocheck removed', notes: 'No @ts-nocheck introduced' }));
    const fixtureRead = 'response' + '.json()';
    write('backend/api/sample.ts', `const value = ${fixtureRead};\n`);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Audit fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
    const run = () => {
      const process = spawnSync(globalThis.process.execPath, ['qa/ivx-enterprise-line-audit.mjs'], { cwd: root, encoding: 'utf8' });
      const report = JSON.parse(readFileSync(join(root, 'qa/evidence/enterprise-line-audit.json'), 'utf8'));
      return { process, report };
    };
    const reviewed = run();
    assert.equal(reviewed.report.findings.p0, 0);
    const findings = JSON.parse(readFileSync(join(root, 'qa/evidence/enterprise-line-findings.json'), 'utf8'));
    assert.equal(findings.filter(finding => finding.file === 'backend/api/sample.ts' && finding.ruleId === 'UNSAFE_JSON_PARSE').length, 1);
    assert.ok(reviewed.report.findings.p1 > 0);
    assert.equal(reviewed.report.certificationEligible, false);
    assert.equal(reviewed.process.status, 1);
    write('backend/api/sample.ts', `// @ts-nocheck\nconst password = '${credential}';\n`);
    const regression = run();
    assert.equal(regression.report.findings.p0, 2);
    assert.equal(regression.report.certificationEligible, false);
    assert.equal(regression.process.status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
