/**
 * IVX Authoritative Intent Router — 30-Prompt Routing Matrix Test
 *
 * Tests all 30 prompts from the owner's Item 11 specification.
 * Verifies correct routing with no empty deploys, no false COMMITTING,
 * no false DEPLOYING, no blocked safe public questions, and no canned
 * senior-developer introductions.
 */

import { classifyIntent, isCannedResponse, stripManualDirectives, isManualAnswerMode, buildClarificationQuestion } from '../services/ivx-authoritative-intent-router';

// ─── Test helpers ─────────────────────────────────────────────────────

function classifyOwner(message: string) {
  return classifyIntent({ message, isOwner: true, isPublicPath: false });
}

function classifyPublic(message: string) {
  return classifyIntent({ message, isOwner: false, isPublicPath: true });
}

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(label);
  }
}

function assertRoute(decision: ReturnType<typeof classifyIntent>, expectedRoute: string, label: string) {
  assert(decision.selectedRoute === expectedRoute, `${label} — expected route ${expectedRoute}, got ${decision.selectedRoute} (intent: ${decision.intent}, reason: ${decision.reason})`);
}

function assertNotRoute(decision: ReturnType<typeof classifyIntent>, forbiddenRoute: string, label: string) {
  assert(decision.selectedRoute !== forbiddenRoute, `${label} — must NOT route to ${forbiddenRoute}, got ${decision.selectedRoute} (intent: ${decision.intent})`);
}

function assertNoDeploy(decision: ReturnType<typeof classifyIntent>, label: string) {
  assert(decision.selectedRoute !== 'DEVELOPER_WORKER', `${label} — must NOT route to DEVELOPER_WORKER, got ${decision.selectedRoute}`);
  assert(decision.selectedRoute !== 'DEPLOYMENT_ACTION', `${label} — must NOT route to DEPLOYMENT_ACTION, got ${decision.selectedRoute}`);
  assert(!decision.actionRequired, `${label} — actionRequired must be false, got ${decision.actionRequired}`);
}

// ─── EXPLANATION prompts (1-10) — expected LLM_TEXT_RESPONSE ─────────

const explanationPrompts = [
  'Explain how Render works in IVX.',
  'What is Supabase?',
  'Why is the Reels card slow?',
  'Review this architecture.',
  'What are the trade-offs of HLS versus MP4?',
  'Design a member-classification system.',
  'Explain this TypeScript error.',
  'What is SHA parity?',
  'Compare Expo Go and a release APK.',
  'Give me a map of the autonomous system.',
];

for (let i = 0; i < explanationPrompts.length; i++) {
  const d = classifyOwner(explanationPrompts[i]);
  const label = `EXPLANATION ${i + 1}: "${explanationPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'LLM_TEXT_RESPONSE', label);
  assertNoDeploy(d, label);
  assert(d.confidence >= 0.80, `${label} — confidence too low: ${d.confidence}`);
}

// ─── DIAGNOSTIC prompts (11-15) — expected LLM_TEXT_RESPONSE ─────────

const diagnosticPrompts = [
  'Diagnose why registration is returning 400.',
  'Audit why chat loading is slow.',
  'Find the likely cause of duplicate messages.',
  'Review why the deployed SHA is different.',
  'Analyze why the Reel freezes.',
];

for (let i = 0; i < diagnosticPrompts.length; i++) {
  const d = classifyOwner(diagnosticPrompts[i]);
  const label = `DIAGNOSTIC ${i + 11}: "${diagnosticPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'LLM_TEXT_RESPONSE', label);
  assertNoDeploy(d, label);
  assert(d.intent === 'diagnostic' || d.intent === 'explanation', `${label} — expected diagnostic or explanation intent, got ${d.intent}`);
}

// ─── EXECUTION prompts (16-20) — expected DEVELOPER_WORKER ───────────

const executionPrompts = [
  'Fix the registration 400 and deploy.',
  'Patch the duplicate-message bug.',
  'Add a retry button and commit it.',
  'Run the complete test suite.',
  'Deploy the approved SHA.',
];

for (let i = 0; i < executionPrompts.length; i++) {
  const d = classifyOwner(executionPrompts[i]);
  const label = `EXECUTION ${i + 16}: "${executionPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'DEVELOPER_WORKER', label);
  assert(d.actionRequired === true, `${label} — actionRequired must be true`);
  assert(d.ownerAuthRequired === true, `${label} — ownerAuthRequired must be true`);
}

// ─── STATUS prompts (21-25) — expected STATUS_QUERY ──────────────────

const statusPrompts = [
  'What is the current deployment status?',
  'Show the last worker task.',
  'Did CI pass?',
  'What commit is live?',
  'Are the 10 agents running?',
];

for (let i = 0; i < statusPrompts.length; i++) {
  const d = classifyOwner(statusPrompts[i]);
  const label = `STATUS ${i + 21}: "${statusPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'STATUS_QUERY', label);
  assertNoDeploy(d, label);
}

