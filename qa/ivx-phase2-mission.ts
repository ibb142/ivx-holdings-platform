export type Phase2Item = {
  id: string;
  phase: 2;
  workstream: string;
  scope: string;
  workerAgentNumber: number;
  commandAgentNumber: number;
  sourceHints: string[];
  doneRequiresEvidence: true;
  simulatedSuccessAllowed: false;
};

const DEFINITIONS = [
  ['P2-001','OWNER-AUTH','Owner sign-in/session/logout',['expo/app/sign-in.tsx','backend/api/owner-only.ts']],
  ['P2-002','PASSWORD','Forgot password/reset/login recovery',['expo/app/forgot-password.tsx','expo/app/reset-password.tsx']],
  ['P2-003','MEMBER-AUTH','Member signup/sign-in/verification',['expo/lib/member-service.ts','backend/api/ivx-members.ts']],
  ['P2-004','INVESTOR-KYC','Investor KYC flow',['expo/app','backend']],
  ['P2-005','DEALS','Marketplace/deals live data',['expo/app','backend/api']],
  ['P2-006','PORTFOLIO','Portfolio live data',['expo/app','backend/api']],
  ['P2-007','WALLET','Wallet live data',['expo/app','backend/api']],
  ['P2-008','SETTINGS','Profile/settings/account controls',['expo/app/settings.tsx','expo/app']],
  ['P2-009','NOTIFICATIONS','Notifications center',['expo/app','backend']],
  ['P2-010','MEMBER-SYNC','Member sync/persistence',['expo/lib/member-service.ts','backend/api/ivx-members.ts']],
  ['P2-011','SUPABASE','Supabase auth/DB/RLS dependencies',['backend/supabase','supabase']],
  ['P2-012','BACKEND-API','Backend/API dependencies',['backend/api','backend/services']],
] as const;

export const IVX_PHASE2_ITEMS: Phase2Item[] = DEFINITIONS.map(([id, workstream, scope, sourceHints], index) => ({
  id,
  phase: 2 as const,
  workstream,
  scope,
  workerAgentNumber: 13 + index,
  commandAgentNumber: 1 + (index % 12),
  sourceHints: [...sourceHints],
  doneRequiresEvidence: true as const,
  simulatedSuccessAllowed: false as const,
}));

export const IVX_PHASE2_SUMMARY = {
  totalItems: IVX_PHASE2_ITEMS.length,
  commandAgents: 12,
  workerFleet: 100,
  completionRule: 'No task is complete without durable real-execution evidence; simulated success is forbidden.',
} as const;
