#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, 'qa', 'evidence');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml',
  '.sh', '.sql', '.html', '.css', '.scss', '.mdx', '.gradle', '.properties',
]);
const CODE_BASENAMES = new Set(['Dockerfile', 'Procfile', 'render.yaml', 'app.json']);
const EXCLUDED_PREFIXES = [
  'node_modules/', '.git/', 'dist/', 'build/', 'coverage/', 'expo/android/.gradle/',
  'expo/android/app/build/', 'expo/ios/Pods/', '.expo/', 'vendor/', 'artifacts/',
];
const EXCLUDED_FILES = new Set([
  'bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !EXCLUDED_FILES.has(file))
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file).toLowerCase()) || CODE_BASENAMES.has(path.basename(file)))
    .sort();
}

function isTestFile(file) {
  return /(^|\/)(__tests__|test|tests|fixtures|recovery)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function severityFor(file, ruleId) {
  if (ruleId === 'MERGE_CONFLICT' || ruleId === 'HARDCODED_SECRET' || ruleId === 'TS_NOCHECK') return 'P0';
  if (ruleId === 'STALE_CANNED_OWNER_REPLY' || ruleId === 'QA_CERT_SKIP' || ruleId === 'UNSAFE_JSON_PARSE') return 'P1';
  if (file.startsWith('backend/api/') || file.startsWith('backend/services/') || file.startsWith('expo/src/modules/ivx-owner-ai/')) return 'P1';
  return 'P2';
}

const rules = [
  {
    id: 'MERGE_CONFLICT',
    test: (line) => /^(<<<<<<<|=======|>>>>>>>)($|\s)/.test(line),
    message: 'Unresolved merge-conflict marker.',
  },
  {
    id: 'TS_NOCHECK',
    test: (line) => /@ts-nocheck/.test(line),
    message: 'TypeScript checking disabled for file.',
  },
  {
    id: 'HARDCODED_SECRET',
    test: (line, file) => !/\.example$|fixtures|test|spec|docs\//.test(file) && /(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:secret|api[_-]?key|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-\/.+=]{24,}['"])/i.test(line),
    message: 'Possible hard-coded credential or private key material.',
  },
  {
    id: 'STALE_CANNED_OWNER_REPLY',
    test: (line, file) => !isTestFile(file) && /(3\s+propiedades\s+activas|3\s+active\s+properties)/i.test(line),
    message: 'Canned property-count reply in production code can contaminate unrelated owner turns.',
  },
  {
    id: 'QA_CERT_SKIP',
    test: (line, file) => file.startsWith('qa/') && /status:\s*['"]SKIP['"]/.test(line),
    message: 'Certification QA contains SKIP path; enterprise certification must explicitly account for it.',
  },
  {
    id: 'UNSAFE_JSON_PARSE',
    test: (line, file) => /(?:await\s+)?[A-Za-z0-9_.$]+\.json\(\)/.test(line) && /(owner|autonomous|worker|health|version|api|service|qa)/i.test(file),
    message: 'Direct response.json() in critical surface; verify status/content-type before parse.',
  },
  {
    id: 'TS_IGNORE',
    test: (line) => /@ts-ignore/.test(line),
    message: 'Type error suppressed.',
  },
  {
    id: 'ESLINT_DISABLE',
    test: (line) => /eslint-disable/.test(line),
    message: 'Lint rule suppressed; requires review evidence.',
  },
  {
    id: 'TODO_FIXME_HACK',
    test: (line, file) => !isTestFile(file) && /\b(TODO|FIXME|HACK)\b/.test(line),
    message: 'Unresolved engineering marker in production code.',
  },
];

const files = trackedFiles();
const fileLedger = [];
const findings = [];
let totalLines = 0;
let nonBlankLines = 0;

for (const file of files) {
  const absolute = path.join(ROOT, file);
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  const lines = text.split(/\r?\n/);
  const sha256 = createHash('sha256').update(text).digest('hex');
  const shard = parseInt(sha256.slice(0, 8), 16) % 112 + 1;
  let fileFindingCount = 0;
  lines.forEach((line, index) => {
    totalLines += 1;
    if (line.trim()) nonBlankLines += 1;
    for (const rule of rules) {
      if (!rule.test(line, file)) continue;
      const severity = severityFor(file, rule.id);
      findings.push({
        ruleId: rule.id,
        severity,
        file,
        line: index + 1,
        shard,
        message: rule.message,
        preview: line.trim().slice(0, 220),
      });
      fileFindingCount += 1;
    }
  });
  fileLedger.push({ file, sha256, lines: lines.length, shard, findings: fileFindingCount });
}

const p0 = findings.filter((f) => f.severity === 'P0').length;
const p1 = findings.filter((f) => f.severity === 'P1').length;
const p2 = findings.filter((f) => f.severity === 'P2').length;
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const report = {
  marker: 'IVX-ENTERPRISE-LINE-AUDIT-V1',
  generatedAt: new Date().toISOString(),
  sourceSha,
  scannedFiles: fileLedger.length,
  totalLines,
  nonBlankLines,
  findings: { total: findings.length, p0, p1, p2 },
  certificationEligible: p0 === 0 && p1 === 0,
  coverage: 'EVERY_TRACKED_TEXT_CODE_LINE',
  exclusions: { prefixes: EXCLUDED_PREFIXES, files: [...EXCLUDED_FILES] },
};

writeFileSync(path.join(EVIDENCE_DIR, 'enterprise-line-audit.json'), JSON.stringify(report, null, 2));
writeFileSync(path.join(EVIDENCE_DIR, 'enterprise-line-findings.json'), JSON.stringify(findings, null, 2));
writeFileSync(path.join(EVIDENCE_DIR, 'enterprise-line-file-ledger.json'), JSON.stringify(fileLedger, null, 2));
writeFileSync(
  path.join(EVIDENCE_DIR, 'enterprise-line-ledger.jsonl'),
  fileLedger.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
);

console.log(JSON.stringify(report, null, 2));
if (p0 > 0 || p1 > 0) {
  console.error(`ENTERPRISE_LINE_AUDIT_FAIL p0=${p0} p1=${p1} p2=${p2}`);
  process.exit(1);
}
console.log(`ENTERPRISE_LINE_AUDIT_PASS files=${fileLedger.length} lines=${totalLines}`);
