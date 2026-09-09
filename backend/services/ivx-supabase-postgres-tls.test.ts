import { expect, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { supabasePostgresTls, withoutPostgresUrlTlsOptions } from './ivx-supabase-postgres-tls';

test('pool URL cannot replace the verified Supabase CA configuration', () => {
  const url = new URL(withoutPostgresUrlTlsOptions('postgresql://postgres:example@db.example.supabase.co/postgres?sslmode=disable&sslrootcert=untrusted&ssl=false&application_name=qa'));
  expect(url.searchParams.has('sslmode')).toBe(false);
  expect(url.searchParams.has('sslrootcert')).toBe(false);
  expect(url.searchParams.has('ssl')).toBe(false);
  expect(url.searchParams.get('application_name')).toBe('qa');
  const ssl = supabasePostgresTls();
  expect(ssl.rejectUnauthorized).toBe(true);
  const cert = new X509Certificate(ssl.ca[ssl.ca.length - 1]!);
  expect(cert.fingerprint256).toBe('80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
});
