import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EVIDENCE_PATH = resolve(
  process.cwd(),
  'expo/evidence/autonomous/ivx-autonomous-intelligence-mission-scheduler-cert.json',
);

const EXPECTED_MARKER = 'ivx-autonomous-intelligence-mission-scheduler-v2-2026-08-24';
const EXPECTED_MISSION = 'autonomous intelligence mission scheduler live';
const EXPECTED_CREATOR = 'ivx-senior-developer-worker';
const MIN_CERT_TIME_MS = Date.parse('2026-08-24T00:00:00.000Z');
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FORBIDDEN_TIMESTAMP_TOKENS = [
  'CURRENT_TIMESTAMP',
  '{{CURRENT_TIMESTAMP}}',
  'PLACEHOLDER_TIMESTAMP',
  '<timestamp>',
  'timestamp',
];

type AutonomousEvidence = {
  marker?: unknown;
  mission?: unknown;
  createdAt?: unknown;
  creator?: unknown;
  [key: string]: unknown;
};

function readEvidence(): AutonomousEvidence {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as AutonomousEvidence;
}

export function validateAutonomousEvidenceCreatedAt(value: unknown, nowMs = Date.now()): {
  ok: boolean;
  reason: string | null;
} {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: 'createdAt must be a non-empty ISO timestamp string' };
  }

  const normalized = value.trim();
  if (FORBIDDEN_TIMESTAMP_TOKENS.some((token) => normalized.includes(token))) {
    return { ok: false, reason: `createdAt contains forbidden placeholder token: ${normalized}` };
  }

  const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!isoUtcPattern.test(normalized)) {
    return { ok: false, reason: `createdAt is not canonical UTC ISO-8601: ${normalized}` };
  }

  const timestampMs = Date.parse(normalized);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: `createdAt is not parseable: ${normalized}` };
  }
  if (timestampMs < MIN_CERT_TIME_MS) {
    return { ok: false, reason: `createdAt predates the v2 mission: ${normalized}` };
  }
  if (timestampMs > nowMs + MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: `createdAt is implausibly in the future: ${normalized}` };
  }

  return { ok: true, reason: null };
}

describe('IVX Autonomous mission evidence integrity — HARD GATE', () => {
  it('contains exactly the contract fields and values', () => {
    const evidence = readEvidence();
    expect(Object.keys(evidence).sort()).toEqual(['createdAt', 'creator', 'marker', 'mission']);
    expect(evidence.marker).toBe(EXPECTED_MARKER);
    expect(evidence.mission).toBe(EXPECTED_MISSION);
    expect(evidence.creator).toBe(EXPECTED_CREATOR);
  });

  it('rejects stale, placeholder, malformed and future timestamps', () => {
    const now = Date.parse('2026-08-24T01:10:00.000Z');
    expect(validateAutonomousEvidenceCreatedAt('2023-10-04T12:00:00Z', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('2026-08-23T23:59:59.000Z', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('CURRENT_TIMESTAMP', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('{{CURRENT_TIMESTAMP}}', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('PLACEHOLDER_TIMESTAMP', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('<timestamp>', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('not-a-date', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('2026-08-24T01:16:00.000Z', now).ok).toBe(false);
    expect(validateAutonomousEvidenceCreatedAt('2026-08-24T00:58:16.000Z', now).ok).toBe(true);
  });

  it('the committed certificate has a valid v2 timestamp', () => {
    const evidence = readEvidence();
    const result = validateAutonomousEvidenceCreatedAt(evidence.createdAt);
    expect(result.reason).toBeNull();
    expect(result.ok).toBe(true);
  });
});
