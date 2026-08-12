import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import { detectMessageLanguage, buildLanguageInstruction } from '../services/ivx-language-detector';
import { resolveIVXIdentityAnswer } from '../services/ivx-ia-identity-brain';
import { resolveIVXConversationAnswer } from '../services/ivx-ia-conversation-brain';
import { buildSystemPrompt } from '../public-chat-ai';

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const repoFile = (...segments: string[]) => path.join(repoRoot, ...segments);

describe('IVX Language Detection + Multilingual Response', () => {
  describe('detectMessageLanguage', () => {
    it('01 — Spanish prompt → detected as es', () => expect(detectMessageLanguage('Cual es tu nombre? Y quien es tu dueno')).toBe('es'));
    it('02 — English prompt → detected as en', () => expect(detectMessageLanguage('What is your name and who is your owner?')).toBe('en'));
    it('03 — Spanish with accents → detected as es', () => expect(detectMessageLanguage('¿Cuál es tu nombre? Y quién es tu dueño?')).toBe('es'));
    it('04 — Spanish greeting hola → detected as es', () => expect(detectMessageLanguage('Hola, quiero saber sobre inversiones')).toBe('es'));
    it('05 — English greeting hello → detected as en', () => expect(detectMessageLanguage('Hello, I want to know about investments')).toBe('en'));
    it('06 — Empty message → auto', () => expect(detectMessageLanguage('')).toBe('auto'));
  });

  describe('buildLanguageInstruction', () => {
    it('07 — Spanish instruction tells model to respond in Spanish', () => { const v = buildLanguageInstruction('es'); expect(v).toContain('español'); expect(v.toLowerCase()).toContain('responde en español'); });
    it('08 — English instruction tells model to respond in English', () => expect(buildLanguageInstruction('en').toLowerCase()).toContain('respond in english'));
    it('09 — Auto instruction tells model to match user language', () => expect(buildLanguageInstruction('auto').toLowerCase()).toContain('same language'));
  });

  describe('Identity brain — multilingual', () => {
    it('10 — Spanish name', () => expect(resolveIVXIdentityAnswer('Cual es tu nombre?')).toContain('Me llamo IVX IA'));
    it('11 — Spanish owner', () => expect(resolveIVXIdentityAnswer('quien es tu dueno')).toContain('El dueño de IVXHOLDINGS'));
    it('12 — English name', () => expect(resolveIVXIdentityAnswer('What is your name?')).toContain('My name is IVX IA'));
    it('13 — English owner', () => expect(resolveIVXIdentityAnswer('Who is your owner?')).toContain('The owner of IVXHOLDINGS'));
    it('14 — Spanish creator', () => { const v = resolveIVXIdentityAnswer('quien te creo'); expect(v).toContain('Ivan Perez'); expect(v).toContain('Fui creado por'); });
  });

  describe('Conversation brain — multilingual', () => {
    it('15 — Spanish greeting', () => { const v = resolveIVXConversationAnswer('hola'); expect(v).toContain('¡Hola!'); expect(v).toContain('IVX IA'); });
    it('16 — English greeting', () => { const v = resolveIVXConversationAnswer('hello'); expect(v).toContain('Hello!'); expect(v).toContain('IVX IA'); });
    it('17 — Spanish thanks', () => expect(resolveIVXConversationAnswer('gracias')).toContain('De nada'));
    it('18 — English thanks', () => expect(resolveIVXConversationAnswer('thank you')).toContain("You're welcome"));
    it('19 — Spanish math', () => { const v = resolveIVXConversationAnswer('cuanto es 15 por 3'); if (v) expect(v).toContain('45'); });
  });

  describe('System prompt includes language instruction', () => {
    it('20 — Spanish prompt', () => { const v = buildSystemPrompt('test-session', false, [], null, null, 'Cual es tu nombre?'); expect(v).toContain('LANGUAGE:'); expect(v).toContain('español'); });
    it('21 — English prompt', () => { const v = buildSystemPrompt('test-session', false, [], null, null, 'What is your name?'); expect(v).toContain('LANGUAGE:'); expect(v.toLowerCase()).toContain('respond in english'); });
    it('22 — Auto prompt', () => { const v = buildSystemPrompt('test-session', false, [], null, null); expect(v).toContain('LANGUAGE:'); expect(v.toLowerCase()).toContain('same language'); });
  });
});

describe('IVX Normal Chat — No Routine Banners', () => {
  it('23 — Normal chat has no IVX AI WORKING banner text in system prompt', () => expect(buildSystemPrompt('test-session', false, [], null, null, 'Hello')).not.toContain('IVX AI WORKING'));
  it('24 — Normal chat has no Still working banner text in system prompt', () => expect(buildSystemPrompt('test-session', false, [], null, null, 'Hello')).not.toContain('Still working'));
  it('25 — Normal chat has no watchdog telemetry in system prompt', () => { const v = buildSystemPrompt('test-session', false, [], null, null, 'Hello'); expect(v).not.toContain('watchdog'); expect(v).not.toContain('BACKEND_POST_STARTED'); });
  it('26 — IVXLiveTypingIndicator component file has no timer state', async () => { const content = await Bun.file(repoFile('expo', 'components', 'IVXLiveTypingIndicator.tsx')).text(); expect(content).not.toContain('setInterval'); expect(content).not.toContain('useState'); expect(content).not.toContain('useEffect'); });
  it('27 — chat.tsx does NOT render IVXWatchdogBanner in normal chat', async () => { const content = await Bun.file(repoFile('expo', 'app', 'ivx', 'chat.tsx')).text(); expect(content).not.toContain('<IVXWatchdogBanner onPress'); });
  it('28 — chat.tsx does NOT render IVXStagedTimeoutBanner in normal chat', async () => { const content = await Bun.file(repoFile('expo', 'app', 'ivx', 'chat.tsx')).text(); expect(content).not.toContain('<IVXStagedTimeoutBanner'); });
});
