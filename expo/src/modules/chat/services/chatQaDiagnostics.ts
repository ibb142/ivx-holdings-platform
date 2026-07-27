/**
 * Chat QA Diagnostics — Owner-only diagnostic metrics collector for the
 * inverted FlatList chat fix. Records runtime evidence required for the
 * device QA acceptance checklist without exposing message contents or secrets.
 *
 * The panel built on this data is removable: set the feature flag
 * `IVX_CHAT_QA_PANEL_ENABLED` to false to hide the UI after certification.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getIVXBuildInfo } from '@/constants/build-info';

/** Unique trace ID for a single QA session (generated on panel open). */
export function generateQaTraceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ivx-chat-qa-${ts}-${rand}`;
}

/** Feature flag: set to false after certification to hide the panel. */
export const IVX_CHAT_QA_PANEL_ENABLED = true;

export interface ChatQaMetrics {
  /** Supabase conversation ID for the active room. */
  conversationId: string | null;
  /** Active room ID (may differ from conversationId in local-first mode). */
  activeRoomId: string | null;
  /** ID of the first message rendered in the FlatList viewport. */
  firstRenderedMessageId: string | null;
  /** ID of the newest message from the server (last item in ascending order). */
  newestServerMessageId: string | null;
  /** ID of the oldest rendered message currently in the data array. */
  oldestRenderedMessageId: string | null;
  /** Total visible message count in the FlatList data. */
  messageCount: number;
  /** Whether the FlatList is inverted (should be true after the fix). */
  listInverted: boolean;
  /** First content offset observed after initial layout (px). */
  firstContentOffset: number | null;
  /** Whether the initial position was applied (newest anchored on first layout). */
  initialPositionApplied: boolean;
  /** Whether the user is currently near the latest message. */
  userNearLatest: boolean;
  /** Whether the yellow down-arrow (scroll-to-latest) is currently visible. */
  yellowArrowVisible: boolean;
  /** Pagination cursor timestamp (oldest loaded message createdAt). */
  paginationCursor: string | null;
  /** Whether more older messages are available. */
  hasMoreOlderMessages: boolean;
  /** Count of duplicate messages detected by the dedup layer. */
  duplicateMessageCount: number;
  /** Number of realtime subscription channels active. */
  realtimeSubscriptionCount: number;
  /** ISO timestamp of the last realtime reconnect, or null. */
  lastReconnectTime: string | null;
  /** App version from build info. */
  appVersion: string;
  /** Short commit SHA from build info. */
  commitSha: string;
  /** Device platform: ios, android, or web. */
  devicePlatform: string;
  /** ISO timestamp when the metrics snapshot was collected. */
  timestamp: string;
  /** Unique trace ID for this QA session. */
  traceId: string;
  /** Whether the panel feature flag is enabled. */
  panelEnabled: boolean;
}

/**
 * Collect a QA metrics snapshot from the chat screen's runtime state.
 * This function reads ONLY structural metadata (IDs, counts, booleans) —
 * it never reads message bodies, auth tokens, or user PII.
 */
export function collectChatQaMetrics(params: {
  conversationId: string | null;
  activeRoomId: string | null;
  invertedData: ReadonlyArray<{ id: string }>;
  displayedMessages: ReadonlyArray<{ id: string; createdAt: string }>;
  listInverted: boolean;
  firstContentOffset: number | null;
  initialPositionApplied: boolean;
  userNearLatest: boolean;
  yellowArrowVisible: boolean;
  hasMoreOlderMessages: boolean;
  duplicateMessageCount: number;
  realtimeSubscriptionCount: number;
  lastReconnectTime: string | null;
  traceId: string;
}): ChatQaMetrics {
  const { invertedData, displayedMessages } = params;

  // In inverted data, index 0 = newest, last index = oldest.
  const firstRenderedMessageId = invertedData.length > 0 ? invertedData[0].id : null;
  const newestServerMessageId = displayedMessages.length > 0
    ? displayedMessages[displayedMessages.length - 1].id
    : null;
  const oldestRenderedMessageId = displayedMessages.length > 0
    ? displayedMessages[0].id
    : null;
  const paginationCursor = displayedMessages.length > 0
    ? displayedMessages[0].createdAt
    : null;

  const buildInfo = getIVXBuildInfo();

  return {
    conversationId: params.conversationId,
    activeRoomId: params.activeRoomId,
    firstRenderedMessageId,
    newestServerMessageId,
    oldestRenderedMessageId,
    messageCount: invertedData.length,
    listInverted: params.listInverted,
    firstContentOffset: params.firstContentOffset,
    initialPositionApplied: params.initialPositionApplied,
    userNearLatest: params.userNearLatest,
    yellowArrowVisible: params.yellowArrowVisible,
    paginationCursor,
    hasMoreOlderMessages: params.hasMoreOlderMessages,
    duplicateMessageCount: params.duplicateMessageCount,
    realtimeSubscriptionCount: params.realtimeSubscriptionCount,
    lastReconnectTime: params.lastReconnectTime,
    appVersion: buildInfo.appVersion,
    commitSha: buildInfo.commitShort,
    devicePlatform: Platform.OS,
    timestamp: new Date().toISOString(),
    traceId: params.traceId,
    panelEnabled: IVX_CHAT_QA_PANEL_ENABLED,
  };
}

/**
 * Format the metrics as a human-readable string for the "Copy QA Evidence" button.
 * Uses key: value lines, no JSON nesting, easy to paste into a chat or ticket.
 */
export function formatQaMetricsForCopy(metrics: ChatQaMetrics): string {
  const lines: string[] = [
    '=== IVX CHAT QA DIAGNOSTIC SNAPSHOT ===',
    `trace_id: ${metrics.traceId}`,
    `timestamp: ${metrics.timestamp}`,
    `device_platform: ${metrics.devicePlatform}`,
    `app_version: ${metrics.appVersion}`,
    `commit_sha: ${metrics.commitSha}`,
    `panel_enabled: ${metrics.panelEnabled}`,
    '',
    '--- Chat State ---',
    `conversation_id: ${metrics.conversationId ?? 'null'}`,
    `active_room_id: ${metrics.activeRoomId ?? 'null'}`,
    `message_count: ${metrics.messageCount}`,
    `list_inverted: ${metrics.listInverted}`,
    `first_content_offset: ${metrics.firstContentOffset ?? 'null'}`,
    `initial_position_applied: ${metrics.initialPositionApplied}`,
    `user_near_latest: ${metrics.userNearLatest}`,
    `yellow_arrow_visible: ${metrics.yellowArrowVisible}`,
    '',
    '--- Message IDs (no content exposed) ---',
    `first_rendered_message_id: ${metrics.firstRenderedMessageId ?? 'null'}`,
    `newest_server_message_id: ${metrics.newestServerMessageId ?? 'null'}`,
    `oldest_rendered_message_id: ${metrics.oldestRenderedMessageId ?? 'null'}`,
    '',
    '--- Pagination ---',
    `pagination_cursor: ${metrics.paginationCursor ?? 'null'}`,
    `has_more_older_messages: ${metrics.hasMoreOlderMessages}`,
    `duplicate_message_count: ${metrics.duplicateMessageCount}`,
    '',
    '--- Realtime ---',
    `realtime_subscription_count: ${metrics.realtimeSubscriptionCount}`,
    `last_reconnect_time: ${metrics.lastReconnectTime ?? 'null'}`,
    '',
    '=== END SNAPSHOT ===',
  ];
  return lines.join('\n');
}

/**
 * Build a JSON report for the "Export QA Report" button.
 * Includes owner test selections (pass/fail) alongside the metrics snapshot.
 */
export function buildQaReport(
  metrics: ChatQaMetrics,
  testResults: Record<string, 'pass' | 'fail' | 'blocked' | 'untested'>,
  ownerComments: string,
): string {
  const report = {
    reportType: 'ivx-chat-qa',
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    traceId: metrics.traceId,
    commitSha: metrics.commitSha,
    appVersion: metrics.appVersion,
    devicePlatform: metrics.devicePlatform,
    metrics,
    testResults,
    ownerComments,
    linkedTask: 'chat-fix-inverted-flatlist',
    linkedCommit: '0ae6c19f9795',
  };
  return JSON.stringify(report, null, 2);
}

/**
 * Default test results template — all tests start as 'untested'.
 */
export function createDefaultTestResults(): Record<string, 'pass' | 'fail' | 'blocked' | 'untested'> {
  return {
    testA_freshOpen: 'untested',
    testB_send: 'untested',
    testC_receive: 'untested',
    testD_history: 'untested',
    testE_returnToLatest: 'untested',
    testF_keyboard: 'untested',
    testG_restart: 'untested',
  };
}

/** Test labels for the QA panel UI. */
export const QA_TEST_LABELS: Record<string, string> = {
  testA_freshOpen: 'A — Fresh Open',
  testB_send: 'B — Send',
  testC_receive: 'C — Receive',
  testD_history: 'D — History/Pagination',
  testE_returnToLatest: 'E — Return to Latest',
  testF_keyboard: 'F — Keyboard',
  testG_restart: 'G — Restart',
};
