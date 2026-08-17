/**
 * Deep QA tests for IVX IA Conversation Brain — verifies all fixes
 * from the senior-developer audit (2026-07-28).
 *
 * DEF-IA-01: yes_no and definition types were declared but never implemented.
 * DEF-IA-02: detectMathQuestion had a redundant double regex test.
 * DEF-IA-03: No percentage calculation support for investor questions.
 */
import { describe, test, expect } from 'bun:test';
import {
  detectIVXConversationQuestion,
  buildIVXConversationAnswer,
  resolveIVXConversationAnswer,
  IVX_IA_CONVERSATION_MARKER,
} from './ivx-ia-conversation-brain';

describe('IVX IA Conversation Brain — Deep QA (2026-07-28)', () => {
  // ---- DEF-IA-02: Redundant regex removed, math still works ----
  describe('DEF-IA-02: math detection (redundant regex removed)', () => {
    test('word-form multiplication still detected', () => {
      expect(detectIVXConversationQuestion('17 multiplied by 23')).toBe('math');
      expect(detectIVXConversationQuestion('5 plus 3')).toBe('math');
      expect(detectIVXConversationQuestion('100 minus 20')).toBe('math');
      expect(detectIVXConversationQuestion('50 divided by 2')).toBe('math');
    });

    test('symbol-form math still detected', () => {
      expect(detectIVXConversationQuestion('15 * 3')).toBe('math');
      expect(detectIVXConversationQuestion('10 + 5')).toBe('math');
      expect(detectIVXConversationQuestion('100 - 20')).toBe('math');
      expect(detectIVXConversationQuestion('50 / 2')).toBe('math');
      expect(detectIVXConversationQuestion('15 x 3')).toBe('math');
    });

    test('square root detected', () => {
      expect(detectIVXConversationQuestion('square root of 144')).toBe('math');
      expect(detectIVXConversationQuestion('sqrt of 256')).toBe('math');
    });

    test('math evaluation returns correct values', () => {
      expect(buildIVXConversationAnswer('17 multiplied by 23')).toBe('The answer is 391.');
      expect(buildIVXConversationAnswer('5 plus 3')).toBe('The answer is 8.');
      expect(buildIVXConversationAnswer('square root of 144')).toBe('The answer is 12.');
    });

    test('division by zero returns null (no crash)', () => {
      expect(buildIVXConversationAnswer('5 divided by 0')).toBeNull();
    });
  });

  // ---- DEF-IA-03: Percentage calculation support added ----
  describe('DEF-IA-03: percentage calculation support', () => {
    test('percentage questions detected', () => {
      expect(detectIVXConversationQuestion('what is 15% of 50000')).toBe('percentage');
      expect(detectIVXConversationQuestion('15 percent of 80000')).toBe('percentage');
      expect(detectIVXConversationQuestion('10% of 1000000')).toBe('percentage');
    });

    test('percentage evaluation returns correct values', () => {
      expect(buildIVXConversationAnswer('what is 15% of 50000')).toBe('The answer is 7500.');
      expect(buildIVXConversationAnswer('10% of 1000000')).toBe('The answer is 100000.');
      expect(buildIVXConversationAnswer('8.5 percent of 200000')).toBe('The answer is 17000.');
    });

    test('percentage with decimal result formats correctly', () => {
      const result = buildIVXConversationAnswer('7.5% of 300000');
      expect(result).not.toBeNull();
      expect(result).toContain('22500');
    });

    test('non-percentage questions not falsely detected', () => {
      expect(detectIVXConversationQuestion('what is the percentage of returns')).not.toBe('percentage');
    });
  });

  // ---- DEF-IA-01: yes_no and definition types now implemented ----
  describe('DEF-IA-01: yes_no questions implemented', () => {
    test('yes/no questions detected', () => {
      expect(detectIVXConversationQuestion('is ivx a reit')).toBe('yes_no');
      expect(detectIVXConversationQuestion('can i invest through ivx')).toBe('yes_no');
      expect(detectIVXConversationQuestion('does ivx offer tokenization')).toBe('yes_no');
      expect(detectIVXConversationQuestion('are the investments safe')).toBe('yes_no');
    });

    test('IVX-specific yes/no answers returned', () => {
      const reitAnswer = buildIVXConversationAnswer('is ivx a reit');
      expect(reitAnswer).not.toBeNull();
      expect(reitAnswer).toContain('No');
      expect(reitAnswer).toContain('REIT');

      const investAnswer = buildIVXConversationAnswer('can i invest through ivx');
      expect(investAnswer).not.toBeNull();
      expect(investAnswer).toContain('Yes');
      expect(investAnswer).toContain('invest');

      const tokenAnswer = buildIVXConversationAnswer('does ivx offer tokenization');
      expect(tokenAnswer).not.toBeNull();
      expect(tokenAnswer).toContain('Yes');
    });

    test('unknown yes/no question returns null (falls through to AI)', () => {
      expect(buildIVXConversationAnswer('is the sky blue today')).toBeNull();
    });
  });

  describe('DEF-IA-01: definition questions implemented', () => {
    test('definition questions detected', () => {
      expect(detectIVXConversationQuestion('what is a reit')).toBe('definition');
      expect(detectIVXConversationQuestion('define dst')).toBe('definition');
      expect(detectIVXConversationQuestion('what does jv mean')).toBe('definition');
      expect(detectIVXConversationQuestion('explain cap rate')).toBe('definition');
    });

    test('REIT definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a reit');
      expect(answer).not.toBeNull();
      expect(answer).toContain('Real Estate Investment Trust');
    });

    test('DST definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a dst');
      expect(answer).not.toBeNull();
      expect(answer).toContain('Delaware Statutory Trust');
    });

    test('JV definition returned', () => {
      const answer = buildIVXConversationAnswer('what does jv mean');
      expect(answer).not.toBeNull();
      expect(answer).toContain('Joint Venture');
    });

    test('1031 exchange definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a 1031 exchange');
      expect(answer).not.toBeNull();
      expect(answer).toContain('1031');
      expect(answer).toContain('tax');
    });

    test('tokenization definition returned', () => {
      const answer = buildIVXConversationAnswer('explain tokenization');
      expect(answer).not.toBeNull();
      expect(answer).toContain('digital tokens');
    });

    test('IRR definition returned', () => {
      const answer = buildIVXConversationAnswer('what is irr');
      expect(answer).not.toBeNull();
      expect(answer).toContain('Internal Rate of Return');
    });

    test('waterfall definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a waterfall distribution');
      expect(answer).not.toBeNull();
      expect(answer).toContain('tiered');
    });

    test('preferred return definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a preferred return');
      expect(answer).not.toBeNull();
      expect(answer).toContain('minimum return');
    });

    test('K-1 definition returned', () => {
      const answer = buildIVXConversationAnswer('what is a k1');
      expect(answer).not.toBeNull();
      expect(answer).toContain('Schedule K-1');
    });

    test('accredited investor definition returned', () => {
      const answer = buildIVXConversationAnswer('what is an accredited investor');
      expect(answer).not.toBeNull();
      expect(answer).toContain('net worth');
    });

    test('unknown definition returns null (falls through to AI)', () => {
      expect(buildIVXConversationAnswer('what is a quantum entanglement')).toBeNull();
    });
  });

  // ---- Existing functionality still works ----
  describe('regression: existing functionality intact', () => {
    test('greetings still work', () => {
      expect(detectIVXConversationQuestion('hello')).toBe('greeting');
      expect(detectIVXConversationQuestion('hi there')).toBe('greeting');
      const answer = buildIVXConversationAnswer('hello');
      expect(answer).not.toBeNull();
      expect(answer).toContain('IVX IA');
    });

    test('thanks still work', () => {
      expect(detectIVXConversationQuestion('thank you')).toBe('thanks');
      expect(buildIVXConversationAnswer('thanks')).not.toBeNull();
    });

    test('capabilities still work', () => {
      expect(detectIVXConversationQuestion('what can you do')).toBe('capabilities');
      const answer = buildIVXConversationAnswer('what can you do');
      expect(answer).not.toBeNull();
      expect(answer).toContain('IVX IA');
    });

    test('help still works', () => {
      expect(detectIVXConversationQuestion('help')).toBe('help');
      expect(buildIVXConversationAnswer('help')).not.toBeNull();
    });

    test('non-conversation returns none', () => {
      expect(detectIVXConversationQuestion('show me the investor dashboard')).toBe('none');
      expect(buildIVXConversationAnswer('deploy the latest commit to production')).toBeNull();
    });

    test('marker is correct', () => {
      expect(IVX_IA_CONVERSATION_MARKER).toBe('ivx-ia-conversation-brain-2026-07-06');
    });

    test('resolveIVXConversationAnswer is the public entry point', () => {
      expect(resolveIVXConversationAnswer('5 plus 3')).toBe('The answer is 8.');
      expect(resolveIVXConversationAnswer('show me deals')).toBeNull();
    });
  });

  // ---- Edge cases ----
  describe('edge cases', () => {
    test('empty message returns none', () => {
      expect(detectIVXConversationQuestion('')).toBe('none');
      expect(detectIVXConversationQuestion(null as unknown as string)).toBe('none');
    });

    test('very long yes/no question falls through (>120 chars)', () => {
      const long = 'is ' + 'a'.repeat(130);
      expect(detectIVXConversationQuestion(long)).not.toBe('yes_no');
    });

    test('very long definition question falls through (>150 chars)', () => {
      const long = 'what is ' + 'a'.repeat(150);
      expect(detectIVXConversationQuestion(long)).not.toBe('definition');
    });

    test('token-return activation challenge falls through to real AI', () => {
      const certMessage =
        'You are IVX live worker activation 1, test agent, role analyst, division A. Return the exact token IVX-LIVE-31988373188-1, then add one short role-specific action you would take next. Do not omit the token.';
      expect(detectIVXConversationQuestion(certMessage)).toBe('none');
      expect(buildIVXConversationAnswer(certMessage)).toBeNull();
      expect(resolveIVXConversationAnswer(certMessage)).toBeNull();
    });
  });
});
