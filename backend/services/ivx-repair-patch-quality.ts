type Operation = { path: string; oldText: string; newText: string };

function withoutDiagnostics(source: string): string {
  // Conservative rejection of obvious log/comment-only patches, not a proof of correctness.
  // Actual correctness still requires regression tests, CI and fresh production probes.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\bconsole\.(?:log|info|warn|error|debug|trace)\s*\([^;]*?\)\s*;?/g, '')
    .replace(/[\s{}]/g, '');
}

export function assertRepairPatchQuality(taskId: string, operations: Operation[]): void {
  if (!/^(fleet-reasoning|landing-remediation):/.test(taskId)) return;
  const tests = operations.filter(op => /\.(test|spec)\.[cm]?[jt]sx?$/.test(op.path));
  const source = operations.filter(op => !tests.includes(op) && /\.(?:[cm]?[jt]sx?|css|html)$/.test(op.path));
  if (!source.some(op => withoutDiagnostics(op.oldText) !== withoutDiagnostics(op.newText))) {
    throw new Error('REPAIR_NOT_FUNCTIONAL: logging, comments or tests alone do not repair the observed failure. Change the faulty implementation.');
  }
  if (!tests.some(op => op.oldText !== op.newText)) {
    throw new Error('REPAIR_REGRESSION_TEST_REQUIRED: include a test that reproduces the observed defect and verifies the functional correction.');
  }
}
