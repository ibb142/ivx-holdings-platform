import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

type SupabaseInspectionKind = 'tables' | 'schema' | 'columns' | 'rls';

type PgQueryResult<T> = {
  rows: T[];
};

type PgPoolClient = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<PgQueryResult<T>>;
  release: () => void;
};

type PgPool = {
  connect: () => Promise<PgPoolClient>;
  end: () => Promise<void>;
};

type PgPoolConstructor = new (config: {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
  application_name?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}) => PgPool;

type TableInspectionRow = {
  schema_name: string;
  table_name: string;
  relation_type: string;
  owner: string | null;
  rls_enabled: boolean | null;
  rls_forced: boolean | null;
  estimated_rows: string | number | null;
  comment: string | null;
};

type SchemaInspectionRow = {
  schema_name: string;
  owner: string | null;
  relation_count: string | number;
  comment: string | null;
};

type ColumnInspectionRow = {
  schema_name: string;
  table_name: string;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: boolean;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  datetime_precision: number | null;
};

type RlsTableInspectionRow = {
  schema_name: string;
  table_name: string;
  rls_enabled: boolean | null;
  rls_forced: boolean | null;
  policy_count: string | number;
};

type PolicyInspectionRow = {
  schema_name: string;
  table_name: string;
  policy_name: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

type OpenApiPropertySchema = {
  type?: string;
  format?: string;
  nullable?: boolean;
  default?: unknown;
  description?: string;
};

type OpenApiDefinitionSchema = {
  type?: string;
  properties?: Record<string, OpenApiPropertySchema>;
  required?: string[];
  description?: string;
};

type SupabaseOpenApiPayload = {
  definitions?: Record<string, OpenApiDefinitionSchema>;
  components?: {
    schemas?: Record<string, OpenApiDefinitionSchema>;
  };
};

type SupabaseInspectionPayload = {
  ok: true;
  readOnly: true;
  ownerOnly: true;
  tool: 'list_supabase_tables' | 'inspect_supabase_schema' | 'list_supabase_columns' | 'inspect_supabase_rls';
  inspection: SupabaseInspectionKind;
  filters: {
    schema: string | null;
    table: string | null;
    limit: number;
  };
  timestamp: string;
  data: Record<string, unknown>;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const REST_PROBE_TIMEOUT_MS = 12_000;
const REST_PROBE_CONCURRENCY = 8;
const FALLBACK_SQL_SCHEMA_PATHS = [
  'expo/scripts/supabase-full-schema.sql',
  'expo/scripts/supabase-fix-everything.sql',
  'expo/supabase/ivx-owner-ai-phase1.sql',
] as const;

let cachedPool: PgPool | null = null;
let cachedPoolKey: string | null = null;

function readTrimmedEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeFilterValue(value: string | null): string | null {
  const normalized = (value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function decodeJwtRole(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function getSupabaseRestBaseUrl(): string {
  const supabaseUrl = readTrimmedEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend.');
  }
  return `${supabaseUrl}/rest/v1`;
}

function getSupabaseRestKey(requireServiceRole: boolean): string {
  const anonKey = readTrimmedEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = readTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') || readTrimmedEnv('SUPABASE_SERVICE_KEY');
  const serviceRole = decodeJwtRole(serviceKey);
  if (serviceKey && serviceKey !== anonKey && (serviceRole === 'service_role' || serviceRole === 'supabase_admin')) {
    return serviceKey;
  }
  if (requireServiceRole) {
    throw new Error('Supabase service-role key is required for REST schema inspection.');
  }
  if (!anonKey) {
    throw new Error('Supabase anon key is not configured on the backend.');
  }
  return anonKey;
}

async function fetchWithAbort(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('abort') || error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Supabase REST request timed out after ${timeoutMs}ms (url=${url.slice(0, 120)}). This is a transient timeout, not a missing-relation error — do not classify as relation_missing.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getSupabaseProjectRef(): string {
  const supabaseUrl = readTrimmedEnv('EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend.');
  }

  try {
    const host = new URL(supabaseUrl).hostname;
    const [projectRef] = host.split('.');
    if (projectRef) {
      return projectRef;
    }
  } catch {
    const match = supabaseUrl.match(/https?:\/\/([^.]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error('Unable to derive Supabase project ref from backend configuration.');
}

function buildSupabaseInspectionConnectionString(): string {
  const explicitConnectionString = readTrimmedEnv('SUPABASE_INSPECTION_DATABASE_URL')
    || readTrimmedEnv('SUPABASE_READONLY_DATABASE_URL')
    || readTrimmedEnv('SUPABASE_DB_URL')
    || readTrimmedEnv('DATABASE_URL')
    || readTrimmedEnv('POSTGRES_URL');

  if (explicitConnectionString) {
    return explicitConnectionString;
  }

  const password = readTrimmedEnv('SUPABASE_DB_PASSWORD');
  if (!password) {
    throw new Error('Supabase inspection database password is not configured on the backend.');
  }

  const projectRef = getSupabaseProjectRef();
  const dbHost = readTrimmedEnv('SUPABASE_DB_HOST') || `db.${projectRef}.supabase.co`;
  const dbPort = readTrimmedEnv('SUPABASE_DB_PORT') || '5432';
  const dbName = readTrimmedEnv('SUPABASE_DB_NAME') || 'postgres';
  const dbUser = readTrimmedEnv('SUPABASE_DB_USER') || 'postgres';
  const encodedUser = encodeURIComponent(dbUser);
  const encodedPassword = encodeURIComponent(password);
  const encodedDbName = encodeURIComponent(dbName);

  return `postgres://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${encodedDbName}?sslmode=require&application_name=ivx_read_only_inspection`;
}

async function getInspectionPool(): Promise<PgPool> {
  const connectionString = buildSupabaseInspectionConnectionString();
  if (cachedPool && cachedPoolKey === connectionString) {
    return cachedPool;
  }

  if (cachedPool) {
    await cachedPool.end().catch((error: unknown) => {
      console.log('[IVXSupabaseInspection] Previous pool close failed:', error instanceof Error ? error.message : 'unknown');
    });
  }

  const pgModule = await import('pg') as { Pool: PgPoolConstructor };
  cachedPool = new pgModule.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: 'ivx_read_only_inspection',
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  cachedPoolKey = connectionString;
  return cachedPool;
}

async function runReadOnlyQuery<T>(text: string, values: unknown[]): Promise<T[]> {
  const pool = await getInspectionPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<T>(text, values);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.log('[IVXSupabaseInspection] Read-only rollback failed:', rollbackError instanceof Error ? rollbackError.message : 'unknown');
    });
    throw error;
  } finally {
    client.release();
  }
}

async function readSupabaseOpenApiDefinitions(): Promise<Record<string, OpenApiDefinitionSchema>> {
  const restBaseUrl = getSupabaseRestBaseUrl();
  const key = getSupabaseRestKey(true);
  const response = await fetchWithAbort(`${restBaseUrl}/`, {
    method: 'GET',
    headers: {
      Accept: 'application/openapi+json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  }, REST_PROBE_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase REST schema inspection failed with HTTP ${response.status}.`);
  }
  const payload = JSON.parse(text) as SupabaseOpenApiPayload;
  return payload.definitions ?? payload.components?.schemas ?? {};
}

function normalizeOpenApiTableName(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[a-zA-Z_][\w]*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function mapOpenApiDefinitionsToTables(
  definitions: Record<string, OpenApiDefinitionSchema>,
  schema: string | null,
  table: string | null,
  limit: number,
): TableInspectionRow[] {
  const requestedSchema = schema ?? 'public';
  if (requestedSchema !== 'public') {
    return [];
  }
  const requestedTable = table?.toLowerCase() ?? null;
  return Object.entries(definitions)
    .map(([name, definition]) => ({ name: normalizeOpenApiTableName(name), definition }))
    .filter((entry): entry is { name: string; definition: OpenApiDefinitionSchema } => Boolean(entry.name))
    .filter((entry) => !requestedTable || entry.name.toLowerCase() === requestedTable)
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((entry) => ({
      schema_name: 'public',
      table_name: entry.name,
      relation_type: 'table',
      owner: null,
      rls_enabled: null,
      rls_forced: null,
      estimated_rows: null,
      comment: entry.definition.description ?? 'Supabase REST schema metadata',
    }));
}

async function inspectSupabaseTablesViaOpenApi(schema: string | null, table: string | null, limit: number): Promise<TableInspectionRow[]> {
  const definitions = await readSupabaseOpenApiDefinitions();
  return mapOpenApiDefinitionsToTables(definitions, schema, table, limit);
}

async function inspectSupabaseColumnsViaOpenApi(schema: string | null, table: string | null, limit: number): Promise<ColumnInspectionRow[]> {
  const definitions = await readSupabaseOpenApiDefinitions();
  const requestedSchema = schema ?? 'public';
  if (requestedSchema !== 'public') {
    return [];
  }
  const requestedTable = table?.toLowerCase() ?? null;
  const rows: ColumnInspectionRow[] = [];
  const entries = Object.entries(definitions)
    .map(([name, definition]) => ({ name: normalizeOpenApiTableName(name), definition }))
    .filter((entry): entry is { name: string; definition: OpenApiDefinitionSchema } => Boolean(entry.name))
    .filter((entry) => !requestedTable || entry.name.toLowerCase() === requestedTable)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const required = new Set(entry.definition.required ?? []);
    const properties = Object.entries(entry.definition.properties ?? {});
    properties.forEach(([columnName, property], index) => {
      rows.push({
        schema_name: 'public',
        table_name: entry.name,
        ordinal_position: index + 1,
        column_name: columnName,
        data_type: property.format ?? property.type ?? 'unknown',
        udt_name: property.type ?? 'unknown',
        is_nullable: property.nullable === true || !required.has(columnName),
        column_default: property.default === undefined ? null : String(property.default),
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        datetime_precision: null,
      });
    });
  }
  return rows.slice(0, limit);
}

async function loadFallbackSqlTexts(): Promise<string[]> {
  const sqlTexts: string[] = [];
  try {
    const pathModule = await import('node:path');
    const fsModule = await import('node:fs/promises');
    for (const relativePath of FALLBACK_SQL_SCHEMA_PATHS) {
      try {
        sqlTexts.push(await fsModule.readFile(pathModule.resolve(process.cwd(), relativePath), 'utf8'));
      } catch {
      }
    }
  } catch {
  }
  return sqlTexts;
}

async function loadCandidateTableNamesFromSql(): Promise<string[]> {
  const tableNames = new Set<string>();
  const sqlTexts = await loadFallbackSqlTexts();
  for (const text of sqlTexts) {
    for (const match of text.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z_][\w]*)/gi)) {
      const tableName = normalizeOpenApiTableName(match[1] ?? '');
      if (tableName) {
        tableNames.add(tableName);
      }
    }
  }
  return [...tableNames].sort((left, right) => left.localeCompare(right));
}

function splitSqlDefinitionItems(body: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? '';
    const nextCharacter = body[index + 1] ?? '';
    current += character;
    if (inSingleQuote) {
      if (character === "'" && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
        continue;
      }
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (character === "'") {
      inSingleQuote = true;
      continue;
    }
    if (character === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === ',' && depth === 0) {
      items.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  const finalItem = current.trim();
  if (finalItem) {
    items.push(finalItem);
  }
  return items;
}

function readColumnDefault(definition: string): string | null {
  const match = definition.match(/\bdefault\s+([\s\S]+?)(?:\s+not\s+null|\s+null\b|\s+references\b|\s+constraint\b|\s+primary\b|\s+unique\b|\s+check\b|$)/i);
  return match?.[1]?.trim() ?? null;
}

function normalizeSqlDataType(rawType: string): string {
  return rawType.replace(/\s+/g, ' ').trim() || 'unknown';
}

function toSqlUdtName(dataType: string): string {
  const normalized = dataType.toLowerCase();
  if (normalized.includes('uuid')) {
    return 'uuid';
  }
  if (normalized.includes('timestamp with time zone') || normalized.includes('timestamptz')) {
    return 'timestamptz';
  }
  if (normalized.includes('bigint')) {
    return 'int8';
  }
  if (normalized.includes('integer')) {
    return 'int4';
  }
  if (normalized.includes('numeric')) {
    return 'numeric';
  }
  if (normalized.includes('boolean')) {
    return 'bool';
  }
  if (normalized.includes('text[]')) {
    return '_text';
  }
  if (normalized.includes('jsonb')) {
    return 'jsonb';
  }
  if (normalized.includes('text')) {
    return 'text';
  }
  return normalizedSqlIdentifier(dataType) || 'unknown';
}

function normalizedSqlIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseSqlCreateTableColumns(text: string, schema: string | null, table: string | null, limit: number): ColumnInspectionRow[] {
  const rows: ColumnInspectionRow[] = [];
  const requestedSchema = schema ?? 'public';
  if (requestedSchema !== 'public') {
    return rows;
  }
  const requestedTable = table?.toLowerCase() ?? null;
  const tableRegex = /create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z_][\w]*)\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of text.matchAll(tableRegex)) {
    const tableName = normalizeOpenApiTableName(match[1] ?? '');
    const body = match[2] ?? '';
    if (!tableName || (requestedTable && tableName.toLowerCase() !== requestedTable)) {
      continue;
    }
    const items = splitSqlDefinitionItems(body);
    let ordinalPosition = 1;
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed || /^(constraint|primary\s+key|foreign\s+key|unique\b|check\b|exclude\b)/i.test(trimmed)) {
        continue;
      }
      const columnMatch = trimmed.match(/^"?([a-zA-Z_][\w]*)"?\s+([\s\S]+)$/);
      if (!columnMatch) {
        continue;
      }
      const columnName = columnMatch[1] ?? '';
      const definition = columnMatch[2] ?? '';
      const typeMatch = definition.match(/^([\s\S]+?)(?:\s+default\b|\s+not\s+null\b|\s+null\b|\s+references\b|\s+constraint\b|\s+primary\s+key\b|\s+unique\b|\s+check\b|$)/i);
      const dataType = normalizeSqlDataType(typeMatch?.[1] ?? definition);
      rows.push({
        schema_name: 'public',
        table_name: tableName,
        ordinal_position: ordinalPosition,
        column_name: columnName,
        data_type: dataType,
        udt_name: toSqlUdtName(dataType),
        is_nullable: !/\bnot\s+null\b|\bprimary\s+key\b/i.test(definition),
        column_default: readColumnDefault(definition),
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        datetime_precision: null,
      });
      ordinalPosition += 1;
      if (rows.length >= limit) {
        return rows;
      }
    }
  }
  return rows;
}

