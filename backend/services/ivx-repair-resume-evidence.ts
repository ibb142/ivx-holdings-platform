import { requiresRepairRegression } from './ivx-repair-patch-quality';

type Receipt = {
  command: string;
  phase?: string;
  ok: boolean;
  exitCode: number | null;
  stdoutHash: string;
  stderrHash: string;
};

/** A restart must not publish a repair that bypassed the regression gate. */
export function assertRepairResumeEvidence(taskId: string, goal: string, receipts: readonly Receipt[] = []): void {
  if (!requiresRepairRegression(taskId, goal)) return;
  const fingerprinted = (row: Receipt) => /^[a-f0-9]{64}$/.test(row.stdoutHash) && /^[a-f0-9]{64}$/.test(row.stderrHash);
  const reproduced = receipts.some((baseline, index) => baseline.phase === 'regression_baseline'
    && !baseline.ok && baseline.exitCode === 1 && fingerprinted(baseline)
    && receipts.slice(index + 1).some(patched => patched.command === baseline.command
      && patched.phase !== 'regression_baseline' && patched.ok && patched.exitCode === 0 && fingerprinted(patched)));
  if (!reproduced) {
    throw new Error('REPAIR_REGRESSION_EVIDENCE_MISSING: restart recovery cannot merge this repair without persisted failing-baseline and passing-patched receipts for the same regression. Revalidate the repair first.');
  }
}
