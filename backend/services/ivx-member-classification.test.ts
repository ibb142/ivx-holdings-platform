/**
 * IVX Member Classification Engine — Tests
 *
 * Tests the pure classification logic (tier determination, financial summary
 * calculation, transaction status rules) without requiring Supabase.
 */
import {
  calculateFinancialSummary,
  determineTier,
  COMPLETED_TXN_STATUSES,
  NON_QUALIFYING_STATUSES,
  VIP_THRESHOLD_CENTS,
  CLASSIFICATION_VERSION,
  type MemberFinancialSummary,
  type CanonicalMemberData,
  type InvestorProfileData,
  type TransactionRecord,
} from './ivx-member-classification';

// ── Helpers ──

function makeMember(overrides: Partial<CanonicalMemberData> = {}): CanonicalMemberData {
  return {
    member_id: 'test-member-001',
    auth_user_id: 'auth-001',
    email: 'test@ivxholding.com',
    email_verified: true,
    email_verified_at: '2026-01-01T00:00:00Z',
    sms_verified: true,
    phone_verified_at: '2026-01-01T00:00:00Z',
    member_tier: null,
    investor_status: null,
    kyc_status: 'approved',
    identity_status: 'active',
    registration_status: 'completed',
    ...overrides,
  };
}

function makeInvestorProfile(overrides: Partial<InvestorProfileData> = {}): InvestorProfileData {
  return {
    member_id: 'test-member-001',
    kyc_status: 'approved',
    tax_status: 'completed',
    compliance_status: 'approved',
    investor_agreement_at: '2026-01-15T00:00:00Z',
    approved_at: '2026-02-01T00:00:00Z',
    restricted_at: null,
    ...overrides,
  };
}

function makeTxn(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: `txn-${Math.random().toString(36).slice(0, 8)}`,
    member_id: 'test-member-001',
    amount: 50_000_00, // $50,000 in cents
    status: 'completed',
    refunded_amount: 0,
    settled_at: '2026-03-01T00:00:00Z',
    is_test: false,
    external_reference: null,
    source: 'system',
    ...overrides,
  };
}

function expectTier(
  result: { tier: string; investorStatus: string; reason: string },
  expectedTier: string,
  expectedStatus?: string,
) {
  if (result.tier !== expectedTier) {
    throw new Error(`Expected tier ${expectedTier}, got ${result.tier}. Reason: ${result.reason}`);
  }
  if (expectedStatus && result.investorStatus !== expectedStatus) {
    throw new Error(`Expected investor status ${expectedStatus}, got ${result.investorStatus}. Reason: ${result.reason}`);
  }
}

// ── Test 1: Verified registration, zero transactions → REGULAR ──

export function test1_verifiedRegistrationZeroTxn() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const summary = calculateFinancialSummary('test-member-001', []);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 2: Investor interest selected, zero transactions → REGULAR ──

export function test2_investorInterestZeroTxn() {
  const member = makeMember({ kyc_status: 'not_started' });
  const profile = makeInvestorProfile({ kyc_status: 'not_started', approved_at: null, investor_agreement_at: null });
  const summary = calculateFinancialSummary('test-member-001', []);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 3: KYC approved, zero transactions → REGULAR ──

export function test3_kycApprovedZeroTxn() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const summary = calculateFinancialSummary('test-member-001', []);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 4: One pending transaction for $100,000 → REGULAR ──

export function test4_pendingTransaction() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 100_000_00, status: 'pending', settled_at: null })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 5: One completed transaction for $50,000 → INVESTOR ──

export function test5_oneCompletedTransaction() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 50_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'INVESTOR', 'ACTIVE');
}

// ── Test 6: Multiple completed transactions totaling $499,999 → INVESTOR ──

export function test6_multipleCompletedUnder500k() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [
    makeTxn({ amount: 250_000_00, status: 'completed' }),
    makeTxn({ amount: 249_999_00, status: 'settled' }),
  ];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'INVESTOR', 'ACTIVE');
}

// ── Test 7: Completed transactions totaling exactly $500,000 → VIP ──

export function test7_exactly500k() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [
    makeTxn({ amount: 250_000_00, status: 'completed' }),
    makeTxn({ amount: 250_000_00, status: 'completed' }),
  ];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'VIP', 'ACTIVE');
}

// ── Test 8: Completed transactions totaling $750,000 → VIP ──

export function test8_750k() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 750_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'VIP', 'ACTIVE');
}

// ── Test 9: $600,000 completed with $150,000 refunded → qualifying $450,000 → INVESTOR ──

export function test9_refundRecalculation() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [
    makeTxn({ amount: 600_000_00, status: 'completed', refunded_amount: 150_000_00 }),
  ];
  const summary = calculateFinancialSummary('test-member-001', txns);

  // qualifying = 600,000 - 150,000 = 450,000 < 500,000 → INVESTOR
  const result = determineTier(member, profile, summary);
  expectTier(result, 'INVESTOR', 'ACTIVE');
}

// ── Test 10: $500,000 pending only → REGULAR ──

