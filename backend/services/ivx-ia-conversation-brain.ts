/**
 * IVX IA Conversation Brain — general-purpose, owner-token-gated direct answers.
 *
 * Owner spec:
 *   - The brain can have regular conversation and answer ANY type of question.
 *   - If it can be answered deterministically (math, general knowledge, greeting,
 *     help, capabilities), answer directly — never route to the bearer-guarded
 *     pipeline that returns 401 for owner-token-only requests.
 *
 * This is a fast, deterministic path that runs AFTER the identity/senior-dev
 * brains but BEFORE the Supabase-bearer-guarded main pipeline. It never blocks
 * and never asks for proof — it is the IVX IA conversational persona.
 */

export const IVX_IA_CONVERSATION_MARKER = 'ivx-ia-conversation-brain-2026-07-06';

/**
 * Detect a general conversation question that can be answered deterministically.
 * Returns the question type or 'none'.
 */
export type IVXConversationType =
  | 'math'
  | 'percentage'
  | 'greeting'
  | 'thanks'
  | 'capabilities'
  | 'help'
  | 'yes_no'
  | 'definition'
  | 'none';

export function detectIVXConversationQuestion(message: string): IVXConversationType {
  const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s+\-*/=.%]/g, ' ');
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'none';
  if (/\breturn\s+(?:the\s+)?(?:exact\s+)?token\b/i.test(compact) || /\bIVX-LIVE-[0-9]+-\d+\b/i.test(compact)) return 'none';
  if (/^yes\s+or\s+no\b/.test(compact)) return 'yes_no';
  if (detectMathQuestion(compact)) return 'math';
  if (detectPercentageQuestion(compact)) return 'percentage';
  if (detectYesNoQuestion(compact)) return 'yes_no';
  if (detectDefinitionQuestion(compact)) return 'definition';
  const greetings = ['hello', 'hi ', 'hey', 'hola', 'good morning', 'good afternoon', 'good evening', 'buenos dias', 'buenas tardes', 'good night', 'buenas noches'];
  if (greetings.some((g) => compact === g.trim() || compact.startsWith(g) || compact === g.trim())) return 'greeting';
  const thanks = ['thank you', 'thanks', 'gracias', 'much appreciated', 'ty '];
  if (thanks.some((t) => compact === t.trim() || compact.startsWith(t))) return 'thanks';
  const capPhrases = ['what can you do', 'what do you do', 'help me with', 'your capabilities', 'what are your features', 'what are you able to do', 'que puedes hacer'];
  if (capPhrases.some((p) => compact.includes(p))) return 'capabilities';
  if (compact === 'help' || compact.startsWith('help ') || compact.includes('can you help')) return 'help';
  return 'none';
}

function detectMathQuestion(compact: string): boolean {
  if (/\b(work|operate|run|available)\b.*\b(24\s*7|24\/7)\b|\b(24\s*7|24\/7)\b.*\b(work|operate|run|available)\b/.test(compact)) return false;
  const wordMath = /\b(\d+(?:\.\d+)?)\s+(plus|minus|multiplied by|times|divided by|added to|subtracted from)\s+(\d+(?:\.\d+)?)/;
  if (wordMath.test(compact)) return true;
  const symMath = /\b(\d+(?:\.\d+)?)\s*[+\-*/x]\s*(\d+(?:\.\d+)?)/;
  if (symMath.test(compact)) return true;
  if (/\bwhat is\s+/.test(compact) && wordMath.test(compact)) return true;
  if (/\b(square root|sqrt)\s+of\s+\d+/.test(compact)) return true;
  return false;
}

function detectPercentageQuestion(compact: string): boolean {
  return /\b\d+(?:\.\d+)?\s*(%|percent)\s+of\s+\d+/i.test(compact);
}

