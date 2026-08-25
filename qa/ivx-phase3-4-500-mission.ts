// IVX Phase 3 + Phase 4 canonical completion mission.
// 25 real IVX workstreams x 20 evidence gates = exactly 500 executable backlog items.
// Agents 001-012 are command/review; agents 013-112 are the 100 execution workers.

export const IVX_PHASE34_MISSION_MARKER = 'ivx-phase3-4-500-112-agent-mission-2026-08-25-v1';

export const WORKSTREAMS = [
  ['APP-SHELL','Expo Router app shell, boot, providers, navigation, deep links'],
  ['HOME','Home feed, home icon, black-screen prevention, loading/error states'],
  ['OWNER-AUTH','Owner sign-in, session restore, authorization boundary, logout'],
  ['PASSWORD','Forgot password, reset email, new password, login recovery'],
  ['MEMBER-AUTH','Member signup/sign-in, email verification, role selection'],
  ['MEMBER-SYNC','Member counts, profile sync, Android/iOS parity, persistence'],
  ['INVESTOR-KYC','Investor onboarding, KYC fields, documents, status handling'],
  ['DEALS','Investment/JV/tokenized deal cards, ordering, details, data integrity'],
  ['MEDIA','Images, video, upload, preview, fallback, size/type/error handling'],
  ['REELS','Reels feed, playback, scroll, like/comment/share/save, duplicate control'],
  ['OWNER-CHAT','IVX IA owner chat, history, search, persistence, composer, media'],
  ['PUBLIC-CHAT','Public investor chat, safety, fallback, escalation, session handling'],
  ['CRM','Investor/buyer/JV CRM capture, attribution, duplicate handling, pipeline'],
  ['ADMIN','Owner Controls, Admin Hub, dashboards, diagnostics, permissions'],
  ['REVENUE-FEES','Revenue, fees, financial display, calculations, access control'],
  ['PROPERTIES','Properties, portfolio data, media, status, owner management'],
  ['TEAM-USERS','Team management, users/investors, broker/agent roles, permissions'],
  ['SETTINGS','Settings, MFA/biometrics preferences, notifications, account controls'],
  ['SUPABASE','Supabase auth, DB schema, RLS, storage, realtime, error recovery'],
  ['BACKEND-API','Backend routes, validation, timeouts, retries, idempotency, contracts'],
  ['AUTONOMOUS','Autonomous control plane, Senior Developer Worker, owner gates, evidence'],
  ['SECURITY','Secrets, authz, input sanitization, PII, rate limits, security headers'],
  ['PERFORMANCE','Startup, rendering, memory, network, caching, responsiveness'],
  ['ANDROID-RELEASE','Android build, package/version, signing, APK install/launch'],
  ['PROD-CERT','Render/AWS/Supabase live parity, health/version exact SHA, final certificate'],
] as const;

export const EVIDENCE_GATES = [
  'Audit current implementation and record exact source reference',
  'Reproduce current behavior on the supported user path',
  'Validate navigation and state transitions',
  'Validate empty state',
  'Validate loading state',
  'Validate success state',
  'Validate recoverable error state',
  'Validate timeout/retry behavior',
  'Validate duplicate action/idempotency behavior',
  'Validate persistence after app reload/restart',
  'Validate authentication/authorization boundary',
  'Validate API/database contract and truthful data sync',
  'Validate mobile layout, keyboard, touch targets and orientation',
  'Validate accessibility semantics and focus behavior',
  'Validate performance/no visible freeze/no crash',
  'Validate privacy/security/no secret or PII leakage',
  'Run focused automated tests and require PASS',
  'Run typecheck/lint/build gate applicable to changed scope',
  'Require PR/CI/merge/deploy evidence for any code change',
  'Phase 4: verify live exact-main-SHA behavior and attach durable PASS evidence',
] as const;

export type Phase34Item = {
  id: string;
  ordinal: number;
  phase: '3+4';
  workstream: string;
  scope: string;
  gate: string;
  workerAgentNumber: number;
  commandAgentNumber: number;
  severityDefault: 'P1';
  doneRequiresEvidence: true;
  simulatedSuccessAllowed: false;
};

export const IVX_PHASE34_500_ITEMS: Phase34Item[] = WORKSTREAMS.flatMap(([workstream, scope], streamIndex) =>
  EVIDENCE_GATES.map((gate, gateIndex) => {
    const ordinal = streamIndex * EVIDENCE_GATES.length + gateIndex + 1;
    return {
      id: `P34-${String(ordinal).padStart(3, '0')}`,
      ordinal,
      phase: '3+4' as const,
      workstream,
      scope,
      gate,
      workerAgentNumber: 13 + ((ordinal - 1) % 100),
      commandAgentNumber: 1 + ((ordinal - 1) % 12),
      severityDefault: 'P1' as const,
      doneRequiresEvidence: true as const,
      simulatedSuccessAllowed: false as const,
    };
  }),
);

if (IVX_PHASE34_500_ITEMS.length !== 500) {
  throw new Error(`Phase 3+4 invariant violated: expected 500 items, got ${IVX_PHASE34_500_ITEMS.length}`);
}
if (new Set(IVX_PHASE34_500_ITEMS.map((x) => x.id)).size !== 500) {
  throw new Error('Phase 3+4 invariant violated: item IDs must be unique.');
}
if (IVX_PHASE34_500_ITEMS.some((x) => x.workerAgentNumber < 13 || x.workerAgentNumber > 112)) {
  throw new Error('Phase 3+4 invariant violated: worker assignment must stay inside agents 013-112.');
}
if (IVX_PHASE34_500_ITEMS.some((x) => x.commandAgentNumber < 1 || x.commandAgentNumber > 12)) {
  throw new Error('Phase 3+4 invariant violated: command assignment must stay inside agents 001-012.');
}

export const IVX_PHASE34_SUMMARY = {
  marker: IVX_PHASE34_MISSION_MARKER,
  phasesSynced: [3, 4],
  totalItems: IVX_PHASE34_500_ITEMS.length,
  commandAgents: 12,
  workerAgents: 100,
  totalAgentsInMission: 112,
  allocation: 'P34 items round-robin across IA-013..IA-112; independent command/review round-robin across IA-001..IA-012',
  completionRule: 'No item is DONE until its Phase 4 live/evidence gate is satisfied; no simulated success counts.',
} as const;