// ─── MANUAL ANSWER MODE prompts (26-30) — expected MANUAL_LLM_RESPONSE ─

const manualPrompts = [
  'No tools. Explain the architecture.',
  'Manual answer only: review this code.',
  'Do not execute. Tell me how to fix it.',
  'Do not deploy. Explain the root cause.',
  'Answer only: what is an intent router?',
];

for (let i = 0; i < manualPrompts.length; i++) {
  const d = classifyOwner(manualPrompts[i]);
  const label = `MANUAL ${i + 26}: "${manualPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'MANUAL_LLM_RESPONSE', label);
  assertNoDeploy(d, label);
  assert(d.safetyStage.manualOverride === true, `${label} — manualOverride must be true`);
  // Stripped prompt should not contain the directive
  const stripped = stripManualDirectives(manualPrompts[i]);
  assert(stripped.length > 0 && stripped !== manualPrompts[i], `${label} — stripManualDirectives must remove the directive`);
}

// ─── Public chat safety tests (Item 5) ───────────────────────────────

// Safe public questions should be allowed
const safePublicPrompts = [
  'Explain how Render works in IVX.',
  'What is Supabase?',
  'Review this code for bugs.',
  'Design a notification system module.',
  'What are the trade-offs of HLS versus MP4?',
];

for (let i = 0; i < safePublicPrompts.length; i++) {
  const d = classifyPublic(safePublicPrompts[i]);
  const label = `PUBLIC_SAFE ${i + 1}: "${safePublicPrompts[i].slice(0, 50)}"`;
  assertRoute(d, 'PUBLIC_LLM_RESPONSE', label);
  assertNoDeploy(d, label);
}

// Blocked public questions should be blocked
const blockedPublicPrompts = [
  'Fix this bug and deploy.',
  'Commit this code and push to GitHub.',
  'Delete the production database.',
  'Run a senior developer task.',
  'Deploy this to production now.',
];

for (let i = 0; i < blockedPublicPrompts.length; i++) {
  const d = classifyPublic(blockedPublicPrompts[i]);
  const label = `PUBLIC_BLOCKED ${i + 1}: "${blockedPublicPrompts[i].slice(0, 50)}"`;
  assertNotRoute(d, 'PUBLIC_LLM_RESPONSE', label);
  assertNotRoute(d, 'DEVELOPER_WORKER', label);
  assert(d.safetyStage.publicBoundary === 'public_blocked', `${label} — publicBoundary must be public_blocked, got ${d.safetyStage.publicBoundary}`);
}

// ─── Canned response detection (Item 6) ──────────────────────────────

const cannedResponses = [
  'I am IVX Enterprise Senior Developer mode — same brain as the IVX agent, owner-gated, live now.',
  'Manual answer mode is active. I will answer in plain text and will not inspect Supabase, AWS, code, logs, or other tools for this request.',
  'STATUS: READY. No BLOCKED state. I answer exactly what you ask.',
  'Here is what I can do as IVX IA:',
];

for (let i = 0; i < cannedResponses.length; i++) {
  assert(isCannedResponse(cannedResponses[i]), `CANNED_DETECTION ${i + 1}: must detect canned response`);
}

const realResponses = [
  'The answer is 391.',
  'SQL injection involves inserting malicious SQL code into an application database query.',
  'To design a notification system, you need three database tables: Users, Deals, and Notifications.',
];

for (let i = 0; i < realResponses.length; i++) {
  assert(!isCannedResponse(realResponses[i]), `REAL_RESPONSE ${i + 1}: must NOT flag real response as canned`);
}

// ─── Knowledge vs Execution disambiguation tests ─────────────────────

const knowledgeNotExecution = [
  'You are a senior developer. Explain the trade-offs between microservices and a modular monolith.',
  'Review this code for bugs and security issues. What are the vulnerabilities?',
  'My app crashes with TypeError. What are the 3 most likely causes and how do I fix each?',
  'Walk me through zero-downtime deployment steps.',
  'Give me the complete architecture for a new app.',
  'What is the difference between SQL injection and XSS?',
];

for (let i = 0; i < knowledgeNotExecution.length; i++) {
  const d = classifyOwner(knowledgeNotExecution[i]);
  const label = `KNOWLEDGE_NOT_EXECUTION ${i + 1}: "${knowledgeNotExecution[i].slice(0, 60)}"`;
  assertRoute(d, 'LLM_TEXT_RESPONSE', label);
  assertNoDeploy(d, label);
}

const executionNotKnowledge = [
  'Fix the registration 400 and deploy live.',
  'Patch the duplicate-message bug and commit.',
  'Run a senior developer task: fix the auth flow.',
  'Build the notification module and deploy it.',
  'Deploy the approved SHA to production.',
];

for (let i = 0; i < executionNotKnowledge.length; i++) {
  const d = classifyOwner(executionNotKnowledge[i]);
  const label = `EXECUTION_NOT_KNOWLEDGE ${i + 1}: "${executionNotKnowledge[i].slice(0, 60)}"`;
  assertRoute(d, 'DEVELOPER_WORKER', label);
  assert(d.actionRequired === true, `${label} — actionRequired must be true`);
}

// ─── Senior-level knowledge regression (Rork AI vs IVX IA QA) ────────
// These prompts must be answered directly by the LLM, not clarified.

const seniorKnowledgePrompts = [
  'A production API returns 502 errors intermittently after deploy. Give me a systematic debugging process with specific checks.',
  'A React Native FlatList with 1,000 items is janky. List the real causes and concrete fixes, not generic advice.',
  'When would you choose a monolithic backend over microservices? Give specific criteria, not slogans.',
  "What does 'you build it, you run it' mean in practice for a senior engineer?",
  'How do you safely refactor a 5,000-line module that has no tests?',
  'What is the hardest part of maintaining a distributed system and how do you address it?',
  "Review this authentication approach: using JWTs with 24-hour expiry stored in localStorage. What are the security risks?",
  'Explain the CAP theorem and when you would sacrifice consistency for availability.',
  'Design a rate limiter that handles 10,000 requests per second across multiple server instances.',
  'What are the most common performance bottlenecks in a React Native app and how do you diagnose them?',
];

for (let i = 0; i < seniorKnowledgePrompts.length; i++) {
  const d = classifyOwner(seniorKnowledgePrompts[i]);
  const label = `SENIOR_KNOWLEDGE ${i + 1}: "${seniorKnowledgePrompts[i].slice(0, 60)}"`;
  assertRoute(d, 'LLM_TEXT_RESPONSE', label);
  assertNoDeploy(d, label);
  assert(d.selectedRoute !== 'CLARIFICATION', `${label} — must NOT route to CLARIFICATION`);
  assert(d.confidence >= 0.70, `${label} — confidence must be >= 0.70, got ${d.confidence}`);
}

// ─── App Generator routing (Phase 3) ─────────────────────────────────
// App creation prompts must route to APP_GENERATOR, not CLARIFICATION.

const appGeneratorPrompts = [
  'Create a new app from scratch called investor-portal for Expo with authentication and a dashboard.',
  'Scaffold a new module called notification-center with CRUD operations and notifications.',
  'Build a new backend service called compliance-checker with an API endpoint for running compliance checks.',
  'Create a new Expo app called deal-tracker with authentication.',
  'Scaffold a new react native app called investor-portal.',
  'Generate a new app called portfolio-manager for Expo.',
  'Create a new module called audit-trail with CRUD operations.',
  'Build a new service called data-pipeline with an API endpoint.',
];

for (let i = 0; i < appGeneratorPrompts.length; i++) {
  const d = classifyOwner(appGeneratorPrompts[i]);
  const label = `APP_GENERATOR ${i + 1}: "${appGeneratorPrompts[i].slice(0, 60)}"`;
  assertRoute(d, 'APP_GENERATOR', label);
  assert(d.selectedRoute !== 'DEVELOPER_WORKER', `${label} — must NOT route to DEVELOPER_WORKER`);
  assert(d.selectedRoute !== 'CLARIFICATION', `${label} — must NOT route to CLARIFICATION`);
  assert(d.confidence >= 0.70, `${label} — confidence must be >= 0.70, got ${d.confidence}`);
  assert(d.intent === 'app_generator', `${label} — intent must be 'app_generator', got '${d.intent}'`);
  assert(d.actionRequired === true, `${label} — actionRequired must be true`);
  assert(d.toolsAllowed === true, `${label} — toolsAllowed must be true`);
}

// ─── Clarification test (Item 8) ─────────────────────────────────────

const clarificationQuestion = buildClarificationQuestion('fix this and explain why');
assert(clarificationQuestion.length > 0, 'CLARIFICATION: buildClarificationQuestion must return a non-empty string');
assert(clarificationQuestion.includes('explanation') || clarificationQuestion.includes('execute') || clarificationQuestion.includes('clarify'), 'CLARIFICATION: question must mention explanation or execution');

// ─── Summary ─────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  IVX AUTHORITATIVE INTENT ROUTER — 30-PROMPT ROUTING MATRIX');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  PASS: ${passCount}`);
console.log(`  FAIL: ${failCount}`);
console.log(`  Total assertions: ${passCount + failCount}`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  for (const f of failures) {
    console.log(`    ❌ ${f}`);
  }
}
console.log('════════════════════════════════════════════════════════════════\n');

if (failCount > 0) {
  process.exit(1);
}
