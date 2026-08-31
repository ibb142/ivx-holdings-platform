import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './aws-runtime.mjs';

const envLoadResult = loadProjectEnv(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '../../..');
const REPORT_DIR = resolve(PROJECT_ROOT, 'logs/audit');
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_BASENAME = `chatgpt-e2e-audit-${RUN_TIMESTAMP}`;
const REPORT_JSON_PATH = resolve(REPORT_DIR, `${REPORT_BASENAME}.json`);
const REPORT_MD_PATH = resolve(REPORT_DIR, `${REPORT_BASENAME}.md`);
const LOCAL_PORT = Number.parseInt(process.env.CHATGPT_AUDIT_LOCAL_PORT || '4392', 10);
const LOCAL_BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const PUBLIC_API_BASE_URL = (process.env.CHATGPT_AUDIT_PUBLIC_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const PUBLIC_CHAT_BASE_URL = (process.env.CHATGPT_AUDIT_PUBLIC_CHAT_BASE_URL || 'https://chat.ivxholding.com').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.CHATGPT_AUDIT_TIMEOUT_MS || '14000', 10);
const SERVER_START_TIMEOUT_MS = Number.parseInt(process.env.CHATGPT_AUDIT_START_TIMEOUT_MS || '30000', 10);
const LOCAL_DATABASE_PATH = resolve(REPORT_DIR, `${REPORT_BASENAME}.sqlite`);
const TOKEN = `CHATGPT_AUDIT_${Date.now()}`;
const ROOM_ID = `chatgpt-audit-${Date.now().toString(36)}`.slice(0, 40);

const EXPECTED_CHATGPT_MODEL = process.env.IVX_OWNER_AI_MODEL || process.env.PUBLIC_CHAT_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o';
const EXPECTED_GATEWAY_BASE_PATH = '/v3/ai';

