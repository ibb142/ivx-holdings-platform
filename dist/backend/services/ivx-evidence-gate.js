/**
 * IVX Proof-First Execution Framework — Evidence Gate
 *
 * Enforces that every technical claim in an IVX response is backed by real
 * tool-execution evidence. Blocks/categorises claims without evidence, adds
 * mandatory evidence metadata, separates internal audit streams from
 * user-visible chat, and enforces hard prohibitions (no simulated data
 * presented as real, no UUIDs as Git SHAs, no fake diffs, no deployment
 * claims without provider confirmation, no code-change claims without actual
 * diff output).
 *
 * Every public function is pure + deterministic (no I/O, network, or AI)
 * so the gate is fully unit-testable.
 */
// ---------------------------------------------------------------------------
// Output labels (requirement 3)
// ---------------------------------------------------------------------------
export const EVIDENCE_LABEL = {
    /** No tool was run at all — the claim has zero backing evidence. */
    NOT_EXECUTED: 'NOT EXECUTED',
    /** A tool was run but its evidence output is unavailable / unreadable. */
    UNVERIFIED: 'UNVERIFIED',
    /** The answer contains generated / example / placeholder data. */
    SIMULATED: 'SIMULATED',
    /** A real tool ran and produced confirmable evidence. */
    EXECUTED: 'EXECUTED',
    /** Evidence was captured but could not be independently re-verified. */
    EVIDENCE_UNAVAILABLE: 'EVIDENCE UNAVAILABLE',
};
/**
 * The four canonical, owner-facing classification labels (TASK 2).
 * Every technical response is reduced to exactly ONE of these:
 *  - VERIFIED      = real evidence exists for the claim.
 *  - UNVERIFIED    = a tool ran but evidence is missing/unreadable.
 *  - NOT EXECUTED  = no execution occurred at all.
 *  - SIMULATED     = generated / example data, not a live result.
 */
export const EVIDENCE_CLASSIFICATION = {
    VERIFIED: 'VERIFIED',
    UNVERIFIED: 'UNVERIFIED',
    NOT_EXECUTED: 'NOT EXECUTED',
    SIMULATED: 'SIMULATED',
};
/**
 * Reduce an internal gate result to one of the four owner-facing
 * classification labels (TASK 2 — "Every technical response must be
 * classified"). The internal EXECUTED / EVIDENCE_UNAVAILABLE labels map to
 * the owner-facing VERIFIED / UNVERIFIED vocabulary.
 *
 * Pure function — deterministic.
 */
export function classifyTechnicalResponse(gateResult) {
    switch (gateResult.overallLabel) {
        case EVIDENCE_LABEL.EXECUTED:
            return EVIDENCE_CLASSIFICATION.VERIFIED;
        case EVIDENCE_LABEL.SIMULATED:
            return EVIDENCE_CLASSIFICATION.SIMULATED;
        case EVIDENCE_LABEL.UNVERIFIED:
        case EVIDENCE_LABEL.EVIDENCE_UNAVAILABLE:
            return EVIDENCE_CLASSIFICATION.UNVERIFIED;
        case EVIDENCE_LABEL.NOT_EXECUTED:
        default:
            return EVIDENCE_CLASSIFICATION.NOT_EXECUTED;
    }
}
/**
 * Whether an answer makes any technical claim at all (code/commit/deploy/
 * db/test). Non-technical chat (greetings, explanations) is not gated.
 *
 * Pure function.
 */
