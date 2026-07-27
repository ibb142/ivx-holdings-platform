/**
 * Chat Scroll State-Machine Test — deterministic transition verification.
 *
 * Tests every meaningful combination of scroll state inputs and validates
 * that the outputs are correct and no invalid transitions occur.
 */
import { describe, expect, test } from 'bun:test';
import {
  computeScrollDecisions,
  isValidStateTransition,
  shouldRestoreScrollOffset,
  computePendingCount,
  CURRENT_STATE_VERSION,
  MIN_COMPATIBLE_STATE_VERSION,
  type ScrollStateInputs,
} from '@/src/modules/chat/chatScrollStateMachine';

const baseInputs: ScrollStateInputs = {
  initialDataLoaded: false,
  initialLayoutReady: false,
  initialPositionApplied: false,
  activeConversationId: 'conv-123',
  userNearLatest: true,
  userHasScrolled: false,
  keyboardVisible: false,
  pendingNewMessageCount: 0,
  realtimeMessageReceived: false,
  outgoingMessageSent: false,
  paginationInProgress: false,
  restoredStateVersion: CURRENT_STATE_VERSION,
};

describe('chatScrollStateMachine — shouldApplyInitialPosition', () => {
  test('fires exactly once when data + layout are ready and position not yet applied', () => {
    const out = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true, initialLayoutReady: true });
    expect(out.shouldApplyInitialPosition).toBe(true);
  });

  test('does NOT fire when data is not loaded', () => {
    const out = computeScrollDecisions({ ...baseInputs, initialLayoutReady: true });
    expect(out.shouldApplyInitialPosition).toBe(false);
  });

  test('does NOT fire when layout is not ready', () => {
    const out = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true });
    expect(out.shouldApplyInitialPosition).toBe(false);
  });

  test('does NOT fire again after initialPositionApplied is set', () => {
    const out = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true, initialLayoutReady: true, initialPositionApplied: true });
    expect(out.shouldApplyInitialPosition).toBe(false);
  });

  test('REPEATED INITIAL POSITIONING: 0 — never fires twice for same conversation', () => {
    const step1 = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true, initialLayoutReady: true });
    expect(step1.shouldApplyInitialPosition).toBe(true);
    const step2 = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true, initialLayoutReady: true, initialPositionApplied: true });
    expect(step2.shouldApplyInitialPosition).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldAutoScroll', () => {
  test('auto-scrolls when realtime message arrives and user is at latest', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: true });
    expect(out.shouldAutoScroll).toBe(true);
  });

  test('auto-scrolls when outgoing message is sent and user is at latest', () => {
    const out = computeScrollDecisions({ ...baseInputs, outgoingMessageSent: true, userNearLatest: true });
    expect(out.shouldAutoScroll).toBe(true);
  });

  test('does NOT auto-scroll when user is reading history (not near latest)', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldAutoScroll).toBe(false);
  });

  test('FORCED SCROLL WHILE READING HISTORY: 0 — does not auto-scroll when user is away from latest', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldAutoScroll).toBe(false);
  });

  test('MISSING AUTO-SCROLL WHILE AT LATEST: 0 — always auto-scrolls when at latest and new message arrives', () => {
    const realtime = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: true });
    const outgoing = computeScrollDecisions({ ...baseInputs, outgoingMessageSent: true, userNearLatest: true });
    expect(realtime.shouldAutoScroll).toBe(true);
    expect(outgoing.shouldAutoScroll).toBe(true);
  });

  test('does NOT auto-scroll during pagination', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: true, paginationInProgress: true });
    expect(out.shouldAutoScroll).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldShowLatestControl (yellow arrow)', () => {
  test('shows when user has scrolled away from bottom', () => {
    const out = computeScrollDecisions({ ...baseInputs, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldShowLatestControl).toBe(true);
  });

  test('does NOT show on initial open (userHasScrolled=false)', () => {
    const out = computeScrollDecisions({ ...baseInputs, userNearLatest: true, userHasScrolled: false });
    expect(out.shouldShowLatestControl).toBe(false);
  });

  test('does NOT show when user is at latest', () => {
    const out = computeScrollDecisions({ ...baseInputs, userNearLatest: true, userHasScrolled: true });
    expect(out.shouldShowLatestControl).toBe(false);
  });

  test('does NOT show when keyboard is visible', () => {
    const out = computeScrollDecisions({ ...baseInputs, userNearLatest: false, userHasScrolled: true, keyboardVisible: true });
    expect(out.shouldShowLatestControl).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldIncrementPendingCount', () => {
  test('increments when realtime message arrives while reading history', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldIncrementPendingCount).toBe(true);
  });

  test('does NOT increment when user is at latest', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: true });
    expect(out.shouldIncrementPendingCount).toBe(false);
  });

  test('does NOT increment for outgoing messages', () => {
    const out = computeScrollDecisions({ ...baseInputs, outgoingMessageSent: true, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldIncrementPendingCount).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldPreserveAnchor', () => {
  test('preserves anchor during pagination', () => {
    const out = computeScrollDecisions({ ...baseInputs, paginationInProgress: true });
    expect(out.shouldPreserveAnchor).toBe(true);
  });

  test('preserves anchor when realtime arrives while reading history', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: false, userHasScrolled: true });
    expect(out.shouldPreserveAnchor).toBe(true);
  });

  test('does NOT preserve anchor when at latest and new message arrives (should scroll)', () => {
    const out = computeScrollDecisions({ ...baseInputs, realtimeMessageReceived: true, userNearLatest: true });
    expect(out.shouldPreserveAnchor).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldResetConversationState', () => {
  test('resets when restored state version is below minimum compatible', () => {
    const out = computeScrollDecisions({ ...baseInputs, restoredStateVersion: MIN_COMPATIBLE_STATE_VERSION - 1 });
    expect(out.shouldResetConversationState).toBe(true);
  });

  test('does NOT reset when state version is current', () => {
    const out = computeScrollDecisions({ ...baseInputs, restoredStateVersion: CURRENT_STATE_VERSION });
    expect(out.shouldResetConversationState).toBe(false);
  });

  test('does NOT reset when no restored state version (fresh install)', () => {
    const out = computeScrollDecisions({ ...baseInputs, restoredStateVersion: null });
    expect(out.shouldResetConversationState).toBe(false);
  });
});

