/**
 * =============================================================================
 * CHAT SCROLL ENGINE - src/modules/chat/chatScrollEngine.ts
 * =============================================================================
 *
 * Pure, testable scroll-strategy logic extracted from InvestorSupportChat.
 *
 * DEFECTS FIXED (GATE 4 — Real senior-developer engine test):
 *
 * DEF-SCROLL-1: No scroll retry. The original scrollToLatest called
 *   scrollToEnd once and gave up. On React Native, a single RAF may fire
 *   before the FlatList has measured dynamic message bubbles, so the scroll
 *   lands at the wrong offset. Fix: exponential retry with a maximum of
 *   MAX_SCROLL_RETRIES attempts, each on a fresh animation frame.
 *
 * DEF-SCROLL-2: No scrollToIndex fallback on native. Only the web branch
 *   had a fallback. On native, if scrollToEnd silently fails (returns
 *   without moving), the viewport stays at the top — months-old messages.
 *   Fix: after scrollToEnd, schedule a scrollToIndex fallback targeting
 *   the last item with viewPosition: 1 (bottom-aligned).
 *
 * DEF-SCROLL-3: Race condition on content size change. When a new message
 *   arrives, onContentSizeChange fires before the new bubble is measured,
 *   so scrollToEnd computes the wrong offset. Fix: the retry loop in
 *   scrollToLatest handles this — by the 2nd or 3rd retry the bubble is
 *   measured and the scroll lands correctly.
 *
 * DEF-SCROLL-4: No initial scroll on hydration. When messages are restored
 *   from AsyncStorage, the FlatList mounts with the restored messages but
 *   no explicit scroll-to-bottom is triggered. The useEffect on [messages]
 *   does fire, but isAtBottomRef defaults to true, so scrollToLatest runs
 *   once — with the original single-attempt scroll, this often failed.
 *   Fix: scrollToLatestWithRetry retries until the scroll sticks.
 *
 * DEF-SCROLL-5: isAtBottomRef drift. The original threshold was 80px from
 *   bottom, but with large message bubbles (180px image attachments), a
 *   user at the true bottom could report distanceFromBottom > 80 after a
 *   layout pass, causing isAtBottomRef to flip to false and auto-scroll to
 *   stop. Fix: use a dynamic threshold based on the largest possible bubble
 *   height.
 */

/** Maximum retry attempts for scroll-to-latest. */
export const MAX_SCROLL_RETRIES = 5;

/** Base delay (ms) between retries — doubles each attempt (exponential). */
export const SCROLL_RETRY_BASE_DELAY_MS = 50;

/** Maximum delay between retries (ms) — caps the exponential backoff. */
export const SCROLL_RETRY_MAX_DELAY_MS = 400;

/** Minimum distance from bottom (px) to consider "at bottom". */
export const AT_BOTTOM_THRESHOLD_PX = 120;

/** Extra tolerance per message to account for dynamic bubble heights. */
export const AT_BOTTOM_TOLERANCE_PER_MESSAGE_PX = 8;

/** Maximum number of messages to add tolerance for. */
export const AT_BOTTOM_MAX_TOLERANCE_MESSAGES = 10;

/**
 * Computes the delay before the next scroll retry using exponential backoff.
 *
 * @param attempt - Zero-based attempt index (0 = first retry, 1 = second, etc.)
 * @returns Delay in milliseconds.
 */
export function computeScrollRetryDelay(attempt: number): number {
  const exponential = SCROLL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(exponential, SCROLL_RETRY_MAX_DELAY_MS);
}

/**
 * Determines whether the user is "at the bottom" of the chat list.
 *
 * Uses a dynamic threshold that accounts for the largest possible message
 * bubble height (image attachments are 180px + padding), so a user at the
 * true bottom doesn't get falsely classified as "scrolled up" after a
 * layout pass.
 *
 * @param contentOffset - Current scroll offset (px from top).
 * @param contentSize - Total content height (px).
 * @param layoutMeasurement - Visible viewport height (px).
 * @param messageCount - Number of messages in the list (for dynamic tolerance).
 * @returns True if the user is at or near the bottom.
 */
