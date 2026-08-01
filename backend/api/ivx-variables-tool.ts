import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { IVX_CREDENTIAL_REQUEST_MANIFEST } from '../config/ivx-credential-request-manifest';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';

const RENDER_API_BASE_URL = 'https://api.render.com/v1';
const API_HEALTH_URL = 'https://api.ivxholding.com/health';
const CHAT_FRONTEND_URL = 'https://chat.ivxholding.com/';
const MAX_VARIABLE_VALUE_LENGTH = 16_384;

export const IVX_VARIABLES_TOOL_ENV_NAMES = [
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

type IVXVariablesToolEnvName = typeof IVX_VARIABLES_TOOL_ENV_NAMES[number];

type RenderEnvVarUpdateResult = {
  name: IVXVariablesToolEnvName;
  accepted: boolean;
  storedInRender: boolean;
  backendRuntimeCanAccess: boolean;
  secretValueReturned: false;
  httpStatus: number | null;
};

type ProviderConnectionStatus = {
  connected: boolean;
  configured: boolean;
  httpStatus?: number | null;
  runtimeCanAccess: boolean;
  error?: string;
};

type RenderStatusSnapshot = {
  renderToolAuthorized: boolean;
  apiKeyConfigured: boolean;
  serviceIdConfigured: boolean;
  serviceHttpStatus: number | null;
  envVarsHttpStatus: number | null;
  envVarKeySet: Set<string>;
  error?: string;
};

type ProductionLiveSnapshot = {
  productionLive: boolean;
  apiHealthHttp200: boolean;
  frontendLoads: boolean;
  apiHealthStatus: number | null;
  frontendStatus: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  return readTrimmed(process.env[name]);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAllowedVariableName(value: string): value is IVXVariablesToolEnvName {
  return (IVX_VARIABLES_TOOL_ENV_NAMES as readonly string[]).includes(value);
}

function normalizeVariableValue(name: IVXVariablesToolEnvName, rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    throw new Error(`Variable ${name} must be a string.`);
  }
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`Variable ${name} cannot be blank.`);
  }
  if (value.length > MAX_VARIABLE_VALUE_LENGTH) {
    throw new Error(`Variable ${name} exceeds the maximum allowed length.`);
  }
  return value;
}

function assignBootstrapVariable(
  variables: Partial<Record<IVXVariablesToolEnvName, string>>,
  name: IVXVariablesToolEnvName,
  value: string,
): void {
  const trimmedValue = readTrimmed(value);
  if (!trimmedValue || variables[name]) {
    return;
  }
  variables[name] = normalizeVariableValue(name, trimmedValue);
}

function buildAllowedVariableMetadata() {
  const manifestByName = new Map(IVX_CREDENTIAL_REQUEST_MANIFEST.map((entry) => [entry.name, entry]));
  return IVX_VARIABLES_TOOL_ENV_NAMES.map((name) => {
    const manifest = manifestByName.get(name);
    return {
      name,
      secret: manifest?.secret ?? true,
      frontendAllowed: false,
      renderTarget: 'backend',
      description: manifest?.description ?? 'Backend-only IVX production credential.',
      placeholder: manifest?.placeholder ?? name,
    };
  });
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') {
    return undefined;
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function renderHeaders(apiKey: string): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function sanitizeExternalErrorDetail(value: string): string {
  return value
    .replace(/[A-Za-z0-9_\-.=]{24,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 220);
}

async function readExternalErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) {
    return '';
  }
  try {
    const payload = JSON.parse(text) as unknown;
    const record = readRecord(payload);
    const message = readTrimmed(record.message) || readTrimmed(record.error) || readTrimmed(record.errorMessage);
    return sanitizeExternalErrorDetail(message || text);
  } catch {
    return sanitizeExternalErrorDetail(text);
  }
}

function extractRenderEnvVarKeyNames(data: unknown): string[] {
  const values = Array.isArray(data)
    ? data
    : Array.isArray(readRecord(data).envVars)
      ? readRecord(data).envVars as unknown[]
      : [];
  return values
    .map((item) => {
      const record = readRecord(item);
      const envVar = readRecord(record.envVar);
      return readTrimmed(record.key) || readTrimmed(envVar.key);
    })
    .filter(Boolean);
}

