import { describe, expect, it } from 'bun:test';
import { getDisasterEarlyWarningSnapshot } from './ivx-disaster-early-warning';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('IVX disaster early warning', () => {
  it('detects hurricane/tropical alerts and significant earthquakes', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('weather.gov')) {
        return jsonResponse({
          features: [
            {
              id: 'nws-1',
              properties: {
                event: 'Hurricane Warning',
                severity: 'Extreme',
                headline: 'Hurricane Warning issued',
                areaDesc: 'Example Coast',
                sent: '2026-08-26T20:00:00Z',
                effective: '2026-08-26T20:00:00Z',
              },
            },
          ],
        });
      }
      return jsonResponse({
        features: [
          {
            id: 'usgs-1',
            properties: {
              mag: 7.1,
              title: 'M 7.1 - Test earthquake',
              place: 'Test Region',
              time: Date.UTC(2026, 7, 26, 20, 0, 0),
              updated: Date.UTC(2026, 7, 26, 20, 1, 0),
              url: 'https://earthquake.usgs.gov/example',
            },
            geometry: { coordinates: [-80.1, 25.7, 10] },
          },
        ],
      });
    }) as typeof fetch;

    const snapshot = await getDisasterEarlyWarningSnapshot({ fetchImpl, timeoutMs: 1000 });

    expect(snapshot.ok).toBe(true);
    expect(snapshot.counts.hurricanes).toBe(1);
    expect(snapshot.counts.earthquakes).toBe(1);
    expect(snapshot.counts.total).toBe(2);
    expect(snapshot.alerts[0]?.severity).toBe('critical');
  });

  it('fails closed when an authoritative source is unavailable', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes('weather.gov')) {
        return new Response('unavailable', { status: 503 });
      }
      return jsonResponse({ features: [] });
    }) as typeof fetch;

    const snapshot = await getDisasterEarlyWarningSnapshot({ fetchImpl, timeoutMs: 1000 });

    expect(snapshot.ok).toBe(false);
    expect(snapshot.sourceHealth.nws).toBe(false);
    expect(snapshot.sourceHealth.usgs).toBe(true);
    expect(snapshot.errors.some((value) => value.includes('NWS'))).toBe(true);
  });
});
