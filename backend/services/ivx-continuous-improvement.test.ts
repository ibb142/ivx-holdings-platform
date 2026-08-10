import { describe, it, expect } from 'bun:test';
import {
  scanContentForDebt,
  classifyOversizedFile,
} from './ivx-tech-debt-scanner';
import {
  compareArchitectureSnapshots,
  type ArchitectureSnapshot,
} from './ivx-architecture-drift';
import {
  buildImprovementProposals,
} from './ivx-continuous-improvement';
import type { TechDebtReport } from './ivx-tech-debt-scanner';
import type { ArchitectureDriftReport } from './ivx-architecture-drift';

// ---------- tech-debt scanner (pure core) ----------
describe('scanContentForDebt', () => {
  it('flags TODO/FIXME only inside real comment lines, never string literals', () => {
    const content = [
      '// TODO: wire this up',
      '/* FIXME: broken */',
      'const label = "TODO not a real marker";', // string literal, not a comment → ignored
      'const fix = doWork();',
    ].join('\n');
    const findings = scanContentForDebt('a.ts', content);
    const markers = findings.filter((f) => f.kind === 'debt_marker').map((f) => f.marker);
    expect(markers).toContain('TODO');
    expect(markers).toContain('FIXME');
    // the string-literal "TODO" on line 3 must NOT be flagged
    expect(findings.filter((f) => f.line === 3).length).toBe(0);
  });

  it('assigns higher severity to FIXME/HACK than TODO', () => {
    const f1 = scanContentForDebt('a.ts', '// FIXME later')[0];
    const f2 = scanContentForDebt('a.ts', '// TODO later')[0];
    expect(f1.severity).toBe('high');
    expect(f2.severity).toBe('medium');
  });

  it('detects empty catch blocks as high-severity freeze risk', () => {
    const findings = scanContentForDebt('a.ts', 'try { go(); } catch (e) {}');
    const fr = findings.find((f) => f.marker === 'empty-catch');
    expect(fr).toBeDefined();
    expect(fr?.kind).toBe('freeze_risk');
    expect(fr?.severity).toBe('high');
  });

  it('detects not-implemented throws and no-op JSX handlers as freeze risks', () => {
    const notImpl = scanContentForDebt('a.ts', "throw new Error('not implemented yet');");
    expect(notImpl.some((f) => f.marker === 'not-implemented')).toBe(true);
    const noop = scanContentForDebt('a.tsx', '<Button onPress={() => {}} />');
    expect(noop.some((f) => f.marker === 'noop-handler')).toBe(true);
  });

  it('returns no findings for clean content', () => {
    expect(scanContentForDebt('a.ts', 'export const sum = (a: number, b: number) => a + b;')).toEqual([]);
  });

  it('classifyOversizedFile flags large files only above threshold', () => {
    expect(classifyOversizedFile('small.ts', 500)).toBeNull();
    const warn = classifyOversizedFile('big.ts', 1500);
    expect(warn?.severity).toBe('low');
    const high = classifyOversizedFile('huge.ts', 3000);
    expect(high?.severity).toBe('high');
  });
});

// ---------- architecture drift (pure compare) ----------
describe('compareArchitectureSnapshots', () => {
  const base: ArchitectureSnapshot = {
    capturedAt: '2026-06-01T00:00:00Z',
    files: 100, services: 50, apis: 40, routes: 200, dependencies: 30, appScreens: 60, cycles: 0, topHotspotDegree: 10, available: true,
  };

  it('reports no drift when nothing changed', () => {
    const r = compareArchitectureSnapshots(base, { ...base, capturedAt: 'later' });
    expect(r.drift).toEqual([]);
    expect(r.overallSeverity).toBe('none');
  });

  it('treats new import cycles as high/critical severity', () => {
    const r = compareArchitectureSnapshots(base, { ...base, cycles: 3 });
    const cyc = r.drift.find((d) => d.metric === 'cycles');
    expect(cyc?.delta).toBe(3);
    expect(cyc?.severity).toBe('critical');
    expect(r.overallSeverity).toBe('critical');
  });

  it('flags dependency growth as a maintainability risk', () => {
    const r = compareArchitectureSnapshots(base, { ...base, dependencies: 38 });
    const dep = r.drift.find((d) => d.metric === 'dependencies');
    expect(dep?.delta).toBe(8);
    expect(dep?.severity).toBe('high');
  });

  it('returns the no-baseline message when baseline is null', () => {
    const r = compareArchitectureSnapshots(null, base);
    expect(r.overallSeverity).toBe('none');
    expect(r.summary).toContain('No architecture baseline');
  });
});

