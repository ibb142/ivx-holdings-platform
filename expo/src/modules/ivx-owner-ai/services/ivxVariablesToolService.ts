import { getIVXAccessToken, getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';

export const IVX_VARIABLES_TOOL_REQUIRED_NAMES = [
  'GITHUB_TOKEN',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DISTRIBUTION_ID',
  'IVX_AI_GATEWAY_KEY',
  'STRIPE_API_KEY',
  'APP_SECRET',
  'JWT_SECRET',
] as const;

export const IVX_OWNER_VARIABLE_NAMES = [
  'GITHUB_TOKEN',
  'GITHUB_REPO_URL',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'IVX_AWS_READONLY_ACCESS_KEY_ID',
  'IVX_AWS_READONLY_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'IVX_AI_GATEWAY_KEY',
  'JWT_SECRET',
  'APP_SECRET',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DISTRIBUTION_ID',
] as const;

export type IVXVariablesToolRequiredName = typeof IVX_VARIABLES_TOOL_REQUIRED_NAMES[number];
export type IVXOwnerVariableName = typeof IVX_OWNER_VARIABLE_NAMES[number];
export type IVXOwnerVariableStatusValue = 'missing' | 'saved' | 'tested' | 'invalid';
export type IVXOwnerVariableProvider = 'github' | 'render' | 'supabase' | 'aws' | 'ai' | 'security' | 'storage';

export type IVXVariablesToolVariableProof = {
  name: IVXVariablesToolRequiredName;
  variableNamePresent: boolean;
  backendRuntimeCanAccess: boolean;
  toolAuthorized: boolean;
  productionLive: boolean;
};

export type IVXVariablesToolProviderStatus = {
  connected: boolean;
  configured: boolean;
  runtimeCanAccess: boolean;
  secretValuesReturned?: false;
  httpStatus?: number | null;
  serviceHttpStatus?: number | null;
  envVarsHttpStatus?: number | null;
  error?: string;
};

export type IVXVariablesToolStatus = {
  ok: boolean;
  ownerOnly: boolean;
  tool: string;
  secureBackendStorage: string;
  secretValuesReturned: false;
  ownerAuthorized: boolean;
  toolAuthorized: boolean;
  renderToolAuthorized: boolean;
  productionLive: boolean;
  production?: {
    productionLive: boolean;
    apiHealthHttp200: boolean;
    frontendLoads: boolean;
    apiHealthStatus: number | null;
    frontendStatus: number | null;
  };
  variables: IVXVariablesToolVariableProof[];
  allRequiredCredentialsPresent: boolean;
  allRequiredCredentialsRuntimeAccessible: boolean;
  providers: {
    github: IVXVariablesToolProviderStatus;
    render: IVXVariablesToolProviderStatus;
    supabase: IVXVariablesToolProviderStatus;
    aws: IVXVariablesToolProviderStatus;
  };
  redeploy?: {
    requiredAfterSavingVariables: boolean;
    automaticallyTriggeredWhenRequested: boolean;
    guide: string;
  };
  timestamp: string;
  authenticatedUserId?: string;
  error?: string;
};

export type IVXVariablesToolSaveResponse = {
  ok: boolean;
  ownerOnly: boolean;
  toolAuthorized: boolean;
  secureBackendStorage?: string;
  secretValuesReturned: false;
  savedVariableNames?: IVXVariablesToolRequiredName[];
  redeploy?: {
    deployTriggered: boolean;
    httpStatus: number | null;
    deployId: string | null;
    requiredForBackendRuntimeAccess: boolean;
  };
  statusAfterSave?: IVXVariablesToolStatus;
  missingVariableNames?: string[];
  message?: string;
  error?: string;
  timestamp: string;
};

export type IVXOwnerVariableRow = {
  name: IVXOwnerVariableName;
  provider: IVXOwnerVariableProvider;
  required: boolean;
  secret: boolean;
  status: IVXOwnerVariableStatusValue;
  saved: boolean;
  lastTestedAt: string | null;
  maskedPreview: string | null;
  description: string;
  secretValuesReturned: false;
};

export type IVXOwnerVariableProviderReadiness = {
  provider: IVXOwnerVariableProvider;
  status: IVXOwnerVariableStatusValue;
  requiredVariableNames: IVXOwnerVariableName[];
  savedVariableNames: IVXOwnerVariableName[];
  missingVariableNames: IVXOwnerVariableName[];
  lastTestedAt: string | null;
  secretValuesReturned: false;
  httpStatus?: number | null;
  error?: string;
};

export type IVXOwnerVariablesStatus = {
  ok: boolean;
  ownerOnly: boolean;
  routeRegistered: boolean;
  tool: string;
  deploymentMarker: string;
  authenticatedUserId?: string;
  authenticatedRole?: string;
  storage: {
    configured: boolean;
    backend: string;
    encryptedAtRest: boolean;
    encryptionConfigured: boolean;
    auditLogEnabled: boolean;
    error?: string;
  };
  variables: IVXOwnerVariableRow[];
  providers: Partial<Record<IVXOwnerVariableProvider, IVXOwnerVariableProviderReadiness>>;
  missingCredentials: IVXOwnerVariableName[];
  secretValuesReturned: false;
  timestamp: string;
  error?: string;
};

export type IVXOwnerVariableSaveResponse = {
  ok: boolean;
  ownerOnly: boolean;
  saved?: {
    name: IVXOwnerVariableName;
    provider: IVXOwnerVariableProvider;
    status: IVXOwnerVariableStatusValue;
    maskedPreview: string | null;
    lastTestedAt: string | null;
    secretValuesReturned: false;
  };
  statusAfterSave?: IVXOwnerVariablesStatus;
  secretValuesReturned: false;
  deploymentMarker?: string;
  timestamp: string;
  error?: string;
};

export type IVXOwnerVariableActionResponse = {
  ok: boolean;
  ownerOnly: boolean;
  variableName?: IVXOwnerVariableName;
  provider?: IVXOwnerVariableProvider;
  deleted?: boolean;
  testResult?: IVXOwnerVariableStatusValue | 'missing';
  message?: string;
  providerResult?: IVXOwnerVariableProviderReadiness;
  statusAfterTest?: IVXOwnerVariablesStatus;
  statusAfterDelete?: IVXOwnerVariablesStatus;
  secretValuesReturned: false;
  deploymentMarker?: string;
  timestamp: string;
  error?: string;
};

export type IVXIndependenceRiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type IVXIndependenceDependencyStatus = 'blocked' | 'in_progress' | 'completed' | 'needs_owner_proof';

export type IVXIndependenceDependency = {
  id: string;
  dependencyName: string;
  riskLevel: IVXIndependenceRiskLevel;
  currentStatus: IVXIndependenceDependencyStatus;
  removalTask: string;
  ownerActionRequired: string;
  proofRequired: string;
  completionDate: string | null;
  externalDependencyReduced: string;
  proofBefore: string;
  proofAfter: string;
};

export type IVXIndependenceChecklistItem = {
  day: number;
  title: string;
  checklist: string[];
  status: 'pending' | 'in_progress' | 'completed';
};

export type IVXOwnerAccessProof = {
  ownerCanSignIn: boolean;
  ownerDashboardAccessible: boolean;
  ownerVariablesAccessible: boolean;
  independenceTrackerAccessible: boolean;
  role: string;
  kycStatus: string;
  source: string;
  secretValuesReturned: false;
};

export type IVXIndependenceStatus = {
  ok: boolean;
  ownerOnly: boolean;
  routeRegistered: boolean;
  tool: string;
  deploymentMarker: string;
  authenticatedUserId?: string;
  authenticatedRole?: string;
  ownerAccessProof?: IVXOwnerAccessProof;
  ownerCanSignIn?: boolean;
  ownerDashboardAccessible?: boolean;
  ownerVariablesAccessible?: boolean;
  independenceTrackerAccessible?: boolean;
  role?: string;
  kycStatus?: string;
  externalDependencyPercent: number;
  ownerControlPercent: number;
  initialRorkDependencyPercent: number;
  targetRorkDependencyPercent: number;
  targetDateForZeroPercent: string;
  remainingBlockers: IVXIndependenceDependency[];
  completedRemovals: IVXIndependenceDependency[];
  nextRequiredAction: string;
  dependencies: IVXIndependenceDependency[];
  dailyChecklist: IVXIndependenceChecklistItem[];
  safeMigrationOrder: string[];
  productionSafety: {
    productionStable: boolean;
    allAtOnceRevocationAllowed: boolean;
    reason: string;
  };
  firstCompletedDependencyRemoval: IVXIndependenceDependency | null;
  secretValuesReturned: false;
  timestamp: string;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeProvider(value: unknown): IVXVariablesToolProviderStatus {
  const record = isRecord(value) ? value : {};
  return {
    connected: readBoolean(record.connected),
    configured: readBoolean(record.configured),
    runtimeCanAccess: readBoolean(record.runtimeCanAccess),
    secretValuesReturned: false,
    httpStatus: readNumberOrNull(record.httpStatus),
    serviceHttpStatus: readNumberOrNull(record.serviceHttpStatus),
    envVarsHttpStatus: readNumberOrNull(record.envVarsHttpStatus),
    error: readString(record.error) || undefined,
  };
}

function normalizeVariableProof(value: unknown): IVXVariablesToolVariableProof | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const name = readString(record.name) as IVXVariablesToolRequiredName;
  if (!(IVX_VARIABLES_TOOL_REQUIRED_NAMES as readonly string[]).includes(name)) {
    return null;
  }
  return {
    name,
    variableNamePresent: readBoolean(record.variableNamePresent),
    backendRuntimeCanAccess: readBoolean(record.backendRuntimeCanAccess),
    toolAuthorized: readBoolean(record.toolAuthorized),
    productionLive: readBoolean(record.productionLive),
  };
}

function normalizeStatus(payload: unknown): IVXVariablesToolStatus {
  if (!isRecord(payload)) {
    throw new Error('Variables tool status response was not an object.');
  }
  const providers = isRecord(payload.providers) ? payload.providers : {};
  const production = isRecord(payload.production) ? payload.production : null;
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    tool: readString(payload.tool) || 'ivx_variables_credentials_tool',
    secureBackendStorage: readString(payload.secureBackendStorage) || 'render_environment_variables',
    secretValuesReturned: false,
    ownerAuthorized: readBoolean(payload.ownerAuthorized),
    toolAuthorized: readBoolean(payload.toolAuthorized),
    renderToolAuthorized: readBoolean(payload.renderToolAuthorized),
    productionLive: readBoolean(payload.productionLive),
    production: production
      ? {
        productionLive: readBoolean(production.productionLive),
        apiHealthHttp200: readBoolean(production.apiHealthHttp200),
        frontendLoads: readBoolean(production.frontendLoads),
        apiHealthStatus: readNumberOrNull(production.apiHealthStatus),
        frontendStatus: readNumberOrNull(production.frontendStatus),
      }
      : undefined,
    variables: Array.isArray(payload.variables) ? payload.variables.map(normalizeVariableProof).filter((item): item is IVXVariablesToolVariableProof => item !== null) : [],
    allRequiredCredentialsPresent: readBoolean(payload.allRequiredCredentialsPresent),
    allRequiredCredentialsRuntimeAccessible: readBoolean(payload.allRequiredCredentialsRuntimeAccessible),
    providers: {
      github: normalizeProvider(providers.github),
      render: normalizeProvider(providers.render),
      supabase: normalizeProvider(providers.supabase),
      aws: normalizeProvider(providers.aws),
    },
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    authenticatedUserId: readString(payload.authenticatedUserId) || undefined,
    error: readString(payload.error) || undefined,
  };
}

