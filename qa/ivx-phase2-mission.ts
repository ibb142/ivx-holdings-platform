// IVX Phase 2 canonical mission source — member-facing platform completion.
// 12 real Phase 2 workstreams x 10 evidence gates = exactly 120 executable items.
// Agents 001-012 are command/review; agents 013-112 are the 100 execution workers.

export const IVX_PHASE2_MISSION_MARKER = 'ivx-phase2-120-item-mission-2026-08-25-v1';

export const PHASE2_WORKSTREAMS = [
  ['OWNER-AUTH', 'Owner sign-in, session restore, authorization boundary, logout'],
  ['MEMBER-AUTH', 'Member signup/sign-in, email verification, role selection'],
  ['PASSWORD-RECOVERY', 'Forgot password, reset email, new password, login recovery'],
  ['INVESTOR-KYC', 'Investor onboarding, KYC fields, documents, status handling'],
  ['MARKETPLACE-DEALS', 'Marketplace deal cards, ordering, details, data integrity'],
  ['PORTFOLIO', 'Investor portfolio holdings, valuations, performance display'],
  ['WALLET', 'Wallet balance, transactions, ledger entries, statement history'],
  ['PROFILE-SETTINGS', 'Profile editing, preferences, account controls, data export'],
  ['NOTIFICATIONS', 'Push and in-app notifications, preferences, delivery reliability'],
  ['MEMBER-SYNC', 'Member counts, profile sync, Android/iOS parity, persistence'],
  ['SUPABASE-DEPS', 'Supabase auth, DB schema, RLS, storage, realtime, error recovery'],
  ['BACKEND-API-DEPS', 'Backend routes, validation, timeouts, retries, idempotency, contracts'],
] as const;

export const PHASE2_EVIDENCE_GATES = [
  'Audit current implementation and record exact source reference',
  'Reproduce the current behavior on the supported user path',
  'Validate authentication/authorization boundary',
  'Validate API/database contract and truthful data sync',
  'Validate recoverable error state and timeout/retry behavior',
  'Validate persistence after app reload/restart',
  'Validate empty and loading states',
  'Run focused automated tests and require PASS',
  'Run typecheck/lint/build gate applicable to changed scope',
  'Attach durable PASS evidence for the completed user journey',
] as const;

export type Phase2Item = {
  id: string;
  ordinal: number;
  phase: '2';
  workstream: string;
  scope: string;
  gate: string;
  workerAgentNumber: number;
  commandAgentNumber: number;
  evidenceRequirement: string;
  simulatedSuccessAllowed: false;
};

export const IVX_PHASE2_120_ITEMS: Phase2Item[] = PHASE2_WORKSTREAMS.flatMap(([workstream, scope], streamIndex) =>
  PHASE2_EVIDENCE_GATES.map((gate, gateIndex) => {
    const ordinal = streamIndex * PHASE2_EVIDENCE_GATES.length + gateIndex + 1;
    return {
      id: `P2-${String(ordinal).padStart(3, '0')}`,
      ordinal,
      phase: '2' as const,
      workstream,
      scope,
      gate,
      workerAgentNumber: 13 + ((ordinal - 1) % 100),
      commandAgentNumber: 1 + ((ordinal - 1) % 12),
      evidenceRequirement: `Durable evidence (ok + sourceReference + contentSha256) recorded at runtime for ${workstream} gate "${gate}"`,
      simulatedSuccessAllowed: false as const,
    };
  }),
);

if (IVX_PHASE2_120_ITEMS.length !== 120) {
  throw new Error(`Phase 2 invariant violated: expected 120 items, got ${IVX_PHASE2_120_ITEMS.length}`);
}
if (new Set(IVX_PHASE2_120_ITEMS.map((x) => x.id)).size !== 120) {
  throw new Error('Phase 2 invariant violated: item IDs must be unique.');
}
if (IVX_PHASE2_120_ITEMS.some((x) => x.workerAgentNumber < 13 || x.workerAgentNumber > 112)) {
  throw new Error('Phase 2 invariant violated: worker assignment must stay inside agents 013-112.');
}
if (IVX_PHASE2_120_ITEMS.some((x) => x.commandAgentNumber < 1 || x.commandAgentNumber > 12)) {
  throw new Error('Phase 2 invariant violated: command assignment must stay inside agents 001-012.');
}
if (IVX_PHASE2_120_ITEMS.some((x) => x.simulatedSuccessAllowed !== false)) {
  throw new Error('Phase 2 invariant violated: simulated success is never allowed.');
}

export const IVX_PHASE2_SUMMARY = {
  marker: IVX_PHASE2_MISSION_MARKER,
  phase: 2,
  totalItems: IVX_PHASE2_120_ITEMS.length,
  workstreams: PHASE2_WORKSTREAMS.length,
  gates: PHASE2_EVIDENCE_GATES.length,
  commandAgents: 12,
  workerAgents: 100,
  allocation: 'P2 items round-robin across IA-013..IA-112; command/review round-robin across IA-001..IA-012',
  completionRule: 'No item is DONE until its evidence requirement is satisfied; no simulated success counts.',
} as const;
