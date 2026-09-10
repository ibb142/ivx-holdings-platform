import { describe, expect, test } from 'bun:test';
import { readLiveTelemetry } from '../lib/live-telemetry-request';

describe('live telemetry deadlines', () => {
  test('releases a stalled auth read so the dashboard can retry', async () => {
    const controller = new AbortController();
    await expect(readLiveTelemetry(() => new Promise(() => {}), controller, 10)).rejects.toThrow('Telemetry request');
    expect(controller.signal.aborted).toBe(true);
    expect(await readLiveTelemetry(async () => ({ agents: 112 }), new AbortController(), 100)).toEqual({ agents: 112 });
  });
  test('aborts transport and ignores a late success', async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const request = readLiveTelemetry(() => new Promise<string>(resolve => { finish = resolve; }), controller, 10);
    await expect(request).rejects.toThrow('Telemetry request');
    finish('stale response');
    expect(controller.signal.aborted).toBe(true);
  });
  test('preserves authentication failure without returning fake zero telemetry', async () => {
    await expect(readLiveTelemetry(async () => { throw new Error('Owner session required'); }, new AbortController())).rejects.toThrow('Owner session required');
  });
});
