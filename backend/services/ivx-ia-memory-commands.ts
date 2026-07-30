/**
 * IVX IA Brain Memory — natural-language command parsing + greeting builder.
 *
 * Parses the owner/user memory commands:
 *   - "remember my name is ___"            → set the caller's own name
 *   - "remember this user is ___"          → set a name (owner managing a user)
 *   - "change my name to ___"              → rename the caller
 *   - "forget this name" / "forget my name"→ clear the remembered name
 *   - "show what you remember"             → recall the stored profile
 *
 * And builds the cross-conversation greeting:
 *   "Good morning Ivan Perez. IVX IA is ready."
 */
import {
  IVX_IA_NAME,
  deleteProfile,
  forgetName,
  getProfile,
  isSensitiveValue,
  listProfiles,
  upsertProfile,
  type UserProfile,
} from './ivx-ia-memory-store';

export type MemoryCommandKind =
  | 'remember_name'
  | 'change_name'
  | 'forget_name'
  | 'show_memory';

export type MemoryCommand = {
  kind: MemoryCommandKind;
  /** The extracted name value, when the command carries one. */
  value: string;
};

// Memory read patterns: the owner asks IVX IA to recall what it remembers.
const SHOW_MEMORY_PATTERNS: readonly RegExp[] = [
  /\bwhat\s+is\s+my\s+name\b/i,
  /\bwho\s+am\s+i\b/i,
  /\bdo\s+you\s+(?:know|remember)\s+me\b/i,
  /\bshow\s+(?:me\s+)?what\s+you\s+remember\b/i,
  /\bwhat\s+do\s+you\s+remember\b/i,
  /\bshow\s+(?:my\s+)?(?:memory|profile)\b/i,
  /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
];

