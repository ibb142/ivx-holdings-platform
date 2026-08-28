import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';
import { invalidateIVXSystemSecretCache } from '../services/ivx-system-secret';

const DEPLOYMENT_MARKER = 'ivx-owner-variables-2026-05-08t2305z-rest-storage';
const RENDER_API_BASE_URL = 'https://api.render.com/v1';
const OWNER_VARIABLES_TABLE = 'ivx_owner_variables';
const OWNER_VARIABLES_AUDIT_TABLE = 'ivx_owner_variable_audit';
const MAX_VARIABLE_VALUE_LENGTH = 16_384;
const OWNER_VARIABLES_REST_TIMEOUT_MS = 5_000; // ivx-supabase-recovery-v1
const ENCRYPTION_AAD = Buffer.from('ivx_owner_variables:v1', 'utf8');

const OWNER_VARIABLES = [
  { name: 'GITHUB_TOKEN', provider: 'github', required: true, secret: true, description: 'GitHub token for owner-approved repository operations.' },
  { name: 'GITHUB_REPO_URL', provider: 'github', required: true, secret: false, description: 'GitHub repository URL IVX AI should inspect or update.' },
  { name: 'RENDER_API_KEY', provider: 'render', required: true, secret: true, description: 'Render API key for deploys and service/env checks.' },
  { name: 'RENDER_SERVICE_ID', provider: 'render', required: true, secret: false, description: 'Render backend service ID.' },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', provider: 'supabase', required: true, secret: true, description: 'Supabase anon key used by the app.' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', provider: 'supabase', required: true, secret: true, description: 'Backend-only Supabase service-role key.' },
  { name: 'IVX_AWS_READONLY_ACCESS_KEY_ID', provider: 'aws', required: true, secret: true, description: 'Least-privilege AWS read-only access key ID.' },
  { name: 'IVX_AWS_READONLY_SECRET_ACCESS_KEY', provider: 'aws', required: true, secret: true, description: 'Least-privilege AWS read-only secret access key.' },
  { name: 'AWS_REGION', provider: 'aws', required: true, secret: false, description: 'AWS region for read-only verification.' },
  { name: 'IVX_AI_GATEWAY_KEY', provider: 'ai', required: false, secret: true, description: 'Optional AI gateway key.' },
  { name: 'JWT_SECRET', provider: 'security', required: false, secret: true, description: 'Optional JWT signing secret.' },
  { name: 'APP_SECRET', provider: 'security', required: false, secret: true, description: 'Optional app secret.' },
  { name: 'OWNER_NEW_PASSWORD', provider: 'security', required: false, secret: true, description: 'Emergency owner password reset value used only by backend owner-access repair.' },
  { name: 'S3_BUCKET_NAME', provider: 'storage', required: false, secret: false, description: 'Optional S3 bucket name.' },
  { name: 'CLOUDFRONT_DISTRIBUTION_ID', provider: 'storage', required: false, secret: false, description: 'Optional CloudFront distribution ID.' },
  { name: 'IVX_RENDER_API_KEY', provider: 'render', required: false, secret: true, description: 'Alternative Render API key alias (checked when RENDER_API_KEY is absent).' },
  { name: 'AI_GATEWAY_API_KEY', provider: 'ai', required: false, secret: true, description: 'Alternative AI gateway key alias (checked when IVX_AI_GATEWAY_KEY is absent).' },
  { name: 'SUPABASE_ACCESS_TOKEN', provider: 'supabase', required: false, secret: true, description: 'Supabase Management API token for database migrations.' },
  { name: 'IVX_AI_SYSTEM_SECRET', provider: 'security', required: false, secret: true, description: 'IVX AI system owner key authorizing agent fleet control. Owner-saved value takes priority over the environment.' },
] as const;

type OwnerVariableMetadata = typeof OWNER_VARIABLES[number];
export type OwnerVariableName = OwnerVariableMetadata['name'];
type OwnerVariableProvider = OwnerVariableMetadata['provider'];
type OwnerVariableStatus = 'missing' | 'saved' | 'tested' | 'invalid';
type TestResult = 'tested' | 'invalid' | 'missing';
type OwnerVariableRuntimeSource = 'process_env' | 'owner_variables_store' | 'unavailable';

type PgPool = import('pg').Pool;
type PgPoolClient = import('pg').PoolClient;

type OwnerVariableRow = {
  name: string;
  provider: string;
  encrypted_value: string;
  value_iv: string;
  value_tag: string;
  value_hash: string;
  masked_preview: string;
  status: OwnerVariableStatus;
  last_tested_at: string | null;
  last_test_result: string | null;
  saved_by_user_id: string | null;
  saved_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderReadiness = {
  provider: OwnerVariableProvider;
  status: 'missing' | 'saved' | 'tested' | 'invalid';
  requiredVariableNames: OwnerVariableName[];
  savedVariableNames: OwnerVariableName[];
  missingVariableNames: OwnerVariableName[];
  lastTestedAt: string | null;
  secretValuesReturned: false;
  httpStatus?: number | null;
  error?: string;
};

type StoredSecretMap = Partial<Record<OwnerVariableName, string>>;
export type IVXOwnerVariableRuntimeSource = 'process_env' | 'owner_variables_store' | 'unavailable';
export type IVXOwnerVariableRuntimeReadiness = {
  name: OwnerVariableName;
  present: boolean;
  length: number;
  source: IVXOwnerVariableRuntimeSource;
  processEnvPresent: boolean;
  ownerVariablesStorePresent: boolean;
  error: string | null;
  secretValuesReturned: false;
};

const variableMetadataByName = new Map<OwnerVariableName, OwnerVariableMetadata>(OWNER_VARIABLES.map((item) => [item.name, item]));
const memoryStore = new Map<string, OwnerVariableRow>();
const memoryAuditRows: Record<string, unknown>[] = [];
let cachedPool: PgPool | null = null;
let schemaReadyPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readEnv(name: string): string {
  return readTrimmed(process.env[name]);
}

function isProductionRuntime(): boolean {
  return readEnv('NODE_ENV').toLowerCase() === 'production';
}

function useMemoryStore(): boolean {
  const flag = readEnv('IVX_OWNER_VARIABLES_MEMORY_STORE').toLowerCase();
  return !isProductionRuntime() && (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on');
}

function decodeJwtRole(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function getSupabaseProjectRef(): string {
  const url = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('IVX_SUPABASE_URL') || readEnv('SUPABASE_URL');
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? 'kvclcdjmjghndxsngfzb';
}

function getSupabaseServiceRoleKey(): string {
  // Try explicit service-role key sources first.
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (serviceKey) return serviceKey;
  // Fallback: use the anon key if that's all we have. PostgREST will enforce
  // RLS, but this at least lets us read from tables with public SELECT.
  // This is better than returning '' and blocking the entire encrypted store.
  return readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY');
}

function getSupabaseRestBaseUrl(): string {
  const supabaseUrl = (readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL') || readEnv('IVX_SUPABASE_URL')).replace(/\/+$/, '');
  return supabaseUrl ? `${supabaseUrl}/rest/v1` : '';
}

function canUseSupabaseRestStore(): boolean {
  return Boolean(getSupabaseRestBaseUrl() && getSupabaseServiceRoleKey());
}

function useSupabaseRestStore(): boolean {
  const flag = readEnv('IVX_OWNER_VARIABLES_STORAGE').toLowerCase();
  if (flag === 'postgres' || flag === 'pg') return false;
  if (flag === 'rest' || flag === 'supabase_rest') return canUseSupabaseRestStore();
  return isProductionRuntime() && canUseSupabaseRestStore();
}

function getDatabaseUrl(): string {
  return readEnv('IVX_OWNER_VARIABLES_DATABASE_URL')
    || readEnv('SUPABASE_DB_URL')
    || readEnv('DATABASE_URL')
    || readEnv('POSTGRES_URL');
}

function isAllowedVariableName(value: string): value is OwnerVariableName {
  return variableMetadataByName.has(value as OwnerVariableName);
}

function sanitizeExternalErrorDetail(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_\-.=:/+]{24,}/g, '[redacted]')
    .slice(0, 220);
}

function normalizeVariableValue(name: OwnerVariableName, rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`${name} cannot be blank.`);
  }
  if (value.length > MAX_VARIABLE_VALUE_LENGTH) {
    throw new Error(`${name} exceeds the maximum allowed length.`);
  }
  return value;
}

function createAuditId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getEncryptionSecret(): string {
  return readEnv('IVX_OWNER_VARIABLES_ENCRYPTION_KEY')
    || readEnv('APP_SECRET')
    || readEnv('JWT_SECRET')
    || deriveFallbackEncryptionKey();
}

/**
 * Derive a deterministic encryption key from available runtime secrets when
 * no explicit encryption key (IVX_OWNER_VARIABLES_ENCRYPTION_KEY, APP_SECRET,
 * JWT_SECRET) is configured. This prevents the encrypted store from being
 * completely non-functional on Render where those vars may not be set.
 * Uses the Supabase service role key + project URL as inputs.
 */
