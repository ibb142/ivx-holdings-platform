export type PredictiveLevel = 'GREEN' | 'WATCH' | 'WARNING' | 'CRITICAL';

export type PredictiveSample = {
  at: number;
  latencyMs: number;
  ok: boolean;
  status: number;
  jsonValid: boolean;
  contentTypeValid: boolean;
  heartbeatAgeMs?: number | null;
  queueDepth?: number | null;
  failedJobs?: number | null;
  authFailure?: boolean;
};

export type PredictiveAssessment = {
  level: PredictiveLevel;
  score: number;
  reasons: string[];
  latencyTrend: number;
  failureRate: number;
  jsonFailureRate: number;
  contentTypeFailureRate: number;
  recommendedAction: 'observe' | 'preflight' | 'self_heal' | 'fail_closed';
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ratio(samples: PredictiveSample[], predicate: (sample: PredictiveSample) => boolean): number {
  if (!samples.length) return 0;
  return samples.filter(predicate).length / samples.length;
}

function latencyTrend(samples: PredictiveSample[]): number {
  if (samples.length < 4) return 1;
  const middle = Math.floor(samples.length / 2);
  const first = samples.slice(0, middle);
  const second = samples.slice(middle);
  const avg = (items: PredictiveSample[]) => items.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(1, items.length);
  return avg(first) <= 0 ? 1 : avg(second) / avg(first);
}

export function assessPredictiveHealth(input: PredictiveSample[]): PredictiveAssessment {
  const samples = input.slice(-12);
  if (!samples.length) {
    return {
      level: 'WATCH',
      score: 25,
      reasons: ['No predictive samples yet.'],
      latencyTrend: 1,
      failureRate: 0,
      jsonFailureRate: 0,
      contentTypeFailureRate: 0,
      recommendedAction: 'preflight',
    };
  }

  const reasons: string[] = [];
  const failureRate = ratio(samples, (s) => !s.ok || s.status < 200 || s.status >= 300);
  const jsonFailureRate = ratio(samples, (s) => !s.jsonValid);
  const contentTypeFailureRate = ratio(samples, (s) => !s.contentTypeValid);
  const authFailureRate = ratio(samples, (s) => s.authFailure === true || s.status === 401 || s.status === 403);
  const trend = latencyTrend(samples);
  const latest = samples[samples.length - 1];

  let score = 0;
  score += failureRate * 55;
  score += jsonFailureRate * 35;
  score += contentTypeFailureRate * 30;
  score += authFailureRate * 40;
  if (trend >= 1.5) score += 15;
  if (trend >= 2.5) score += 20;
  if (latest.latencyMs >= 1500) score += 15;
  if (latest.latencyMs >= 3500) score += 20;
  if ((latest.heartbeatAgeMs ?? 0) > 90_000) score += 20;
  if ((latest.heartbeatAgeMs ?? 0) > 180_000) score += 25;
  if ((latest.queueDepth ?? 0) >= 20) score += 10;
  if ((latest.queueDepth ?? 0) >= 50) score += 20;
  if ((latest.failedJobs ?? 0) > 0) score += 10;
  score = clamp(Math.round(score), 0, 100);

  if (failureRate > 0) reasons.push(`HTTP failure rate ${(failureRate * 100).toFixed(0)}%.`);
  if (jsonFailureRate > 0) reasons.push(`Invalid JSON rate ${(jsonFailureRate * 100).toFixed(0)}%.`);
  if (contentTypeFailureRate > 0) reasons.push(`Wrong Content-Type rate ${(contentTypeFailureRate * 100).toFixed(0)}%.`);
  if (authFailureRate > 0) reasons.push(`Auth/permission failures ${(authFailureRate * 100).toFixed(0)}%.`);
  if (trend >= 1.5) reasons.push(`Latency trend ${trend.toFixed(1)}x above prior window.`);
  if (latest.latencyMs >= 1500) reasons.push(`Latest latency ${latest.latencyMs}ms.`);
  if ((latest.heartbeatAgeMs ?? 0) > 90_000) reasons.push(`Worker heartbeat age ${Math.round((latest.heartbeatAgeMs ?? 0) / 1000)}s.`);
  if ((latest.queueDepth ?? 0) >= 20) reasons.push(`Queue depth ${latest.queueDepth}.`);
  if ((latest.failedJobs ?? 0) > 0) reasons.push(`${latest.failedJobs} failed/blocked jobs visible.`);

  let level: PredictiveLevel = 'GREEN';
  let recommendedAction: PredictiveAssessment['recommendedAction'] = 'observe';
  if (score >= 75 || failureRate >= 0.5 || latest.ok === false) {
    level = 'CRITICAL';
    recommendedAction = 'fail_closed';
  } else if (score >= 50) {
    level = 'WARNING';
    recommendedAction = 'self_heal';
  } else if (score >= 20) {
    level = 'WATCH';
    recommendedAction = 'preflight';
  }

  return {
    level,
    score,
    reasons: reasons.length ? reasons : ['All predictive signals within normal bounds.'],
    latencyTrend: trend,
    failureRate,
    jsonFailureRate,
    contentTypeFailureRate,
    recommendedAction,
  };
}

export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 4500): Promise<{ response: Response; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { response, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}
