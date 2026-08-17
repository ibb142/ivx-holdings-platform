/**
 * IVX IA Identity Brain — direct, deterministic answers for identity, ownership,
 * and IVXHOLDINGS project/investment questions.
 *
 * Owner spec:
 *   - "what is your name" → "IVX IA"
 *   - "who is you / who created you / who made you" → "Ivan Perez, owner of IVXHOLDINGS"
 *   - The brain can have regular conversation and answer ANY type of question.
 *   - Questions about the IVXHOLDINGS project / investment are answered fully,
 *     never limited or refused.
 *
 * This is a fast, deterministic path: it never blocks, never asks for proof,
 * and never routes to the senior-developer worker. It is the IVX IA persona.
 *
 * QA 2026-07-07: Project and investment questions (ivx_project, ivx_investment)
 * are intentionally NOT intercepted here — they must reach the real AI gateway
 * with full business context (Casa Rosario ROI, price, location, timeline).
 * Only pure identity questions (name, creator, owner, what_is_ivx) use this path.
 */

import { detectMessageLanguage, type DetectedLanguage } from './ivx-language-detector';

export const IVX_IA_IDENTITY_NAME = 'IVX IA';
export const IVX_IA_OWNER_NAME = 'Ivan Perez';
export const IVX_IA_COMPANY = 'IVXHOLDINGS';
export const IVX_IA_IDENTITY_MARKER = 'ivx-ia-identity-brain-2026-07-07';

export type IVXIdentityQuestionType =
  | 'name'
  | 'creator'
  | 'owner'
  | 'what_is_ivx'
  | 'ivx_project'
  | 'ivx_investment'
  | 'none';

/**
 * Detect an identity / ownership / IVXHOLDINGS-project question.
 * Returns the question type or 'none'.
 */
export function detectIVXIdentityQuestion(message: string): IVXIdentityQuestionType {
  const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'none';

  // "what is your name" / "what's your name" / "your name" / "who are you called"
  const namePhrases = [
    'what is your name',
    'whats your name',
    'what s your name',
    'your name',
    'who are you called',
    'what are you called',
    'tell me your name',
    'say your name',
    'what should i call you',
    'how should i call you',
    'tu nombre',
    'cual es tu nombre',
  ];
  if (namePhrases.some((p) => compact.includes(p))) return 'name';

  // "who are you" (but not "who are you called" — handled above)
  if (/\bwho are you\b/.test(compact) && !/called/.test(compact)) return 'name';

  // "who created you" / "who made you" / "who built you" / "who is your creator"
  const creatorPhrases = [
    'who created you',
    'who made you',
    'who built you',
    'who designed you',
    'who developed you',
    'who programmed you',
    'who is your creator',
    'who is your maker',
    'who is your developer',
    'who is the creator',
    'who created ivx ia',
    'quien te creo',
    'quien te hizo',
  ];
  if (creatorPhrases.some((p) => compact.includes(p))) return 'creator';

  // "who is your owner" / "who owns you" / "who is the owner of ivx"
  const ownerPhrases = [
    'who is your owner',
    'who owns you',
    'who is the owner',
    'who is the owner of ivx',
    'who is the owner of ivxholdings',
    'who owns ivx',
    'who owns ivxholdings',
    'who is the founder',
    'who is the founder of ivx',
    'who is the boss',
    'who is ivan perez',
    'tell me about ivan perez',
    'quien es el dueno',
    'quien es el propietario',
    'quien es tu dueno',
    'quien es tu propietario',
    'quien es su dueno',
  ];
  if (ownerPhrases.some((p) => compact.includes(p))) return 'owner';

  // "what is ivx" / "what is ivxholdings" / "tell me about ivxholdings"
  const whatIsIvxPhrases = [
    'what is ivx',
    'what is ivxholdings',
    'what is ivx holdings',
    'what is ivx holding',
    'tell me about ivx',
    'tell me about ivxholdings',
    'tell me about ivx holdings',
    'about ivxholdings',
    'about ivx holdings',
    'about the company',
    'que es ivx',
    'que es ivxholdings',
  ];
  if (whatIsIvxPhrases.some((p) => compact.includes(p))) return 'what_is_ivx';

  // IVXHOLDINGS project / investment questions — answered fully, never limited.
  const projectPhrases = [
    'ivx project',
    'ivxholdings project',
    'ivx holdings project',
    'the project of ivx',
    'about the project',
    'tell me about the project',
    'what is the project',
    'casa rosario',
    'project in',
    'projects in',
    'real estate project',
    'real estate investment',
    'property project',
    'jv deal',
    'joint venture',
    'the deal',
    'about the deal',
    'tell me about the deal',
    'what deals',
    'what projects',
    'available deals',
    'available projects',
    'current deals',
    'current projects',
    'active deals',
    'active projects',
  ];
  if (projectPhrases.some((p) => compact.includes(p))) return 'ivx_project';

  // Investment questions — how to invest, returns, ROI, capital, etc.
  const investmentPhrases = [
    'how do i invest',
    'how to invest',
    'how can i invest',
    'i want to invest',
    'how i invest',
    'how to buy',
    'how can i buy',
    'i want to buy',
    'minimum investment',
    'minimum buy in',
    'minimum buy-in',
    'minimum to invest',
    'how much to invest',
    'how much do i need',
    'what is the roi',
    'what is the return',
    'what returns',
    'expected return',
    'expected roi',
    'capital investment',
    'invest in ivx',
    'invest in ivxholdings',
    'invest in real estate',
    'invest in property',
    'invest in a project',
    'invest in a deal',
    'investing basics',
    'is it safe to invest',
    'is ivx safe',
    'is ivxholdings safe',
    'is it legit',
    'is ivx legit',
    'is ivxholdings legit',
    'is ivxholdings real',
    'is ivx real',
    'how does investing work',
    'how does it work',
    'tell me about investing',
    'como invierto',
    'como invertir',
  ];
  if (investmentPhrases.some((p) => compact.includes(p))) return 'ivx_investment';

  return 'none';
}

