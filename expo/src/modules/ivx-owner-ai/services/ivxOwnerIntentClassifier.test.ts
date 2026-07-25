import { describe, expect, it } from 'bun:test';
import {
  classifyOwnerIntent,
  isDiagnosticRequest,
  shouldRouteToWorker,
} from './ivxOwnerIntentClassifier';

describe('ivxOwnerIntentClassifier', () => {
  describe('classifyOwnerIntent — diagnostic requests', () => {
    it('classifies "Audit the loading problem on this chat" as diagnostic', () => {
      const result = classifyOwnerIntent('Audit the loading problem on this chat, explain what is wrong, what must be fixed, and deploy it.');
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
      expect(result.routesToWorker).toBe(false);
      expect(result.diagnosticSubject).toBe('chat loading');
    });

    it('classifies "Why is member registration failing?" as diagnostic', () => {
      const result = classifyOwnerIntent('Why is member registration failing?');
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
      expect(result.routesToWorker).toBe(false);
    });

    it('classifies "Diagnose the chat cold-start issue" as diagnostic', () => {
      const result = classifyOwnerIntent('Diagnose the chat cold-start issue');
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
      expect(result.diagnosticSubject).toBe('chat loading');
    });

    it('classifies "What is wrong with the chat" as diagnostic', () => {
      const result = classifyOwnerIntent('What is wrong with the chat loading?');
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
    });

    it('classifies "Find the root cause of the blank screen" as diagnostic', () => {
      const result = classifyOwnerIntent('Find the root cause of the blank screen');
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
    });

    it('does NOT route diagnostic requests to the worker even with "deploy it"', () => {
      const result = classifyOwnerIntent('Audit the loading problem on this chat, explain what is wrong, what must be fixed, and deploy it.');
      expect(result.routesToWorker).toBe(false);
      expect(result.isDiagnostic).toBe(true);
    });

    it('does NOT route diagnostic requests to the worker even with "fix"', () => {
      const result = classifyOwnerIntent('Why is the chat broken? Fix it and deploy.');
      expect(result.isDiagnostic).toBe(true);
      expect(result.routesToWorker).toBe(false);
    });
  });

  describe('classifyOwnerIntent — status requests', () => {
    it('classifies "What is the task status?" as status', () => {
      const result = classifyOwnerIntent('What is the task status?');
      expect(result.intent).toBe('status');
      expect(result.routesToWorker).toBe(false);
    });

    it('classifies "Show me the progress" as status', () => {
      const result = classifyOwnerIntent('Show me the progress');
      expect(result.intent).toBe('status');
      expect(result.routesToWorker).toBe(false);
    });

    it('classifies "Is the worker still running?" as status', () => {
      const result = classifyOwnerIntent('Is the worker still running?');
      expect(result.intent).toBe('status');
      expect(result.routesToWorker).toBe(false);
    });
  });

  describe('classifyOwnerIntent — explanation requests', () => {
    it('classifies "Explain the architecture" as explanation', () => {
      const result = classifyOwnerIntent('Explain the architecture of the chat system');
      expect(result.intent).toBe('explanation');
      expect(result.routesToWorker).toBe(false);
    });

    it('classifies "How does the realtime subscription work?" as explanation', () => {
      const result = classifyOwnerIntent('How does the realtime subscription work?');
      expect(result.intent).toBe('explanation');
      expect(result.routesToWorker).toBe(false);
    });

    it('classifies "Walk me through the chat loading path" as explanation', () => {
      const result = classifyOwnerIntent('Walk me through the chat loading path');
      expect(result.intent).toBe('explanation');
      expect(result.routesToWorker).toBe(false);
    });
  });

  describe('classifyOwnerIntent — deployment requests', () => {
    it('classifies "Deploy this to production" as deployment', () => {
      const result = classifyOwnerIntent('Deploy this to production');
      expect(result.intent).toBe('deployment');
      expect(result.routesToWorker).toBe(true);
    });

    it('classifies "Ship it" as deployment', () => {
      const result = classifyOwnerIntent('Ship it to production');
      expect(result.intent).toBe('deployment');
      expect(result.routesToWorker).toBe(true);
    });

    it('classifies "Push to main" as deployment', () => {
      const result = classifyOwnerIntent('Push to main');
      expect(result.intent).toBe('deployment');
      expect(result.routesToWorker).toBe(true);
    });
  });

  describe('classifyOwnerIntent — code change requests', () => {
    it('classifies "Fix the bug in the chat" as code_change', () => {
      const result = classifyOwnerIntent('Fix the bug in the chat');
      expect(result.intent).toBe('code_change');
      expect(result.routesToWorker).toBe(true);
    });

    it('classifies "Build a new feature" as code_change', () => {
      const result = classifyOwnerIntent('Build a new feature for the dashboard');
      expect(result.intent).toBe('code_change');
      expect(result.routesToWorker).toBe(true);
    });

    it('classifies "Refactor the chat service" as code_change', () => {
      const result = classifyOwnerIntent('Refactor the chat service');
      expect(result.intent).toBe('code_change');
      expect(result.routesToWorker).toBe(true);
    });
  });

  describe('isDiagnosticRequest', () => {
    it('returns true for diagnostic requests', () => {
      expect(isDiagnosticRequest('Audit the chat loading')).toBe(true);
      expect(isDiagnosticRequest('Why is the chat failing?')).toBe(true);
    });

    it('returns false for non-diagnostic requests', () => {
      expect(isDiagnosticRequest('Deploy this')).toBe(false);
      expect(isDiagnosticRequest('Fix the bug')).toBe(false);
      expect(isDiagnosticRequest('What is the status?')).toBe(false);
    });
  });

  describe('shouldRouteToWorker', () => {
    it('returns false for diagnostic requests', () => {
      expect(shouldRouteToWorker('Audit the loading problem on this chat and deploy it.')).toBe(false);
    });

    it('returns true for deployment requests', () => {
      expect(shouldRouteToWorker('Deploy this to production')).toBe(true);
    });

    it('returns true for code change requests', () => {
      expect(shouldRouteToWorker('Fix the bug in the chat')).toBe(true);
    });

    it('returns false for explanation requests', () => {
      expect(shouldRouteToWorker('Explain the architecture')).toBe(false);
    });
  });

  describe('owner directive regression test', () => {
    it('the exact owner prompt is classified as diagnostic, not worker', () => {
      const ownerPrompt = 'Audit the loading problem on this chat, explain what is wrong, what must be fixed, and deploy it.';
      const result = classifyOwnerIntent(ownerPrompt);
      expect(result.intent).toBe('diagnostic');
      expect(result.isDiagnostic).toBe(true);
      expect(result.routesToWorker).toBe(false);
      expect(result.diagnosticSubject).toBe('chat loading');
    });
  });
});
