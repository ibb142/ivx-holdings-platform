/**
 * IVX Production Migration Runner (owner-only).
 *
 *   GET  /api/ivx/autonomous/migrations      → migration history vs repo manifest
 *   POST /api/ivx/autonomous/migrations/run  → apply pending repo migrations
 *
 * Executes SQL against the production Supabase database through the
 * Supabase Management API (SUPABASE_ACCESS_TOKEN), the only migration
 * path available from the Render runtime (no direct DB connection string).
 *
 * History lives in supabase_migrations.schema_migrations
 * (version, name, checksum, statements_count, applied_at, applied_by).
 *
 * HONESTY RULES:
 *   - applied is true ONLY when the Management API returned 201 for the file.
 *   - checksum drift (repo file changed after apply) is reported, never hidden.
 *   - Every response carries the exact HTTP status of the live SQL call.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertIVXOwnerOnly, assertIVXRegisteredOwnerBearer, IVXOwnerApprovalError, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const IVX_MIGRATION_RUNNER_MARKER = 'ivx-migration-runner-2026-07-17';

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';
const SQL_TIMEOUT_MS = 45_000;
const FALLBACK_PROJECT_REF = 'kvclcdjmjghndxsngfzb';

/**
 * Ordered migration manifest. Versions are stable identifiers recorded in
 * supabase_migrations.schema_migrations; paths are repo-relative.
 * Applied 2026-07-17 during the Phase 1 recovery run; the runner keeps the
 * production history in sync with this list on every /run call.
 */
const MIGRATION_MANIFEST: ReadonlyArray<{ version: string; file: string }> = [
  { version: '20260717000001', file: 'expo/scripts/supabase-full-schema.sql' },
  { version: '20260717000002', file: 'expo/supabase/ivx-owner-ai-phase1.sql' },
  { version: '20260717000003', file: 'expo/supabase/FIX-owner-ai-chat-persistence.sql' },
  { version: '20260717000004', file: 'expo/supabase/ivx-access-tests-and-commands.sql' },
  { version: '20260717000005', file: 'expo/supabase/ivx-member-picture-url.sql' },
  { version: '20260717000006', file: 'expo/supabase/ivx-owner-room-dedupe.sql' },
  { version: '20260717000007', file: 'expo/supabase/ivx-intent-capture-engine.sql' },
  { version: '20260717000008', file: 'expo/supabase/ivx-zero-data-loss-migration.sql' },
  { version: '20260717000009', file: 'expo/supabase/IVX-ENTERPRISE-DB-OPTIMIZATION.sql' },
  { version: '20260717000010', file: 'expo/supabase/ivx-investor-protection-system.sql' },
  { version: '20260717000011', file: 'expo/supabase/IVX-FINAL-QA-FIX-2026-07-14.sql' },
];

const HISTORY_BOOTSTRAP_SQL = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  statements_count int,
  applied_at timestamptz not null default now(),
  applied_by text not null default 'ivx-migration-runner'
);
`;

export type MigrationRowStatus = 'applied' | 'pending' | 'checksum_drift' | 'file_missing';

export type MigrationRow = {
  version: string;
  file: string;
  repoChecksum: string | null;
  appliedChecksum: string | null;
  appliedAt: string | null;
  status: MigrationRowStatus;
};

type HistoryRecord = {
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
};

type SqlResult = {
  status: number | null;
  body: string;
  error: string | null;
};

function managementToken(): string {
  return (process.env.SUPABASE_ACCESS_TOKEN ?? '').trim();
}

function projectRef(): string {
  const sources = [process.env.IVX_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL];
  for (const raw of sources) {
    const match = (raw ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (match) return match[1];
  }
  return FALLBACK_PROJECT_REF;
}

async function runSql(query: string): Promise<SqlResult> {
  const token = managementToken();
  if (!token) {
    return { status: null, body: '', error: 'SUPABASE_ACCESS_TOKEN is not injected into this runtime.' };
  }
  try {
    const response = await fetch(`${MANAGEMENT_API_BASE}/projects/${projectRef()}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
    });
    const body = await response.text();
    return { status: response.status, body: body.slice(0, 4000), error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: null, body: '', error: message.slice(0, 300) };
  }
}

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function readRepoMigration(file: string): Promise<{ sql: string; checksum: string } | null> {
  try {
    const sql = await readFile(path.join(process.cwd(), file), 'utf8');
    return { sql, checksum: md5(sql) };
  } catch {
    return null;
  }
}

async function loadHistory(): Promise<{ records: Map<string, HistoryRecord>; bootstrapStatus: number | null; error: string | null }> {
  const bootstrap = await runSql(HISTORY_BOOTSTRAP_SQL);
  if (bootstrap.status !== 201) {
    return { records: new Map(), bootstrapStatus: bootstrap.status, error: bootstrap.error ?? bootstrap.body.slice(0, 300) };
  }
  const select = await runSql('select version, name, checksum, applied_at from supabase_migrations.schema_migrations order by version');
  const records = new Map<string, HistoryRecord>();
  if (select.status === 201) {
    try {
      const rows = JSON.parse(select.body) as HistoryRecord[];
      for (const row of rows) records.set(row.version, row);
    } catch {
      /* empty result body — keep empty map */
    }
  }
  return { records, bootstrapStatus: bootstrap.status, error: null };
}

