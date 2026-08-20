/**
 * IVX Owner Execution Mode
 *
 * Turns an owner command into an execution decision so IVX can execute routine,
 * low-risk work end-to-end without human babysitting while reserving dangerous
 * mutations for explicit owner approval.
 *
 * AUTONOMY POLICY:
 *   - LOW-RISK / routine work may execute end-to-end automatically.
 *   - Dangerous work is held at the Owner Gate before mutation.
 *   - Rork, schedulers, internal workers and all IVX agents are subject to the
 *     same guarded categories; no caller receives a safety bypass by identity.
 *
 * Owner approval is required for:
 *   - destructive data operations / destructive production migrations
 *   - auth, authorization, roles, permissions or access-control changes
 *   - secret / credential creation, rotation, replacement or exposure
 *   - billing, payments, payouts, pricing or money movement
 *   - infrastructure / hosting / DNS / production service changes
 *   - security-control changes or security weakening
 *   - granting new external access
 *   - critical production rollback/revert
 *   - explicitly high-risk, dangerous or unclassified-risk changes
 */

export type OwnerApprovalCategory =
  | 'delete_data'
  | 'modify_production_schema'
  | 'expose_secrets'
  | 'modify_secrets_credentials'
  | 'change_billing'
  | 'modify_auth_permissions'
  | 'disable_security'
  | 'change_security_controls'
  | 'grant_external_access'
  | 'change_infrastructure'
  | 'critical_rollback'
  | 'explicit_high_risk';

/**
 * The safe, non-destructive fix categories the auto-approval lane recognizes
 * explicitly. Detection is additive; a dangerous category always wins.
 */
export type OwnerSafeCategory =
  | 'ui_fix'
  | 'copy_fix'
  | 'test_fix'
  | 'logging_fix'
  | 'error_message_fix'
  | 'layout_scroll_fix';

export type IVXOwnerExecutionDecision = {
  isOwnerExecutionCommand: boolean;
  autoExecute: boolean;
  requiresApproval: boolean;
  approvalCategories: OwnerApprovalCategory[];
  reason: string;
  systemMode: boolean;
  matchedTriggers: string[];
  safeCategories: OwnerSafeCategory[];
};

