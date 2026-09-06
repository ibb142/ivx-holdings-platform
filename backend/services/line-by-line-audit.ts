import { executeLineAudit } from './audit-helpers';

export async function lineByLineAuditWorkflow(): Promise<{ ok: boolean; details?: string }> {
  try {
    const result = await executeLineAudit();
    return { ok: result.success, details: result.details };
  } catch (error) {
    return { ok: false, details: error instanceof Error ? error.message : 'Unknown error' };
  }
}
