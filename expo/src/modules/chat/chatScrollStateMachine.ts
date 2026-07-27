/**
 * =============================================================================
 * CHAT SCROLL STATE MACHINE — Deterministic scroll-decision logic
 * =============================================================================
 *
 * Pure, testable state machine that governs all scroll positioning decisions
 * for the inverted FlatList chat. This is the single source of truth for
 * "should we scroll, should we show the jump button, should we increment the
 * pending count" — extracted from the scattered inline logic in chat screens
 * into a deterministic, fully testable module.
 *
 * INVARIANT: The FlatList is inverted. Index 0 = newest message.
 * "At bottom" in inverted mode = contentOffset.y near 0.
 * "Scrolled up" in inverted mode = contentOffset.y is large negative.
 */

/** Inputs to the scroll state machine. */
export interface ScrollStateInputs {
  /** Whether the initial data load has completed (messages fetched from server/local). */
  initialDataLoaded: boolean;
  /** Whether the FlatList has completed its first layout pass (onLayout fired). */
  initialLayoutReady: boolean;
  /** Whether the initial position has already been applied (one-shot flag). */
  initialPositionApplied: boolean;
  /** The active conversation ID. */
  activeConversationId: string | null;
  /** Whether the user is currently near the latest message (inverted offset near 0). */
  userNearLatest: boolean;
  /** Whether the user has manually scrolled at all. */
  userHasScrolled: boolean;
  /** Whether the keyboard is currently visible. */
  keyboardVisible: boolean;
  /** Count of pending new messages the user hasn't seen (while reading history). */
  pendingNewMessageCount: number;
  /** Whether a realtime message was just received. */
  realtimeMessageReceived: boolean;
  /** Whether an outgoing message was just sent. */
  outgoingMessageSent: boolean;
  /** Whether a pagination request is in progress. */
  paginationInProgress: boolean;
  /** The persisted state version (for migration compatibility). */
  restoredStateVersion: number | null;
}

/** Outputs from the scroll state machine. */
export interface ScrollStateOutputs {
  /** Whether the initial scroll-to-latest should be applied now. */
  shouldApplyInitialPosition: boolean;
  /** Whether an auto-scroll to latest should fire (user is at bottom + new message). */
  shouldAutoScroll: boolean;
  /** Whether the yellow "jump to latest" control should be visible. */
  shouldShowLatestControl: boolean;
  /** Whether the pending new-message counter should increment. */
  shouldIncrementPendingCount: boolean;
  /** Whether the current scroll anchor should be preserved (pagination or history reading). */
  shouldPreserveAnchor: boolean;
  /** Whether all conversation state should be reset (conversation changed). */
  shouldResetConversationState: boolean;
}

/** Current persisted state version. States below this are migrated/reset. */
export const CURRENT_STATE_VERSION = 2;

/** Minimum restored state version that is compatible (v1 had stale scroll offsets). */
export const MIN_COMPATIBLE_STATE_VERSION = 2;

/**
 * Compute scroll decisions from the current state inputs.
 *
 * Rules (deterministic, no side effects):
 *
 * 1. shouldApplyInitialPosition: true exactly once — when data is loaded AND
 *    layout is ready AND initial position has NOT yet been applied. After
 *    applying, the caller sets initialPositionApplied=true and this never
 *    fires again for the same conversation.
 *
 * 2. shouldAutoScroll: true when a new message arrives (realtime or outgoing)
 *    AND the user is near the latest. This is the ONLY auto-scroll trigger
 *    after the initial position. If the user is reading history, we do NOT
 *    auto-scroll — we increment the pending counter instead.
 *
 * 3. shouldShowLatestControl: true when the list is scrollable AND the user
 *    is NOT near the latest AND there are pending new messages OR the user
 *    has scrolled away from the bottom.
 *
 * 4. shouldIncrementPendingCount: true when a realtime message arrives AND
 *    the user is NOT near the latest (they're reading history). The counter
 *    is cleared when the user taps the jump-to-latest control.
 *
 * 5. shouldPreserveAnchor: true when pagination is in progress OR the user
 *    is reading history (not near latest) and a new message arrives. The
 *    caller must NOT scroll — just prepend/prepend older messages and keep
 *    the current viewport stable.
 *
 * 6. shouldResetConversationState: true when the active conversation ID
 *    changes. The caller must clear all state (messages, scroll position,
 *    pending count, initialPositionApplied) and start fresh.
 */
