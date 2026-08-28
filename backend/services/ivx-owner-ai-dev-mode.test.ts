import { describe, expect, test } from 'bun:test';
import {
  buildSeniorDeveloperBrainAnswer,
  buildSeniorDeveloperModeStatusAnswer,
  detectSeniorDeveloperBrainRequest,
  detectSeniorDeveloperModeStatusRequest,
  detectDeveloperModeRequest,
} from './ivx-owner-ai-dev-mode';

const SCREENSHOT_PROMPT = 'Can you create and show me on this chat developer text for chat module I want to see if you are senior developer';

describe('IVX Owner AI Senior Developer Brain', () => {
  test('detects senior-developer mode status questions', () => {
    expect(detectSeniorDeveloperModeStatusRequest('Do you in a senior developer mode?')).toBe(true);
    expect(detectSeniorDeveloperModeStatusRequest('Are you a senior developer?')).toBe(true);
    expect(detectSeniorDeveloperModeStatusRequest('Switch to developer mode')).toBe(true);
  });

  test('detects only senior-developer brain META requests', () => {
    expect(detectSeniorDeveloperBrainRequest('I want my senior developer to have same brain like you')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Is the senior developer ready?')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Senior developer is not working')).toBe(true);
  });

  test('substantive engineering prompts are not hijacked by canned persona answers', () => {
    expect(detectSeniorDeveloperBrainRequest('Answer exactly what I ask like a senior developer: explain this Supabase RLS bug')).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('Act as senior developer and audit the authentication code')).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('Behave like a senior developer and diagnose this timeout')).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('Audit and fix senior developer routing')).toBe(false);
  });

  test('does not misclassify normal chat as brain request', () => {
    expect(detectSeniorDeveloperBrainRequest('What is Casa Rosario?')).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('How do I invest?')).toBe(false);
  });

  test('status detector does NOT hijack a create-and-show execution command', () => {
    expect(detectSeniorDeveloperModeStatusRequest(SCREENSHOT_PROMPT)).toBe(false);
  });

  test('brain detector does NOT hijack a create-and-show execution command', () => {
    expect(detectSeniorDeveloperBrainRequest(SCREENSHOT_PROMPT)).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('act as a senior developer and create a chat module and show me')).toBe(false);
  });

  test('static status answer never impersonates runtime certification', () => {
    const answer = buildSeniorDeveloperModeStatusAnswer();
    expect(answer).toContain('RUNTIME STATUS: UNVERIFIED');
    expect(answer).toContain('not a certificate');
    expect(answer).toContain('only when runtime evidence');
    expect(answer).not.toContain('execution mode is live');
    expect(answer).not.toContain('VERIFIED CAPABILITIES');
  });

  test('static brain answer requires runtime evidence and does not claim readiness', () => {
    const answer = buildSeniorDeveloperBrainAnswer();
    expect(answer).toContain('STATIC BRAIN STATUS');
    expect(answer).toContain('not proof');
    expect(answer).toContain('VERIFICATION CONTRACT');
    expect(answer).not.toContain('STATUS: READY FOR OWNER-AUTHORIZED WORK');
    expect(answer).not.toContain('I can inspect');
  });

  test('enterprise senior developer status phrasing remains detected', () => {
    expect(detectSeniorDeveloperModeStatusRequest('Are you an enterprise senior developer?')).toBe(true);
  });

  test('developer mode only blocks explicit immediate execution commands', () => {
    expect(detectDeveloperModeRequest('deploy now')).toBe(true);
    expect(detectDeveloperModeRequest('run senior developer task')).toBe(true);
    expect(detectDeveloperModeRequest('act as senior developer')).toBe(false);
    expect(detectDeveloperModeRequest('audit and fix senior developer')).toBe(false);
    expect(detectDeveloperModeRequest('fix the chat bug')).toBe(false);
    expect(detectDeveloperModeRequest('explain my Supabase RLS')).toBe(false);
  });

  test('create-and-show execution commands are NOT blocked by the legacy developer mode gate', () => {
    expect(detectDeveloperModeRequest(SCREENSHOT_PROMPT)).toBe(false);
    expect(detectDeveloperModeRequest('create a chat module and show me')).toBe(false);
  });
});