async function fetchRenderStatus(apiKeyOverride?: string, serviceIdOverride?: string): Promise<RenderStatusSnapshot> {
  const apiKey = readTrimmed(apiKeyOverride) || readEnv('RENDER_API_KEY');
  const serviceId = readTrimmed(serviceIdOverride) || readEnv('RENDER_SERVICE_ID');
  if (!apiKey || !serviceId) {
    return {
      renderToolAuthorized: false,
      apiKeyConfigured: Boolean(apiKey),
      serviceIdConfigured: Boolean(serviceId),
      serviceHttpStatus: null,
      envVarsHttpStatus: null,
      envVarKeySet: new Set<string>(),
      error: 'Render API key or service ID is not loaded for this request.',
    };
  }

  try {
    const [serviceResponse, envVarsResponse] = await Promise.all([
      fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, {
        headers: renderHeaders(apiKey),
        signal: createTimeoutSignal(10_000),
      }),
      fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`, {
        headers: renderHeaders(apiKey),
        signal: createTimeoutSignal(10_000),
      }),
    ]);
    const envVarsData = await parseJsonResponse(envVarsResponse);
    const renderToolAuthorized = serviceResponse.ok && envVarsResponse.ok;
    return {
      renderToolAuthorized,
      apiKeyConfigured: true,
      serviceIdConfigured: true,
      serviceHttpStatus: serviceResponse.status,
      envVarsHttpStatus: envVarsResponse.status,
      envVarKeySet: new Set(extractRenderEnvVarKeyNames(envVarsData)),
      error: renderToolAuthorized ? undefined : `Render API status service=${serviceResponse.status}, envVars=${envVarsResponse.status}.`,
    };
  } catch (error) {
    return {
      renderToolAuthorized: false,
      apiKeyConfigured: true,
      serviceIdConfigured: true,
      serviceHttpStatus: null,
      envVarsHttpStatus: null,
      envVarKeySet: new Set<string>(),
      error: error instanceof Error ? error.message : 'Render status check failed.',
    };
  }
}

async function probeUrl(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const response = await fetch(url, { method: 'GET', signal: createTimeoutSignal(10_000) });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function fetchProductionLiveSnapshot(): Promise<ProductionLiveSnapshot> {
  const [apiHealth, frontend] = await Promise.all([
    probeUrl(API_HEALTH_URL),
    probeUrl(CHAT_FRONTEND_URL),
  ]);
  return {
    productionLive: apiHealth.status === 200 && frontend.ok,
    apiHealthHttp200: apiHealth.status === 200,
    frontendLoads: frontend.ok,
    apiHealthStatus: apiHealth.status,
    frontendStatus: frontend.status,
  };
}

async function checkGithubConnection(): Promise<ProviderConnectionStatus> {
  const token = readEnv('GITHUB_TOKEN');
  if (!token) {
    return { connected: false, configured: false, runtimeCanAccess: false };
  }
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: createTimeoutSignal(10_000),
    });
    return { connected: response.ok, configured: true, httpStatus: response.status, runtimeCanAccess: true };
  } catch (error) {
    return { connected: false, configured: true, httpStatus: null, runtimeCanAccess: true, error: error instanceof Error ? error.message : 'GitHub check failed.' };
  }
}

async function checkSupabaseConnection(): Promise<ProviderConnectionStatus> {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  const dbUrlConfigured = Boolean(readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL'));
  if (!supabaseUrl || !serviceRoleKey) {
    return { connected: false, configured: Boolean(supabaseUrl || serviceRoleKey || dbUrlConfigured), runtimeCanAccess: Boolean(serviceRoleKey || dbUrlConfigured) };
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      signal: createTimeoutSignal(10_000),
    });
    return { connected: response.ok, configured: true, httpStatus: response.status, runtimeCanAccess: true };
  } catch (error) {
    return { connected: false, configured: true, httpStatus: null, runtimeCanAccess: true, error: error instanceof Error ? error.message : 'Supabase check failed.' };
  }
}

async function checkAwsConnection(): Promise<ProviderConnectionStatus> {
  const accessKeyId = readEnv('AWS_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('AWS_SECRET_ACCESS_KEY');
  const region = readEnv('AWS_REGION') || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    return { connected: false, configured: false, runtimeCanAccess: false };
  }
  try {
    const client = new STSClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new GetCallerIdentityCommand({}));
    return { connected: true, configured: true, runtimeCanAccess: true };
  } catch (error) {
    return { connected: false, configured: true, runtimeCanAccess: true, error: error instanceof Error ? error.message : 'AWS identity check failed.' };
  }
}

function buildVariableProofRows(render: RenderStatusSnapshot, production: ProductionLiveSnapshot) {
  return IVX_VARIABLES_TOOL_ENV_NAMES.map((name) => {
    const runtimeCanAccess = Boolean(readEnv(name));
    const presentInRender = render.envVarKeySet.has(name);
    return {
      name,
      variableNamePresent: runtimeCanAccess || presentInRender,
      backendRuntimeCanAccess: runtimeCanAccess,
      toolAuthorized: render.renderToolAuthorized,
      productionLive: production.productionLive,
    };
  });
}

async function buildVariablesToolStatus(input: { apiKeyOverride?: string; serviceIdOverride?: string } = {}) {
  const [render, production, github, supabase, aws] = await Promise.all([
    fetchRenderStatus(input.apiKeyOverride, input.serviceIdOverride),
    fetchProductionLiveSnapshot(),
    checkGithubConnection(),
    checkSupabaseConnection(),
    checkAwsConnection(),
  ]);
  const variables = buildVariableProofRows(render, production);
  return {
    ok: true,
    ownerOnly: true,
    tool: 'ivx_variables_credentials_tool',
    secureBackendStorage: 'render_environment_variables',
    secretValuesReturned: false,
    ownerAuthorized: true,
    toolAuthorized: render.renderToolAuthorized,
    renderToolAuthorized: render.renderToolAuthorized,
    productionLive: production.productionLive,
    production,
    variables,
    allRequiredCredentialsPresent: variables.every((row) => row.variableNamePresent),
    allRequiredCredentialsRuntimeAccessible: variables.every((row) => row.backendRuntimeCanAccess),
    providers: {
      github: { ...github, secretValuesReturned: false },
      render: {
        connected: render.renderToolAuthorized,
        configured: render.apiKeyConfigured && render.serviceIdConfigured,
        runtimeCanAccess: Boolean(readEnv('RENDER_API_KEY') && readEnv('RENDER_SERVICE_ID')),
        serviceHttpStatus: render.serviceHttpStatus,
        envVarsHttpStatus: render.envVarsHttpStatus,
        error: render.error,
      },
      supabase: { ...supabase, secretValuesReturned: false },
      aws: { ...aws, secretValuesReturned: false },
    },
    saveEndpoint: 'POST /api/ivx/variables-tool/save',
    statusEndpoint: 'GET /api/ivx/variables-tool/status',
    redeploy: {
      requiredAfterSavingVariables: true,
      automaticallyTriggeredWhenRequested: render.renderToolAuthorized,
      guide: 'After Render env vars are saved, trigger a backend deploy/restart so process.env can load the new values.',
    },
    allowedVariables: buildAllowedVariableMetadata(),
    timestamp: nowIso(),
  };
}

function parseVariablesPayload(body: Record<string, unknown>): Partial<Record<IVXVariablesToolEnvName, string>> {
  const rawVariables = readRecord(body.variables);
  const parsed: Partial<Record<IVXVariablesToolEnvName, string>> = {};
  for (const [rawName, rawValue] of Object.entries(rawVariables)) {
    const name = readTrimmed(rawName);
    if (!isAllowedVariableName(name)) {
      throw new Error(`Unsupported variable name: ${name || 'blank'}.`);
    }
    parsed[name] = normalizeVariableValue(name, rawValue);
  }
  return parsed;
}

async function upsertRenderEnvVar(input: {
  apiKey: string;
  serviceId: string;
  name: IVXVariablesToolEnvName;
  value: string;
}): Promise<RenderEnvVarUpdateResult> {
  const response = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(input.serviceId)}/env-vars/${encodeURIComponent(input.name)}`, {
    method: 'PUT',
    headers: renderHeaders(input.apiKey),
    body: JSON.stringify({ value: input.value }),
    signal: createTimeoutSignal(15_000),
  });
  if (!response.ok) {
    const detail = await readExternalErrorDetail(response);
    throw new Error(`Render environment variable update failed for ${input.name} with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
  }
  return {
    name: input.name,
    accepted: true,
    storedInRender: true,
    backendRuntimeCanAccess: Boolean(readEnv(input.name)),
    secretValueReturned: false,
    httpStatus: response.status,
  };
}

async function triggerRenderDeploy(apiKey: string, serviceId: string): Promise<{ deployTriggered: boolean; httpStatus: number | null; deployId: string | null }> {
  const response = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    headers: renderHeaders(apiKey),
    body: JSON.stringify({ clearCache: 'clear' }),
    signal: createTimeoutSignal(15_000),
  });
  const data = readRecord(await parseJsonResponse(response));
  const deploy = readRecord(data.deploy);
  return {
    deployTriggered: response.ok,
    httpStatus: response.status,
    deployId: readTrimmed(data.id) || readTrimmed(deploy.id) || null,
  };
}

async function auditVariablesToolSave(ownerContext: IVXOwnerRequestContext, variableNames: string[], deployTriggered: boolean): Promise<void> {
  console.log('[IVXVariablesTool] Owner-approved variables save:', {
    userId: ownerContext.userId,
    email: ownerContext.email,
    variableNames,
    variableCount: variableNames.length,
    deployTriggered,
    secretValuesReturned: false,
    timestamp: nowIso(),
  });
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXVariablesToolStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    return ownerOnlyJson({ ...(await buildVariablesToolStatus()), authenticatedUserId: ownerContext.userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Variables tool status failed.';
    return ownerOnlyJson({
      ok: false,
      ownerOnly: true,
      toolAuthorized: false,
      secretValuesReturned: false,
      error: message,
      timestamp: nowIso(),
    }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

export async function handleIVXVariablesToolSaveRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readRecord(await request.json().catch(() => ({})));
    const variables = parseVariablesPayload(body);
    if (Object.keys(variables).length === 0) {
      throw new Error('At least one allowed variable is required.');
    }

    const requestRenderApiKey = readTrimmed(body.renderApiKey);
    const requestRenderServiceId = readTrimmed(body.renderServiceId);
    const transientApiKey = requestRenderApiKey || variables.RENDER_API_KEY || readEnv('RENDER_API_KEY');
    const transientServiceId = requestRenderServiceId || variables.RENDER_SERVICE_ID || readEnv('RENDER_SERVICE_ID');
    assignBootstrapVariable(variables, 'RENDER_API_KEY', requestRenderApiKey);
    assignBootstrapVariable(variables, 'RENDER_SERVICE_ID', requestRenderServiceId);
    const variableEntries = Object.entries(variables) as Array<[IVXVariablesToolEnvName, string]>;
    if (!transientApiKey || !transientServiceId) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        toolAuthorized: false,
        secretValuesReturned: false,
        missingVariableNames: [
          ...(!transientApiKey ? ['RENDER_API_KEY'] : []),
          ...(!transientServiceId ? ['RENDER_SERVICE_ID'] : []),
        ],
        renderCredentialBootstrap: {
          accepted: false,
          renderApiKeyProvidedForThisRequest: Boolean(requestRenderApiKey || variables.RENDER_API_KEY),
          renderServiceIdProvidedForThisRequest: Boolean(requestRenderServiceId || variables.RENDER_SERVICE_ID),
          secretValuesReturned: false,
        },
        message: 'Render connection is required before saving variables. Paste RENDER_API_KEY and RENDER_SERVICE_ID in the Variables tool; they can be sent as transient owner-only connection credentials and are never returned.',
        timestamp: nowIso(),
      }, 409);
    }

    const updateResults: RenderEnvVarUpdateResult[] = [];
    for (const [name, value] of variableEntries) {
      updateResults.push(await upsertRenderEnvVar({ apiKey: transientApiKey, serviceId: transientServiceId, name, value }));
    }

    const shouldTriggerDeploy = body.triggerDeploy !== false;
    const deploy = shouldTriggerDeploy
      ? await triggerRenderDeploy(transientApiKey, transientServiceId)
      : { deployTriggered: false, httpStatus: null, deployId: null };
    await auditVariablesToolSave(ownerContext, updateResults.map((result) => result.name), deploy.deployTriggered);

    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      toolAuthorized: true,
      secureBackendStorage: 'render_environment_variables',
      secretValuesReturned: false,
      savedVariableNames: updateResults.map((result) => result.name),
      renderCredentialBootstrap: {
        accepted: Boolean(requestRenderApiKey || requestRenderServiceId),
        savedToRenderEnvironment: Boolean(requestRenderApiKey || requestRenderServiceId),
        renderApiKeyProvidedForThisRequest: Boolean(requestRenderApiKey || variables.RENDER_API_KEY),
        renderServiceIdProvidedForThisRequest: Boolean(requestRenderServiceId || variables.RENDER_SERVICE_ID),
        secretValuesReturned: false,
      },
      updateResults,
      redeploy: {
        ...deploy,
        requiredForBackendRuntimeAccess: true,
      },
      statusAfterSave: await buildVariablesToolStatus({ apiKeyOverride: transientApiKey, serviceIdOverride: transientServiceId }),
      authenticatedUserId: ownerContext.userId,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Variables tool save failed.';
    console.log('[IVXVariablesTool] Save failed:', { message });
    return ownerOnlyJson({
      ok: false,
      ownerOnly: true,
      toolAuthorized: false,
      secretValuesReturned: false,
      error: message,
      timestamp: nowIso(),
    }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}
