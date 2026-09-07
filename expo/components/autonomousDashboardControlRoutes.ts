export type AutonomousControlIconKey =
  | 'message'
  | 'bot'
  | 'settings'
  | 'radio'
  | 'activity'
  | 'clipboard'
  | 'gauge';

export const AUTONOMOUS_CONTROL_ROUTES = [
  { label: 'IVX IA', route: '/ivx/chat', icon: 'message' },
  { label: 'Command', route: '/ivx/agent-command-center', icon: 'bot' },
  { label: 'Control', route: '/ivx/autonomous-control', icon: 'settings' },
  { label: 'Live', route: '/ivx/autonomous-live', icon: 'radio' },
  { label: 'Ops', route: '/ivx/autonomous-ops', icon: 'activity' },
  { label: 'Ledger', route: '/ivx/agent-ledger', icon: 'clipboard' },
  { label: 'Diagnostics', route: '/ivx/auth-diagnostics', icon: 'gauge' },
] as const satisfies ReadonlyArray<{
  label: string;
  route: string;
  icon: AutonomousControlIconKey;
}>;
