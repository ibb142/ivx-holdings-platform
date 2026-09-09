import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const file of ['ivx-lazy-bridge.js', 'ivx-lazy-bridge-20260822.js']) {
  for (const [handler, method] of [['handlePortalLogin', 'handleLogin'], ['handleForgotPasswordSubmit', 'forgotSubmit']]) {
    test(`${file}: ${handler} cancels navigation before the module loads`, async () => {
      const window: Record<string, unknown> = {};
      runInNewContext(readFileSync(new URL(`../../expo/ivxholding-landing/${file}`, import.meta.url), 'utf8'), { window, console });
      let release!: (module: Record<string, (event: unknown) => void>) => void;
      window._ivxLazyLoad = () => new Promise(resolve => { release = resolve; });
      let prevented = false;
      let delegated = 0;
      const event = { preventDefault: () => { prevented = true; } };
      (window[handler] as (event: unknown) => void)(event);
      expect(prevented).toBe(true);
      expect(delegated).toBe(0);
      release({ [method]: received => { expect(received).toBe(event); delegated++; } });
      await Promise.resolve();
      expect(delegated).toBe(1);
    });
  }
}