async function inspectSupabaseColumnsViaSqlFallback(schema: string | null, table: string | null, limit: number): Promise<ColumnInspectionRow[]> {
  const sqlTexts = await loadFallbackSqlTexts();
  const rows = sqlTexts.flatMap((text) => parseSqlCreateTableColumns(text, schema, table, limit));
  const deduped = new Map<string, ColumnInspectionRow>();
  for (const row of rows) {
    const key = `${row.schema_name}.${row.table_name}.${row.column_name}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()]
    .sort((left, right) => `${left.schema_name}.${left.table_name}.${left.ordinal_position}`.localeCompare(`${right.schema_name}.${right.table_name}.${right.ordinal_position}`))
    .slice(0, limit);
}

type SqlRlsFallback = {
  tableStatus: Map<string, RlsTableInspectionRow>;
  policies: PolicyInspectionRow[];
};

function parseSqlRlsFallback(text: string, schema: string | null, table: string | null, limit: number): SqlRlsFallback {
  const requestedSchema = schema ?? 'public';
  const requestedTable = table?.toLowerCase() ?? null;
  const tableStatus = new Map<string, RlsTableInspectionRow>();
  const policies: PolicyInspectionRow[] = [];
  if (requestedSchema !== 'public') {
    return { tableStatus, policies };
  }
  for (const match of text.matchAll(/alter\s+table\s+public\.([a-zA-Z_][\w]*)\s+enable\s+row\s+level\s+security/gi)) {
    const tableName = normalizeOpenApiTableName(match[1] ?? '');
    if (!tableName || (requestedTable && tableName.toLowerCase() !== requestedTable)) {
      continue;
    }
    tableStatus.set(tableName, {
      schema_name: 'public',
      table_name: tableName,
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
    });
  }
  for (const match of text.matchAll(/alter\s+table\s+public\.([a-zA-Z_][\w]*)\s+force\s+row\s+level\s+security/gi)) {
    const tableName = normalizeOpenApiTableName(match[1] ?? '');
    const row = tableName ? tableStatus.get(tableName) : null;
    if (row) {
      row.rls_forced = true;
    }
  }
  const policyRegex = /create\s+policy\s+"?([^"\s]+)"?\s+on\s+public\.([a-zA-Z_][\w]*)\s+for\s+([a-zA-Z]+)/gi;
  for (const match of text.matchAll(policyRegex)) {
    const policyName = match[1] ?? '';
    const tableName = normalizeOpenApiTableName(match[2] ?? '');
    if (!policyName || !tableName || (requestedTable && tableName.toLowerCase() !== requestedTable)) {
      continue;
    }
    const policy: PolicyInspectionRow = {
      schema_name: 'public',
      table_name: tableName,
      policy_name: policyName,
      permissive: 'PERMISSIVE',
      roles: ['authenticated'],
      cmd: (match[3] ?? 'all').toUpperCase(),
      qual: null,
      with_check: null,
    };
    policies.push(policy);
    const status = tableStatus.get(tableName) ?? {
      schema_name: 'public',
      table_name: tableName,
      rls_enabled: null,
      rls_forced: null,
      policy_count: 0,
    };
    status.policy_count = Number(status.policy_count) + 1;
    tableStatus.set(tableName, status);
    if (policies.length >= limit) {
      break;
    }
  }
  return { tableStatus, policies };
}

async function inspectSupabaseRlsViaSqlFallback(schema: string | null, table: string | null, limit: number): Promise<SqlRlsFallback> {
  const merged: SqlRlsFallback = { tableStatus: new Map<string, RlsTableInspectionRow>(), policies: [] };
  const sqlTexts = await loadFallbackSqlTexts();
  for (const text of sqlTexts) {
    const parsed = parseSqlRlsFallback(text, schema, table, limit);
    for (const [tableName, row] of parsed.tableStatus.entries()) {
      const existing = merged.tableStatus.get(tableName);
      merged.tableStatus.set(tableName, {
        ...row,
        rls_enabled: row.rls_enabled ?? existing?.rls_enabled ?? null,
        rls_forced: row.rls_forced ?? existing?.rls_forced ?? null,
        policy_count: Math.max(Number(row.policy_count) || 0, Number(existing?.policy_count) || 0),
      });
    }
    for (const policy of parsed.policies) {
      const key = `${policy.schema_name}.${policy.table_name}.${policy.policy_name}`;
      if (!merged.policies.some((existing) => `${existing.schema_name}.${existing.table_name}.${existing.policy_name}` === key)) {
        merged.policies.push(policy);
      }
    }
  }
  return merged;
}

async function probeSupabaseRestTable(tableName: string): Promise<boolean> {
  const restBaseUrl = getSupabaseRestBaseUrl();
  const key = getSupabaseRestKey(false);
  const response = await fetchWithAbort(`${restBaseUrl}/${encodeURIComponent(tableName)}?select=*&limit=0`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  }, REST_PROBE_TIMEOUT_MS);
  if (response.ok || response.status === 206) {
    return true;
  }
  const text = await response.text();
  if (/PGRST205|could not find the table/i.test(text)) {
    return false;
  }
  if (response.status === 401 || response.status === 403) {
    return true;
  }
  if (response.status >= 500) {
    return false;
  }
  return false;
}

async function inspectSupabaseTablesViaSqlFallback(schema: string | null, table: string | null, limit: number): Promise<TableInspectionRow[]> {
  const requestedSchema = schema ?? 'public';
  if (requestedSchema !== 'public') {
    return [];
  }

  const requestedTable = table?.toLowerCase() ?? null;
  const tableNames = (await loadCandidateTableNamesFromSql())
    .filter((name) => !requestedTable || name.toLowerCase() === requestedTable)
    .slice(0, limit);

  return tableNames.map((tableName) => ({
    schema_name: 'public',
    table_name: tableName,
    relation_type: 'table',
    owner: null,
    rls_enabled: null,
    rls_forced: null,
    estimated_rows: null,
    comment: 'Local/dev checked-in SQL schema fallback; live Supabase connection not required.',
  }));
}

async function inspectSupabaseTablesViaKnownRestProbes(schema: string | null, table: string | null, limit: number): Promise<TableInspectionRow[]> {
  const requestedSchema = schema ?? 'public';
  if (requestedSchema !== 'public') {
    return [];
  }
  const requestedTable = table?.toLowerCase() ?? null;
  const candidates = (await loadCandidateTableNamesFromSql())
    .filter((name) => !requestedTable || name.toLowerCase() === requestedTable)
    .slice(0, Math.max(limit, DEFAULT_LIMIT));
  const rows: TableInspectionRow[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < candidates.length) {
      const tableName = candidates[index];
      index += 1;
      try {
        if (await probeSupabaseRestTable(tableName)) {
          rows.push({
            schema_name: 'public',
            table_name: tableName,
            relation_type: 'table',
            owner: null,
            rls_enabled: null,
            rls_forced: null,
            estimated_rows: null,
            comment: 'Verified through Supabase REST table probe',
          });
        }
      } catch (error) {
        console.log('[IVXSupabaseInspection] REST table probe failed:', { tableName, message: error instanceof Error ? error.message : 'unknown' });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REST_PROBE_CONCURRENCY, candidates.length) }, () => worker()));
  return rows.sort((left, right) => left.table_name.localeCompare(right.table_name)).slice(0, limit);
}

function readInspectionFilters(request: Request): { schema: string | null; table: string | null; limit: number } {
  const url = new URL(request.url);
  return {
    schema: normalizeFilterValue(url.searchParams.get('schema')),
    table: normalizeFilterValue(url.searchParams.get('table')),
    limit: clampLimit(url.searchParams.get('limit')),
  };
}

export async function inspectSupabaseTables(schema: string | null, table: string | null, limit: number): Promise<TableInspectionRow[]> {
  try {
    return await runReadOnlyQuery<TableInspectionRow>(`
      select
        t.table_schema as schema_name,
        t.table_name,
        lower(t.table_type) as relation_type,
        pg_get_userbyid(c.relowner) as owner,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        coalesce(s.n_live_tup, c.reltuples)::bigint as estimated_rows,
        obj_description(c.oid, 'pg_class') as comment
      from information_schema.tables t
      left join pg_namespace n on n.nspname = t.table_schema
      left join pg_class c on c.relnamespace = n.oid and c.relname = t.table_name
      left join pg_stat_user_tables s on s.relid = c.oid
      where t.table_schema not in ('pg_catalog', 'information_schema')
        and t.table_schema not like 'pg_toast%'
        and ($1::text is null or t.table_schema = $1)
        and ($2::text is null or t.table_name = $2)
      order by t.table_schema asc, t.table_name asc
      limit $3
    `, [schema, table, limit]);
  } catch (pgError) {
    console.log('[IVXSupabaseInspection] Direct Postgres table inspection failed; trying REST schema fallbacks:', pgError instanceof Error ? pgError.message : 'unknown');
    try {
      return await inspectSupabaseTablesViaOpenApi(schema, table, limit);
    } catch (openApiError) {
      console.log('[IVXSupabaseInspection] OpenAPI table inspection failed; trying known table probes:', openApiError instanceof Error ? openApiError.message : 'unknown');
      const probedRows = await inspectSupabaseTablesViaKnownRestProbes(schema, table, limit);
      if (probedRows.length > 0) {
        return probedRows;
      }
      const sqlFallbackRows = await inspectSupabaseTablesViaSqlFallback(schema, table, limit);
      if (sqlFallbackRows.length > 0) {
        return sqlFallbackRows;
      }
      throw openApiError instanceof Error ? openApiError : pgError;
    }
  }
}

export async function inspectSupabaseSchema(schema: string | null, table: string | null, limit: number): Promise<{
  schemas: SchemaInspectionRow[];
  relations: TableInspectionRow[];
}> {
  try {
    const schemas = await runReadOnlyQuery<SchemaInspectionRow>(`
      select
        n.nspname as schema_name,
        pg_get_userbyid(n.nspowner) as owner,
        count(c.oid) filter (where c.relkind in ('r', 'p', 'v', 'm', 'f'))::bigint as relation_count,
        obj_description(n.oid, 'pg_namespace') as comment
      from pg_namespace n
      left join pg_class c on c.relnamespace = n.oid
      where n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg_toast%'
        and ($1::text is null or n.nspname = $1)
      group by n.oid, n.nspname, n.nspowner
      order by n.nspname asc
      limit $2
    `, [schema, limit]);
    const relations = await inspectSupabaseTables(schema, table, limit);
    return { schemas, relations };
  } catch (pgError) {
    console.log('[IVXSupabaseInspection] Direct Postgres schema inspection failed; trying REST schema fallback:', pgError instanceof Error ? pgError.message : 'unknown');
    const relations = await inspectSupabaseTables(schema, table, limit);
    return {
      schemas: [{ schema_name: schema ?? 'public', owner: null, relation_count: relations.length, comment: 'Supabase REST schema metadata' }],
      relations,
    };
  }
}

export async function inspectSupabaseColumns(schema: string | null, table: string | null, limit: number): Promise<ColumnInspectionRow[]> {
  try {
    return await runReadOnlyQuery<ColumnInspectionRow>(`
      select
        table_schema as schema_name,
        table_name,
        ordinal_position,
        column_name,
        data_type,
        udt_name,
        (is_nullable = 'YES') as is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        datetime_precision
      from information_schema.columns
      where table_schema not in ('pg_catalog', 'information_schema')
        and table_schema not like 'pg_toast%'
        and ($1::text is null or table_schema = $1)
        and ($2::text is null or table_name = $2)
      order by table_schema asc, table_name asc, ordinal_position asc
      limit $3
    `, [schema, table, limit]);
  } catch (pgError) {
    console.log('[IVXSupabaseInspection] Direct Postgres column inspection failed; trying REST schema fallback:', pgError instanceof Error ? pgError.message : 'unknown');
    try {
      return await inspectSupabaseColumnsViaOpenApi(schema, table, limit);
    } catch (openApiError) {
      console.log('[IVXSupabaseInspection] OpenAPI column inspection failed; trying checked-in SQL schema fallback:', openApiError instanceof Error ? openApiError.message : 'unknown');
      const rows = await inspectSupabaseColumnsViaSqlFallback(schema, table, limit);
      if (rows.length > 0) {
        return rows;
      }
      throw openApiError instanceof Error ? openApiError : pgError;
    }
  }
}

export async function inspectSupabaseRls(schema: string | null, table: string | null, limit: number): Promise<{
  tables: Array<RlsTableInspectionRow & { policies: PolicyInspectionRow[] }>;
  policies: PolicyInspectionRow[];
}> {
  try {
    const tables = await runReadOnlyQuery<RlsTableInspectionRow>(`
      select
        n.nspname as schema_name,
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        count(p.policyname)::bigint as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg_toast%'
        and ($1::text is null or n.nspname = $1)
        and ($2::text is null or c.relname = $2)
      group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
      order by n.nspname asc, c.relname asc
      limit $3
    `, [schema, table, limit]);

    const policies = await runReadOnlyQuery<PolicyInspectionRow>(`
      select
        schemaname as schema_name,
        tablename as table_name,
        policyname as policy_name,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      from pg_policies
      where schemaname not in ('pg_catalog', 'information_schema')
        and schemaname not like 'pg_toast%'
        and ($1::text is null or schemaname = $1)
        and ($2::text is null or tablename = $2)
      order by schemaname asc, tablename asc, policyname asc
      limit $3
    `, [schema, table, limit]);

    const policyMap = new Map<string, PolicyInspectionRow[]>();
    for (const policy of policies) {
      const key = `${policy.schema_name}.${policy.table_name}`;
      const list = policyMap.get(key) ?? [];
      list.push(policy);
      policyMap.set(key, list);
    }

    return {
      tables: tables.map((row) => ({
        ...row,
        policies: policyMap.get(`${row.schema_name}.${row.table_name}`) ?? [],
      })),
      policies,
    };
  } catch (pgError) {
    console.log('[IVXSupabaseInspection] Direct Postgres RLS inspection failed; returning REST-visible tables with SQL fallback RLS metadata when available:', pgError instanceof Error ? pgError.message : 'unknown');
    const [tables, fallback] = await Promise.all([
      inspectSupabaseTables(schema, table, limit),
      inspectSupabaseRlsViaSqlFallback(schema, table, limit),
    ]);
    const policyMap = new Map<string, PolicyInspectionRow[]>();
    for (const policy of fallback.policies) {
      const key = `${policy.schema_name}.${policy.table_name}`;
      const list = policyMap.get(key) ?? [];
      list.push(policy);
      policyMap.set(key, list);
    }
    return {
      tables: tables.map((row) => {
        const fallbackStatus = fallback.tableStatus.get(row.table_name);
        const policies = policyMap.get(`${row.schema_name}.${row.table_name}`) ?? [];
        return {
          schema_name: row.schema_name,
          table_name: row.table_name,
          rls_enabled: fallbackStatus?.rls_enabled ?? null,
          rls_forced: fallbackStatus?.rls_forced ?? null,
          policy_count: fallbackStatus?.policy_count ?? (policies.length > 0 ? policies.length : 'unknown'),
          policies,
        };
      }),
      policies: fallback.policies,
    };
  }
}

function getToolName(kind: SupabaseInspectionKind): SupabaseInspectionPayload['tool'] {
  switch (kind) {
    case 'tables':
      return 'list_supabase_tables';
    case 'schema':
      return 'inspect_supabase_schema';
    case 'columns':
      return 'list_supabase_columns';
    case 'rls':
      return 'inspect_supabase_rls';
  }
}

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('authorization') || message.includes('auth guard') || message.includes('missing bearer token') || message.includes('owner access') || message.includes('invalid owner session')) {
    return 401;
  }
  if (message.includes('privileged ivx access is required')) {
    return 403;
  }
  if (message.includes('configured') || message.includes('supabase') || message.includes('database')) {
    return 503;
  }
  return 500;
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXSupabaseInspectionRequest(request: Request, kind: SupabaseInspectionKind): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }

    const ownerContext = await assertIVXOwnerOnly(request);
    const filters = readInspectionFilters(request);
    console.log('[IVXSupabaseInspection] Read-only inspection started:', {
      kind,
      tool: getToolName(kind),
      schema: filters.schema,
      table: filters.table,
      limit: filters.limit,
      userId: ownerContext.userId,
      role: ownerContext.role,
      guardMode: ownerContext.guardMode,
    });

    const data = kind === 'tables'
      ? { tables: await inspectSupabaseTables(filters.schema, filters.table, filters.limit) }
      : kind === 'schema'
        ? await inspectSupabaseSchema(filters.schema, filters.table, filters.limit)
        : kind === 'columns'
          ? { columns: await inspectSupabaseColumns(filters.schema, filters.table, filters.limit) }
          : await inspectSupabaseRls(filters.schema, filters.table, filters.limit);

    const payload: SupabaseInspectionPayload = {
      ok: true,
      readOnly: true,
      ownerOnly: true,
      tool: getToolName(kind),
      inspection: kind,
      filters,
      timestamp: nowIso(),
      data: data as Record<string, unknown>,
    };

    console.log('[IVXSupabaseInspection] Read-only inspection completed:', {
      kind,
      tool: payload.tool,
      schema: filters.schema,
      table: filters.table,
      dataKeys: Object.keys(payload.data),
    });

    return ownerOnlyJson(payload as unknown as Record<string, unknown>);
  } catch (error) {
    const status = getErrorStatus(error);
    const message = error instanceof Error ? error.message : 'Supabase inspection failed.';
    console.log('[IVXSupabaseInspection] Read-only inspection failed:', {
      kind,
      status,
      message,
    });
    return ownerOnlyJson({
      error: status === 503 ? 'Supabase inspection is not configured on the backend.' : message,
      detail: message,
      readOnly: true,
      ownerOnly: true,
      inspection: kind,
      timestamp: nowIso(),
    }, status);
  }
}
