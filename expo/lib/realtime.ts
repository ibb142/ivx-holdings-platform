// Legacy import compatibility.
// Keep a single realtime implementation so notifications/wallet/email/etc.
// cannot create conflicting Supabase topics through two different hook stacks.
export {
  useRealtimeChannel,
  useRealtimeTable,
  buildRealtimeConfigSignature,
  buildRealtimeRuntimeChannelName,
} from '@/hooks/useRealtimeChannel';
export type {
  RealtimeChannelConfig,
  RealtimeChannelState,
  RealtimeEvent,
  RealtimeStatus,
} from '@/hooks/useRealtimeChannel';
