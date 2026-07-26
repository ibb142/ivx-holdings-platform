import { describe, expect, test } from 'bun:test';
import { handleLandingPaymentCreateRequest, handleLandingPaymentOptionsRequest } from './api/ivx-landing-payment-sync';
describe('IVX Landing Payment Sync API — landing page transactions', () => {
    test('CORS preflight returns 204', async () => {
        const response = await handleLandingPaymentOptionsRequest();
        expect(response.status).toBe(204);
    });
    test('rejects missing investorEmail', async () => {
        const request = new Request('https://api.ivxholding.com/api/ivx/payments/landing-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dealId: 'deal-test-001',
                dealTitle: 'Casa Test',
                investmentType: 'JV Direct Investment',
                amount: 5000,
                paymentMethod: 'wire',
                investorName: 'Test Investor',
                termsAccepted: true,
                source: 'landing_page_test',
            }),
        });
        const response = await handleLandingPaymentCreateRequest(request);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.error).toContain('investorEmail');
    });
    test('rejects missing amount', async () => {
        const request = new Request('https://api.ivxholding.com/api/ivx/payments/landing-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dealId: 'deal-test-001',
                dealTitle: 'Casa Test',
                investmentType: 'JV Direct Investment',
                paymentMethod: 'wire',
                investorEmail: 'investor+test@ivxholding.com',
                investorName: 'Test Investor',
                termsAccepted: true,
                source: 'landing_page_test',
            }),
        });
        const response = await handleLandingPaymentCreateRequest(request);
        expect([400, 500]).toContain(response.status);
        const body = await response.json();
        expect(body.ok).toBe(false);
    });
});
