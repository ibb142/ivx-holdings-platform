/**
 * IVX Amazon SES email sender (owner-only outreach delivery).
 *
 * Replaces SendGrid as the active outbound email path. Sends a single email via
 * the AWS SES v2 API (`/v2/email/outbound-emails`) using a SigV4-signed HTTPS
 * request — no new dependencies, same signing pattern as the CloudFront agent.
 *
 * Credentials come from the existing AWS env (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY / AWS_REGION). The verified sender address comes from
 * IVX_SES_FROM_EMAIL (falling back to OWNER_REPAIR_EMAIL / EXPO_PUBLIC_OWNER_EMAIL).
 *
 * SAFETY: callers must enforce owner approval before invoking this. This module
 * only performs the transport — it never decides whether a message may be sent.
 */
import { createHash, createHmac } from 'node:crypto';

const AWS_SERVICE = 'ses';

export type SesSendResult = {
  ok: boolean;
  status: 'sent' | 'missing_config' | 'failed';
  messageId?: string;
  httpStatus?: number;
  region?: string;
  from?: string;
  to?: string;
  /** Exact env names still required to enable sending. */
  missingEnvNames: string[];
  error?: string;
  sentAt: string;
};

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/** The verified SES sender address, with safe owner-email fallbacks. */
export function resolveSesFromEmail(): string {
  return (
    readEnv('IVX_SES_FROM_EMAIL') ||
    readEnv('OWNER_REPAIR_EMAIL') ||
    readEnv('EXPO_PUBLIC_OWNER_EMAIL')
  );
}

function resolveRegion(): string {
  return readEnv('AWS_REGION') || 'us-east-1';
}

function hash(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function buildSigningKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, AWS_SERVICE);
  return hmac(kService, 'aws4_request');
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Request AWS SES to verify an email address as a sender/recipient identity.
 * AWS sends a verification email to the address; the recipient must click the
 * link before the address can be used to send or receive mail in sandbox mode.
 * Returns structured status; never throws.
 */
export async function verifySesEmailIdentity(email: string): Promise<SesSendResult> {
  const sentAt = new Date().toISOString();
  const accessKey = readEnv('AWS_ACCESS_KEY_ID');
  const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');
  const sessionToken = readEnv('AWS_SESSION_TOKEN');
  const region = resolveRegion();
  const target = email.trim().toLowerCase();

  const missingEnvNames: string[] = [];
  if (!accessKey) missingEnvNames.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnvNames.push('AWS_SECRET_ACCESS_KEY');

  if (missingEnvNames.length > 0) {
    return {
      ok: false,
      status: 'missing_config',
      region,
      to: target || undefined,
      missingEnvNames,
      error: 'Amazon SES is not fully configured.',
      sentAt,
    };
  }

  if (!isLikelyEmail(target)) {
    return {
      ok: false,
      status: 'failed',
      region,
      to: target || undefined,
      missingEnvNames,
      error: 'Identity is not a valid email address.',
      sentAt,
    };
  }

  const host = `email.${region}.amazonaws.com`;
  const canonicalUri = '/';
  const action = 'VerifyEmailIdentity';
  const payload = `Action=${encodeURIComponent(action)}&EmailAddress=${encodeURIComponent(target)}&Version=2010-12-01`;
  const bodyHash = hash(payload);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const contentType = 'application/x-www-form-urlencoded';
  const headerLines: [string, string][] = [
    ['content-type', contentType],
    ['host', host],
    ['x-amz-content-sha256', bodyHash],
    ['x-amz-date', amzDate],
  ];
  if (sessionToken) headerLines.push(['x-amz-security-token', sessionToken]);
  const canonicalHeaders = headerLines.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerLines.map(([k]) => k).join(';');
  const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signingKey = buildSigningKey(secretKey, dateStamp, region);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    Host: host,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;

  try {
    const response = await fetch(`https://${host}${canonicalUri}`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: 'failed',
        region,
        to: target,
        httpStatus: response.status,
        missingEnvNames,
        error: text.slice(0, 500) || `SES verification request responded ${response.status}`,
        sentAt,
      };
    }
    return {
      ok: true,
      status: 'sent',
      region,
      to: target,
      httpStatus: response.status,
      missingEnvNames,
      sentAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      region,
      to: target,
      missingEnvNames,
      error: error instanceof Error ? error.message : 'SES verification request failed.',
      sentAt,
    };
  }
}

/**
 * List verified and pending SES identities (email addresses and domains).
 * Returns structured status; never throws.
 */
