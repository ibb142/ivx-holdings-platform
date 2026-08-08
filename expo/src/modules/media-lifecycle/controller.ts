/**
 * Centralized media lifecycle controller for IVX.
 *
 * This module implements the decision logic: which media should be active,
 * paused, prepared, prefetched, or released based on viewport visibility,
 * scroll velocity, module focus, and global resource budgets.
 */
import { useMediaLifecycleStore, type MediaLifecycleStore } from './store';
import type {
  MediaCacheState,
  MediaDownloadState,
  MediaLifecycleConfig,
  MediaLifecycleItem,
  MediaLifecycleState,
  MediaPlayerState,
  MediaScope,
  MediaType,
  ViewportItem,
} from './types';
import { DEFAULT_MEDIA_LIFECYCLE_CONFIG } from './types';
import { recordLifecycleEvent } from './utils/diagnostics';

export { DEFAULT_MEDIA_LIFECYCLE_CONFIG };

export class MediaLifecycleController {
  private config: MediaLifecycleConfig;
  private get store(): MediaLifecycleStore {
    return useMediaLifecycleStore.getState();
  }
  private generation = 0;
  private lastScrollTime = 0;
  private lastScrollOffset = 0;
  private fastScrollUntil = 0;

  constructor(config?: Partial<MediaLifecycleConfig>) {
    this.config = { ...DEFAULT_MEDIA_LIFECYCLE_CONFIG, ...config };
  }

  /**
   * Register a media item with the controller. If the item already exists,
   * update its metadata and bump the mount generation so stale async
   * responses can be rejected.
   */
  registerMedia(
    mediaId: string,
    scope: MediaScope,
    module: string,
    mediaType: MediaType,
    sourceUrl: string | null,
    thumbnailUrl: string | null,
    fullResolutionUrl?: string | null,
    postId?: string | null,
    messageId?: string | null,
  ): void {
    const existing = this.store.items[mediaId];
    const item: MediaLifecycleItem = {
      mediaId,
      postId: postId ?? null,
      messageId: messageId ?? null,
      scope,
      module,
      mediaType,
      sourceUrl: sourceUrl ?? null,
      thumbnailUrl: thumbnailUrl ?? null,
      fullResolutionUrl: fullResolutionUrl ?? null,
      visibilityPercent: existing?.visibilityPercent ?? 0,
      lifecycleState: existing?.lifecycleState ?? 'idle',
      downloadState: existing?.downloadState ?? 'none',
      cacheState: existing?.cacheState ?? 'none',
      playerState: existing?.playerState ?? 'none',
      bufferState: existing?.bufferState ?? 'none',
      isActive: existing?.isActive ?? false,
      isPrefetched: existing?.isPrefetched ?? false,
      lastVisibleAt: existing?.lastVisibleAt ?? 0,
      lastActivatedAt: existing?.lastActivatedAt ?? 0,
      loadStartedAt: existing?.loadStartedAt ?? 0,
      firstFrameAt: existing?.firstFrameAt ?? 0,
      error: existing?.error ?? null,
      retryCount: existing?.retryCount ?? 0,
      mountGeneration: (existing?.mountGeneration ?? 0) + 1,
      aborted: false,
    };
    this.store.registerMedia(item);
    recordLifecycleEvent(mediaId, scope, mediaType, 'registered');
  }

  unregisterMedia(mediaId: string): void {
    this.store.unregisterMedia(mediaId);
  }

  setVisibility(mediaId: string, percent: number): void {
    this.store.setVisibility(mediaId, percent);
  }

  setLifecycle(mediaId: string, state: MediaLifecycleState): void {
    this.store.setLifecycle(mediaId, state);
  }

  setDownload(mediaId: string, state: 'none' | 'queued' | 'loading' | 'loaded' | 'error' | 'cancelled'): void {
    this.store.setDownload(mediaId, state);
  }

  setCache(mediaId: string, state: 'none' | 'memory' | 'disk' | 'network'): void {
    this.store.setCache(mediaId, state);
  }

  setPlayer(mediaId: string, state: MediaLifecycleItem['playerState']): void {
    this.store.setPlayer(mediaId, state);
  }

  setBuffer(mediaId: string, state: MediaLifecycleItem['bufferState']): void {
    this.store.setBuffer(mediaId, state);
  }

  setActive(mediaId: string, active: boolean): void {
    this.store.setActive(mediaId, active);
  }

  setError(mediaId: string, error: string | null): void {
    this.store.setError(mediaId, error);
  }

  setPrefetched(mediaId: string, prefetched: boolean): void {
    this.store.setPrefetched(mediaId, prefetched);
  }

  incrementRetry(mediaId: string): void {
    this.store.incrementRetry(mediaId);
  }

  setFirstFrame(mediaId: string): void {
    this.store.setFirstFrame(mediaId);
  }

  setLoadStarted(mediaId: string): void {
    this.store.setLoadStarted(mediaId);
  }

