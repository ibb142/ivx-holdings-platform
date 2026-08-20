#!/usr/bin/env node
/**
 * IVX Secret Guard — blocks credentials from ever reaching the public repo.
 *
 * Why this exists: three GitHub tokens in a row were auto-revoked by GitHub secret
 * scanning. Root cause was never the tokens — it was `.rork/history/` chat transcripts
 * being committed to a PUBLIC repo with the tokens in plaintext. This guard breaks that
 * loop so a token can live for its full expiry instead of a few days.
 *
 * Modes:
 *   --staged   scan only files staged for commit (used by the pre-commit hook)
 *   --tracked  scan every git-tracked file (used by CI / the QA gate)
 *
 * Exit code 0 = clean, 1 = secrets found (commit blocked).
 *
 * Detection is two-stage to avoid false positives on test fixtures:
 *   1. A prefix pattern must match (ghp_, rnd_, AKIA, ...).
 *   2. The candidate must survive the fixture filter AND clear an entropy floor.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const MAX_BYTES = 2_000_000;

/** Paths that must NEVER be committed, secrets or not. */
const FORBIDDEN_PATHS = [
  { pattern: /^\.rork\/history\//, reason: 'Rork chat transcripts — these carry pasted tokens in plaintext' },
  { pattern: /^\.rork\/plans\//, reason: 'Rork plan files may quote credentials' },
  { pattern: /(^|\/)\.env$/, reason: 'real environment file' },
  { pattern: /(^|\/)\.env\.(local|production)$/, reason: 'real environment file' },
  { pattern: /(^|\/)keys\//, reason: 'key material directory' },
  { pattern: /\.(pem|p12|jks|keystore)$/, reason: 'private key / keystore' },
];

/** Credential shapes worth blocking. */
const SECRET_PATTERNS = [
  { name: 'GitHub classic PAT', re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { name: 'GitHub OAuth token', re: /\bgho_[A-Za-z0-9]{30,}\b/g },
  { name: 'Render API key', re: /\brnd_[A-Za-z0-9]{20,}\b/g },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{30,}\b/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack bot token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Supabase service_role JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Twilio account SID', re: /\bAC[0-9a-f]{32}\b/g },
];

/** Markers that identify a value as a deliberate test fixture, not a live credential. */
const FIXTURE_MARKERS = [
  /example/i,
  /redact/i,
  /placeholder/i,
  /replace[_-]?me/i,
  /your[_-]?token/i,
  /dummy/i,
  /fake/i,
  /sample/i,
  /test[_-]?token/i,
  /xxxx/i,
  /0{8,}/,
  /1234567890/,
  /abcdef/i,
];

/** Shannon entropy in bits/char — real credentials are high-entropy. */
function entropy(value) {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Sequential runs like "abcdefgh" or "12345678" signal a hand-typed fixture. */
function hasLongSequentialRun(value) {
  let run = 1;
  for (let i = 1; i < value.length; i += 1) {
    run = value.charCodeAt(i) === value.charCodeAt(i - 1) + 1 ? run + 1 : 1;
    if (run >= 6) return true;
  }
  return false;
}

function isFixture(match) {
  const body = match.replace(/^(ghp_|gho_|github_pat_|rnd_|sk-|AKIA|SG\.|xox[baprs]-)/, '');
  if (FIXTURE_MARKERS.some((m) => m.test(match))) return true;
  if (hasLongSequentialRun(body)) return true;
  if (entropy(body) < 3.2) return true;
  return false;
}

function gitFiles(mode) {
  const args =
    mode === 'staged'
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
      : ['ls-files'];
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  const mode = process.argv.includes('--staged') ? 'staged' : 'tracked';
  const files = gitFiles(mode);
  const pathViolations = [];
  const secretViolations = [];

  for (const file of files) {
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.pattern.test(file)) {
        pathViolations.push({ file, reason: rule.reason });
        break;
      }
    }

    if (!existsSync(file)) continue;
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;

    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue;
    if (content.includes('ivx-secret-guard:allow-file')) continue;

    const lines = content.split('\n');
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const value = m[0];
        if (isFixture(value)) continue;
        const lineNo = content.slice(0, m.index).split('\n').length;
        if ((lines[lineNo - 1] ?? '').includes('ivx-secret-guard:allow')) continue;
        secretViolations.push({
          file,
          line: lineNo,
          kind: name,
          preview: `${value.slice(0, 10)}…${value.slice(-4)}`,
        });
      }
    }
  }

  const total = pathViolations.length + secretViolations.length;
  if (total === 0) {
    console.log(`[ivx-secret-guard] clean — ${files.length} ${mode} file(s) scanned, 0 credentials found`);
    return 0;
  }

  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║  IVX SECRET GUARD — COMMIT BLOCKED                           ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\n');

  if (pathViolations.length > 0) {
    console.error(`Files that must never be committed (${pathViolations.length}):\n`);
    for (const v of pathViolations.slice(0, 15)) console.error(`  ✖ ${v.file}\n      ${v.reason}`);
    if (pathViolations.length > 15) console.error(`  … and ${pathViolations.length - 15} more`);
    console.error('\n  Fix:  git rm -r --cached .rork/history\n');
  }

  if (secretViolations.length > 0) {
    console.error(`Live credentials detected (${secretViolations.length}):\n`);
    for (const v of secretViolations.slice(0, 15)) {
      console.error(`  ✖ ${v.file}:${v.line}  ${v.kind}  ${v.preview}`);
    }
    if (secretViolations.length > 15) console.error(`  … and ${secretViolations.length - 15} more`);
    console.error('\n  Move the value into an environment variable, then re-stage.');
    console.error('  Deliberate fixture? Append  // ivx-secret-guard:allow  on that line.\n');
  }

  console.error('This guard exists because leaked tokens get auto-revoked by GitHub.\n');
  return 1;
}

process.exit(main());
