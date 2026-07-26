export const REPORT_CONTINUATION_MAX_CHARS_PER_PART = 2500;
export const REPORT_CONTINUATION_MAX_TOKENS_ESTIMATE = 12000;
export const REPORT_CONTINUATION_TTL_MS = 10 * 60 * 1000;
export function detectTruncatedResponse(text, maxOutputTokens = REPORT_CONTINUATION_MAX_TOKENS_ESTIMATE) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return false;
    // Explicit continuation markers
    if (trimmed.endsWith('...') ||
        trimmed.endsWith('…') ||
        /\[continued?\s*(?:in\s+next\s+(?:part|message|response))?\]?$/i.test(trimmed) ||
        /to\s+be\s+continued\.?$/i.test(trimmed) ||
        /\(continued\)$/i.test(trimmed) ||
        /\(more\s+items?\s+follow\)$/i.test(trimmed)) {
        return true;
    }
    // Heuristic: very long response ending abruptly
    const estimatedTokens = trimmed.length / 4;
    if (estimatedTokens > maxOutputTokens * 0.85 && maxOutputTokens > 1000) {
        const lastChar = trimmed.slice(-1);
        const terminators = new Set(['.', '!', '?', '"', "'", ')', ']', '}', '>', '`', '*', '_', '-', '”', '’', '»', '›']);
        if (!terminators.has(lastChar)) {
            return true;
        }
        // Last line is an incomplete numbered item
        const lastLine = trimmed.split('\n').pop() ?? '';
        if (/^\s*(?:-\s+)?\d+[.\)]\s+\S+/.test(lastLine) && !/[.!?;:]$/.test(lastLine)) {
            return true;
        }
    }
    return false;
}
export function extractItemNumbers(text) {
    const numbers = [];
    const lines = text.split('\n');
    for (const line of lines) {
        const match = line.match(/^\s*(?:-\s+)?(\d+)[.\)]\s+/);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }
    }
    return numbers;
}
export function extractLastItemNumber(text) {
    const numbers = extractItemNumbers(text);
    return numbers.length > 0 ? Math.max(...numbers) : 0;
}
/**
 * Parse the number of items the owner explicitly asked for, e.g.
 * "audit 1-100", "from 1 to 2000", "list 50 items", "full audit 1–500".
 * Returns null when no explicit count is requested.
 */
export function extractRequestedItemCount(prompt) {
    const normalized = prompt.trim().toLowerCase();
    // Range form: "1-100", "1 to 2000", "from 1 to 500".
    const range = normalized.match(/\b(?:from\s+)?1\s*(?:[-\u2013]|to)\s*(\d{1,5})\b/);
    if (range?.[1]) {
        const upper = Number.parseInt(range[1], 10);
        if (Number.isFinite(upper) && upper > 1)
            return upper;
    }
    // Count form: "100 items", "50 checks", "200 points".
    const count = normalized.match(/\b(\d{1,5})\s+(?:items?|points?|things?|steps?|rows?|entries|checks?)\b/);
    if (count?.[1]) {
        const n = Number.parseInt(count[1], 10);
        if (Number.isFinite(n) && n > 1)
            return n;
    }
    return null;
}
/**
 * True when the owner asked for a specific number of items but the answer
 * delivered fewer than that (the model wrapped up early under its token budget).
 * This catches "asked for 100, got 50" even when the text ends cleanly and the
 * raw truncation heuristic does not fire.
 */