function deriveFallbackEncryptionKey(): string {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL') || readEnv('IVX_SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY') || readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey) return '';
  return createHash('sha256').update(`${supabaseUrl}:${serviceKey}`, 'utf8').digest('hex');
}

/** All possible encryption key sources, in priority order. */
function getEncryptionKeyCandidates(): Buffer[] {
  const candidates: Buffer[] = [];
  const seen = new Set<string>();
  // Try explicit encryption key sources first, then the derived fallback.
  for (const source of [
    readEnv('IVX_OWNER_VARIABLES_ENCRYPTION_KEY'),
    readEnv('APP_SECRET'),
    readEnv('JWT_SECRET'),
    deriveFallbackEncryptionKey(),
  ]) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    candidates.push(createHash('sha256').update(source, 'utf8').digest());
  }
  return candidates;
}

function getEncryptionKey(): Buffer {
  const candidates = getEncryptionKeyCandidates();
  if (candidates.length === 0) {
    throw new Error('Owner Variables encryption key is missing. Set IVX_OWNER_VARIABLES_ENCRYPTION_KEY, APP_SECRET, or JWT_SECRET on the backend.');
  }
  return candidates[0] ?? candidates[0]!;
}

/**
 * Decrypt a row by trying every available encryption key candidate.
 * This handles the case where the active key was rotated after a value
 * was encrypted (GCM auth-tag mismatch). Returns the plaintext and the
 * key index that succeeded (for re-encryption). Returns null if all keys fail.
 */
function tryDecryptRowValue(row: OwnerVariableRow): { plaintext: string; keyIndex: number } | null {
  const candidates = getEncryptionKeyCandidates();
  if (candidates.length === 0) return tryPlaintextFallback(row);
  const iv = Buffer.from(row.value_iv || '', 'base64');
  const tag = Buffer.from(row.value_tag || '', 'base64');
  const ciphertext = Buffer.from(row.encrypted_value || '', 'base64');
  for (let i = 0; i < candidates.length; i++) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', candidates[i]!, iv);
      decipher.setAAD(ENCRYPTION_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return { plaintext, keyIndex: i };
    } catch {
      // Auth tag mismatch — try next key candidate
      continue;
    }
  }
  // All AES key candidates failed.
  // Only fall back to plaintext if IV/tag are missing (stored as raw plaintext).
  // If IV/tag exist, the value was properly encrypted with a key we no longer have —
  // base64-decoding ciphertext would produce garbage, not the original secret.
  return tryPlaintextFallback(row);
}

/**
 * Fallback for rows stored as plaintext (missing IV/tag) by storeAwsCredentialsInDb.
 * Returns the raw encrypted_value as-is ONLY when IV/tag are absent.
 */
function tryPlaintextFallback(row: OwnerVariableRow): { plaintext: string; keyIndex: number } | null {
  const raw = (row.encrypted_value || '').trim();
  if (!raw) return null;
  const hasIv = !!(row.value_iv && row.value_iv.trim());
  const hasTag = !!(row.value_tag && row.value_tag.trim());
  if (!hasIv || !hasTag) {
    // Stored as plaintext (no IV/tag) — return directly.
    return { plaintext: raw, keyIndex: -1 };
  }
  // IV/tag exist but all AES keys failed — the value was encrypted with a
  // key we no longer have. We CANNOT recover it. Return null.
  return null;
}

function encryptValue(value: string): { encryptedValue: string; iv: string; tag: string; hash: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  cipher.setAAD(ENCRYPTION_AAD);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    hash: createHash('sha256').update(value, 'utf8').digest('hex'),
  };
}

function decryptRowValue(row: OwnerVariableRow): string {
  const result = tryDecryptRowValue(row);
  if (!result) {
    throw new Error('Unsupported state or unable to authenticate data');
  }
  return result.plaintext;
}

function maskValue(name: OwnerVariableName, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '****';
  const last = trimmed.slice(-4);
  if (name === 'GITHUB_TOKEN' && trimmed.startsWith('gh')) return `${trimmed.slice(0, 4)}****${last}`;
  if (name === 'GITHUB_REPO_URL') {
    const match = trimmed.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i);
    return match ? `github.com/${match[1]}/****` : `url****${last}`;
  }
  if (name === 'RENDER_SERVICE_ID' || name === 'CLOUDFRONT_DISTRIBUTION_ID') return `${trimmed.slice(0, 4)}****${last}`;
  if (name === 'AWS_REGION') return trimmed;
  if (name === 'S3_BUCKET_NAME') return `${trimmed.slice(0, 3)}****${last}`;
  return `${trimmed.slice(0, Math.min(4, trimmed.length))}****${last}`;
}

function supabaseRestHeaders(prefer?: string): HeadersInit {
  const key = getSupabaseServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function parseSupabaseRestResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: sanitizeExternalErrorDetail(text) };
  }
}

async function supabaseRestRequest<T>(path: string, init: RequestInit = {}, prefer?: string): Promise<T> {
  const baseUrl = getSupabaseRestBaseUrl();
  if (!baseUrl || !getSupabaseServiceRoleKey()) {
    throw new Error('Owner Variables Supabase REST storage is not configured. Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...supabaseRestHeaders(prefer),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(OWNER_VARIABLES_REST_TIMEOUT_MS),
  });
  const payload = await parseSupabaseRestResponse(response);
  if (!response.ok) {
    const record = readRecord(payload);
    const message = readTrimmed(record.message) || readTrimmed(record.error) || `Supabase REST returned HTTP ${response.status}.`;
    throw new Error(sanitizeExternalErrorDetail(message));
  }
  return payload as T;
}

async function executeSupabaseSql(sql: string): Promise<void> {
  await supabaseRestRequest('/rpc/ivx_exec_sql', {
    method: 'POST',
    body: JSON.stringify({ sql_text: sql }),
  });
}

async function ensureSchemaViaSupabaseRest(): Promise<void> {
  const statements = [
    `create table if not exists public.ivx_owner_variables (
      name text primary key,
      provider text not null,
      encrypted_value text not null,
      value_iv text not null,
      value_tag text not null,
      value_hash text not null,
      masked_preview text not null,
      status text not null default 'saved',
      last_tested_at timestamptz,
      last_test_result text,
      saved_by_user_id text,
      saved_by_email text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create table if not exists public.ivx_owner_variable_audit (
      id text primary key,
      actor_user_id text,
      actor_email text,
      variable_name text,
      provider text,
      action text not null,
      result text not null,
      details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )`,
    'create index if not exists ivx_owner_variable_audit_created_at_idx on public.ivx_owner_variable_audit (created_at desc)',
    'create index if not exists ivx_owner_variable_audit_name_idx on public.ivx_owner_variable_audit (variable_name)',
    "select pg_notify('pgrst','reload schema')",
  ];
  for (const statement of statements) {
    await executeSupabaseSql(statement);
  }
}

async function getPool(): Promise<PgPool> {
  if (cachedPool) {
    return cachedPool;
  }
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('Owner Variables database URL is missing. Set IVX_OWNER_VARIABLES_DATABASE_URL, SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL.');
  }
  const pgModule = await import('pg');
  cachedPool = new pgModule.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: 'ivx_owner_variables',
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  return cachedPool;
}

