import type { Task, TaskEvidence } from './ivx-autonomous-task-engine';
import { createHash } from 'node:crypto';
import { decodeLandingResult, resolveProductionSha } from './ivx-landing-p0-backlog';
import { insertAlert, type AlertRow } from './ivx-agent-persistence';
import { readPostgresFleetSloTasks, persistPostgresFleetSloSample, postgresAtomicQueueConfigured } from './ivx-postgres-autonomous-task-store';
import { IVX_RETRY_POLICY_MARKER } from './ivx-retry-policy';

export const IVX_FLEET_SLO_MARKER = 'ivx-fleet-slo-2026-09-08-v1';
export const FLEET_SLO_TARGET = 112;
export const FLEET_SLO_INTERVAL_MS = 15_000;
export const FLEET_EVIDENCE_WINDOW_MS = 5 * 60_000;
const HEARTBEAT_FRESH_MS = 60_000;
const ALERT_REMINDER_MS = 5 * 60_000;

export type FleetSloSnapshot = {
  marker: string; retry_policy: string; measured_at: string; commit_sha: string;
  status: 'MET' | 'BREACH' | 'UNKNOWN'; target_agents: number;
  productive_agents: number | null; productive_deficit: number | null;
  running_agents: number | null; leased_agents: number | null; heartbeat_agents: number | null;
  retry_waiting_tasks: number | null; evidence_window_seconds: number;
  productivity_ratio: number | null; durable: boolean; error: string | null;
  failure_stage?: 'read' | 'build' | 'persist';
  failure_kind?: 'timeout' | 'authorization' | 'upstream' | 'unknown';
};

function fresh(value: string | null | undefined, now: number, window: number): boolean {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= window;
}

/** Only a successful structured tool result can substantiate productivity. */
export function successfulEvidence(evidence: TaskEvidence, agent: number, sha: string, now: number): boolean {
  if (!/^[a-f0-9]{64}$/i.test(evidence.contentHash ?? '') || !evidence.source
    || !fresh(evidence.createdAt, now, FLEET_EVIDENCE_WINDOW_MS)) return false;
  if (createHash('sha256').update(evidence.summary).digest('hex') !== evidence.contentHash) return false;
  const record = decodeLandingResult(evidence.summary ?? '');
  if (!record || record.status !== 'PASS' || record.agent_number !== agent || record.production_sha !== sha
    || evidence.commitSha !== sha || !(record.productive_seconds > 0)
    || !fresh(record.completed_at, now, FLEET_EVIDENCE_WINDOW_MS)
    || !(Date.parse(record.started_at) < Date.parse(record.completed_at))
    || !(record.api_checks > 0 || record.browser_checks > 0)
    || !Array.isArray(record.evidence) || record.evidence.length === 0) return false;
  return true;
}

/** The dashboard and the SLO use exactly the same evidence predicate. */
export function fleetTaskSignals(task: Task, now: number, sha: string) {
  const agentNumber = Number(/^agent:ivx_holdings_(\d+)$/.exec(task.leaseHolder ?? '')?.[1]);
  const activeLease = Number.isInteger(agentNumber) && agentNumber >= 1 && agentNumber <= FLEET_SLO_TARGET
    && Date.parse(task.leaseExpiresAt ?? '') > now;
  const heartbeatFresh = activeLease && fresh(task.lastHeartbeatAt, now, HEARTBEAT_FRESH_MS);
  const running = activeLease && task.state === 'RUNNING';
  const latest = [...(task.evidence ?? [])].filter(e => e.summary?.startsWith('LANDING_P0_RESULT '))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const evidence = running && heartbeatFresh && latest && successfulEvidence(latest, agentNumber, sha, now) ? latest : null;
  return { agentNumber, activeLease, heartbeatFresh, running, evidence };
}

export function buildFleetSloSnapshot(tasks: readonly Task[], now = Date.now(), sha = resolveProductionSha()): FleetSloSnapshot {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Production SHA unavailable');
  const running = new Set<number>();
  const leased = new Set<number>();
  const heartbeats = new Set<number>();
  const productive = new Set<number>();
  for (const task of tasks) {
    // Work stealing can differ from assignment. Attribute to the actual holder.
    const { agentNumber: agent, activeLease, heartbeatFresh: heartbeat, evidence } = fleetTaskSignals(task, now, sha);
    if (heartbeat) heartbeats.add(agent);
    if (!activeLease) continue;
    if (task.state === 'LEASED') leased.add(agent);
    if (task.state !== 'RUNNING') continue;
    running.add(agent);
    if (evidence) productive.add(agent);
  }
  return {
    marker: IVX_FLEET_SLO_MARKER, retry_policy: IVX_RETRY_POLICY_MARKER,
    measured_at: new Date(now).toISOString(), commit_sha: sha,
    status: productive.size >= FLEET_SLO_TARGET ? 'MET' : 'BREACH', target_agents: FLEET_SLO_TARGET,
    productive_agents: productive.size, productive_deficit: Math.max(0, FLEET_SLO_TARGET - productive.size),
    running_agents: running.size, leased_agents: leased.size, heartbeat_agents: heartbeats.size,
    retry_waiting_tasks: tasks.filter((task) => task.state === 'RETRYING').length,
    evidence_window_seconds: FLEET_EVIDENCE_WINDOW_MS / 1_000,
    productivity_ratio: productive.size / FLEET_SLO_TARGET, durable: false, error: null,
  };
}

type Dependencies = {
  read: () => Promise<Task[]>;
  persist: (sample: Record<string, unknown>) => Promise<void>;
  alert: (alert: AlertRow) => Promise<{ ok: boolean; error?: string | null }>;
  now: () => number; sha: () => string;
};