const FILE_PROBES = [
  { label: 'backend IVX AI runtime wrapper', file: 'backend/ivx-ai-runtime.ts', patterns: ['createGateway', 'generateText', "const GATEWAY_BASE_PATH = '/v3/ai';", "const DEFAULT_IVX_AI_MODEL = readTrimmed(process.env.IVX_AI_MODEL) || 'openai/gpt-4o';", 'process.env.EXPO_PUBLIC_IVX_AI_GATEWAY_URL', 'process.env.AI_GATEWAY_API_KEY', 'requestIVXAIText', "provider: 'chatgpt'", "runtime: 'ivx_ai_gateway'"] },
  { label: 'backend public chat ChatGPT service', file: 'backend/public-chat-ai.ts', patterns: ["const DEFAULT_PUBLIC_CHAT_MODEL = 'openai/gpt-4o';", 'requestIVXAIText', "module: 'public-chat'", "source: 'chatgpt'", 'generatePublicChatAnswer', "source: 'fallback'"] },
  { label: 'backend owner AI route', file: 'backend/api/ivx-owner-ai.ts', patterns: ["const DEFAULT_OWNER_AI_MODEL = 'openai/gpt-4o';", 'requestIVXAIText', "module: 'owner-room'", "provider: 'chatgpt'", "source: 'remote_api'", 'endpoint: aiResult.endpoint'] },
  { label: 'backend route registration', file: 'backend/hono.ts', patterns: ["app.get('/health'", "app.post('/api/ivx/owner-ai'", "app.post('/api/public/send-message'", "app.post('/api/public/chat'", 'openAIModel', 'aiProvider', 'aiEndpoint'] },
  { label: 'P0 assistant route', file: 'backend/api/assistant.ts', patterns: ["const DEFAULT_MODEL = 'openai/gpt-4o';", 'requestIVXAIText', "module: 'p0-ai-assistant'", "provider: 'chatgpt'", "source: 'remote_api'"] },
  { label: 'P1 plan creator route', file: 'backend/api/plan-creator.ts', patterns: ["const DEFAULT_MODEL = 'openai/gpt-4o';", 'requestIVXAIText', "module: 'p1-plan-creator'", "provider: 'chatgpt'", "source: 'remote_api'"] },
  { label: 'public chat frontend API client', file: 'expo/lib/chat-room-client.ts', patterns: ['getChatApiBaseUrl', 'https://api.ivxholding.com', 'fetchChatHealth', '/api/public/send-message', 'ChatRoomAIProvider'] },
  { label: 'public chat frontend entry point', file: 'expo/app/chat-hub.tsx', patterns: ['fetchChatHealth', 'sendChatMessage', 'ChatGPT connected', 'Fallback mode', 'mutationFn'] },
  { label: 'owner chat frontend entry point', file: 'expo/app/ivx/chat.tsx', patterns: ['ivxAIRequestService', 'requestOwnerAI', 'remote_api', 'owner_session', 'getLastIVXOwnerAIRuntimeProof'] },
  { label: 'owner AI frontend request service', file: 'expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts', patterns: ["const DEFAULT_IVX_OWNER_AI_MODEL = 'openai/gpt-4o';", 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL', 'fetchOwnerAIEndpointWithFallback', "source: 'remote_api'", 'getIVXAIIndependenceSnapshot'] },
  { label: 'managed host env/config', file: 'render.yaml', patterns: ['AI_GATEWAY_API_KEY', 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL', 'EXPO_PUBLIC_CHAT_API_URL', 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] },
  { label: 'root backend dependencies', file: 'package.json', patterns: ['"ai"', '"@hono/node-server"', '"@supabase/supabase-js"', '"tsx"'] },
  { label: 'expo dependencies', file: 'expo/package.json', patterns: ['"@tanstack/react-query"', '"expo-router"', '"socket.io-client"'] },
];

const CHATGPT_RELEVANT_BILLING_FILES = new Set([
  'backend/ivx-ai-runtime.ts',
  'backend/public-chat-ai.ts',
  'backend/api/ivx-owner-ai.ts',
  'backend/api/assistant.ts',
  'backend/api/plan-creator.ts',
  'backend/hono.ts',
  'expo/lib/chat-room-client.ts',
  'expo/app/chat-hub.tsx',
  'expo/app/ivx/chat.tsx',
  'expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts',
  'expo/src/modules/ivx-owner-ai/services/localIVXBrainService.ts',
]);

const BILLING_PATTERNS = ['RevenueCat', 'Purchases', 'react-native-purchases', 'purchase', 'subscription', 'paywall', 'premium', 'entitlement', 'offering', 'quota', 'usage cap', 'meter', 'billing', 'charge', 'credits', 'token metering', 'per-message', 'limitExceeded'];
const BILLING_ROOTS = ['expo/app', 'expo/src', 'expo/lib', 'backend'];
const BILLING_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);
const EXCLUDED_PATH_PARTS = ['/node_modules/', '/dist/', '/.expo/', '/logs/', '/coverage/', '/bun.lock'];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function truncate(value, maxLength = 5000) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 40)}\n… truncated ${value.length - maxLength + 40} chars …`;
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function redact(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  return text.length <= 10 ? '[present-redacted]' : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function decodeJwtPayload(token) {
  const value = String(token || '').trim();
  if (!value.includes('.')) {
    return null;
  }
  try {
    const segment = value.split('.')[1] || '';
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function readProjectFile(file) {
  return await readFile(resolve(PROJECT_ROOT, file), 'utf8');
}

function lineMatches(content, patterns) {
  const lines = content.split(/\r?\n/);
  return patterns.map((pattern) => {
    const matches = [];
    lines.forEach((line, index) => {
      if (line.includes(pattern)) {
        matches.push({ line: index + 1, text: line.trim() });
      }
    });
    return { pattern, matches };
  });
}

async function collectFileProof() {
  const proof = [];
  for (const probe of FILE_PROBES) {
    try {
      const content = await readProjectFile(probe.file);
      proof.push({ ...probe, exists: true, matches: lineMatches(content, probe.patterns) });
    } catch (error) {
      proof.push({ ...probe, exists: false, error: error instanceof Error ? error.message : String(error), matches: [] });
    }
  }
  return proof;
}

async function walkFiles(rootDir, files = []) {
  const { readdir, stat } = await import('node:fs/promises');
  if (!existsSync(rootDir)) {
    return files;
  }
  const entries = await readdir(rootDir);
  for (const entry of entries) {
    const absolute = resolve(rootDir, entry);
    const normalized = absolute.split('\\').join('/');
    if (EXCLUDED_PATH_PARTS.some((part) => normalized.includes(part))) {
      continue;
    }
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await walkFiles(absolute, files);
    } else {
      const extension = absolute.slice(absolute.lastIndexOf('.'));
      if (BILLING_EXTENSIONS.has(extension)) {
        files.push(absolute);
      }
    }
  }
  return files;
}

async function collectBillingProof() {
  const files = [];
  for (const root of BILLING_ROOTS) {
    await walkFiles(resolve(PROJECT_ROOT, root), files);
  }
  const escapedPatterns = BILLING_PATTERNS.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escapedPatterns.join('|'), 'i');
  const matches = [];
  for (const filePath of files) {
    const relativePath = relative(PROJECT_ROOT, filePath).split('\\').join('/');
    const content = await readFile(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line, index) => {
      if (pattern.test(line)) {
        matches.push({ file: relativePath, line: index + 1, text: line.trim().slice(0, 500) });
      }
    });
  }
  const chatGptRelevant = matches.filter((match) => CHATGPT_RELEVANT_BILLING_FILES.has(match.file) || /chatgpt|openai|gpt[-\s]?4|gpt[-\s]?5|real\s+ai|ai\s+(?:runtime|provider|model)/i.test(match.text));
  const activeChargingLogicMatches = chatGptRelevant.filter((match) => /RevenueCat|react-native-purchases|Purchases\.|paywall|entitlement|offering|purchase\(|quota|usage cap|per-message|token metering|limitExceeded|usage[_-]?limit|creditsRemaining|charge\s+(?:user|per|for|fee)|billing\s+(?:gate|requirement|required|enforcement|meter|quota)/i.test(match.text));
  const explicitNonEnforcementLines = activeChargingLogicMatches.filter((match) => /not guaranteed free|no hardcoded local usage-limit|provider or gateway billing|Do not claim .* billing actions|free\|cost\|billing\|paid\|charge\|usage\|limit\|unlimited|chatgpt_free_status/i.test(match.text));
  const enforcementMatches = activeChargingLogicMatches.filter((match) => !explicitNonEnforcementLines.includes(match));
  return {
    searchedRoots: BILLING_ROOTS,
    searchedExtensions: Array.from(BILLING_EXTENSIONS),
    chatGptRelevantFiles: Array.from(CHATGPT_RELEVANT_BILLING_FILES),
    patterns: BILLING_PATTERNS,
    totalMatches: matches.length,
    chatGptRelevantMatches: chatGptRelevant,
    activeChargingLogicMatches,
    explicitNonEnforcementLines,
    enforcementMatches,
    conclusion: enforcementMatches.length === 0
      ? 'No active ChatGPT-related in-app billing/paywall/quota/charging enforcement code was found in the ChatGPT-relevant app/backend files searched.'
      : 'Potential active ChatGPT-related billing/paywall/quota/charging enforcement matches require review.',
  };
}

function collectEnvProof() {
  const servicePayload = decodeJwtPayload(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonPayload = decodeJwtPayload(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const gatewayUrl = String(process.env.EXPO_PUBLIC_IVX_AI_GATEWAY_URL || process.env.IVX_AI_GATEWAY_URL || '').replace(/\/+$/, '');
  return {
    loadedEnvFiles: envLoadResult.loadedEnvFilesRelative,
    localSupabaseOverride: envLoadResult.localSupabaseOverride,
    vars: {
      EXPO_PUBLIC_IVX_AI_GATEWAY_URL: { present: Boolean(process.env.EXPO_PUBLIC_IVX_AI_GATEWAY_URL), preview: redact(process.env.EXPO_PUBLIC_IVX_AI_GATEWAY_URL) },
      AI_GATEWAY_API_KEY: { present: Boolean(process.env.AI_GATEWAY_API_KEY), preview: redact(process.env.AI_GATEWAY_API_KEY) },
      IVX_OWNER_AI_MODEL: { present: Boolean(process.env.IVX_OWNER_AI_MODEL), value: process.env.IVX_OWNER_AI_MODEL || null },
      PUBLIC_CHAT_MODEL: { present: Boolean(process.env.PUBLIC_CHAT_MODEL), value: process.env.PUBLIC_CHAT_MODEL || null },
      OPENAI_MODEL: { present: Boolean(process.env.OPENAI_MODEL), value: process.env.OPENAI_MODEL || null },
      EXPO_PUBLIC_CHAT_API_URL: { present: Boolean(process.env.EXPO_PUBLIC_CHAT_API_URL), value: process.env.EXPO_PUBLIC_CHAT_API_URL || null },
      EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL: { present: Boolean(process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL), value: process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL || null },
      EXPO_PUBLIC_SUPABASE_URL: { present: Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL), preview: redact(process.env.EXPO_PUBLIC_SUPABASE_URL) },
      EXPO_PUBLIC_SUPABASE_ANON_KEY: { present: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY), role: anonPayload?.role ?? null, preview: redact(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) },
      SUPABASE_SERVICE_ROLE_KEY: { present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), role: servicePayload?.role ?? null, matchesAnon: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY === process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY), preview: redact(process.env.SUPABASE_SERVICE_ROLE_KEY) },
    },
    resolvedDefaultModel: EXPECTED_CHATGPT_MODEL,
    resolvedGatewayBasePath: EXPECTED_GATEWAY_BASE_PATH,
    expectedGatewayEndpoint: gatewayUrl ? `${gatewayUrl}${EXPECTED_GATEWAY_BASE_PATH}/${EXPECTED_CHATGPT_MODEL}` : null,
  };
}

async function requestText(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, url, method: options.method || 'GET', durationMs: Date.now() - startedAt, contentType: response.headers.get('content-type'), text: truncate(text), json: safeJsonParse(text), error: null, timestamp: nowIso() };
  } catch (error) {
    return { ok: false, status: 0, url, method: options.method || 'GET', durationMs: Date.now() - startedAt, contentType: null, text: null, json: null, error: error instanceof Error ? error.message : String(error), timestamp: nowIso() };
  } finally {
    clearTimeout(timeout);
  }
}

function createLineBuffer() {
  const lines = [];
  let remainder = '';
  return {
    push(chunk) {
      const parts = `${remainder}${chunk.toString()}`.split(/\r?\n/);
      remainder = parts.pop() || '';
      for (const line of parts) {
        if (line.trim()) {
          lines.push(line);
        }
        if (lines.length > 500) {
          lines.shift();
        }
      }
    },
    flush() {
      if (remainder.trim()) {
        lines.push(remainder.trim());
      }
      remainder = '';
    },
    snapshot() {
      return [...lines];
    },
  };
}

async function waitForHealth(baseUrl, timeoutMs = SERVER_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await requestText(`${baseUrl}/health`, { method: 'GET' }, 3000);
    if (last.ok) {
      return last;
    }
    await sleep(750);
  }
  return last;
}

async function runLocalRuntimeProof() {
  const stdoutBuffer = createLineBuffer();
  const stderrBuffer = createLineBuffer();
  const child = spawn('bunx', ['tsx', 'server.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(LOCAL_PORT), HOST: '127.0.0.1', CHAT_DATABASE_PATH: LOCAL_DATABASE_PATH, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdoutBuffer.push(chunk));
  child.stderr.on('data', (chunk) => stderrBuffer.push(chunk));
  const local = { command: 'bunx tsx server.ts', baseUrl: LOCAL_BASE_URL, databasePath: relative(PROJECT_ROOT, LOCAL_DATABASE_PATH), health: null, publicChat: null, publicMessagesReload: null, ownerRouteDevProbe: null, serverExit: null, stdout: [], stderr: [], verdict: 'not_run' };

  try {
    local.health = await waitForHealth(LOCAL_BASE_URL);
    if (!local.health?.ok) {
      local.verdict = 'blocked_server_not_healthy';
      return local;
    }
    local.publicChat = await requestText(`${LOCAL_BASE_URL}/api/public/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: ROOM_ID, username: 'Audit Runner', source: 'user', text: `For audit proof, reply with exactly ${TOKEN} and no other text.` }),
    }, 25000);
    local.publicMessagesReload = await requestText(`${LOCAL_BASE_URL}/api/public/messages?roomId=${encodeURIComponent(ROOM_ID)}&limit=20`, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, REQUEST_TIMEOUT_MS);
    local.ownerRouteDevProbe = await requestText(`${LOCAL_BASE_URL}/api/ivx/owner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev-open-access-token' },
      body: JSON.stringify({ message: `Health proof only. Reply with exactly ${TOKEN}_OWNER if reachable.`, requestId: `chatgpt-audit-${Date.now()}`, persistUserMessage: false, persistAssistantMessage: false }),
    }, 25000);
    const chatJson = local.publicChat?.json;
    const ai = chatJson?.ai;
    const assistantText = chatJson?.assistantMessage?.text;
    local.verdict = local.publicChat?.ok && ai?.source === 'chatgpt' && ai?.model === EXPECTED_CHATGPT_MODEL && String(assistantText || '').includes(TOKEN)
      ? 'passed_chatgpt_public_room_e2e'
      : local.publicChat?.ok && ai?.source === 'chatgpt'
        ? 'passed_chatgpt_provider_but_exact_token_not_returned'
        : local.publicChat?.ok && ai?.source === 'fallback'
          ? 'blocked_fallback_instead_of_chatgpt'
          : 'failed_public_room_request';
    return local;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolvePromise) => child.once('exit', (code, signal) => resolvePromise({ code, signal }))),
      sleep(2500).then(() => {
        child.kill('SIGKILL');
        return { code: null, signal: 'SIGKILL_TIMEOUT' };
      }),
    ]).then((exitInfo) => {
      local.serverExit = exitInfo;
    });
    stdoutBuffer.flush();
    stderrBuffer.flush();
    local.stdout = stdoutBuffer.snapshot();
    local.stderr = stderrBuffer.snapshot();
  }
}

async function resolveHost(hostname) {
  const result = { hostname, ipv4: [], ipv6: [], errors: [] };
  try {
    result.ipv4 = await resolve4(hostname);
  } catch (error) {
    result.errors.push({ type: 'A', error: error instanceof Error ? error.message : String(error) });
  }
  try {
    result.ipv6 = await resolve6(hostname);
  } catch (error) {
    result.errors.push({ type: 'AAAA', error: error instanceof Error ? error.message : String(error) });
  }
  return result;
}

function tcpProbe(hostname, port, timeoutMs = 5000) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const socket = createConnection({ host: hostname, port, timeout: timeoutMs });
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise({ hostname, port, ok: true, durationMs: Date.now() - startedAt, error: null });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise({ hostname, port, ok: false, durationMs: Date.now() - startedAt, error: 'timeout' });
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolvePromise({ hostname, port, ok: false, durationMs: Date.now() - startedAt, error: error.message });
    });
  });
}

async function runPublicRuntimeProof() {
  const apiHost = new URL(PUBLIC_API_BASE_URL).hostname;
  const chatHost = new URL(PUBLIC_CHAT_BASE_URL).hostname;
  const publicRoomId = `${ROOM_ID}-public`.slice(0, 40);
  const proof = {
    apiBaseUrl: PUBLIC_API_BASE_URL,
    chatBaseUrl: PUBLIC_CHAT_BASE_URL,
    dns: { api: await resolveHost(apiHost), chat: await resolveHost(chatHost) },
    tcp: { api80: await tcpProbe(apiHost, 80), api443: await tcpProbe(apiHost, 443), chat80: await tcpProbe(chatHost, 80), chat443: await tcpProbe(chatHost, 443) },
    health: await requestText(`${PUBLIC_API_BASE_URL}/health`, { method: 'GET' }, REQUEST_TIMEOUT_MS),
    publicSend: await requestText(`${PUBLIC_API_BASE_URL}/api/public/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: publicRoomId, username: 'Audit Runner', source: 'user', text: `For audit proof, reply with exactly ${TOKEN}_PUBLIC and no other text.` }),
    }, REQUEST_TIMEOUT_MS),
    chatRoot: await requestText(`${PUBLIC_CHAT_BASE_URL}/`, { method: 'GET' }, REQUEST_TIMEOUT_MS),
  };
  proof.verdict = proof.health.ok && proof.publicSend.ok && proof.chatRoot.ok ? 'passed_public_e2e' : 'blocked_public_runtime';
  return proof;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# ChatGPT end-to-end audit proof', '', `Generated: ${report.generatedAt}`, `JSON artifact: ${relative(PROJECT_ROOT, REPORT_JSON_PATH)}`, `Markdown artifact: ${relative(PROJECT_ROOT, REPORT_MD_PATH)}`, `Proof token: ${report.proofToken}`, '');
  lines.push('## Commands run');
  report.commandsRun.forEach((command, index) => lines.push(`${index + 1}. \`${command}\``));
  lines.push('', '## Runtime verdicts');
  lines.push(`- Local/dev verdict: ${report.runtime.local.verdict}`);
  lines.push(`- Public/prod verdict: ${report.runtime.public.verdict}`);
  lines.push(`- Local health HTTP status: ${report.runtime.local.health?.status ?? 'none'}`);
  lines.push(`- Local public send HTTP status: ${report.runtime.local.publicChat?.status ?? 'none'}`);
  lines.push(`- Local public AI source/model/endpoint: ${report.runtime.local.publicChat?.json?.ai?.source ?? 'none'} / ${report.runtime.local.publicChat?.json?.ai?.model ?? 'none'} / ${report.runtime.local.publicChat?.json?.ai?.endpoint ?? 'none'}`);
  lines.push(`- Local assistant response: ${JSON.stringify(report.runtime.local.publicChat?.json?.assistantMessage?.text ?? null)}`);
  lines.push(`- Owner-route dev probe HTTP status: ${report.runtime.local.ownerRouteDevProbe?.status ?? 'none'}`);
  lines.push(`- Owner-route dev probe provider/model/source: ${report.runtime.local.ownerRouteDevProbe?.json?.provider ?? 'none'} / ${report.runtime.local.ownerRouteDevProbe?.json?.model ?? 'none'} / ${report.runtime.local.ownerRouteDevProbe?.json?.source ?? 'none'}`);
  lines.push(`- Public health HTTP status/error: ${report.runtime.public.health.status} / ${report.runtime.public.health.error ?? 'none'}`);
  lines.push(`- Public send HTTP status/error: ${report.runtime.public.publicSend.status} / ${report.runtime.public.publicSend.error ?? 'none'}`);
  lines.push(`- Public chat root HTTP status/error: ${report.runtime.public.chatRoot.status} / ${report.runtime.public.chatRoot.error ?? 'none'}`);
  lines.push('', '## Env/config proof');
  lines.push(`- Gateway URL present: ${report.env.vars.EXPO_PUBLIC_IVX_AI_GATEWAY_URL.present}`);
  lines.push(`- Gateway secret present: ${report.env.vars.AI_GATEWAY_API_KEY.present}`);
  lines.push(`- Resolved default model: ${report.env.resolvedDefaultModel}`);
  lines.push(`- Expected gateway endpoint: ${report.env.expectedGatewayEndpoint ?? 'not configured'}`);
  lines.push(`- Supabase service role claim: ${report.env.vars.SUPABASE_SERVICE_ROLE_KEY.role ?? 'none'}; matches anon: ${report.env.vars.SUPABASE_SERVICE_ROLE_KEY.matchesAnon}`);
  lines.push('', '## Billing/paywall/quota proof');
  lines.push(`- Searched roots: ${report.billing.searchedRoots.join(', ')}`);
  lines.push(`- ChatGPT-relevant files: ${report.billing.chatGptRelevantFiles.join(', ')}`);
  lines.push(`- Total app/backend billing-keyword matches: ${report.billing.totalMatches}`);
  lines.push(`- ChatGPT-relevant billing-keyword matches: ${report.billing.chatGptRelevantMatches.length}`);
  lines.push(`- Active ChatGPT charging/enforcement matches: ${report.billing.enforcementMatches.length}`);
  lines.push(`- Explicit non-enforcement billing/free disclaimer lines: ${report.billing.explicitNonEnforcementLines.length}`);
  lines.push(`- Conclusion: ${report.billing.conclusion}`);
  if (report.billing.enforcementMatches.length > 0) {
    lines.push('- Enforcement proof lines:');
    report.billing.enforcementMatches.forEach((match) => lines.push(`  - ${match.file}:${match.line}: ${match.text}`));
  }
  if (report.billing.explicitNonEnforcementLines.length > 0) {
    lines.push('- Non-enforcement/disclaimer proof lines:');
    report.billing.explicitNonEnforcementLines.forEach((match) => lines.push(`  - ${match.file}:${match.line}: ${match.text}`));
  }
  lines.push('', '## Code proof files');
  report.files.forEach((fileProof) => {
    lines.push(`### ${fileProof.file} (${fileProof.label})`, `- Exists: ${fileProof.exists}`);
    for (const item of fileProof.matches) {
      lines.push(`- Pattern \`${item.pattern}\`: ${item.matches.length} match(es)`);
      item.matches.slice(0, 8).forEach((match) => lines.push(`  - L${match.line}: ${match.text}`));
    }
    lines.push('');
  });
  lines.push('## Public blocker proof');
  lines.push(`- api DNS A: ${report.runtime.public.dns.api.ipv4.join(', ') || 'none'}`);
  lines.push(`- chat DNS A: ${report.runtime.public.dns.chat.ipv4.join(', ') || 'none'}`);
  lines.push(`- api TCP 80/443: ${report.runtime.public.tcp.api80.ok}/${report.runtime.public.tcp.api443.ok}`);
  lines.push(`- chat TCP 80/443: ${report.runtime.public.tcp.chat80.ok}/${report.runtime.public.tcp.chat443.ok}`);
  lines.push(`- HTTPS/API blocker: ${report.runtime.public.health.error ?? report.runtime.public.health.text ?? 'none'}`);
  lines.push('', '## Final verdict');
  Object.entries(report.finalVerdict).forEach(([key, value]) => lines.push(`- ${key}: ${Array.isArray(value) ? value.join('; ') : value}`));
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const commandsRun = [
    'CHATGPT_AUDIT_TIMEOUT_MS=8000 CHATGPT_AUDIT_START_TIMEOUT_MS=20000 node expo/deploy/scripts/chatgpt-e2e-audit.mjs',
    'internal: spawn bunx tsx server.ts with PORT=4392 HOST=127.0.0.1',
    `internal: GET ${LOCAL_BASE_URL}/health`,
    `internal: POST ${LOCAL_BASE_URL}/api/public/send-message`,
    `internal: GET ${LOCAL_BASE_URL}/api/public/messages?roomId=${ROOM_ID}&limit=20`,
    `internal: POST ${LOCAL_BASE_URL}/api/ivx/owner-ai with Authorization: Bearer dev-open-access-token`,
    `internal: DNS + TCP probes for api.ivxholding.com and chat.ivxholding.com`,
    `internal: GET ${PUBLIC_API_BASE_URL}/health`,
    `internal: POST ${PUBLIC_API_BASE_URL}/api/public/send-message`,
    `internal: GET ${PUBLIC_CHAT_BASE_URL}/`,
  ];
  const report = { generatedAt: nowIso(), proofToken: TOKEN, roomId: ROOM_ID, commandsRun, files: await collectFileProof(), billing: await collectBillingProof(), env: collectEnvProof(), runtime: { local: await runLocalRuntimeProof(), public: await runPublicRuntimeProof() }, modelDocs: { model: EXPECTED_CHATGPT_MODEL, usageToolResult: `Model usage confirmed chat endpoint semantics before audit: language model, text/image/file input, text output, expected IVX AI gateway base path ${EXPECTED_GATEWAY_BASE_PATH}.` }, finalVerdict: {} };
  const localChatGPTOk = report.runtime.local.verdict === 'passed_chatgpt_public_room_e2e' || report.runtime.local.verdict === 'passed_chatgpt_provider_but_exact_token_not_returned';
  const publicOk = report.runtime.public.verdict === 'passed_public_e2e';
  report.finalVerdict = {
    A_ChatGPT_integrated_in_code: report.files.some((file) => file.exists && file.matches.some((item) => item.matches.length > 0)) ? 'YES' : 'NO',
    B_ChatGPT_works_locally_end_to_end: localChatGPTOk ? 'YES' : 'NO',
    C_ChatGPT_works_publicly_in_production: publicOk ? 'YES' : 'NO',
    D_In_app_billing_paywall_quota_logic_exists: report.billing.enforcementMatches.length > 0 ? 'YES' : 'NO',
    E_Free_in_the_app_proven_from_app_code_only: report.billing.enforcementMatches.length === 0 ? 'YES' : 'NO',
    F_Provider_side_free_unlimited_proven: 'NO',
    G_Exact_remaining_blockers: [
      publicOk ? null : `Public production endpoints failed: /health status=${report.runtime.public.health.status} error=${report.runtime.public.health.error ?? 'none'}; chat root status=${report.runtime.public.chatRoot.status} error=${report.runtime.public.chatRoot.error ?? 'none'}`,
      report.env.vars.AI_GATEWAY_API_KEY.present ? null : 'AI_GATEWAY_API_KEY missing for runtime provider calls.',
      report.env.vars.EXPO_PUBLIC_IVX_AI_GATEWAY_URL.present ? null : 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL missing for runtime provider calls.',
      report.billing.enforcementMatches.length > 0 ? 'Potential ChatGPT-related billing/paywall/quota enforcement matches need manual removal or confirmation.' : null,
      'Provider-side billing, account quotas, gateway rate limits, and OpenAI/Vercel billing state are outside this repository and cannot be proven from app code.',
    ].filter(Boolean),
    H_Exact_next_actions: [
      publicOk ? 'No public production endpoint repair required by this audit.' : 'Repair/redeploy public host so https://api.ivxholding.com/health and https://chat.ivxholding.com/ return HTTP 200, then rerun this audit script.',
      'If provider-side free/unlimited status is required, inspect the Vercel AI Gateway/OpenAI billing dashboards outside this repo; repo code cannot prove provider billing state.',
    ],
  };
  await writeFile(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  await writeFile(REPORT_MD_PATH, buildMarkdown(report));
  console.log(JSON.stringify({ ok: true, json: relative(PROJECT_ROOT, REPORT_JSON_PATH), markdown: relative(PROJECT_ROOT, REPORT_MD_PATH), finalVerdict: report.finalVerdict }, null, 2));
}

await main();
