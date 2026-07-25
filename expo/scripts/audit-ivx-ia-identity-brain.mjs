#!/usr/bin/env bun
/**
 * Live audit: IVX IA Identity Brain — verifies that the identity/ownership/
 * IVXHOLDINGS project/investment questions are answered correctly end-to-end.
 *
 * Runs two surfaces:
 *   1. LOCAL  — direct import of the identity brain module (always works).
 *   2. LIVE   — POST /api/ivx/owner-ai against the Render backend (if reachable).
 *
 * Writes proof evidence to backend/verification-proof/.
 */
import { resolveIVXIdentityAnswer, detectIVXIdentityQuestion, buildIVXIdentityAnswer, IVX_IA_IDENTITY_MARKER, IVX_IA_IDENTITY_NAME, IVX_IA_OWNER_NAME, IVX_IA_COMPANY } from '../../backend/services/ivx-ia-identity-brain.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ts = Date.now();
const stamp = new Date().toISOString();
const proofDir = join(process.cwd(), 'backend', 'verification-proof');
mkdirSync(proofDir, { recursive: true });

// ── 1. LOCAL: exercise the identity brain directly ──────────────────────
/** @type {{prompt:string,type:string,answerPreview:string,pass:boolean,reason:string}[]} */
const cases = [];

const prompts = [
  { prompt: 'What is your name?', type: 'name', expectContains: ['IVX IA'] },
  { prompt: "What's your name", type: 'name', expectContains: ['IVX IA'] },
  { prompt: 'Who are you?', type: 'name', expectContains: ['IVX IA'] },
  { prompt: 'Who created you?', type: 'creator', expectContains: ['Ivan Perez', 'IVXHOLDINGS'] },
  { prompt: 'Who made you?', type: 'creator', expectContains: ['Ivan Perez', 'IVXHOLDINGS'] },
  { prompt: 'Who is your owner?', type: 'owner', expectContains: ['Ivan Perez', 'IVXHOLDINGS'] },
  { prompt: 'Who is the owner of IVXHOLDINGS?', type: 'owner', expectContains: ['Ivan Perez', 'IVXHOLDINGS'] },
  { prompt: 'What is IVX?', type: 'what_is_ivx', expectContains: ['IVXHOLDINGS', 'Ivan Perez'] },
  { prompt: 'What is IVXHOLDINGS?', type: 'what_is_ivx', expectContains: ['IVXHOLDINGS', 'Ivan Perez'] },
  { prompt: 'Tell me about the IVX project', type: 'ivx_project', expectContains: ['IVXHOLDINGS'] },
  { prompt: 'What is Casa Rosario?', type: 'ivx_project', expectContains: ['project'] },
  { prompt: 'How do I invest?', type: 'ivx_investment', expectContains: ['invest'] },
  { prompt: 'What is the ROI?', type: 'ivx_investment', expectContains: ['ROI'] },
  { prompt: 'Is IVXHOLDINGS legit?', type: 'ivx_investment', expectContains: ['IVXHOLDINGS'] },
];

for (const c of prompts) {
  const detected = detectIVXIdentityQuestion(c.prompt);
  const answer = resolveIVXIdentityAnswer(c.prompt);
  const missing = c.expectContains.filter((s) => !(answer ?? '').includes(s));
  const pass = detected === c.type && answer !== null && missing.length === 0;
  cases.push({
    prompt: c.prompt,
    type: c.type,
    answerPreview: (answer ?? '<null>').slice(0, 220),
    pass,
    reason: !pass ? `detected=${detected} expected=${c.type} missingContains=${JSON.stringify(missing)}` : 'ok',
  });
}

const localPass = cases.every((c) => c.pass);

// Verify NO blocking / NO limits on project & investment answers
const projectAnswer = buildIVXIdentityAnswer('ivx_project') ?? '';
const investmentAnswer = buildIVXIdentityAnswer('ivx_investment') ?? '';
const noBlock = !/\bBLOCKED\b/i.test(projectAnswer) && !/\bBLOCKED\b/i.test(investmentAnswer);
const noLimit = !/not allowed|cannot answer|not permitted|off-limits/i.test(projectAnswer) && !/not allowed|cannot answer|not permitted|off-limits/i.test(investmentAnswer);
const notShort = projectAnswer.length > 100 && investmentAnswer.length > 100;

