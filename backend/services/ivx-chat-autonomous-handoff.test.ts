import { describe, it, expect } from 'bun:test';
import {
  detectAutonomousExecutionIntent,
  formatAutonomousTaskMessage,
  type AutonomousHandoffResult,
} from './ivx-chat-autonomous-handoff';

describe('ivx-chat-autonomous-handoff', () => {
  describe('detectAutonomousExecutionIntent', () => {
    it('detects "fix this bug" as an execution command', () => {
      const result = detectAutonomousExecutionIntent('Fix this bug in the chat module');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('code_change');
      expect(result.templateMode).toBe('BUG_FIX');
    });

    it('detects "deploy this to production" as a deploy command', () => {
      const result = detectAutonomousExecutionIntent('Deploy this to production now');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('deploy');
    });

    it('detects "implement this API endpoint" as an execution command', () => {
      const result = detectAutonomousExecutionIntent('Implement this API endpoint end to end');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.matchedBuildIntent).toBe(true);
    });

    it('detects "build a new module" as an execution command', () => {
      const result = detectAutonomousExecutionIntent('Build a new module from scratch');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.templateMode).toBe('NEW_MODULE_FROM_SCRATCH');
    });

    it('detects "audit the codebase" as a read-only execution command', () => {
      const result = detectAutonomousExecutionIntent('Audit the codebase for security issues');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('read_only');
    });

    it('does NOT route "What is your name?" to the worker', () => {
      const result = detectAutonomousExecutionIntent('What is your name?');
      expect(result.isExecutionCommand).toBe(false);
      expect(result.reason).toContain('Conversational');
    });

    it('does NOT route "Explain this architecture to me" to the worker', () => {
      const result = detectAutonomousExecutionIntent('Explain this architecture to me');
      expect(result.isExecutionCommand).toBe(false);
    });

    it('does NOT route "How do you recommend I structure this?" to the worker', () => {
      const result = detectAutonomousExecutionIntent('How do you recommend I structure this?');
      expect(result.isExecutionCommand).toBe(false);
    });

    it('does NOT route "What design pattern would you recommend?" to the worker', () => {
      const result = detectAutonomousExecutionIntent('What design pattern would you recommend?');
      expect(result.isExecutionCommand).toBe(false);
    });

    it('does NOT route empty messages to the worker', () => {
      const result = detectAutonomousExecutionIntent('');
      expect(result.isExecutionCommand).toBe(false);
    });

    it('detects approval-requiring commands (deploy to production)', () => {
      const result = detectAutonomousExecutionIntent('Deploy to production');
      expect(result.isExecutionCommand).toBe(true);
    });

    it('detects "ship it" as an execution command', () => {
      const result = detectAutonomousExecutionIntent('Ship it to production');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('deploy');
    });

    it('detects "refactor the auth module" as an execution command', () => {
      const result = detectAutonomousExecutionIntent('Refactor the auth module');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.templateMode).toBe('REFACTOR');
    });

    it('does NOT route "tell me about the platform" to the worker', () => {
      const result = detectAutonomousExecutionIntent('Tell me about the IVX platform');
      expect(result.isExecutionCommand).toBe(false);
    });
  });

  describe('formatAutonomousTaskMessage', () => {
    it('formats a successful job creation', () => {
      const result: AutonomousHandoffResult = {
        ok: true,
        jobId: 'ivx-worker-test-123',
        status: 'queued',
        stage: 'QUEUED',
        progressPercent: 0,
        attached: false,
        error: null,
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('AUTONOMOUS TASK CREATED');
      expect(msg).toContain('JOB_ID: ivx-worker-test-123');
      expect(msg).toContain('STATUS: queued');
      expect(msg).toContain('STAGE: QUEUED');
    });

    it('formats an approval-required result', () => {
      const result: AutonomousHandoffResult = {
        ok: false,
        jobId: null,
        status: null,
        stage: null,
        progressPercent: null,
        attached: false,
        error: 'Owner approval required',
        intent: {
          isExecutionCommand: true,
          requiresApproval: true,
          approvalCategories: ['production_deploy'],
          autoExecute: false,
          matchedBuildIntent: false,
          matchedTrigger: [],
          reason: 'Deploy to production requires approval',
          executionMode: 'deploy',
          templateMode: 'NEW_FEATURE',
        },
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('APPROVAL REQUIRED');
      expect(msg).toContain('/confirm');
    });

    it('formats a blocked result', () => {
      const result: AutonomousHandoffResult = {
        ok: false,
        jobId: null,
        status: null,
        stage: null,
        progressPercent: null,
        attached: false,
        error: 'Worker unavailable',
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('BLOCKED');
      expect(msg).toContain('Worker unavailable');
    });

    it('notes when attached to existing job', () => {
      const result: AutonomousHandoffResult = {
        ok: true,
        jobId: 'ivx-worker-existing-456',
        status: 'running',
        stage: 'PATCHING',
        progressPercent: 25,
        attached: true,
        error: null,
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('Attached to an existing');
    });
  });
});