async function withClient<T>(callback: (client: PgPoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function ensureSchema(): Promise<void> {
  if (useMemoryStore()) {
    return;
  }
  if (!schemaReadyPromise) {
    if (useSupabaseRestStore()) {
      schemaReadyPromise = ensureSchemaViaSupabaseRest();
    } else {
      schemaReadyPromise = withClient(async (client) => {
      await client.query(`
        create table if not exists public.ivx_owner_variables (
          name text primary key,
          provider text not null,
          encrypted_value text not null,
          value_iv text not null,
          value_tag text not null,
          value_hash text not null,
          masked_preview text not null,
          status text not null default 'saved',
          last_tested_at timestamptz,
          last_test_result text,
          saved_by_user_id text,
          saved_by_email text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query(`
        create table if not exists public.ivx_owner_variable_audit (
          id text primary key,
          actor_user_id text,
          actor_email text,
          variable_name text,
          provider text,
          action text not null,
          result text not null,
          details jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )
      `);
        await client.query('create index if not exists ivx_owner_variable_audit_created_at_idx on public.ivx_owner_variable_audit (created_at desc)');
        await client.query('create index if not exists ivx_owner_variable_audit_name_idx on public.ivx_owner_variable_audit (variable_name)');
      });
    }
  }
  await schemaReadyPromise;
}

async function listStoredRowsViaSupabaseRest(): Promise<OwnerVariableRow[]> {
  return await supabaseRestRequest<OwnerVariableRow[]>(`/${OWNER_VARIABLES_TABLE}?select=*&order=provider.asc,name.asc`, { method: 'GET' });
}

async function getStoredRowViaSupabaseRest(name: OwnerVariableName): Promise<OwnerVariableRow | null> {
  const rows = await supabaseRestRequest<OwnerVariableRow[]>(`/${OWNER_VARIABLES_TABLE}?select=*&name=eq.${encodeURIComponent(name)}&limit=1`, { method: 'GET' });
  return rows[0] ?? null;
}

async function saveStoredVariableViaSupabaseRest(row: OwnerVariableRow): Promise<OwnerVariableRow> {
  const rows = await supabaseRestRequest<OwnerVariableRow[]>(`/${OWNER_VARIABLES_TABLE}?on_conflict=name`, {
    method: 'POST',
    body: JSON.stringify([row]),
  }, 'resolution=merge-duplicates,return=representation');
  return rows[0] ?? row;
}

async function deleteStoredVariableViaSupabaseRest(name: OwnerVariableName): Promise<boolean> {
  const rows = await supabaseRestRequest<Array<{ name: string }>>(`/${OWNER_VARIABLES_TABLE}?name=eq.${encodeURIComponent(name)}&select=name`, {
    method: 'DELETE',
  }, 'return=representation');
  return rows.length > 0;
}

async function updateVariableTestStatusViaSupabaseRest(name: OwnerVariableName, status: OwnerVariableStatus, message: string): Promise<void> {
  await supabaseRestRequest(`/${OWNER_VARIABLES_TABLE}?name=eq.${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      last_tested_at: nowIso(),
      last_test_result: sanitizeExternalErrorDetail(message),
      updated_at: nowIso(),
    }),
  }, 'return=minimal');
}

async function auditOwnerVariableActionViaSupabaseRest(row: Record<string, unknown>): Promise<void> {
  await supabaseRestRequest(`/${OWNER_VARIABLES_AUDIT_TABLE}`, {
    method: 'POST',
    body: JSON.stringify([{
      id: row.id,
      actor_user_id: row.actorUserId,
      actor_email: row.actorEmail,
      variable_name: row.variableName,
      provider: row.provider,
      action: row.action,
      result: row.result,
      details: row.details,
      created_at: row.createdAt,
    }]),
  }, 'return=minimal');
}

async function listStoredRows(): Promise<OwnerVariableRow[]> {
  await ensureSchema();
  if (useMemoryStore()) {
    return Array.from(memoryStore.values());
  }
  if (useSupabaseRestStore()) {
    return await listStoredRowsViaSupabaseRest();
  }
  return await withClient(async (client) => {
    const result = await client.query<OwnerVariableRow>('select * from public.ivx_owner_variables order by provider, name');
    return result.rows;
  });
}

async function getStoredRow(name: OwnerVariableName): Promise<OwnerVariableRow | null> {
  await ensureSchema();
  if (useMemoryStore()) {
    return memoryStore.get(name) ?? null;
  }
  if (useSupabaseRestStore()) {
    return await getStoredRowViaSupabaseRest(name);
  }
  return await withClient(async (client) => {
    const result = await client.query<OwnerVariableRow>('select * from public.ivx_owner_variables where name = $1 limit 1', [name]);
    return result.rows[0] ?? null;
  });
}

async function saveStoredVariable(ownerContext: IVXOwnerRequestContext, name: OwnerVariableName, value: string): Promise<OwnerVariableRow> {
  const metadata = variableMetadataByName.get(name);
  if (!metadata) {
    throw new Error(`Unsupported variable name: ${name}.`);
  }
  await ensureSchema();
  const encrypted = encryptValue(value);
  const timestamp = nowIso();
  const row: OwnerVariableRow = {
    name,
    provider: metadata.provider,
    encrypted_value: encrypted.encryptedValue,
    value_iv: encrypted.iv,
    value_tag: encrypted.tag,
    value_hash: encrypted.hash,
    masked_preview: maskValue(name, value),
    status: 'saved',
    last_tested_at: null,
    last_test_result: null,
    saved_by_user_id: ownerContext.userId,
    saved_by_email: ownerContext.email,
    created_at: timestamp,
    updated_at: timestamp,
  };

  if (useMemoryStore()) {
    memoryStore.set(name, row);
    return row;
  }
  if (useSupabaseRestStore()) {
    return await saveStoredVariableViaSupabaseRest(row);
  }

  return await withClient(async (client) => {
    const result = await client.query<OwnerVariableRow>(`
      insert into public.ivx_owner_variables
        (name, provider, encrypted_value, value_iv, value_tag, value_hash, masked_preview, status, last_tested_at, last_test_result, saved_by_user_id, saved_by_email, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,'saved',null,null,$8,$9,now(),now())
      on conflict (name) do update set
        provider = excluded.provider,
        encrypted_value = excluded.encrypted_value,
        value_iv = excluded.value_iv,
        value_tag = excluded.value_tag,
        value_hash = excluded.value_hash,
        masked_preview = excluded.masked_preview,
        status = 'saved',
        last_tested_at = null,
        last_test_result = null,
        saved_by_user_id = excluded.saved_by_user_id,
        saved_by_email = excluded.saved_by_email,
        updated_at = now()
      returning *
    `, [name, metadata.provider, encrypted.encryptedValue, encrypted.iv, encrypted.tag, encrypted.hash, row.masked_preview, ownerContext.userId, ownerContext.email]);
    return result.rows[0] ?? row;
  });
}

async function deleteStoredVariable(name: OwnerVariableName): Promise<boolean> {
  await ensureSchema();
  if (useMemoryStore()) {
    return memoryStore.delete(name);
  }
  if (useSupabaseRestStore()) {
    return await deleteStoredVariableViaSupabaseRest(name);
  }
  return await withClient(async (client) => {
    const result = await client.query<{ name: string }>('delete from public.ivx_owner_variables where name = $1 returning name', [name]);
    return result.rows.length > 0;
  });
}

async function updateVariableTestStatus(name: OwnerVariableName, result: TestResult, message: string): Promise<void> {
  await ensureSchema();
  const status: OwnerVariableStatus = result === 'tested' ? 'tested' : result === 'invalid' ? 'invalid' : 'missing';
  const timestamp = nowIso();
  if (useMemoryStore()) {
    const row = memoryStore.get(name);
    if (row) {
      memoryStore.set(name, { ...row, status, last_tested_at: timestamp, last_test_result: sanitizeExternalErrorDetail(message), updated_at: timestamp });
    }
    return;
  }
  if (useSupabaseRestStore()) {
    await updateVariableTestStatusViaSupabaseRest(name, status, message);
    return;
  }
  await withClient(async (client) => {
    await client.query(
      'update public.ivx_owner_variables set status = $2, last_tested_at = now(), last_test_result = $3, updated_at = now() where name = $1',
      [name, status, sanitizeExternalErrorDetail(message)],
    );
  });
}

async function auditOwnerVariableAction(input: {
  ownerContext: IVXOwnerRequestContext;
  variableName: string | null;
  provider: string | null;
  action: 'save' | 'delete' | 'test';
  result: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const row = {
    id: createAuditId(),
    actorUserId: input.ownerContext.userId,
    actorEmail: input.ownerContext.email,
    variableName: input.variableName,
    provider: input.provider,
    action: input.action,
    result: input.result,
    details: { ...(input.details ?? {}), secretValuesReturned: false },
    createdAt: nowIso(),
  };
  if (useMemoryStore()) {
    memoryAuditRows.push(row);
    return;
  }
  try {
    await ensureSchema();
    if (useSupabaseRestStore()) {
      await auditOwnerVariableActionViaSupabaseRest(row);
      return;
    }
    await withClient(async (client) => {
      await client.query(
        'insert into public.ivx_owner_variable_audit (id, actor_user_id, actor_email, variable_name, provider, action, result, details, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())',
        [row.id, row.actorUserId, row.actorEmail, row.variableName, row.provider, row.action, row.result, JSON.stringify(row.details)],
      );
    });
  } catch (error) {
    console.log('[IVXOwnerVariables] Audit write skipped:', error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'unknown');
  }
}

function resolveEnvPresence(name: OwnerVariableName): { present: boolean; source: 'process_env' | 'owner_variables_store' | 'unavailable'; maskedPreview: string | null } {
  const envValue = readEnv(name);
  if (envValue) {
    return { present: true, source: 'process_env', maskedPreview: maskValue(name, envValue) };
  }
  return { present: false, source: 'unavailable', maskedPreview: null };
}

function buildVariableStatuses(rows: OwnerVariableRow[]) {
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  return OWNER_VARIABLES.map((metadata) => {
    const row = rowByName.get(metadata.name);
    const envPresence = resolveEnvPresence(metadata.name);
    const isSaved = Boolean(row);
    const isPresent = isSaved || envPresence.present;
    // Status precedence: explicit tested/invalid from store > saved (store or env) > missing.
    // If the variable is in process.env but not in the encrypted store, report 'saved'
    // (runtime-readable) with source=process_env so the UI stops saying MISSING.
    const status: OwnerVariableStatus = row?.status ?? (envPresence.present ? 'saved' : 'missing');
    return {
      name: metadata.name,
      provider: metadata.provider,
      required: metadata.required,
      secret: metadata.secret,
      status,
      saved: isPresent,
      presentInRuntime: envPresence.present,
      runtimeSource: envPresence.source,
      lastTestedAt: row?.last_tested_at ?? null,
      maskedPreview: row?.masked_preview ?? envPresence.maskedPreview ?? null,
      description: metadata.description,
      secretValuesReturned: false as const,
    };
  });
}

function buildProviderReadiness(rows: OwnerVariableRow[]): Record<OwnerVariableProvider, ProviderReadiness> {
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  const providers = Array.from(new Set(OWNER_VARIABLES.map((item) => item.provider))) as OwnerVariableProvider[];
  return Object.fromEntries(providers.map((provider) => {
    const required = OWNER_VARIABLES.filter((item) => item.provider === provider && item.required).map((item) => item.name);
    // A required variable is satisfied if it's in the encrypted store OR in the backend runtime env.
    const saved = required.filter((name) => rowByName.has(name) || readEnv(name));
    const missing = required.filter((name) => !rowByName.has(name) && !readEnv(name));
    const providerRows = OWNER_VARIABLES.filter((item) => item.provider === provider).map((item) => rowByName.get(item.name)).filter((row): row is OwnerVariableRow => Boolean(row));
    const hasInvalid = providerRows.some((row) => row.status === 'invalid');
    const hasTested = required.length > 0 && required.every((name) => rowByName.get(name)?.status === 'tested');
    const lastTestedAt = providerRows
      .map((row) => row.last_tested_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    const status: ProviderReadiness['status'] = missing.length > 0 ? 'missing' : hasInvalid ? 'invalid' : hasTested ? 'tested' : 'saved';
    return [provider, {
      provider,
      status,
      requiredVariableNames: required,
      savedVariableNames: saved,
      missingVariableNames: missing,
      lastTestedAt,
      secretValuesReturned: false as const,
    }];
  })) as Record<OwnerVariableProvider, ProviderReadiness>;
}

async function buildStoredSecretMap(): Promise<StoredSecretMap> {
  const rows = await listStoredRows();
  const output: StoredSecretMap = {};
  for (const row of rows) {
    const name = row.name;
    if (!isAllowedVariableName(name)) {
      continue;
    }
    const decrypted = tryDecryptRowValue(row);
    if (!decrypted) {
      // Stale key / rotated: skip this row so one undecryptable value
      // cannot abort the entire provider test. The runtime bridge will
      // log it; the variable reports as unreadable rather than crashing.
      console.log('[IVXOwnerVariables] buildStoredSecretMap: skipping undecryptable row', { name, maskedPreview: row.masked_preview });
      continue;
    }
    output[name] = decrypted.plaintext;
  }
  return output;
}

/**
 * Reads one encrypted Owner Variable for backend runtime use without exposing it to API responses.
 */
export async function getIVXOwnerVariableRuntimeValue(
  name: OwnerVariableName,
  options: { preferStored?: boolean } = {},
): Promise<string> {
  const envValue = readEnv(name);
  if (envValue && !options.preferStored) return envValue;
  try {
    const row = await getStoredRow(name);
    if (!row) return envValue;
    const decrypted = tryDecryptRowValue(row);
    if (!decrypted) {
      // FAIL CLOSED: return empty (never a guessed value) and mark the row
      // invalid so the owner UI stops reporting the stale encrypted record as
      // 'saved'. The real credential must be re-saved by the owner or provided
      // via the backend env, which is always authoritative.
      console.log('[IVXOwnerVariables] Runtime value bridge: decryption failed for all key candidates', {
        name,
        maskedPreview: row.masked_preview,
      });
      try {
        await updateVariableTestStatusViaSupabaseRest(name, 'invalid', 'Stored value cannot be decrypted with any configured key candidate — stale encrypted record; re-save the variable or set the backend env var.');
      } catch {
        // Status flagging is best-effort; the fail-closed empty return above stands.
      }
      return '';
    }
    // Auto-reencrypt with the primary key if a fallback key was used (key rotation)
    if (decrypted.keyIndex > 0) {
      const plaintext = decrypted.plaintext.trim();
      try {
        await reencryptStoredRow(name, plaintext);
        console.log('[IVXOwnerVariables] Runtime value bridge: re-encrypted stale-key row with primary key', {
          name,
          keyIndex: decrypted.keyIndex,
        });
      } catch (reencryptError) {
        console.log('[IVXOwnerVariables] Runtime value bridge: re-encryption failed (returning decrypted value anyway)', {
          name,
          message: reencryptError instanceof Error ? sanitizeExternalErrorDetail(reencryptError.message) : 'unknown',
        });
      }
      return plaintext;
    }
    return decrypted.plaintext.trim();
  } catch (error) {
    console.log('[IVXOwnerVariables] Runtime REST value bridge unavailable; trying direct Postgres fallback:', {
      name,
      message: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'unknown',
    });
    if (getDatabaseUrl()) {
      try {
        const row = await withClient(async (client) => {
          const result = await client.query<OwnerVariableRow>(
            'select * from public.ivx_owner_variables where name = $1 limit 1',
            [name],
          );
          return result.rows[0] ?? null;
        });
        if (row) {
          const decrypted = tryDecryptRowValue(row);
          if (decrypted?.plaintext.trim()) {
            return decrypted.plaintext.trim();
          }
        }
      } catch (fallbackError) {
        console.log('[IVXOwnerVariables] Direct Postgres runtime fallback unavailable:', {
          name,
          message: fallbackError instanceof Error ? sanitizeExternalErrorDetail(fallbackError.message) : 'unknown',
        });
      }
    }
    return envValue;
  }
}

/**
 * Re-encrypt a stored row's plaintext value with the current primary encryption key.
 * Used when a fallback key candidate succeeded (key rotation recovery).
 */
async function reencryptStoredRow(name: OwnerVariableName, plaintext: string): Promise<void> {
 const metadata = variableMetadataByName.get(name);
 if (!metadata) return;
 const encrypted = encryptValue(plaintext);
 const timestamp = nowIso();
 const row: OwnerVariableRow = {
   name,
   provider: metadata.provider,
   encrypted_value: encrypted.encryptedValue,
   value_iv: encrypted.iv,
   value_tag: encrypted.tag,
   value_hash: encrypted.hash,
   masked_preview: maskValue(name, plaintext),
   status: 'saved',
   last_tested_at: null,
   last_test_result: null,
   saved_by_user_id: null,
   saved_by_email: null,
   created_at: timestamp,
   updated_at: timestamp,
 };
 if (useMemoryStore()) {
   memoryStore.set(name, row);
   return;
 }
 if (useSupabaseRestStore()) {
   await saveStoredVariableViaSupabaseRest(row);
   return;
 }
 await withClient(async (client) => {
   await client.query(
     'update public.ivx_owner_variables set encrypted_value=$2, value_iv=$3, value_tag=$4, value_hash=$5, masked_preview=$6, updated_at=now() where name=$1',
     [name, row.encrypted_value, row.value_iv, row.value_tag, row.value_hash, row.masked_preview],
   );
 });
}

/**
 * Raw variable lookup — accepts ANY variable name stored in the ivx_owner_variables table,
 * not just the typed OwnerVariableName values. Used by the landing deploy endpoint to find
 * AWS credentials that may be stored under non-standard names (e.g. 'AWS_ACCESS_KEY_ID'
 * instead of 'IVX_AWS_READONLY_ACCESS_KEY_ID').
 */
export async function getRawOwnerVariableValue(name: string): Promise<string> {
  const envValue = readEnv(name);
  if (envValue) return envValue;
  try {
    const row = await getStoredRow(name as OwnerVariableName);
    if (!row) return '';
    const decrypted = tryDecryptRowValue(row);
    if (!decrypted) {
      console.log('[IVXOwnerVariables] Raw lookup: decryption failed', { name, maskedPreview: row.masked_preview });
      return '';
    }
    return decrypted.plaintext.trim();
  } catch (error) {
    console.log('[IVXOwnerVariables] Raw lookup error:', { name, message: error instanceof Error ? error.message : 'unknown' });
    return '';
  }
}

/**
 * Checks encrypted Owner Variable presence for diagnostics without returning secret values.
 */
export async function hasIVXOwnerVariableRuntimeValue(name: OwnerVariableName): Promise<boolean> {
  return Boolean(await getIVXOwnerVariableRuntimeValue(name));
}

/**
 * Reports backend runtime access to a variable without returning the value.
 */
export async function inspectIVXOwnerVariableRuntimeReadiness(name: OwnerVariableName): Promise<IVXOwnerVariableRuntimeReadiness> {
  const envValue = readEnv(name);
  let ownerVariablesStorePresent = false;
  let storedLength = 0;
  let error: string | null = null;

  try {
    const row = await getStoredRow(name);
    ownerVariablesStorePresent = Boolean(row);
    if (row) {
      // Use tryDecryptRowValue (with plaintext fallback) instead of decryptRowValue (throws)
      const decrypted = tryDecryptRowValue(row);
      storedLength = decrypted ? decrypted.plaintext.trim().length : 0;
    }
  } catch (readError) {
    error = readError instanceof Error ? sanitizeExternalErrorDetail(readError.message) : 'Owner Variables runtime readiness check failed.';
  }

  if (envValue) {
    return {
      name,
      present: true,
      length: envValue.length,
      source: 'process_env',
      processEnvPresent: true,
      ownerVariablesStorePresent,
      error,
      secretValuesReturned: false,
    };
  }

  if (ownerVariablesStorePresent && storedLength > 0) {
    return {
      name,
      present: true,
      length: storedLength,
      source: 'owner_variables_store',
      processEnvPresent: false,
      ownerVariablesStorePresent: true,
      error,
      secretValuesReturned: false,
    };
  }

  return {
    name,
    present: false,
    length: 0,
    source: 'unavailable',
    processEnvPresent: false,
    ownerVariablesStorePresent,
    error,
    secretValuesReturned: false,
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function parseGithubRepo(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/github\.com[/:]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function testGithubProvider(values: StoredSecretMap): Promise<ProviderReadiness> {
  const token = values.GITHUB_TOKEN;
  const repoUrl = values.GITHUB_REPO_URL;
  const required: OwnerVariableName[] = ['GITHUB_TOKEN', 'GITHUB_REPO_URL'];
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) {
    return { provider: 'github', status: 'missing', requiredVariableNames: required, savedVariableNames: required.filter((name) => Boolean(values[name])), missingVariableNames: missing, lastTestedAt: null, secretValuesReturned: false };
  }
  const repo = parseGithubRepo(repoUrl ?? '');
  if (!repo) {
    return { provider: 'github', status: 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, error: 'GITHUB_REPO_URL is not a valid GitHub repository URL.' };
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: createTimeoutSignal(10_000),
    });
    return { provider: 'github', status: response.ok ? 'tested' : 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, httpStatus: response.status, error: response.ok ? undefined : `GitHub repo access returned HTTP ${response.status}.` };
  } catch (error) {
    return { provider: 'github', status: 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, httpStatus: null, error: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'GitHub provider test failed.' };
  }
}

async function testRenderProvider(values: StoredSecretMap): Promise<ProviderReadiness> {
  const apiKey = values.RENDER_API_KEY || values.IVX_RENDER_API_KEY;
  const serviceId = values.RENDER_SERVICE_ID;
  const required: OwnerVariableName[] = ['RENDER_API_KEY', 'RENDER_SERVICE_ID'];
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) {
    return { provider: 'render', status: 'missing', requiredVariableNames: required, savedVariableNames: required.filter((name) => Boolean(values[name])), missingVariableNames: missing, lastTestedAt: null, secretValuesReturned: false };
  }
  try {
    const response = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId ?? '')}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: createTimeoutSignal(10_000),
    });
    return { provider: 'render', status: response.ok ? 'tested' : 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, httpStatus: response.status, error: response.ok ? undefined : `Render service access returned HTTP ${response.status}.` };
  } catch (error) {
    return { provider: 'render', status: 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, httpStatus: null, error: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'Render provider test failed.' };
  }
}

async function testSupabaseProvider(values: StoredSecretMap): Promise<ProviderReadiness> {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = values.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;
  const managementToken = values.SUPABASE_ACCESS_TOKEN;
  const required: OwnerVariableName[] = ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !values[name]);
  if (!supabaseUrl) {
    return { provider: 'supabase', status: 'missing', requiredVariableNames: required, savedVariableNames: required.filter((name) => Boolean(values[name])), missingVariableNames: missing, lastTestedAt: null, secretValuesReturned: false, error: 'EXPO_PUBLIC_SUPABASE_URL must be configured on the backend runtime for Supabase tests.' };
  }
  if (missing.length > 0) {
    return { provider: 'supabase', status: 'missing', requiredVariableNames: required, savedVariableNames: required.filter((name) => Boolean(values[name])), missingVariableNames: missing, lastTestedAt: null, secretValuesReturned: false };
  }
  try {
    const [anonResponse, serviceResponse, managementResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/`, { headers: { apikey: anonKey ?? '', Authorization: `Bearer ${anonKey}` }, signal: createTimeoutSignal(10_000) }),
      fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, { headers: { apikey: serviceRoleKey ?? '', Authorization: `Bearer ${serviceRoleKey}` }, signal: createTimeoutSignal(10_000) }),
      managementToken
        ? fetch(`https://api.supabase.com/v1/projects/${getSupabaseProjectRef()}`, { headers: { Authorization: `Bearer ${managementToken}` }, signal: createTimeoutSignal(10_000) })
        : Promise.resolve(null),
    ]);
    const managementOk = !managementResponse || managementResponse.ok;
    const ok = anonResponse.status < 500 && serviceResponse.ok && managementOk;
    const savedNames = managementToken ? [...required, 'SUPABASE_ACCESS_TOKEN' as OwnerVariableName] : required;
    return {
      provider: 'supabase',
      status: ok ? 'tested' : 'invalid',
      requiredVariableNames: required,
      savedVariableNames: savedNames,
      missingVariableNames: [],
      lastTestedAt: nowIso(),
      secretValuesReturned: false,
      httpStatus: managementResponse ? managementResponse.status : serviceResponse.status,
      error: ok ? undefined : `Supabase verification returned anon=${anonResponse.status}, service=${serviceResponse.status}, management=${managementResponse ? managementResponse.status : 'not_saved'}.`,
    };
  } catch (error) {
    return { provider: 'supabase', status: 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, httpStatus: null, error: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'Supabase provider test failed.' };
  }
}

