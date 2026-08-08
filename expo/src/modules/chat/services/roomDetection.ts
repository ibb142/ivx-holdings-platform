/**
 * Thin re-export wrapper for room detection functions.
 *
 * This module exists so that room-state-manager.test.ts can mock room
 * detection without poisoning Bun's global mock.module cache for ivxChat.ts.
 *
 * Root cause: Bun's mock.module is first-come-first-served and global across
 * all test files in a process. When room-state-manager.test.ts registered
 * mock.module('.../ivxChat', () => ({ detectRoomStatus, invalidateRoomStatusCache }))
 * with only 2 exports, ivx-chat.test.ts's dynamic import of ivxChat received
 * that partial mock — all other exports (bootstrapRoomByFriendlySlug,
 * sendTextMessage, etc.) were undefined, causing 8 test failures in CI.
 *
 * By importing through this separate module specifier, roomStateManager gets
 * its dependencies from './roomDetection' (which can be safely mocked in
 * tests) while ivxChat.ts remains unmocked for ivx-chat.test.ts.
 */
export { detectRoomStatus, invalidateRoomStatusCache } from './ivxChat';