  markAborted(mediaId: string, aborted: boolean): void {
    this.store.markAborted(mediaId, aborted);
  }

  bumpGeneration(mediaId: string): number {
    this.store.bumpGeneration(mediaId);
    return this.store.items[mediaId]?.mountGeneration ?? 0;
  }

  getItem(mediaId: string): MediaLifecycleItem | undefined {
    return this.store.items[mediaId];
  }

  /**
   * Update scroll state to detect fast scrolling. Returns true if fast-scroll
   * protection is currently active.
   */
  updateScroll(offset: number, timestamp = Date.now()): boolean {
    const delta = Math.abs(offset - this.lastScrollOffset);
    const timeDelta = Math.max(1, timestamp - this.lastScrollTime);
    const velocity = delta / timeDelta;
    this.lastScrollOffset = offset;
    this.lastScrollTime = timestamp;

    if (velocity > this.config.fastScrollVelocity) {
      this.fastScrollUntil = timestamp + 400;
      return true;
    }
    return timestamp < this.fastScrollUntil;
  }

  isFastScrollActive(): boolean {
    return Date.now() < this.fastScrollUntil;
  }

  /** Reset transient controller state. Useful for test isolation. */
  reset(): void {
    this.fastScrollUntil = 0;
    this.lastScrollTime = 0;
    this.lastScrollOffset = 0;
  }

  /**
   * Process a viewport change from a FlatList/FlashList. This is the central
   * decision point for the media lifecycle: it picks the primary media item,
   * activates the eligible video, prepares/prefetches neighbors, pauses other
   * visible videos, and releases items outside the configured window.
   */
  processViewport(scope: MediaScope, viewportItems: ViewportItem[]): void {
    const now = Date.now();
    const focused = this.store.lastScopeFocus[scope] ?? true;

    // Find the most visible eligible media item.
    let primary: ViewportItem | null = null;
    for (const vi of viewportItems) {
      if (!vi.isViewable) continue;
      if (!primary || vi.percentVisible > primary.percentVisible) {
        primary = vi;
      }
    }

    const activeVideoId = primary && focused && primary.percentVisible >= this.config.videoActivationThreshold * 100
      ? this.findActiveVideoInItem(primary, scope)
      : null;

    // Apply global one-active-video rule.
    if (activeVideoId) {
      this.store.setActiveVideo(activeVideoId);
    } else {
      this.store.setActiveVideo(null);
    }

    const primaryIndex = primary?.index ?? null;

    for (const item of Object.values(this.store.items)) {
      if (item.scope !== scope) continue;
      const visible = viewportItems.find((v) => v.index === this.findItemIndex(item));
      const percent = visible?.percentVisible ?? 0;
      const isViewable = visible?.isViewable ?? false;
      const distance = primaryIndex !== null ? Math.abs(this.findItemIndex(item) - primaryIndex) : Infinity;
      const isPrimaryVideo = item.mediaId === activeVideoId;
      const isVideo = item.mediaType === 'video';

      if (isVideo) {
        this.applyVideoRules(item, percent, isViewable, isPrimaryVideo, focused, distance);
      } else {
        this.applyImageRules(item, percent, isViewable, focused, distance);
      }
    }

    recordLifecycleEvent(scope, scope, 'unknown', 'viewport_processed', {
      visibilityPercent: primary?.percentVisible ?? 0,
    });
    void now;
  }

  private findActiveVideoInItem(viewportItem: ViewportItem, scope: MediaScope): string | null {
    // For a viewport item, find the first video registered for that item.
    const index = viewportItem.index;
    for (const item of Object.values(this.store.items)) {
      if (item.scope !== scope) continue;
      if (this.findItemIndex(item) === index && item.mediaType === 'video') {
        return item.mediaId;
      }
    }
    return null;
  }

  private findItemIndex(item: MediaLifecycleItem): number {
    // The index is encoded in the mediaId as a suffix after the last colon.
    // For example: `reels:video:abc123:0` -> index 0.
    const parts = item.mediaId.split(':');
    const last = parts[parts.length - 1];
    if (last && /^\d+$/.test(last)) {
      return Number.parseInt(last, 10);
    }
    return 0;
  }

  private applyVideoRules(
    item: MediaLifecycleItem,
    _percent: number,
    isViewable: boolean,
    isPrimary: boolean,
    scopeFocused: boolean,
    distance: number,
  ): void {
    const fast = this.isFastScrollActive();

    if (!scopeFocused) {
      this.transition(item, 'paused', 'paused');
      return;
    }

    if (isPrimary) {
      if (fast) {
        this.transition(item, 'paused', 'buffering');
      } else {
        this.transition(item, 'active', 'playing');
      }
      return;
    }

    // Any visible but non-primary video stays paused with a mounted player
    // so it can become active instantly when it becomes primary.
    if (isViewable) {
      this.transition(item, 'paused', 'mounted');
      return;
    }

    // Nearby off-screen items: prepare (decode) but do not play.
    if (distance <= this.config.videoPrefetchDistance) {
      this.transition(item, 'ready', 'mounted');
      return;
    }

    // Inside the release window but not near: keep metadata/poster only.
    if (distance <= this.config.videoReleaseWindowRadius) {
      this.transition(item, 'idle', 'none');
      return;
    }

    // Far outside: release resources.
    this.transition(item, 'released', 'released');
  }