/** Run an STS GetCallerIdentity call with an explicit credential pair.
 * Returns null on success, or a short diagnostic string on failure. */
async function probeStsWithCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string | undefined,
  region: string,
): Promise<string | null> {
  try {
    const awsSts = await import('@aws-sdk/client-sts');
    const client = new awsSts.STSClient({
      region,
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
    });
    await client.send(new awsSts.GetCallerIdentityCommand({}));
    return null;
  } catch (error) {
    return error instanceof Error ? sanitizeExternalErrorDetail(error.message).slice(0, 120) : 'unknown';
  }
}

// AWS provider test — dual-source diagnostic (env vs encrypted store)
async function testAwsProvider(values: StoredSecretMap): Promise<ProviderReadiness> {
  // Resolve credentials from process.env FIRST (the live runtime), then fall
  // back to the encrypted owner-variable store. This matches every other AWS
  // code path in the codebase (ivx-ai-brain-tool-executor, ivx-apk-distribution,
  // getIVXOwnerVariableRuntimeValue) and prevents a stale encrypted-store value
  // from causing SignatureDoesNotMatch when the runtime env has been rotated.
  const accessKeyId =
    readEnv('IVX_AWS_READONLY_ACCESS_KEY_ID') || readEnv('AWS_ACCESS_KEY_ID') || values.IVX_AWS_READONLY_ACCESS_KEY_ID || '';
  const secretAccessKey =
    readEnv('IVX_AWS_READONLY_SECRET_ACCESS_KEY') || readEnv('AWS_SECRET_ACCESS_KEY') || values.IVX_AWS_READONLY_SECRET_ACCESS_KEY || '';
  const sessionToken =
    readEnv('IVX_AWS_READONLY_SESSION_TOKEN') || readEnv('AWS_SESSION_TOKEN') || undefined;
  const region = readEnv('AWS_REGION') || values.AWS_REGION || 'us-east-1';
  // Also capture the STORE-ONLY values (what's in the encrypted Supabase store
  // but NOT in process.env) to test independently. This reveals whether the
  // store holds a different (possibly correct) pair that self-sync overwrote.
  // StoredSecretMap is keyed by OwnerVariableName; access via a loose record.
  const storeValues = values as Record<string, string>;
  const storeAccessKeyId = storeValues.IVX_AWS_READONLY_ACCESS_KEY_ID || storeValues.AWS_ACCESS_KEY_ID || '';
  const storeSecretAccessKey = storeValues.IVX_AWS_READONLY_SECRET_ACCESS_KEY || storeValues.AWS_SECRET_ACCESS_KEY || '';
  const required: OwnerVariableName[] = ['IVX_AWS_READONLY_ACCESS_KEY_ID', 'IVX_AWS_READONLY_SECRET_ACCESS_KEY', 'AWS_REGION'];
  const missing = required.filter((name) => !values[name] && !readEnv(name));
  if (missing.length > 0 || !accessKeyId || !secretAccessKey) {
    const savedNames = required.filter((name) => Boolean(values[name] || readEnv(name)));
    return { provider: 'aws', status: 'missing', requiredVariableNames: required, savedVariableNames: savedNames, missingVariableNames: missing.length > 0 ? missing : required.filter((name) => !savedNames.includes(name)), lastTestedAt: null, secretValuesReturned: false };
  }
  // Diagnostic checks: detect hidden characters, URL-decoding artifacts, and
  // whitespace corruption that cause SignatureDoesNotMatch even with valid creds.
  // AWS secret keys are base64-like [A-Za-z0-9/+=] and should contain NO spaces,
  // newlines, or control characters.
  const accessKeyHasSpaces = /\s/.test(accessKeyId);
  const secretHasSpaces = /\s/.test(secretAccessKey);
  const secretHasNewlines = /[\r\n]/.test(secretAccessKey);
  const accessKeyNonAscii = accessKeyId.split('').some((c) => c.charCodeAt(0) > 127);
  const secretNonAscii = secretAccessKey.split('').some((c) => c.charCodeAt(0) > 127);
  // Check for URL-decoding artifact: + decoded to space (Render env var issue)
  const secretHasSpaceFromPlus = secretAccessKey.includes(' ');
  // AWS access key IDs must match [A-Z0-9]{20}, typically AKIA-prefixed
  const accessKeyFormatValid = /^[A-Z0-9]{20}$/.test(accessKeyId);
  // AWS secret access keys are 40 chars [A-Za-z0-9/+=]
  const secretFormatValid = /^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey);

  const diagnostics: string[] = [];
  if (accessKeyHasSpaces) diagnostics.push('accessKeyId contains whitespace (possible URL-decoding artifact)');
  if (secretHasSpaces) diagnostics.push('secretAccessKey contains spaces (possible +→space URL-decoding by Render)');
  if (secretHasNewlines) diagnostics.push('secretAccessKey contains newlines (trailing line break not trimmed)');
  if (accessKeyNonAscii) diagnostics.push('accessKeyId contains non-ASCII characters');
  if (secretNonAscii) diagnostics.push('secretAccessKey contains non-ASCII characters');
  if (!accessKeyFormatValid) diagnostics.push(`accessKeyId format invalid (expected [A-Z0-9]{20}, got len=${accessKeyId.length})`);
  if (!secretFormatValid) diagnostics.push(`secretAccessKey format invalid (expected [A-Za-z0-9/+=]{40}, got len=${secretAccessKey.length})`);

  try {
    const awsSts = await import('@aws-sdk/client-sts');
    const credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
    const client = new awsSts.STSClient({ region, credentials });
    await client.send(new awsSts.GetCallerIdentityCommand({}));
    return { provider: 'aws', status: 'tested', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false };
  } catch (error) {
    // If the SDK fails, try a raw SigV4 request to rule out SDK issues.
    // This manually signs an STS GetCallerIdentity POST with HMAC-SHA256.
    let rawSigV4Result = '';
    try {
      const crypto = await import('node:crypto');
      const host = 'sts.amazonaws.com';
      const service = 'sts';
      const now = new Date();
      const isoNow = now.toISOString(); // e.g. "2026-07-26T03:25:39.123Z"
      const yyyymmdd = isoNow.slice(0, 10).replace(/-/g, ''); // "20260726"
      const hhmmss = isoNow.slice(11, 19).replace(/:/g, ''); // "032539"
      const amzDate = `${yyyymmdd}T${hhmmss}Z`;
      const dateStamp = yyyymmdd;
      const payload = 'Action=GetCallerIdentity&Version=2011-06-15';
      const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
      const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-date';
      const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;
      const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp, 'utf8').digest();
      const kRegion = crypto.createHmac('sha256', kDate).update(region, 'utf8').digest();
      const kService = crypto.createHmac('sha256', kRegion).update(service, 'utf8').digest();
      const kSigning = crypto.createHmac('sha256', kService).update('aws4_request', 'utf8').digest();
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const rawResponse = await fetch(`https://${host}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'X-Amz-Date': amzDate,
          Authorization: authorization,
          'Content-Length': String(Buffer.byteLength(payload)),
        },
        body: payload,
      });
      const rawText = await rawResponse.text();
      if (rawResponse.ok) {
        rawSigV4Result = `rawSigV4=SUCCESS(httpStatus=${rawResponse.status})`;
      } else {
        const errMatch = rawText.match(/<Message>([^<]+)<\/Message>/);
        rawSigV4Result = `rawSigV4=FAIL(httpStatus=${rawResponse.status}, msg=${errMatch ? errMatch[1] : rawText.slice(0, 200)})`;
      }
    } catch (rawError) {
      rawSigV4Result = `rawSigV4=ERROR(${rawError instanceof Error ? rawError.message.slice(0, 100) : 'unknown'})`;
    }
    const errorMsg = error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'AWS read-only identity test failed.';
    // Always include diagnostic info (even when all checks pass) so the owner
    // can see the credential metadata that explains WHY SigV4 fails.
    const diagSummary = [
      `accessKeyLen=${accessKeyId.length}`,
      `secretLen=${secretAccessKey.length}`,
      `accessKeyFormat=${accessKeyFormatValid ? 'OK' : 'BAD'}`,
      `secretFormat=${secretFormatValid ? 'OK' : 'BAD'}`,
      `hasSpaces=${secretHasSpaceFromPlus ? 'YES' : 'no'}`,
      `hasNewlines=${secretHasNewlines ? 'YES' : 'no'}`,
      `nonAscii=${secretNonAscii ? 'YES' : 'no'}`,
      `sessionToken=${sessionToken ? 'present' : 'none'}`,
      `region=${region}`,
      `source=${readEnv('AWS_ACCESS_KEY_ID') ? 'env:AWS_ACCESS_KEY_ID' : readEnv('IVX_AWS_READONLY_ACCESS_KEY_ID') ? 'env:IVX_AWS_READONLY' : 'store'}`,
      `accessKeyPrefix=${accessKeyId.slice(0, 4)}`,
      `secretPrefix=${secretAccessKey.slice(0, 3)}`,
      `secretSuffix=${secretAccessKey.slice(-2)}`,
      `storeKeyPresent=${Boolean(storeAccessKeyId)}`,
      `storeKeyLen=${storeAccessKeyId.length}`,
      `storeSecretPresent=${Boolean(storeSecretAccessKey)}`,
      `storeSecretLen=${storeSecretAccessKey.length}`,
      `storeKeyDiffersFromEnv=${storeAccessKeyId && storeAccessKeyId !== accessKeyId ? 'YES' : 'no'}`,
      `storeSecretDiffersFromEnv=${storeSecretAccessKey && storeSecretAccessKey !== secretAccessKey ? 'YES' : 'no'}`,
      ...(diagnostics.length > 0 ? diagnostics : ['all-format-checks-passed']),
      rawSigV4Result,
    ].join(', ');
    // If the store holds a DIFFERENT pair, test it independently. This is the
    // last developer-controlled diagnostic: if the store pair succeeds where
    // the env pair fails, the fix is to update Render env from the store.
    let storeProbeResult = '';
    if (storeAccessKeyId && storeSecretAccessKey && (storeAccessKeyId !== accessKeyId || storeSecretAccessKey !== secretAccessKey)) {
      const storeErr = await probeStsWithCredentials(storeAccessKeyId, storeSecretAccessKey, undefined, region);
      storeProbeResult = storeErr ? `storeProbe=FAIL(${storeErr.slice(0, 80)})` : 'storeProbe=SUCCESS';
    } else {
      storeProbeResult = 'storeProbe=SKIPPED(store==env or store empty)';
    }
    // If the encrypted store holds a different, valid pair, prefer it. This lets
    // the owner rotate credentials via the owner-variables store even when Render
    // env vars are stale or a deploy fails to load them.
    if (storeProbeResult === 'storeProbe=SUCCESS') {
      return { provider: 'aws', status: 'tested', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, error: 'AWS identity verified via encrypted owner-variables store (env credentials failed, store credentials succeeded).' };
    }
    const detail = `${errorMsg} | Diag: ${diagSummary}, ${storeProbeResult}`;
    return { provider: 'aws', status: 'invalid', requiredVariableNames: required, savedVariableNames: required, missingVariableNames: [], lastTestedAt: nowIso(), secretValuesReturned: false, error: detail };
  }
}

async function testProvider(provider: OwnerVariableProvider): Promise<ProviderReadiness> {
  const values = await buildStoredSecretMap();
  if (provider === 'github') return await testGithubProvider(values);
  if (provider === 'render') return await testRenderProvider(values);
  if (provider === 'supabase') return await testSupabaseProvider(values);
  if (provider === 'aws') return await testAwsProvider(values);
  const providerVariables = OWNER_VARIABLES.filter((item) => item.provider === provider && item.required).map((item) => item.name);
  const missing = providerVariables.filter((name) => !values[name]);
  return { provider, status: missing.length === 0 ? 'tested' : 'missing', requiredVariableNames: providerVariables, savedVariableNames: providerVariables.filter((name) => Boolean(values[name])), missingVariableNames: missing, lastTestedAt: nowIso(), secretValuesReturned: false };
}

function validateSingleVariableForTest(name: OwnerVariableName, value: string): { result: TestResult; message: string } {
  if (!value.trim()) return { result: 'missing', message: 'No saved value.' };
  if (name === 'GITHUB_REPO_URL' && !parseGithubRepo(value)) return { result: 'invalid', message: 'GitHub repository URL format is invalid.' };
  if (name === 'AWS_REGION' && !/^[a-z]{2}-[a-z]+-\d$/.test(value)) return { result: 'invalid', message: 'AWS region format is invalid.' };
  if (name === 'RENDER_SERVICE_ID' && !/^srv-[a-z0-9]+$/i.test(value)) return { result: 'invalid', message: 'Render service ID format is invalid.' };
  return { result: 'tested', message: 'Saved value format check passed.' };
}

async function buildStatusPayload(ownerContext: IVXOwnerRequestContext, providerOverride?: ProviderReadiness): Promise<Record<string, unknown>> {
  const storageBackend = useMemoryStore() ? 'local_ephemeral_dev_only' : useSupabaseRestStore() ? 'encrypted_supabase_rest' : 'encrypted_postgres';
  const encryptionConfigured = Boolean(getEncryptionSecret());
  try {
    const rows = await listStoredRows();
    const variables = buildVariableStatuses(rows);
    const providers = buildProviderReadiness(rows);
    if (providerOverride) {
      providers[providerOverride.provider] = providerOverride;
    }
    const missingCredentials = variables.filter((item) => item.required && !item.saved).map((item) => item.name);
    return {
      ok: true,
      ownerOnly: true,
      routeRegistered: true,
      tool: 'ivx_owner_variables_credentials_module',
      deploymentMarker: DEPLOYMENT_MARKER,
      authenticatedUserId: ownerContext.userId,
      authenticatedRole: ownerContext.role,
      storage: {
        configured: true,
        backend: storageBackend,
        encryptedAtRest: true,
        encryptionConfigured,
        auditLogEnabled: true,
      },
      variables,
      providers,
      missingCredentials,
      endpoints: {
        status: 'GET /api/ivx/owner-variables/status',
        save: 'POST /api/ivx/owner-variables/save',
        test: 'POST /api/ivx/owner-variables/test',
        delete: 'POST /api/ivx/owner-variables/delete',
      },
      audit: {
        enabled: true,
        rawSecretsStoredInAudit: false,
        memoryAuditCount: useMemoryStore() ? memoryAuditRows.length : undefined,
      },
      secretValuesReturned: false,
      timestamp: nowIso(),
    };
  } catch (error) {
    return {
      ok: false,
      ownerOnly: true,
      routeRegistered: true,
      tool: 'ivx_owner_variables_credentials_module',
      deploymentMarker: DEPLOYMENT_MARKER,
      authenticatedUserId: ownerContext.userId,
      authenticatedRole: ownerContext.role,
      storage: {
        configured: false,
        backend: storageBackend,
        encryptedAtRest: true,
        encryptionConfigured,
        auditLogEnabled: false,
        error: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'Owner Variables storage check failed.',
      },
      variables: buildVariableStatuses([]),
      providers: buildProviderReadiness([]),
      missingCredentials: OWNER_VARIABLES.filter((item) => item.required).map((item) => item.name),
      secretValuesReturned: false,
      timestamp: nowIso(),
    };
  }
}

function readRequestedVariableName(value: unknown): OwnerVariableName {
  const name = readTrimmed(value);
  if (!isAllowedVariableName(name)) {
    throw new Error(`Unsupported variable name: ${name || 'blank'}.`);
  }
  return name;
}

function readRequestedProvider(value: unknown): OwnerVariableProvider {
  const provider = readTrimmed(value) as OwnerVariableProvider;
  const providers = new Set(OWNER_VARIABLES.map((item) => item.provider));
  if (!providers.has(provider)) {
    throw new Error(`Unsupported provider: ${provider || 'blank'}.`);
  }
  return provider;
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXOwnerVariablesStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    return ownerOnlyJson(await buildStatusPayload(ownerContext));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables status failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, routeRegistered: true, secretValuesReturned: false, error: message, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

export async function handleIVXOwnerVariablesSaveRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readRecord(await request.json().catch(() => ({})));
    const name = readRequestedVariableName(body.name);
    const value = normalizeVariableValue(name, body.value);
    const metadata = variableMetadataByName.get(name);
    if (!metadata) throw new Error(`Unsupported variable name: ${name}.`);
    const row = await saveStoredVariable(ownerContext, name, value);
    if (name === 'IVX_AI_SYSTEM_SECRET') {
      invalidateIVXSystemSecretCache();
    }
    await auditOwnerVariableAction({ ownerContext, variableName: name, provider: metadata.provider, action: 'save', result: 'saved', details: { status: 'saved' } });
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      deploymentMarker: DEPLOYMENT_MARKER,
      saved: {
        name: row.name,
        provider: row.provider,
        status: row.status,
        maskedPreview: row.masked_preview,
        lastTestedAt: row.last_tested_at,
        secretValuesReturned: false,
      },
      statusAfterSave: await buildStatusPayload(ownerContext),
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables save failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, secretValuesReturned: false, error: sanitizeExternalErrorDetail(message), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}

export async function handleIVXOwnerVariablesDeleteRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = request.method === 'DELETE' ? readRecord(Object.fromEntries(new URL(request.url).searchParams.entries())) : readRecord(await request.json().catch(() => ({})));
    const name = readRequestedVariableName(body.name);
    const metadata = variableMetadataByName.get(name);
    if (!metadata) throw new Error(`Unsupported variable name: ${name}.`);
    const deleted = await deleteStoredVariable(name);
    await auditOwnerVariableAction({ ownerContext, variableName: name, provider: metadata.provider, action: 'delete', result: deleted ? 'deleted' : 'missing', details: { deleted } });
    return ownerOnlyJson({ ok: true, ownerOnly: true, deleted, variableName: name, secretValuesReturned: false, statusAfterDelete: await buildStatusPayload(ownerContext), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables delete failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, secretValuesReturned: false, error: sanitizeExternalErrorDetail(message), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}

const SELF_SYNC_ENV_FALLBACKS: Partial<Record<OwnerVariableName, readonly string[]>> = {
  IVX_AWS_READONLY_ACCESS_KEY_ID: ['IVX_AWS_READONLY_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'],
  IVX_AWS_READONLY_SECRET_ACCESS_KEY: ['IVX_AWS_READONLY_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'],
};

function resolveEnvValueForOwnerVariable(name: OwnerVariableName): { sourceEnvName: string; value: string } | null {
  const candidates = SELF_SYNC_ENV_FALLBACKS[name] ?? [name];
  for (const envName of candidates) {
    const value = readEnv(envName);
    if (value) {
      return { sourceEnvName: envName, value };
    }
  }
  return null;
}

/**
 * Owner-triggered: read each Owner Variable name from this backend's own process.env
 * (where the platform-saved values already live on Render) and securely store an encrypted
 * copy into `ivx_owner_variables`. The phone never transmits raw secrets; only masked
 * previews are returned in the response.
 */
export async function handleIVXOwnerVariablesSelfSyncRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readRecord(await request.json().catch(() => ({})));
    const requestedNames = Array.isArray(body.names)
      ? body.names.map(readTrimmed).filter((value): value is OwnerVariableName => isAllowedVariableName(value))
      : null;
    const overwriteExisting = body.overwriteExisting !== false;
    const candidates = requestedNames && requestedNames.length > 0
      ? OWNER_VARIABLES.filter((item) => requestedNames.includes(item.name))
      : OWNER_VARIABLES;

    const existingRows = await listStoredRows();
    const existingByName = new Map(existingRows.map((row) => [row.name, row]));

    const results: Array<{
      name: OwnerVariableName;
      provider: OwnerVariableProvider;
      action: 'synced' | 'skipped_existing' | 'missing_in_env' | 'error';
      sourceEnvName: string | null;
      maskedPreview: string | null;
      message?: string;
    }> = [];

    for (const metadata of candidates) {
      const name = metadata.name;
      const provider = metadata.provider;
      const existing = existingByName.get(name);
      if (existing && !overwriteExisting) {
        results.push({ name, provider, action: 'skipped_existing', sourceEnvName: null, maskedPreview: existing.masked_preview });
        continue;
      }
      const resolved = resolveEnvValueForOwnerVariable(name);
      if (!resolved) {
        results.push({ name, provider, action: 'missing_in_env', sourceEnvName: null, maskedPreview: existing?.masked_preview ?? null, message: 'No matching environment variable on the backend runtime.' });
        continue;
      }
      try {
        const value = normalizeVariableValue(name, resolved.value);
        const row = await saveStoredVariable(ownerContext, name, value);
        await auditOwnerVariableAction({
          ownerContext,
          variableName: name,
          provider,
          action: 'save',
          result: 'saved',
          details: { mode: 'self_sync_from_backend_env', sourceEnvName: resolved.sourceEnvName },
        });
        results.push({ name, provider, action: 'synced', sourceEnvName: resolved.sourceEnvName, maskedPreview: row.masked_preview });
      } catch (error) {
        const message = error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'Owner Variables self-sync failed for this variable.';
        results.push({ name, provider, action: 'error', sourceEnvName: resolved.sourceEnvName, maskedPreview: existing?.masked_preview ?? null, message });
      }
    }

    const syncedCount = results.filter((item) => item.action === 'synced').length;
    const missingInEnv = results.filter((item) => item.action === 'missing_in_env').map((item) => item.name);
    const errored = results.filter((item) => item.action === 'error').map((item) => item.name);

    return ownerOnlyJson({
      ok: errored.length === 0,
      ownerOnly: true,
      tool: 'ivx_owner_variables_self_sync',
      deploymentMarker: DEPLOYMENT_MARKER,
      authenticatedUserId: ownerContext.userId,
      mode: 'backend_runtime_env_to_encrypted_store',
      overwriteExisting,
      summary: {
        candidatesChecked: candidates.length,
        syncedCount,
        skippedExistingCount: results.filter((item) => item.action === 'skipped_existing').length,
        missingInEnvCount: missingInEnv.length,
        errorCount: errored.length,
      },
      results,
      missingInEnv,
      errored,
      statusAfterSync: await buildStatusPayload(ownerContext),
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables self-sync failed.';
    return ownerOnlyJson({
      ok: false,
      ownerOnly: true,
      secretValuesReturned: false,
      error: sanitizeExternalErrorDetail(message),
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

const DEPLOYMENT_VARIABLE_NAMES: readonly OwnerVariableName[] = ['GITHUB_REPO_URL', 'GITHUB_TOKEN', 'RENDER_API_KEY', 'RENDER_SERVICE_ID'] as const;

type DeploymentSyncOutcome = 'PRESENT' | 'SAVED' | 'FAILED';

/**
 * Computes deployment credential readiness without returning secret values.
 * `present` is true when the variable is reachable by backend runtime (process.env)
 * OR already stored encrypted in `ivx_owner_variables`.
 */
async function buildDeploymentCredentialStatus(): Promise<{
  variables: Record<OwnerVariableName, boolean>;
  credentialsReady: boolean;
  readiness: IVXOwnerVariableRuntimeReadiness[];
}> {
  const readiness = await Promise.all(DEPLOYMENT_VARIABLE_NAMES.map((name) => inspectIVXOwnerVariableRuntimeReadiness(name)));
  const variables = Object.fromEntries(readiness.map((item) => [item.name, item.present])) as Record<OwnerVariableName, boolean>;
  const credentialsReady = readiness.every((item) => item.present);
  return { variables, credentialsReady, readiness };
}

/**
 * Owner-triggered: read the four deployment credentials from this backend's own
 * runtime environment (process.env, where Render-configured platform values live)
 * and store an encrypted copy into `ivx_owner_variables`. Secret values are never
 * returned or logged; only PRESENT / SAVED / FAILED per variable plus masked previews.
 *
 * Important blocker note: backend code can only read `process.env`. The Rork project
 * private env store is NOT network-readable from deployed backend code, so a variable
 * can only be synced if it exists in the Render service environment (or is already in
 * the encrypted store). Variables absent from both are reported FAILED with that reason.
 */
export async function handleIVXOwnerVariablesSyncFromProjectStoreRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const existingRows = await listStoredRows();
    const existingByName = new Map(existingRows.map((row) => [row.name, row]));

    const results: Array<{
      name: OwnerVariableName;
      result: DeploymentSyncOutcome;
      sourceEnvName: string | null;
      maskedPreview: string | null;
      detail: string;
    }> = [];

    for (const name of DEPLOYMENT_VARIABLE_NAMES) {
      const provider = variableMetadataByName.get(name)?.provider ?? 'github';
      const resolved = resolveEnvValueForOwnerVariable(name);
      if (resolved) {
        try {
          const value = normalizeVariableValue(name, resolved.value);
          const row = await saveStoredVariable(ownerContext, name, value);
          await auditOwnerVariableAction({
            ownerContext,
            variableName: name,
            provider,
            action: 'save',
            result: 'saved',
            details: { mode: 'sync_from_project_store', sourceEnvName: resolved.sourceEnvName },
          });
          results.push({ name, result: 'SAVED', sourceEnvName: resolved.sourceEnvName, maskedPreview: row.masked_preview, detail: 'Read from backend runtime environment and stored encrypted.' });
        } catch (error) {
          results.push({ name, result: 'FAILED', sourceEnvName: resolved.sourceEnvName, maskedPreview: existingByName.get(name)?.masked_preview ?? null, detail: error instanceof Error ? sanitizeExternalErrorDetail(error.message) : 'Encryption/store write failed.' });
        }
        continue;
      }
      const existing = existingByName.get(name);
      if (existing) {
        results.push({ name, result: 'PRESENT', sourceEnvName: null, maskedPreview: existing.masked_preview, detail: 'Not present in backend runtime environment, but an encrypted value already exists in the store.' });
        continue;
      }
      results.push({ name, result: 'FAILED', sourceEnvName: null, maskedPreview: null, detail: 'Not present in backend runtime environment (process.env) and not already stored. The Rork project store is not network-readable from backend code; this variable must exist in the Render service environment to be synced.' });
    }

    const deploymentStatus = await buildDeploymentCredentialStatus();
    const failed = results.filter((item) => item.result === 'FAILED').map((item) => item.name);
    return ownerOnlyJson({
      ok: failed.length === 0,
      ownerOnly: true,
      tool: 'ivx_owner_variables_sync_from_project_store',
      deploymentMarker: DEPLOYMENT_MARKER,
      mode: 'backend_runtime_env_to_encrypted_store',
      results,
      failed,
      credentialsReady: deploymentStatus.credentialsReady,
      deploymentStatus: deploymentStatus.variables,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables sync-from-project-store failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, secretValuesReturned: false, error: sanitizeExternalErrorDetail(message), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

/**
 * Owner-triggered: report deployment credential presence and overall readiness
 * without returning any secret values.
 */
export async function handleIVXOwnerVariablesDeploymentStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    await assertIVXOwnerOnly(request);
    const deploymentStatus = await buildDeploymentCredentialStatus();
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      tool: 'ivx_owner_variables_deployment_status',
      deploymentMarker: DEPLOYMENT_MARKER,
      GITHUB_REPO_URL: { present: deploymentStatus.variables.GITHUB_REPO_URL },
      GITHUB_TOKEN: { present: deploymentStatus.variables.GITHUB_TOKEN },
      RENDER_API_KEY: { present: deploymentStatus.variables.RENDER_API_KEY },
      RENDER_SERVICE_ID: { present: deploymentStatus.variables.RENDER_SERVICE_ID },
      credentialsReady: deploymentStatus.credentialsReady,
      runtimeReadiness: deploymentStatus.readiness,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables deployment-status failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, secretValuesReturned: false, error: sanitizeExternalErrorDetail(message), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

export async function handleIVXOwnerVariablesTestRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.', secretValuesReturned: false }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readRecord(await request.json().catch(() => ({})));
    const requestedName = readTrimmed(body.name);
    const requestedProvider = readTrimmed(body.provider);

    if (requestedName) {
      const name = readRequestedVariableName(requestedName);
      const row = await getStoredRow(name);
      if (!row) {
        await auditOwnerVariableAction({ ownerContext, variableName: name, provider: variableMetadataByName.get(name)?.provider ?? null, action: 'test', result: 'missing', details: { mode: 'variable_format' } });
        return ownerOnlyJson({ ok: false, ownerOnly: true, variableName: name, testResult: 'missing', secretValuesReturned: false, error: `${name} has not been saved yet.`, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, 404);
      }
      const validation = validateSingleVariableForTest(name, decryptRowValue(row));
      await updateVariableTestStatus(name, validation.result, validation.message);
      await auditOwnerVariableAction({ ownerContext, variableName: name, provider: row.provider, action: 'test', result: validation.result, details: { mode: 'variable_format' } });
      return ownerOnlyJson({ ok: validation.result === 'tested', ownerOnly: true, variableName: name, provider: row.provider, testResult: validation.result, message: validation.message, statusAfterTest: await buildStatusPayload(ownerContext), secretValuesReturned: false, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, validation.result === 'tested' ? 200 : 400);
    }

    const provider = readRequestedProvider(requestedProvider);
    const providerResult = await testProvider(provider);
    const providerVariableNames = OWNER_VARIABLES.filter((item) => item.provider === provider).map((item) => item.name);
    await Promise.all(providerVariableNames.map((name) => updateVariableTestStatus(name, providerResult.status === 'tested' ? 'tested' : providerResult.status === 'invalid' ? 'invalid' : 'missing', providerResult.error ?? providerResult.status)));
    await auditOwnerVariableAction({ ownerContext, variableName: null, provider, action: 'test', result: providerResult.status, details: { mode: 'provider', httpStatus: providerResult.httpStatus ?? null, missingVariableNames: providerResult.missingVariableNames } });
    return ownerOnlyJson({ ok: providerResult.status === 'tested', ownerOnly: true, provider, providerResult, statusAfterTest: await buildStatusPayload(ownerContext, providerResult), secretValuesReturned: false, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, providerResult.status === 'tested' ? 200 : 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner Variables test failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, secretValuesReturned: false, error: sanitizeExternalErrorDetail(message), deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}
