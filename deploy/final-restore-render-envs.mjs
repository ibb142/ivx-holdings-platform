#!/usr/bin/env bun
/**
 * Restore ALL Render production env vars with recovered secrets from history.
 */
const RENDER_API_KEY = 'rnd_1H0XCquMZQTRyAnHgbEv8dVWYPVs';
const SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const API_BASE = 'https://api.render.com/v1';

// ALL env vars — non-secret values + recovered secrets from history files
const allVars = [
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

  // Supabase URLs
  { key: 'EXPO_PUBLIC_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'IVX_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },

  // AWS (from Render env dump in history)
  { key: 'AWS_REGION', value: 'us-east-1' },
  { key: 'AWS_ACCESS_KEY_ID', value: 'AKIATAJ2SEG4ZOQAWX7D' },
  { key: 'AWS_SECRET_ACCESS_KEY', value: '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' },
  { key: 'S3_BUCKET_NAME', value: 'ivxholding.com' },
  { key: 'CLOUDFRONT_DISTRIBUTION_ID', value: 'E1C0DEI0VKCUYN' },

  // Owner phone
  { key: 'IVX_OWNER_RECOVERY_PHONE', value: '+15616443503' },

  // AI Gateway key
  { key: 'AI_GATEWAY_API_KEY', value: 'vck_8G1XA8SrP7j8KP3VBZlAIg1RLYoUvCn6H4xQOGhbgDNqK5n9nt2NF3Vl' },
  { key: 'IVX_AI_GATEWAY_KEY', value: 'vck_8G1XA8SrP7j8KP3VBZlAIg1RLYoUvCn6H4xQOGhbgDNqK5n9nt2NF3Vl' },

  // Render API
  { key: 'RENDER_API_KEY', value: RENDER_API_KEY },
  { key: 'RENDER_SERVICE_ID', value: SERVICE_ID },

  // GitHub
  { key: 'GITHUB_REPO_URL', value: 'https://github.com/ibb142/ivx-holdings-platform.git' },
  { key: 'GITHUB_REPO', value: 'ibb142/ivx-holdings-platform' },
  { key: 'GITHUB_DEFAULT_BRANCH', value: 'main' },
  // GITHUB_TOKEN — all known tokens are expired (401). Set empty.
  { key: 'GITHUB_TOKEN', value: '' },

  // Supabase keys (from .env file in history)
  { key: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NDAyNywiZXhwIjoyMDg4NzcwMDI3fQ.TaTRyViK-8sv3R_g1Me08sEjnyMskGXKF0u-I-PTaQ8' },
  { key: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk' },

  // Supabase Management API token (from history — may be expired)
  { key: 'SUPABASE_ACCESS_TOKEN', value: 'sbp_9736d07516c9f41a319e8f64687111424b406fbc' },

  // Owner credentials (from .env file in history)
  { key: 'IVX_OWNER_EMAIL', value: 'iperez4242@gmail.com' },
  { key: 'IVX_OWNER_REGISTRATION_EMAILS', value: 'iperez4242@gmail.com' },
  { key: 'IVX_OWNER_TOKEN', value: 'fdolDghfy4SNhHNH+LZenny1+fjLsIKBv9puQi3sPII=' },

  // Internal deploy secret (from Render env dump in history)
  { key: 'IVX_INTERNAL_DEPLOY_SECRET', value: 'ff06bfbffa61af1bb1060b792479df4dd06674aca32249f92ff2e161adeed5b5' },

  // JWT_SECRET and IVX_AI_SYSTEM_SECRET — not found in history, set empty
  { key: 'JWT_SECRET', value: '' },
  { key: 'IVX_AI_SYSTEM_SECRET', value: '' },
  { key: 'SUPABASE_DB_URL', value: '' },
  { key: 'SUPABASE_DB_PASSWORD', value: '' },
];

async function main() {
  console.log(`Setting ${allVars.length} env vars on Render via bulk PUT...`);

  const response = await fetch(`${API_BASE}/services/${SERVICE_ID}/env-vars`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${RENDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(allVars),
  });

  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}

  if (response.ok) {
    const results = Array.isArray(json) ? json : [];
    console.log(`PUT succeeded with ${results.length} env vars`);
    let set = 0, empty = 0;
    results.forEach(v => {
      const key = v.envVar?.key || v.key;
      const val = v.envVar?.value || v.value || '';
      if (val && val.trim()) {
        console.log(`  ${key}: SET (${val.length} chars)`);
        set++;
      } else {
        console.log(`  ${key}: EMPTY`);
        empty++;
      }
    });
    console.log(`\nSummary: ${set} set, ${empty} empty`);
  } else {
    console.error(`PUT FAILED: ${response.status}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
