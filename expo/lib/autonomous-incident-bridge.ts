export type AutonomousIncidentSeverity = 'error' | 'warning' | 'fatal';

export type AutonomousIncidentInput = {
  message: string;
  stack?: string;
  platform: string;
  severity: AutonomousIncidentSeverity;
  metadata?: Record<string, string>;
  buildId?: string | null;
};

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const INCIDENT_URL = `${API_BASE}/api/ivx/incidents`;
const DEDUPE_WINDOW_MS = 30_000;
const recent = new Map<string, number>();

export function buildAutonomousIncidentPayload(input: AutonomousIncidentInput) {
  const source = input.severity === 'fatal' ? 'silent_failure' : 'frontend';
  const checkpoint = input.metadata?.source || 'client-runtime';
  const suggestedFix = input.severity === 'fatal'
    ? 'Autonomous runtime repair required: diagnose, stage patch, replay failure, then request production approval only after staging passes.'
    : undefined;

  return {
    source,
    severity: input.severity === 'fatal' ? 'critical' : input.severity === 'warning' ? 'warning' : 'error',
    checkpoint,
    message: input.message.slice(0, 1024),
    stack: input.stack?.slice(0, 8192) || null,
    buildId: input.buildId || null,
    suggestedFix,
    requestBodyPreview: input.metadata ? JSON.stringify(input.metadata).slice(0, 1500) : null,
  } as const;
}

function fingerprint(input: AutonomousIncidentInput): string {
  return `${input.severity}|${input.platform}|${input.metadata?.source || ''}|${input.message.slice(0, 300)}`;
}

export async function reportAutonomousIncident(input: AutonomousIncidentInput): Promise<boolean> {
  const key = fingerprint(input);
  const now = Date.now();
  const previous = recent.get(key) || 0;
  if (now - previous < DEDUPE_WINDOW_MS) return true;
  recent.set(key, now);

  try {
    const response = await fetch(INCIDENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAutonomousIncidentPayload(input)),
    });
    return response.ok;
  } catch {
    return false;
  }
}
