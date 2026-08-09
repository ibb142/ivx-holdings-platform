#!/usr/bin/env bun
/**
 * Restore Render production env vars after accidental wipe.
 * Uses POST (add individual) not PUT (bulk replace) to avoid wiping again.
 */
const RENDER_API_KEY = 'rnd_1H0XCquMZQTRyAnHgbEv8dVWYPVs';
const SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const API_BASE = 'https://api.render.com/v1';

// All non-secret values from render.yaml + values found in project files
const envVars = [
  // Non-secret values from render.yaml
  { key: 'NODE_ENV', value: 'production' },
  { key: 'HOST', value: '0.0.0.0' },
  { key: 'PORT', value: '3000' },
  { key: 'IVX_DEPLOYMENT_ENV', value: 'production' },
  { key: 'IVX_AUTOSCALING_ENABLED', value: 'true' },
  { key: 'IVX_MAX_INSTANCES', value: '3' },
  { key: 'CHAT_DATABASE_PATH', value: '/app/data/chat-room.sqlite' },
  { key: 'IVX_DATA_DIR', value: '/app/data' },
  { key: 'CHAT_ALLOWED_ORIGINS', value: 'https://chat.ivxholding.com,https://api.ivxholding.com,https://ivxholding.com,https://www.ivxholding.com' },
  { key: 'EXPO_PUBLIC_CHAT_SOCKET_PATH', value: '/socket.io' },
  { key: 'EXPO_PUBLIC_APP_ENV', value: 'production' },
  { key: 'API_BASE_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_API_BASE_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_IVX_API_BASE_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_API_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_PRODUCTION_API_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_APP_URL', value: 'https://chat.ivxholding.com' },
  { key: 'CHAT_ROOM_ID', value: 'main-room' },
  { key: 'EXPO_PUBLIC_CHAT_DEFAULT_ROOM_ID', value: 'main-room' },
  { key: 'IVX_REDIS_ADAPTER_ENABLED', value: 'true' },
  { key: 'IVX_CACHE_ENABLED', value: 'true' },
  { key: 'IVX_RATE_LIMIT_REDIS', value: 'true' },
  { key: 'RENDER_SERVICE_NAME', value: 'ivx-holdings-platform' },
  { key: 'EXPO_PUBLIC_CHAT_API_URL', value: 'https://api.ivxholding.com' },
  { key: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL', value: 'https://api.ivxholding.com' },

  // Values found in project files / conversation context
  { key: 'EXPO_PUBLIC_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'IVX_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'AWS_REGION', value: 'us-east-1' },
  { key: 'IVX_OWNER_RECOVERY_PHONE', value: '+15616443503' },

  // AI Gateway key from plan file
  { key: 'AI_GATEWAY_API_KEY', value: 'vck_8G1XA8SrP7j8KP3VBZlAIg1RLYoUvCn6H4xQOGhbgDNqK5n9nt2NF3Vl' },
  { key: 'IVX_AI_GATEWAY_KEY', value: 'vck_8G1XA8SrP7j8KP3VBZlAIg1RLYoUvCn6H4xQOGhbgDNqK5n9nt2NF3Vl' },

  // Render API credentials (from conversation context)
  { key: 'RENDER_API_KEY', value: RENDER_API_KEY },
  { key: 'RENDER_SERVICE_ID', value: SERVICE_ID },

  // GitHub repo
  { key: 'GITHUB_REPO_URL', value: 'https://github.com/ibb142/ivx-holdings-platform.git' },
  { key: 'GITHUB_REPO', value: 'ibb142/ivx-holdings-platform' },
  { key: 'GITHUB_DEFAULT_BRANCH', value: 'main' },
];

async function renderFetch(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${RENDER_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, json, text };
}

async function main() {
  // First, list existing env vars
  const existing = await renderFetch(`/services/${SERVICE_ID}/env-vars`);
  const existingVars = Array.isArray(existing.json) ? existing.json : [];
  const existingKeys = new Set(existingVars.map(v => v.envVar?.key || v.key));
  console.log(`Existing env vars on Render: ${existingKeys.size}`);
  existingKeys.forEach(k => console.log(`  ${k}`));

  // Add each missing var via POST
  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const { key, value } of envVars) {
    if (existingKeys.has(key)) {
      console.log(`  SKIP (already set): ${key}`);
      skipped++;
      continue;
    }

    const result = await renderFetch(`/services/${SERVICE_ID}/env-vars`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });

    if (result.ok) {
      console.log(`  ADDED: ${key} (${value.length} chars)`);
      added++;
    } else {
      console.log(`  FAILED: ${key} - ${result.status} ${result.text.slice(0, 100)}`);
      failed++;
    }
  }

  console.log(`\nResults: ${added} added, ${skipped} skipped, ${failed} failed`);
  console.log(`\nStill MISSING (need owner to provide):`);
  console.log('  SUPABASE_SERVICE_ROLE_KEY');
  console.log('  EXPO_PUBLIC_SUPABASE_ANON_KEY');
  console.log('  AWS_ACCESS_KEY_ID');
  console.log('  AWS_SECRET_ACCESS_KEY');
  console.log('  GITHUB_TOKEN');
  console.log('  IVX_OWNER_TOKEN');
  console.log('  IVX_OWNER_REGISTRATION_EMAILS');
  console.log('  IVX_OWNER_EMAIL');
  console.log('  IVX_AI_SYSTEM_SECRET');
  console.log('  JWT_SECRET');
  console.log('  SUPABASE_DB_URL');
  console.log('  SUPABASE_DB_PASSWORD');
  console.log('  IVX_INTERNAL_DEPLOY_SECRET');
  console.log('  S3_BUCKET_NAME');
  console.log('  CLOUDFRONT_DISTRIBUTION_ID');
}

main().catch(e => { console.error(e); process.exit(1); });
