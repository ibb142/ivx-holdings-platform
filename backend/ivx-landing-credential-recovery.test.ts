import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const deploySource = readFileSync(new URL('./api/ivx-landing-full-deploy.ts', import.meta.url), 'utf8');
const cloudFrontSource = readFileSync(new URL('./services/ivx-cloudfront-invalidation.ts', import.meta.url), 'utf8');

describe('landing credential recovery wiring', () => {
  test('accepts canonical and IVX-prefixed AWS names from Owner Variables', () => {
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'IVX_AWS_ACCESS_KEY_ID',
      'IVX_AWS_SECRET_ACCESS_KEY',
      'IVX_AWS_READONLY_ACCESS_KEY_ID',
      'IVX_AWS_READONLY_SECRET_ACCESS_KEY',
    ]) {
      expect(deploySource).toContain(`'${name}'`);
    }
  });

  test('passes recovered credentials to CloudFront without logging their values', () => {
    expect(deploySource).toContain('credentials: {');
    expect(deploySource).toContain('accessKeyId: accessKey');
    expect(deploySource).toContain('secretAccessKey: secretKey');
    expect(cloudFrontSource).toContain('input.credentials?.accessKeyId.trim()');
    expect(cloudFrontSource).toContain('input.credentials?.secretAccessKey.trim()');
    expect(cloudFrontSource).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:accessKey|secretKey)/);
  });
});
