/**
 * Unit tests for the IVX Global Media Lifecycle controller.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { mediaLifecycleController, MediaLifecycleController } from '../controller';
import { useMediaLifecycleStore } from '../store';
import type { MediaScope } from '../types';

function resetStore() {
  useMediaLifecycleStore.setState({
    items: {},
    events: [],
    activeVideoId: null,
    lastScopeFocus: {
      reels: true,
      home: true,
      profile: true,
      search: true,
      chat: true,
      inbox: true,
      other: true,
    },
  });
  mediaLifecycleController.reset();
}

describe('MediaLifecycleController', () => {
  beforeEach(() => {
    resetStore();
  });

  it('registers media and tracks lifecycle state', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'https://example.com/v0.mp4', 'https://example.com/p0.jpg');
    const item = mediaLifecycleController.getItem('reels:video:0');
    expect(item).toBeDefined();
    expect(item?.scope).toBe('reels');
    expect(item?.mediaType).toBe('video');
    expect(item?.lifecycleState).toBe('idle');
  });

  it('selects the most visible video as the active video', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.registerMedia('reels:video:1', 'reels', 'reels', 'video', 'v1.mp4', 'p1.jpg');
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 90 },
      { index: 1, item: {}, isViewable: true, percentVisible: 10 },
    ]);
    expect(useMediaLifecycleStore.getState().activeVideoId).toBe('reels:video:0');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.isActive).toBe(true);
    expect(useMediaLifecycleStore.getState().items['reels:video:1']?.lifecycleState).toBe('paused');
  });

  it('enforces only one active video globally', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.registerMedia('reels:video:1', 'reels', 'reels', 'video', 'v1.mp4', 'p1.jpg');
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 90 },
    ]);
    expect(useMediaLifecycleStore.getState().activeVideoId).toBe('reels:video:0');
    mediaLifecycleController.processViewport('reels', [
      { index: 1, item: {}, isViewable: true, percentVisible: 90 },
    ]);
    expect(useMediaLifecycleStore.getState().activeVideoId).toBe('reels:video:1');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.isActive).toBe(false);
    expect(useMediaLifecycleStore.getState().items['reels:video:1']?.isActive).toBe(true);
  });

  it('pauses video when below pause threshold', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 30 },
    ]);
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.lifecycleState).toBe('paused');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.playerState).toBe('mounted');
  });

  it('releases video outside the release window', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.registerMedia('reels:video:10', 'reels', 'reels', 'video', 'v10.mp4', 'p10.jpg');
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 95 },
    ]);
    expect(useMediaLifecycleStore.getState().items['reels:video:10']?.lifecycleState).toBe('released');
    expect(useMediaLifecycleStore.getState().items['reels:video:10']?.playerState).toBe('released');
  });

  it('activates fast-scroll protection on high velocity', () => {
    const fast = mediaLifecycleController.updateScroll(0);
    expect(fast).toBe(false);
    // Move far enough in a single update to exceed the velocity threshold.
    const fast2 = mediaLifecycleController.updateScroll(10000);
    expect(fast2).toBe(true);
  });

  it('does not activate a new video while fast scrolling', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.updateScroll(0);
    mediaLifecycleController.updateScroll(10000); // fast scroll
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 95 },
    ]);
    // Primary item is detected but fast scroll keeps it buffered/prepared, not active
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.lifecycleState).toBe('paused');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.playerState).toBe('buffering');
  });

  it('suspends and resumes a scope', () => {
    mediaLifecycleController.registerMedia('chat:image:0', 'chat', 'chat', 'image', 'img0.jpg', 'thumb0.jpg');
    mediaLifecycleController.setVisibility('chat:image:0', 100);
    mediaLifecycleController.suspendScope('chat');
    expect(useMediaLifecycleStore.getState().items['chat:image:0']?.lifecycleState).toBe('paused');
    mediaLifecycleController.resumeScope('chat');
    expect(useMediaLifecycleStore.getState().items['chat:image:0']?.lifecycleState).toBe('visible');
  });

  it('releases all media in a scope', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.releaseScope('reels');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.lifecycleState).toBe('released');
    expect(useMediaLifecycleStore.getState().items['reels:video:0']?.playerState).toBe('released');
  });

  it('bumps mount generation on re-registration to reject stale async updates', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    const gen1 = mediaLifecycleController.getItem('reels:video:0')?.mountGeneration;
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0_new.mp4', 'p0.jpg');
    const gen2 = mediaLifecycleController.getItem('reels:video:0')?.mountGeneration;
    expect(gen2).toBeGreaterThan(gen1 ?? 0);
  });

  it('allows custom configuration', () => {
    const controller = new MediaLifecycleController({ videoActivationThreshold: 0.5, imageWindowRadius: 1 });
    controller.registerMedia('home:image:0', 'home', 'home', 'image', 'img0.jpg', 'thumb0.jpg');
    controller.processViewport('home', [
      { index: 0, item: {}, isViewable: true, percentVisible: 60 },
    ]);
    expect(useMediaLifecycleStore.getState().items['home:image:0']?.lifecycleState).toBe('visible');
  });

  it('reports diagnostics', () => {
    mediaLifecycleController.registerMedia('reels:video:0', 'reels', 'reels', 'video', 'v0.mp4', 'p0.jpg');
    mediaLifecycleController.processViewport('reels', [
      { index: 0, item: {}, isViewable: true, percentVisible: 95 },
    ]);
    const diag = mediaLifecycleController.getDiagnostics();
    expect(diag.totalItems).toBe(1);
    expect(diag.activeItems).toBe(1);
    expect(diag.activeVideoId).toBe('reels:video:0');
  });
});
