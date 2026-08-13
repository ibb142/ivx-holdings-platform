/**
 * IVX Monitoring Script (item 195)
 *
 * Monitors site availability, backend health, Supabase, API endpoints,
 * and critical routes. Reports failures with exit code 1 on any failure.
 *
 * Usage: node ivx-monitor.mjs
 * For continuous monitoring: node ivx-monitor.mjs --watch (checks every 5 min)
 */
const ENDPOINTS = [
  { name: 'Landing Page',     url: 'https://ivxholding.com',                        expected: 200 },
  { name: 'Backend Health',   url: 'https://api.ivxholding.com/health',             expected: 200 },
  { name: 'Backend Readiness',url: 'https://api.ivxholding.com/readiness',           expected: 200 },
  { name: 'AI Gateway Live',   url: 'https://api.ivxholding.com/health/ai/live',     expected: 200 },
  { name: 'Wire Instructions', url: 'https://api.ivxholding.com/api/ivx/wire-instructions', expected: 401 },
  { name: 'Sitemap',           url: 'https://ivxholding.com/sitemap.xml',            expected: 200 },
  { name: 'Robots',            url: 'https://ivxholding.com/robots.txt',             expected: 200 },
  { name: 'ivx-config.json',   url: 'https://ivxholding.com/ivx-config.json',       expected: 200 },
];

async function checkEndpoint(endpoint) {
  const start = Date.now();
  try {
    const response = await fetch(endpoint.url, { redirect: 'follow' });
    const elapsed = Date.now() - start;
    const ok = response.status === endpoint.expected;
    return { ...endpoint, status: response.status, ok, elapsed };
  } catch (error) {
    return {
      ...endpoint,
      status: 0,
      ok: false,
      elapsed: Date.now() - start,
      error: error.message,
    };
  }
}

async function runChecks() {
  console.log('\u2550'.repeat(55));
  console.log('  IVX Holdings \u2014 Monitor (item 195)');
  console.log('  ' + new Date().toISOString());
  console.log('\u2550'.repeat(55) + '\n');

  let ok = 0;
  let fail = 0;
  const results = [];

  for (const endpoint of ENDPOINTS) {
    const result = await checkEndpoint(endpoint);
    const icon = result.ok ? '\u2705' : '\u274C';
    const status = result.status || 'ERR';
    console.log(`${icon} ${result.name.padEnd(22)} ${String(status).padEnd(5)} ${result.elapsed}ms${result.error ? ' ' + result.error : ''}`);
    results.push(result);
    if (result.ok) ok++; else fail++;
  }

  // Performance check (item 194)
  const slowEndpoints = results.filter(r => r.elapsed > 2000);
  if (slowEndpoints.length > 0) {
    console.log(`\n\u26A0\uFE0F  Slow endpoints (>2s): ${slowEndpoints.map(e => e.name).join(', ')}`);
  }

  console.log(`\n${ok}/${ok + fail} endpoints healthy`);
  console.log('');

  if (fail > 0) {
    console.error('\u274C Monitoring check FAILED');
    process.exit(1);
  }
  return true;
}

async function main() {
  const watchMode = process.argv.includes('--watch');
  if (watchMode) {
    console.log('Starting continuous monitoring (5 min interval)...');
    await runChecks();
    setInterval(runChecks, 5 * 60 * 1000);
  } else {
    await runChecks();
  }
}

main().catch(console.error);
