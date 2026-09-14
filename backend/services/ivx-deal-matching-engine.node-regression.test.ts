import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDealMatching } from './ivx-deal-matching-engine';

// Ensure that runDealMatching generates a Jacksonville deal under failure

test('runDealMatching includes Jacksonville deal when projects read fails', async () => {
  const result = await runDealMatching();
  const hasJacksonville = result.deals.some(deal => deal.dealName === 'Jacksonville');
  assert.strictEqual(hasJacksonville, true, 'Expected a Jacksonville deal to be included');
});