describe('chatScrollStateMachine — isValidStateTransition', () => {
  test('INVALID TRANSITIONS: 0 — valid forward transition', () => {
    const prev: ScrollStateInputs = { ...baseInputs, initialDataLoaded: false, initialLayoutReady: false };
    const next: ScrollStateInputs = { ...baseInputs, initialDataLoaded: true, initialLayoutReady: true };
    expect(isValidStateTransition(prev, next)).toBe(true);
  });

  test('flags invalid: initialPositionApplied goes true → false for same conversation', () => {
    const prev: ScrollStateInputs = { ...baseInputs, initialPositionApplied: true, activeConversationId: 'conv-1' };
    const next: ScrollStateInputs = { ...baseInputs, initialPositionApplied: false, activeConversationId: 'conv-1' };
    expect(isValidStateTransition(prev, next)).toBe(false);
  });

  test('allows initialPositionApplied reset when conversation changes', () => {
    const prev: ScrollStateInputs = { ...baseInputs, initialPositionApplied: true, activeConversationId: 'conv-1' };
    const next: ScrollStateInputs = { ...baseInputs, initialPositionApplied: false, activeConversationId: 'conv-2' };
    expect(isValidStateTransition(prev, next)).toBe(true);
  });

  test('flags invalid: negative pending count', () => {
    const next: ScrollStateInputs = { ...baseInputs, pendingNewMessageCount: -1 };
    expect(isValidStateTransition(baseInputs, next)).toBe(false);
  });
});