export async function listSesIdentities(): Promise<{
  ok: boolean;
  identities?: string[];
  error?: string;
  region?: string;
  httpStatus?: number;
  missingEnvNames: string[];
  sentAt: string;
}> {
  const sentAt = new Date().toISOString();
  const accessKey = readEnv('AWS_ACCESS_KEY_ID');
  const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');
  const sessionToken = readEnv('AWS_SESSION_TOKEN');
  const region = resolveRegion();

  const missingEnvNames: string[] = [];
  if (!accessKey) missingEnvNames.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnvNames.push('AWS_SECRET_ACCESS_KEY');

  if (missingEnvNames.length > 0) {
    return {
      ok: false,
      region,
      missingEnvNames,
      error: 'Amazon SES is not fully configured.',
      sentAt,
    };
  }

  const host = `email.${region}.amazonaws.com`;
  const canonicalUri = '/';
  const payload = 'Action=ListIdentities&Version=2010-12-01';
  const bodyHash = hash(payload);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const contentType = 'application/x-www-form-urlencoded';
  const headerLines: [string, string][] = [
    ['content-type', contentType],
    ['host', host],
    ['x-amz-content-sha256', bodyHash],
    ['x-amz-date', amzDate],
  ];
  if (sessionToken) headerLines.push(['x-amz-security-token', sessionToken]);
  const canonicalHeaders = headerLines.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerLines.map(([k]) => k).join(';');
  const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signingKey = buildSigningKey(secretKey, dateStamp, region);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    Host: host,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;

  try {
    const response = await fetch(`https://${host}${canonicalUri}`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        region,
        httpStatus: response.status,
        missingEnvNames,
        error: text.slice(0, 500) || `SES list identities responded ${response.status}`,
        sentAt,
      };
    }
    const identities: string[] = [];
    const emailMatches = text.matchAll(/<member>([^<]+)<\/member>/g);
    for (const match of emailMatches) {
      identities.push(match[1].trim());
    }
    return {
      ok: true,
      region,
      identities,
      httpStatus: response.status,
      missingEnvNames,
      sentAt,
    };
  } catch (error) {
    return {
      ok: false,
      region,
      missingEnvNames,
      error: error instanceof Error ? error.message : 'SES list identities request failed.',
      sentAt,
    };
  }
}

/**
 * Send a single transactional email via Amazon SES. Returns structured status;
 * never throws. Owner approval must be enforced by the caller.
 */
export async function sendSesEmail(input: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  replyTo?: string;
}): Promise<SesSendResult> {
  const sentAt = new Date().toISOString();
  const accessKey = readEnv('AWS_ACCESS_KEY_ID');
  const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');
  const sessionToken = readEnv('AWS_SESSION_TOKEN');
  const region = resolveRegion();
  const from = (input.from?.trim() || resolveSesFromEmail());
  const to = input.to.trim();

  const missingEnvNames: string[] = [];
  if (!accessKey) missingEnvNames.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnvNames.push('AWS_SECRET_ACCESS_KEY');
  if (!from) missingEnvNames.push('IVX_SES_FROM_EMAIL');

  if (missingEnvNames.length > 0) {
    return {
      ok: false,
      status: 'missing_config',
      region,
      from: from || undefined,
      to: to || undefined,
      missingEnvNames,
      error: 'Amazon SES is not fully configured.',
      sentAt,
    };
  }

  if (!isLikelyEmail(to)) {
    return {
      ok: false,
      status: 'failed',
      region,
      from,
      to: to || undefined,
      missingEnvNames,
      error: 'Recipient contact is not a valid email address.',
      sentAt,
    };
  }

  const host = `email.${region}.amazonaws.com`;
  const canonicalUri = '/v2/email/outbound-emails';
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ...(input.replyTo && isLikelyEmail(input.replyTo) ? { ReplyToAddresses: [input.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: input.body, Charset: 'UTF-8' } },
      },
    },
  });
  const bodyHash = hash(payload);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headerLines: [string, string][] = [
    ['content-type', 'application/json'],
    ['host', host],
    ['x-amz-content-sha256', bodyHash],
    ['x-amz-date', amzDate],
  ];
  if (sessionToken) headerLines.push(['x-amz-security-token', sessionToken]);
  const canonicalHeaders = headerLines.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerLines.map(([k]) => k).join(';');
  const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signingKey = buildSigningKey(secretKey, dateStamp, region);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Host: host,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;

  try {
    const response = await fetch(`https://${host}${canonicalUri}`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: 'failed',
        region,
        from,
        to,
        httpStatus: response.status,
        missingEnvNames,
        error: text.slice(0, 400) || `SES responded ${response.status}`,
        sentAt,
      };
    }
    let messageId: string | undefined;
    try {
      const parsed = JSON.parse(text) as { MessageId?: string };
      messageId = parsed.MessageId;
    } catch {
      /* SES returns JSON; ignore parse issues and treat 200 as sent. */
    }
    return {
      ok: true,
      status: 'sent',
      region,
      from,
      to,
      messageId,
      httpStatus: response.status,
      missingEnvNames,
      sentAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      region,
      from,
      to,
      missingEnvNames,
      error: error instanceof Error ? error.message : 'SES send request failed.',
      sentAt,
    };
  }
}

/** True when SES has everything it needs to actually send (creds + verified from). */
export function isSesConfigured(): boolean {
  return Boolean(readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY') && resolveSesFromEmail());
}
