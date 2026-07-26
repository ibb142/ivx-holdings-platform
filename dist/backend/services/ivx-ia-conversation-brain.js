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
export function detectIVXConversationQuestion(message) {
    const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s+\-*/=.]/g, ' ');
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact)
        return 'none';
    // Math: "15 multiplied by 3", "15 * 3", "what is 15 x 3", "10 plus 5",
    // "100 minus 20", "50 divided by 2", "square root of 144"
    if (detectMathQuestion(compact))
        return 'math';
    // Greetings
    const greetings = ['hello', 'hi ', 'hey', 'hola', 'good morning', 'good afternoon', 'good evening', 'buenos dias', 'buenas tardes'];
    if (greetings.some((g) => compact === g.trim() || compact.startsWith(g) || compact === g.trim()))
        return 'greeting';
    // Thanks
    const thanks = ['thank you', 'thanks', 'gracias', 'much appreciated', 'ty '];
    if (thanks.some((t) => compact === t.trim() || compact.startsWith(t)))
        return 'thanks';
    // Capabilities / "what can you do"
    const capPhrases = ['what can you do', 'what do you do', 'help me with', 'your capabilities', 'what are your features', 'what are you able to do', 'que puedes hacer'];
    if (capPhrases.some((p) => compact.includes(p)))
        return 'capabilities';
    // Help
    if (compact === 'help' || compact.startsWith('help ') || compact.includes('can you help'))
        return 'help';
    return 'none';
}
/**
 * Detect and evaluate a math question.
 * Handles: plus, minus, multiplied by, times, divided by, x, *, /, +, -, sqrt.
 */
function detectMathQuestion(compact) {
    // Word-form arithmetic
    const wordMath = /\b(\d+(?:\.\d+)?)\s+(plus|minus|multiplied by|times|divided by|added to|subtracted from)\s+(\d+(?:\.\d+)?)/;
    if (wordMath.test(compact))
        return true;
    // Symbol-form arithmetic
    const symMath = /\b(\d+(?:\.\d+)?)\s*[+\-*/x]\s*(\d+(?:\.\d+)?)/;
    if (symMath.test(compact) && /\b(\d+(?:\.\d+)?)\s*[+\-*/x]\s*(\d+(?:\.\d+)?)/.test(compact))
        return true;
    // "what is N op N"
    if (/\bwhat is\s+/.test(compact) && wordMath.test(compact))
        return true;
    // square root
    if (/\b(square root|sqrt)\s+of\s+\d+/.test(compact))
        return true;
    return false;
}
/**
 * Evaluate a math expression from natural language.
 */
function evaluateMathQuestion(message) {
    const text = (message ?? '').toLowerCase().replace(/[^a-z0-9\s+\-*/=.]/g, ' ').replace(/\s+/g, ' ').trim();
    // square root
    const sqrtMatch = text.match(/(?:square root|sqrt)\s+of\s+(\d+(?:\.\d+)?)/);
    if (sqrtMatch) {
        const n = parseFloat(sqrtMatch[1]);
        return Math.sqrt(n);
    }
    // word-form
    const wordMatch = text.match(/(\d+(?:\.\d+)?)\s+(plus|minus|multiplied by|times|divided by|added to|subtracted from)\s+(\d+(?:\.\d+)?)/);
    if (wordMatch) {
        const a = parseFloat(wordMatch[1]);
        const op = wordMatch[2];
        const b = parseFloat(wordMatch[3]);
        switch (op) {
            case 'plus':
            case 'added to': return a + b;
            case 'minus':
            case 'subtracted from': return op === 'subtracted from' ? b - a : a - b;
            case 'multiplied by':
            case 'times': return a * b;
            case 'divided by': return b === 0 ? null : a / b;
        }
    }
    // symbol-form: "what is 15 x 3" / "15 * 3" / "10 + 5"
    const symMatch = text.match(/(\d+(?:\.\d+)?)\s*([+\-*/x])\s*(\d+(?:\.\d+)?)/);
    if (symMatch) {
        const a = parseFloat(symMatch[1]);
        const op = symMatch[2];
        const b = parseFloat(symMatch[3]);
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*':
            case 'x': return a * b;
            case '/': return b === 0 ? null : a / b;
        }
    }
    return null;
}
/**
 * Build the direct answer for a general conversation question.
 */
export function buildIVXConversationAnswer(message) {
    const type = detectIVXConversationQuestion(message);
    if (type === 'none')
        return null;
    switch (type) {
        case 'math': {
            const result = evaluateMathQuestion(message);
            if (result === null || !isFinite(result))
                return null;
            const formatted = Number.isInteger(result) ? String(result) : String(parseFloat(result.toFixed(6)));
            return `The answer is ${formatted}.`;
        }
        case 'greeting':
            return [
                'Hello! I am IVX IA, the AI brain for IVXHOLDINGS.',
                '',
                'I can answer any question you have — about IVXHOLDINGS, our projects, investments, returns, the platform, or anything else. What would you like to know?',
            ].join('\n');
        case 'thanks':
            return "You're welcome! I'm IVX IA — happy to help. Ask me anything else whenever you need.";
        case 'capabilities':
            return [
                'Here is what I can do as IVX IA:',
                '',
                '- Answer any question about IVXHOLDINGS — the company, projects, investments, ROI, risks, JV deals, private lenders, tokenization, wallets, withdrawals, and wires.',
                '- Have a regular conversation and answer general questions (math, definitions, how-to, advice).',
                '- Explain the investment process, minimum buy-ins, timelines, and expected returns for any project.',
                '- Operate as a Senior Developer (owner-gated) — audit code, architecture, Supabase, GitHub, Render, and propose exact patches.',
                '- Run owner-approved senior-developer tasks that commit, deploy, and return live proof.',
                '',
                'Nothing is off-limits. Just ask.',
            ].join('\n');
        case 'help':
            return [
                'I am IVX IA — here to help.',
                '',
                'You can ask me:',
                '- "What is your name?" or "Who created you?"',
                '- "Tell me about IVXHOLDINGS investments and projects"',
                '- "How do I invest?" or "What is the ROI?"',
                '- Any general question — math, definitions, advice, conversation.',
                '- "Are you in senior developer mode?" to check developer capabilities.',
                '',
                'What would you like to know?',
            ].join('\n');
        default:
            return null;
    }
}
/**
 * Full conversation-brain check. Returns the answer string if the message is a
 * general conversation question, or null if it should flow through the normal
 * chat path.
 */
export function resolveIVXConversationAnswer(message) {
    return buildIVXConversationAnswer(message);
}
