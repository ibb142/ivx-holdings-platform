export type IVXChatQualitySeverity = 'pass' | 'warning' | 'critical';

export type IVXChatQualityDecision = {
  allow: boolean;
  severity: IVXChatQualitySeverity;
  code: 'PASS' | 'STALE_DUPLICATE_RESPONSE' | 'INTENT_TOPIC_MISMATCH' | 'EMPTY_RESPONSE';
  score: number;
  reasons: string[];
};

export type IVXChatQualityInput = {
  ownerText: string;
  assistantText: string;
  previousOwnerText?: string | null;
  previousAssistantTexts?: string[];
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

const TECHNICAL_TERMS = [
  'autonomous', 'nervous', 'quality', 'qa', 'code', 'chat', 'github', 'render',
  'deploy', 'deployment', 'apk', 'dashboard', 'error', 'fix', 'worker', 'agent',
  'live', 'status', 'telemetry', 'radar', 'memory', 'requestid', 'traceid',
] as const;

const PROPERTY_TERMS = [
  'property', 'properties', 'propiedad', 'propiedades', 'deal', 'deals',
  'investment', 'investor', 'real estate', 'house', 'houses', 'residence',
] as const;

const GREETING_TERMS = [
  'hi', 'hello', 'hey', 'hola', 'are you live', 'do you live', 'estas live', 'estás live',
] as const;

/**
 * Fail-closed, deterministic quality firewall for IVX Owner AI turns.
 *
 * This is intentionally conservative: it blocks only high-confidence stale or
 * cross-topic replies that are known to be dangerous for an owner/developer
 * control room. It does not attempt to replace the model with a second model.
 */
export function evaluateIVXChatQualityFirewall(input: IVXChatQualityInput): IVXChatQualityDecision {
  const owner = normalize(input.ownerText);
  const answer = normalize(input.assistantText);
  const previousOwner = normalize(input.previousOwnerText);
  const previousAnswers = (input.previousAssistantTexts ?? []).map(normalize).filter(Boolean);
  const reasons: string[] = [];

  if (!answer) {
    return { allow: false, severity: 'critical', code: 'EMPTY_RESPONSE', score: 0, reasons: ['assistant response is empty'] };
  }

  const ownerTechnical = containsAny(owner, TECHNICAL_TERMS);
  const ownerProperty = containsAny(owner, PROPERTY_TERMS);
  const ownerGreeting = GREETING_TERMS.some((term) => owner === term || owner.startsWith(`${term} `));
  const answerTechnical = containsAny(answer, TECHNICAL_TERMS);
  const answerProperty = containsAny(answer, PROPERTY_TERMS);

  // Known high-risk contamination class: a technical/control-room or greeting
  // prompt receiving a property/deal answer with no property intent in the
  // current owner turn (e.g. "Where is Autonomous?" -> "3 active properties").
  if ((ownerTechnical || ownerGreeting) && !ownerProperty && answerProperty && !answerTechnical) {
    reasons.push('current owner intent is technical/greeting but response is property/deal scoped');
    return { allow: false, severity: 'critical', code: 'INTENT_TOPIC_MISMATCH', score: 10, reasons };
  }

  const exactPrevious = previousAnswers.some((previous) => previous.length >= 24 && previous === answer);
  const promptChanged = Boolean(previousOwner && owner && previousOwner !== owner);
  if (exactPrevious && promptChanged) {
    reasons.push('assistant response exactly repeats a previous answer after the owner prompt changed');
    return { allow: false, severity: 'critical', code: 'STALE_DUPLICATE_RESPONSE', score: 15, reasons };
  }

  // A softer mismatch is recorded but allowed. This keeps the firewall from
  // creating false positives for legitimate mixed technical/business replies.
  let score = 100;
  if (ownerTechnical && !answerTechnical && !ownerProperty) {
    score = 70;
    reasons.push('technical owner intent has weak technical evidence in the answer');
    return { allow: true, severity: 'warning', code: 'PASS', score, reasons };
  }

  return { allow: true, severity: 'pass', code: 'PASS', score, reasons };
}
