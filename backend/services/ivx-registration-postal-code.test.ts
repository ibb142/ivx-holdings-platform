import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { validRegistrationPostalCode } from './ivx-registration-postal-code';
test('US ZIP rejects malformed supplied codes and accepts ZIP+4', () => {
  for (const code of ['abc', '3310', '331011', '33101-123', '<script>']) assert.equal(validRegistrationPostalCode(code, 'US'), false, code);
  for (const code of ['', '33101', ' 33101-1234 ']) assert.equal(validRegistrationPostalCode(code, 'US'), true, code);
});
test('international postal codes are not forced to US digits', () => {
  for (const [code, country] of [['SW1A 1AA', 'GB'], ['K1A 0B1', 'CA'], ['110111', 'CO']]) assert.equal(validRegistrationPostalCode(code, country), true);
});
