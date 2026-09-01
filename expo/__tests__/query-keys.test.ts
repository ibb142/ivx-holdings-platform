import { describe, expect, test } from 'bun:test';
import { queryKeys } from '../lib/query-keys';

describe('queryKeys', () => {
  test('auth.profile is stable', () => {
    expect(queryKeys.auth.profile).toEqual(['user-profile']);
  });

  test('wallet.balance is stable', () => {
    expect(queryKeys.wallet.balance).toEqual(['wallet-balance']);
  });

  test('wallet.transactions returns correct key', () => {
    expect(queryKeys.wallet.transactions(1, 20)).toEqual(['transactions', 1, 20]);
    expect(queryKeys.wallet.transactions(2, 10)).toEqual(['transactions', 2, 10]);
  });

  test('properties.detail includes id', () => {
    expect(queryKeys.properties.detail('abc-123')).toEqual(['property', 'abc-123']);
  });

  test('all keys are readonly arrays', () => {
    expect(Array.isArray(queryKeys.holdings.all)).toBe(true);
    expect(Array.isArray(queryKeys.market.data)).toBe(true);
    expect(Array.isArray(queryKeys.notifications.all)).toBe(true);
  });
});
