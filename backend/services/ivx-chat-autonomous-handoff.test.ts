import { describe, it, expect } from 'bun:test';
import {
  detectAutonomousExecutionIntent,
  formatAutonomousTaskMessage,
  type AutonomousHandoffResult,
} from './ivx-chat-autonomous-handoff';

describe('ivx-chat-autonomous-handoff', () => {
  describe('detectAutonomousExecutionIntent', () => {
    it('detects fix commands as code changes', () => {
      const result = detectAutonomousExecutionIntent('Fix this bug in the chat module');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('code_change');
      expect(result.templateMode).toBe('BUG_FIX');
    });

    it('gives explicit execution precedence over conversational wording', () => {
      const result = detectAutonomousExecutionIntent('Explain why this crashes and fix this bug now');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('code_change');
      expect(result.templateMode).toBe('BUG_FIX');
    });

    it('keeps audit plus fix in mutation mode', () => {
      const result = detectAutonomousExecutionIntent('Audit the chat code and fix the crash end to end');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('code_change');
    });

    it('keeps pure audit read-only', () => {
      const result = detectAutonomousExecutionIntent('Audit the codebase for security issues');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('read_only');
    });

    it('detects deploy as deploy mode', () => {
      const result = detectAutonomousExecutionIntent('Deploy this to production now');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('deploy');
    });

    it('detects implement API endpoint', () => {
      const result = detectAutonomousExecutionIntent('Implement this API endpoint end to end');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.matchedBuildIntent).toBe(true);
    });

    it('detects build module', () => {
      const result = detectAutonomousExecutionIntent('Build a new module from scratch');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.templateMode).toBe('NEW_MODULE_FROM_SCRATCH');
    });

    it('does not route pure questions to the worker', () => {
      expect(detectAutonomousExecutionIntent('What is your name?').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('Explain this architecture to me').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('How do you recommend I structure this?').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('What design pattern would you recommend?').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('Tell me about the IVX platform').isExecutionCommand).toBe(false);
    });

    it('does not route empty messages', () => {
      expect(detectAutonomousExecutionIntent('').isExecutionCommand).toBe(false);
    });

    it('detects ship/refactor commands', () => {
      expect(detectAutonomousExecutionIntent('Ship it to production').executionMode).toBe('deploy');
      expect(detectAutonomousExecutionIntent('Refactor the auth module').templateMode).toBe('REFACTOR');
    });
  });

  describe('formatAutonomousTaskMessage', () => {
    it('formats a successful real job', () => {
      const result: AutonomousHandoffResult = {
        ok: true, jobId: 'ivx-worker-test-123', status: 'queued', stage: 'QUEUED',
        progressPercent: 0, attached: false, error: null,
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('AUTONOMOUS TASK CREATED');
      expect(msg).toContain('JOB_ID: ivx-worker-test-123');
      expect(msg).toContain('STATUS: queued');
      expect(msg).toContain('STAGE: QUEUED');
    });

    it('formats approval-required result', () => {
      const result: AutonomousHandoffResult = {
        ok: false, jobId: null, status: null, stage: null, progressPercent: null,
        attached: false, error: 'Owner approval required',
        intent: {
          isExecutionCommand: true, requiresApproval: true,
          approvalCategories: ['production_deploy'], autoExecute: false,
          matchedBuildIntent: false, matchedTrigger: [],
          reason: 'Deploy to production requires approval', executionMode: 'deploy', templateMode: 'NEW_FEATURE',
        },
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('APPROVAL REQUIRED');
      expect(msg).toContain('/confirm');
    });

    it('formats blocked result and attached jobs', () => {
      const blocked: AutonomousHandoffResult = {
        ok: false, jobId: null, status: null, stage: null, progressPercent: null,
        attached: false, error: 'Worker unavailable', intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      expect(formatAutonomousTaskMessage(blocked)).toContain('Worker unavailable');

      const attached: AutonomousHandoffResult = {
        ok: true, jobId: 'ivx-worker-existing-456', status: 'running', stage: 'PATCHING',
        progressPercent: 25, attached: true, error: null, intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      expect(formatAutonomousTaskMessage(attached)).toContain('Attached to an existing');
    });
  });
});
