/**
 * SSE replay buffer.
 *
 * Keeps the last N events per stream key so a late subscriber can request
 * replay-from-cursor and rejoin without missing repair-job stages, incident
 * lifecycle events, or owner-ai diagnostics frames.
 *
 * In-memory only — designed for single-instance Render service. Multi-instance
 * deploys should move this to Redis later (not in this turn).
 */
const MAX_EVENTS_PER_STREAM = 200;
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const streams = new Map();
function getOrCreate(streamKey) {
    let state = streams.get(streamKey);
    if (!state) {
        state = { buffer: [], nextId: 1 };
        streams.set(streamKey, state);
    }
    return state;
}
function prune(state) {
    const now = Date.now();
    while (state.buffer.length > 0 && (state.buffer.length > MAX_EVENTS_PER_STREAM || now - state.buffer[0].ts > MAX_AGE_MS)) {
        state.buffer.shift();
    }
}
/** Record an event into the replay buffer. Returns the assigned id. */
export function recordSSEEvent(streamKey, event, data) {
    if (typeof streamKey !== 'string' || streamKey.length === 0)
        return 0;
    const state = getOrCreate(streamKey);
    const entry = { id: state.nextId, event, data, ts: Date.now() };
    state.buffer.push(entry);
    state.nextId += 1;
    prune(state);
    return entry.id;
}
/**
 * Return events with id > sinceId for the given stream, ordered ascending.
 * A new subscriber typically sends ?lastEventId=<n> from the SSE protocol.
 */
export function getSSEEventsSince(streamKey, sinceId) {
    const state = streams.get(streamKey);
    if (!state)
        return [];
    prune(state);
    if (!Number.isFinite(sinceId) || sinceId < 0)
        return state.buffer.slice();
    return state.buffer.filter((e) => e.id > sinceId);
}
/** Stats for diagnostics endpoints. */
export function getSSEReplayStats() {
    const rows = [];
    for (const [streamKey, state] of streams.entries()) {
        prune(state);
        const last = state.buffer[state.buffer.length - 1];
        rows.push({
            streamKey,
            bufferedCount: state.buffer.length,
            lastId: state.nextId - 1,
            lastTs: last ? last.ts : null,
        });
    }
    return rows;
}
/** Clear a stream (used when a job/incident terminates). */
export function clearSSEStream(streamKey) {
    streams.delete(streamKey);
}
