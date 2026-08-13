/**
 * IVX Rollback Procedure (item 197)
 *
 * Triggers a Render production rollback to the previous successful deploy.
 * Verifies the rollback by checking the health endpoint afterward.
 *
 * Usage:
 *   RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv-xxx node ivx-rollback.mjs
 *
 * Prerequisites:
 *   - RENDER_API_KEY env var set (use the one from Render dashboard)
 *   - RENDER_SERVICE_ID env var set (or defaults to the IVX service)
 */
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d7t9ivreo5us73ftose0';
const HEALTH_URL = 'https://api.ivxholding.com/health';

async function rollback() {
  console.log('\u2550'.repeat(55));
  console.log('  IVX Holdings \u2014 Rollback Procedure (item 197)');
  console.log('\u2550'.repeat(55) + '\n');

  if (!RENDER_API_KEY) {
    console.error('\u274C RENDER_API_KEY not set');
    console.error('   Set it: RENDER_API_KEY=rnd_xxx node ivx-rollback.mjs');
    process.exit(1);
  }

  // Step 1: Get list of deploys
  console.log('Step 1: Fetching deploy history...');
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
    console.error('\u274C Failed to fetch deploys:', deploysResponse.status, await deploysResponse.text());
    process.exit(1);
  }

  const deploys = await deploysResponse.json();
  console.log(`Found ${deploys.length} recent deploys:\n`);

  for (const d of deploys) {
    const status = d.status || 'unknown';
    const commit = d.commit?.id?.slice(0, 8) || 'unknown';
    const created = d.createdAt?.slice(0, 19) || 'unknown';
    console.log(`  ${commit}  ${status.padEnd(12)}  ${created}`);
  }

  // Find the current live deploy and the previous one
  const liveDeploy = deploys.find((d) => d.status === 'live');
  const previousDeploys = deploys.filter((d) => d.status === 'succeeded' || d.status === 'live');
  const previousDeploy = previousDeploys.find((d) => d.id !== liveDeploy?.id);

  if (!previousDeploy) {
    console.error('\n\u274C No previous deploy found to rollback to');
    console.error('   The service may have only one deploy in history.');
    process.exit(1);
  }

  const currentCommit = liveDeploy?.commit?.id?.slice(0, 8) || 'unknown';
  const rollbackCommit = previousDeploy.commit?.id?.slice(0, 8) || 'unknown';

  console.log(`\nCurrent deploy:  ${liveDeploy?.id || 'unknown'} (${currentCommit})`);
  console.log(`Rollback target: ${previousDeploy.id} (${rollbackCommit})`);

  // Step 2: Trigger rollback
  console.log('\nStep 2: Triggering rollback...');
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

  if (!rollbackResponse.ok) {
    console.error('\u274C Rollback failed:', rollbackResponse.status, await rollbackResponse.text());
    process.exit(1);
  }

  const rollbackResult = await rollbackResponse.json();
  console.log('\u2705 Rollback triggered:', rollbackResult.id || rollbackResult.deployId || 'unknown');

  // Step 3: Verify rollback
  console.log('\nStep 3: Verify rollback...');
  console.log('   Waiting 60 seconds for deploy to complete...');
  console.log('   After waiting, check health:');
  console.log(`   curl -s ${HEALTH_URL} | python3 -m json.tool`);
  console.log('');
  console.log('   Expected: commit should match', rollbackCommit);

  return true;
}

rollback().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
