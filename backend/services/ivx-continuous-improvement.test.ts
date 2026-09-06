import { describe, it, expect } from 'bun:test';
import { scanContentForDebt, classifyOversizedFile } from './ivx-tech-debt-scanner';
import { compareArchitectureSnapshots, type ArchitectureSnapshot } from './ivx-architecture-drift';
import { buildImprovementProposals } from './ivx-continuous-improvement';
import type { TechDebtReport } from './ivx-tech-debt-scanner';
import type { ArchitectureDriftReport } from './ivx-architecture-drift';

describe('scanContentForDebt', () => {
  it('flags TODO/FIXME only inside real comment lines, never string literals', () => {
    const findings = scanContentForDebt('a.ts', ['// TODO: wire this up', '/* FIXME: broken */', 'const label = "TODO not a real marker";'].join('\n'));
    expect(findings.filter((f) => f.kind === 'debt_marker').map((f) => f.marker)).toContain('TODO');
    expect(findings.filter((f) => f.kind === 'debt_marker').map((f) => f.marker)).toContain('FIXME');
    expect(findings.filter((f) => f.line === 3).length).toBe(0);
  });
  it('assigns higher severity to FIXME/HACK than TODO', () => { expect(scanContentForDebt('a.ts', '// FIXME later')[0].severity).toBe('high'); expect(scanContentForDebt('a.ts', '// TODO later')[0].severity).toBe('medium'); });
  it('detects truly empty catch blocks as high-severity freeze risk', () => { const fr = scanContentForDebt('a.ts', 'try { go(); } catch (e) { console.error('Caught error:', e); }').find((f) => f.marker === 'empty-catch'); expect(fr).toBeDefined(); expect(fr?.kind).toBe('freeze_risk'); expect(fr?.severity).toBe('high'); });
  it('does not misclassify a catch that logs the error as empty', () => { expect(scanContentForDebt('a.ts', "try { go(); } catch (e) { console.error('Error caught:', e); }").some((f) => f.marker === 'empty-catch')).toBe(false); });
  it('detects not-implemented throws and no-op JSX handlers as freeze risks', () => { expect(scanContentForDebt('a.ts', "throw new Error('not implemented yet');").some((f) => f.marker === 'not-implemented')).toBe(true); expect(scanContentForDebt('a.tsx', '<Button onPress={() => {}} />').some((f) => f.marker === 'noop-handler')).toBe(true); });
  it('returns no findings for clean content', () => expect(scanContentForDebt('a.ts', 'export const sum = (a: number, b: number) => a + b;')).toEqual([]));
  it('classifyOversizedFile flags large files only above threshold', () => { expect(classifyOversizedFile('small.ts', 500)).toBeNull(); expect(classifyOversizedFile('big.ts', 1500)?.severity).toBe('low'); expect(classifyOversizedFile('huge.ts', 3000)?.severity).toBe('high'); });
});

const base: ArchitectureSnapshot = { capturedAt: '2026-06-01T00:00:00Z', files: 100, services: 50, apis: 40, routes: 200, dependencies: 30, appScreens: 60, cycles: 0, topHotspotDegree: 10, available: true };
describe('compareArchitectureSnapshots', () => {
  it('reports no drift when nothing changed', () => { const r = compareArchitectureSnapshots(base, { ...base, capturedAt: 'later' }); expect(r.drift).toEqual([]); expect(r.overallSeverity).toBe('none'); });
  it('treats new import cycles as critical', () => { const r = compareArchitectureSnapshots(base, { ...base, cycles: 3 }); expect(r.drift.find((d) => d.metric === 'cycles')?.severity).toBe('critical'); });
  it('flags dependency growth', () => { const r = compareArchitectureSnapshots(base, { ...base, dependencies: 38 }); expect(r.drift.find((d) => d.metric === 'dependencies')?.severity).toBe('high'); });
  it('returns no-baseline message', () => { const r = compareArchitectureSnapshots(null, base); expect(r.overallSeverity).toBe('none'); expect(r.summary).toContain('No architecture baseline'); });
});

function emptyDebt(): TechDebtReport { return { marker: 'm', generatedAt: 'now', root: '/', durationMs: 1, filesScanned: 0, totals: { findings: 0, debtMarkers: 0, freezeRisks: 0, oversizedFiles: 0 }, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [] }; }
function emptyDrift(): ArchitectureDriftReport { return { marker: 'm', generatedAt: 'now', hasBaseline: false, baselineCapturedAt: null, baseline: null, current: { capturedAt: 'now', files: 0, services: 0, apis: 0, routes: 0, dependencies: 0, appScreens: 0, cycles: 0, topHotspotDegree: 0, available: false }, drift: [], overallSeverity: 'none', summary: '' }; }

describe('buildImprovementProposals', () => {
  it('produces no proposals from a clean codebase', () => expect(buildImprovementProposals({ debt: emptyDebt(), drift: emptyDrift() })).toEqual([]));
  it('marks empty-catch logging fix safe but debt markers owner-gated', () => { const debt = emptyDebt(); debt.findings = [{ kind: 'freeze_risk', marker: 'empty-catch', severity: 'high', relativePath: 'x.ts', line: 5, snippet: 'catch {}', why: 'silent' }, { kind: 'debt_marker', marker: 'TODO', severity: 'medium', relativePath: 'y.ts', line: 9, snippet: '// TODO', why: 'deferred' }]; const p = buildImprovementProposals({ debt, drift: emptyDrift() }); expect(p.find((x) => x.category === 'logging_fix')?.safeToAutoApply).toBe(true); expect(p.find((x) => x.category === 'debt_cleanup')?.safeToAutoApply).toBe(false); });
  it('groups debt markers in same file', () => { const debt = emptyDebt(); debt.findings = [{ kind: 'debt_marker', marker: 'TODO', severity: 'medium', relativePath: 'z.ts', line: 1, snippet: '// TODO a', why: 'd' }, { kind: 'debt_marker', marker: 'FIXME', severity: 'high', relativePath: 'z.ts', line: 2, snippet: '// FIXME b', why: 'd' }]; const p = buildImprovementProposals({ debt, drift: emptyDrift() }).filter((x) => x.category === 'debt_cleanup'); expect(p.length).toBe(1); expect(p[0].evidence.length).toBe(2); expect(p[0].severity).toBe('high'); });
  it('turns critical architecture drift into owner-gated proposal', () => { const drift = emptyDrift(); drift.drift = [{ metric: 'cycles', baseline: 0, current: 3, delta: 3, severity: 'critical', note: 'new cycles' }]; const arch = buildImprovementProposals({ debt: emptyDebt(), drift }).find((p) => p.category === 'architecture'); expect(arch?.severity).toBe('critical'); expect(arch?.safeToAutoApply).toBe(false); });
});