function normalizeSaveResponse(payload: unknown): IVXVariablesToolSaveResponse {
  if (!isRecord(payload)) {
    throw new Error('Variables tool save response was not an object.');
  }
  const redeploy = isRecord(payload.redeploy) ? payload.redeploy : null;
  const savedVariableNames = Array.isArray(payload.savedVariableNames)
    ? payload.savedVariableNames
      .map(readString)
      .filter((name): name is IVXVariablesToolRequiredName => (IVX_VARIABLES_TOOL_REQUIRED_NAMES as readonly string[]).includes(name))
    : undefined;
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    toolAuthorized: readBoolean(payload.toolAuthorized),
    secureBackendStorage: readString(payload.secureBackendStorage) || undefined,
    secretValuesReturned: false,
    savedVariableNames,
    redeploy: redeploy
      ? {
        deployTriggered: readBoolean(redeploy.deployTriggered),
        httpStatus: readNumberOrNull(redeploy.httpStatus),
        deployId: readString(redeploy.deployId) || null,
        requiredForBackendRuntimeAccess: readBoolean(redeploy.requiredForBackendRuntimeAccess),
      }
      : undefined,
    statusAfterSave: isRecord(payload.statusAfterSave) ? normalizeStatus(payload.statusAfterSave) : undefined,
    missingVariableNames: Array.isArray(payload.missingVariableNames) ? payload.missingVariableNames.map(readString).filter(Boolean) : undefined,
    message: readString(payload.message) || undefined,
    error: readString(payload.error) || undefined,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
  };
}

