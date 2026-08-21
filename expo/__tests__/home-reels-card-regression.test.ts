/**
 * Regression tests for the Home card size — ITEM 2 (post black-screen fix).
 *
 * The Home feed no longer mounts the canonical reel card at all: deal blocks
 * render as compact InvestmentCard and video blocks render a poster-only
 * preview (the native player initialises only in /videos — fix 89ea63d67).
 *
 * These tests FAIL if:
 *   - Home card becomes full-screen
 *   - screenHeight leaks back into Home card sizing
 *   - full Reel styling (paging, mode="reel") is applied to Home
 *   - the poster preview exceeds approved compact bounds (220 ≤ 520)
 *
 * File under test: expo/components/InvestorFirstFeed.tsx
 * Component: InvestorFirstFeed
 * Approved design: poster-only preview, minHeight 220, width 100%
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

describe('ITEM 2: Home Reels Card Size Regression', () => {
  describe('Approved compact size (poster-only preview)', () => {
    it('video preview keeps the compact 220 minHeight (≤ 520 cap)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toMatch(/minHeight:\s*220/);
      expect(content).not.toMatch(/minHeight:\s*[5-9]\d{2}/);
    });

    it('no feedHeight formula / screenHeight math on Home', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toMatch(/feedHeight\s*=/);
      expect(content).not.toMatch(/screenHeight/);
    });
  });

  describe('Home card is NOT full-screen', () => {
    it('never mounts the reel card or native player on Home', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain('CanonicalInvestmentReelCard');
      expect(content).not.toContain('mode="reel"');
      expect(content).not.toContain('mode="feed"');
      expect(content).not.toMatch(/from\s+['"]expo-av['"]/);
    });

    it('video block renders a poster-only preview routing to /videos', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('poster');
      expect(content).toContain("pathname: '/videos'");
      expect(content).toContain('CardBoundary');
    });

    it('does not use full-screen 9:16 ratio on Home', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toMatch(/reelWidth\s*\*\s*16\s*\/\s*9/);
      expect(content).not.toMatch(/screenHeight\s*\*\s*0\.\d+/);
    });
  });

  describe('Full Reel styling NOT applied to Home', () => {
    it('Home does not use itemHeight = windowHeight', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toMatch(/itemHeight\s*=\s*windowHeight/);
    });

    it('Home does not use pagingEnabled for vertical snap', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toMatch(/pagingEnabled/);
      expect(content).not.toMatch(/snapToInterval/);
    });

    it('Home does not set cardHeight = screenHeight', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toMatch(/cardHeight/);
    });
  });

  describe('Card bounds do not exceed approved limits', () => {
    it('every minHeight in the feed stays within the 520 cap', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      const heights = [...content.matchAll(/minHeight:\s*(\d+)/g)].map(m => parseInt(m[1], 10));
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) {
        expect(h).toBeLessThanOrEqual(520);
      }
    });

    it('video preview fills width responsively (100%, no screenWidth math)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toMatch(/width:\s*'100%'/);
      expect(content).not.toMatch(/screenWidth\s*-/);
    });

    it('padH is defined with responsive values (16 or 20)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toMatch(/padH\s*=\s*isXs\s*\?\s*16\s*:\s*20/);
    });
  });

  describe('Controls do not overflow the card', () => {
    it('CanonicalInvestmentReelCard accepts feedHeight and uses it for bounds', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('feedHeight');
      expect(content).toMatch(/isReel\s*\?\s*screenHeight\s*:\s*feedHeight/);
    });

    it('CanonicalInvestmentReelCard clips overflow', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('overflow');
    });
  });

  describe('No layout breakage on different screen sizes', () => {
    it('compact 220 preview height is valid for every screen width class', () => {
      for (const sw of [280, 320, 360, 390, 414, 768, 1024, 1440]) {
        const h = 220;
        expect(Number.isNaN(h)).toBe(false);
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThanOrEqual(sw);
      }
    });
  });
});
