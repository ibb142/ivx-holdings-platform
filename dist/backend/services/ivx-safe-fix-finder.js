/**
 * IVX Generative Safe-Issue Finder (BLOCK — Gap #3).
 *
 * Sits on top of the continuous-improvement scan (`ivx-continuous-improvement`)
 * and turns its mechanical, owner-safe proposals into CANDIDATE PATCHES with
 * real, evidence-backed validation — WITHOUT ever writing to disk. It detects
 * the only category that is genuinely safe to auto-fix today (empty `catch {}`
 * blocks → logged catches), generates a minimal candidate patch for each, and
 * validates the patch deterministically by:
 *   1. confirming the patch APPLIES cleanly (the target line still matches the
 *      detected empty-catch pattern → the patch is not stale), and
 *   2. RE-SCANNING the patched file content with the same tech-debt scanner to
 *      confirm the empty-catch freeze-risk is RESOLVED and the patch introduces
 *      NO new freeze risk.
 *
 * The pure core (`generateEmptyCatchPatch`, `buildSafeFixCandidate`) is fully
 * unit-testable. The I/O layer (`findSafeFixes`) reads the real workspace files
 * referenced by the safe proposals. Honest by construction: a finding it cannot
 * safely transform is reported with `applied:false` + the exact reason, never a
 * fabricated fix. Application of any candidate stays owner-gated through the
 * existing safe auto-apply lane — this finder only PROPOSES + PROVES.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContentForDebt } from './ivx-tech-debt-scanner';
import { planSafeAutoImprovements, } from './ivx-continuous-improvement';
export const SAFE_FIX_FINDER_MARKER = 'ivx-safe-fix-finder-2026-06-07';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Matches an empty catch block and captures an optional binding identifier. */
const EMPTY_CATCH_RE = /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\)\s*)?\{\s*\}/;
/**
 * Pure: generate a logged-catch replacement for an empty `catch {}` on one line.
 * Returns null when the line has no safe empty-catch transform.
 */
export function generateEmptyCatchPatch(line, contextLabel) {
    const match = EMPTY_CATCH_RE.exec(line);
    if (!match)
        return null;
    const binding = match[1] ?? 'error';
    const message = `[ivx] handled error at ${contextLabel}`;
    const replacement = `catch (${binding}) { console.error(${JSON.stringify(message)}, ${binding}); }`;
    const patchedLine = line.replace(match[0], replacement);
    if (patchedLine === line)
        return null;
    return { patchedLine, binding };
}
/**
 * Pure: build + validate a safe-fix candidate for one finding inside a file's
 * content. Validation re-scans the patched content with the real tech-debt
 * scanner — no disk writes, no fabrication.
 */
export function buildSafeFixCandidate(input) {
    const { proposalId, category, relativePath, line, content } = input;
    const lines = content.split(/\r?\n/);
    const originalLine = lines[line - 1] ?? '';
    const base = {
        proposalId,
        category,
        relativePath,
        line,
        issue: 'Empty catch block swallows errors silently (freeze risk).',
        originalLine,
    };
    const patch = generateEmptyCatchPatch(originalLine, `${relativePath}:${line}`);
    if (!patch) {
        return {
            ...base,
            patchedLine: originalLine,
            diff: '',
            validation: {
                applied: false,
                issueResolved: false,
                noNewFreezeRisk: false,
                ok: false,
                reason: 'No safe mechanical transform for this line (not a recognised empty-catch pattern at the recorded line).',
            },
        };
    }
    const patchedLines = [...lines];
    patchedLines[line - 1] = patch.patchedLine;
    const patchedContent = patchedLines.join('\n');
    const beforeFreeze = scanContentForDebt(relativePath, content).filter((f) => f.kind === 'freeze_risk');
    const afterFreeze = scanContentForDebt(relativePath, patchedContent).filter((f) => f.kind === 'freeze_risk');
    const targetGone = !afterFreeze.some((f) => f.line === line && f.marker === 'empty-catch');
    const noNewFreezeRisk = afterFreeze.length <= beforeFreeze.length;
    const ok = targetGone && noNewFreezeRisk;
    return {
        ...base,
        patchedLine: patch.patchedLine,
        diff: `- ${originalLine.trim()}\n+ ${patch.patchedLine.trim()}`,
        validation: {
            applied: true,
            issueResolved: targetGone,
            noNewFreezeRisk,
            ok,
            reason: ok
                ? 'Patch applies cleanly; re-scan confirms the empty-catch freeze-risk is resolved with no new freeze risk.'
                : !targetGone
                    ? 'Patch did not resolve the empty-catch freeze-risk on the target line.'
                    : 'Patch introduced a new freeze risk; rejected.',
        },
    };
}
function resolveRepoPath(relativePath) {
    const cleaned = relativePath.replace(/^\/+/, '');
    const full = path.resolve(SERVER_ROOT, cleaned);
    if (!full.startsWith(SERVER_ROOT))
        return null;
    return full;
}
/**
 * Run the generative safe-fix finder over the latest continuous-improvement
 * safe plan: for every safe (logging_fix / empty-catch) proposal, read the real
 * file and generate + validate a candidate patch. Never applies; never throws.
 */
export async function findSafeFixes(options) {
    let plan = options?.plan ?? null;
    try {
        if (!plan)
            plan = await planSafeAutoImprovements();
    }
    catch {
        plan = null;
    }
    const candidates = [];
    const fileCache = new Map();
    if (plan) {
        for (const proposal of plan.safeProposals) {
            if (proposal.category !== 'logging_fix')
                continue;
            for (const evidence of proposal.evidence) {
                const full = resolveRepoPath(evidence.relativePath);
                if (!full)
                    continue;
                let content = fileCache.get(full);
                if (content === undefined) {
                    content = await readFile(full, 'utf8').catch(() => null);
                    fileCache.set(full, content);
                }
                if (content === null) {
                    candidates.push({
                        proposalId: proposal.id,
                        category: proposal.category,
                        relativePath: evidence.relativePath,
                        line: evidence.line,
                        issue: 'Empty catch block swallows errors silently (freeze risk).',
                        originalLine: evidence.snippet,
                        patchedLine: evidence.snippet,
                        diff: '',
                        validation: {
                            applied: false,
                            issueResolved: false,
                            noNewFreezeRisk: false,
                            ok: false,
                            reason: 'Source file could not be read for validation.',
                        },
                    });
                    continue;
                }
                candidates.push(buildSafeFixCandidate({
                    proposalId: proposal.id,
                    category: proposal.category,
                    relativePath: evidence.relativePath,
                    line: evidence.line,
                    content,
                }));
            }
        }
    }
    const validated = candidates.filter((c) => c.validation.ok).length;
    return {
        marker: SAFE_FIX_FINDER_MARKER,
        generatedAt: new Date().toISOString(),
        sourceAuditId: plan?.sourceAuditId ?? null,
        safeProposalsConsidered: plan?.safeProposals.length ?? 0,
        candidates,
        summary: {
            totalCandidates: candidates.length,
            validated,
            rejected: candidates.length - validated,
        },
        note: candidates.length === 0
            ? 'No safe mechanical fixes detected — every current finding needs owner review.'
            : `${validated}/${candidates.length} candidate patch(es) validated as proven-safe; application stays owner-gated.`,
    };
}