export function detectIncompleteReport(text, requestedCount) {
    if (requestedCount === null || requestedCount <= 1)
        return false;
    const lastItem = extractLastItemNumber(text);
    if (lastItem <= 0)
        return false;
    // Allow a small tolerance so we don't loop forever on near-complete reports.
    return lastItem < requestedCount - 1;
}
export function extractReportTitle(text) {
    const lines = text.split('\n');
    for (const line of lines.slice(0, 5)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('-') && !/^\d+[.\)]/.test(trimmed)) {
            if (trimmed.length > 10 && trimmed.length < 200) {
                return trimmed;
            }
        }
    }
    return null;
}
export function splitReportIntoParts(text, maxCharsPerPart = REPORT_CONTINUATION_MAX_CHARS_PER_PART) {
    if (text.length <= maxCharsPerPart) {
        return [text];
    }
    const parts = [];
    let remaining = text;
    while (remaining.length > maxCharsPerPart) {
        let breakPoint = maxCharsPerPart;
        // Try to break after a complete numbered item
        const searchWindow = remaining.slice(0, maxCharsPerPart + 500);
        const lines = searchWindow.split('\n');
        let currentLength = 0;
        let bestBreak = -1;
        for (let i = 0; i < lines.length; i++) {
            currentLength += lines[i].length + 1; // +1 for newline
            if (currentLength <= maxCharsPerPart) {
                const line = lines[i].trim();
                if (/^\s*(?:-\s+)?\d+[.\)]\s+/.test(line) && /[.!?;:]$/.test(line)) {
                    bestBreak = currentLength;
                }
            }
        }
        if (bestBreak > maxCharsPerPart * 0.5) {
            breakPoint = bestBreak;
        }
        else {
            // Fallback: break at last newline before maxChars
            const lastNewline = remaining.lastIndexOf('\n', maxCharsPerPart);
            if (lastNewline > maxCharsPerPart * 0.3) {
                breakPoint = lastNewline + 1;
            }
        }
        parts.push(remaining.slice(0, breakPoint).trim());
        remaining = remaining.slice(breakPoint).trim();
    }
    if (remaining.length > 0) {
        parts.push(remaining);
    }
    return parts;
}
export function buildReportParts(text, maxCharsPerPart = REPORT_CONTINUATION_MAX_CHARS_PER_PART) {
    const texts = splitReportIntoParts(text, maxCharsPerPart);
    return texts.map((partText, index) => {
        const numbers = extractItemNumbers(partText);
        const itemRange = numbers.length > 0
            ? { start: Math.min(...numbers), end: Math.max(...numbers) }
            : null;
        return {
            text: partText,
            partNumber: index + 1,
            itemRange,
        };
    });
}
export function buildContinuationPrompt(originalPrompt, accumulatedText, lastItemNumber) {
    return [
        `Continue the previous report from exactly where it stopped.`,
        `Original request: ${originalPrompt}`,
        `The previous response ended after item ${lastItemNumber}.`,
        `Do NOT repeat items 1 through ${lastItemNumber}.`,
        `Start with item ${lastItemNumber + 1} immediately.`,
        `Maintain the same format, numbering, and style as the previous parts.`,
    ].join('\n');
}
export function isContinuationRequest(prompt) {
    const normalized = prompt.trim().toLowerCase();
    return (/^(?:continue|next\s+part|resume|go\s+on|proceed)[.!?]?$/i.test(normalized) ||
        normalized.includes('continue the report') ||
        normalized.includes('continue from') ||
        normalized.includes('next part') ||
        normalized.includes('resume from') ||
        /^cont(?:inue)?$/i.test(normalized));
}
export function detectReportPattern(text) {
    const lines = text.split('\n');
    let itemCount = 0;
    for (const line of lines) {
        if (/^\s*(?:-\s+)?\d+[.\)]\s+/.test(line)) {
            itemCount++;
        }
    }
    return itemCount >= 5 || (text.length > 3000 && itemCount >= 3);
}
export function buildContinuationState(token, conversationId, originalPrompt, reportTitle, parts) {
    const allNumbers = parts.flatMap((p) => extractItemNumbers(p.text));
    const totalItemsEstimate = allNumbers.length > 0 ? Math.max(...allNumbers) : null;
    const lastCompletedItemNumber = parts[0]?.itemRange?.end ?? 0;
    return {
        token,
        conversationId,
        originalPrompt,
        reportTitle,
        parts,
        currentPartIndex: 0,
        lastCompletedItemNumber,
        totalItemsEstimate,
        accumulatedText: parts[0]?.text ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
export function buildContinuationPartMessage(partNumber, totalParts, nextItemNumber, isComplete) {
    if (isComplete) {
        return `Part ${partNumber} of ${totalParts} — report complete.`;
    }
    if (nextItemNumber !== null) {
        return `Part ${partNumber} of ${totalParts} complete. Continuing automatically from item ${nextItemNumber}...`;
    }
    return `Part ${partNumber} of ${totalParts} complete. Continuing automatically...`;
}
export function buildContinuationUserPrompt(nextItemNumber) {
    if (nextItemNumber !== null) {
        return `Reply CONTINUE to resume from item ${nextItemNumber}.`;
    }
    return 'Reply CONTINUE to resume the report.';
}
