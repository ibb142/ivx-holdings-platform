/**
 * Durable read-model for the Autonomous Operations Dashboard.
 * Reads the same Supabase persistence used by the 112-agent real-execution runtime,
 * so owner visibility survives app closure, process restarts, and redeploys.
 */
import {
  activeStoreMode,
  fetchAgentStates,
  resolveSupabaseBinding,
  type AgentStateRow,
  type ExecutionRow,
} from './ivx-agent-persistence';

export const IVX_AGENT_DASHBOARD_LEDGER_MARKER = 'ivx-agent-dashboard-ledger-2026-08-18';

type DashboardLedger = {
  ok: boolean;
  mode: string;
  states: AgentStateRow[];
  executions: ExecutionRow[];
  error: string | null;
};

function readTrimmed(v: unknown