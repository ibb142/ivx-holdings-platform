import { describe, expect, it } from 'bun:test';
import { buildRealtimeRuntimeChannelName } from '@/hooks/useRealtimeChannel';

describe('Supabase realtime runtime channel isolation', () => {
  it('does not reuse a topic across mounted hook instances', () => {
    expect(buildRealtimeRuntimeChannelName('rt-notifications', 'i1', 1))
      .not.toBe(buildRealtimeRuntimeChannelName('rt-notifications', 'i2', 1));
  });

  it('does not reuse a topic on reconnect for the same mounted hook', () => {
    expect(buildRealtimeRuntimeChannelName('rt-notifications', 'i1', 1))
      .not.toBe(buildRealtimeRuntimeChannelName('rt-notifications', 'i1', 2));
  });

  it('keeps the logical source visible in the runtime topic', () => {
    expect(buildRealtimeRuntimeChannelName('rt-notifications', 'i7', 3))
      .toBe('rt-notifications-i7-g3');
  });
});