function buildVariablesToolUrls(path: '/api/ivx/variables-tool/status' | '/api/ivx/variables-tool/save' | '/api/ivx/owner-variables/status' | '/api/ivx/owner-variables/save' | '/api/ivx/owner-variables/test' | '/api/ivx/owner-variables/delete' | '/api/ivx/owner-variables/self-sync' | '/api/ivx/independence/status'): string[] {
  const audit = getIVXOwnerAIConfigAudit();
  const urls: string[] = [];
  const pushUrl = (value: string | null | undefined) => {
    const normalized = value?.trim();
    if (!normalized || urls.includes(normalized)) {
      return;
    }
    urls.push(normalized);
  };
  if (audit.activeBaseUrl) {
    pushUrl(`${audit.activeBaseUrl.replace(/\/+$/, '')}${path}`);
  }
  for (const endpoint of audit.candidateEndpoints) {
    const normalizedEndpoint = endpoint.replace(/\/+$/, '');
    if (normalizedEndpoint.endsWith('/api/ivx/owner-ai')) {
      pushUrl(`${normalizedEndpoint.slice(0, -'/api/ivx/owner-ai'.length)}${path}`);
    } else if (normalizedEndpoint.endsWith('/ivx/owner-ai')) {
      pushUrl(`${normalizedEndpoint.slice(0, -'/ivx/owner-ai'.length)}${path}`);
    }
  }
  return urls;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    return { error: text.slice(0, 240) };
  }
}

class IVXVariablesToolRequestError extends Error {
  readonly status: number;
  readonly authExpired: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'IVXVariablesToolRequestError';
    this.status = status;
    this.authExpired = status === 401 && /auth|bearer|token|session|expired|invalid/i.test(message);
  }
}

