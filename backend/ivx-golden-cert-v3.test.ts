import { GOLDEN_CERT_V3_MARKER } from './services/ivx-golden-cert-v3';

describe('GOLDEN_CERT_V3_MARKER', () => {
  it('should equal the expected value', () => {
    expect(GOLDEN_CERT_V3_MARKER).toBe('IVX-GOLDEN-CERT-V7-2026-08-23');
  });
});
