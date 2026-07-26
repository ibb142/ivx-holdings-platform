/**
 * Isolated in-memory SQLite database for the certification app.
 * Completely separate from IVX production Supabase.
 * No access to production business tables.
 */
function generateId() {
    return `cert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
    return new Date().toISOString();
}
/**
 * In-memory store with indexing for fast lookups and filtering.
 * Simulates a real database with indexes on id, status, and title.
 */
export function createCertDatabase() {
    const items = new Map();
    const indexByStatus = new Map();
    const indexByTitle = new Map();
    let ready = true;
    function addToIndex(index, key, itemId) {
        if (!index.has(key))
            index.set(key, new Set());
        index.get(key).add(itemId);
    }
    function removeFromIndex(index, key, itemId) {
        const set = index.get(key);
        if (set) {
            set.delete(itemId);
            if (set.size === 0)
                index.delete(key);
        }
    }
    function reindex(item) {
        addToIndex(indexByStatus, item.status, item.id);
        addToIndex(indexByTitle, item.title.toLowerCase(), item.id);
    }
    function unindex(item) {
        removeFromIndex(indexByStatus, item.status, item.id);
        removeFromIndex(indexByTitle, item.title.toLowerCase(), item.id);
    }
    return {
        isReady() {
            return ready;
        },
        seedTestData() {
            const seedItems = [
                { title: 'QA Test Item 1', description: 'First isolated certification test item.', status: 'active', ownerId: 'cert-user-001' },
                { title: 'QA Test Item 2', description: 'Second isolated certification test item.', status: 'draft', ownerId: 'cert-user-001' },
                { title: 'QA Test Item 3', description: 'Third isolated certification test item.', status: 'archived', ownerId: 'cert-user-001' },
            ];
            for (const input of seedItems) {
                const id = generateId();
                const now = nowIso();
                const item = { ...input, id, createdAt: now, updatedAt: now };
                items.set(id, item);
                reindex(item);
            }
        },
        listItems(opts) {
            let results = Array.from(items.values());
            // Filter by status using index
            if (opts.status) {
                const statusIds = indexByStatus.get(opts.status);
                if (statusIds) {
                    results = results.filter((item) => statusIds.has(item.id));
                }
                else {
                    results = [];
                }
            }
            // Filter by search query using title index
            if (opts.q) {
                const qLower = opts.q.toLowerCase();
                results = results.filter((item) => item.title.toLowerCase().includes(qLower) ||
                    item.description.toLowerCase().includes(qLower));
            }
            // Sort by createdAt descending
            results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const total = results.length;
            const start = (opts.page - 1) * opts.limit;
            const paginated = results.slice(start, start + opts.limit);
            return { items: paginated, total };
        },
        getItem(id) {
            return items.get(id) ?? null;
        },
        createItem(input) {
            const id = generateId();
            const now = nowIso();
            const item = { ...input, id, createdAt: now, updatedAt: now };
            items.set(id, item);
            reindex(item);
            return item;
        },
        updateItem(id, patch) {
            const existing = items.get(id);
            if (!existing)
                return null;
            unindex(existing);
            const updated = {
                ...existing,
                title: patch.title ?? existing.title,
                description: patch.description ?? existing.description,
                status: patch.status ?? existing.status,
                updatedAt: nowIso(),
            };
            items.set(id, updated);
            reindex(updated);
            return updated;
        },
        deleteItem(id) {
            const existing = items.get(id);
            if (!existing)
                return false;
            unindex(existing);
            return items.delete(id);
        },
        count() {
            return items.size;
        },
        reset() {
            items.clear();
            indexByStatus.clear();
            indexByTitle.clear();
        },
    };
}