async function buildStatusRows(records: Map<string, HistoryRecord>): Promise<MigrationRow[]> {
  const rows: MigrationRow[] = [];
  for (const entry of MIGRATION_MANIFEST) {
    const repo = await readRepoMigration(entry.file);
    const history = records.get(entry.version) ?? null;
    let status: MigrationRowStatus;
    if (!repo) status = 'file_missing';
    else if (!history) status = 'pending';
    else if (history.checksum !== repo.checksum) status = 'checksum_drift';
    else status = 'applied';
    rows.push({
      version: entry.version,
      file: entry.file,
      repoChecksum: repo?.checksum ?? null,
      appliedChecksum: history?.checksum ?? null,
      appliedAt: history?.applied_at ?? null,
      status,
    });
  }
  return rows;
}

/**
 * Lightweight migration summary for the QA scheduler's 2-hour owner report.
 * Returns null when the Management API is unreachable — the caller reports
 * that honestly instead of showing a stale green.
 */
export async function getMigrationSummary(): Promise<{ total: number; applied: number; pending: number; drifted: number } | null> {
  const { records, error } = await loadHistory();
  if (error) return null;
  const rows = await buildStatusRows(records);
  return {
    total: rows.length,
    applied: rows.filter((row) => row.status === 'applied').length,
    pending: rows.filter((row) => row.status === 'pending' || row.status === 'file_missing').length,
    drifted: rows.filter((row) => row.status === 'checksum_drift').length,
  };
}

export function migrationRunnerOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleMigrationStatusGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const { records, bootstrapStatus, error } = await loadHistory();
  if (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_MIGRATION_RUNNER_MARKER, blocker: `history bootstrap failed (HTTP ${bootstrapStatus ?? 'ERR'}): ${error}` }, 502);
  }
  const rows = await buildStatusRows(records);
  return ownerOnlyJson({
    ok: true,
    marker: IVX_MIGRATION_RUNNER_MARKER,
    projectRef: projectRef(),
    generatedAt: new Date().toISOString(),
    totals: {
      total: rows.length,
      applied: rows.filter((row) => row.status === 'applied').length,
      pending: rows.filter((row) => row.status === 'pending').length,
      drifted: rows.filter((row) => row.status === 'checksum_drift').length,
      missing: rows.filter((row) => row.status === 'file_missing').length,
    },
    migrations: rows,
  });
}

export async function handleMigrationRunPost(request: Request): Promise<Response> {
  try {
    await assertIVXRegisteredOwnerBearer(request, 'run-production-migrations');
  } catch (error: unknown) {
    if (error instanceof IVXOwnerApprovalError) {
      return ownerOnlyJson({ ok: false, error: error.message, approval: error.proof }, error.status);
    }
    const message = error instanceof Error ? error.message : 'Owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const { records, bootstrapStatus, error } = await loadHistory();
  if (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_MIGRATION_RUNNER_MARKER, blocker: `history bootstrap failed (HTTP ${bootstrapStatus ?? 'ERR'}): ${error}` }, 502);
  }

  const results: Array<{ version: string; file: string; action: string; httpStatus: number | null; detail: string | null }> = [];
  for (const entry of MIGRATION_MANIFEST) {
    const repo = await readRepoMigration(entry.file);
    if (!repo) {
      results.push({ version: entry.version, file: entry.file, action: 'skipped_file_missing', httpStatus: null, detail: null });
      continue;
    }
    const history = records.get(entry.version);
    if (history && history.checksum === repo.checksum) {
      results.push({ version: entry.version, file: entry.file, action: 'already_applied', httpStatus: null, detail: `applied_at ${history.applied_at}` });
      continue;
    }
    const apply = await runSql(repo.sql);
    if (apply.status !== 201) {
      results.push({ version: entry.version, file: entry.file, action: 'apply_failed', httpStatus: apply.status, detail: (apply.error ?? apply.body).slice(0, 400) });
      continue;
    }
    const record = await runSql(
      `insert into supabase_migrations.schema_migrations(version, name, checksum, statements_count) values (${sqlLiteral(entry.version)}, ${sqlLiteral(path.basename(entry.file))}, ${sqlLiteral(repo.checksum)}, ${repo.sql.split(';').length - 1}) on conflict (version) do update set checksum = excluded.checksum, applied_at = now()`,
    );
    results.push({
      version: entry.version,
      file: entry.file,
      action: history ? 'reapplied_after_drift' : 'applied',
      httpStatus: apply.status,
      detail: record.status === 201 ? 'history recorded' : `history record failed (HTTP ${record.status ?? 'ERR'})`,
    });
  }

  const failed = results.filter((row) => row.action === 'apply_failed').length;
  return ownerOnlyJson({
    ok: failed === 0,
    marker: IVX_MIGRATION_RUNNER_MARKER,
    projectRef: projectRef(),
    ranAt: new Date().toISOString(),
    totals: {
      total: results.length,
      applied: results.filter((row) => row.action === 'applied' || row.action === 'reapplied_after_drift').length,
      alreadyApplied: results.filter((row) => row.action === 'already_applied').length,
      failed,
    },
    results,
  }, failed === 0 ? 200 : 502);
}