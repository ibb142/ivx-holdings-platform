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

  test('detects senior-developer brain requests', () => {
    expect(detectSeniorDeveloperBrainRequest('I want my senior developer to have same brain like you')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Answer exactly what I ask like a senior developer')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Act as senior developer')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Audit and fix senior developer')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Senior developer is not working')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('Real senior developer ready to start work now')).toBe(true);
  });

  test('does not misclassify normal chat as brain request', () => {
    expect(detectSeniorDeveloperBrainRequest('What is Casa Rosario?')).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('How do I invest?')).toBe(false);
  });

  test('status detector does NOT hijack a create-and-show execution command, even with a senior-developer status phrase', () => {
    expect(detectSeniorDeveloperModeStatusRequest(SCREENSHOT_PROMPT)).toBe(false);
  });

  test('brain detector does NOT hijack a create-and-show execution command, even with a senior-developer persona phrase', () => {
    expect(detectSeniorDeveloperBrainRequest(SCREENSHOT_PROMPT)).toBe(false);
    expect(detectSeniorDeveloperBrainRequest('act as a senior developer and create a chat module and show me')).toBe(false);
  });

  test('status answer describes verified capabilities without a general-equivalence claim', () => {
    const answer = buildSeniorDeveloperModeStatusAnswer();
    expect(answer).toContain('VERIFIED CAPABILITIES');
    expect(answer).toContain('Run a senior developer task');
    expect(answer).toContain('not a general-equivalence claim');
    expect(answer).toContain('only VERIFIED after');
  });

  test('brain answer is ready for approved work but does not overclaim equivalence', () => {
    const answer = buildSeniorDeveloperBrainAnswer();
    expect(answer).toContain('owner-gated engineering execution mode');
    expect(answer).toContain('do not claim to be the same level as Rork');
    expect(answer).toContain('STATUS: READY FOR OWNER-AUTHORIZED WORK');
    expect(answer).not.toContain('STATE: BLOCKED');
    expect(answer).not.toContain('EXACT_ACTION_REQUIRED');
  });

  test('enterprise senior developer phrasing is detected', () => {
    expect(detectSeniorDeveloperModeStatusRequest('Are you an enterprise senior developer?')).toBe(true);
    expect(detectSeniorDeveloperBrainRequest('I want you to act as an enterprise senior developer')).toBe(true);
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