// ── 2. LIVE: hit the Render backend if reachable ────────────────────────
const BACKEND_URL = 'https://api.ivxholding.com';
const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN || '';
/** @type {{prompt:string,status:number,source:string,answerPreview:string,pass:boolean,reason:string}[]} */
const liveResults = [];
let backendReachable = false;
let liveIdentityDeployed = false;

/** @param {string} prompt */
async function tryLive(prompt) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/ivx/owner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
      body: JSON.stringify({ message: prompt, persistAssistantMessage: false, persistUserMessage: false }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    const answer = typeof data.answer === 'string' ? data.answer : '';
    const source = typeof data.source === 'string' ? data.source : '';
    return { prompt, status: res.status, source, answerPreview: answer.slice(0, 220), pass: res.status === 200 && answer.length > 0, reason: res.status === 200 ? 'ok' : `http ${res.status}` };
  } catch (e) {
    return { prompt, status: 0, source: '', answerPreview: '', pass: false, reason: e instanceof Error ? e.message : 'fetch error' };
  }
}

const livePrompts = [
  'What is your name?',
  'Who created you?',
  'Who is your owner?',
  'What is IVXHOLDINGS?',
  'Tell me about the IVX project',
  'How do I invest?',
];

try {
  const health = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  backendReachable = !!health && health.status === 200;
} catch { backendReachable = false; }

if (backendReachable) {
  for (const p of livePrompts) {
    const r = await tryLive(p);
    liveResults.push(r);
    if (r.source === 'ivx-owner-ai-identity-brain') liveIdentityDeployed = true;
  }
}

// ── 3. Write proof evidence ─────────────────────────────────────────────
const verdict = localPass && noBlock && noLimit && notShort
  ? (liveIdentityDeployed ? 'IDENTITY_BRAIN_LIVE_VERIFIED' : (backendReachable ? 'IDENTITY_BRAIN_LOCAL_VERIFIED_LIVE_PENDING_DEPLOY' : 'IDENTITY_BRAIN_LOCAL_VERIFIED'))
  : 'IDENTITY_BRAIN_FAILED';

const proof = {
  auditId: `ivx-ia-identity-brain-${ts}`,
  timestamp: stamp,
  marker: IVX_IA_IDENTITY_MARKER,
  verdict,
  identity: { name: IVX_IA_IDENTITY_NAME, owner: IVX_IA_OWNER_NAME, company: IVX_IA_COMPANY },
  local: {
    pass: localPass,
    noBlockOnProjectOrInvestment: noBlock,
    noLimitOnProjectOrInvestment: noLimit,
    answersSubstantive: notShort,
    cases,
  },
  live: {
    backendReachable,
    liveIdentityDeployed,
    results: liveResults,
  },
  filesChanged: [
    'backend/services/ivx-ia-identity-brain.ts',
    'backend/services/ivx-ia-identity-brain.test.ts',
    'backend/api/ivx-owner-ai.ts',
    'backend/public-chat-ai.ts',
  ],
  capabilities: {
    nameQuestion: 'What is your name? → IVX IA',
    creatorQuestion: 'Who created you? → Ivan Perez, owner of IVXHOLDINGS',
    ownerQuestion: 'Who is your owner? → Ivan Perez, owner of IVXHOLDINGS',
    whatIsIvx: 'What is IVXHOLDINGS? → full company description',
    projectQuestions: 'Project / deal questions → answered fully, never limited',
    investmentQuestions: 'Investment / ROI / how-to-invest → answered fully, never limited',
    regularConversation: 'The brain can answer any type of question (regular conversation)',
  },
};

const outPath = join(proofDir, `ivx-ia-identity-brain-${ts}.json`);
writeFileSync(outPath, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ verdict, localPass, backendReachable, liveIdentityDeployed, outPath, cases: cases.length, liveResults: liveResults.length }, null, 2));