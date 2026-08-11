/**
 * IVX Twilio SMS sender — fallback/alternative to AWS SNS for owner notifications.
 *
 * Uses the Twilio Messaging API (https://messaging.twilio.com/v1) to send a
 * single SMS from the configured messaging service or from-number. Designed as
 * a drop-in alternative for sendSnsSms in ivx-autonomous-sms-notifier.ts.
 *
 * Credentials:
 *   - IVX_TWILIO_ACCOUNT_SID
 *   - IVX_TWILIO_AUTH_TOKEN
 *   - IVX_TWILIO_MESSAGING_SERVICE_SID (preferred — uses the ivxholding.com service)
 *   - IVX_TWILIO_FROM_PHONE (fallback if no messaging service configured)
 *
 * Marker: ivx-twilio-sms-2026-08-11
 */

import { normalizePhoneToE164 } from './ivx-sns-sms';

export type TwilioSmsResult = {
  ok: boolean;
  status: 'sent' | 'missing_config' | 'rate_limited' | 'failed';
  messageId?: string;
  httpStatus?: number;
  to?: string;
  from?: string;
  missingEnvNames: string[];
  error?: string;
  sentAt: string;
};

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/** True when Twilio has enough config to attempt a send. */
export function isTwilioSmsConfigured(): boolean {
  return Boolean(readEnv('IVX_TWILIO_ACCOUNT_SID') && readEnv('IVX_TWILIO_AUTH_TOKEN'));
}

function resolveFrom(): { messagingServiceSid?: string; fromPhone?: string } {
  const messagingServiceSid = readEnv('IVX_TWILIO_MESSAGING_SERVICE_SID');
  const fromPhone = normalizePhoneToE164(readEnv('IVX_TWILIO_FROM_PHONE'));
  return messagingServiceSid ? { messagingServiceSid } : { fromPhone };
}

/**
 * Send a single SMS via Twilio Messaging API.
 * Returns structured status; never throws.
 */
export async function sendTwilioSms(input: {
  to: string;
  message: string;
}): Promise<TwilioSmsResult> {
  const sentAt = new Date().toISOString();
  const accountSid = readEnv('IVX_TWILIO_ACCOUNT_SID');
  const authToken = readEnv('IVX_TWILIO_AUTH_TOKEN');
  const to = normalizePhoneToE164(input.to);
  const from = resolveFrom();

  const missingEnvNames: string[] = [];
  if (!accountSid) missingEnvNames.push('IVX_TWILIO_ACCOUNT_SID');
  if (!authToken) missingEnvNames.push('IVX_TWILIO_AUTH_TOKEN');
  if (!from.messagingServiceSid && !from.fromPhone) missingEnvNames.push('IVX_TWILIO_MESSAGING_SERVICE_SID or IVX_TWILIO_FROM_PHONE');
  if (!to) missingEnvNames.push('destination phone');

  if (missingEnvNames.length > 0) {
    return {
      ok: false,
      status: 'missing_config',
      to: to || undefined,
      missingEnvNames,
      error: 'Twilio SMS is not fully configured.',
      sentAt,
    };
  }

  if (!/^\+\d{8,15}$/.test(to)) {
    return {
      ok: false,
      status: 'failed',
      to,
      missingEnvNames,
      error: 'Destination phone is not a valid E.164 number.',
      sentAt,
    };
  }

  const body = new URLSearchParams();
  body.set('To', to);
  body.set('Body', input.message.slice(0, 1600));
  if (from.messagingServiceSid) {
    body.set('MessagingServiceSid', from.messagingServiceSid);
  } else if (from.fromPhone) {
    body.set('From', from.fromPhone);
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const text = await response.text();
    const json = response.ok ? (JSON.parse(text) as Record<string, unknown>) : null;

    if (!response.ok) {
      const parsed = (() => {
        try { return JSON.parse(text) as { message?: string; code?: number | string }; }
        catch { return null; }
      })();
      const errorMessage = parsed?.message ?? text.slice(0, 300) ?? `Twilio responded ${response.status}`;
      const isRateLimit = response.status === 429 || /rate.*limit|too many/i.test(errorMessage);
      return {
        ok: false,
        status: isRateLimit ? 'rate_limited' : 'failed',
        to,
        from: from.messagingServiceSid || from.fromPhone,
        httpStatus: response.status,
        missingEnvNames,
        error: errorMessage,
        sentAt,
      };
    }

    return {
      ok: true,
      status: 'sent',
      to,
      from: from.messagingServiceSid || from.fromPhone,
      messageId: typeof json?.sid === 'string' ? json.sid : undefined,
      httpStatus: response.status,
      missingEnvNames,
      sentAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      to,
      from: from.messagingServiceSid || from.fromPhone,
      missingEnvNames,
      error: error instanceof Error ? error.message : 'Twilio SMS send request failed.',
      sentAt,
    };
  }
}
