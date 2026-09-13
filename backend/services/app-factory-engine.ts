import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getWorkerPool } from './ivx-database-pools';

export const FACTORY_COMPONENTS = ['DATABASE', 'BACKEND', 'FRONTEND', 'QA'] as const;
type Component = typeof FACTORY_COMPONENTS[number];
export type FactorySubmission = {
  /** Reuse this full UUID for retries of the same logical build request. */
  requestId: string;
  /** Supplied by an authenticated owner-only server handler, never from a body claim. */
  ownerId: string;
  instructions: string;
};
type BuildRow = { request_id: string; request_hash: string; target_deadline: Date | string };
type TaskRow = { task_id: string; component_type: Component; state: string };
type FactoryPool = Pick<Pool, 'connect'>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DEPENDENCIES: Record<Component, Component[]> = {
  DATABASE: [], BACKEND: ['DATABASE'], FRONTEND: ['BACKEND'], QA: ['DATABASE', 'BACKEND', 'FRONTEND'],
};
function boundedText(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)) throw new Error(code);
  return normalized;
}
function deadlineIso(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('FACTORY_INVALID_DATABASE_DEADLINE');
  return date.toISOString();
}

/**
 * Registers a build plan only. It does not claim tasks, start provider calls,
 * provision an isolated database or certify an application. Pool lifecycle,
 * TLS and connection limits belong to the project's singleton pool manager.
 */
export class AppFactoryEngine {
  constructor(private readonly suppliedPool?: FactoryPool) {}

  async submitAppBuildTarget(appName: string, daysToComplete: number, input: FactorySubmission) {
    const name = boundedText(appName, 120, 'FACTORY_INVALID_APP_NAME');
    if (!Number.isInteger(daysToComplete) || daysToComplete < 10 || daysToComplete > 30) {
      throw new Error('FACTORY_INVALID_DELIVERY_DAYS');
    }
    if (!input || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) {
      throw new Error('FACTORY_INVALID_REQUEST_ID');
    }
    const requestId = input.requestId.toLowerCase();
    const ownerId = boundedText(input.ownerId, 200, 'FACTORY_INVALID_OWNER_ID');
    const instructions = boundedText(input.instructions, 12_000, 'FACTORY_INVALID_INSTRUCTIONS');
    const requestHash = createHash('sha256').update(JSON.stringify({
      version: 1, ownerId, appName: name, daysToComplete, instructions,
    })).digest('hex');
    const taskId = (component: Component) => `factory_${requestId}_${component.toLowerCase()}`;
    let client: PoolClient | undefined;
    let transactionStarted = false;
    let commitAttempted = false;
    let connectionFailed = false;
    let destroyClient = false;
    const onError = () => { connectionFailed = true; };
    try {
      const pool = this.suppliedPool ?? getWorkerPool(process.env, 'tasks');
      client = await pool.connect();
      client.on('error', onError);
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      transactionStarted = true;
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      const inserted = await client.query<BuildRow>(`
        INSERT INTO public.factory_build_requests
          (request_id, owner_id, app_name, days_to_complete, request_hash, target_deadline)
        VALUES ($1::uuid, $2, $3, $4::integer, $5, clock_timestamp() + $4::integer * interval '1 day')
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id, request_hash, target_deadline`,
      [requestId, ownerId, name, daysToComplete, requestHash]);
      const duplicate = inserted.rows.length === 0;
      // This second statement sees a concurrent committed winner under READ COMMITTED.
      const build = inserted.rows[0] ?? (await client.query<BuildRow>(`
        SELECT request_id, request_hash, target_deadline FROM public.factory_build_requests
        WHERE request_id=$1::uuid`, [requestId])).rows[0];
      if (!build || build.request_id !== requestId) throw new Error('FACTORY_REGISTRATION_INCOMPLETE');
      if (build.request_hash !== requestHash) throw new Error('FACTORY_REQUEST_CONFLICT');
      const targetDeadline = deadlineIso(build.target_deadline);
      if (!duplicate) {
        const rows = FACTORY_COMPONENTS.map(component => ({
          task_id: taskId(component), component_type: component,
          priority: component === 'DATABASE' ? 'critical' : 'high',
          payload: {
            target_deadline: targetDeadline, instructions, component,
            dependency_task_ids: DEPENDENCIES[component].map(taskId),
            workspace_key: `factory/${requestId}`,
            evidence: [],
          },
        }));
        const tasks = await client.query<TaskRow>(`
          INSERT INTO public.factory_tasks
            (task_id, request_id, app_name, component_type, priority, payload)
          SELECT task_id, $1::uuid, $2, component_type, priority, payload
          FROM jsonb_to_recordset($3::jsonb)
            AS t(task_id text, component_type text, priority text, payload jsonb)
          RETURNING task_id, component_type, state`, [requestId, name, JSON.stringify(rows)]);
        if (tasks.rows.length !== FACTORY_COMPONENTS.length) throw new Error('FACTORY_REGISTRATION_INCOMPLETE');
      }
      const observed = await client.query<TaskRow>(`
        SELECT task_id, component_type, state FROM public.factory_tasks
        WHERE request_id=$1::uuid`, [requestId]);
      if (observed.rows.length !== FACTORY_COMPONENTS.length
        || FACTORY_COMPONENTS.some(component => observed.rows.filter(row =>
          row.component_type === component && row.task_id === taskId(component)).length !== 1)) {
        throw new Error('FACTORY_REGISTRATION_INCOMPLETE');
      }
      if (connectionFailed) throw new Error('FACTORY_CONNECTION_LOST');
      commitAttempted = true;
      await client.query('COMMIT');
      transactionStarted = false;
      if (connectionFailed) throw new Error('FACTORY_CONNECTION_LOST');
      return {
        status: 'REGISTERED' as const, requestId, duplicate, targetDeadline,
        tasks: FACTORY_COMPONENTS.map(component => observed.rows.find(row => row.component_type === component)!),
        workersStarted: 0, applicationVerified: false,
      };
    } catch (error) {
      destroyClient = true;
      if (client && transactionStarted && !commitAttempted) await client.query('ROLLBACK').catch(() => {});
      if (commitAttempted) throw new Error('FACTORY_SUBMISSION_UNCONFIRMED_RETRY_SAME_REQUEST_ID');
      if (error instanceof Error && /^FACTORY_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('FACTORY_SUBMISSION_UNAVAILABLE_RETRY_SAME_REQUEST_ID');
    } finally {
      if (client) { client.release(destroyClient || connectionFailed); client.removeListener('error', onError); }
    }
  }
}