async function fetchWithOwnerAuth(url: string, init: RequestInit, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message = isRecord(payload) ? readString(payload.error) || readString(payload.message) : '';
    throw new IVXVariablesToolRequestError(message || `Variables tool request failed with HTTP ${response.status}.`, response.status);
  }
  return payload;
}

async function fetchWithOwnerAuthRetry(url: string, init: RequestInit): Promise<unknown> {
  const accessToken = await getIVXAccessToken();
  if (!accessToken) {
    throw new Error('Owner session token is not connected. Sign in again with the IVX owner/admin account, then retry this save.');
  }

  try {
    return await fetchWithOwnerAuth(url, init, accessToken);
  } catch (error) {
    if (!(error instanceof IVXVariablesToolRequestError) || !error.authExpired) {
      throw error;
    }

    const refreshedToken = await getIVXAccessToken({ forceRefresh: true });
    if (refreshedToken && refreshedToken !== accessToken) {
      return await fetchWithOwnerAuth(url, init, refreshedToken);
    }

    throw new Error('Owner session expired. Sign out and sign in again with the IVX owner/admin account, then retry this save. Your pasted credential values were not returned or logged.');
  }
}

export async function getIVXVariablesToolStatus(): Promise<IVXVariablesToolStatus> {
  const urls = buildVariablesToolUrls('/api/ivx/variables-tool/status');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeStatus(await fetchWithOwnerAuthRetry(url, { method: 'GET' }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Variables tool status failed.');
    }
  }
  throw lastError ?? new Error('Variables tool backend URL is not configured.');
}

export async function saveIVXVariablesToolCredentials(input: {
  variables: Partial<Record<IVXVariablesToolRequiredName, string>>;
  triggerDeploy: boolean;
  renderApiKey?: string;
  renderServiceId?: string;
}): Promise<IVXVariablesToolSaveResponse> {
  const urls = buildVariablesToolUrls('/api/ivx/variables-tool/save');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeSaveResponse(await fetchWithOwnerAuthRetry(url, {
        method: 'POST',
        body: JSON.stringify({
          variables: input.variables,
          triggerDeploy: input.triggerDeploy,
          renderApiKey: input.renderApiKey,
          renderServiceId: input.renderServiceId,
        }),
      }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Variables tool save failed.');
    }
  }
  throw lastError ?? new Error('Variables tool backend URL is not configured.');
}

function normalizeOwnerVariableName(value: unknown): IVXOwnerVariableName | null {
  const name = readString(value) as IVXOwnerVariableName;
  return (IVX_OWNER_VARIABLE_NAMES as readonly string[]).includes(name) ? name : null;
}

function normalizeOwnerProvider(value: unknown): IVXOwnerVariableProvider {
  const provider = readString(value) as IVXOwnerVariableProvider;
  if (['github', 'render', 'supabase', 'aws', 'ai', 'security', 'storage'].includes(provider)) {
    return provider;
  }
  return 'security';
}

function normalizeOwnerVariableStatusValue(value: unknown): IVXOwnerVariableStatusValue {
  const status = readString(value) as IVXOwnerVariableStatusValue;
  return status === 'saved' || status === 'tested' || status === 'invalid' ? status : 'missing';
}

function normalizeOwnerVariableRow(value: unknown): IVXOwnerVariableRow | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const name = normalizeOwnerVariableName(record.name);
  if (!name) return null;
  return {
    name,
    provider: normalizeOwnerProvider(record.provider),
    required: readBoolean(record.required),
    secret: readBoolean(record.secret),
    status: normalizeOwnerVariableStatusValue(record.status),
    saved: readBoolean(record.saved),
    lastTestedAt: readString(record.lastTestedAt) || null,
    maskedPreview: readString(record.maskedPreview) || null,
    description: readString(record.description),
    secretValuesReturned: false,
  };
}

function normalizeOwnerProviderReadiness(value: unknown): IVXOwnerVariableProviderReadiness | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const provider = normalizeOwnerProvider(record.provider);
  return {
    provider,
    status: normalizeOwnerVariableStatusValue(record.status),
    requiredVariableNames: Array.isArray(record.requiredVariableNames) ? record.requiredVariableNames.map(normalizeOwnerVariableName).filter((item): item is IVXOwnerVariableName => item !== null) : [],
    savedVariableNames: Array.isArray(record.savedVariableNames) ? record.savedVariableNames.map(normalizeOwnerVariableName).filter((item): item is IVXOwnerVariableName => item !== null) : [],
    missingVariableNames: Array.isArray(record.missingVariableNames) ? record.missingVariableNames.map(normalizeOwnerVariableName).filter((item): item is IVXOwnerVariableName => item !== null) : [],
    lastTestedAt: readString(record.lastTestedAt) || null,
    secretValuesReturned: false,
    httpStatus: readNumberOrNull(record.httpStatus),
    error: readString(record.error) || undefined,
  };
}

