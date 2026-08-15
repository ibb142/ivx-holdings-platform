import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  IVX_OWNER_SERVICE_USER_ID,
  getIVXOwnerEmailAllowlist,
  getIVXOwnerServiceToken,
} from '../../expo/shared/ivx/access-control';

const TOKEN_PREFIX = 'ivxos1';
const TOKEN_TTL_SECONDS = 60 * 60;

export type IVXOutageOwnerSession = {
  token: string;
  userId: string;
  email: string;
  role: 'owner';
  expiresAt: number;
};

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function resolveSigningSecret(): string {
  return getIVXOwnerServiceToken()
    || readEnv('IVX_AI_SYSTEM_SECRET')
    || readEnv('IVX_SYSTEM_SECRET')
    || readEnv('JWT_SECRET')
    || readEnv('SUPABASE_SERVICE_ROLE_KEY')
    || readEnv('SUPABASE_SERVICE_KEY')
    || readEnv('IVX_OWNER_PASSWORD')
    || readEnv('OWNER_NEW_PASSWORD');
}

function normalizedOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mintIVXOutageOwnerSession(emailInput: string): IVXOutageOwnerSession | null {
  const email = normalizedOwnerEmail(emailInput);
  if (!getIVXOwnerEmailAllowlist().includes(email)) return null;
  const secret = resolveSigningSecret();
  if (!secret) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const nonce = randomBytes(24).toString('base64url');
  const encodedEmail = encode(email);
  const payload = `${TOKEN_PREFIX}.${expiresAt}.${encodedEmail}.${nonce}`;
  const signature = signPayload(payload, secret);
  return {
    token: `${payload}.${signature}`,
    userId: IVX_OWNER_SERVICE_USER_ID,
    email,
    role: 'owner',
    expiresAt,
  };
}

export function verifyIVXOutageOwnerSession(tokenInput: string | null | undefined): IVXOutageOwnerSession | null {
  const token = (tokenInput ?? '').trim();
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) return null;

  const [, expiresRaw, encodedEmail, nonce, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  if (!encodedEmail || !nonce || !signature) return null;

  const secret = resolveSigningSecret();
  if (!secret) return null;
  const payload = `${TOKEN_PREFIX}.${expiresRaw}.${encodedEmail}.${nonce}`;
  const expected = signPayload(payload, secret);
  if (!safeEqual(signature, expected)) return null;

  let email = '';
  try {
    email = normalizedOwnerEmail(decode(encodedEmail));
  } catch {
    return null;
  }
  if (!getIVXOwnerEmailAllowlist().includes(email)) return null;

  return {
    token,
    userId: IVX_OWNER_SERVICE_USER_ID,
    email,
    role: 'owner',
    expiresAt,
  };
}