/**
 * Build the direct answer for an identity / ownership / IVXHOLDINGS question.
 */
export function buildIVXIdentityAnswer(type: IVXIdentityQuestionType, language: DetectedLanguage = 'en'): string | null {
  const isSpanish = language === 'es';
  switch (type) {
    case 'name':
      return isSpanish ? [
        `Me llamo ${IVX_IA_IDENTITY_NAME}.`,
        '',
        `Soy el cerebro de IA interno de ${IVX_IA_COMPANY} — ayudo al dueño, inversores y equipo con preguntas de inversión inmobiliaria, información de proyectos, análisis de ofertas, operaciones de la plataforma y trabajo de desarrollo.`,
        '',
        'Puedo tener una conversación normal y responder cualquier tipo de pregunta. ¿Qué te gustaría saber?',
      ].join('\n') : [
        `My name is ${IVX_IA_IDENTITY_NAME}.`,
        '',
        `I am the in-house AI brain for ${IVX_IA_COMPANY} — I help the owner, investors, and team with real-estate investment questions, project information, deal analysis, platform operations, and senior-developer work.`,
        '',
        'I can have a regular conversation and answer any type of question you ask. What would you like to know?',
      ].join('\n');

    case 'creator':
      return isSpanish ? [
        `Fui creado por ${IVX_IA_OWNER_NAME}, el dueño y fundador de ${IVX_IA_COMPANY}.`,
        '',
        `Soy ${IVX_IA_IDENTITY_NAME} — el cerebro de IA que él construyó para operar la plataforma de inversión inmobiliaria de ${IVX_IA_COMPANY} de principio a fin: preguntas de inversores, análisis de ofertas, información de proyectos, trabajo de desarrollo y operaciones de la plataforma.`,
        '',
        'Pregúntame lo que quieras sobre IVXHOLDINGS, los proyectos o cómo invertir.',
      ].join('\n') : [
        `I was created by ${IVX_IA_OWNER_NAME}, the owner and founder of ${IVX_IA_COMPANY}.`,
        '',
        `I am ${IVX_IA_IDENTITY_NAME} — the AI brain he built to run ${IVX_IA_COMPANY}'s real-estate investment platform end to end: investor questions, deal analysis, project information, senior-developer work, and platform operations.`,
        '',
        'Ask me anything about IVXHOLDINGS, the projects, or how to invest.',
      ].join('\n');

    case 'owner':
      return isSpanish ? [
        `El dueño de ${IVX_IA_COMPANY} es ${IVX_IA_OWNER_NAME}.`,
        '',
        `Él es el fundador y dueño de ${IVX_IA_COMPANY}, una empresa de inversión inmobiliaria y de capital. Soy ${IVX_IA_IDENTITY_NAME}, el cerebro de IA que él creó para operar la plataforma — responder preguntas de inversores, analizar ofertas, compartir información de proyectos y gestionar el lado de desarrollo del negocio.`,
        '',
        `Si quieres saber más sobre ${IVX_IA_OWNER_NAME} o ${IVX_IA_COMPANY}, solo pregunta.`,
      ].join('\n') : [
        `The owner of ${IVX_IA_COMPANY} is ${IVX_IA_OWNER_NAME}.`,
        '',
        `He is the founder and owner of ${IVX_IA_COMPANY}, a real-estate / capital investment company. I am ${IVX_IA_IDENTITY_NAME}, the AI brain he created to operate the platform — answer investor questions, analyze deals, share project information, and run the senior-developer side of the business.`,
        '',
        `If you want to know more about ${IVX_IA_OWNER_NAME} or ${IVX_IA_COMPANY}, just ask.`,
      ].join('\n');

    case 'what_is_ivx':
      return [
        `${IVX_IA_COMPANY} is a real-estate and capital-investment company founded and owned by ${IVX_IA_OWNER_NAME}.`,
        '',
        'What IVXHOLDINGS does:',
        '- Acquires and operates premium real-estate projects (for example, Casa Rosario and other South Florida / international deals).',
        '- Opens those projects to qualified investors through a transparent platform — you can review the deal, the timeline, the return assumptions, and the risks before you commit.',
        '- Runs the full pipeline: deal sourcing, due diligence, capital raise, asset management, and investor reporting.',
        '',
        'I am IVX IA, the AI brain for IVXHOLDINGS. I can answer any question you have about the company, the projects, the investment process, the returns, or the platform — nothing is off-limits. Just ask.',
      ].join('\n');

    case 'ivx_project':
      return [
        `Here is what I can tell you about IVXHOLDINGS projects:`,
        '',
        'IVXHOLDINGS develops and operates premium real-estate projects. Each project on the platform has a full deal package — location, price, expected ROI, timeline, minimum ownership buy-in, project status, and media (photos/video/docs).',
        '',
        'A few things I can do for you right now:',
        '- Tell you which projects are currently available and their details.',
        '- Compare projects side by side and give you a buy/hold/avoid recommendation.',
        '- Walk you through the timeline, returns, and risks for any specific deal.',
        '- Explain how the ownership / capital structure works for a given project.',
        '',
        'I answer these questions fully — there is no limit. Which project would you like to know about, or would you like me to list the current ones?',
      ].join('\n');

    case 'ivx_investment':
      return [
        `Here is how investing with IVXHOLDINGS works:`,
        '',
        '1. Browse the available projects on the platform — each one shows location, price, expected ROI, timeline, minimum buy-in, and status.',
        '2. Review the full deal package: the timeline, the return assumptions, and the risks. Read the actual documents before you commit.',
        '3. When you are ready, you can request access to a specific deal and go through the investor-qualification step.',
        '4. After you are approved and funded, you receive investor reporting on the project through the platform.',
        '',
        'A few important points:',
        '- There is always a minimum investment / ownership buy-in per project — it is shown on the deal page.',
        '- Returns are projected, not guaranteed. Real estate carries risk. Never invest money you cannot afford to lock up for the project timeline.',
        '- IVXHOLDINGS is a real company owned by Ivan Perez. This is not a scam or a get-rich-quick scheme — it is a real-estate capital investment business.',
        '',
        'I can answer any question you have about investing, the returns, the risks, or a specific project. What would you like to dig into?',
      ].join('\n');

    default:
      return null;
  }
}

/**
 * Full identity+brain check. Returns the answer string if the message is a pure
 * identity/ownership question (name, creator, owner, what-is-IVX), or null if it
 * should flow through the normal AI gateway path.
 *
 * IMPORTANT: Project and investment questions (ivx_project, ivx_investment) are
 * intentionally NOT intercepted here. Those must reach the real AI gateway,
 * which has the full business context (Casa Rosario details, ROI, price, location,
 * timeline, risks) loaded per-request. Interception returned a generic canned
 * answer that blocked real deal-specific data from ever reaching the user.
 */
export function resolveIVXIdentityAnswer(message: string): string | null {
  const type = detectIVXIdentityQuestion(message);
  // Only intercept PURE identity questions (name, creator, owner, what-is-IVX).
  // Project, investment, capabilities, greeting, and help questions flow through
  // to the upgraded AI prompt for 10/10 ChatGPT-level responses.
  if (type === 'none' || type === 'ivx_project' || type === 'ivx_investment') {
    return null;
  }
  const language = detectMessageLanguage(message);
  return buildIVXIdentityAnswer(type, language);
}
