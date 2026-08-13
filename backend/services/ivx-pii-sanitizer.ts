/**
 * IVX PII Sanitizer (item 168)
 *
 * Masks emails, phone numbers, SSNs, EINs, account numbers, and tokens
 * in log output so sensitive data never reaches logs, URLs, or analytics.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const EIN_RE = /\b\d{2}-\d{7}\b/g;
const ACCOUNT_RE = /\b\d{6,}\b/g;
const TOKEN_RE = /(Bearer\s+)[a-zA-Z0-9._-]+/gi;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return local.slice(0, 1) + '***@' + domain;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return '+*' + '*'.repeat(digits.length - 4) + digits.slice(-4);
}

function maskAccountNumber(account: string): string {
  if (account.length <= 4) return '****';
  return '*'.repeat(account.length - 4) + account.slice(-4);
}

export function sanitizePII(input: string): string {
  if (!input) return input;
  return input
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(PHONE_RE, (m) => maskPhone(m))
    .replace(SSN_RE, '***-**-****')
    .replace(EIN_RE, '**-*******')
    .replace(ACCOUNT_RE, (m) => maskAccountNumber(m))
    .replace(TOKEN_RE, '$1****');
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizePII(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === 'string' ? sanitizePII(v) :
        typeof v === 'object' && v !== null ? sanitizeObject(v as Record<string, unknown>) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const IVX_PII_SANITIZER_MARKER = 'ivx-pii-sanitizer-2026-08-13';
