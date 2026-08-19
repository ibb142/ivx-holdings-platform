import fs from 'node:fs';

const file = 'expo/lib/auth-context.tsx';
let src = fs.readFileSync(file, 'utf8');
const roleMarker = 'IVX_OWNER_POST_LOGIN_FAST_PATH_V1';
const repairMarker = 'IVX_OWNER_REPAIR_BACKGROUND_V1';
const directMarker = 'IVX_OWNER_SUPABASE_DIRECT_PASSWORD_V1';
let changed = false;

if (!src.includes("from './auth-password-sign-in'")) {
  const importNeedle = "import { LoginTrace } from './login-trace';\n";
  if (!src.includes(importNeedle)) throw new Error('auth password helper import insertion point not found');
  src = src.replace(importNeedle, `${importNeedle}import { signInWithEmailPassword } from './auth-password-sign-in';\n`);
  changed = true;
}

if (!src.includes(roleMarker)) {
  const needle = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    try {`;
  const replacement = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    // IVX_OWNER_POST_LOGIN_FAST_PATH_V1\n    // Authentication has already succeeded before this role bootstrap runs.\n    // The configured owner identity is already enforced by IVX owner policy, so\n    // do not block navigation on extra profile/RPC round trips.\n    if (isOwnerAdminEmail(sessionEmail)) {\n      console.log(\`[Auth] OWNER_AUTHORIZED traceId=\${traceId} source=owner_email_fast_path role=owner elapsed=\${Date.now() - startTime}ms\`);\n      return { role: 'owner', source: 'fallback' };\n    }\n\n    try {`;
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

if (!src.includes(directMarker)) {
  const directNeedle = `      trace.checkpoint('BACKEND_REQUEST_STARTED');\n      manualOwnerLoginRef.current = true;\n      const apiBaseUrls = getOwnerRegistrationApiBaseUrls();`;
  const directReplacement = `      trace.checkpoint('BACKEND_REQUEST_STARTED');\n      manualOwnerLoginRef.current = true;\n\n      // IVX_OWNER_SUPABASE_DIRECT_PASSWORD_V1\n      // Owner password validation should not depend on Render cold-start latency.\n      // Supabase remains the credential authority. Backend login is retained below\n      // only as a transport/service fallback when direct Auth is unavailable.\n      if (isOwnerAdminEmail(normalizedEmail)) {\n        const directStartedAt = Date.now();\n        const directResult = await signInWithEmailPassword(freshClient, normalizedEmail, password);\n        if (directResult.ok) {\n          trace.checkpoint('BACKEND_RESPONSE_RECEIVED', { success: true, path: 'supabase_direct_owner' });\n          trace.checkpoint('SESSION_CREATED');\n          trace.checkpoint('SESSION_PERSIST_STARTED');\n          const directSession = directResult.session;\n          trace.checkpoint('SESSION_PERSIST_COMPLETE', { elapsedMs: Date.now() - directStartedAt });\n          const challengeRequired = await requireTwoFactorIfNeeded(directSession, 'direct owner password sign-in');\n          if (challengeRequired) {\n            return { success: false, requiresTwoFactor: true, message: 'Enter the 6-digit code from your authenticator app to finish signing in.' };\n          }\n          trace.checkpoint('OWNER_LOOKUP_STARTED');\n          const handledDirectSession = await handleSession(directSession);\n          trace.checkpoint('OWNER_LOOKUP_COMPLETE', { success: handledDirectSession.accepted, errorMessage: handledDirectSession.blockedReason ?? undefined });\n          if (!handledDirectSession.accepted) {\n            return { success: false, message: handledDirectSession.blockedReason ?? getAdminAccessLockMessage(), failureReason: 'admin_access_locked' };\n          }\n          trace.checkpoint('APP_SESSION_READY', { path: 'supabase_direct_owner', elapsedMs: Date.now() - directStartedAt });\n          return { success: true, message: 'Login successful', traceId: trace.traceId };\n        }\n\n        const directCode = String((directResult.error as { code?: string })?.code ?? '').toLowerCase();\n        const directMessage = String(directResult.error?.message ?? '').toLowerCase();\n        const invalidCredentials = directCode.includes('invalid_credentials')\n          || directMessage.includes('invalid login credentials')\n          || directMessage.includes('invalid email or password');\n        if (invalidCredentials) {\n          manualOwnerLoginRef.current = false;\n          trace.checkpoint('FAILED', { stage: 'auth', errorCode: directCode || 'invalid_credentials', errorMessage: directResult.error.message });\n          return {\n            success: false,\n            message: 'Invalid email or password.',\n            failureReason: 'invalid_credentials',\n            supabaseErrorMessage: directResult.error.message,\n            supabaseErrorCode: directCode || 'invalid_credentials',\n            supabaseErrorStatus: Number((directResult.error as { status?: number })?.status ?? 400),\n            supabaseErrorName: directResult.error.name || 'AuthError',\n          };\n        }\n        console.log('[Auth] Direct owner Supabase sign-in unavailable; trying existing backend fallback:', directResult.error.message);\n      }\n\n      const apiBaseUrls = getOwnerRegistrationApiBaseUrls();`;
  if (!src.includes(directNeedle)) throw new Error('direct owner password insertion point not found');
  src = src.replace(directNeedle, directReplacement);
  changed = true;
}

if (!src.includes(roleMarker)) throw new Error('owner role fast-path marker missing after patch');
if (!src.includes(repairMarker)) throw new Error('owner background repair marker missing after patch');
if (!src.includes(directMarker)) throw new Error('owner direct password marker missing after patch');
if (src.includes('await repairOwnerRegistrationAfterLogin(session).catch')) throw new Error('blocking owner repair still present');
if (!src.includes('signInWithEmailPassword(freshClient, normalizedEmail, password)')) throw new Error('direct owner Supabase password grant missing');

if (!changed) {
  console.log('OWNER_AUTH_FAST_PATH=ALREADY_APPLIED');
  process.exit(0);
}

fs.writeFileSync(file, src);
console.log('OWNER_AUTH_FAST_PATH=PATCHED');
console.log('OWNER_REPAIR_BACKGROUND=PATCHED');
console.log('OWNER_SUPABASE_DIRECT_PASSWORD=PATCHED');