/** Ordered so the most specific guarded phrases win when surfaced in proof. */
const APPROVAL_GATES: Array<{ category: OwnerApprovalCategory; label: string; pattern: RegExp }> = [
  {
    category: 'delete_data',
    label: 'deletes production/business data',
    pattern:
      /\b(delet(?:e|ing)|drop(?:ping)?|truncat(?:e|ing)|wip(?:e|ing)|purg(?:e|ing)|eras(?:e|ing)|remov(?:e|ing)\s+(?:(?:all|the|every)\s+)+(?:data|rows?|records?|users?|tables?|entries|accounts?))\b.{0,40}\b(data|rows?|records?|table|tables|database|db|users?|accounts?|bucket|storage|production|prod)\b|\b(drop\s+table|truncate\s+table|delete\s+from|rm\s+-rf)\b/i,
  },
  {
    category: 'modify_production_schema',
    label: 'runs a destructive or production database migration',
    pattern:
      /\b(alter\s+table|add\s+column|drop\s+column|rename\s+column|drop\s+constraint|change\s+(?:the\s+)?(?:db\s+|database\s+|production\s+)?schema|migrate\s+(?:the\s+)?(?:production|prod)\s+(?:db|database|schema)|production\s+(?:db|database)\s+(?:schema|migration)|alter\s+(?:the\s+)?production\s+(?:db|database|schema)|destructive\s+migration)\b/i,
  },
  {
    category: 'expose_secrets',
    label: 'exposes secrets or credentials',
    pattern:
      /\b(expose|reveal|print|show|leak|return|dump|echo|log)\b.{0,40}\b(secret|secrets|api\s*key|api\s*keys|token|tokens|password|passwords|credential|credentials|private\s+key|service[-\s]?role\s+key|env\s+values?|\.env)\b/i,
  },
  {
    category: 'modify_secrets_credentials',
    label: 'creates, rotates, replaces or deletes secrets/credentials',
    pattern:
      /\b(create|add|set|update|change|replace|rotate|revoke|delete|remove|regenerate)\b.{0,50}\b(secret|secrets|api\s*key|api\s*keys|token|tokens|password|passwords|credential|credentials|private\s+key|service[-\s]?role\s+key|github\s+token|render\s+(?:api\s+)?key|supabase\s+(?:service\s+role\s+)?key|\.env|environment\s+variable)\b/i,
  },
  {
    category: 'change_billing',
    label: 'changes billing, payments, payouts or money movement',
    pattern:
      /\b(billing|payment|payments|payout|payouts|charge|refund|invoice|subscription\s+price|pricing\s+plan|stripe\s+(?:account|key|charge)|payment\s+method|credit\s+card|bank\s+account|wire\s+instruction|money\s+movement)\b.{0,50}\b(change|update|modify|disable|cancel|set|configure|edit|charge|refund|send|transfer)\b|\b(change|update|modify|disable|cancel|send|transfer)\b.{0,50}\b(billing|payment|payout|subscription\s+price|pricing|stripe|money|funds|wire)\b/i,
  },
  {
    category: 'modify_auth_permissions',
    label: 'changes authentication, authorization, roles or permissions',
    pattern:
      /\b(change|update|modify|replace|remove|disable|enable|bypass|grant|revoke|relax|weaken|edit|rewrite)\b.{0,55}\b(auth|authentication|authorization|permissions?|roles?|access\s+control|owner\s+guard|session\s+policy|rls|row[-\s]?level\s+security|admin\s+rights?|allowlist|denylist)\b|\b(auth|authentication|authorization|permissions?|roles?|access\s+control|rls)\b.{0,55}\b(change|update|modify|replace|grant|revoke|bypass|disable|enable)\b/i,
  },
  {
    category: 'disable_security',
    label: 'disables or weakens security',
    pattern:
      /\b(disable|turn\s+off|bypass|remove|drop|weaken|skip|relax)\b.{0,40}\b(security|auth|authentication|authorization|rls|row[-\s]?level\s+security|permission\s+checks?|owner\s+guard|access\s+control|firewall|2fa|mfa|encryption|signature\s+verification|rate\s+limit)\b/i,
  },
  {
    category: 'change_security_controls',
    label: 'changes a production security control',
    pattern:
      /\b(change|update|modify|replace|rotate|reconfigure|edit|rewrite)\b.{0,55}\b(security\s+(?:policy|control|configuration)|firewall|encryption|mfa|2fa|signature\s+verification|csrf|cors|rate\s+limit|waf|security\s+headers?|content\s+security\s+policy)\b/i,
  },
  {
    category: 'grant_external_access',
    label: 'grants new external access',
    pattern:
      /\b(grant|give|add|open|allow|provision|create)\b.{0,40}\b(access|admin\s+rights?|new\s+(?:user|account|api\s+key|token)|external\s+(?:access|user|integration)|public\s+access|service\s+account|oauth\s+app|webhook\s+to\s+external)\b/i,
  },
  {
    category: 'change_infrastructure',
    label: 'changes production infrastructure or hosting',
    pattern:
      /\b(change|update|modify|replace|delete|remove|create|provision|reconfigure|migrate|move|switch|scale|resize)\b.{0,60}\b(infrastructure|production\s+service|render\s+service|vercel\s+project|supabase\s+project|dns|domain|nameserver|load\s+balancer|cloudflare|hosting|runtime\s+region|database\s+instance|service\s+id|deployment\s+target)\b|\b(infrastructure|dns|domain|hosting|render\s+service|vercel\s+project|supabase\s+project)\b.{0,60}\b(change|update|modify|replace|delete|migrate|switch)\b/i,
  },
  {
    category: 'critical_rollback',
    label: 'performs a critical production rollback/revert',
    pattern:
      /\b(rollback|roll\s+back|revert)\b.{0,45}\b(production|prod|live|critical|database|deployment|release)\b|\b(production|prod|live)\b.{0,45}\b(rollback|roll\s+back|revert)\b/i,
  },
  {
    category: 'explicit_high_risk',
    label: 'is explicitly high-risk, dangerous or risk-unclassified',
    pattern:
      /\b(high[-\s]?risk|critical[-\s]?risk|dangerous\s+change|destructive\s+change|risk\s+(?:is\s+)?unknown|unknown\s+risk|unclassified\s+risk|risk\s+unclear)\b/i,
  },
];

