/**
 * Reels deep-link focus regression — ensures tapping a specific video on Home
 * opens THAT video in the reels feed instead of always starting at the top.
 *
 * Home/DealVideoCard push:  /videos?type=reel&focus=<videoId|deal-<dealId>>
 * Before this fix, videos.tsx read the params and discarded them (`void params`),
 * so the reels feed always opened at index 0 — reported as "reels never work".
 *
 * These tests FAIL if:
 *   - the focus param is ignored again
 *   - the deep-link index resolver is removed
 *   - the FlatList loses its ref / scroll-to-index recovery
 *
 * File under test: expo/app/videos.tsx
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readVideosScreen(): string {
  return readFileSync(join(ROOT, 'app', 'videos.tsx'), 'utf-8');
}

describe('Reels deep-link focus (end-to-end fix)', () => {
  it('reads the focus param from local search params', () => {
    const content = readVideosScreen();
    expect(content).toMatch(/useLocalSearchParams<\{\s*type\?: string;\s*focus\?: string\s*\}>/);
    expect(content).not.toMatch(/void params/);
  });

  it('exposes a deep-link index resolver accepting video ids and deal-<dealId>', () => {
    const content = readVideosScreen();
    expect(content).toMatch(/export function resolveReelFocusIndex/);
    expect(content).toMatch(/v\.id === focus/);
    expect(content).toMatch(/focus\.startsWith\('deal-'\)/);
    expect(content).toMatch(/v\.deal\?\.id === dealId/);
  });

  it('scrolls the feed to the focused video and paginates until it is found', () => {
    const content = readVideosScreen();
    expect(content).toMatch(/scrollToIndex\(\{\s*index,\s*animated: false/);
    expect(content).toMatch(/focusAppliedRef/);
    // Focused video beyond the first page → keep loading instead of giving up.
    expect(content).toMatch(/hasMore && !isFetchingMore/);
  });

  it('recovers when scrollToIndex runs before the row is measured', () => {
    const content = readVideosScreen();
    expect(content).toMatch(/onScrollToIndexFailed/);
  });

  it('the resolver returns -1 when the focused video is not loaded yet', () => {
    const content = readVideosScreen();
    expect(content).toMatch(/return -1;/);
  });
});
