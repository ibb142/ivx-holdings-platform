#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const categories = {
  UNSAFE_JSON_PARSE: 'json_contract_review', QA_CERT_SKIP: 'missing_certification_evidence',
  TS_IGNORE: 'type_suppression_review', ESLINT_DISABLE: 'lint_suppression_review',
  TODO_FIXME_HACK: 'engineering_marker_review', STALE_CANNED_OWNER_REPLY: 'owner_reply_review',
};
const reviewedComments = new Map([
  ['expo/__tests__/autonomous-owner-audit-failclosed.test.ts:UNSAFE_JSON_PARSE',
    '// Telemetry flows through the JSON-contract reader; raw response.json() is banned.'],
  ['expo/src/modules/ivx-owner-ai/services/ivxChatQualityFirewall.ts:STALE_CANNED_OWNER_REPLY',
    '// current owner turn (e.g. "Where is Autonomous?" -> "3 active properties").'],
  ['backend/services/ivx-agent-real-engineering-cycle.ts:TODO_FIXME_HACK',
    '// Hygiene defects: unresolved TODO/FIXME/HACK markers are real open work.'],
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const safePath = file => typeof file === 'string' && file.length > 0 &&
  !path.posix.isAbsolute(file) && !file.split('/').includes('..') && !/[\x00-\x1f\\]/.test(file);

export function triageFindings({ audit, findings, ledger, readSource }) {
  if (!/^[a-f0-9]{40}$/.test(audit?.sourceSha || '') || !Array.isArray(findings) || !Array.isArray(ledger)) {
    throw new Error('Triage requires immutable audit identity, findings and file ledger');
  }
  const counts = { total: findings.length, p0: 0, p1: 0, p2: 0 };
  for (const f of findings) {
    if (!['P0', 'P1', 'P2'].includes(f.severity) || !safePath(f.file) || !Number.isSafeInteger(f.line) || f.line < 1) {
      throw new Error('Invalid finding identity');
    }
    counts[f.severity.toLowerCase()]++;
  }
  if (Object.keys(counts).some(key => audit.findings?.[key] !== counts[key])) throw new Error('Audit totals do not reconcile');
  const files = new Map(ledger.map(row => [row.file, row]));
  const sources = new Map();
  const identities = new Set();
  const rows = findings.map(finding => {
    const file = files.get(finding.file);
    if (!/^[a-f0-9]{64}$/.test(file?.sha256 || '') || finding.line > file.lines) throw new Error('Finding file ledger missing or invalid');
    const identity = `${audit.sourceSha}:${finding.file}:${finding.line}:${finding.ruleId}`;
    if (identities.has(identity)) throw new Error('Duplicate finding identity');
    identities.add(identity);
    let disposition = 'REVIEW_REQUIRED';
    let reason = categories[finding.ruleId] || 'security_or_unknown_rule_review';
    let sourceVerified = false;
    const comment = reviewedComments.get(`${finding.file}:${finding.ruleId}`);
    // Only the known historical findings document and reviewed explanatory
    // comments are candidates. Generated blueprints may embed executable code.
    const historical = finding.file === 'qa/evidence/enterprise-line-findings.json';
    if (finding.severity !== 'P0' && (historical || comment)) {
      if (!sources.has(finding.file)) sources.set(finding.file, readSource(finding.file, audit.sourceSha));
      const source = sources.get(finding.file);
      if (typeof source === 'string') {
        if (hash(source) !== file.sha256) throw new Error('Triage source hash does not match the immutable audit');
        const line = source.split(/\r?\n/)[finding.line - 1]?.trim();
        if (line?.slice(0, 220) !== finding.preview) throw new Error('Finding preview does not match the source line');
        sourceVerified = true;
        let reportData = false;
        if (historical) {
          try {
            const document = JSON.parse(source);
            reportData = Array.isArray(document) && document.length > 0 && document.every(row =>
              typeof row.ruleId === 'string' && typeof row.file === 'string' &&
              Number.isInteger(row.line) && typeof row.preview === 'string' && typeof row.message === 'string');
          } catch { /* Invalid JSON cannot justify a false-positive disposition. */ }
        }
        if (reportData || (comment && line === comment)) {
          disposition = 'FALSE_POSITIVE_CONFIRMED';
          reason = reportData ? 'historical_findings_document' : 'reviewed_explanatory_comment';
        }
      } else reason = 'candidate_requires_immutable_source';
    }
    return { ...finding, findingId: hash(identity), sourceSha: audit.sourceSha,
      sourceFileSha256: file.sha256, sourceVerified, disposition, reason,
      suppressedFromTriageQueue: disposition === 'FALSE_POSITIVE_CONFIRMED' };
  });
  const falsePositives = rows.filter(row => row.suppressedFromTriageQueue).length;
  const byRule = {};
  for (const row of rows) {
    const bucket = byRule[row.ruleId] ||= { total: 0, falsePositives: 0, reviewRequired: 0 };
    bucket.total++;
    bucket[row.suppressedFromTriageQueue ? 'falsePositives' : 'reviewRequired']++;
  }
  return { marker: 'IVX-EVIDENCE-BOUND-TRIAGE-V1', sourceSha: audit.sourceSha,
    generatedAt: new Date().toISOString(), originalCounts: counts,
    classified: rows.length, falsePositives, reviewRequired: rows.length - falsePositives,
    auditGateUnchanged: true, certified: false, byRule, findings: rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = path.resolve(process.argv[2] || 'qa/evidence');
    const sourceRoot = process.argv[3] ? path.resolve(process.argv[3]) : null;
    const read = name => JSON.parse(readFileSync(path.join(evidence, name), 'utf8'));
    const result = triageFindings({ audit: read('enterprise-line-audit.json'),
      findings: read('enterprise-line-findings.json'), ledger: read('enterprise-line-file-ledger.json'),
      readSource: (file, sha) => {
        try {
          return sourceRoot ? readFileSync(path.join(sourceRoot, file), 'utf8') :
            execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        } catch { return null; }
      },
    });
    writeFileSync(path.join(evidence, 'enterprise-finding-triage.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ ...result, findings: undefined }));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Triage unavailable'); process.exitCode = 1; }
}
