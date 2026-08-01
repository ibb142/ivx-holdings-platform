/**
 * IVX Independence Status client (owner-only).
 *
 * Thin client over the owner-gated Independence Status API — the live 4-phase
 * External→IVX transition report (current phase, per-phase requirement readiness,
 * the eight kept systems, the external dependencies still present, the six owner
 * capabilities, and the next actions). Auth + base URL reuse the same
 * owner-session pattern as the rest of the IVX developer module.
 */
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

export type IndependencePhaseId = 'shadow' | 'ivx_primary' | 'independence' | 'final_removal';
export type PhaseReadiness = 'achieved' | 'in_progress' | 'blocked';

export type PhaseRequirement = {
  label: string;
  met: boolean;
  detail: string;
  missing: string | null;
};

export type IndependencePhase = {
  id: IndependencePhaseId;
  order: number;
  title: string;
  objective: string;
  externalRole: string;
  requirements: PhaseRequirement[];
  readiness: PhaseReadiness;
};

export type KeptSystem = {
  system: string;
  available: boolean;
  backedBy: string;
  missing: string | null;
};

export type ExternalDependency = {
  dependency: string;
  present: boolean;
  risk: 'critical' | 'high' | 'medium' | 'low';
  detail: string;
  removalAction: string;
};

export type IndependenceReport = {
  marker: string;
  generatedAt: string;
  currentPhase: IndependencePhaseId;
  currentPhaseOrder: number;
  nextPhase: IndependencePhaseId | null;
  phases: IndependencePhase[];
  keptSystems: KeptSystem[];
  externalDependenciesRemaining: ExternalDependency[];
  ownerCapabilities: PhaseRequirement[];
  summary: {
    phasesAchieved: number;
    externalRequiredForNormalWorkflow: boolean;
    externalOptional: boolean;
    canReceiveOwnerCommands: boolean;
    canModifyCode: boolean;
    canDeploy: boolean;
    canVerifyProduction: boolean;
    canStoreProof: boolean;
    canLearnFromOutcomes: boolean;
  };
  nextActions: string[];
};

function backendBaseUrl(): string {
  return getDirectApiBaseUrl().replace(/\/+$/, '');
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readError(payload: unknown, fallback: string): string {
  const record = readRecord(payload);
  return typeof record.error === 'string' && record.error.trim() ? record.error.trim() : fallback;
}

async function ownerFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const accessToken = await getIVXAccessToken();
  if (!accessToken) {
    throw new Error('Owner session token unavailable. Sign in again.');
  }
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(readError(payload, `IVX independence-status request failed with HTTP ${response.status}.`));
  }
  return payload;
}

export async function getIndependenceReport(): Promise<IndependenceReport | null> {
  const payload = readRecord(await ownerFetch('/api/ivx/independence-status'));
  return (payload.report as IndependenceReport | undefined) ?? null;
}