// ---------- improvement proposal builder (pure) ----------
function emptyDebt(): TechDebtReport {
  return {
    marker: 'm', generatedAt: 'now', root: '/', durationMs: 1,
    filesScanned: 0, totals: { findings: 0, debtMarkers: 0, freezeRisks: 0, oversizedFiles: 0 },
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [],
  };
}
function emptyDrift(): ArchitectureDriftReport {
  return {
    marker: 'm', generatedAt: 'now', hasBaseline: false, baselineCapturedAt: null, baseline: null,
    current: { capturedAt: 'now', files: 0, services: 0, apis: 0, routes: 0, dependencies: 0, appScreens: 0, cycles: 0, topHotspotDegree: 0, available: false },
    drift: [], overallSeverity: 'none', summary: '',
  };
}

describe('buildImprovementProposals', () => {
  it('produces no proposals from a clean codebase', () => {
    expect(buildImprovementProposals({ debt: emptyDebt(), drift: emptyDrift() })).toEqual([]);
  });

  it('marks an empty-catch logging fix as safe-to-auto-apply, but debt markers as owner-gated', () => {
    const debt = emptyDebt();
    debt.findings = [
      { kind: 'freeze_risk', marker: 'empty-catch', severity: 'high', relativePath: 'x.ts', line: 5, snippet: 'catch {}', why: 'silent' },
      { kind: 'debt_marker', marker: 'TODO', severity: 'medium', relativePath: 'y.ts', line: 9, snippet: '// TODO', why: 'deferred' },
    ];
    const proposals = buildImprovementProposals({ debt, drift: emptyDrift() });
    const logging = proposals.find((p) => p.category === 'logging_fix');
    const cleanup = proposals.find((p) => p.category === 'debt_cleanup');
    expect(logging?.safeToAutoApply).toBe(true);
    expect(logging?.evidence[0]?.relativePath).toBe('x.ts');
    expect(cleanup?.safeToAutoApply).toBe(false);
  });

  it('groups multiple debt markers in the same file into one proposal', () => {
    const debt = emptyDebt();
    debt.findings = [
      { kind: 'debt_marker', marker: 'TODO', severity: 'medium', relativePath: 'z.ts', line: 1, snippet: '// TODO a', why: 'd' },
      { kind: 'debt_marker', marker: 'FIXME', severity: 'high', relativePath: 'z.ts', line: 2, snippet: '// FIXME b', why: 'd' },
    ];
    const proposals = buildImprovementProposals({ debt, drift: emptyDrift() });
    const cleanup = proposals.filter((p) => p.category === 'debt_cleanup');
    expect(cleanup.length).toBe(1);
    expect(cleanup[0].evidence.length).toBe(2);
    expect(cleanup[0].severity).toBe('high'); // highest of the group
  });

  it('turns high/critical architecture drift into an owner-gated architecture proposal', () => {
    const drift = emptyDrift();
    drift.drift = [{ metric: 'cycles', baseline: 0, current: 3, delta: 3, severity: 'critical', note: 'new cycles' }];
    const proposals = buildImprovementProposals({ debt: emptyDebt(), drift });
    const arch = proposals.find((p) => p.category === 'architecture');
    expect(arch).toBeDefined();
    expect(arch?.severity).toBe('critical');
    expect(arch?.safeToAutoApply).toBe(false);
  });
});