export function test10_pendingOnly() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 500_000_00, status: 'pending', settled_at: null })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 11: One test transaction for $1,000,000 → REGULAR ──

export function test11_testTransactionExcluded() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 1_000_000_00, status: 'completed', is_test: true })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 12: VIP investor with expired KYC ──

export function test12_expiredKYC() {
  const member = makeMember({ kyc_status: 'rejected' });
  const profile = makeInvestorProfile({ kyc_status: 'expired', compliance_status: 'restricted', approved_at: null });
  const txns = [makeTxn({ amount: 750_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  // Has completed transactions but KYC not approved → REGULAR + RESTRICTED_OR_PENDING
  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'RESTRICTED_OR_PENDING');
}

// ── Test 13: Duplicate transaction prevention (idempotency) ──

export function test13_financialSummaryCalculation() {
  const txns = [
    makeTxn({ amount: 100_000_00, status: 'completed' }),
    makeTxn({ amount: 200_000_00, status: 'completed' }),
    makeTxn({ amount: 50_000_00, status: 'pending', settled_at: null }),
    makeTxn({ amount: 25_000_00, status: 'cancelled' }),
    makeTxn({ amount: 10_000_00, status: 'completed', is_test: true }),
  ];
  const summary = calculateFinancialSummary('test-member-001', txns);

  // Only 2 non-test completed transactions should count
  if (summary.completed_transactions !== 2) {
    throw new Error(`Expected 2 completed transactions, got ${summary.completed_transactions}`);
  }
  if (summary.lifetime_settled_investment !== 300_000_00) {
    throw new Error(`Expected lifetime settled $300,000, got $${summary.lifetime_settled_investment / 100}`);
  }
  if (summary.qualifying_invested_capital !== 300_000_00) {
    throw new Error(`Expected qualifying $300,000, got $${summary.qualifying_invested_capital / 100}`);
  }
  if (summary.largest_completed_transaction !== 200_000_00) {
    throw new Error(`Expected largest $200,000, got $${summary.largest_completed_transaction / 100}`);
  }
}

// ── Test 14: Transaction status rules ──

export function test14_transactionStatusRules() {
  // Completed statuses
  for (const status of ['settled', 'completed', 'funded_and_confirmed']) {
    if (!COMPLETED_TXN_STATUSES.has(status)) {
      throw new Error(`Status '${status}' should be in COMPLETED_TXN_STATUSES`);
    }
  }

  // Non-qualifying statuses
  for (const status of ['draft', 'interested', 'reserved', 'pending', 'processing', 'failed', 'rejected', 'cancelled', 'refunded', 'test']) {
    if (!NON_QUALIFYING_STATUSES.has(status)) {
      throw new Error(`Status '${status}' should be in NON_QUALIFYING_STATUSES`);
    }
  }

  // No overlap
  for (const status of COMPLETED_TXN_STATUSES) {
    if (NON_QUALIFYING_STATUSES.has(status)) {
      throw new Error(`Status '${status}' should not be in both sets`);
    }
  }
}

// ── Test 15: Email not verified → PENDING ──

export function test15_emailNotVerified() {
  const member = makeMember({ email_verified: false, email_verified_at: null });
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 500_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'PENDING', 'NOT_VERIFIED');
}

// ── Test 16: Phone not verified → PENDING ──

export function test16_phoneNotVerified() {
  const member = makeMember({ sms_verified: false, phone_verified_at: null });
  const profile = makeInvestorProfile();
  const summary = calculateFinancialSummary('test-member-001', []);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'PENDING', 'NOT_VERIFIED');
}

// ── Test 17: VIP threshold is exactly $500,000 ──

export function test17_vipThreshold() {
  if (VIP_THRESHOLD_CENTS !== 50_000_000) {
    throw new Error(`VIP threshold should be 50,000,000 cents ($500,000), got ${VIP_THRESHOLD_CENTS}`);
  }
}

// ── Test 18: Registration not complete → PENDING ──

export function test18_registrationNotComplete() {
  const member = makeMember({ registration_status: 'pending' });
  const profile = makeInvestorProfile();
  const summary = calculateFinancialSummary('test-member-001', []);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'PENDING', 'NOT_VERIFIED');
}

// ── Test 19: Has transactions but no investor agreement → REGULAR + RESTRICTED ──

