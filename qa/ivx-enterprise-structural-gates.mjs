#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const evidenceDir = path.join(root, 'qa', 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const findings = [];

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}
function add(id, severity, file, message, evidence) {
  findings.push({ id, severity, file, message, evidence });
}

const conversationStatePath = 'backend/services/ivx-owner-conversation-state.ts';
const conversationState = read(conversationStatePath);
if (!conversationState.includes('TERMINAL_ACTION_STATES')) {
  add(
    'QF-STATE-001',
    'P0',
    conversationStatePath,
    'Terminal owner actions are not centrally invalidated; FAILED/BLOCKED/CANCELLED actions can remain active and contaminate the next turn.',
    'Missing TERMINAL_ACTION_STATES invariant.',
  );
}
if (/return state\.actions\.find\(\(a\) => a\.actionId === state\.activeActionId\) \?\? null;/.test(conversationState)) {
  add(
    'QF-STATE-002',
    'P0',
    conversationStatePath,
    'getActiveAction returns terminal actions without checking executionState.',
    'Active-action getter has no state filter.',
  );
}
if (/executionState: status === 'granted' \? 'EXECUTING' : 'CANCELLED'/.test(conversationState)
    && !/activeActionId:\s*status === 'denied' \? null/.test(conversationState)) {
  add(
    'QF-STATE-003',
    'P1',
    conversationStatePath,
    'Denied owner action is CANCELLED but activeActionId is not cleared in the same state transition.',
    'Cancellation can leave stale active pointer.',
  );
}

const memoryPath = 'expo/src/modules/ivx-owner-ai/services/ivxOwnerMemoryService.ts';
const memory = read(memoryPath);
if (/const globalMessages = memory\.recentMessages\.filter\(\(message\) => !roomId \|\| message\.conversationId !== roomId\)/.test(memory)) {
  add(
    'QF-MEM-001',
    'P0',
    memoryPath,
    'Current-room prompt intentionally imports messages from other conversation IDs.',
    'Cross-room globalMessages injection detected.',
  );
}
if (memory.includes('Other recent context:')) {
  add(
    'QF-MEM-002',
    'P0',
    memoryPath,
    'Prompt exposes other-room recent context to the current owner turn.',
    'Other recent context prompt section detected.',
  );
}

const qaRunnerPath = 'qa/ivx-qa-runner.ts';
const qaRunner = read(qaRunnerPath);
if (qaRunner.includes('Production-dependent tests will SKIP') && !qaRunner.includes('IVX_ENTERPRISE_CERTIFICATION')) {
  add(
    'QF-CERT-001',
    'P1',
    qaRunnerPath,
    'Production outage can be converted to SKIP with no enterprise-certification fail-closed override.',
    'Certification can become green while production-dependent checks never ran.',
  );
}

const requestServicePath = 'expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts';
const requestService = read(requestServicePath);
if (!requestService.includes('requestId')) {
  add('QF-TURN-001', 'P0', requestServicePath, 'Owner AI request path has no request correlation identifier.', 'requestId not found.');
}

const chatPath = 'expo/app/ivx/chat.tsx';
const chat = read(chatPath);
if (!chat.includes('requestId') && !chat.includes('reliableRequestId')) {
  add(
    'QF-TURN-002',
    'P1',
    chatPath,
    'Chat rendering path does not visibly correlate the rendered assistant result to the outbound request.',
    'No request correlation symbol found in chat route.',
  );
}

const p0 = findings.filter((f) => f.severity === 'P0').length;
const p1 = findings.filter((f) => f.severity === 'P1').length;
const report = {
  marker: 'IVX-ENTERPRISE-QUALITY-FIREWALL-V1',
  generatedAt: new Date().toISOString(),
  status: p0 === 0 && p1 === 0 ? 'PASS' : 'FAIL',
  p0,
  p1,
  findings,
};
writeFileSync(path.join(evidenceDir, 'enterprise-quality-firewall.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (p0 || p1) process.exit(1);
