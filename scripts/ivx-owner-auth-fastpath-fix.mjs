import fs from 'node:fs';

const file = 'expo/lib/auth-context.tsx';
let src = fs.readFileSync(file, 'utf8');
const roleMarker = 'IVX_OWNER_POST_LOGIN_FAST_PATH_V1';
const repairMarker = 'IVX_OWNER_REPAIR_BACKGROUND_V1';
let changed = false;

if (!src.includes(roleMarker)) {
  const needle = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    try {`;
  const replacement = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    // IVX_OWNER_POST_LOGIN_FAST_PATH_V1\n    // Password authentication has already succeeded before this function is used.\n    // The configured owner email is an existing IVX authorization rule, so do not\n    // block successful owner navigation on sequential profile/RPC round trips.\n    if (isOwnerAdminEmail(sessionEmail)) {\n      console.log(\`[Auth] OWNER_AUTHORIZED traceId=\${traceId} source=owner_email_fast_path role=owner elapsed=\${Date.now() - startTime}ms\`);\n      return { role: 'owner', source: 'fallback' };\n    }\n\n    try {`;
  if (!src.includes(needle)) throw new Error('owner auth fast-path insertion point not found');
  src = src.replace(needle, replacement);
  changed = true;
}

if (!src.includes(repairMarker)) {
  const blockingRepair = `        ownerRepairKeyRef.current = repairKey;\n        await repairOwnerRegistrationAfterLogin(session).catch((error: unknown) => {\n          console.log('[Auth] Owner post-login repair note:', error instanceof Error ? error.message : 'unknown');\n          return null;\n        });`;
  const backgroundRepair = `        ownerRepairKeyRef.current = repairKey;\n        // IVX_OWNER_REPAIR_BACKGROUND_V1\n        // Profile/wallet repair is maintenance work and must never block a valid owner login.\n        void repairOwnerRegistrationAfterLogin(session).catch((error: unknown) => {\n          console.log('[Auth] Owner post-login repair note:', error instanceof Error ? error.message : 'unknown');\n          return null;\n        });`;
  if (!src.includes(blockingRepair)) throw new Error('blocking owner-repair insertion point not found');
  src = src.replace(blockingRepair, backgroundRepair);
  changed = true;
}

if (!src.includes(roleMarker)) throw new Error('owner role fast-path marker missing after patch');
if (!src.includes(repairMarker)) throw new Error('owner background repair marker missing after patch');
if (src.includes('await repairOwnerRegistrationAfterLogin(session).catch')) throw new Error('blocking owner repair still present');

if (!changed) {
  console.log('OWNER_AUTH_FAST_PATH=ALREADY_APPLIED');
  process.exit(0);
}

fs.writeFileSync(file, src);
console.log('OWNER_AUTH_FAST_PATH=PATCHED');
console.log('OWNER_REPAIR_BACKGROUND=PATCHED');
