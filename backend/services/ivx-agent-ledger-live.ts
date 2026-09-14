import { getObserverPool } from './ivx-database-pools';
import { AGENT_LEDGER_LIVE_SQL, buildAgentLedgerLiveSnapshot, type LiveAgentRow } from './ivx-agent-ledger-live-snapshot';

let pending: Promise<ReturnType<typeof buildAgentLedgerLiveSnapshot>> | null = null;

async function readSnapshot() {
  const result = await getObserverPool(process.env, 'telemetry').query<LiveAgentRow>(AGENT_LEDGER_LIVE_SQL);
  return buildAgentLedgerLiveSnapshot(result.rows);
}

/** Share overlapping authorized reads; never cache settled success or failure. */
export async function readAgentLedgerLive() {
  pending ??= readSnapshot().finally(() => { pending = null; });
  return structuredClone(await pending);
}
