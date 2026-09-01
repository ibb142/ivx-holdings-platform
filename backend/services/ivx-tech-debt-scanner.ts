/**
 * IVX technical-debt + freeze-risk scanner.
 *
 * Walks the workspace source files and surfaces evidence-backed findings the
 * autonomous continuous-improvement system can act on:
 *   - debt markers   → the COMMENT_MARKERS set below, in real code comments
 *   - freeze risks    → empty catch blocks, NOT_IMPLEMENTED / "not implemented"
 *                       throws, no-op JSX handlers (onPress/onClick={() => {}})
 *   - oversized files → files whose LOC exceeds a maintainability threshold
 *
 * Every finding carries hard evidence: relativePath + line + snippet + severity
 * + a short "why". The marker-scan deliberately targets COMMENT lines (a `//`,
 * `/*`, or `*` prefix) so the evidence-gate / detector code that legitimately
 * mentions these words as string literals is NOT flagged as debt.
 *
 * The core (`scanContentForDebt`) is pure and fully unit-testable; the walker
 * (`scanWorkspaceForTechDebt`) reuses the code-index ignore rules.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TECH_DEBT_SCANNER_MARKER = 'ivx-tech-debt-scanner-2026-06-02';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const IGNORE_DIRS = new Set<string>([
  'node_modules', '.git', '.expo', 'dist', 'build', 'tmp', 'core',
  '.next', 'coverage', '.turbo', '.cache', 'logs', 'ios', 'android',
]);
const SCAN_EXTS = new Set<string>(['.ts', '.tsx', '.js', '.jsx']);
const MAX_FILE_BYTES = 512 * 1024;

/** A file with LOC above this is flagged oversized (maintainability risk). */
const OVERSIZED_WARN_LOC = 1200;
const OVERSIZED_HIGH_LOC = 2500;

export type DebtFindingKind = 'debt_marker' | 'freeze_risk' | 'oversized_file';
export type DebtSeverity = 'critical' | 'high' | 'medium' | 'low';

export type DebtFinding = {
  kind: DebtFindingKind;
  /** The concrete marker/pattern that matched (e.g. a debt marker, empty-catch, oversized-file). */
  marker: string;
  severity: DebtSeverity;
  relativePath: string;
  /** 1-based line number; 0 for whole-file findings (oversized). */
  line: number;
  /** Bounded source snippet proving the finding. */
  snippet: string;
  /** Short, human-readable reason the finding matters. */
  why: string;
};

export type TechDebtReport = {
  marker: string;
  generatedAt: string;
  root: string;
  durationMs: number;
  filesScanned: number;
  totals: {
    findings: number;
    debtMarkers: number;
    freezeRisks: number;
    oversizedFiles: number;
  };
  bySeverity: Record<DebtSeverity, number>;
  /** Highest-severity first, then by file/line for stable ordering. */
  findings: DebtFinding[];
};

const COMMENT_MARKERS: Array<{ marker: string; severity: DebtSeverity; why: string }> = [
  { marker: 'FIXME', severity: 'high', why: 'Flagged broken/needs-fixing code left in place.' }, // ivx-audit-ok: marker rule definition
  { marker: 'HACK', severity: 'high', why: 'Acknowledged workaround that should be replaced with a real solution.' }, // ivx-audit-ok: marker rule definition
  { marker: 'XXX', severity: 'medium', why: 'Author-flagged danger/attention marker.' },
  { marker: 'TODO', severity: 'medium', why: 'Deferred work recorded in a comment but not completed.' }, // ivx-audit-ok: marker rule definition
  { marker: 'TEMP', severity: 'medium', why: 'Temporary code that may have outlived its purpose.' },
];

/** Matches a real code comment line so string literals are not mis-flagged. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/;

function clampSnippet(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

/**
 * Pure: classify the debt + freeze-risk findings in a single file's content.
 * `loc` is derived here so callers can rely on the same line count.
 */