function normalizeOwnerVariablesStatus(payload: unknown): IVXOwnerVariablesStatus {
  if (!isRecord(payload)) {
    throw new Error('Owner Variables status response was not an object.');
  }
  const storage = isRecord(payload.storage) ? payload.storage : {};
  const providerPayload = isRecord(payload.providers) ? payload.providers : {};
  const providers: Partial<Record<IVXOwnerVariableProvider, IVXOwnerVariableProviderReadiness>> = {};
  for (const rawProvider of Object.values(providerPayload)) {
    const item = normalizeOwnerProviderReadiness(rawProvider);
    if (item) providers[item.provider] = item;
  }
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    routeRegistered: readBoolean(payload.routeRegistered),
    tool: readString(payload.tool) || 'ivx_owner_variables_credentials_module',
    deploymentMarker: readString(payload.deploymentMarker),
    authenticatedUserId: readString(payload.authenticatedUserId) || undefined,
    authenticatedRole: readString(payload.authenticatedRole) || undefined,
    storage: {
      configured: readBoolean(storage.configured),
      backend: readString(storage.backend) || 'unknown',
      encryptedAtRest: readBoolean(storage.encryptedAtRest),
      encryptionConfigured: readBoolean(storage.encryptionConfigured),
      auditLogEnabled: readBoolean(storage.auditLogEnabled),
      error: readString(storage.error) || undefined,
    },
    variables: Array.isArray(payload.variables) ? payload.variables.map(normalizeOwnerVariableRow).filter((item): item is IVXOwnerVariableRow => item !== null) : [],
    providers,
    missingCredentials: Array.isArray(payload.missingCredentials) ? payload.missingCredentials.map(normalizeOwnerVariableName).filter((item): item is IVXOwnerVariableName => item !== null) : [],
    secretValuesReturned: false,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    error: readString(payload.error) || undefined,
  };
}

function normalizeOwnerSaveResponse(payload: unknown): IVXOwnerVariableSaveResponse {
  if (!isRecord(payload)) throw new Error('Owner Variables save response was not an object.');
  const saved = isRecord(payload.saved) ? payload.saved : null;
  const savedName = normalizeOwnerVariableName(saved?.name);
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    saved: saved && savedName ? {
      name: savedName,
      provider: normalizeOwnerProvider(saved.provider),
      status: normalizeOwnerVariableStatusValue(saved.status),
      maskedPreview: readString(saved.maskedPreview) || null,
      lastTestedAt: readString(saved.lastTestedAt) || null,
      secretValuesReturned: false,
    } : undefined,
    statusAfterSave: isRecord(payload.statusAfterSave) ? normalizeOwnerVariablesStatus(payload.statusAfterSave) : undefined,
    secretValuesReturned: false,
    deploymentMarker: readString(payload.deploymentMarker) || undefined,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    error: readString(payload.error) || undefined,
  };
}

function normalizeOwnerActionResponse(payload: unknown): IVXOwnerVariableActionResponse {
  if (!isRecord(payload)) throw new Error('Owner Variables action response was not an object.');
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    variableName: normalizeOwnerVariableName(payload.variableName) ?? undefined,
    provider: payload.provider ? normalizeOwnerProvider(payload.provider) : undefined,
    deleted: readBoolean(payload.deleted),
    testResult: payload.testResult ? normalizeOwnerVariableStatusValue(payload.testResult) : undefined,
    message: readString(payload.message) || undefined,
    providerResult: isRecord(payload.providerResult) ? normalizeOwnerProviderReadiness(payload.providerResult) ?? undefined : undefined,
    statusAfterTest: isRecord(payload.statusAfterTest) ? normalizeOwnerVariablesStatus(payload.statusAfterTest) : undefined,
    statusAfterDelete: isRecord(payload.statusAfterDelete) ? normalizeOwnerVariablesStatus(payload.statusAfterDelete) : undefined,
    secretValuesReturned: false,
    deploymentMarker: readString(payload.deploymentMarker) || undefined,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    error: readString(payload.error) || undefined,
  };
}

function normalizeIndependenceRiskLevel(value: unknown): IVXIndependenceRiskLevel {
  const level = readString(value) as IVXIndependenceRiskLevel;
  if (level === 'critical' || level === 'high' || level === 'medium' || level === 'low') return level;
  return 'medium';
}

function normalizeIndependenceDependencyStatus(value: unknown): IVXIndependenceDependencyStatus {
  const status = readString(value) as IVXIndependenceDependencyStatus;
  if (status === 'blocked' || status === 'in_progress' || status === 'completed' || status === 'needs_owner_proof') return status;
  return 'blocked';
}

function normalizeIndependenceDependency(value: unknown): IVXIndependenceDependency | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const id = readString(record.id);
  const dependencyName = readString(record.dependencyName);
  if (!id || !dependencyName) return null;
  return {
    id,
    dependencyName,
    riskLevel: normalizeIndependenceRiskLevel(record.riskLevel),
    currentStatus: normalizeIndependenceDependencyStatus(record.currentStatus),
    removalTask: readString(record.removalTask),
    ownerActionRequired: readString(record.ownerActionRequired),
    proofRequired: readString(record.proofRequired),
    completionDate: readString(record.completionDate) || null,
    externalDependencyReduced: readString(record.externalDependencyReduced),
    proofBefore: readString(record.proofBefore),
    proofAfter: readString(record.proofAfter),
  };
}

