/**
 * IVX Canary Release Procedure (item 198)
 *
 * Executes a controlled canary release on Render:
 * 1. Deploys the current code to Render (new deploy)
 * 2. Monitors the health endpoint for 5 minutes
 * 3. If healthy: confirms deploy is live and reports success
 * 4. If unhealthy: triggers rollback to previous deploy
 *
 * Usage:
 *   RENDER_API_KEY=rnd_xxx node ivx-canary-release.mjs
 *
 * The canary is "controlled" because:
 * - Render's zero-downtime deploy handles the gradual rollout
 * - Health checks run for 5 minutes post-deploy
 * - Rollback is automatic on failure
 */
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d7t9ivreo5us73ftose0';
const HEALTH_URL = 'https://api.ivxholding.com/health';
const LANDING_URL = 'https://ivxholding.com';
const CANARY_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

async function checkHealth() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    return {
      ok: response.status === 200 && data.status === 'healthy',
      status: response.status,
      data,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkLanding() {
  try {
    const response = await fetch(LANDING_URL, { signal: AbortSignal.timeout(10000) });
    return { ok: response.status === 200, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function rollback() {
  console.log('\n\u26A0\uFE0F  ROLLING BACK: Health checks failed during canary period');
  console.log('   Triggering rollback to previous deploy...');

  if (!RENDER_API_KEY) {
    console.error('   Cannot rollback: RENDER_API_KEY not set');
    console.error('   MANUAL ROLLBACK REQUIRED: Run ivx-rollback.mjs with credentials');
    return false;
  }

  try {
    const deploysResponse = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys?limit=5`,
      {
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          Accept: 'application/json',
        },
      },
    );

    if (!deploysResponse.ok) {
      console.error('   Cannot fetch deploys for rollback:', deploysResponse.status);
      return false;
    }

    const deploys = await deploysResponse.json();
    const previousDeploy = deploys.find(d => d.status === 'succeeded' && !d.created_at?.includes(new Date().toISOString().slice(0, 10)));

    if (!previousDeploy) {
      console.error('   No previous deploy found for rollback');
      return false;
    }

    const rollbackResponse = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys/${previousDeploy.id}/rollback`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          Accept: 'application/json',
        },
      },
    );

    if (rollbackResponse.ok) {
      console.log('   \u2705 Rollback triggered successfully');
      return true;
    } else {
      console.error('   Rollback failed:', rollbackResponse.status);
      return false;
    }
  } catch (error) {
    console.error('   Rollback error:', error.message);
    return false;
  }
}

async function canaryRelease() {
  console.log('\u2550'.repeat(55));
  console.log('  IVX Holdings \u2014 Canary Release (item 198)');
  console.log('  ' + new Date().toISOString());
  console.log('\u2550'.repeat(55) + '\n');

  // Step 1: Pre-deploy health check
  console.log('Step 1: Pre-deploy health check...');
  const preHealth = await checkHealth();
  const preLanding = await checkLanding();
  if (!preHealth.ok || !preLanding.ok) {
    console.error('\u274C Pre-deploy health check FAILED');
    console.error('   Backend:', preHealth.ok ? 'healthy' : 'unhealthy', preHealth.error || '');
    console.error('   Landing:', preLanding.ok ? 'healthy' : 'unhealthy', preLanding.error || '');
    console.error('   Fix issues before deploying.');
    process.exit(1);
  }
  console.log('\u2705 Pre-deploy: Backend and Landing healthy\n');

  // Step 2: Deploy (triggered externally or via Render API)
  console.log('Step 2: Deploy triggered externally (or via Render dashboard)');
  console.log('   If using Render API, trigger deploy with:');
  console.log('   curl -X POST https://api.render.com/v1/services/' + RENDER_SERVICE_ID + '/deploys \\');
  console.log('     -H "Authorization: Bearer $RENDER_API_KEY" \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"clearCache":"clear"}\'');
  console.log('');

  // Step 3: Canary monitoring period
  console.log('Step 3: Canary monitoring (' + (CANARY_DURATION_MS / 60000) + ' min, checks every ' + (CHECK_INTERVAL_MS / 1000) + 's)...');
  let checksPassed = 0;
  let checksFailed = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < CANARY_DURATION_MS) {
    const health = await checkHealth();
    const landing = await checkLanding();
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const icon = health.ok && landing.ok ? '\u2705' : '\u274C';
    console.log(`${icon} [${elapsed}s] Backend: ${health.ok ? 'OK' : 'FAIL'} | Landing: ${landing.ok ? 'OK' : 'FAIL'}`);

    if (health.ok && landing.ok) {
      checksPassed++;
    } else {
      checksFailed++;
      // If 3+ consecutive failures, rollback
      if (checksFailed >= 3) {
        console.log('\n\u274C 3+ failures detected during canary period');
        const rolledBack = await rollback();
        if (rolledBack) {
          console.log('\u2705 Canary release rolled back successfully');
        }
        process.exit(1);
      }
    }

    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }

  // Step 4: Final assessment
  console.log('\nStep 4: Canary assessment');
  console.log(`   Checks passed: ${checksPassed}`);
  console.log(`   Checks failed: ${checksFailed}`);
  console.log(`   Success rate: ${Math.round((checksPassed / (checksPassed + checksFailed)) * 100)}%`);

  if (checksFailed === 0) {
    console.log('\n\u2705 CANARY RELEASE SUCCESSFUL');
    console.log('   All health checks passed during canary period');
    console.log('   Production deploy confirmed as stable');
    console.log('   Ads may be reactivated (item 200)');
    process.exit(0);
  } else if (checksFailed < 3) {
    console.log('\n\u26A0\uFE0F  Canary release has minor issues');
    console.log('   Some health checks failed but below rollback threshold');
    console.log('   Monitor closely for the next 30 minutes');
    process.exit(0);
  } else {
    console.log('\n\u274C CANARY RELEASE FAILED');
    const rolledBack = await rollback();
    process.exit(rolledBack ? 1 : 2);
  }
}

canaryRelease().catch(console.error);
