/**
 * IVX Learning Loop — Phase 16
 *
 * After every task, records: owner request, selected intent, context, tools,
 * model, result, failure, correction, owner feedback, verified outcome, reusable lesson.
 * Uses lessons to improve retrieval ranking, task routing, prompts, tool selection.
 *
 * Only uses verified outcomes as learning examples — never unverified conversations.
 */
import { randomUUID } from 'crypto';
// ─── Store ────────────────────────────────────────────────────────
const lessonStore = new Map();
const MAX_LESSONS = 200;
// ─── Record Lesson ────────────────────────────────────────────────
export function recordLesson(input) {
    const record = {
        id: randomUUID(),
        taskType: input.taskType,
        ownerRequest: input.ownerRequest.slice(0, 500),
        selectedIntent: input.selectedIntent,
        selectedModel: input.selectedModel,
        selectedTools: input.selectedTools,
        result: input.result,
        failureDetail: input.failureDetail || null,
        correction: input.correction || null,
        ownerFeedback: input.ownerFeedback || null,
        verifiedOutcome: input.verifiedOutcome,
        reusableLesson: input.reusableLesson || null,
        createdAt: new Date().toISOString(),
        appliedToRouting: false,
        appliedToRetrieval: false,
        appliedToPrompts: false,
    };
    // Only store verified lessons — do not learn from unverified outcomes
    if (input.verifiedOutcome) {
        lessonStore.set(record.id, record);
        if (lessonStore.size > MAX_LESSONS) {
            const oldest = [...lessonStore.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
            if (oldest)
                lessonStore.delete(oldest.id);
        }
    }
    return record;
}
// ─── Retrieve Lessons ─────────────────────────────────────────────
export function getLessons(input) {
    let results = [...lessonStore.values()];
    if (input?.taskType) {
        results = results.filter((l) => l.taskType === input.taskType);
    }
    if (input?.verifiedOnly !== false) {
        results = results.filter((l) => l.verifiedOutcome);
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results.slice(0, input?.limit || 20);
}
/**
 * Find lessons relevant to a new task.
 * Used to improve routing, retrieval, and prompts.
 */
export function findRelevantLessons(input) {
    const all = getLessons({ verifiedOnly: true, limit: 50 });
    const requestLower = input.ownerRequest.toLowerCase();
    const requestWords = requestLower.split(/\s+/).filter((w) => w.length > 3);
    const scored = all.map((lesson) => {
        let score = 0;
        if (lesson.taskType === input.taskType)
            score += 10;
        const lessonWords = lesson.ownerRequest.toLowerCase().split(/\s+/);
        for (const word of requestWords) {
            if (lessonWords.includes(word))
                score += 2;
        }
        if (lesson.result === 'success')
            score += 3;
        if (lesson.result === 'failure')
            score += 5; // Failures are valuable lessons
        if (lesson.reusableLesson)
            score += 5;
        return { lesson, score };
    });
    return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((s) => s.lesson);
}
// ─── Apply Lessons ────────────────────────────────────────────────
/**
 * Mark a lesson as applied to routing improvements.
 */
export function applyLessonToRouting(lessonId) {
    const lesson = lessonStore.get(lessonId);
    if (!lesson)
        return false;
    lessonStore.set(lessonId, { ...lesson, appliedToRouting: true });
    return true;
}
export function applyLessonToRetrieval(lessonId) {
    const lesson = lessonStore.get(lessonId);
    if (!lesson)
        return false;
    lessonStore.set(lessonId, { ...lesson, appliedToRetrieval: true });
    return true;
}
export function applyLessonToPrompts(lessonId) {
    const lesson = lessonStore.get(lessonId);
    if (!lesson)
        return false;
    lessonStore.set(lessonId, { ...lesson, appliedToPrompts: true });
    return true;
}
// ─── Stats ────────────────────────────────────────────────────────
export function getLearningStats() {
    const lessons = [...lessonStore.values()];
    const verified = lessons.filter((l) => l.verifiedOutcome);
    const successCount = verified.filter((l) => l.result === 'success').length;
    const failureCount = verified.filter((l) => l.result === 'failure').length;
    const correctionCount = verified.filter((l) => l.result === 'corrected').length;
    const total = verified.length;
    // Failure patterns
    const failurePatternMap = new Map();
    for (const l of verified.filter((l) => l.result === 'failure' && l.failureDetail)) {
        const pattern = l.failureDetail.slice(0, 100);
        failurePatternMap.set(pattern, (failurePatternMap.get(pattern) || 0) + 1);
    }
    const topFailurePatterns = [...failurePatternMap.entries()]
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    // Model performance
    const modelPerfMap = new Map();
    for (const l of verified) {
        const existing = modelPerfMap.get(l.selectedModel) || { total: 0, success: 0 };
        modelPerfMap.set(l.selectedModel, {
            total: existing.total + 1,
            success: existing.success + (l.result === 'success' ? 1 : 0),
        });
    }
    const modelPerformance = {};
    for (const [model, stats] of modelPerfMap) {
        modelPerformance[model] = {
            ...stats,
            successRate: stats.total > 0 ? stats.success / stats.total : 0,
        };
    }
    // Intent accuracy
    const intentMap = new Map();
    for (const l of verified) {
        const existing = intentMap.get(l.selectedIntent) || { total: 0, correct: 0 };
        intentMap.set(l.selectedIntent, {
            total: existing.total + 1,
            correct: existing.correct + (l.result === 'success' || l.result === 'corrected' ? 1 : 0),
        });
    }
    const intentAccuracy = {};
    for (const [intent, stats] of intentMap) {
        intentAccuracy[intent] = {
            ...stats,
            accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        };
    }
    return {
        totalLessons: lessons.length,
        verifiedLessons: verified.length,
        successRate: total > 0 ? successCount / total : 0,
        failureRate: total > 0 ? failureCount / total : 0,
        correctionRate: total > 0 ? correctionCount / total : 0,
        topFailurePatterns,
        modelPerformance,
        intentAccuracy,
    };
}
export const IVX_LEARNING_LOOP_MARKER = 'ivx-learning-loop-2026-07-23-v1';