function normalizeIndependenceChecklistItem(value: unknown): IVXIndependenceChecklistItem | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const day = typeof record.day === 'number' && Number.isFinite(record.day) ? record.day : 0;
  const title = readString(record.title);
  if (day <= 0 || !title) return null;
  return {
    day,
    title,
    checklist: Array.isArray(record.checklist) ? record.checklist.map(readString).filter(Boolean) : [],
    status: record.status === 'completed' || record.status === 'in_progress' ? record.status : 'pending',
  };
}

function normalizeOwnerAccessProof(value: unknown): IVXOwnerAccessProof | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ownerCanSignIn: readBoolean(value.ownerCanSignIn),
    ownerDashboardAccessible: readBoolean(value.ownerDashboardAccessible),
    ownerVariablesAccessible: readBoolean(value.ownerVariablesAccessible),
    independenceTrackerAccessible: readBoolean(value.independenceTrackerAccessible),
    role: readString(value.role),
    kycStatus: readString(value.kycStatus),
    source: readString(value.source),
    secretValuesReturned: false,
  };
}

function normalizeIndependenceStatus(payload: unknown): IVXIndependenceStatus {
  if (!isRecord(payload)) throw new Error('Independence status response was not an object.');
  const productionSafety = isRecord(payload.productionSafety) ? payload.productionSafety : {};
  const dependencies = Array.isArray(payload.dependencies) ? payload.dependencies.map(normalizeIndependenceDependency).filter((item): item is IVXIndependenceDependency => item !== null) : [];
  const firstCompleted = normalizeIndependenceDependency(payload.firstCompletedDependencyRemoval);
  const ownerAccessProof = normalizeOwnerAccessProof(payload.ownerAccessProof);
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    routeRegistered: readBoolean(payload.routeRegistered),
    tool: readString(payload.tool) || 'ivx_independence_tracker',
    deploymentMarker: readString(payload.deploymentMarker),
    authenticatedUserId: readString(payload.authenticatedUserId) || undefined,
    authenticatedRole: readString(payload.authenticatedRole) || undefined,
    ownerAccessProof,
    ownerCanSignIn: ownerAccessProof?.ownerCanSignIn ?? readBoolean(payload.ownerCanSignIn),
    ownerDashboardAccessible: ownerAccessProof?.ownerDashboardAccessible ?? readBoolean(payload.ownerDashboardAccessible),
    ownerVariablesAccessible: ownerAccessProof?.ownerVariablesAccessible ?? readBoolean(payload.ownerVariablesAccessible),
    independenceTrackerAccessible: ownerAccessProof?.independenceTrackerAccessible ?? readBoolean(payload.independenceTrackerAccessible),
    role: ownerAccessProof?.role || readString(payload.role) || undefined,
    kycStatus: ownerAccessProof?.kycStatus || readString(payload.kycStatus) || undefined,
    externalDependencyPercent: typeof payload.externalDependencyPercent === 'number' && Number.isFinite(payload.externalDependencyPercent) ? payload.externalDependencyPercent : 100,
    ownerControlPercent: typeof payload.ownerControlPercent === 'number' && Number.isFinite(payload.ownerControlPercent) ? payload.ownerControlPercent : 0,
    initialRorkDependencyPercent: typeof payload.initialRorkDependencyPercent === 'number' && Number.isFinite(payload.initialRorkDependencyPercent) ? payload.initialRorkDependencyPercent : 100,
    targetRorkDependencyPercent: typeof payload.targetRorkDependencyPercent === 'number' && Number.isFinite(payload.targetRorkDependencyPercent) ? payload.targetRorkDependencyPercent : 0,
    targetDateForZeroPercent: readString(payload.targetDateForZeroPercent),
    remainingBlockers: Array.isArray(payload.remainingBlockers) ? payload.remainingBlockers.map(normalizeIndependenceDependency).filter((item): item is IVXIndependenceDependency => item !== null) : dependencies.filter((item) => item.currentStatus !== 'completed'),
    completedRemovals: Array.isArray(payload.completedRemovals) ? payload.completedRemovals.map(normalizeIndependenceDependency).filter((item): item is IVXIndependenceDependency => item !== null) : dependencies.filter((item) => item.currentStatus === 'completed'),
    nextRequiredAction: readString(payload.nextRequiredAction),
    dependencies,
    dailyChecklist: Array.isArray(payload.dailyChecklist) ? payload.dailyChecklist.map(normalizeIndependenceChecklistItem).filter((item): item is IVXIndependenceChecklistItem => item !== null) : [],
    safeMigrationOrder: Array.isArray(payload.safeMigrationOrder) ? payload.safeMigrationOrder.map(readString).filter(Boolean) : [],
    productionSafety: {
      productionStable: readBoolean(productionSafety.productionStable),
      allAtOnceRevocationAllowed: readBoolean(productionSafety.allAtOnceRevocationAllowed),
      reason: readString(productionSafety.reason),
    },
    firstCompletedDependencyRemoval: firstCompleted,
    secretValuesReturned: false,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    error: readString(payload.error) || undefined,
  };
}