describe('chatScrollStateMachine — shouldRestoreScrollOffset', () => {
  test('does NOT restore stale offsets from v1 (non-inverted)', () => {
    expect(shouldRestoreScrollOffset(1)).toBe(false);
  });

  test('restores offsets from current version', () => {
    expect(shouldRestoreScrollOffset(CURRENT_STATE_VERSION)).toBe(true);
  });

  test('does NOT restore when no saved state', () => {
    expect(shouldRestoreScrollOffset(null)).toBe(false);
  });
});

describe('chatScrollStateMachine — computePendingCount', () => {
  test('jump_to_latest resets to 0', () => {
    expect(computePendingCount(5, 'jump_to_latest', false)).toBe(0);
  });

  test('auto_scrolled resets to 0', () => {
    expect(computePendingCount(3, 'auto_scrolled', true)).toBe(0);
  });

  test('realtime_received increments when not near latest', () => {
    expect(computePendingCount(2, 'realtime_received', false)).toBe(3);
  });

  test('realtime_received resets when near latest', () => {
    expect(computePendingCount(2, 'realtime_received', true)).toBe(0);
  });

  test('conversation_changed resets to 0', () => {
    expect(computePendingCount(10, 'conversation_changed', false)).toBe(0);
  });
});

describe('chatScrollStateMachine — full transition sequence', () => {
  test('complete chat session: open → send → receive → scroll up → receive → jump back', () => {
    // Step 1: Initial open — data loads, layout ready
    const s1 = computeScrollDecisions({ ...baseInputs, initialDataLoaded: true, initialLayoutReady: true });
    expect(s1.shouldApplyInitialPosition).toBe(true);
    expect(s1.shouldShowLatestControl).toBe(false); // No yellow arrow on initial open

    // Step 2: After initial position applied, user sends a message
    const s2 = computeScrollDecisions({
      ...baseInputs,
      initialDataLoaded: true,
      initialLayoutReady: true,
      initialPositionApplied: true,
      outgoingMessageSent: true,
      userNearLatest: true,
    });
    expect(s2.shouldApplyInitialPosition).toBe(false); // Never again
    expect(s2.shouldAutoScroll).toBe(true); // Scroll to show the sent message

    // Step 3: Realtime response arrives while at latest
    const s3 = computeScrollDecisions({
      ...baseInputs,
      initialDataLoaded: true,
      initialLayoutReady: true,
      initialPositionApplied: true,
      realtimeMessageReceived: true,
      userNearLatest: true,
    });
    expect(s3.shouldAutoScroll).toBe(true);
    expect(s3.shouldIncrementPendingCount).toBe(false);

    // Step 4: User scrolls up to read history
    const s4 = computeScrollDecisions({
      ...baseInputs,
      initialDataLoaded: true,
      initialLayoutReady: true,
      initialPositionApplied: true,
      userNearLatest: false,
      userHasScrolled: true,
    });
    expect(s4.shouldShowLatestControl).toBe(true); // Yellow arrow appears
    expect(s4.shouldPreserveAnchor).toBe(false); // No new message, just reading

    // Step 5: New realtime message arrives while reading history
    const s5 = computeScrollDecisions({
      ...baseInputs,
      initialDataLoaded: true,
      initialLayoutReady: true,
      initialPositionApplied: true,
      realtimeMessageReceived: true,
      userNearLatest: false,
      userHasScrolled: true,
    });
    expect(s5.shouldAutoScroll).toBe(false); // Don't force scroll
    expect(s5.shouldIncrementPendingCount).toBe(true); // Increment counter
    expect(s5.shouldPreserveAnchor).toBe(true); // Keep user's position

    // Step 6: User taps jump-to-latest
    const s6 = computeScrollDecisions({
      ...baseInputs,
      initialDataLoaded: true,
      initialLayoutReady: true,
      initialPositionApplied: true,
      userNearLatest: true,
      userHasScrolled: true,
      pendingNewMessageCount: 0, // Counter was cleared by jump
    });
    expect(s6.shouldShowLatestControl).toBe(false); // Arrow disappears
  });
});
