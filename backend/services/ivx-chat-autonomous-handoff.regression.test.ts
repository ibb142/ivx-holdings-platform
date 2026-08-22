import { describe, expect, it } from 'bun:test';
import { detectAutonomousExecutionIntent } from './ivx-chat-autonomous-handoff';

describe('IVX IA senior-developer routing regressions', () => {
  it('executes mixed explain+fix commands', () => {
    const r = detectAutonomousExecutionIntent('Explain why the owner screen crashes and fix this bug now');
    expect(r.isExecutionCommand).toBe(true);
    expect(r.executionMode).toBe('code_change');
    expect(r.templateMode).toBe('BUG_FIX');
  });
  it('executes how+fix commands', () => {
    const r = detectAutonomousExecutionIntent('How can you fix this crash? Fix the app now');
    expect(r.isExecutionCommand).toBe(true);
    expect(r.executionMode).toBe('code_change');
  });
  it('keeps pure explanation conversational', () => {
    expect(detectAutonomousExecutionIntent('Explain why this architecture uses a worker queue').isExecutionCommand).toBe(false);
  });
  it('keeps pure audit read-only', () => {
    expect(detectAutonomousExecutionIntent('Audit the codebase for security issues').executionMode).toBe('read_only');
  });
  it('makes audit+fix code-change', () => {
    const r = detectAutonomousExecutionIntent('Audit the chat code and fix the crash');
    expect(r.executionMode).toBe('code_change');
    expect(r.templateMode).toBe('BUG_FIX');
  });
  it('keeps deployment in deploy mode', () => {
    expect(detectAutonomousExecutionIntent('Review the fix and deploy it to production').executionMode).toBe('deploy');
  });
});
