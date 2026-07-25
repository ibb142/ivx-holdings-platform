import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  createLandingPaymentTransaction,
  confirmLandingPaymentTransaction,
  DEPLOYMENT_MARKER,
} from './services/ivx-landing-payment-sync';

describe('IVX Landing Payment Sync — real transactions only', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Provide a test Supabase configuration so the service can build a client.
    // Real network calls are not made in these unit tests; the assertions focus
    // on payload validation, error handling, and result/audit structure.
    // Clear all Supabase keys first so the service definitely uses the test anon key and fails to connect.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxOTAwMDAwMDAwfQ.test';
    // Ensure no payment-provider keys leak from other test files and make the provider look configured.
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.PLAID_SECRET;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_CLIENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('validates a real landing payment payload and produces structured IDs', async () => {
    const result = await createLandingPaymentTransaction({
      dealId: 'deal-test-001',
      dealTitle: 'Casa Test',
      investmentType: 'JV Direct Investment',
      amount: 5000,
      expectedRoi: 30,
      ownershipPct: 0.3571,
      paymentMethod: 'wire',
      investorEmail: 'investor+test@ivxholding.com',
      investorId: '00000000-0000-0000-0000-000000000000',
      investorName: 'Test Investor',
      termsAccepted: true,
      source: 'landing_page_test',
      ip: '127.0.0.1',
      userAgent: 'bun-test',
    });

    // With a fake Supabase URL the network insert fails; the service still
    // returns a structured result with the generated IDs and marks the
    // provider state correctly.
    expect(result.transactionId).toMatch(/^txn_\d+_[a-f0-9]+$/);
    expect(result.landingInvestmentId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.intentId).toMatch(/^INT-[A-Z0-9-]+$/);
    expect(result.status).toBe('pending_payment');
    expect(result.providerConfigured).toBe(false);
    expect(result.providerMode).toBe('none');
    expect(result.deploymentMarker).toBe(DEPLOYMENT_MARKER);
    expect(result.error).toBeDefined();
  });

  test('rejects invalid amounts and missing email', async () => {
    const zeroAmount = await createLandingPaymentTransaction({
      dealId: 'deal-test-002',
      dealTitle: 'Bad Deal',
      investmentType: 'JV Direct Investment',
      amount: 0,
      paymentMethod: 'bank',
      investorEmail: 'investor@ivxholding.com',
      termsAccepted: true,
      source: 'landing_page_test',
    });
    expect(zeroAmount.success).toBe(false);
    expect(zeroAmount.error).toContain('Invalid');

    const noEmail = await createLandingPaymentTransaction({
      dealId: 'deal-test-003',
      dealTitle: 'Bad Deal',
      investmentType: 'JV Direct Investment',
      amount: 1000,
      paymentMethod: 'bank',
      investorEmail: '',
      termsAccepted: true,
      source: 'landing_page_test',
    });
    expect(noEmail.success).toBe(false);
    expect(noEmail.error).toContain('email');
  });

  test('refuses to run when Supabase is not configured', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    const result = await createLandingPaymentTransaction({
      dealId: 'deal-test-004',
      dealTitle: 'No Supabase Deal',
      investmentType: 'JV Direct Investment',
      amount: 2500,
      paymentMethod: 'wire',
      investorEmail: 'owner+confirm@ivxholding.com',
      termsAccepted: true,
      source: 'landing_page_test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Supabase is not configured');
  });
});
