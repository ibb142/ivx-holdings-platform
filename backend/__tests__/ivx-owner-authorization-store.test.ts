import { describe, it, expect } from 'bun:test';
import {
  recordOwnerAuthorization,
  isOwnerAuthorized,
  revokeOwnerAuthorization,
  clearOwnerAuthorizations,
  getOwnerAuthorization,
} from '../services/ivx-owner-authorization-store';

describe('ivx-owner-authorization-store', () => {
  it('records authorization and recognizes the same scope', () => {
    const ownerId = 'owner-001';
    const goal = 'Fix the IVX chat loading behavior end to end';

    recordOwnerAuthorization({ taskId: 'task-001', ownerId, goal, approvalPhrase: 'yes do it' });

    expect(isOwnerAuthorized(ownerId, goal)).toBe(true);
    expect(getOwnerAuthorization(ownerId, goal)).toMatchObject({
      taskId: 'task-001',
      ownerId,
      scopeDescription: goal.slice(0, 200),
    });
  });

  it('does not require re-approval for the same goal after first authorization', () => {
    const ownerId = 'owner-002';
    const goal = 'Deploy the latest commit to production';

    recordOwnerAuthorization({ taskId: 'task-002', ownerId, goal, approvalPhrase: 'confirm' });

    // Same scope with different taskId (retry/recovery) should still be authorized.
    expect(isOwnerAuthorized(ownerId, goal)).toBe(true);
  });

  it('does not authorize a different owner for the same scope', () => {
    const goal = 'Fix the IVX chat loading behavior end to end';
    recordOwnerAuthorization({ taskId: 'task-003', ownerId: 'owner-a', goal, approvalPhrase: 'yes' });

    expect(isOwnerAuthorized('owner-b', goal)).toBe(false);
  });

  it('does not authorize a materially different scope for the same owner', () => {
    const ownerId = 'owner-003';
    recordOwnerAuthorization({ taskId: 'task-004', ownerId, goal: 'Fix chat loading', approvalPhrase: 'yes' });

    expect(isOwnerAuthorized(ownerId, 'Delete the production database')).toBe(false);
  });

  it('revoking authorization removes the record', () => {
    const ownerId = 'owner-004';
    const goal = 'Run backend tests';
    recordOwnerAuthorization({ taskId: 'task-005', ownerId, goal, approvalPhrase: 'yes' });

    expect(isOwnerAuthorized(ownerId, goal)).toBe(true);

    revokeOwnerAuthorization(ownerId, goal);

    expect(isOwnerAuthorized(ownerId, goal)).toBe(false);
    expect(getOwnerAuthorization(ownerId, goal)?.revokedAt).toBeTruthy();
  });

  it('clearing all authorizations for an owner removes every record', () => {
    const ownerId = 'owner-005';
    recordOwnerAuthorization({ taskId: 'task-006', ownerId, goal: 'Goal A', approvalPhrase: 'yes' });
    recordOwnerAuthorization({ taskId: 'task-007', ownerId, goal: 'Goal B', approvalPhrase: 'yes' });

    clearOwnerAuthorizations(ownerId);

    expect(isOwnerAuthorized(ownerId, 'Goal A')).toBe(false);
    expect(isOwnerAuthorized(ownerId, 'Goal B')).toBe(false);
  });
});