export function isTechnicalResponse(answer) {
    return extractClaims(answer).length > 0;
}
// ---------------------------------------------------------------------------
// Claim types the gate inspects (requirement 1)
// ---------------------------------------------------------------------------
export const CLAIM_CATEGORY = {
    CODE_CHANGE: 'code_change',
    GIT_COMMIT: 'git_commit',
    DEPLOYMENT: 'deployment',
    DATABASE_MUTATION: 'database_mutation',
    API_RESULT: 'api_result',
    TEST_RESULT: 'test_result',
    FILE_WRITE: 'file_write',
    PRODUCTION_VERIFICATION: 'production_verification',
};
// ---------------------------------------------------------------------------
// Hard prohibitions (requirement 4) — compiled detector patterns
// ---------------------------------------------------------------------------
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const GIT_SHA_REGEX = /\b[0-9a-f]{7,40}\b/gi;
const DEPLOY_REGEX = /\b(deploy(?:ed|ment)?|live|shipped|pushed to production|in production now|production build)\b/i;
const COMMIT_REGEX = /\b(committed|commits?|pushed to (?:main|master|github)|merged)\b/i;
const CODE_CHANGE_REGEX = /\b(changed|modified|updated|created|added|removed|refactored|patched|fixed)\s+(?:the |a )?(?:file|code|function|module|component|route|endpoint|screen|service|API)\b/i;
const DB_MUTATION_REGEX = /\b(inserted|updated|deleted|migrated|seeded|upserted|created table|altered table|ran (?:a |the )?migration|executed SQL)\b/i;
const TEST_RESULT_REGEX = /\b(\d+\/\d+\s+(?:tests?\s+)?(?:pass|fail|green)|all tests pass|test suite (?:pass|green|succeeded)|bun test.*(?:pass|fail))\b/i;
// Matches claims that look like they cite a commit hash but are actually UUIDs.
const UUID_AS_SHA_REGEX = /\b(?:commit|SHA|hash)[:\s]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
// Matches generated/fake diff output patterns.
const FAKE_DIFF_REGEX = /\b(?:---\s+\+\+\+|@@\s+[-+]\d+,\d+\s+[-+]\d+,\d+\s+@@)\b/i;
// ---------------------------------------------------------------------------
// Fake-deliverable detectors (no report-file/link/storage tool exists in IVX)
// ---------------------------------------------------------------------------
// A markdown link whose href is a dead placeholder: "#", "#anchor", empty,
// javascript:void(0), or about:blank — e.g. "[Access Buyer and JV Report](#)".
const PLACEHOLDER_LINK_REGEX = /\[[^\]]+\]\(\s*(?:#[\w-]*|javascript:\s*void\(0\)|about:blank|)\s*\)/i;
// A markdown link whose href is an obvious example/placeholder host.
const PLACEHOLDER_HREF_REGEX = /\[[^\]]+\]\(\s*(?:https?:\/\/)?(?:example\.(?:com|org|net)|localhost|127\.0\.0\.1|your-?(?:domain|site|link|url)|placeholder|tbd|todo)\b[^)]*\)/i;
// Claims that a report/file/deliverable is ready/finalized/generated/attached.
const DELIVERABLE_READY_REGEX = /\b(report|file|document|export|pdf|spreadsheet|deliverable|download|link)\s+(?:is\s+)?(?:now\s+)?(?:ready|complete[d]?|finali[sz]ed|generated|available|attached|created|prepared)\b|\b(?:here(?:'s| is)|attached is|i(?:'ve| have)\s+(?:created|generated|prepared|finished))\b[^.\n]{0,40}\b(report|file|document|export|pdf|spreadsheet|deliverable|link|download)\b/i;
// Deferred-delivery promises: "I'll deliver shortly", "give me 30 more minutes".
const DEFERRED_DELIVERY_REGEX = /\b(?:i(?:'ll| will| am going to)|we(?:'ll| will)|let me|give me|need|in)\b[^.\n]{0,48}\b(?:provide|deliver|send|share|generate|finish|complete|have|prepare)\b[^.\n]{0,48}\b(?:link|report|file|document|shortly|soon|in a (?:few|couple)|\d+\s*(?:more\s*)?(?:minutes?|hours?|mins?))\b/i;
// Live-query narrative: the model claiming it is running / about to run a SQL
// or database query mid-message. A text model cannot execute queries itself —
// real counts come only from the IVX count tool. These phrases are fabricated
// unless a real query actually ran in this turn.
const QUERY_NARRATIVE_REGEXES = [
    /\bi(?:'m| am)\s+(?:now\s+)?(?:running|executing|performing|querying)\b[^.\n]{0,40}\b(?:quer(?:y|ies)|sql|count|database|table)\b/i,
    /\b(?:running|executing|performing)\s+(?:these|the|a|an|those)?\s*quer(?:y|ies)\s+(?:now|right now)\b/i,
    /\b(?:let me|i'?ll|i will|i'?m going to|going to|allow me to)\s+(?:run|execute|perform|query|pull)\b[^.\n]{0,40}\b(?:quer(?:y|ies)|sql|count|database|table|investors?|buyers?|deals?)\b/i,
    /\bi'?ll\s+(?:run|execute)\s+(?:a|an|the)?\s*(?:count\s*)?quer(?:y|ies)\b/i,
    /\b(?:querying|running a query on|i(?:'m| am) querying)\s+the\b[^.\n]{0,30}\btable\b/i,
];
// Open-ended time promise near deliverable language.
// NOTE: A bare numeric time like "27 minutes" is NOT a delivery promise — it is
// a factual elapsed-time statement (e.g. "booted 27 minutes ago", "27 minutes
// since last check"). The promise signal is the modifier "more" ("30 more
// minutes") or an explicit "in a few minutes" / "shortly" / "almost done".
// Matching bare numbers hijacked legitimate senior-developer answers that quote
// uptime/elapsed time, rewriting them to REPORT NOT READY. The bare-number arm
// now requires the "more" modifier so factual elapsed-time facts pass through.
const TIME_PROMISE_REGEX = /\b(?:\d+\s*more\s*(?:minutes?|hours?|mins?)|shortly|in a moment|in a (?:few|couple)\s+(?:minutes?|hours?)|almost (?:done|finished|ready|complete)|just a (?:bit|moment|sec))\b/i;
// Deliverable context: a NOUN (a report/file/export artifact), not the verb
// "report" (as in "I'll report the commit"). The verb form is excluded by
// requiring the noun stem to be preceded by a determiner/adjective OR to be a
// standalone noun. This stops "report the current commit" from being treated as
// a deliverable claim.
const DELIVERABLE_CONTEXT_REGEX = /\b(?:a|an|the|this|that|your|our|my)\s+(?:report|file|document|export|pdf|spreadsheet|deliverable|link|download)\b|\b(?:report|file|document|export|pdf|spreadsheet|deliverable|link|download)\s+(?:is|are|was|were|has|have|will|should|can|may)\b|\bdeliver(?:ing|s|ed)?|finish(?:ing|es|ed)?|generat(?:ing|es|ed)|finali[sz](?:ing|es|ed)\b/i;
/**
 * Scan an answer string for hard-prohibition violations.
 * Pure function — no I/O, always returns the same result for the same input.
 */
export function scanForProhibitions(answer, evidenceAvailable) {
    const violations = [];
    // 1. Simulated data presented as real
    if (!evidenceAvailable) {
        // Check for commit claims when there's no evidence of a real commit
        const commitMatch = COMMIT_REGEX.exec(answer);
        if (commitMatch) {
            violations.push({
                rule: 'NO_SIMULATED_DATA_AS_REAL',
                snippet: commitMatch[0],
                reason: 'Claims a commit was made but no commit evidence (github.commitSha) exists.',
            });
        }
        // Check for deploy claims without deployment evidence
        const deployMatch = DEPLOY_REGEX.exec(answer);
        if (deployMatch) {
            violations.push({
                rule: 'NO_SIMULATED_DATA_AS_REAL',
                snippet: deployMatch[0],
                reason: 'Claims deployment was performed but no deployment evidence (render.deployId) exists.',
            });
        }
        // Check for code-change claims without changed-files evidence
        const codeMatch = CODE_CHANGE_REGEX.exec(answer);
        if (codeMatch) {
            violations.push({
                rule: 'NO_SIMULATED_DATA_AS_REAL',
                snippet: codeMatch[0],
                reason: 'Claims code was changed but no changedFiles evidence exists.',
            });
        }
        // Check for database mutation claims without DB evidence
        const dbMatch = DB_MUTATION_REGEX.exec(answer);
        if (dbMatch) {
            violations.push({
                rule: 'NO_SIMULATED_DATA_AS_REAL',
                snippet: dbMatch[0],
                reason: 'Claims a database mutation was performed but no DB-operation evidence exists.',
            });
        }
    }
    // 2. UUID presented as Git SHA
    const uuidShaMatch = UUID_AS_SHA_REGEX.exec(answer);
    if (uuidShaMatch) {
        violations.push({
            rule: 'NO_UUID_AS_GIT_SHA',
            snippet: uuidShaMatch[0],
            reason: `A UUID (${uuidShaMatch[1]}) is presented as a Git commit SHA.`,
        });
    }
    // Now check non-UUID-format strings: if evidence is absent and the answer contains
    // a GitHub-format hex string but the caller's evidence has no real SHA,
    // that's also a violation.
    if (!evidenceAvailable) {
        const shaMatches = answer.matchAll(GIT_SHA_REGEX);
        for (const match of shaMatches) {
            const sha = match[0];
            // Skip if it's clearly something else (like a UUID or a hex color in a non-commit context)
            if (sha.length >= 7 && !uuidShaMatch && /\bcommit\b/i.test(answer.slice(Math.max(0, match.index - 40), match.index + sha.length + 10))) {
                violations.push({
                    rule: 'NO_FAKE_GIT_SHA',
                    snippet: sha,
                    reason: 'A hex string resembling a Git SHA appears near commit language but no real commit evidence exists.',
                });
                break; // One is enough — don't flood
            }
        }
    }
    // 3. Deployment claim without provider confirmation
    if (!evidenceAvailable) {
        const deployWithProvider = /\b(Render|Vercel|AWS|Cloudflare|Netlify|Heroku)\s+(?:deploy|auto-deploy|build)/i.exec(answer);
        if (deployWithProvider) {
            violations.push({
                rule: 'NO_DEPLOY_WITHOUT_PROVIDER_CONFIRMATION',
                snippet: deployWithProvider[0],
                reason: 'References a provider deployment but has no deploy confirmation evidence.',
            });
        }
    }
    // 4. Code change claimed without actual diff output
    const diffMatch = FAKE_DIFF_REGEX.exec(answer);
    if (diffMatch && !evidenceAvailable) {
        violations.push({
            rule: 'NO_CODE_CHANGE_WITHOUT_DIFF',
            snippet: diffMatch[0],
            reason: 'Contains diff-like syntax but no actual diff evidence exists.',
        });
    }
    return violations;
}
// ---------------------------------------------------------------------------
// Fake-deliverable scanner (no report-file/link/storage tool exists)
// ---------------------------------------------------------------------------
/**
 * Scan an answer for fake-deliverable claims:
 *  - placeholder / dead links (href "#", empty, void, example.com, localhost)
 *  - "report/file is ready/finalized/generated" with no real deliverable
 *  - deferred-delivery promises ("I'll deliver shortly", "30 more minutes")
 *
 * `hasRealDeliverable` is true ONLY when a real, attributable deliverable
 * (a reachable hosted file/link or a stored file reference) actually exists.
 * Placeholder/dead links are ALWAYS blocked regardless, because a real link
 * is never "#". IVX currently has no report-file-generation or file-hosting
 * tool, so `hasRealDeliverable` is false unless a caller proves otherwise.
 *
 * Pure function — deterministic, no I/O.
 */
export function scanForFakeDeliverableClaims(answer, hasRealDeliverable) {
    const violations = [];
    const placeholder = PLACEHOLDER_LINK_REGEX.exec(answer);
    if (placeholder) {
        violations.push({
            rule: 'NO_PLACEHOLDER_LINK',
            snippet: placeholder[0],
            reason: 'Contains a non-functional placeholder link (href "#"/empty/void). A deliverable link must point to a real, reachable file.',
        });
    }
    const placeholderHref = PLACEHOLDER_HREF_REGEX.exec(answer);
    if (placeholderHref) {
        violations.push({
            rule: 'NO_PLACEHOLDER_LINK',
            snippet: placeholderHref[0],
            reason: 'Contains a placeholder/example href (example.com / localhost / your-domain / TBD). Not a real deliverable.',
        });
    }
    if (!hasRealDeliverable) {
        const ready = DELIVERABLE_READY_REGEX.exec(answer);
        if (ready) {
            violations.push({
                rule: 'NO_DELIVERABLE_WITHOUT_REAL_FILE',
                snippet: ready[0],
                reason: 'Claims a report/file/deliverable is ready but no real file or reachable link exists. IVX has no report-file-generation or file-hosting tool — return a VERIFIED failure reason instead.',
            });
        }
        const deferred = DEFERRED_DELIVERY_REGEX.exec(answer);
        if (deferred) {
            violations.push({
                rule: 'NO_UNFULFILLED_DELIVERY_PROMISE',
                snippet: deferred[0],
                reason: 'Promises a future deliverable ("will deliver / X more minutes / shortly") with no tracked job state. Either deliver now or return a VERIFIED failure reason.',
            });
        }
        const timePromise = TIME_PROMISE_REGEX.exec(answer);
        if (timePromise && DELIVERABLE_CONTEXT_REGEX.test(answer)) {
            violations.push({
                rule: 'NO_TIME_PROMISE',
                snippet: timePromise[0],
                reason: 'Open-ended time promise ("30 more minutes / shortly / almost done") for a deliverable with no tracked job. Not allowed.',
            });
        }
    }
    return violations;
}
/**
 * Scan an answer for fabricated live-query narrative — phrases that claim a SQL /
 * database query is being run mid-message when no real query actually executed
 * in this turn. A text model cannot run queries itself; real counts come only
 * from the IVX count tool. When `realQueryRan` is true (the count tool executed
 * a real query this turn), this narrative is legitimate and is not flagged.
 *
 * Pure function — deterministic, no I/O.
 */
export function scanForUnbackedQueryNarrative(answer, realQueryRan) {
    if (realQueryRan)
        return [];
    for (const regex of QUERY_NARRATIVE_REGEXES) {
        const match = regex.exec(answer);
        if (match) {
            return [
                {
                    rule: 'NO_QUERY_NARRATIVE_WITHOUT_EXECUTION',
                    snippet: match[0],
                    reason: 'Claims a database/SQL query is being run mid-message, but no real query executed this turn. A text model cannot run queries — use the IVX count tool or state the real number is unavailable.',
                },
            ];
        }
    }
    return [];
}
/**
 * The honest message IVX returns when it tried to narrate running a query but no
 * real query executed. Used to rewrite fabricated "I'm running these queries
 * now" answers on the chat path.
 */
export function buildNoLiveQueryMessage() {
    return [
        'I do not have a live count for that right now.',
        '',
        "I can't run a database query inside this reply, and the count tool did not return a verified number this turn (Supabase may be unconfigured, or the table may not exist in this project). Rather than give you a fabricated figure, I'm telling you straight: no exact count is available right now.",
        '',
        'Ask again and I will run a real count=exact query, or tell me the exact table to count.',
    ].join('\n');
}
/**
 * Extract the technical claims present in an answer string.
 * Pure function — deterministic, no side effects.
 */
export function extractClaims(answer) {
    const claims = [];
    for (const match of answer.matchAll(new RegExp(CODE_CHANGE_REGEX.source, 'gi'))) {
        claims.push({ category: CLAIM_CATEGORY.CODE_CHANGE, claimedText: match[0] });
    }
    for (const match of answer.matchAll(new RegExp(COMMIT_REGEX.source, 'gi'))) {
        claims.push({ category: CLAIM_CATEGORY.GIT_COMMIT, claimedText: match[0] });
    }
    for (const match of answer.matchAll(new RegExp(DEPLOY_REGEX.source, 'gi'))) {
        claims.push({ category: CLAIM_CATEGORY.DEPLOYMENT, claimedText: match[0] });
    }
    for (const match of answer.matchAll(new RegExp(DB_MUTATION_REGEX.source, 'gi'))) {
        claims.push({ category: CLAIM_CATEGORY.DATABASE_MUTATION, claimedText: match[0] });
    }
    for (const match of answer.matchAll(new RegExp(TEST_RESULT_REGEX.source, 'gi'))) {
        claims.push({ category: CLAIM_CATEGORY.TEST_RESULT, claimedText: match[0] });
    }
    return claims;
}
/**
 * Evaluate an answer against the evidence gate.
 *
 * Returns a structured gate result. Claims without evidence are labelled
 * NOT_EXECUTED or UNVERIFIED; claims WITH evidence are labelled EXECUTED.
 * Prohibition violations are surfaced separately.
 *
 * Pure function — no I/O.
 */
export function evaluateEvidenceGate(input) {
    const { answer, toolWasExecuted, evidenceMetadata, repoAccessVerified } = input;
    const violations = [
        ...scanForProhibitions(answer, toolWasExecuted),
        ...scanForFakeDeliverableClaims(answer, input.hasRealDeliverable ?? false),
    ];
    const extractedClaims = extractClaims(answer);
    const evidenceClaims = extractedClaims.map((claim) => {
        if (!toolWasExecuted) {
            return {
                category: claim.category,
                claimedText: claim.claimedText,
                evidencePresent: false,
                metadata: null,
                label: EVIDENCE_LABEL.NOT_EXECUTED,
                reason: 'No tool was executed — the claim has zero backing evidence.',
            };
        }
        if (!evidenceMetadata) {
            return {
                category: claim.category,
                claimedText: claim.claimedText,
                evidencePresent: false,
                metadata: null,
                label: EVIDENCE_LABEL.UNVERIFIED,
                reason: 'A tool was run but evidence metadata is unavailable.',
            };
        }
        return {
            category: claim.category,
            claimedText: claim.claimedText,
            evidencePresent: true,
            metadata: evidenceMetadata,
            label: EVIDENCE_LABEL.EXECUTED,
            reason: `Evidence captured by ${evidenceMetadata.toolName} at ${evidenceMetadata.timestamp} (ref: ${evidenceMetadata.rawOutputRef}).`,
        };
    });
    // If no claims were extracted, the answer doesn't need evidence gating
    const hasClaims = evidenceClaims.length > 0;
    const hasViolations = violations.length > 0;
    const passed = !hasViolations && (!hasClaims || evidenceClaims.every((c) => c.label === EVIDENCE_LABEL.EXECUTED));
    // Overall label: strongest claim label (worst-first priority)
    const overallLabel = hasClaims
        ? evidenceClaims.some((c) => c.label === EVIDENCE_LABEL.NOT_EXECUTED)
            ? EVIDENCE_LABEL.NOT_EXECUTED
            : evidenceClaims.some((c) => c.label === EVIDENCE_LABEL.UNVERIFIED)
                ? EVIDENCE_LABEL.UNVERIFIED
                : evidenceClaims.some((c) => c.label === EVIDENCE_LABEL.SIMULATED)
                    ? EVIDENCE_LABEL.SIMULATED
                    : EVIDENCE_LABEL.EXECUTED
        : toolWasExecuted
            ? EVIDENCE_LABEL.EXECUTED
            : EVIDENCE_LABEL.NOT_EXECUTED;
    const summary = [
        `Evidence gate: ${passed ? 'PASSED' : 'FAILED'}`,
        `Claims: ${evidenceClaims.length} (${evidenceClaims.filter((c) => c.label === EVIDENCE_LABEL.EXECUTED).length} EXECUTED, ${evidenceClaims.filter((c) => c.label === EVIDENCE_LABEL.NOT_EXECUTED).length} NOT_EXECUTED, ${evidenceClaims.filter((c) => c.label === EVIDENCE_LABEL.UNVERIFIED).length} UNVERIFIED)`,
        `Violations: ${violations.length}`,
        `Overall: ${overallLabel}`,
        `Tool executed: ${toolWasExecuted}`,
        `Repo verified: ${repoAccessVerified}`,
    ].join(' | ');
    return { passed, claims: evidenceClaims, violations, overallLabel, summary };
}
/**
 * Separate a response into internal (audit) and user-visible (chat) streams.
 * The user_chat stream always carries the evidence label so the UI can
 * surface it (e.g. "NOT EXECUTED" badge) without exposing internal details.
 *
 * Pure function — deterministic.
 */
export function separateStreams(userAnswer, gateResult, requestId, toolOutput) {
    const timestamp = new Date().toISOString();
    const userVisible = {
        stream: 'user_chat',
        answer: userAnswer,
        evidenceLabel: gateResult.overallLabel,
        evidenceMetadata: gateResult.claims.find((c) => c.metadata)?.metadata ?? null,
    };
    const internal = [];
    // task_log — the execution outcome
    internal.push({
        stream: 'task_log',
        requestId,
        timestamp,
        data: {
            gatePassed: gateResult.passed,
            overallLabel: gateResult.overallLabel,
            claimCount: gateResult.claims.length,
            violationCount: gateResult.violations.length,
        },
    });
    // watchdog — prohibitions
    if (gateResult.violations.length > 0) {
        internal.push({
            stream: 'watchdog',
            requestId,
            timestamp,
            data: {
                violations: gateResult.violations.map((v) => ({ rule: v.rule, snippet: v.snippet, reason: v.reason })),
            },
        });
    }
    // tool_output — raw evidence
    if (toolOutput) {
        internal.push({
            stream: 'tool_output',
            requestId,
            timestamp,
            data: toolOutput,
        });
    }
    // audit_report — full gate evaluation
    internal.push({
        stream: 'audit_report',
        requestId,
        timestamp,
        data: {
            summary: gateResult.summary,
            claims: gateResult.claims.map((c) => ({
                category: c.category,
                claimedText: c.claimedText,
                label: c.label,
                reason: c.reason,
            })),
            violations: gateResult.violations,
        },
    });
    return { userVisible, internal };
}
/**
 * Gate for developer-mode reports. Reports are ONLY allowed after:
 * 1. Repository access has been verified, AND
 * 2. A tool was actually executed, AND
 * 3. Evidence was captured.
 *
 * Pure function.
 */
export function gateDeveloperModeReport(gateInput, isDeveloperModeRequest) {
    if (!isDeveloperModeRequest) {
        return { allowed: true, reason: '', gateResult: null };
    }
    if (!gateInput.repoAccessVerified) {
        return {
            allowed: false,
            reason: 'Developer mode report denied: repository access has not been verified.',
            gateResult: evaluateEvidenceGate(gateInput),
        };
    }
    if (!gateInput.toolWasExecuted) {
        return {
            allowed: false,
            reason: 'Developer mode report denied: no tool was executed — cannot generate a developer report from simulated data.',
            gateResult: evaluateEvidenceGate(gateInput),
        };
    }
    if (!gateInput.evidenceMetadata) {
        return {
            allowed: false,
            reason: 'Developer mode report denied: tool was executed but evidence metadata is unavailable.',
            gateResult: evaluateEvidenceGate(gateInput),
        };
    }
    return {
        allowed: true,
        reason: '',
        gateResult: evaluateEvidenceGate(gateInput),
    };
}
// ---------------------------------------------------------------------------
// Answer injection — prepend evidence label when answer is NOT_EXECUTED
// or UNVERIFIED (requirement 3: user-visible labelling)
// ---------------------------------------------------------------------------
/**
 * If the answer makes technical claims without evidence, inject a visible
 * label at the top of the answer so the user knows the claims are not verified.
 *
 * When the gate passes (EXECUTED), the answer is returned unchanged.
 *
 * Pure function.
 */
export function applyEvidenceLabelToAnswer(answer, gateResult) {
    if (gateResult.overallLabel === EVIDENCE_LABEL.EXECUTED) {
        // A technical claim backed by real evidence is classified VERIFIED (TASK 2).
        // Non-technical answers (no claims) are returned unchanged.
        if (gateResult.claims.length > 0) {
            return `✅ VERIFIED — The technical claims in this response are backed by executed tool evidence.\n\n${answer}`;
        }
        return answer;
    }
    if (gateResult.overallLabel === EVIDENCE_LABEL.NOT_EXECUTED && gateResult.claims.length > 0) {
        return `⚠️ NOT EXECUTED — The claims in this response are not backed by executed tool evidence.\n\n${answer}`;
    }
    if (gateResult.overallLabel === EVIDENCE_LABEL.UNVERIFIED && gateResult.claims.length > 0) {
        return `⚠️ UNVERIFIED — Tool evidence for the claims in this response is unavailable.\n\n${answer}`;
    }
    if (gateResult.overallLabel === EVIDENCE_LABEL.SIMULATED) {
        return `⚠️ SIMULATED — This response contains generated/example data, not live execution results.\n\n${answer}`;
    }
    return answer;
}
// ---------------------------------------------------------------------------
// Convenience — build evidence metadata from a tool execution
// ---------------------------------------------------------------------------
export function buildEvidenceMetadata(params) {
    return {
        toolName: params.toolName,
        requestId: params.requestId,
        timestamp: new Date().toISOString(),
        rawOutputRef: params.rawOutputRef,
        label: params.label ?? EVIDENCE_LABEL.EXECUTED,
    };
}
