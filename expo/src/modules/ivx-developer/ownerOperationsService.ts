/**
 * IVX Owner Operations client (owner-only, non-developer).
 *
 * Thin client over the owner-gated Owner Operations API — credential vault
 * (status only, never values), live connection tests, the one-click action
 * catalog, and the Platform removal preflight. Auth + base URL reuse the same
 * owner-session pattern as the rest of the IVX developer module.
 */
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

export type ConnectionStatus = 'connected' | 'configured' | 'missing' | 'invalid';

export type ConnectionId =
  | 'github'
  | 'render'
  | 'supabase'
  | 'aws'
  | 'domain'
  | 'ai_gateway'
  | 'model_3d'
  | 'crm_import';

export type OwnerConnectionCard = {
  id: ConnectionId;
  label: string;
  purpose: string;
  status: ConnectionStatus;
  requiredSecrets: string[];
  missingSecrets: string[];
  optionalSecrets: string[];
  requiredPermissions: string[];
  fixInstructions: string[];
  testable: boolean;
  detail: string;
};

export type OwnerConnectionVault = {
  marker: string;
  generatedAt: string;
  connections: OwnerConnectionCard[];
  summary: { total: number; connectedOrConfigured: number; missing: number };
  missingConnections: ConnectionId[];
  allConfigured: boolean;
};

export type ConnectionTestResult = {
  connection: ConnectionId;
  status: ConnectionStatus;
  httpStatus: number | null;
  checkedAt: string;
  detail: string;
  missingSecrets: string[];
};

export type OwnerActionRisk = 'safe' | 'low' | 'medium' | 'high';

export type OwnerApprovalCategory =
  | 'none'
  | 'production_deploy'
  | 'database_migration'
  | 'delete_data'
  | 'rotate_secrets'
  | 'external_outreach'
  | 'paid_api'
  | 'legal_compliance';

export type OneClickAction = {
  id: string;
  label: string;
  whatHappens: string;
  riskLevel: OwnerActionRisk;
  requiresApproval: boolean;
  approvalCategory: OwnerApprovalCategory;
  rollbackPath: string;
  backingRoute: string;
  requiresConnections: ConnectionId[];
};

export type PlatformRemovalPreflight = {
  ready: boolean;
  status: 'VERIFIED' | 'BLOCKED_MISSING_OWNER_CONNECTION';
  requiredConnections: { connection: ConnectionId; label: string; satisfied: boolean; missing: string | null }[];
  missingConnections: ConnectionId[];
  steps: string[];
  note: string;
};

export type OwnerOperationsDashboard = {
  marker: string;
  generatedAt: string;
  vault: OwnerConnectionVault;
  actions: { marker: string; generatedAt: string; actions: OneClickAction[] };
  platformRemoval: PlatformRemovalPreflight;
  headline: string;
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
    throw new Error(readError(payload, `IVX owner-operations request failed with HTTP ${response.status}.`));
  }
  return payload;
}

export async function getOwnerOperationsDashboard(): Promise<OwnerOperationsDashboard | null> {
  const payload = readRecord(await ownerFetch('/api/ivx/owner-operations/dashboard'));
  return (payload.dashboard as OwnerOperationsDashboard | undefined) ?? null;
}

export async function testOwnerConnection(connection: ConnectionId): Promise<ConnectionTestResult | null> {
  const payload = readRecord(
    await ownerFetch('/api/ivx/owner-operations/connections/test', {
      method: 'POST',
      body: JSON.stringify({ connection }),
    }),
  );
  return (payload.result as ConnectionTestResult | undefined) ?? null;
}

export async function getPlatformRemovalPreflight(): Promise<PlatformRemovalPreflight | null> {
  const payload = readRecord(await ownerFetch('/api/ivx/owner-operations/removal-preflight'));
  return (payload.preflight as PlatformRemovalPreflight | undefined) ?? null;
}
