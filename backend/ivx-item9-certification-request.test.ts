import { describe, expect, it } from 'bun:test';
import { authorizedItem9Run, item9CompletionStatus, item9RequestPending, item9RequestRef } from '../scripts/ivx-item9-certification-request';

const source = 'a'.repeat(40), target = 'b'.repeat(40);
const request = { schema_version: 1, item: 9, requested_from_sha: source, merge_marker: '[verify-fleet-ha-recovery]' };
const ref = item9RequestRef(JSON.stringify(request));
const proof = { sourceSha: target, verification: 'PASS', rollingWorkerRestart: true,
  workerProcessReplacement: 'PASS', apiAvailabilityDuringRestart: 'PASS',
  sharedStateObservation: { status: 'PASS' }, sharedStateObservationAfterRestart: { status: 'PASS' } };

describe('item 9 certification request continuity', () => {
  it('resumes only owner-authorized main runs in the expected repository', () => {
    const env = { GITHUB_REPOSITORY: 'ibb142/ivx-holdings-platform', GITHUB_REF_NAME: 'main', GITHUB_ACTOR: 'ibb142', GITHUB_EVENT_NAME: 'push' };
    expect(authorizedItem9Run(env)).toBe(true);
    expect(authorizedItem9Run({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' })).toBe(true);
    for (const patch of [{ GITHUB_ACTOR: 'another-user' }, { GITHUB_REF_NAME: 'feature' },
      { GITHUB_REPOSITORY: 'someone/fork' }, { GITHUB_EVENT_NAME: 'pull_request' }]) {
      expect(authorizedItem9Run({ ...env, ...patch })).toBe(false);
    }
  });
  it('keeps a request pending across missing, failed and cancelled attempts', () => {
    expect(item9RequestPending(ref, [])).toBe(true);
    for (const state of ['pending', 'failure', 'error']) {
      expect(item9RequestPending(ref, [{ context: ref.context, state }, { context: ref.context, state: 'success' }])).toBe(true);
    }
    expect(item9RequestPending(ref, [{ context: 'unrelated', state: 'success' }])).toBe(true);
  });
  it('stops automatic recovery after success and requires new proof when the request changes', () => {
    const statuses = [{ context: ref.context, state: 'success' }];
    expect(item9RequestPending(ref, statuses)).toBe(false);
    const changed = item9RequestRef(JSON.stringify({ ...request, reason: 'new certification request' }));
    expect(changed.context).not.toBe(ref.context);
    expect(item9RequestPending(changed, statuses)).toBe(true);
  });
  it('rejects malformed request and status data', () => {
    for (const patch of [{ item: 8 }, { schema_version: 0 }, { requested_from_sha: '../main' }, { merge_marker: '' }]) {
      expect(() => item9RequestRef(JSON.stringify({ ...request, ...patch }))).toThrow();
    }
    expect(() => item9RequestPending(ref, { message: 'unavailable' })).toThrow();
  });
  it('never closes a superseded or incomplete recovery certificate', () => {
    expect(() => item9CompletionStatus(ref, target, source, '123', proof, true)).toThrow();
    expect(() => item9CompletionStatus(ref, target, target, '123', proof, false)).toThrow();
    for (const patch of [{ sourceSha: source }, { verification: 'PENDING' }, { rollingWorkerRestart: false },
      { workerProcessReplacement: 'NOT_RUN' }, { apiAvailabilityDuringRestart: 'FAIL' },
      { sharedStateObservation: { status: 'UNAVAILABLE' } }, { sharedStateObservationAfterRestart: { status: 'UNAVAILABLE' } }]) {
      expect(() => item9CompletionStatus(ref, target, target, '123', { ...proof, ...patch }, true)).toThrow();
    }
  });
  it('records the certified deployment and workflow separately from the request source SHA', () => {
    const status = item9CompletionStatus(ref, target, target, '123', proof, true);
    expect(status.state).toBe('success');
    expect(status.context).toBe(ref.context);
    expect(status.description).toContain(target);
    expect(status.target_url).toBe('https://github.com/ibb142/ivx-holdings-platform/actions/runs/123');
    expect(ref.sha).toBe(source);
  });
});
