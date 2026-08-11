import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { detectMessageLanguage, buildLanguageInstruction } from '../services/ivx-language-detector';
import { resolveIVXIdentityAnswer } from '../services/ivx-ia-identity-brain';
import { resolveIVXConversationAnswer } from '../services/ivx-ia-conversation-brain';
import { buildSystemPrompt } from '../public-chat-ai';

const repoFile = (...parts: string[]) => resolve(process.cwd(), ...parts);

describe('IVX Language Detection + Multilingual Response', () => {
  describe('detectMessageLanguage', () => {
    it('01 — Spanish prompt → detected as es', () => {
      expect(detectMessageLanguage('Cual es tu nombre? Y quien es tu dueno')).toBe('es');
    });

    it('02 — English prompt → detected as en', () => {
      expect(detectMessageLanguage('What is your name and who is your owner?')).toBe('en');
    });

    it('03 — Spanish with accents → detected as es', () => {
      expect(detectMessageLanguage('¿Cuál es tu nombre? Y quién es tu dueño?')).toBe('es');
    });

    it('04 — Spanish greeting hola → detected as es', () => {
      expect(detectMessageLanguage('Hola, quiero saber sobre inversiones')).toBe('es');
    });

    it('05 — English greeting hello → detected as en', () => {
      expect(detectMessageLanguage('Hello, I want to know about investments')).toBe('en');
    });

    it('06 — Empty message → auto', () => {
      expect(detectMessageLanguage('')).toBe('auto');
    });
  });

  describe('buildLanguageInstruction', () => {
    it('07 — Spanish instruction tells model to respond in Spanish', () => {
      const instruction = buildLanguageInstruction('es');
      expect(instruction).toContain('español');
      expect(instruction.toLowerCase()).toContain('responde en español');
    });

    it('08 — English instruction tells model to respond in English', () => {
      const instruction = buildLanguageInstruction('en');
      expect(instruction.toLowerCase()).toContain('respond in english');
    });

    it('09 — Auto instruction tells model to match user language', () => {
      const instruction = buildLanguageInstruction('auto');
      expect(instruction.toLowerCase()).toContain('same language');
    });
  });

  describe('Identity brain — multilingual', () => {
    it('10 — Spanish "cual es tu nombre" → Spanish response', () => {
      const answer = resolveIVXIdentityAnswer('Cual es tu nombre?');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('Me llamo IVX IA');
    });

    it('11 — Spanish "quien es tu dueno" → Spanish response', () => {
      const answer = resolveIVXIdentityAnswer('quien es tu dueno');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('El dueño de IVXHOLDINGS');
    });

    it('12 — English "what is your name" → English response', () => {
      const answer = resolveIVXIdentityAnswer('What is your name?');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('My name is IVX IA');
    });

    it('13 — English "who is your owner" → English response', () => {
      const answer = resolveIVXIdentityAnswer('Who is your owner?');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('The owner of IVXHOLDINGS');
    });

    it('14 — Spanish "quien te creo" → Spanish response about Ivan Perez', () => {
      const answer = resolveIVXIdentityAnswer('quien te creo');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('Ivan Perez');
      expect(answer!).toContain('Fui creado por');
    });
  });

  describe('Conversation brain — multilingual', () => {
    it('15 — Spanish greeting "hola" → Spanish greeting response', () => {
      const answer = resolveIVXConversationAnswer('hola');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('¡Hola!');
      expect(answer!).toContain('IVX IA');
    });

    it('16 — English greeting "hello" → English greeting response', () => {
      const answer = resolveIVXConversationAnswer('hello');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('Hello!');
      expect(answer!).toContain('IVX IA');
    });

    it('17 — Spanish thanks "gracias" → Spanish thanks response', () => {
      const answer = resolveIVXConversationAnswer('gracias');
      expect(answer).not.toBeNull();
      expect(answer!).toContain('De nada');
    });

    it('18 — English thanks → English thanks response', () => {
      const answer = resolveIVXConversationAnswer('thank you');
      expect(answer).not.toBeNull();
      expect(answer!).toContain("You're welcome");
    });

    it('19 — Spanish math → Spanish result', () => {
      const answer = resolveIVXConversationAnswer('cuanto es 15 por 3');
      if (answer) expect(answer).toContain('45');
    });
  });

  describe('System prompt includes language instruction', () => {
    it('20 — buildSystemPrompt with Spanish message includes Spanish language instruction', () => {
      const prompt = buildSystemPrompt('test-session', false, [], null, null, 'Cual es tu nombre?');
      expect(prompt).toContain('LANGUAGE:');
      expect(prompt).toContain('español');
    });

    it('21 — buildSystemPrompt with English message includes English language instruction', () => {
      const prompt = buildSystemPrompt('test-session', false, [], null, null, 'What is your name?');
      expect(prompt).toContain('LANGUAGE:');
      expect(prompt.toLowerCase()).toContain('respond in english');
    });

    it('22 — buildSystemPrompt with no userMessage includes auto language instruction', () => {
      const prompt = buildSystemPrompt('test-session', false, [], null, null);
      expect(prompt).toContain('LANGUAGE:');
      expect(prompt.toLowerCase()).toContain('same language');
    });
  });
});

describe('IVX Normal Chat — No Routine Banners', () => {
  it('23 — Normal chat has no IVX AI WORKING banner text in system prompt', () => {
    const prompt = buildSystemPrompt('test-session', false, [], null, null, 'Hello');
    expect(prompt).not.toContain('IVX AI WORKING');
  });

  it('24 — Normal chat has no Still working banner text in system prompt', () => {
    const prompt = buildSystemPrompt('test-session', false, [], null, null, 'Hello');
    expect(prompt).not.toContain('Still working');
  });

  it('25 — Normal chat has no watchdog telemetry in system prompt', () => {
    const prompt = buildSystemPrompt('test-session', false, [], null, null, 'Hello');
    expect(prompt).not.toContain('watchdog');
    expect(prompt).not.toContain('BACKEND_POST_STARTED');
  });

  it('26 — IVXLiveTypingIndicator component file has no setInterval', async () => {
    const content = await Bun.file(repoFile('expo', 'components', 'IVXLiveTypingIndicator.tsx')).text();
    expect(content).not.toContain('setInterval');
    expect(content).not.toContain('useState');
    expect(content).not.toContain('useEffect');
  });

  it('27 — chat.tsx does NOT render IVXWatchdogBanner in normal chat', async () => {
    const content = await Bun.file(repoFile('expo', 'app', 'ivx', 'chat.tsx')).text();
    expect(content).not.toContain('<IVXWatchdogBanner onPress');
  });

  it('28 — chat.tsx does NOT render IVXStagedTimeoutBanner in normal chat', async () => {
    const content = await Bun.file(repoFile('expo', 'app', 'ivx', 'chat.tsx')).text();
    expect(content).not.toContain('<IVXStagedTimeoutBanner');
  });
});
