/**
 * Lightweight language detection for IVX IA chat.
 *
 * Detects the language of the user's current message so the AI can respond
 * in the same language. Uses script + keyword heuristics — no external
 * dependency, no network call, deterministic.
 *
 * Supported detection: Spanish, English, and a generic fallback that lets
 * the underlying LLM choose naturally (the model is multilingual).
 */

export type DetectedLanguage = 'es' | 'en' | 'auto';

/**
 * Detect the language of a user message.
 *
 * Strategy:
 * 1. Count Spanish-specific accented characters and common Spanish words.
 * 2. Count English-specific common words.
 * 3. If the message has Spanish accented chars or enough Spanish keywords → 'es'.
 * 4. If clearly English → 'en'.
 * 5. Otherwise → 'auto' (let the model decide).
 */
export function detectMessageLanguage(message: string): DetectedLanguage {
  const text = (message ?? '').toLowerCase().trim();
  if (!text) return 'auto';

  // Spanish-specific accented characters / ñ / ¿ ¡
  const hasSpanishAccents = /[áéíóúñ¿¡ü]/i.test(message);
  if (hasSpanishAccents) return 'es';

  // Common Spanish question / conversational words.
  // IMPORTANT: short words like 'es', 'mi', 'tu', 'su', 'son' must use word
  // boundary matching — otherwise 'es' matches inside 'estate', 'houses',
  // 'is'; 'su' matches inside 'surface', 'measure'; etc.
  const spanishKeywords = [
    'cual', 'cuál', 'quien', 'quién', 'qué', 'como', 'cómo',
    'donde', 'dónde', 'cuando', 'cuándo', 'por qué',
    'hola', 'buenos dias', 'buenas tardes', 'buenas noches',
    'gracias', 'por favor', 'de nada', 'nombre', 'dueno', 'dueño',
    'propietario', 'empresa', 'inversión', 'proyecto',
    'dime', 'quiero', 'necesito', 'puedes', 'está',
    'nuestra', 'nuestro',
    'dinero', 'casa', 'propiedad', 'invertir', 'ganancia',
    'respuesta', 'ayuda', 'entiendo', 'hablas', 'español',
  ];
  // Short Spanish words that need word-boundary matching
  const spanishWordBoundary = ['es', 'mi', 'tu', 'su', 'son', 'que', 'esta'];

  const spanishSubstringMatches = spanishKeywords.filter((kw) => text.includes(kw)).length;
  const spanishBoundaryMatches = spanishWordBoundary.filter((kw) => new RegExp(`\b${kw}\b`).test(text)).length;
  const spanishMatches = spanishSubstringMatches + spanishBoundaryMatches;
  if (spanishMatches >= 2) return 'es';

  // Common English question / conversational words
  const englishKeywords = [
    'what', 'who', 'how', 'where', 'when', 'why',
    'hello', 'hi', 'hey', 'good morning', 'good afternoon',
    'thank', 'please', 'name', 'owner', 'company',
    'invest', 'project', 'property', 'tell me', 'can you',
    'money', 'house', 'return', 'help', 'understand',
    'english', 'language',
  ];
  // Short English words that need word-boundary matching
  const englishWordBoundary = ['is', 'are', 'the', 'my', 'your', 'our'];

  const englishSubstringMatches = englishKeywords.filter((kw) => text.includes(kw)).length;
  const englishBoundaryMatches = englishWordBoundary.filter((kw) => new RegExp(`\b${kw}\b`).test(text)).length;
  const englishMatches = englishSubstringMatches + englishBoundaryMatches;
  if (englishMatches >= 2) return 'en';

  // Single keyword match — lean toward that language
  if (spanishMatches === 1 && englishMatches === 0) return 'es';
  if (englishMatches === 1 && spanishMatches === 0) return 'en';

  return 'auto';
}

/**
 * Build a language instruction string for the system prompt.
 * Tells the model to respond in the user's language.
 */
export function buildLanguageInstruction(language: DetectedLanguage): string {
  switch (language) {
    case 'es':
      return 'LANGUAGE: Responde en español. El usuario escribe en español — responde naturalmente en español. Mantén el mismo idioma que el usuario. Si el usuario cambia a inglés en un mensaje posterior, cambia al inglés.';
    case 'en':
      return 'LANGUAGE: Respond in English. The user writes in English — respond naturally in English. Match the user\'s language. If the user switches to Spanish in a follow-up message, switch to Spanish.';
    case 'auto':
      return 'LANGUAGE: Respond in the same language the user uses. If the user writes in Spanish, respond in Spanish. If in English, respond in English. Always match the user\'s language naturally — never force English when the user writes in another language.';
  }
}
