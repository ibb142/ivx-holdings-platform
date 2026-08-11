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

    it('detects deploy commands', () => {
      const result = detectAutonomousExecutionIntent('Deploy this to production now');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('deploy');
    });

    it('routes a new app from scratch through factory mode', () => {
      const result = detectAutonomousExecutionIntent('Build a new app from scratch for property inspections');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('factory');
      expect(result.templateMode).toBe('NEW_APP_FROM_SCRATCH');
    });

    it('routes a new module from scratch through factory mode', () => {
      const result = detectAutonomousExecutionIntent('Build a new module from scratch for invoices');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('factory');
      expect(result.templateMode).toBe('NEW_MODULE_FROM_SCRATCH');
    });

    it('detects implement endpoint as code change', () => {
      const result = detectAutonomousExecutionIntent('Implement this API endpoint end to end');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.matchedBuildIntent).toBe(true);
      expect(result.executionMode).toBe('code_change');
    });

    it('detects audits as read only', () => {
      const result = detectAutonomousExecutionIntent('Audit the codebase for security issues');
      expect(result.isExecutionCommand).toBe(true);
      expect(result.executionMode).toBe('read_only');
    });

    it('keeps conversational questions in chat', () => {
      expect(detectAutonomousExecutionIntent('What is your name?').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('Explain this architecture to me').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('How do you recommend I structure this?').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('Tell me about the IVX platform').isExecutionCommand).toBe(false);
      expect(detectAutonomousExecutionIntent('').isExecutionCommand).toBe(false);
    });

    it('detects ship and refactor commands', () => {
      expect(detectAutonomousExecutionIntent('Ship it to production').executionMode).toBe('deploy');
      const refactor = detectAutonomousExecutionIntent('Refactor the auth module');
      expect(refactor.isExecutionCommand).toBe(true);
      expect(refactor.templateMode).toBe('REFACTOR');
    });
  });

  describe('formatAutonomousTaskMessage', () => {
    it('formats a successful job creation with execution mode', () => {
      const result: AutonomousHandoffResult = {
        ok: true,
        jobId: 'ivx-worker-test-123',
        status: 'queued',
        stage: 'QUEUED',
        progressPercent: 0,
        attached: false,
        error: null,
        intent: detectAutonomousExecutionIntent('Build a new app from scratch'),
      };
      const msg = formatAutonomousTaskMessage(result);
      expect(msg).toContain('AUTONOMOUS TASK CREATED');
      expect(msg).toContain('JOB_ID: ivx-worker-test-123');
      expect(msg).toContain('MODE: factory');
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

    it('formats blocked and attached states truthfully', () => {
      const blocked: AutonomousHandoffResult = {
        ok: false,
        jobId: null,
        status: null,
        stage: null,
        progressPercent: null,
        attached: false,
        error: 'Worker unavailable',
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      expect(formatAutonomousTaskMessage(blocked)).toContain('Worker unavailable');

      const attached: AutonomousHandoffResult = {
        ok: true,
        jobId: 'ivx-worker-existing-456',
        status: 'running',
        stage: 'PATCHING',
        progressPercent: 25,
        attached: true,
        error: null,
        intent: detectAutonomousExecutionIntent('Fix this bug'),
      };
      expect(formatAutonomousTaskMessage(attached)).toContain('Attached to an existing');
    });
  });
});
