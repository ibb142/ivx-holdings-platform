/** Versioned recovery rules reconstructed from durable failures on every restart.
 * These are instructions backed by regression tests, not model-authored memories.
 * No arbitrary diagnostic text is promoted into an executable instruction.
 */
export const REPAIR_RECOVERY_PROTOCOL = 'ivx-repair-recovery-protocol-v1';
export const NODE_REPAIR_TEST_GUIDANCE = 'Preserve existing bun:test suites. Create a separate focused *.node-regression.test.ts beside the implementation, using node:test and node:assert/strict. Import every test API; do not use global expect. Run it with node --import tsx --test. The same test must fail with ERR_ASSERTION on the original implementation and pass with the fix.';

export type RepairRecoveryLesson = {
  protocol: typeof REPAIR_RECOVERY_PROTOCOL;
  id: 'NODE_TEST_RUNTIME' | 'PATCH_CONTEXT' | 'REGRESSION_REQUIRED' | 'DEFECT_NOT_REPRODUCED';
  instruction: string;
};

export function repairRecoveryLesson(failure: string | null | undefined): RepairRecoveryLesson | null {
  if (!failure) return null;
  const make = (id: RepairRecoveryLesson['id'], instruction: string): RepairRecoveryLesson => ({ protocol: REPAIR_RECOVERY_PROTOCOL, id, instruction });
  // Inspect the complete persisted failure BEFORE redaction/truncation of its
  // display summary. The actionable runtime error often follows a long wrapper.
  if (/REPAIR_NODE_TEST_REQUIRED|Cannot find module ['"]bun:test['"]|Cannot find module ['"]bun:test['"] or its corresponding type declarations|\b(?:expect|describe|it|test) is not defined\b/.test(failure)) {
    return make('NODE_TEST_RUNTIME', NODE_REPAIR_TEST_GUIDANCE);
  }
  if (/Patch oldText not found|REPAIR_SOURCE_NOT_INSPECTED|Create-file target already exists/.test(failure)) {
    return make('PATCH_CONTEXT', 'Read the actual current target file again. Copy an exact unique snippet from the inspected source. Use replace_exact for existing files and a new unique path for a new Node regression. Failed patches are reverted; never use an earlier proposed patch as the source baseline.');
  }
  if (/REPAIR_REGRESSION_TEST_REQUIRED/.test(failure)) return make('REGRESSION_REQUIRED', NODE_REPAIR_TEST_GUIDANCE);
  if (/REPAIR_REGRESSION_NOT_REPRODUCED/.test(failure)) {
    return make('DEFECT_NOT_REPRODUCED', 'The proposed test did not reproduce the reported defect. Inspect the real entry point and use the failing input. A passing baseline, import error or manufactured assertion is not repair evidence. Missing customer assets require a blocked dependency, never invented media or weaker acceptance criteria.');
  }
  return null;
}

type Operation = { path: string; kind: string; oldText: string; newText: string };
const importsBunTest = (source: string) => /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]bun:test['"]/.test(source);

/** Enforce the deployed test runtime before writing any generated operation. */
export async function assertRepairTestRuntime(operations: Operation[], read: (file: string) => Promise<string>): Promise<void> {
  const staged = new Map<string, string>();
  for (const op of operations) {
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(op.path)) continue;
    const original = op.kind === 'create_file' ? '' : staged.get(op.path) ?? await read(op.path);
    const candidate = op.kind === 'create_file' ? op.newText : original.replace(op.oldText, op.newText);
    if (importsBunTest(original) || importsBunTest(candidate)) {
      throw new Error(`REPAIR_NODE_TEST_REQUIRED: ${op.path}. ${NODE_REPAIR_TEST_GUIDANCE}`);
    }
    staged.set(op.path, candidate);
  }
}