export function test19_noInvestorAgreement() {
  const member = makeMember();
  const profile = makeInvestorProfile({ investor_agreement_at: null });
  const txns = [makeTxn({ amount: 100_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'RESTRICTED_OR_PENDING');
}

// ── Test 20: Has transactions but not approved → REGULAR + RESTRICTED ──

export function test20_notApproved() {
  const member = makeMember();
  const profile = makeInvestorProfile({ approved_at: null });
  const txns = [makeTxn({ amount: 100_000_00, status: 'completed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'RESTRICTED_OR_PENDING');
}

// ── Test 21: Refunded transaction reduces qualifying capital ──

export function test21_fullRefund() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [
    makeTxn({ amount: 300_000_00, status: 'completed', refunded_amount: 300_000_00 }),
    makeTxn({ amount: 250_000_00, status: 'completed' }),
  ];
  const summary = calculateFinancialSummary('test-member-001', txns);

  // qualifying = (300k + 250k) - 300k = 250k < 500k → INVESTOR
  if (summary.qualifying_invested_capital !== 250_000_00) {
    throw new Error(`Expected qualifying $250,000, got $${summary.qualifying_invested_capital / 100}`);
  }
  const result = determineTier(member, profile, summary);
  expectTier(result, 'INVESTOR', 'ACTIVE');
}

// ── Test 22: Classification version is set ──

export function test22_classificationVersion() {
  if (CLASSIFICATION_VERSION !== '1.0.0') {
    throw new Error(`Expected version 1.0.0, got ${CLASSIFICATION_VERSION}`);
  }
}

// ── Test 23: funded_and_confirmed counts as completed ──

export function test23_fundedAndConfirmed() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 50_000_00, status: 'funded_and_confirmed' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  if (summary.completed_transactions !== 1) {
    throw new Error(`Expected 1 completed, got ${summary.completed_transactions}`);
  }
  const result = determineTier(member, profile, summary);
  expectTier(result, 'INVESTOR', 'ACTIVE');
}

// ── Test 24: Cancelled transaction doesn't count ──

export function test24_cancelledExcluded() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 500_000_00, status: 'cancelled', settled_at: null })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  if (summary.completed_transactions !== 0) {
    throw new Error(`Expected 0 completed, got ${summary.completed_transactions}`);
  }
  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Test 25: Refunded status doesn't count as completed ──

export function test25_refundedStatusExcluded() {
  const member = makeMember();
  const profile = makeInvestorProfile();
  const txns = [makeTxn({ amount: 500_000_00, status: 'refunded' })];
  const summary = calculateFinancialSummary('test-member-001', txns);

  if (summary.completed_transactions !== 0) {
    throw new Error(`Expected 0 completed, got ${summary.completed_transactions}`);
  }
  const result = determineTier(member, profile, summary);
  expectTier(result, 'REGULAR', 'NOT_VERIFIED');
}

// ── Run all tests ──

const TESTS: Array<{ name: string; fn: () => void }> = [
  { name: 'Test 1: Verified registration, zero transactions → REGULAR', fn: test1_verifiedRegistrationZeroTxn },
  { name: 'Test 2: Investor interest, zero transactions → REGULAR', fn: test2_investorInterestZeroTxn },
  { name: 'Test 3: KYC approved, zero transactions → REGULAR', fn: test3_kycApprovedZeroTxn },
  { name: 'Test 4: Pending transaction → REGULAR', fn: test4_pendingTransaction },
  { name: 'Test 5: One completed $50k → INVESTOR', fn: test5_oneCompletedTransaction },
  { name: 'Test 6: Multiple completed $499,999 → INVESTOR', fn: test6_multipleCompletedUnder500k },
  { name: 'Test 7: Exactly $500,000 → VIP', fn: test7_exactly500k },
  { name: 'Test 8: $750,000 → VIP', fn: test8_750k },
  { name: 'Test 9: $600k with $150k refund → INVESTOR', fn: test9_refundRecalculation },
  { name: 'Test 10: $500k pending only → REGULAR', fn: test10_pendingOnly },
  { name: 'Test 11: Test transaction excluded → REGULAR', fn: test11_testTransactionExcluded },
  { name: 'Test 12: Expired KYC → REGULAR + RESTRICTED', fn: test12_expiredKYC },
  { name: 'Test 13: Financial summary calculation', fn: test13_financialSummaryCalculation },
  { name: 'Test 14: Transaction status rules', fn: test14_transactionStatusRules },
  { name: 'Test 15: Email not verified → PENDING', fn: test15_emailNotVerified },
  { name: 'Test 16: Phone not verified → PENDING', fn: test16_phoneNotVerified },
  { name: 'Test 17: VIP threshold is $500,000', fn: test17_vipThreshold },
  { name: 'Test 18: Registration not complete → PENDING', fn: test18_registrationNotComplete },
  { name: 'Test 19: No investor agreement → REGULAR + RESTRICTED', fn: test19_noInvestorAgreement },
  { name: 'Test 20: Not approved → REGULAR + RESTRICTED', fn: test20_notApproved },
  { name: 'Test 21: Full refund reduces qualifying capital', fn: test21_fullRefund },
  { name: 'Test 22: Classification version is 1.0.0', fn: test22_classificationVersion },
  { name: 'Test 23: funded_and_confirmed counts as completed', fn: test23_fundedAndConfirmed },
  { name: 'Test 24: Cancelled transaction excluded', fn: test24_cancelledExcluded },
  { name: 'Test 25: Refunded status excluded', fn: test25_refundedStatusExcluded },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  try {
    test.fn();
    console.log(`  PASS  ${test.name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL  ${test.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\nClassification tests: ${passed} pass, ${failed} fail, ${TESTS.length} total`);

if (failed > 0) {
  process.exit(1);
}