  private applyImageRules(
    item: MediaLifecycleItem,
    _percent: number,
    isViewable: boolean,
    scopeFocused: boolean,
    distance: number,
  ): void {
    if (!scopeFocused) {
      this.transition(item, 'paused', 'none');
      return;
    }

    if (isViewable) {
      this.transition(item, 'visible', 'loaded');
      return;
    }

    if (distance <= this.config.imageWindowRadius) {
      this.transition(item, 'ready', 'memory');
      return;
    }

    if (distance <= this.config.imageReleaseWindowRadius) {
      this.transition(item, 'idle', 'memory');
      return;
    }

    this.transition(item, 'released', 'none');
  }

  private transition(item: MediaLifecycleItem, lifecycle: MediaLifecycleState, player: MediaPlayerState | MediaDownloadState | MediaCacheState): void {
    const current = this.store.items[item.mediaId];
    if (!current) return;
    if (current.lifecycleState !== lifecycle) {
      this.store.setLifecycle(item.mediaId, lifecycle);
      recordLifecycleEvent(item.mediaId, item.scope, item.mediaType, 'lifecycle_changed', {
        lifecycleState: lifecycle,
      });
    }
    if (current.mediaType === 'video' && current.playerState !== player) {
      this.store.setPlayer(item.mediaId, player as MediaPlayerState);
      recordLifecycleEvent(item.mediaId, item.scope, item.mediaType, 'player_changed', {
        playerState: player as MediaPlayerState,
      });
    }
    if (lifecycle === 'active' && !current.isActive) {
      this.store.setActive(item.mediaId, true);
    } else if (lifecycle !== 'active' && current.isActive) {
      this.store.setActive(item.mediaId, false);
    }
  }

  /**
   * Suspend all media in a scope when leaving a module (e.g., navigating away).
   */
  suspendScope(scope: MediaScope): void {
    this.store.setScopeFocus(scope, false);
    for (const item of Object.values(this.store.items)) {
      if (item.scope !== scope) continue;
      if (item.mediaType === 'video') {
        this.store.setLifecycle(item.mediaId, 'paused');
        this.store.setPlayer(item.mediaId, 'paused');
      } else {
        this.store.setLifecycle(item.mediaId, 'paused');
      }
      this.store.setActive(item.mediaId, false);
      recordLifecycleEvent(item.mediaId, item.scope, item.mediaType, 'scope_suspended');
    }
  }

  /**
   * Resume a scope when returning to a module.
   */
  resumeScope(scope: MediaScope): void {
    this.store.setScopeFocus(scope, true);
    for (const item of Object.values(this.store.items)) {
      if (item.scope !== scope) continue;
      this.store.setLifecycle(item.mediaId, item.visibilityPercent > 0 ? 'visible' : 'idle');
      recordLifecycleEvent(item.mediaId, item.scope, item.mediaType, 'scope_resumed');
    }
  }

  /**
   * Release all media in a scope (e.g., background app).
   */
  releaseScope(scope: MediaScope): void {
    for (const item of Object.values(this.store.items)) {
      if (item.scope !== scope) continue;
      this.store.setLifecycle(item.mediaId, 'released');
      this.store.setPlayer(item.mediaId, 'released');
      this.store.setActive(item.mediaId, false);
      recordLifecycleEvent(item.mediaId, item.scope, item.mediaType, 'scope_released');
    }
  }

  getDiagnostics() {
    const state = this.store;
    const all = Object.values(state.items);
    const byScope: Record<MediaScope, number> = {
      reels: 0,
      home: 0,
      profile: 0,
      search: 0,
      chat: 0,
      inbox: 0,
      other: 0,
    };
    for (const item of all) {
      byScope[item.scope] = (byScope[item.scope] ?? 0) + 1;
    }
    return {
      totalItems: all.length,
      activeItems: all.filter((i) => i.isActive).length,
      visibleItems: all.filter((i) => i.visibilityPercent > 0).length,
      prefetchingItems: all.filter((i) => i.lifecycleState === 'prefetching').length,
      errorItems: all.filter((i) => i.lifecycleState === 'error').length,
      releasedItems: all.filter((i) => i.lifecycleState === 'released').length,
      activeVideoId: state.activeVideoId,
      events: state.events.slice(-50),
      byScope,
    };
  }
}

/**
 * Singleton controller instance used by the rest of the app.
 */
export const mediaLifecycleController = new MediaLifecycleController();