// Memory write patterns: the owner tells IVX IA to remember identity data.
// These patterns are intentionally broad so common phrasing like "my name is X"
// or "save this now" are captured and not misclassified as clarification.
const REMEMBER_NAME_PATTERNS: readonly RegExp[] = [
  /\b(?:remember|save)\s+(?:that\s+)?my\s+name\s+is\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i,
  /\bmy\s+name\s+is\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i,
  /\b(?:save|remember|store)\s+my\s+name\s+as\s+(.+)$/i,
  /\b(?:remember|save)\s+(?:that\s+)?this\s+user\s+(?:is|name\s+is|is\s+called)\s+(.+)$/i,
  /\b(?:remember|save)\s+(?:that\s+)?i\s*['’]?m\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i,
  /\b(?:remember|save)\s+(?:that\s+)?i\s+(?:work\s+at|am\s+(?:the\s+)?(?:owner|ceo|founder)\s+of)\s+(.+)$/i,
  /\b(?:remember|save)\s+(?:that\s+)?my\s+(?:company|role|email|language)\s+is\s+(.+)$/i,
  /\bmy\s+(?:company|role|email|language)\s+is\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  /\bmy\s+preferred\s+(?:language|name|company|role|email)\s+is\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  /\bi\s+prefer\s+to\s+be\s+called\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  /\bi\s+(?:work\s+at|am\s+(?:the\s+)?(?:owner|ceo|founder)\s+of)\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  /\bmy\s+(?:company|role|email|language)\s+is\s+.{2,60}?\b(?:and\s+)?(?:i\s+prefer\s+to\s+be\s+called|call\s+me|my\s+name\s+is)\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
];

const CHANGE_NAME_PATTERNS: readonly RegExp[] = [
  /\b(?:change|update)\s+my\s+name\s+to\s+(.+)$/i,
  /\bcall\s+me\s+(.+)$/i,
];

const FORGET_NAME_PATTERNS: readonly RegExp[] = [
  /\bforget\s+(?:this|my)\s+name\b/i,
  /\bforget\s+who\s+i\s+am\b/i,
];

/** Return true if the prompt is clearly a save/remember request about identity. */
function isMemorySaveRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(?:remember|remembering|save|saving|store|storing)\s+/.test(lower)
    && /\b(?:my\s+name|i\s*['’]?m|i\s+am|who\s+i\s+am|my\s+(?:company|role|email|language))\b/.test(lower);
}

/** Truncate an extracted value at any trailing save/remember/request phrase.
 *  Also strips leading punctuation (period, comma) left behind when the phrase
 *  follows a sentence boundary — e.g. "Ivan. Please save and remember" → "Ivan". */
function truncateAtSavePhrase(value: string): string {
  const stopWords = [
    'can you save', 'save this', 'remember this', 'store this',
    'save it', 'remember it', 'store it', 'save now', 'remember now', 'store now',
    'please save', 'please remember', 'please store',
    'save and remember', 'remember and save', 'save and store',
    'please save and remember', 'please remember and save',
    'and remember this', 'and save this', 'and store this',
    'and remember it', 'and save it', 'and store it',
    'remember this', 'save this', 'store this',
  ];
  const lower = value.toLowerCase();
  let cutAt = value.length;
  for (const phrase of stopWords) {
    const idx = lower.indexOf(phrase);
    if (idx >= 0 && idx < cutAt) cutAt = idx;
  }
  let result = value.slice(0, cutAt).trim();
  // Strip trailing punctuation left behind after truncation
  result = result.replace(/[.,;:!?]+$/g, '').trim();
  return result;
}

/** Extend the generic name extraction with a fallback for "save this now" + identity phrases.
 *  Handles compound identity like "my company is X and I prefer to be called Y, remember this". */
function extractIdentityValue(text: string): string | null {
  const lower = text.toLowerCase();
  let raw: string | null = null;
  // Compound: "my company is X and I prefer to be called Y" → extract Y (the name)
  if (lower.includes('prefer to be called') || lower.includes('call me')) {
    const match = text.match(/\b(?:prefer\s+to\s+be\s+called|call\s+me)\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i);
    if (match && match[1]) raw = match[1];
  }
  if (!raw && lower.includes('my name is')) {
    const match = text.match(/\bmy\s+name\s+is\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i);
    if (match && match[1]) raw = match[1];
  }
  if (!raw && (lower.includes('i am') || lower.includes('i\'m') || lower.includes('i’m'))) {
    const match = text.match(/\bi\s*['’]?m\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i);
    if (match && match[1]) raw = match[1];
  }
  if (!raw && (lower.includes('work at') || /\b(?:owner|ceo|founder)\s+of\b/.test(lower))) {
    const match = text.match(/\b(?:work\s+at|(?:owner|ceo|founder)\s+of)\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i);
    if (match && match[1]) raw = match[1];
  }
  if (!raw) return null;
  return cleanName(truncateAtSavePhrase(raw));
}

function cleanName(raw: string): string {
  return raw
    .trim()
    .replace(/^["“']+|["”'.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Detect a memory command in the user's prompt. Returns null when the prompt is
 * not a memory command (so the normal AI flow continues untouched).
 *
 * This runs BEFORE the generic execution/knowledge classifier so memory phrases
 * ("save my name", "what is my name") are never misrouted to clarification.
 */
export function parseMemoryCommand(prompt: string): MemoryCommand | null {
  const text = prompt.trim();
  if (!text) return null;

  for (const re of FORGET_NAME_PATTERNS) {
    if (re.test(text)) return { kind: 'forget_name', value: '' };
  }
  for (const re of SHOW_MEMORY_PATTERNS) {
    if (re.test(text)) return { kind: 'show_memory', value: '' };
  }
  for (const re of CHANGE_NAME_PATTERNS) {
    const match = text.match(re);
    if (match && match[1]) {
      const value = cleanName(truncateAtSavePhrase(match[1]));
      if (value) return { kind: 'change_name', value };
    }
  }
  for (const re of REMEMBER_NAME_PATTERNS) {
    const match = text.match(re);
    if (match && match[1]) {
      const value = cleanName(truncateAtSavePhrase(match[1]));
      if (value) return { kind: 'remember_name', value };
    }
  }

  // Fallback: broad "save/remember this now" + identity phrase detector.
  // Catches phrasing like "I will tell you ... save this now" which is a clear
  // memory write intent even when the exact regexes above miss it.
  if (isMemorySaveRequest(text)) {
    const value = extractIdentityValue(text);
    if (value) return { kind: 'remember_name', value };
  }

  return null;
}

export type MemoryCommandResult = {
  answer: string;
  profile: UserProfile | null;
  command: MemoryCommandKind;
};

/**
 * Execute a parsed memory command against the durable store and return a natural
 * confirmation the user sees in chat.
 */
export async function executeMemoryCommand(
  userId: string,
  command: MemoryCommand,
): Promise<MemoryCommandResult> {
  switch (command.kind) {
    case 'remember_name':
    case 'change_name': {
      if (isSensitiveValue(command.value)) {
        return {
          answer: `I won't store that — it looks sensitive. ${IVX_IA_NAME} only remembers your name, company, role, language and preferred greeting.`,
          profile: await getProfile(userId),
          command: command.kind,
        };
      }
      const result = await upsertProfile(userId, { fullName: command.value });
      if (!result.ok) {
        return { answer: result.error, profile: await getProfile(userId), command: command.kind };
      }
      const verb = command.kind === 'change_name' ? 'updated your name to' : 'will remember that your name is';
      return {
        answer: `Done. ${IVX_IA_NAME} ${verb} ${result.profile.fullName}. I'll greet you by name in every new conversation.`,
        profile: result.profile,
        command: command.kind,
      };
    }
    case 'forget_name': {
      const profile = await forgetName(userId);
      return {
        answer: `Done. ${IVX_IA_NAME} has forgotten your name. Everything else in your profile is unchanged.`,
        profile,
        command: command.kind,
      };
    }
    case 'show_memory': {
      const profile = await getProfile(userId);
      return { answer: describeProfile(profile), profile, command: command.kind };
    }
    default:
      return { answer: '', profile: null, command: command.kind };
  }
}

/** Human-readable recall of everything IVX IA remembers about a user. */
export function describeProfile(profile: UserProfile): string {
  const lines: string[] = [`Here's what ${IVX_IA_NAME} remembers about you:`];
  lines.push(`• Name: ${profile.fullName || '(not set)'}`);
  if (profile.preferredName && profile.preferredName !== profile.fullName) {
    lines.push(`• Preferred name: ${profile.preferredName}`);
  }
  lines.push(`• Company: ${profile.company || '(not set)'}`);
  lines.push(`• Role: ${profile.role || '(not set)'}`);
  if (profile.email) lines.push(`• Email: ${profile.email}`);
  lines.push(`• Language: ${profile.language}`);
  lines.push(`• Greeting style: ${profile.greetingStyle}`);
  if (profile.lastSeenAt) lines.push(`• Last seen: ${profile.lastSeenAt}`);
  return lines.join('\n');
}

/** Time-of-day part for the greeting, in the user's local-ish window. */
function timeOfDayGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Build the cross-conversation greeting using the stored profile, e.g.
 *   "Good morning Ivan Perez. IVX IA is ready."
 * Falls back to a name-less greeting when no name is remembered yet.
 */
export function buildGreeting(profile: UserProfile, now: Date = new Date()): string {
  const name = (profile.preferredName || profile.fullName).trim();
  let lead: string;
  switch (profile.greetingStyle) {
    case 'formal':
      lead = name ? `Hello ${name}` : 'Hello';
      break;
    case 'casual':
      lead = name ? `Hey ${name}` : 'Hey there';
      break;
    case 'time_of_day':
    default: {
      const tod = timeOfDayGreeting(now);
      lead = name ? `${tod} ${name}` : tod;
      break;
    }
  }
  return `${lead}. ${IVX_IA_NAME} is ready.`;
}

/** Resolve a greeting for a user id (seeds the owner default on first use). */
export async function greetingForUser(userId: string, now: Date = new Date()): Promise<{
  greeting: string;
  profile: UserProfile;
}> {
  const profile = await getProfile(userId);
  return { greeting: buildGreeting(profile, now), profile };
}

/** Owner view of all remembered profiles (for the memory dashboard). */
export async function allRememberedProfiles(): Promise<UserProfile[]> {
  return listProfiles();
}

export { deleteProfile };
