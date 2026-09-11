export type RetargetingRecord = Record<string, unknown>;

/** Supabase select returns rows, never the retired engagement dashboard envelope. */
export function parseRetargetingRecords(value: unknown): RetargetingRecord[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Retargeting records have an invalid response format.');
  }
  return value as RetargetingRecord[];
}

export function retargetingValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '—';
}