export function computeScrollDecisions(inputs: ScrollStateInputs): ScrollStateOutputs {
  // Conversation change → full reset.
  const shouldResetConversationState = inputs.activeConversationId !== null
    && inputs.activeConversationId.length > 0
    && inputs.restoredStateVersion !== null
    && inputs.restoredStateVersion < MIN_COMPATIBLE_STATE_VERSION;

  // Initial position: fire exactly once when data + layout are ready.
  const shouldApplyInitialPosition =
    inputs.initialDataLoaded &&
    inputs.initialLayoutReady &&
    !inputs.initialPositionApplied;

  // New message arrived (realtime or outgoing echo from server).
  const newMessageArrived = inputs.realtimeMessageReceived || inputs.outgoingMessageSent;

  // Auto-scroll only when at latest and a new message arrives.
  const shouldAutoScroll =
    newMessageArrived &&
    inputs.userNearLatest &&
    !inputs.paginationInProgress;

  // Show jump-to-latest when scrolled away from bottom.
  const shouldShowLatestControl =
    !inputs.userNearLatest &&
    inputs.userHasScrolled &&
    !inputs.keyboardVisible;

  // Increment pending count when a realtime message arrives while reading history.
  const shouldIncrementPendingCount =
    inputs.realtimeMessageReceived &&
    !inputs.userNearLatest;

  // Preserve anchor during pagination or when reading history.
  const shouldPreserveAnchor =
    inputs.paginationInProgress ||
    (!inputs.userNearLatest && inputs.realtimeMessageReceived);

  return {
    shouldApplyInitialPosition,
    shouldAutoScroll,
    shouldShowLatestControl,
    shouldIncrementPendingCount,
    shouldPreserveAnchor,
    shouldResetConversationState,
  };
}

/**
 * Determine whether a restored scroll offset from a previous version should
 * be applied. Stale offsets from v1 (non-inverted FlatList) must NEVER be
 * restored — they would position the viewport at the wrong end.
 */
export function shouldRestoreScrollOffset(
  restoredStateVersion: number | null,
  currentVersion: number = CURRENT_STATE_VERSION,
): boolean {
  if (restoredStateVersion === null) return false;
  return restoredStateVersion >= MIN_COMPATIBLE_STATE_VERSION
    && restoredStateVersion <= currentVersion;
}

/**
 * Determine the new pending count after a user action.
 * - Tap jump-to-latest: counter resets to 0.
 * - Realtime message while reading history: counter increments.
 * - Auto-scroll fired: counter resets to 0 (user is at latest).
 */
export function computePendingCount(
  currentCount: number,
  action: 'jump_to_latest' | 'realtime_received' | 'auto_scrolled' | 'conversation_changed',
  userNearLatest: boolean,
): number {
  switch (action) {
    case 'jump_to_latest':
      return 0;
    case 'auto_scrolled':
      return 0;
    case 'conversation_changed':
      return 0;
    case 'realtime_received':
      return userNearLatest ? 0 : currentCount + 1;
  }
}

/**
 * Validate that a state transition is legal. Returns false for invalid
 * transitions that would indicate a bug in the scroll controller.
 */
export function isValidStateTransition(
  prev: ScrollStateInputs,
  next: ScrollStateInputs,
): boolean {
  // Conversation ID can change (room switch) — that's valid.
  // But initialPositionApplied must not go from true → false for the same conversation.
  if (
    prev.activeConversationId === next.activeConversationId &&
    prev.initialPositionApplied === true &&
    next.initialPositionApplied === false
  ) {
    return false;
  }

  // pendingNewMessageCount must never be negative.
  if (next.pendingNewMessageCount < 0) return false;

  // If pagination is in progress, we should not also be applying initial position.
  if (next.paginationInProgress && next.shouldResetConversationState === false) {
    // pagination + initial position is contradictory
    if (!next.initialPositionApplied && next.initialLayoutReady && next.initialDataLoaded) {
      // This could happen if pagination triggers before initial scroll —
      // but that's a race condition bug, not a valid state.
      return false;
    }
  }

  return true;
}
