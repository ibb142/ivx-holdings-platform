export type HazardSeverity = 'info' | 'watch' | 'warning' | 'critical';

export interface HazardAlert {
  id: string;
  type: 'hurricane' | 'earthquake';
  severity: HazardSeverity;
  title: string;
  area: string | null;
  issuedAt: string | null;
  updatedAt: string | null;
  source: 'NWS' | 'USGS';
  sourceUrl: string;
  magnitude?: number;
  latitude?: number;
  longitude?: number;
}

export interface DisasterEarlyWarningSnapshot {
  ok: boolean;
  checkedAt: string;
  sourceHealth: {
    nws: boolean;
    usgs: boolean;
  };
  counts: {
    hurricanes: number;
    earthquakes: number;
    total: number;
  };
  alerts: HazardAlert[];
  errors: string[];
}

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const USGS_EARTHQUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson';
const DEFAULT_TIMEOUT_MS = 8_000;

function severityFromNws(value: unknown): HazardSeverity {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'extreme') return 'critical';
  if (normalized === 'severe') return 'warning';
  if (normalized === 'moderate') return 'watch';
  return 'info';
}

function severityFromMagnitude(magnitude: number): HazardSeverity {
  if (magnitude >= 7) return 'critical';
  if (magnitude >= 6) return 'warning';
  if (magnitude >= 5) return 'watch';
  return 'info';
}

function isHurricaneEvent(event: unknown): boolean {
  const text = String(event ?? '').toLowerCase();
  return text.includes('hurricane') || text.includes('tropical storm') || text.includes('storm surge');
}

async function fetchJson(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        'Accept': 'application/geo+json, application/json',
        'User-Agent': 'IVX-Holdings-Early-Warning/1.0 (operations@ivxholding.com)',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getDisasterEarlyWarningSnapshot(options: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<DisasterEarlyWarningSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = new Date().toISOString();
  const alerts: HazardAlert[] = [];
  const errors: string[] = [];
  let nws = false;
  let usgs = false;

  const [nwsResult, usgsResult] = await Promise.allSettled([
    fetchJson(NWS_ALERTS_URL, timeoutMs, fetchImpl),
    fetchJson(USGS_EARTHQUAKES_URL, timeoutMs, fetchImpl),
  ]);

  if (nwsResult.status === 'fulfilled') {
    nws = true;
    const features = Array.isArray(nwsResult.value?.features) ? nwsResult.value.features : [];
    for (const feature of features) {
      const properties = feature?.properties ?? {};
      if (!isHurricaneEvent(properties.event)) continue;
      alerts.push({
        id: String(feature?.id ?? properties.id ?? `nws-${alerts.length + 1}`),
        type: 'hurricane',
        severity: severityFromNws(properties.severity),
        title: String(properties.headline ?? properties.event ?? 'Hurricane/Tropical alert'),
        area: properties.areaDesc ? String(properties.areaDesc) : null,
        issuedAt: properties.sent ? String(properties.sent) : null,
        updatedAt: properties.effective ? String(properties.effective) : null,
        source: 'NWS',
        sourceUrl: String(properties['@id'] ?? feature?.id ?? NWS_ALERTS_URL),
      });
    }
  } else {
    errors.push(`NWS: ${nwsResult.reason instanceof Error ? nwsResult.reason.message : String(nwsResult.reason)}`);
  }

  if (usgsResult.status === 'fulfilled') {
    usgs = true;
    const features = Array.isArray(usgsResult.value?.features) ? usgsResult.value.features : [];
    for (const feature of features) {
      const properties = feature?.properties ?? {};
      const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
      const magnitude = Number(properties.mag ?? 0);
      alerts.push({
        id: String(feature?.id ?? `usgs-${alerts.length + 1}`),
        type: 'earthquake',
        severity: severityFromMagnitude(magnitude),
        title: String(properties.title ?? `M ${magnitude} earthquake`),
        area: properties.place ? String(properties.place) : null,
        issuedAt: Number.isFinite(Number(properties.time)) ? new Date(Number(properties.time)).toISOString() : null,
        updatedAt: Number.isFinite(Number(properties.updated)) ? new Date(Number(properties.updated)).toISOString() : null,
        source: 'USGS',
        sourceUrl: String(properties.url ?? USGS_EARTHQUAKES_URL),
        magnitude,
        longitude: Number.isFinite(Number(coordinates[0])) ? Number(coordinates[0]) : undefined,
        latitude: Number.isFinite(Number(coordinates[1])) ? Number(coordinates[1]) : undefined,
      });
    }
  } else {
    errors.push(`USGS: ${usgsResult.reason instanceof Error ? usgsResult.reason.message : String(usgsResult.reason)}`);
  }

  alerts.sort((a, b) => {
    const rank: Record<HazardSeverity, number> = { info: 0, watch: 1, warning: 2, critical: 3 };
    return rank[b.severity] - rank[a.severity];
  });

  const hurricanes = alerts.filter((alert) => alert.type === 'hurricane').length;
  const earthquakes = alerts.filter((alert) => alert.type === 'earthquake').length;

  return {
    ok: nws && usgs,
    checkedAt,
    sourceHealth: { nws, usgs },
    counts: { hurricanes, earthquakes, total: alerts.length },
    alerts,
    errors,
  };
}

export const IVX_DISASTER_EARLY_WARNING_SOURCES = {
  nws: NWS_ALERTS_URL,
  usgs: USGS_EARTHQUAKES_URL,
} as const;