/** One in-flight sample; failed delivery never consumes alert suppression. */
export class FleetSloMonitor {
  private latest: FleetSloSnapshot | null = null;
  private inFlight: Promise<FleetSloSnapshot> | null = null;
  private deliveredStatus: FleetSloSnapshot['status'] | null = null;
  private deliveredAt = 0;
  constructor(private readonly deps: Dependencies) {}
  snapshot(): FleetSloSnapshot | null {
    if (!this.latest) return null;
    if (!fresh(this.latest.measured_at, this.deps.now(), HEARTBEAT_FRESH_MS)) {
      return { ...this.latest, status: 'UNKNOWN', productive_agents: null, productive_deficit: null, productivity_ratio: null, error: 'SLO sample is stale' };
    }
    return { ...this.latest };
  }
  sample(): Promise<FleetSloSnapshot> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collect().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async collect(): Promise<FleetSloSnapshot> {
    let snapshot: FleetSloSnapshot;
    let stage: 'read' | 'build' | 'persist' = 'read';
    try {
      const tasks = await this.deps.read();
      stage = 'build';
      snapshot = buildFleetSloSnapshot(tasks, this.deps.now(), this.deps.sha());
      stage = 'persist';
      await this.deps.persist({ ...snapshot, durable: true });
      snapshot.durable = true;
    } catch (error) {
      // Classify locally; never copy credentials or raw upstream responses into telemetry.
      const message = error instanceof Error ? error.message : String(error);
      const kind = /timeout|timed out|time budget|aborted/i.test(message) ? 'timeout'
        : /HTTP (401|403)/i.test(message) ? 'authorization'
        : /HTTP 5\d\d/i.test(message) ? 'upstream' : 'unknown';
      snapshot = {
        marker: IVX_FLEET_SLO_MARKER, retry_policy: IVX_RETRY_POLICY_MARKER,
        measured_at: new Date(this.deps.now()).toISOString(), commit_sha: this.deps.sha(),
        failure_stage: stage, failure_kind: kind,
        status: 'UNKNOWN', target_agents: FLEET_SLO_TARGET,
        productive_agents: null, productive_deficit: null, running_agents: null, leased_agents: null,
        heartbeat_agents: null, retry_waiting_tasks: null, evidence_window_seconds: FLEET_EVIDENCE_WINDOW_MS / 1_000,
        productivity_ratio: null, durable: false, error: 'Fleet evidence could not be read or persisted',
      };
      console.error('[IVX Fleet SLO] telemetry unavailable', { marker: IVX_FLEET_SLO_MARKER, measured_at: snapshot.measured_at, failure_stage: stage, failure_kind: kind });
    }
    this.latest = snapshot;
    const now = this.deps.now();
    const changed = snapshot.status !== this.deliveredStatus;
    const needsAlert = snapshot.status === 'MET'
      ? this.deliveredStatus !== null && changed
      : changed || now - this.deliveredAt >= ALERT_REMINDER_MS;
    if (needsAlert) {
      const alert: AlertRow = {
        alert_type: snapshot.status === 'MET' ? 'fleet_productivity_recovered' : snapshot.status === 'UNKNOWN' ? 'fleet_telemetry_missing' : 'fleet_productivity_breach',
        agent_id: null, severity: snapshot.status === 'MET' ? 'info' : 'critical',
        detail: JSON.stringify(snapshot),
      };
      try {
        const result = await this.deps.alert(alert);
        if (!result.ok) throw new Error('Alert persistence rejected');
        this.deliveredStatus = snapshot.status;
        this.deliveredAt = now;
      } catch { console.error('[IVX Fleet SLO] alert delivery failed; retry on next sample', { alert_type: alert.alert_type }); }
    }
    return { ...snapshot };
  }
}

const monitor = new FleetSloMonitor({
  read: async () => {
    if (!postgresAtomicQueueConfigured()) throw new Error('Durable fleet telemetry unavailable');
    return readPostgresFleetSloTasks();
  },
  persist: persistPostgresFleetSloSample, alert: insertAlert, now: Date.now, sha: resolveProductionSha,
});
let timer: ReturnType<typeof setInterval> | null = null;
export function startFleetSloMonitor(): boolean {
  if (timer) return true;
  const tick = () => { void monitor.sample().catch(() => console.error('[IVX Fleet SLO] sampling failed')); };
  tick();
  timer = setInterval(tick, FLEET_SLO_INTERVAL_MS);
  timer.unref?.();
  return true;
}
export function getFleetSloSnapshot(): FleetSloSnapshot | null { return monitor.snapshot(); }

export function fleetSloPrometheus(snapshot: FleetSloSnapshot): string {
  const fields = ['productive_agents', 'productive_deficit', 'running_agents', 'leased_agents', 'heartbeat_agents', 'retry_waiting_tasks', 'productivity_ratio', 'target_agents', 'evidence_window_seconds'] as const;
  return [
    ...fields.flatMap((field) => [`# TYPE ivx_fleet_${field} gauge`, `ivx_fleet_${field} ${snapshot[field] ?? 'NaN'}`]),
    '# TYPE ivx_fleet_telemetry_available gauge', `ivx_fleet_telemetry_available ${snapshot.status === 'UNKNOWN' ? 0 : 1}`,
    '# TYPE ivx_fleet_slo_met gauge', `ivx_fleet_slo_met ${snapshot.status === 'MET' ? 1 : 0}`,
    '# TYPE ivx_fleet_sample_timestamp_seconds gauge', `ivx_fleet_sample_timestamp_seconds ${Date.parse(snapshot.measured_at) / 1_000}`,
    '',
  ].join('\n');
}
