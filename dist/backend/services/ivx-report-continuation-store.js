const store = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 minutes
function cleanup() {
    const now = Date.now();
    for (const [token, state] of store.entries()) {
        if (now - state.updatedAt > TTL_MS) {
            store.delete(token);
        }
    }
}
// Cleanup every minute
setInterval(cleanup, 60_000);
export function saveContinuationState(state) {
    store.set(state.token, state);
}
export function getContinuationState(token) {
    const state = store.get(token) ?? null;
    if (state && Date.now() - state.updatedAt > TTL_MS) {
        store.delete(token);
        return null;
    }
    return state;
}
export function updateContinuationState(token, updates) {
    const state = store.get(token);
    if (!state)
        return false;
    store.set(token, { ...state, ...updates, updatedAt: Date.now() });
    return true;
}
export function deleteContinuationState(token) {
    store.delete(token);
}
export function listActiveContinuationTokens() {
    cleanup();
    return Array.from(store.keys());
}