function evaluatePercentageQuestion(message: string): number | null {
  const text = (message ?? '').toLowerCase().replace(/[$,€£¥]/g, '').replace(/[^a-z0-9\s%.]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const pct = parseFloat(match[1]);
  const base = parseFloat(match[2]);
  if (!isFinite(pct) || !isFinite(base)) return null;
  return (pct / 100) * base;
}

function detectYesNoQuestion(compact: string): boolean {
  return /^(is|are|can|do|does|will|should|has|have)\b/.test(compact) && compact.length < 120;
}

function answerYesNoQuestion(message: string): string | null {
  const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(is|are)\b.*\b(reit|dst|1031)\b/.test(text)) return 'No, IVX Holdings is not a REIT or DST. IVX is a real-estate joint-venture platform that offers fractional ownership in specific projects, not a traded trust entity.';
  if (/\bcan\b.*\b(invest|buy|participate)\b/.test(text)) return 'Yes, you can invest through IVX Holdings by reviewing available projects and participating with fractional ownership. Visit ivxholding.com to see current offerings.';
  if (/\b(does|do)\b.*\b(tokeniz|wallet|withdraw|wire)/.test(text)) return 'Yes, IVX Holdings supports tokenization, wallet management, withdrawals, and wire transfers for qualified investors.';
  if (/\b(is|are)\b.*\b(legit|safe|secure|regulated)\b/.test(text)) return 'Yes, IVX Holdings operates with proper corporate structure and compliance. All investments are documented through formal JV agreements.';
  if (/\bcan\b.*\b(work|operate|run|function)\b.*\b(24\s*7|around the clock|all day|nonstop|continuously)\b/.test(text)) return 'Yes, IVX IA can work 24/7. The AI brain is always available to answer questions, analyze deals, and assist investors — no business hours required.';
  return null;
}

function detectDefinitionQuestion(compact: string): boolean {
  return /^(what is|what are|what does|define|explain)\b/.test(compact) && compact.length < 150;
}

function answerDefinitionQuestion(message: string): string | null {
  const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const definitions: Array<{ terms: string[]; answer: string }> = [
    { terms: ['reit'], answer: 'A REIT (Real Estate Investment Trust) is a company that owns, operates, or finances income-generating real estate. Investors buy shares and receive dividends, but do not directly own the properties.' },
    { terms: ['dst'], answer: 'A DST (Delaware Statutory Trust) is a legal entity used for 1031 exchanges, allowing investors to exchange one property for fractional interests in multiple properties without immediate capital gains tax.' },
    { terms: ['jv', 'joint venture'], answer: 'A JV (Joint Venture) is a business arrangement where two or more parties pool resources for a specific project. In real estate, JVs combine capital, expertise, and property ownership.' },
    { terms: ['1031'], answer: 'A 1031 exchange is a tax-deferred swap of investment properties under IRC Section 1031, allowing investors to defer capital gains taxes when reinvesting proceeds into a like-kind property.' },
    { terms: ['fractional', 'fractional ownership'], answer: 'Fractional ownership allows multiple investors to share ownership of a single asset, each holding a percentage. It reduces the minimum investment and diversifies risk.' },
    { terms: ['tokeniz', 'tokenization'], answer: 'Tokenization is the process of representing ownership rights as digital tokens on a blockchain, enabling fractional ownership and easier transfer of real estate interests.' },
    { terms: ['cap rate', 'capitalization rate'], answer: 'Cap rate (capitalization rate) is the ratio of net operating income to property value, expressed as a percentage. It measures the potential return on a real estate investment.' },
    { terms: ['roi', 'return on investment'], answer: 'ROI (Return on Investment) measures the profitability of an investment relative to its cost, expressed as a percentage. In real estate, it includes rental income plus appreciation.' },
    { terms: ['irr', 'internal rate of return'], answer: 'IRR (Internal Rate of Return) is the annualized rate of return that makes the net present value of all cash flows equal zero. It accounts for the time value of money in real estate projections.' },
    { terms: ['waterfall', 'waterfall distribution'], answer: 'A waterfall distribution is a tiered allocation of profits in a real estate JV. Returns are distributed in priority order: capital returned first, then preferred return, then sponsor promote, then remaining split.' },
    { terms: ['preferred return', 'pref'], answer: 'A preferred return (pref) is a minimum return percentage promised to investors before the sponsor receives their promote. Common in real estate JVs, typically 6-10% annually.' },
    { terms: ['promote', 'sponsor promote'], answer: 'Sponsor promote is the performance fee earned by the JV sponsor for exceeding the preferred return. It aligns sponsor and investor incentives — the sponsor earns more when returns are higher.' },
    { terms: ['k1', 'schedule k-1'], answer: 'A Schedule K-1 is a tax form reporting each partner\'s share of income, losses, deductions, and credits from a partnership. Real estate JV investors receive K-1s annually for tax filing.' },
    { terms: ['accredited investor'], answer: 'An accredited investor is an individual with net worth over $1M (excluding primary residence) or annual income over $200K ($300K joint). Many private real estate offerings require accredited investor status.' },
  ];
  for (const def of definitions) if (def.terms.some((t) => text.includes(t))) return def.answer;
  return null;
}

