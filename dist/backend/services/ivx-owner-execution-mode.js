/**
 * IVX Owner Execution Mode
 *
 * Turns an owner command into an execution decision so the Owner AI behaves like
 * a senior developer: it EXECUTES non-destructive work end-to-end (patch → test →
 * commit → deploy → verify) without repeated approval prompts, and only asks for
 * confirmation when an action is genuinely dangerous.
 *
 * This module is runtime-free and deterministic so it is unit-testable everywhere
 * (no network, no filesystem, no AI gateway). The senior-developer runtime reads
 * `systemMode` from the returned decision to auto-approve its patch + git/deploy
 * gates for non-destructive owner commands.
 *
 * Approval is required ONLY for:
 *   - deleting data
 *   - modifying the production database schema
 *   - exposing secrets
 *   - changing billing / payment
 *   - disabling security
 *   - granting new external access
 */
/** Ordered so the most specific guarded phrases win when surfaced in the reason. */
const APPROVAL_GATES = [
    {
        category: 'delete_data',
        label: 'deletes data',
        pattern: /\b(delet(?:e|ing)|drop(?:ping)?|truncat(?:e|ing)|wip(?:e|ing)|purg(?:e|ing)|eras(?:e|ing)|remov(?:e|ing)\s+(?:(?:all|the|every)\s+)+(?:data|rows?|records?|users?|tables?|entries|accounts?))\b.{0,40}\b(data|rows?|records?|table|tables|database|db|users?|accounts?|bucket|storage|production|prod)\b|\b(drop\s+table|truncate\s+table|delete\s+from|rm\s+-rf)\b/i,
    },
    {
        category: 'modify_production_schema',
        label: 'modifies the production database schema',
        pattern: /\b(alter\s+table|add\s+column|drop\s+column|rename\s+column|change\s+(?:the\s+)?(?:db\s+|database\s+|production\s+)?schema|migrate\s+(?:the\s+)?(?:production|prod)\s+(?:db|database|schema)|production\s+(?:db|database)\s+(?:schema|migration)|alter\s+(?:the\s+)?production\s+(?:db|database|schema))\b/i,
    },
    {
        category: 'expose_secrets',
        label: 'exposes secrets',
        pattern: /\b(expose|reveal|print|show|leak|return|dump|echo|log)\b.{0,40}\b(secret|secrets|api\s*key|api\s*keys|token|tokens|password|passwords|credential|credentials|private\s+key|service[-\s]?role\s+key|env\s+values?|\.env)\b/i,
    },
    {
        category: 'change_billing',
        label: 'changes billing / payment',
        pattern: /\b(billing|payment|payout|charge|refund|invoice|subscription\s+price|pricing\s+plan|stripe\s+(?:account|key|charge)|payment\s+method|credit\s+card)\b.{0,40}\b(change|update|modify|disable|cancel|set|configure|edit|charge|refund)\b|\b(change|update|modify|disable|cancel)\b.{0,40}\b(billing|payment|payout|subscription\s+price|pricing|stripe)\b/i,
    },
    {
        category: 'disable_security',
        label: 'disables security',
        pattern: /\b(disable|turn\s+off|bypass|remove|drop|weaken|skip)\b.{0,40}\b(security|auth|authentication|authorization|rls|row[-\s]?level\s+security|permission\s+checks?|owner\s+guard|access\s+control|firewall|2fa|mfa|encryption)\b/i,
    },
    {
        category: 'grant_external_access',
        label: 'grants new external access',
        pattern: /\b(grant|give|add|open|allow|provision|create)\b.{0,40}\b(access|admin\s+rights?|new\s+(?:user|account|api\s+key|token)|external\s+(?:access|user|integration)|public\s+access|service\s+account|oauth\s+app|webhook\s+to\s+external)\b/i,
    },
];
/** Safe-fix categories the auto-approval lane recognizes (non-destructive). */
const SAFE_AUTO_GATES = [
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
/** Execution trigger phrases — when the owner clearly wants action, not narration. */
const EXECUTION_TRIGGERS = [
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
    // Imperative removal/cleanup commands ("remove end to end chat loading",
    // "remove the loading spinner now", "get rid of the splash delay"). Data
    // deletion stays protected by the delete_data approval gate above.
    /\b(?:remove|hide|eliminate|clean\s*up|get\s+rid\s+of|strip|turn\s+off)\s+(?:it|this|that|now|the\s+\w+|end[\s-]?to[\s-]?end|\w+\s+(?:loading|spinner|loader|delay|lag|banner|popup|modal|overlay|animation|duplicate))\b/i,
    /\b(?:remove|delete|hide|eliminate|clear|clean\s*up|get\s+rid\s+of)\b.{0,60}\b(?:loading|loader|spinner|skeleton|placeholder|splash|delay|lag|flicker|banner|badge|modal|popup|toast|overlay|animation|duplicate|watermark)\b/i,
    /\bfull\s+functionality\s+now\b/i,
];
function normalize(prompt) {
    return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}
function detectApprovalCategories(normalized) {
    const categories = [];
    for (const gate of APPROVAL_GATES) {
        if (gate.pattern.test(normalized)) {
            categories.push(gate.category);
        }
    }
    return categories;
}
function detectSafeCategories(normalized) {
    const categories = [];
    for (const gate of SAFE_AUTO_GATES) {
        if (gate.pattern.test(normalized)) {
            categories.push(gate.category);
        }
    }
    return categories;
}
function detectTriggers(normalized) {
    const matched = [];
    for (const trigger of EXECUTION_TRIGGERS) {
        const hit = normalized.match(trigger);
        if (hit?.[0]) {
            matched.push(hit[0].trim());
        }
    }
    return [...new Set(matched)];
}
function labelFor(category) {
    return APPROVAL_GATES.find((gate) => gate.category === category)?.label ?? category;
}
/**
 * Classify an owner command into an execution decision.
 *
 * - Non-destructive execution command → `autoExecute: true`, `systemMode: true`.
 * - Execution command touching a guarded category → `requiresApproval: true`,
 *   `autoExecute: false`, `systemMode: false`, with the exact categories named.
 * - Not an execution command → `isOwnerExecutionCommand: false` (caller routes normally).
 */
export function classifyOwnerExecutionCommand(prompt) {
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
    // A bare destructive imperative ("delete all user data", "disable auth") is
    // itself an owner command, even without a generic execution trigger phrase.
    const isOwnerExecutionCommand = matchedTriggers.length > 0 || requiresApproval;
    if (!isOwnerExecutionCommand) {
        return {
            isOwnerExecutionCommand: false,
            autoExecute: false,
            requiresApproval,
            approvalCategories,
            reason: requiresApproval
                ? `Command references a guarded action (${approvalCategories.map(labelFor).join(', ')}) but is not an explicit execution command; route normally and confirm before acting.`
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
            reason: `Owner execution command requires explicit approval because it ${approvalCategories
                .map(labelFor)
                .join(' and ')}. Confirm the exact action before it runs.`,
            systemMode: false,
            matchedTriggers,
            safeCategories,
        };
    }
    const safeLane = safeCategories.length > 0
        ? ` Auto-approval lane: safe ${safeCategories.map(safeLabelFor).join(', ')}.`
        : '';
    return {
        isOwnerExecutionCommand: true,
        autoExecute: true,
        requiresApproval: false,
        approvalCategories: [],
        reason: `Owner execution command (${matchedTriggers.join(', ')}) is non-destructive — execute end-to-end (patch → test → commit → deploy → verify) without an approval prompt.${safeLane}`,
        systemMode: true,
        matchedTriggers,
        safeCategories,
    };
}
/** The fixed set of approval gates, exposed for status endpoints / proof. */
export function listOwnerApprovalGates() {
    return APPROVAL_GATES.map((gate) => ({ category: gate.category, label: gate.label }));
}
/** The fixed set of safe auto-approval categories, exposed for status/proof. */
export function listOwnerSafeCategories() {
    return SAFE_AUTO_GATES.map((gate) => ({ category: gate.category, label: gate.label }));
}
function safeLabelFor(category) {
    return SAFE_AUTO_GATES.find((gate) => gate.category === category)?.label ?? category;
}
