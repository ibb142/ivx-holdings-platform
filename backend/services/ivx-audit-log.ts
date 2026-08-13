/**
 * IVX Audit Log Service (items 167-168)
 *
 * Records audit entries for financial and authentication operations.
 * All PII is sanitized before logging via ivx-pii-sanitizer.
 *
 * Audit actions cover: member registration, login, KYC, wire transfers,
 * investments, withdrawals, data exports/deletions, consent, and security events.
 */

import { sanitizePII, sanitizeObject } from './ivx-pii-sanitizer';

export type AuditAction =
  | 'member_register'
  | 'member_login'
  | 'member_logout'
  | 'password_change'
  | 'password_reset'
  | 'kyc_submit'
  | 'kyc_approve'
  | 'kyc_reject'
  | 'wire_request'
  | 'wire_submit'
  | 'investment_create'
  | 'investment_confirm'
  | 'withdrawal_request'
  | 'withdrawal_approve'
  | 'data_export'
  | 'data_delete'
  | 'consent_record'
  | 'login_failed'
  | 'rate_limit_hit'
  | 'csrf_blocked';

type AuditEntry = {
  id: string;
  action: AuditAction;
  userId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure' | 'pending';
};

const auditLog: AuditEntry[] = [];
const MAX_LOG_ENTRIES = 10000;

export function recordAudit(
  action: AuditAction,
  options: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
    result?: 'success' | 'failure' | 'pending';
  } = {},
): AuditEntry {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    userId: options.userId ? sanitizePII(options.userId) : undefined,
    ip: options.ip,
    userAgent: options.userAgent ? sanitizePII(options.userAgent) : undefined,
    timestamp: new Date().toISOString(),
    details: options.details ? sanitizeObject(options.details) : {},
    result: options.result || 'success',
  };

  // Log with sanitized entry — never log raw PII (item 168)
  console.log('[IVXAudit]', entry.action, {
    id: entry.id,
    result: entry.result,
    timestamp: entry.timestamp,
    ip: entry.ip,
  });

  auditLog.push(entry);
  if (auditLog.length > MAX_LOG_ENTRIES) {
    auditLog.shift();
  }

  return entry;
}

export function getAuditLog(limit: number = 100): AuditEntry[] {
  return auditLog.slice(-limit);
}

export function getAuditLogByAction(action: AuditAction, limit: number = 50): AuditEntry[] {
  return auditLog.filter((e) => e.action === action).slice(-limit);
}

export function getAuditStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const entry of auditLog) {
    stats[entry.action] = (stats[entry.action] ?? 0) + 1;
  }
  return stats;
}

export const IVX_AUDIT_LOG_MARKER = 'ivx-audit-log-2026-08-13';
