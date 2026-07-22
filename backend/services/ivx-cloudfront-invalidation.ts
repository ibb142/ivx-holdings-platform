/**
 * CloudFront Invalidation Agent
 *
 * Surgical wrapper around the AWS CloudFront API. Performs path invalidation
 * via SigV4-signed HTTPS request. Owner approval is enforced by callers, not here.
 *
 * No new deps: uses the global crypto + fetch.
 */

import { createHash, createHmac } from 'node:crypto';

const AWS_SERVICE = 'cloudfront';
const AWS_REGION = 'us-east-1';
const CLOUDFRONT_HOST = 'cloudfront.amazonaws.com';
const CLOUDFRONT_API_VERSION = '2020-05-31';

export type CloudFrontInvalidationResult = {
  ok: boolean;
  status: 'invalidated' | 'missing_access' | 'failed';
  invalidationId?: string;
  paths: string[];
  distributionId?: string;
  httpStatus?: number;
  error?: string;
  missingEnvNames: string[];
  createdAt: string;
  distributionAutoDiscovered?: boolean;
};

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

function hash(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function buildSigningKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, AWS_REGION);
  const kService = hmac(kRegion, AWS_SERVICE);
  return hmac(kService, 'aws4_request');
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function buildInvalidationXml(paths: string[], callerReference: string): string {
  const items = paths.map((p) => `<Path>${escapeXml(p)}</Path>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/${CLOUDFRONT_API_VERSION}/"><Paths><Quantity>${paths.length}</Quantity><Items>${items}</Items></Paths><CallerReference>${escapeXml(callerReference)}</CallerReference></InvalidationBatch>`;
}

function normalizePaths(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/** Create a CloudFront invalidation. Returns structured status; never throws. */
export async function createCloudFrontInvalidation(input: {
  paths: readonly string[];
  callerReference?: string;
  distributionId?: string;
}): Promise<CloudFrontInvalidationResult> {
  const createdAt = new Date().toISOString();
  const distributionId = (input.distributionId?.trim() || readEnv('CLOUDFRONT_DISTRIBUTION_ID'));
  const accessKey = readEnv('AWS_ACCESS_KEY_ID');
  const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');
  const sessionToken = readEnv('AWS_SESSION_TOKEN');
  const paths = normalizePaths(input.paths);

  const missingEnvNames: string[] = [];
  if (!accessKey) missingEnvNames.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnvNames.push('AWS_SECRET_ACCESS_KEY');

  // If AWS creds are missing, we can't do anything (not even auto-discovery).
  if (missingEnvNames.length > 0) {
    return {
      ok: false,
      status: 'missing_access',
      paths,
      distributionId: distributionId || undefined,
      missingEnvNames,
      createdAt,
      error: 'CloudFront AWS credentials not configured.',
    };
  }
  if (paths.length === 0) {
    return {
      ok: false,
      status: 'failed',
      paths,
      distributionId,
      missingEnvNames,
      createdAt,
      error: 'No invalidation paths supplied.',
    };
  }

  // Auto-discover distribution ID by listing distributions if not provided.
  // Looks for a distribution whose origin domain matches ivxholding.com's S3 bucket.
  let distributionAutoDiscovered = false;
  let resolvedDistributionId = distributionId;
  if (!resolvedDistributionId && accessKey && secretKey) {
    try {
      const listUrl = `https://${CLOUDFRONT_HOST}/${CLOUDFRONT_API_VERSION}/distribution?MaxItems=100`;
      const listAmzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const listDateStamp = listAmzDate.slice(0, 8);
      const listCanonicalUri = `/${CLOUDFRONT_API_VERSION}/distribution`;
      const listCanonicalQuery = 'MaxItems=100';
      const listHeaderLines: [string, string][] = [
        ['host', CLOUDFRONT_HOST],
        ['x-amz-content-sha256', hash('')],
        ['x-amz-date', listAmzDate],
      ];
      if (sessionToken) listHeaderLines.push(['x-amz-security-token', sessionToken]);
      const listCanonicalHeaders = listHeaderLines.map(([k, v]) => `${k}:${v}\n`).join('');
      const listSignedHeaders = listHeaderLines.map(([k]) => k).join(';');
      const listCanonicalRequest = ['GET', listCanonicalUri, listCanonicalQuery, listCanonicalHeaders, listSignedHeaders, hash('')].join('\n');
      const listCredentialScope = `${listDateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
      const listStringToSign = ['AWS4-HMAC-SHA256', listAmzDate, listCredentialScope, hash(listCanonicalRequest)].join('\n');
      const listSigningKey = buildSigningKey(secretKey, listDateStamp);
      const listSignature = createHmac('sha256', listSigningKey).update(listStringToSign, 'utf8').digest('hex');
      const listAuthorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${listCredentialScope}, SignedHeaders=${listSignedHeaders}, Signature=${listSignature}`;
      const listHeaders: Record<string, string> = {
        Host: CLOUDFRONT_HOST,
        'X-Amz-Content-Sha256': hash(''),
        'X-Amz-Date': listAmzDate,
        Authorization: listAuthorization,
      };
      if (sessionToken) listHeaders['X-Amz-Security-Token'] = sessionToken;
      const listResp = await fetch(`https://${CLOUDFRONT_HOST}${listCanonicalUri}?MaxItems=100`, { headers: listHeaders });
      const listText = await listResp.text();
      if (listResp.ok) {
        // Parse distribution items — look for ivxholding.com in origins/aliases
        const idMatches = /<Id>([^<]+)<\/Id>/g.exec(listText);
        const itemRegex = /<DistributionSummary>[\s\S]*?<\/DistributionSummary>/g;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = itemRegex.exec(listText)) !== null) {
          const item = itemMatch[0];
          const itemHasIvx = /ivxholding\.com/i.test(item) || /ivxholding/i.test(item);
          if (itemHasIvx) {
            const idMatch = /<Id>([^<]+)<\/Id>/.exec(item);
            if (idMatch && idMatch[1]) {
              resolvedDistributionId = idMatch[1];
              distributionAutoDiscovered = true;
              break;
            }
          }
        }
      }
    } catch {
      // Auto-discovery failed — fall through to missing_access error
    }
  }
  if (!resolvedDistributionId) {
    return {
      ok: false,
      status: 'missing_access',
      paths,
      distributionId: undefined,
      missingEnvNames: ['CLOUDFRONT_DISTRIBUTION_ID'],
      createdAt,
      error: 'CloudFront distribution ID not configured and auto-discovery found no matching distribution.',
    };
  }
  const callerReference = (input.callerReference?.trim()) || `ivx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = buildInvalidationXml(paths, callerReference);
  const bodyHash = hash(body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${CLOUDFRONT_API_VERSION}/distribution/${encodeURIComponent(resolvedDistributionId)}/invalidation`;
  const canonicalQuery = '';
  const headerLines: [string, string][] = [
    ['host', CLOUDFRONT_HOST],
    ['x-amz-content-sha256', bodyHash],
    ['x-amz-date', amzDate],
  ];
  if (sessionToken) headerLines.push(['x-amz-security-token', sessionToken]);
  const canonicalHeaders = headerLines.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerLines.map(([k]) => k).join(';');
  const canonicalRequest = ['POST', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signingKey = buildSigningKey(secretKey, dateStamp);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/xml',
    Host: CLOUDFRONT_HOST,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;

  try {
    const response = await fetch(`https://${CLOUDFRONT_HOST}${canonicalUri}`, {
      method: 'POST',
      headers,
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: 'failed',
        paths,
        distributionId: resolvedDistributionId,
        httpStatus: response.status,
        missingEnvNames,
        createdAt,
        error: text.slice(0, 400) || `CloudFront responded ${response.status}`,
        distributionAutoDiscovered,
      };
    }
    const idMatch = /<Id>([^<]+)<\/Id>/.exec(text);
    return {
      ok: true,
      status: 'invalidated',
      paths,
      distributionId: resolvedDistributionId,
      invalidationId: idMatch ? idMatch[1] : undefined,
      httpStatus: response.status,
      missingEnvNames,
      createdAt,
      distributionAutoDiscovered,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      paths,
      distributionId: resolvedDistributionId,
      missingEnvNames,
      createdAt,
      error: error instanceof Error ? error.message : 'CloudFront invalidation request failed.',
      distributionAutoDiscovered,
    };
  }
}