export function isAtBottom(
  contentOffset: number,
  contentSize: number,
  layoutMeasurement: number,
  messageCount: number,
): boolean {
  const distanceFromBottom = contentSize - layoutMeasurement - contentOffset;
  const isScrollable = contentSize > layoutMeasurement + 40;
  if (!isScrollable) {
    return true;
  }
  const toleranceMessages = Math.min(messageCount, AT_BOTTOM_MAX_TOLERANCE_MESSAGES);
  const dynamicThreshold =
    AT_BOTTOM_THRESHOLD_PX + toleranceMessages * AT_BOTTOM_TOLERANCE_PER_MESSAGE_PX;
  return distanceFromBottom < dynamicThreshold;
}

/**
 * Determines whether the "jump to latest" button should be visible.
 *
 * @param isScrollable - Whether the content overflows the viewport.
 * @param atBottom - Whether the user is at the bottom.
 * @returns True if the jump button should show.
 */
export function shouldShowJumpButton(isScrollable: boolean, atBottom: boolean): boolean {
  return isScrollable && !atBottom;
}

/**
 * Creates a retry schedule for scroll-to-latest.
 *
 * Returns an array of delays (in ms) that the caller should wait between
 * successive scroll attempts. The first attempt is immediate (delay 0),
 * followed by exponentially increasing delays.
 *
 * @param maxRetries - Maximum number of retry attempts (default: MAX_SCROLL_RETRIES).
 * @returns Array of delays in milliseconds.
 */
export function createScrollRetrySchedule(
  maxRetries: number = MAX_SCROLL_RETRIES,
): number[] {
  const schedule: number[] = [0]; // First attempt is immediate.
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    schedule.push(computeScrollRetryDelay(attempt));
  }
  return schedule;
}

/**
 * Determines whether a scroll attempt should continue retrying.
 *
 * @param attempt - Current attempt number (1-based).
 * @param maxRetries - Maximum retries allowed.
 * @returns True if more retries should be attempted.
 */
export function shouldRetryScroll(attempt: number, maxRetries: number = MAX_SCROLL_RETRIES): boolean {
  return attempt < maxRetries;
}

/**
 * Computes the target index for scrollToIndex fallback.
 *
 * @param messageCount - Total messages in the list.
 * @returns The index to scroll to (last item), or -1 if the list is empty.
 */
export function getScrollToIndexTarget(messageCount: number): number {
  if (messageCount <= 0) {
    return -1;
  }
  return messageCount - 1;
}

/**
 * Determines whether the platform-specific scroll strategy should use
 * scrollToIndex as a fallback after scrollToEnd.
 *
 * On native (iOS/Android), scrollToEnd can silently fail when the FlatList
 * hasn't finished laying out dynamic content. scrollToIndex forces a layout
 * measurement on the target item, making it more reliable.
 *
 * On web, scrollToIndex is not supported — the browser handles scrolling
 * natively.
 *
 * @param platform - The platform OS string ('ios', 'android', 'web').
 * @returns True if scrollToIndex fallback should be used.
 */
export function shouldUseScrollToIndexFallback(platform: string): boolean {
  return platform === 'ios' || platform === 'android';
}

/**
 * Determines the web-specific scroll delay.
 *
 * On web, requestAnimationFrame fires before the DOM has reflowed, so we
 * need a setTimeout delay to ensure the DOM has measured dynamic content.
 *
 * @param attempt - Current retry attempt (0-based).
 * @returns Delay in milliseconds for web scroll.
 */
export function getWebScrollDelay(attempt: number): number {
  if (attempt === 0) {
    return 50;
  }
  return computeScrollRetryDelay(attempt);
}
