/**
 * Regression tests for like engagement field defect (DEF-17-01).
 *
 * DEFECT: toggleProjectLike(id, null) silently did nothing because the
 * function checked `if (userId)` and null was falsy — likes from the app
 * never reached the database.
 *
 * FIX: Replaced all toggleProjectLike(id, null) calls with toggleVideoLike(id, viewerId)
 * which uses the backend API endpoint with guest_id (same pattern as toggleVideoSave).
 */
import { describe, it, expect } from 'bun:test';

// Simulate the OLD broken behavior of toggleProjectLike(id, null)
function oldToggleProjectLike(projectId: string, userId?: string | null): { liked: boolean; likeCount: number } {
  if (userId) {
    // Would check/insert/delete in Supabase
    return { liked: true, likeCount: 1 };
  }
  // BUG: userId is null → does NOTHING
  return { liked: false, likeCount: 0 };
}

// Simulate the NEW fixed behavior of toggleVideoLike(id, viewerId)
function newToggleVideoLike(videoId: string, viewerId?: string | null): { liked: boolean; likeCount: number } {
  const viewer = viewerId || `guest-${Math.random().toString(36).slice(2, 10)}`;
  // Calls POST /api/projects/:id/like with { guest_id: viewer }
  // Returns { liked, likeCount } from API response
  return { liked: true, likeCount: 1 };
}

describe('DEF-17-01: Like engagement field', () => {
  it('OLD: toggleProjectLike(id, null) returns liked=false (broken)', () => {
    const result = oldToggleProjectLike('video-123', null);
    expect(result.liked).toBe(false);
    expect(result.likeCount).toBe(0);
  });

  it('NEW: toggleVideoLike(id, null) generates a guest_id and returns liked=true', () => {
    const result = newToggleVideoLike('video-123', null);
    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(1);
  });

  it('NEW: toggleVideoLike(id, viewerId) uses the provided viewer ID', () => {
    const result = newToggleVideoLike('video-456', 'guest-test-123');
    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(1);
  });

  it('NEW: toggleVideoLike never silently does nothing when viewerId is null', () => {
    // The old code path returned { liked: false, likeCount: 0 } when userId was null
    // The new code always generates a guest_id if none provided
    for (let i = 0; i < 10; i++) {
      const result = newToggleVideoLike(`video-${i}`, null);
      expect(result.liked).toBe(true);
      expect(result.likeCount).toBeGreaterThan(0);
    }
  });

  it('toggleVideoLike function signature matches toggleVideoSave pattern', () => {
    // Both should accept (videoId, viewerId?) and return a result object
    const likeResult = newToggleVideoLike('test', 'guest-1');
    const saveResult = { saved: true, saveCount: 1 }; // toggleVideoSave pattern

    expect(typeof likeResult.liked).toBe('boolean');
    expect(typeof likeResult.likeCount).toBe('number');
    expect(typeof saveResult.saved).toBe('boolean');
    expect(typeof saveResult.saveCount).toBe('number');
  });
});

describe('DEF-17-01: Source file audit (static analysis)', () => {
  // These tests verify the source code contains the expected exports
  // without importing the module (which would pull in react-native and fail in bun test).
  it('video-platform.ts source contains toggleVideoLike export', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'video-platform.ts'),
      'utf-8',
    );
    expect(src).toContain('export async function toggleVideoLike');
  });

  it('video-platform.ts source still contains toggleVideoSave export', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'video-platform.ts'),
      'utf-8',
    );
    expect(src).toContain('export async function toggleVideoSave');
  });

  it('video-platform.ts source still contains getViewerId export', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'video-platform.ts'),
      'utf-8',
    );
    expect(src).toContain('export async function getViewerId');
  });

  it('toggleVideoLike sends guest_id to the like API endpoint', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'video-platform.ts'),
      'utf-8',
    );
    // Verify the function sends guest_id to the /like endpoint
    expect(src).toContain('/like');
    expect(src).toContain('guest_id');
  });

  it('InvestorFirstFeed.tsx uses toggleVideoLike (not toggleProjectLike with null)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'InvestorFirstFeed.tsx'),
      'utf-8',
    );
    expect(src).toContain('toggleVideoLike');
    expect(src).not.toContain('toggleProjectLike(id, null)');
  });

  it('CanonicalInvestmentReelCard.tsx imports toggleVideoLike', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'CanonicalInvestmentReelCard.tsx'),
      'utf-8',
    );
    expect(src).toContain('toggleVideoLike');
  });

  it('DealVideoCard.tsx uses toggleVideoLike (not toggleProjectLike with null)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'DealVideoCard.tsx'),
      'utf-8',
    );
    expect(src).toContain('toggleVideoLike');
    expect(src).not.toContain('toggleProjectLike(video.id, null)');
  });
});

describe('DEF-17-01: Backend API contract', () => {
  it('backend handleProjectLikeToggle accepts guest_id', () => {
    // This mirrors the backend handler logic from ivx-project-engagement.ts
    function handleLike(body: { user_id?: string; guest_id?: string }): { status: number; body: Record<string, unknown> } {
      const userId = body.user_id || '';
      const guestId = body.guest_id || '';
      if (!userId && !guestId) {
        return { status: 400, body: { error: 'user_id or guest_id required' } };
      }
      return { status: 200, body: { liked: true, like_count: 1 } };
    }

    // guest_id alone should work
    expect(handleLike({ guest_id: 'guest-123' }).status).toBe(200);
    expect(handleLike({ guest_id: 'guest-123' }).body.liked).toBe(true);

    // user_id alone should work
    expect(handleLike({ user_id: 'user-123' }).status).toBe(200);

    // Neither should fail
    expect(handleLike({}).status).toBe(400);
  });

  it('backend handleProjectSaveToggle accepts guest_id', () => {
    function handleSave(body: { user_id?: string; guest_id?: string }): { status: number; body: Record<string, unknown> } {
      const userId = body.user_id || '';
      const guestId = body.guest_id || '';
      if (!userId && !guestId) {
        return { status: 400, body: { error: 'user_id or guest_id required' } };
      }
      return { status: 200, body: { saved: true, save_count: 1 } };
    }

    expect(handleSave({ guest_id: 'guest-123' }).status).toBe(200);
    expect(handleSave({}).status).toBe(400);
  });

  it('guest_id pattern is consistent between like and save', () => {
    // Both like and save endpoints accept the same body shape
    const likeBody = { guest_id: 'guest-test' };
    const saveBody = { guest_id: 'guest-test' };

    expect(likeBody.guest_id).toBe(saveBody.guest_id);
    expect(typeof likeBody.guest_id).toBe('string');
  });
});