const SAFE_AUTO_GATES: Array<{ category: OwnerSafeCategory; label: string; pattern: RegExp }> = [
  {
    category: 'ui_fix',
    label: 'UI fix',
    pattern: /\b(ui|interface|button|screen|component|view|modal|sheet|icon|color|colour|theme|style|styling|spacing|padding|margin|alignment)\b/i,
  },
  {
    category: 'copy_fix',
    label: 'copy / wording fix',
    pattern: /\b(copy|wording|text|label|title|heading|placeholder|typo|spelling|grammar|microcopy|string)\b/i,
  },
  {
    category: 'test_fix',
    label: 'test fix',
    pattern: /\b(test|tests|unit\s+test|spec|assertion|snapshot|test\s+suite|failing\s+test)\b/i,
  },
  {
    category: 'logging_fix',
    label: 'logging fix',
    pattern: /\b(log|logs|logging|console\.log|log\s+message|debug\s+log|trace)\b/i,
  },
  {
    category: 'error_message_fix',
    label: 'error-message fix',
    pattern: /\b(error\s+message|error\s+text|error\s+copy|user[-\s]?facing\s+(?:error|message)|toast|alert\s+message|validation\s+message)\b/i,
  },
  {
    category: 'layout_scroll_fix',
    label: 'layout / scroll fix',
    pattern: /\b(layout|scroll|scrolling|scrollview|overflow|overlap|clipped|cut\s*off|safe\s*area|keyboard\s+(?:avoid|overlap)|responsive|flex)\b/i,
  },
];

const EXECUTION_TRIGGERS: RegExp[] = [
  /\bfix\s+(?:it|this|that|now|the\s+\w+)\b/i,
  /\bdeploy\s+(?:it|this|that|now|to\s+(?:prod|production|live|staging|render))\b/i,
  /\bcomplete\s+(?:it|this|that|the\s+\w+|now)\b/i,
  /\bproceed\b/i,
  /\b(?:finish|finalize|finalise|wrap\s+up)\b/i,
  /\bdo\s+not\s+ask(?:\s+again|\s+me)?\b/i,
  /\bdon'?t\s+ask(?:\s+again|\s+me)?\b/i,
  /\bprove\s+(?:it|this|that)\b/i,
  /\bcode\s+(?:it|this|that)\b/i,
  /\bship\s+(?:it|this|that|now|today)\b/i,
  /\b(?:just\s+)?(?:make|get)\s+(?:it|this|that)\s+(?:work|done|pass|built|shipped|deployed|fixed|live|running)\b/i,
  /\bexecute\s+(?:it|this|that|now|the\s+\w+)\b/i,
  /\brun\s+(?:the\s+)?(?:tests?|test\s+suite|validation|checks?|build)\b/i,
  /\bimplement\s+(?:it|this|that|now)\b/i,
  /\bpatch\s+(?:it|this|that|now)\b/i,
  /\bstop\s+(?:asking|narrating|reporting)\b/i,
  /\bno\s+more\s+(?:audit|report|narration|approval|questions?)\b/i,
  /\b(?:remove|hide|eliminate|clean\s*up|get\s+rid\s+of|strip|turn\s+off)\s+(?:it|this|that|now|the\s+\w+|end[\s-]?to[\s-]?end|\w+\s+(?:loading|spinner|loader|delay|lag|banner|popup|modal|overlay|animation|duplicate))\b/i,
  /\b(?:remove|delete|hide|eliminate|clear|clean\s*up|get\s+rid\s+of)\b.{0,60}\b(?:loading|loader|spinner|skeleton|placeholder|splash|delay|lag|flicker|banner|badge|modal|popup|toast|overlay|animation|duplicate|watermark)\b/i,
  /\bfull\s+functionality\s+now\b/i,
];

