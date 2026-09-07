// Pure route data: route-contract tests must not boot Expo Router or native UI.
export const AUTONOMOUS_CONTROL_ROUTES = [
  { label: 'IVX IA', route: '/ivx/chat', icon: 'MessageCircle' },
  { label: 'Command', route: '/ivx/agent-command-center', icon: 'Bot' },
  { label: 'Control', route: '/ivx/autonomous-control', icon: 'Settings2' },
  { label: 'Live', route: '/ivx/autonomous-live', icon: 'RadioTower' },
  { label: 'Ops', route: '/ivx/autonomous-ops', icon: 'Activity' },
  { label: 'Ledger', route: '/ivx/agent-ledger', icon: 'ClipboardList' },
  { label: 'Diagnostics', route: '/ivx/auth-diagnostics', icon: 'Gauge' },
] as const;
