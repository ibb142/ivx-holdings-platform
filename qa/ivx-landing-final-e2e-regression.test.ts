import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('landing final E2E regressions', () => {
  test('footer links and chat attachment expose real 24px boxes', () => {
    const css = readFileSync('expo/ivxholding-landing/ivx-styles.css', 'utf8');
    expect(css).toContain('.footer-legal-links a,');
    expect(css).toContain('display: inline-flex;');
    expect(css).toContain('#landing-chat-attach');
    expect(css).toContain('height: 24px !important;');
  });

  test('landing repair paths use GitHub OIDC rather than a stale system secret', () => {
    const workflow = readFileSync('.github/workflows/landing-112-3h-enterprise-human-qa.yml', 'utf8');
    expect(workflow).toContain('X-IVX-GitHub-OIDC');
    expect(workflow).not.toContain('X-IVX-System-Key');
  });

  test('real 112 certificate allows the synchronous start call to finish', () => {
    const workflow = readFileSync('.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml', 'utf8');
    expect(workflow).toContain('curl -sS -m 180');
  });
});
