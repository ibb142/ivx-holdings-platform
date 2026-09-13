export type SeniorLedgerPage<T> = {
  entries: T[]; total: number; offset: number; nextOffset: number | null; updatedAt: string | null;
};
export const SENIOR_LEDGER_PAGE_SIZE = 25;
export const SENIOR_LEDGER_MAX_PAGE_SIZE = 50;

export function assertLedgerPageRequest(limit: number, offset: number, version: string | null): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SENIOR_LEDGER_MAX_PAGE_SIZE
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 200
    || (version !== null && !Number.isFinite(Date.parse(version)))) throw new Error('Invalid ledger page request');
}

/** Never return a partial or mixed-revision ledger after a failed page. */
export async function readLedgerEntries<T extends { jobId: string }>(limit: number,
  readPage: (size: number, offset: number, version: string | null) => Promise<SeniorLedgerPage<T>>): Promise<T[]> {
  const entries: T[] = [];
  let offset = 0, version: string | null = null;
  while (entries.length < limit) {
    const page = await readPage(Math.min(SENIOR_LEDGER_MAX_PAGE_SIZE, limit - entries.length), offset, version);
    if (offset > 0 && page.updatedAt !== version) throw new Error('Ledger changed while paging; retry from the first page');
    entries.push(...page.entries);
    if (page.nextOffset === null) break;
    if (page.nextOffset <= offset || page.nextOffset !== offset + page.entries.length) throw new Error('Invalid ledger page cursor');
    offset = page.nextOffset; version = page.updatedAt;
  }
  if (new Set(entries.map(entry => entry.jobId)).size !== entries.length) throw new Error('Duplicate ledger identity');
  return entries;
}
