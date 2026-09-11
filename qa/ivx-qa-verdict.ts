export type QAGateVerdict = { verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'; exitCode: 0 | 1 | 2 };

/** Evaluate actual rows: successful collection is not successful acceptance. */
export function evaluateQAGate(results: readonly { status: string }[]): QAGateVerdict {
  if (results.some(result => result.status === 'FAIL' || result.status === 'ERROR')) {
    return { verdict: 'FAIL', exitCode: 1 };
  }
  if (results.length === 0 || results.some(result => result.status !== 'PASS')) {
    return { verdict: 'INCOMPLETE', exitCode: 2 };
  }
  return { verdict: 'PASS', exitCode: 0 };
}
