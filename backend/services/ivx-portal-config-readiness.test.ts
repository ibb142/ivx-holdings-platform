import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const filename of ['ivx-portal.js', 'ivx-portal-20260822.js']) {
  describe(filename, () => {
    test('reset waits for delayed configuration and sends exactly once', async () => {
      const elements: Record<string, any> = {};
      for (const id of ['portal-forgot-error', 'portal-forgot-success', 'portal-forgot-btn', 'portal-forgot-email']) elements[id] = { style: {}, value: 'qa@example.com' };
      let calls = 0;
      const window: any = { location: { origin: 'https://ivxholding.com' } };
      const timers: Array<() => void> = [];
      runInNewContext(readFileSync(new URL(`../../expo/ivxholding-landing/${filename}`, import.meta.url), 'utf8'), {
        window, document: { getElementById: (id: string) => elements[id] }, console,
        setTimeout: (callback: () => void) => { timers.push(callback); },
      });
      const pending = window.IVXPortal.forgotSubmit({ preventDefault() {} });
      expect(calls).toBe(0);
      expect(elements['portal-forgot-btn'].disabled).toBe(true);
      window.IVX_SUPABASE_URL = 'https://example.supabase.co';
      window.IVX_SUPABASE_ANON_KEY = 'sb_publishable_test';
      window.supabase = { createClient: () => ({ auth: { resetPasswordForEmail: async () => { calls++; return {}; } } }) };
      timers.shift()?.();
      await pending;
      expect(calls).toBe(1);
      expect(elements['portal-forgot-success'].style.display).toBe('block');
      expect(elements['portal-forgot-btn'].disabled).toBe(false);
    });
  });
}
