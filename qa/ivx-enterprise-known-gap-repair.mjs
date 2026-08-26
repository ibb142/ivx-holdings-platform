#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function patchFile(rel, transforms) {
  const abs = path.join(root, rel);
  let text = readFileSync(abs, 'utf8');
  let changed = false;
  for (const transform of transforms) {
    if (text.includes(transform.after)) continue;
    if (!text.includes(transform.before)) {
      throw new Error(`${rel}: required repair target not found: ${transform.id}`);
    }
    text = text.replace(transform.before, transform.after);
    changed = true;
  }
  if (changed) writeFileSync(abs, text, 'utf8');
  console.log(`${changed ? 'PATCHED' : 'ALREADY_FIXED'} ${rel}`);
}

patchFile('backend/services/ivx-owner-conversation-state.ts', [
  {
    id: 'terminal-state-set',
    before: "type ExecutionState = 'PENDING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';",
    after: "type ExecutionState = 'PENDING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';\n\nconst TERMINAL_ACTION_STATES = new Set<ExecutionState>(['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']);",
  },
  {
    id: 'terminal-action-pointer-clear',
    before: `  const updated: PendingOwnerAction = { ...actions[actionIndex]!, ...patch, updatedAt: nowIso() };\n  actions[actionIndex] = updated;\n  await setOwnerConversationState({ ...state, actions });\n  return updated;`,
    after: `  const updated: PendingOwnerAction = { ...actions[actionIndex]!, ...patch, updatedAt: nowIso() };\n  actions[actionIndex] = updated;\n  const terminal = TERMINAL_ACTION_STATES.has(updated.executionState);\n  const wasActive = state.activeActionId === actionId;\n  await setOwnerConversationState({\n    ...state,\n    actions,\n    activeActionId: terminal && wasActive ? null : state.activeActionId,\n    unresolvedQuestion: terminal && wasActive ? null : state.unresolvedQuestion,\n    lastCompletedActionId: updated.executionState === 'COMPLETED' ? actionId : state.lastCompletedActionId,\n  });\n  if (terminal) {\n    await appendStateEvent({\n      type: 'terminal_action_closed',\n      conversationId,\n      ownerId,\n      actionId,\n      executionState: updated.executionState,\n      at: updated.updatedAt,\n    });\n  }\n  return updated;`,
  },
  {
    id: 'active-action-terminal-filter',
    before: `  if (!state.activeActionId) return null;\n  return state.actions.find((a) => a.actionId === state.activeActionId) ?? null;`,
    after: `  if (!state.activeActionId) return null;\n  const active = state.actions.find((a) => a.actionId === state.activeActionId) ?? null;\n  if (!active) return null;\n  if (TERMINAL_ACTION_STATES.has(active.executionState)) {\n    await setOwnerConversationState({ ...state, activeActionId: null, unresolvedQuestion: null });\n    return null;\n  }\n  return active;`,
  },
  {
    id: 'denial-clears-active-pointer',
    before: `  actions[actionIndex] = updated;\n  await setOwnerConversationState({ ...state, actions });\n  return updated;\n}\n\nconst APPROVAL_PHRASES = [`,
    after: `  actions[actionIndex] = updated;\n  await setOwnerConversationState({\n    ...state,\n    actions,\n    activeActionId: status === 'denied' ? null : state.activeActionId,\n    unresolvedQuestion: status === 'denied' ? null : state.unresolvedQuestion,\n  });\n  return updated;\n}\n\nconst APPROVAL_PHRASES = [`,
  },
]);

patchFile('expo/src/modules/ivx-owner-ai/services/ivxOwnerMemoryService.ts', [
  {
    id: 'remove-cross-room-global-messages',
    before: `  const globalMessages = memory.recentMessages.filter((message) => !roomId || message.conversationId !== roomId).slice(-6);`,
    after: `  // Enterprise isolation: never inject messages from a different conversation into the active room.\n  const globalMessages: IVXOwnerMemoryMessage[] = [];`,
  },
  {
    id: 'remove-other-room-prompt-block',
    before: `  const globalRecent = relevantMemory.recentMessages\n    .filter((message) => roomId && message.conversationId !== roomId)\n    .slice(-3)\n    .map((message) => \`${'${message.role}'}: ${'${promptSafeText(message.text).slice(0, 180)}'}\`);`,
    after: `  const globalRecent: string[] = [];`,
  },
  {
    id: 'remove-other-recent-context-line',
    before: `    globalRecent.length ? \`Other recent context: ${'${globalRecent.join(\' | \')}'}\` : null,\n`,
    after: ``,
  },
]);

patchFile('qa/ivx-qa-runner.ts', [
  {
    id: 'enterprise-cert-mode',
    before: `const ENVIRONMENT = process.env.NODE_ENV || 'development';`,
    after: `const ENVIRONMENT = process.env.NODE_ENV || 'development';\nconst ENTERPRISE_CERTIFICATION = process.env.IVX_ENTERPRISE_CERTIFICATION === '1';`,
  },
  {
    id: 'production-down-fail-closed',
    before: `  if (!productionAvailable) {\n    return {\n      actual: \`Production unavailable (${'${productionUnavailableReason}'})\`,\n      status: 'SKIP' as TestStatus,\n      evidenceRef: 'production-unavailable',\n    };\n  }`,
    after: `  if (!productionAvailable) {\n    return {\n      actual: \`Production unavailable (${'${productionUnavailableReason}'})\`,\n      status: (ENTERPRISE_CERTIFICATION ? 'FAIL' : 'SKIP') as TestStatus,\n      evidenceRef: ENTERPRISE_CERTIFICATION ? 'enterprise-production-required' : 'production-unavailable',\n    };\n  }`,
  },
]);

console.log('IVX_ENTERPRISE_KNOWN_GAP_REPAIR=APPLIED');
