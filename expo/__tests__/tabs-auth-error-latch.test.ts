import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const EXPO_DIR = join(import.meta.dir, '..');
const TABS_DIR = join(EXPO_DIR, 'app', '(tabs)');
const layoutSource = readFileSync(join(TABS_DIR, '_layout.tsx'), 'utf8');

function readTabs(file: string): string {
  return readFileSync(join(TABS_DIR, file), 'utf8');
}

describe('Tabs auth transition regression', () => {
  it('renders a real transition surface while auth is loading', () => {
    expect(layoutSource).toContain('function AuthTransitionScreen');
    expect(layoutSource).toContain('if (isLoading) {');
    expect(layoutSource).toContain('<AuthTransitionScreen message="Loading secure session…" />');
    expect(layoutSource).toContain('testID="tabs-auth-transition"');
  });

  it('renders a transition surface while redirecting unauthenticated users', () => {
    expect(layoutSource).toContain('if (!openAccess && !isAuthenticated) {');
    expect(layoutSource).toContain('<AuthTransitionScreen message="Opening sign in…" />');
    expect(layoutSource).toContain("router.replace('/login')");
  });

  it('does not redirect until auth loading has completed', () => {
    expect(layoutSource).toContain('if (openAccess || isLoading || isAuthenticated)');
    expect(layoutSource).toContain('return;');
  });

  it('logs redirect failures instead of swallowing the transition', () => {
    expect(layoutSource).toContain("logStartupError('ROUTER_READY', err)");
  });

  it('does not use the removed latched auth error state machine', () => {
    expect(layoutSource).not.toContain('authInitError');
    expect(layoutSource).not.toContain('loadingTimedOut');
    expect(layoutSource).not.toContain('TABS_LOADING_TIMEOUT_MS');
  });

  it('never returns null from the tabs layout auth branches', () => {
    const beforeTabs = layoutSource.slice(0, layoutSource.indexOf('<Tabs'));
    expect(beforeTabs).not.toContain('return null');
  });
});

describe('No tab screen may render itself away', () => {
  const screens = readdirSync(TABS_DIR).filter(
    (file) => file.endsWith('.tsx') && file !== '_layout.tsx',
  );

  it('finds tab screens', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it('no exported tab screen returns null from its own body', () => {
    const offenders: string[] = [];
    for (const file of screens) {
      const source = readTabs(file);
      const lines = source.split('\n');
      const defaultExportLine = lines.findIndex((line) => line.startsWith('export default function'));
      if (defaultExportLine === -1) continue;
      lines.slice(defaultExportLine).forEach((line, index) => {
        if (/^ {2}(if \(.*\) )?return null;/.test(line)) {
          offenders.push(`${file}:${defaultExportLine + index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every tab screen exports a component', () => {
    for (const file of screens) {
      expect(readTabs(file)).toContain('export default function');
    }
  });
});
