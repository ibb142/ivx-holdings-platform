/**
 * IVX task block splitter — deterministic, runtime-free, fully unit-testable.
 *
 * A large owner task is rarely safe to run in one fragile pass. This splitter
 * decomposes the original task text into ordered, self-contained BLOCKS so the
 * orchestrator can execute, persist, and resume them one at a time.
 *
 * Splitting strategy (first signal that produces ≥2 blocks wins):
 *   1. Explicit "Block N" / "Step N" / "Phase N" headers.
 *   2. Numbered list items ("1. ...", "2) ...").
 *   3. Bullet list items ("- ...", "* ...").
 *   4. Blank-line-separated paragraphs.
 *   5. Fallback: the whole task as a single block.
 *
 * No AI, no network, no filesystem — so the decomposition is reproducible and
 * testable everywhere.
 */
/** Hard ceiling so a pathological 500-item paste can't create 500 blocks. */
const MAX_BLOCKS = 40;
/** Below this, a "list item" is treated as noise, not a real block. */
const MIN_GOAL_CHARS = 3;
function clampBlocks(blocks) {
    if (blocks.length <= MAX_BLOCKS) {
        return blocks;
    }
    // Keep the first MAX_BLOCKS-1 blocks and fold the remainder into a final block.
    const head = blocks.slice(0, MAX_BLOCKS - 1);
    const tail = blocks.slice(MAX_BLOCKS - 1);
    head.push({
        title: 'Remaining work',
        goal: tail.map((block) => block.goal).join('\n'),
    });
    return head;
}
function deriveTitle(goal, index) {
    const firstLine = goal.split('\n')[0]?.trim() ?? '';
    const stripped = firstLine.replace(/[.:;,\-—\s]+$/, '').trim();
    if (!stripped) {
        return `Block ${index + 1}`;
    }
    const words = stripped.split(/\s+/).slice(0, 8).join(' ');
    return words.length > 80 ? `${words.slice(0, 77)}…` : words;
}
function finalize(rawBlocks) {
    const cleaned = rawBlocks
        .map((raw) => raw.trim())
        .filter((raw) => raw.length >= MIN_GOAL_CHARS);
    const planned = cleaned.map((goal, index) => ({ title: deriveTitle(goal, index), goal }));
    return clampBlocks(planned);
}
const HEADER_PATTERN = /^\s*(?:#{1,6}\s*)?(?:block|step|phase|part|stage)\s*[#:]?\s*\d+\b.*$/i;
const NUMBERED_PATTERN = /^\s*\d+[.)]\s+\S/;
const BULLET_PATTERN = /^\s*[-*•]\s+\S/;
function splitByHeaders(lines) {
    const indices = [];
    lines.forEach((line, index) => {
        if (HEADER_PATTERN.test(line)) {
            indices.push(index);
        }
    });
    if (indices.length < 2) {
        return null;
    }
    const sections = [];
    for (let i = 0; i < indices.length; i += 1) {
        const start = indices[i];
        const end = i + 1 < indices.length ? indices[i + 1] : lines.length;
        sections.push(lines.slice(start, end).join('\n'));
    }
    return sections;
}
function splitByLinePattern(lines, pattern) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
        if (pattern.test(line)) {
            if (current) {
                blocks.push(current.join('\n'));
            }
            current = [line];
        }
        else if (current) {
            // Continuation / wrapped lines belong to the current item.
            current.push(line);
        }
    }
    if (current) {
        blocks.push(current.join('\n'));
    }
    return blocks.length >= 2 ? blocks : null;
}
function splitByParagraphs(text) {
    const paragraphs = text
        .split(/\n\s*\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
    return paragraphs.length >= 2 ? paragraphs : null;
}
/**
 * Decompose an owner task into ordered blocks. Always returns ≥1 block; a task
 * that can't be split becomes a single block so the orchestrator still tracks it.
 */
export function splitTaskIntoBlocks(task) {
    const normalized = (task ?? '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }
    const lines = normalized.split('\n');
    const byHeaders = splitByHeaders(lines);
    if (byHeaders) {
        return finalize(byHeaders);
    }
    const byNumbered = splitByLinePattern(lines, NUMBERED_PATTERN);
    if (byNumbered) {
        return finalize(byNumbered);
    }
    const byBullets = splitByLinePattern(lines, BULLET_PATTERN);
    if (byBullets) {
        return finalize(byBullets);
    }
    const byParagraphs = splitByParagraphs(normalized);
    if (byParagraphs) {
        return finalize(byParagraphs);
    }
    return finalize([normalized]);
}