export async function getIVXOwnerVariablesStatus(): Promise<IVXOwnerVariablesStatus> {
  const urls = buildVariablesToolUrls('/api/ivx/owner-variables/status');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeOwnerVariablesStatus(await fetchWithOwnerAuthRetry(url, { method: 'GET' }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Owner Variables status failed.');
    }
  }
  throw lastError ?? new Error('Owner Variables backend URL is not configured.');
}

export async function saveIVXOwnerVariable(input: { name: IVXOwnerVariableName; value: string }): Promise<IVXOwnerVariableSaveResponse> {
  const urls = buildVariablesToolUrls('/api/ivx/owner-variables/save');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeOwnerSaveResponse(await fetchWithOwnerAuthRetry(url, { method: 'POST', body: JSON.stringify(input) }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Owner Variables save failed.');
    }
  }
  throw lastError ?? new Error('Owner Variables backend URL is not configured.');
}

export async function testIVXOwnerVariable(input: { name?: IVXOwnerVariableName; provider?: IVXOwnerVariableProvider }): Promise<IVXOwnerVariableActionResponse> {
  const urls = buildVariablesToolUrls('/api/ivx/owner-variables/test');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeOwnerActionResponse(await fetchWithOwnerAuthRetry(url, { method: 'POST', body: JSON.stringify(input) }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Owner Variables test failed.');
    }
  }
  throw lastError ?? new Error('Owner Variables backend URL is not configured.');
}

export type IVXOwnerVariableSelfSyncResult = {
  name: IVXOwnerVariableName;
  provider: IVXOwnerVariableProvider;
  action: 'synced' | 'skipped_existing' | 'missing_in_env' | 'error';
  sourceEnvName: string | null;
  maskedPreview: string | null;
  message?: string;
};

export type IVXOwnerVariablesSelfSyncResponse = {
  ok: boolean;
  ownerOnly: boolean;
  tool: string;
  deploymentMarker?: string;
  authenticatedUserId?: string;
  mode: string;
  overwriteExisting: boolean;
  summary: {
    candidatesChecked: number;
    syncedCount: number;
    skippedExistingCount: number;
    missingInEnvCount: number;
    errorCount: number;
  };
  results: IVXOwnerVariableSelfSyncResult[];
  missingInEnv: IVXOwnerVariableName[];
  errored: IVXOwnerVariableName[];
  statusAfterSync?: IVXOwnerVariablesStatus;
  secretValuesReturned: false;
  timestamp: string;
  error?: string;
};

function normalizeSelfSyncResult(value: unknown): IVXOwnerVariableSelfSyncResult | null {
  if (!isRecord(value)) return null;
  const name = readString(value.name) as IVXOwnerVariableName;
  if (!(IVX_OWNER_VARIABLE_NAMES as readonly string[]).includes(name)) return null;
  const action = readString(value.action) as IVXOwnerVariableSelfSyncResult['action'];
  return {
    name,
    provider: readString(value.provider) as IVXOwnerVariableProvider,
    action: action === 'synced' || action === 'skipped_existing' || action === 'missing_in_env' || action === 'error' ? action : 'error',
    sourceEnvName: readString(value.sourceEnvName) || null,
    maskedPreview: readString(value.maskedPreview) || null,
    message: readString(value.message) || undefined,
  };
}

function normalizeSelfSyncResponse(payload: unknown): IVXOwnerVariablesSelfSyncResponse {
  if (!isRecord(payload)) {
    throw new Error('Owner Variables self-sync response was not an object.');
  }
  const summary = isRecord(payload.summary) ? payload.summary : {};
  const results = Array.isArray(payload.results)
    ? payload.results.map(normalizeSelfSyncResult).filter((item): item is IVXOwnerVariableSelfSyncResult => item !== null)
    : [];
  const missingInEnv = Array.isArray(payload.missingInEnv)
    ? payload.missingInEnv.map(readString).filter((name): name is IVXOwnerVariableName => (IVX_OWNER_VARIABLE_NAMES as readonly string[]).includes(name))
    : [];
  const errored = Array.isArray(payload.errored)
    ? payload.errored.map(readString).filter((name): name is IVXOwnerVariableName => (IVX_OWNER_VARIABLE_NAMES as readonly string[]).includes(name))
    : [];
  return {
    ok: readBoolean(payload.ok),
    ownerOnly: readBoolean(payload.ownerOnly),
    tool: readString(payload.tool) || 'ivx_owner_variables_self_sync',
    deploymentMarker: readString(payload.deploymentMarker) || undefined,
    authenticatedUserId: readString(payload.authenticatedUserId) || undefined,
    mode: readString(payload.mode) || 'backend_runtime_env_to_encrypted_store',
    overwriteExisting: readBoolean(payload.overwriteExisting),
    summary: {
      candidatesChecked: readNumberOrNull(summary.candidatesChecked) ?? 0,
      syncedCount: readNumberOrNull(summary.syncedCount) ?? 0,
      skippedExistingCount: readNumberOrNull(summary.skippedExistingCount) ?? 0,
      missingInEnvCount: readNumberOrNull(summary.missingInEnvCount) ?? 0,
      errorCount: readNumberOrNull(summary.errorCount) ?? 0,
    },
    results,
    missingInEnv,
    errored,
    statusAfterSync: isRecord(payload.statusAfterSync) ? normalizeOwnerVariablesStatus(payload.statusAfterSync) : undefined,
    secretValuesReturned: false,
    timestamp: readString(payload.timestamp) || new Date().toISOString(),
    error: readString(payload.error) || undefined,
  };
}

