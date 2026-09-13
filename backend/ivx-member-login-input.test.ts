import { expect, test } from 'bun:test';
import { memberLoginInput } from './services/ivx-member-login-input';

test('malformed login inputs are rejected synchronously within the 500 ms budget', () => {
  const inputs: unknown[] = [null, [], 'email', {}, { email: 2, password: 'x' },
    { email: 'member@ivxholding.com', password: null }, { email: 'x', password: 'x' },
    { email: 'a@@ivxholding.com', password: 'x' }, { email: 'a@b..com', password: 'x' },
    { email: 'a b@ivxholding.com', password: 'x' }, { email: 'a@ivxholding.com', password: '' },
    { email: 'x'.repeat(255) + '@ivxholding.com', password: 'x' },
    { email: 'a@ivxholding.com', password: 'x'.repeat(1025) },
    ...['test', 'invalid', 'localhost', 'local', 'example'].map(tld => ({ email: `probe@invalid.ivxholding.${tld}`, password: 'Wrong-Password-1!' }))];
  const start = performance.now();
  for (let i = 0; i < 100; i++) for (const input of inputs) expect(memberLoginInput(input)).toBeNull();
  expect(performance.now() - start).toBeLessThan(500);
});
test('real-looking credentials preserve passwords and require actual authentication', () => {
  expect(memberLoginInput({ email: ' Member+tag@IVXHolding.com ', password: ' leading and trailing ' }))
    .toEqual({ email: 'member+tag@ivxholding.com', password: ' leading and trailing ' });
  expect(memberLoginInput({ email: 'test@company.com', password: 'x' })).not.toBeNull();
});
