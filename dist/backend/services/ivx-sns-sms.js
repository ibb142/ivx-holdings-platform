/**
 * IVX Amazon SNS SMS sender (owner login recovery delivery).
 *
 * Sends a single SMS via the AWS SNS `Publish` API (短信) using a SigV4-signed
 * HTTPS request — no new dependencies, same signing pattern as the SES module.
 *
 * AWS SNS gives new accounts a small monthly free tier of outbound SMS (~200
 * messages in the US on the SMS sandbox tier before spending past the free
 * grant), which is more than enough for the owner-only recovery flow.
 *
 * Credentials come from the existing AWS env (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY / AWS_REGION / AWS_SESSION_TOKEN). The destination
 * phone is resolved in this order: explicit caller override →
 * IVX_OWNER_RECOVERY_PHONE env var. The sender ID is IVXOwner.
 *
 * SAFETY: callers must enforce owner approval / allowlist before invoking this.
 * This module only performs the transport — it never decides whether a message
 * may be sent. Owner recovery codes are short-lived (5 min) and rate-limited.
 */
import { createHash, createHmac, randomInt } from 'node:crypto';
const AWS_SERVICE = 'sns';
function readEnv(name) {
    const v = process.env[name];
    return typeof v === 'string' ? v.trim() : '';
}
/** Owner recovery phone (E.164 expected, e.g. +15616443503). */
export function resolveOwnerRecoveryPhone() {
    return readEnv('IVX_OWNER_RECOVERY_PHONE');
}
function resolveRegion() {
    return readEnv('AWS_REGION') || 'us-east-1';
}
function hash(payload) {
    return createHash('sha256').update(payload, 'utf8').digest('hex');
}
function hmac(key, data) {
    return createHmac('sha256', key).update(data, 'utf8').digest();
}
function buildSigningKey(secret, dateStamp, region) {
    const kDate = hmac(`AWS4${secret}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, AWS_SERVICE);
    return hmac(kService, 'aws4_request');
}
/** Normalize a phone to E.164 (+1...). Accepts "561-644-3503" or "+15616443503". */
export function normalizePhoneToE164(input) {
    const raw = (input || '').trim();
    if (!raw)
        return '';
    const digits = raw.replace(/\D/g, '');
    if (!digits)
        return '';
    // US/CA: 10 digits → prepend +1
    if (digits.length === 10)
        return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1'))
        return `+${digits}`;
    if (raw.startsWith('+'))
        return `+${digits}`;
    return `+${digits}`;
}
/**
 * Send a single SMS via Amazon SNS. Returns structured status; never throws.
 * Owner approval must be enforced by the caller.
 */
export async function sendSnsSms(input) {
    const sentAt = new Date().toISOString();
    const accessKey = readEnv('AWS_ACCESS_KEY_ID');
    const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');
    const sessionToken = readEnv('AWS_SESSION_TOKEN');
    const region = resolveRegion();
    const to = normalizePhoneToE164(input.to);
    const senderId = (input.senderId?.trim() || 'IVXOwner').slice(0, 11).replace(/[^A-Za-z0-9]/g, '');
    const missingEnvNames = [];
    if (!accessKey)
        missingEnvNames.push('AWS_ACCESS_KEY_ID');
    if (!secretKey)
        missingEnvNames.push('AWS_SECRET_ACCESS_KEY');
    if (!to)
        missingEnvNames.push('IVX_OWNER_RECOVERY_PHONE');
    if (missingEnvNames.length > 0) {
        return {
            ok: false,
            status: 'missing_config',
            region,
            to: to || undefined,
            missingEnvNames,
            error: 'Amazon SNS SMS is not fully configured.',
            sentAt,
        };
    }
    if (!/^\+\d{8,15}$/.test(to)) {
        return {
            ok: false,
            status: 'failed',
            region,
            to: to || undefined,
            missingEnvNames,
            error: 'Destination phone is not a valid E.164 number.',
            sentAt,
        };
    }
    // SNS Publish parameters. Use SMS type TRANSACTIONAL for owner recovery so
    // it is not throttled by the promotional SMS pipeline.
    const params = new URLSearchParams();
    params.set('Action', 'Publish');
    params.set('Version', '2010-03-31');
    params.set('PhoneNumber', to);
    params.set('Message', input.message);
    params.set('MessageAttributes.entry.1.Name', 'AWS.SNS.SMS.SMSType');
    params.set('MessageAttributes.entry.1.Value.DataType', 'String');
    params.set('MessageAttributes.entry.1.Value.StringValue', 'Transactional');
    if (senderId) {
        params.set('MessageAttributes.entry.2.Name', 'AWS.SNS.SMS.SenderID');
        params.set('MessageAttributes.entry.2.Value.DataType', 'String');
        params.set('MessageAttributes.entry.2.Value.StringValue', senderId);
    }
    const body = params.toString();
    const bodyHash = hash(body);
    const host = `sns.${region}.amazonaws.com`;
    const canonicalUri = '/';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const headerLines = [
        ['content-type', 'application/x-www-form-urlencoded'],
        ['host', host],
        ['x-amz-content-sha256', bodyHash],
        ['x-amz-date', amzDate],
    ];
    if (sessionToken)
        headerLines.push(['x-amz-security-token', sessionToken]);
    const canonicalHeaders = headerLines.map(([k, v]) => `${k}:${v}\n`).join('');
    const signedHeaders = headerLines.map(([k]) => k).join(';');
    const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
    const credentialScope = `${dateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
    const signingKey = buildSigningKey(secretKey, dateStamp, region);
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Host: host,
        'X-Amz-Content-Sha256': bodyHash,
        'X-Amz-Date': amzDate,
        Authorization: authorization,
    };
    if (sessionToken)
        headers['X-Amz-Security-Token'] = sessionToken;
    try {
        const response = await fetch(`https://${host}${canonicalUri}`, {
            method: 'POST',
            headers,
            body,
        });
        const text = await response.text();
        if (!response.ok) {
            const isRateLimit = response.status === 429 || /throttl|rate.*limit|too many/i.test(text);
            return {
                ok: false,
                status: isRateLimit ? 'rate_limited' : 'failed',
                region,
                to,
                httpStatus: response.status,
                missingEnvNames,
                error: text.slice(0, 400) || `SNS responded ${response.status}`,
                sentAt,
            };
        }
        // SNS returns XML; extract MessageId.
        let messageId;
        const idMatch = text.match(/<MessageId>([^<]+)<\/MessageId>/);
        if (idMatch)
            messageId = idMatch[1];
        return {
            ok: true,
            status: 'sent',
            region,
            to,
            messageId,
            httpStatus: response.status,
            missingEnvNames,
            sentAt,
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 'failed',
            region,
            to,
            missingEnvNames,
            error: error instanceof Error ? error.message : 'SNS SMS send request failed.',
            sentAt,
        };
    }
}
/** True when SNS SMS has everything it needs to actually send. */
export function isSnsSmsConfigured() {
    return Boolean(readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY') && resolveOwnerRecoveryPhone());
}
/** Generate a 6-digit recovery code. */
export function generateRecoveryCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
