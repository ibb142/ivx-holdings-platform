import { describe, expect, test } from 'bun:test';

import { buildIVXS3PresignedPutUrl, isValidIVXApkDistributionKey } from './ivx-apk-distribution';

describe('isValidIVXApkDistributionKey', () => {
  test('accepts apk and aab keys under apk/ prefix', () => {
    expect(isValidIVXApkDistributionKey('apk/ivx-holdings-v1.4.7.apk')).toBe(true);
    expect(isValidIVXApkDistributionKey('apk/ivx-holdings-v1.4.7.aab')).toBe(true);
  });

  test('rejects traversal, other prefixes, and unsafe characters', () => {
    expect(isValidIVXApkDistributionKey('apk/../index.html')).toBe(false);
    expect(isValidIVXApkDistributionKey('landing/app.apk')).toBe(false);
    expect(isValidIVXApkDistributionKey('apk/app.exe')).toBe(false);
    expect(isValidIVXApkDistributionKey('apk/a b.apk')).toBe(false);
    expect(isValidIVXApkDistributionKey('app.apk')).toBe(false);
  });
});

describe('buildIVXS3PresignedPutUrl', () => {
  const fixedInput = {
    bucket: 'ivxholding.com',
    region: 'us-east-1',
    key: 'apk/ivx-holdings-v1.4.7.apk',
    accessKeyId: 'AKIAEXAMPLEKEY123456',
    secretAccessKey: 'testSecretKeyValue/testSecretKeyValue123',
    expiresSeconds: 900,
    now: new Date('2026-07-18T15:30:00.000Z'),
  };

  test('produces a deterministic well-formed SigV4 query presigned URL', () => {
    const first = buildIVXS3PresignedPutUrl(fixedInput);
    const second = buildIVXS3PresignedPutUrl({ ...fixedInput });
    expect(first).toBe(second);

    const url = new URL(first);
    expect(url.hostname).toBe('s3.us-east-1.amazonaws.com');
    expect(url.pathname).toBe('/ivxholding.com/apk/ivx-holdings-v1.4.7.apk');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260718T153000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIAEXAMPLEKEY123456/20260718/us-east-1/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('signature changes when the key or secret changes', () => {
    const base = new URL(buildIVXS3PresignedPutUrl(fixedInput)).searchParams.get('X-Amz-Signature');
    const otherKey = new URL(buildIVXS3PresignedPutUrl({ ...fixedInput, key: 'apk/other.apk' })).searchParams.get('X-Amz-Signature');
    const otherSecret = new URL(buildIVXS3PresignedPutUrl({ ...fixedInput, secretAccessKey: 'differentSecretDifferentSecret12345' })).searchParams.get('X-Amz-Signature');
    expect(otherKey).not.toBe(base);
    expect(otherSecret).not.toBe(base);
  });
});
