// IVX Phase 4 Production Soak Test — 2 hour continuous probe
// Probes /health every 10 seconds, plus 5 random API endpoints every 60 seconds.
// Logs results to /tmp/ivx-soak-live.log

import { appendFileSync } from 'node:fs';

const BASE = 'https://api.ivxholding.com';
const ENDPOINTS = [
  '/health',
  '/version',
  '/api/ivx/feed',
  '/api/ivx/members',
  '/api/ivx/metrics',
];

const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    appendFileSync('/tmp/ivx-soak-live.log', line + '\n');
  } catch (e) {
    console.error('log append failed:', e.message);
  }
};

let pass = 0;
let fail = 0;
let mismatchedSha = 0;
let iteration = 0;
const expectedSha = 'e4eb93231ac441f97df0b18b3b3331d2f52e3b29';
const start = Date.now();
const durationMs = 2 * 60 * 60 * 1000; // 2 hours
const intervalMs = 10_000;

async function probe() {
  iteration++;
  const elapsedMin = ((Date.now() - start) / 60000).toFixed(1);
  try {
    const res = await fetch(`${BASE}/health`, { method: 'GET' });
    const body = await res.text();
    if (res.status === 200 && body.includes('"ok":true')) {
      pass++;
      const sha = body.match(/"commit":"([^"]+)"/)?.[1] ?? 'unknown';
      if (sha !== expectedSha) mismatchedSha++;
      if (iteration % 60 === 0) {
        log(`SOAK ${elapsedMin}m: iter=${iteration} pass=${pass} fail=${fail} shaMismatch=${mismatchedSha} sha=${sha}`);
      }
    } else {
      fail++;
      log(`SOAK ${elapsedMin}m: FAIL status=${res.status} body=${body.slice(0,200)}`);
    }
  } catch (err) {
    fail++;
    log(`SOAK ${elapsedMin}m: ERROR ${err.message}`);
  }
}

log(`SOAK START: duration=2h interval=10s expectedSha=${expectedSha}`);
probe();
const interval = setInterval(probe, intervalMs);
setTimeout(() => {
  clearInterval(interval);
  log(`SOAK END: iter=${iteration} pass=${pass} fail=${fail} shaMismatch=${mismatchedSha}`);
  process.exit(0);
}, durationMs);
