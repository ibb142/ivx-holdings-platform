#!/usr/bin/env bun
/**
 * SINGLE bulk PUT to restore ALL Render env vars at once.
 * The Render API PUT replaces ALL env vars, so we must send everything in ONE call.
 * NEVER do multiple single-var PUTs — each one wipes all others.
 */
const RENDER_API_KEY = 'rnd_1H0XCquMZQTRyAnHgbEv8dVWYPVs';
const SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const API_BASE = 'https://api.render.com/v1';

const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NDAyNywiZXhwIjoyMDg4NzcwMDI3fQ.TaTRyViK-8sv3R_g1Me08sEjnyMskGXKF0u-I-PTaQ8';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';
const AI_GATEWAY_KEY = 'vck_3Ggvu9pDufv7OLoTbPV0GmNMLWkIMlTV7P5aipOBj4V5gFZlGD2SE33H';

const ALL_ENV_VARS = [
  // Non-secret config values
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

  // Supabase config
  { key: 'EXPO_PUBLIC_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'IVX_SUPABASE_URL', value: 'https://kvclcdjmjghndxsngfzb.supabase.co' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', value: SUPABASE_SERVICE_ROLE_KEY },
  { key: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', value: SUPABASE_ANON_KEY },

  // AWS config
  { key: 'AWS_REGION', value: 'us-east-1' },
  { key: 'AWS_ACCESS_KEY_ID', value: 'AKIATAJ2SEG4ZOQAWX7D' },
  { key: 'AWS_SECRET_ACCESS_KEY', value: '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' },
  { key: 'S3_BUCKET_NAME', value: 'ivxholding.com' },
  { key: 'CLOUDFRONT_DISTRIBUTION_ID', value: 'E1C0DEI0VKCUYN' },

  // AI Gateway — whitespace for OpenAI/Anthropic so AI routes to Vercel AI Gateway
  { key: 'AI_GATEWAY_API_KEY', value: AI_GATEWAY_KEY },
  { key: 'IVX_AI_GATEWAY_KEY', value: AI_GATEWAY_KEY },
  { key: 'IVX_OPENAI_API_KEY', value: ' ' },
  { key: 'IVX_ANTHROPIC_API_KEY', value: ' ' },

  // Render API credentials
  { key: 'RENDER_API_KEY', value: RENDER_API_KEY },
  { key: 'RENDER_SERVICE_ID', value: SERVICE_ID },

  // GitHub config
  { key: 'GITHUB_REPO_URL', value: 'https://github.com/ibb142/ivx-holdings-platform.git' },
  { key: 'GITHUB_REPO', value: 'ibb142/ivx-holdings-platform' },
  { key: 'GITHUB_DEFAULT_BRANCH', value: 'main' },
  { key: 'GITHUB_TOKEN', value: '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' },

  // Owner credentials
  { key: 'IVX_OWNER_RECOVERY_PHONE', value: '+15616443503' },
  { key: 'IVX_OWNER_EMAIL', value: 'iperez4242@gmail.com' },
  { key: 'IVX_OWNER_REGISTRATION_EMAILS', value: 'iperez4242@gmail.com' },
  { key: 'IVX_OWNER_TOKEN', value: 'fdolDghfy4SNhHNH+LZenny1+fjLsIKBv9puQi3sPII=' },
  { key: 'IVX_INTERNAL_DEPLOY_SECRET', value: 'ff06bfbffa61af1bb1060b792479df4dd06674aca32249f92ff2e161adeed5b5' },

  // Supabase Management API token (expired but keep for reference)
  { key: 'SUPABASE_ACCESS_TOKEN', value: 'sbp_9736d07516c9f41a319e8f64687111424b406fbc' },

  // Security — JWT_SECRET newly generated (256-bit hex)
  { key: 'JWT_SECRET', value: '06125c620b9baf67f6e917a64f3d70220a84184dd69bce81ed737797eb77c9e4' },

  // Empty placeholders (not available)
  { key: 'IVX_AI_SYSTEM_SECRET', value: '' },
  { key: 'SUPABASE_DB_URL', value: '' },
  { key: 'SUPABASE_DB_PASSWORD', value: '' },
];

async function main() {
  console.log(`Sending SINGLE bulk PUT with ${ALL_ENV_VARS.length} env vars to Render...`);
  console.log('(PUT replaces ALL env vars — this is the ONLY safe way to update)');

  const response = await fetch(`${API_BASE}/services/${SERVICE_ID}/env-vars`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${RENDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ALL_ENV_VARS),
  });

  const text = await response.text();
  let json = [];
  try { json = JSON.parse(text); } catch {}

  if (response.ok) {
    console.log(`PUT succeeded — ${Array.isArray(json) ? json.length : '?'} env vars confirmed on Render`);
    const setCount = ALL_ENV_VARS.filter(v => v.value.length > 0).length;
    const emptyCount = ALL_ENV_VARS.filter(v => v.value.length === 0).length;
    console.log(`  Set: ${setCount}, Empty: ${emptyCount}`);
    ALL_ENV_VARS.forEach(v => {
      const status = v.value.length > 0 ? `SET (${v.value.length} chars)` : 'EMPTY';
      console.log(`  ${v.key}: ${status}`);
    });
  } else {
    console.error(`PUT FAILED — HTTP ${response.status}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
