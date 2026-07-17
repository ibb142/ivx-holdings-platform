/**
 * Isolated in-memory SQLite database for the certification app.
 * Completely separate from IVX production Supabase.
 * No access to production business tables.
 */

export type CertItem = {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type CertDB = {
  isReady(): boolean;
  seedTestData(): void;
  listItems(opts: { page: number; limit: number; status?: string; q?: string }): { items: CertItem[]; total: number };
  getItem(id: string): CertItem | null;
  createItem(input: Omit<CertItem, 'id' | 'createdAt' | 'updatedAt'>): CertItem;
  updateItem(id: string, patch: Partial<Pick<CertItem, 'title' | 'description' | 'status'>>): CertItem | null;
  deleteItem(id: string): boolean;
  count(): number;
  reset(): void;
};

function generateId(): string {
  return `cert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * In-memory store with indexing for fast lookups and filtering.
 * Simulates a real database with indexes on id, status, and title.
 */
export function createCertDatabase(): CertDB {
  const items = new Map<string, CertItem>();
  const indexByStatus = new Map<string, Set<string>>();
  const indexByTitle = new Map<string, Set<string>>();
  let ready = true;

  function addToIndex(index: Map<string, Set<string>>, key: string, itemId: string): void {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(itemId);
  }

  function removeFromIndex(index: Map<string, Set<string>>, key: string, itemId: string): void {
    const set = index.get(key);
    if (set) {
      set.delete(itemId);
      if (set.size === 0) index.delete(key);
    }
  }

  function reindex(item: CertItem): void {
    addToIndex(indexByStatus, item.status, item.id);
    addToIndex(indexByTitle, item.title.toLowerCase(), item.id);
  }

  function unindex(item: CertItem): void {
    removeFromIndex(indexByStatus, item.status, item.id);
    removeFromIndex(indexByTitle, item.title.toLowerCase(), item.id);
  }

  return {
    isReady(): boolean {
      return ready;
    },

    seedTestData(): void {
      const seedItems: Array<Omit<CertItem, 'id' | 'createdAt' | 'updatedAt'>> = [
        { title: 'QA Test Item 1', description: 'First isolated certification test item.', status: 'active', ownerId: 'cert-user-001' },
        { title: 'QA Test Item 2', description: 'Second isolated certification test item.', status: 'draft', ownerId: 'cert-user-001' },
        { title: 'QA Test Item 3', description: 'Third isolated certification test item.', status: 'archived', ownerId: 'cert-user-001' },
      ];
      for (const input of seedItems) {
        const id = generateId();
        const now = nowIso();
        const item: CertItem = { ...input, id, createdAt: now, updatedAt: now };
        items.set(id, item);
        reindex(item);
      }
    },

    listItems(opts: { page: number; limit: number; status?: string; q?: string }): { items: CertItem[]; total: number } {
      let results = Array.from(items.values());

      // Filter by status using index
      if (opts.status) {
        const statusIds = indexByStatus.get(opts.status);
        if (statusIds) {
          results = results.filter((item) => statusIds.has(item.id));
        } else {
          results = [];
        }
      }

      // Filter by search query using title index
      if (opts.q) {
        const qLower = opts.q.toLowerCase();
        results = results.filter((item) =>
          item.title.toLowerCase().includes(qLower) ||
          item.description.toLowerCase().includes(qLower)
        );
      }

      // Sort by createdAt descending
      results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const total = results.length;
      const start = (opts.page - 1) * opts.limit;
      const paginated = results.slice(start, start + opts.limit);

      return { items: paginated, total };
    },

    getItem(id: string): CertItem | null {
      return items.get(id) ?? null;
    },

    createItem(input: Omit<CertItem, 'id' | 'createdAt' | 'updatedAt'>): CertItem {
      const id = generateId();
      const now = nowIso();
      const item: CertItem = { ...input, id, createdAt: now, updatedAt: now };
      items.set(id, item);
      reindex(item);
      return item;
    },

    updateItem(id: string, patch: Partial<Pick<CertItem, 'title' | 'description' | 'status'>>): CertItem | null {
      const existing = items.get(id);
      if (!existing) return null;
      unindex(existing);
      const updated: CertItem = {
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

    deleteItem(id: string): boolean {
      const existing = items.get(id);
      if (!existing) return false;
      unindex(existing);
      return items.delete(id);
    },

    count(): number {
      return items.size;
    },

    reset(): void {
      items.clear();
      indexByStatus.clear();
      indexByTitle.clear();
    },
  };
}
