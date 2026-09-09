import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

// Public CA linked by Supabase Studio's ssl:certificate_url setting:
// https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
const ca = [...rootCertificates, readFileSync(new URL('../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8')];
export function supabasePostgresTls() {
  return { rejectUnauthorized: true, ca };
}

// pg parses URL SSL parameters after the supplied options and can replace ca.
export function withoutPostgresUrlTlsOptions(raw: string): string {
  const url = new URL(raw);
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(name);
  return url.href;
}