export function scanContentForDebt(relativePath: string, content: string): DebtFinding[] {
  const findings: DebtFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    // --- debt markers (comment lines only) ---
    if (COMMENT_LINE.test(line)) {
      for (const { marker, severity, why } of COMMENT_MARKERS) {
        // Word-boundary, case-sensitive marker inside the comment.
        const re = new RegExp(`\\b${marker}\\b`);
        if (re.test(line)) {
          findings.push({
            kind: 'debt_marker',
            marker,
            severity,
            relativePath,
            line: lineNumber,
            snippet: clampSnippet(line),
            why,
          });
          break; // one marker classification per line is enough
        }
      }
    }

    // --- freeze risk: empty catch block ---
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
      findings.push({
        kind: 'freeze_risk',
        marker: 'empty-catch',
        severity: 'high',
        relativePath,
        line: lineNumber,
        snippet: clampSnippet(line),
        why: 'Empty catch swallows errors silently — a classic source of frozen/невидимый failures.',
      });
    }

    // --- freeze risk: not-implemented throw / sentinel ---
    if (/throw\s+new\s+Error\(\s*['"`][^'"`]*not\s*implemented/i.test(line) || /\bNOT_IMPLEMENTED\b/.test(line)) {
      findings.push({
        kind: 'freeze_risk',
        marker: 'not-implemented',
        severity: 'high',
        relativePath,
        line: lineNumber,
        snippet: clampSnippet(line),
        why: 'Code path explicitly throws "not implemented" — an unfinished/blocked workflow.',
      });
    }

    // --- freeze risk: no-op JSX handler ---
    if (/\bon(?:Press|Click|Submit|Change)\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(line)) {
      findings.push({
        kind: 'freeze_risk',
        marker: 'noop-handler',
        severity: 'medium',
        relativePath,
        line: lineNumber,
        snippet: clampSnippet(line),
        why: 'No-op event handler — a dead/disconnected button that silently does nothing.',
      });
    }
  }

  return findings;
}

/** Pure: oversized-file finding for a given LOC, or null if within budget. */
export function classifyOversizedFile(relativePath: string, loc: number): DebtFinding | null {
  if (loc < OVERSIZED_WARN_LOC) return null;
  const severity: DebtSeverity = loc >= OVERSIZED_HIGH_LOC ? 'high' : 'low';
  return {
    kind: 'oversized_file',
    marker: 'oversized-file',
    severity,
    relativePath,
    line: 0,
    snippet: `${loc} lines of code`,
    why: `File is ${loc} LOC (≥ ${loc >= OVERSIZED_HIGH_LOC ? OVERSIZED_HIGH_LOC : OVERSIZED_WARN_LOC}) — large modules are harder to reason about and safely change.`,
  };
}

const SEVERITY_RANK: Record<DebtSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sortFindings(a: DebtFinding, b: DebtFinding): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  const p = a.relativePath.localeCompare(b.relativePath);
  if (p !== 0) return p;
  return a.line - b.line;
}

async function walkSourceFiles(dir: string, root: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as unknown as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      // skip dotfiles/dotdirs except explicit allowed ones (none here)
      if (IGNORE_DIRS.has(entry.name)) continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walkSourceFiles(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!SCAN_EXTS.has(ext)) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(full);
  }
}

/**
 * Walk the workspace and produce a full technical-debt + freeze-risk report.
 * `rootOverride` makes the walker testable against a fixture directory.
 */
export async function scanWorkspaceForTechDebt(options?: { rootOverride?: string }): Promise<TechDebtReport> {
  const start = Date.now();
  const root = options?.rootOverride ?? SERVER_ROOT;
  const files: string[] = [];
  await walkSourceFiles(root, root, files);

  const findings: DebtFinding[] = [];
  let filesScanned = 0;

  for (const file of files) {
    let bytes = 0;
    try {
      const info = await stat(file);
      bytes = info.size;
    } catch {
      continue;
    }
    if (bytes > MAX_FILE_BYTES) continue;

    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    filesScanned += 1;
    const relativePath = path.relative(root, file);
    findings.push(...scanContentForDebt(relativePath, content));
    const loc = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const oversized = classifyOversizedFile(relativePath, loc);
    if (oversized) findings.push(oversized);
  }

  findings.sort(sortFindings);

  const bySeverity: Record<DebtSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let debtMarkers = 0;
  let freezeRisks = 0;
  let oversizedFiles = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    if (f.kind === 'debt_marker') debtMarkers += 1;
    else if (f.kind === 'freeze_risk') freezeRisks += 1;
    else oversizedFiles += 1;
  }

  return {
    marker: TECH_DEBT_SCANNER_MARKER,
    generatedAt: new Date().toISOString(),
    root,
    durationMs: Date.now() - start,
    filesScanned,
    totals: { findings: findings.length, debtMarkers, freezeRisks, oversizedFiles },
    bySeverity,
    findings,
  };
}