export async function selfSyncIVXOwnerVariablesFromRorkEnv(input?: { names?: IVXOwnerVariableName[]; overwriteExisting?: boolean }): Promise<IVXOwnerVariablesSelfSyncResponse> {
  const urls = buildVariablesToolUrls('/api/ivx/owner-variables/self-sync');
  const body = JSON.stringify({
    names: input?.names,
    overwriteExisting: input?.overwriteExisting !== false,
  });
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeSelfSyncResponse(await fetchWithOwnerAuthRetry(url, { method: 'POST', body }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Owner Variables self-sync failed.');
    }
  }
  throw lastError ?? new Error('Owner Variables backend URL is not configured.');
}

export async function deleteIVXOwnerVariable(name: IVXOwnerVariableName): Promise<IVXOwnerVariableActionResponse> {
  const urls = buildVariablesToolUrls('/api/ivx/owner-variables/delete');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeOwnerActionResponse(await fetchWithOwnerAuthRetry(url, { method: 'POST', body: JSON.stringify({ name }) }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Owner Variables delete failed.');
    }
  }
  throw lastError ?? new Error('Owner Variables backend URL is not configured.');
}

const IVX_RENDER_DIRECT_BACKEND_ORIGIN = 'https://ivx-holdings-platform.onrender.com' as const;
const IVX_RENDER_DEPLOY_CONFIRM_TEXT = 'CONFIRM_IVX_RENDER_DEPLOY' as const;

export type IVXRenderDeployTriggerResult = {
  ok: boolean;
  ownerOnly: boolean;
  writeEnabled: boolean;
  action: string;
  endpoint: string;
  httpStatus: number;
  serviceId: string | null;
  deployId: string | null;
  deployStatus: string | null;
  url: string | null;
  authenticatedUserId: string | null;
  error: string | null;
  timestamp: string;
};

export async function triggerIVXRenderDeploy(input?: { clearCache?: boolean; reason?: string }): Promise<IVXRenderDeployTriggerResult> {
  const accessToken = await getIVXAccessToken();
  if (!accessToken) {
    throw new Error('Owner session token is not connected. Sign in again with the IVX owner/admin account, then tap Deploy backend now.');
  }
  const endpoint = `${IVX_RENDER_DIRECT_BACKEND_ORIGIN}/api/ivx/developer-deploy/action`;
  const body = {
    action: 'render_trigger_deploy' as const,
    confirm: true,
    confirmText: IVX_RENDER_DEPLOY_CONFIRM_TEXT,
    reason: input?.reason || 'Owner-tapped in-app Render deploy from Owner Variables',
    input: {
      clearCache: input?.clearCache === true,
    },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  const record = isRecord(payload) ? payload : {};
  const result = isRecord(record.result) ? record.result : {};
  const timestamp = readString(record.timestamp) || new Date().toISOString();
  if (!response.ok) {
    const message = readString(record.error) || readString(record.message) || `Render deploy request failed with HTTP ${response.status}.`;
    return {
      ok: false,
      ownerOnly: readBoolean(record.ownerOnly),
      writeEnabled: readBoolean(record.writeEnabled),
      action: 'render_trigger_deploy',
      endpoint,
      httpStatus: response.status,
      serviceId: readString(result.serviceId) || null,
      deployId: readString(result.deployId) || null,
      deployStatus: readString(result.status) || null,
      url: readString(result.url) || null,
      authenticatedUserId: readString(record.authenticatedUserId) || null,
      error: message,
      timestamp,
    };
  }
  return {
    ok: readBoolean(record.ok),
    ownerOnly: readBoolean(record.ownerOnly),
    writeEnabled: readBoolean(record.writeEnabled),
    action: readString(record.action) || 'render_trigger_deploy',
    endpoint,
    httpStatus: response.status,
    serviceId: readString(result.serviceId) || null,
    deployId: readString(result.deployId) || null,
    deployStatus: readString(result.status) || null,
    url: readString(result.url) || null,
    authenticatedUserId: readString(record.authenticatedUserId) || null,
    error: null,
    timestamp,
  };
}

export async function getIVXIndependenceStatus(): Promise<IVXIndependenceStatus> {
  const urls = buildVariablesToolUrls('/api/ivx/independence/status');
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return normalizeIndependenceStatus(await fetchWithOwnerAuthRetry(url, { method: 'GET' }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Independence status failed.');
    }
  }
  throw lastError ?? new Error('Independence status backend URL is not configured.');
}