function normalize(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectApprovalCategories(normalized: string): OwnerApprovalCategory[] {
  const categories: OwnerApprovalCategory[] = [];
  for (const gate of APPROVAL_GATES) {
    if (gate.pattern.test(normalized)) categories.push(gate.category);
  }
  return [...new Set(categories)];
}

function detectSafeCategories(normalized: string): OwnerSafeCategory[] {
  const categories: OwnerSafeCategory[] = [];
  for (const gate of SAFE_AUTO_GATES) {
    if (gate.pattern.test(normalized)) categories.push(gate.category);
  }
  return [...new Set(categories)];
}

function detectTriggers(normalized: string): string[] {
  const matched: string[] = [];
  for (const trigger of EXECUTION_TRIGGERS) {
    const hit = normalized.match(trigger);
    if (hit?.[0]) matched.push(hit[0].trim());
  }
  return [...new Set(matched)];
}

function labelFor(category: OwnerApprovalCategory): string {
  return APPROVAL_GATES.find((gate) => gate.category === category)?.label ?? category;
}

function safeLabelFor(category: OwnerSafeCategory): string {
  return SAFE_AUTO_GATES.find((gate) => gate.category === category)?.label ?? category;
}

/**
 * Dangerous categories always win over auto-execution. Routine commands remain
 * autonomous end-to-end so IVX can operate continuously without human babysitting.
 */
export function classifyOwnerExecutionCommand(prompt: string): IVXOwnerExecutionDecision {
  const normalized = normalize(prompt);
  if (!normalized) {
    return {
      isOwnerExecutionCommand: false,
      autoExecute: false,
      requiresApproval: false,
      approvalCategories: [],
      reason: 'Empty prompt — no owner execution command detected.',
      systemMode: false,
      matchedTriggers: [],
      safeCategories: [],
    };
  }

  const matchedTriggers = detectTriggers(normalized);
  const approvalCategories = detectApprovalCategories(normalized);
  const safeCategories = detectSafeCategories(normalized);
  const requiresApproval = approvalCategories.length > 0;
  const isOwnerExecutionCommand = matchedTriggers.length > 0 || requiresApproval;

  if (!isOwnerExecutionCommand) {
    return {
      isOwnerExecutionCommand: false,
      autoExecute: false,
      requiresApproval,
      approvalCategories,
      reason: requiresApproval
        ? `Command references a guarded action (${approvalCategories.map(labelFor).join(', ')}) but is not an explicit execution command; confirm before acting.`
        : 'No execution trigger detected — route as a normal conversation/question.',
      systemMode: false,
      matchedTriggers,
      safeCategories,
    };
  }

  if (requiresApproval) {
    return {
      isOwnerExecutionCommand: true,
      autoExecute: false,
      requiresApproval: true,
      approvalCategories,
      reason: `OWNER_GATE_REQUIRED: dangerous mutation detected because it ${approvalCategories
        .map(labelFor)
        .join(' and ')}. Autonomous must stop before mutation and wait for explicit owner approval.`,
      systemMode: false,
      matchedTriggers,
      safeCategories,
    };
  }

  const safeLane = safeCategories.length > 0
    ? ` Safe lane evidence: ${safeCategories.map(safeLabelFor).join(', ')}.`
    : '';
  return {
    isOwnerExecutionCommand: true,
    autoExecute: true,
    requiresApproval: false,
    approvalCategories: [],
    reason: `Owner execution command (${matchedTriggers.join(', ')}) is outside all dangerous gates — execute end-to-end (inspect → patch → test → typecheck/lint → commit → deploy → verify) without another approval prompt.${safeLane}`,
    systemMode: true,
    matchedTriggers,
    safeCategories,
  };
}

export function listOwnerApprovalGates(): Array<{ category: OwnerApprovalCategory; label: string }> {
  return APPROVAL_GATES.map((gate) => ({ category: gate.category, label: gate.label }));
}

export function listOwnerSafeCategories(): Array<{ category: OwnerSafeCategory; label: string }> {
  return SAFE_AUTO_GATES.map((gate) => ({ category: gate.category, label: gate.label }));
}
