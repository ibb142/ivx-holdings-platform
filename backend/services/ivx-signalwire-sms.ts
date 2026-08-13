/** Canonical IVX SMS transport. All production SMS should route through SignalWire. */
import { normalizePhoneToE164 } from './ivx-sns-sms';

export type SignalWireSmsResult = {
  ok: boolean;
  status: 'sent' | 'missing_config' | 'rate_limited' | 'failed';
  messageId?: string;
  httpStatus?: number;
  to?: string;
  from?: string;
  missingEnvNames: string[];
  error?: string;
  sentAt: string;
  provider: 'signalwire';
};

type Config = { projectId: string; token: string; space: string; from: string | null };

function env(name: string): string {
  const value = process.env[name];
  return typeof value