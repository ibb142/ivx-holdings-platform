import fs from 'node:fs';

const file = 'expo/lib/auth-context.tsx';
let src = fs.readFileSync(file, 'utf8');
const marker = 'IVX_OWNER_POST_LOGIN_FAST_PATH_V1';

if (src.includes(marker)) {
  console.log('OWNER_AUTH_FAST_PATH=ALREADY_APPLIED');
  process.exit(0);
}

const needle = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    try {`;
const replacement = `    console.log(\`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=\${traceId} userId=\${userId} email=\${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}\`);\n\n    // IVX_OWNER_POST_LOGIN_FAST_PATH_V1\n    // Password authentication has already succeeded before this function is used.\n    // The configured owner email is an existing IVX authorization rule, so do not\n    // block successful owner navigation on sequential profile/RPC round trips.\n    // Background hydration still re-checks server state after the UI is released.\n    if (isOwnerAdminEmail(sessionEmail)) {\n      console.log(\`[Auth] OWNER_AUTHORIZED traceId=\${traceId} source=owner_email_fast_path role=owner elapsed=\${Date.now() - startTime}ms\`);\n      return { role: 'owner', source: 'fallback' };\n    }\n\n    try {`;

if (!src.includes(needle)) {
  throw new Error('owner auth fast-path insertion point not found');
}

src = src.replace(needle, replacement);
if (!src.includes(marker)) throw new Error('owner auth fast-path marker missing after patch');
fs.writeFileSync(file, src);
console.log('OWNER_AUTH_FAST_PATH=PATCHED');
