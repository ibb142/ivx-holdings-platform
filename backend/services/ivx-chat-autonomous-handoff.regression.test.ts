import { describe, expect, it } from 'bun:test';
import { detectAutonomousExecutionIntent } from './ivx-chat-autonomous-handoff';

describe('IVX IA senior-developer routing regressions', () => {
  it.each(['Fix chat now', 'Connect IVX IA to Autonomous', 'Arregla el dashboard ahora', 'Conecta IVX IA con Autonomous'])('routes a direct owner command: %s', (message: string) => {
    const result = detectAutonomousExecutionIntent(message);
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('code_change');
  });

  it.each(['Do not fix the bug', 'Please do not deploy this', 'How do I fix the bug?', 'No arregles el dashboard', 'Cómo puedo arreglar el dashboard'])('does not execute a prohibition or question: %s', (message: string) => {
    expect(detectAutonomousExecutionIntent(message).isExecutionCommand).toBe(false);
  });

  it('executes mixed explain+fix commands instead of narrating', () => {
    const result = detectAutonomousExecutionIntent('Explain why the owner screen crashes and fix this bug now');
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('code_change');
    expect(result.templateMode).toBe('BUG_FIX');
  });

  it('executes how+fix commands instead of treating them as questions', () => {
    const result = detectAutonomousExecutionIntent('How can you fix this crash? Fix the app now');
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('code_change');
  });

  it('keeps pure explanation requests conversational', () => {
    const result = detectAutonomousExecutionIntent('Explain why this architecture uses a worker queue');
    expect(result.isExecutionCommand).toBe(false);
  });

  it('keeps pure audit read-only', () => {
    const result = detectAutonomousExecutionIntent('Audit the codebase for security issues');
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('read_only');
  });

  it('makes audit+fix a code-change job', () => {
    const result = detectAutonomousExecutionIntent('Audit the chat code and fix the crash');
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('code_change');
    expect(result.templateMode).toBe('BUG_FIX');
  });

  it('keeps deployment requests in deploy mode', () => {
    const result = detectAutonomousExecutionIntent('Review the fix and deploy it to production');
    expect(result.isExecutionCommand).toBe(true);
    expect(result.executionMode).toBe('deploy');
  });
});
