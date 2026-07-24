import { formatPublicChatGateBlock } from './ivx-public-chat-gate-response';

describe('formatPublicChatGateBlock', () => {
  test('keeps policy blockers renderable as a complete chat response', () => {
    const answer = formatPublicChatGateBlock({
      taskId: 'public-chat-test-1',
      blockerCode: 'OWNER_SESSION_MISSING',
      exactBlocker: 'No verified owner session is present.',
      nextOwnerAction: 'Complete owner login.',
      marker: 'ivx-pre-execution-feasibility-gate-test',
    });

    expect(answer).toContain('STATE: BLOCKED');
    expect(answer).toContain('TASK_ID: public-chat-test-1');
    expect(answer).toContain('BLOCKER_CODE: OWNER_SESSION_MISSING');
    expect(answer).toContain('EXACT_BLOCKER: No verified owner session is present.');
    expect(answer).toContain('NEXT_OWNER_ACTION: Complete owner login.');
    expect(answer).toContain('MARKER: ivx-pre-execution-feasibility-gate-test');
  });
});