function evaluateMathQuestion(message: string): number | null {
  const text = (message ?? '').toLowerCase().replace(/[$,€£¥]/g, '').replace(/[^a-z0-9\s+\-*/=.]/g, ' ').replace(/\s+/g, ' ').trim();
  const sqrtMatch = text.match(/(?:square root|sqrt)\s+of\s+(\d+(?:\.\d+)?)/);
  if (sqrtMatch) return Math.sqrt(parseFloat(sqrtMatch[1]));
  const wordMatch = text.match(/(\d+(?:\.\d+)?)\s+(plus|minus|multiplied by|times|divided by|added to|subtracted from)\s+(\d+(?:\.\d+)?)/);
  if (wordMatch) {
    const a = parseFloat(wordMatch[1]); const op = wordMatch[2]; const b = parseFloat(wordMatch[3]);
    switch (op) { case 'plus': case 'added to': return a + b; case 'minus': case 'subtracted from': return op === 'subtracted from' ? b - a : a - b; case 'multiplied by': case 'times': return a * b; case 'divided by': return b === 0 ? null : a / b; }
  }
  const symMatch = text.match(/(\d+(?:\.\d+)?)\s*([+\-*/x])\s*(\d+(?:\.\d+)?)/);
  if (symMatch) {
    const a = parseFloat(symMatch[1]); const op = symMatch[2]; const b = parseFloat(symMatch[3]);
    switch (op) { case '+': return a + b; case '-': return a - b; case '*': case 'x': return a * b; case '/': return b === 0 ? null : a / b; }
  }
  return null;
}

import { detectMessageLanguage } from './ivx-language-detector';

export function buildIVXConversationAnswer(message: string): string | null {
  const type = detectIVXConversationQuestion(message);
  if (type === 'none') return null;
  const isSpanish = detectMessageLanguage(message) === 'es';
  switch (type) {
    case 'math': {
      const result = evaluateMathQuestion(message); if (result === null || !isFinite(result)) return null;
      const formatted = Number.isInteger(result) ? String(result) : String(parseFloat(result.toFixed(6)));
      return isSpanish ? `El resultado es ${formatted}.` : `The answer is ${formatted}.`;
    }
    case 'percentage': {
      const result = evaluatePercentageQuestion(message); if (result === null || !isFinite(result)) return null;
      const formatted = Number.isInteger(result) ? String(result) : String(parseFloat(result.toFixed(2)));
      const hasDollar = /\$/.test(message);
      if (hasDollar && Number.isInteger(result)) return isSpanish ? `El resultado es $${result.toLocaleString('en-US')}.` : `The answer is $${result.toLocaleString('en-US')}.`;
      return isSpanish ? `El resultado es ${formatted}.` : `The answer is ${formatted}.`;
    }
    case 'yes_no': return answerYesNoQuestion(message);
    case 'definition': return answerDefinitionQuestion(message);
    case 'greeting':
      return isSpanish ? '¡Hola! Soy IVX IA. ¿Cómo puedo ayudarte hoy?' : 'Hello! I am IVX IA. How can I help you today?';
    case 'thanks':
      return isSpanish ? '¡De nada! Soy IVX IA — feliz de ayudar. Pregúntame lo que quieras cuando lo necesites.' : "You're welcome! I'm IVX IA — happy to help. Ask me anything else whenever you need.";
    case 'capabilities':
      return isSpanish
        ? 'IVX IA puede ayudarte con inversiones, análisis de proyectos, cálculos, investigación, operaciones de IVX y tareas de desarrollo autorizadas.'
        : 'IVX IA can help with investments, project analysis, calculations, research, IVX operations, and authorized development tasks.';
    case 'help':
      return isSpanish ? ['Soy IVX IA — aquí para ayudar.','','Puedes preguntarme:','- "¿Cuál es tu nombre?" o "¿Quién te creó?"','- "Cuéntame sobre las inversiones y proyectos de IVXHOLDINGS"','- "¿Cómo invierto?" o "¿Cuál es el ROI?"','- Cualquier pregunta general — matemáticas, definiciones, consejos, conversación.','- "¿Estás en modo desarrollador senior?" para verificar capacidades de desarrollo.','','¿Qué te gustaría saber?'].join('\n') : ['I am IVX IA — here to help.','','You can ask me:','- "What is your name?" or "Who created you?"','- "Tell me about IVXHOLDINGS investments and projects"','- "How do I invest?" or "What is the ROI?"','- Any general question — math, definitions, advice, conversation.','- "Are you in senior developer mode?" to check developer capabilities.','','What would you like to know?'].join('\n');
    default: return null;
  }
}

export function resolveIVXConversationAnswer(message: string): string | null {
  return buildIVXConversationAnswer(message);
}
