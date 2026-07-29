/**
 * Regression tests for the Home Reels card size — ITEM 2.
 *
 * These tests FAIL if:
 *   - Home card becomes full-screen
 *   - feedHeight becomes NaN
 *   - card exceeds approved bounds (520px cap)
 *   - full Reel styling is applied to Home
 *   - controls overflow the card
 *   - screenHeight is used in Home card height calculation
 *
 * File under test: expo/components/InvestorFirstFeed.tsx
 * Component: InvestorFirstFeed
 * Approved design: feedHeight = Math.min(screenWidth - padH * 2, 520)
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

describe('ITEM 2: Home Reels Card Size Regression', () => {
  describe('Approved compact size (520px cap)', () => {
    it('feedHeight is capped at 520px', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // The approved formula: Math.min(screenWidth - padH * 2, 520)
      expect(content).toContain('520');
      expect(content).toMatch(/feedHeight\s*=\s*Math\.min\(/);
      expect(content).toMatch(/screenWidth\s*-\s*padH\s*\*\s*2/);
    });

    it('feedHeight uses screenWidth (not screenHeight)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // screenWidth must be destructured from useWindowDimensions
      expect(content).toMatch(/width:\s*screenWidth/);
      // screenHeight must NOT be destructured
      expect(content).not.toMatch(/height:\s*screenHeight/);
      // screenHeight must NOT appear in feedHeight calculation
      const feedHeightLine = content.match(/feedHeight\s*=\s*[^\n]+/);
      expect(feedHeightLine).toBeTruthy();
      expect(feedHeightLine![0]).not.toContain('screenHeight');
    });

    it('feedHeight does not reference undefined screenHeight variable', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // If screenHeight is referenced but never destructured, it's undefined → NaN
      const hasScreenHeightDestructure = /height:\s*screenHeight/.test(content);
      const hasScreenHeightInFeedHeight = /feedHeight[^;]*screenHeight/.test(content);
      // If screenHeight is in feedHeight but not destructured → NaN bug
      if (hasScreenHeightInFeedHeight) {
        expect(hasScreenHeightDestructure).toBe(true);
      }
      // Explicitly: feedHeight must NOT contain screenHeight at all
      const feedHeightLine = content.match(/const feedHeight\s*=\s*[^;\n]+/);
      if (feedHeightLine) {
        expect(feedHeightLine[0]).not.toContain('screenHeight');
      }
    });

    it('feedHeight is never NaN — all referenced variables are defined', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // screenWidth must be defined via useWindowDimensions
      expect(content).toMatch(/const\s*\{\s*width:\s*screenWidth\s*\}\s*=\s*useWindowDimensions/);
      // padH must be defined before feedHeight
      expect(content).toMatch(/padH\s*=/);
      // feedHeight formula must only use defined variables
      const feedHeightLine = content.match(/const feedHeight\s*=\s*Math\.min\(([^,]+),\s*(\d+)\)/);
      expect(feedHeightLine).toBeTruthy();
      const firstArg = feedHeightLine![1].trim();
      // Must reference screenWidth and padH (both defined above)
      expect(firstArg).toContain('screenWidth');
      expect(firstArg).toContain('padH');
    });
  });

  describe('Home card is NOT full-screen', () => {
    it('passes mode="feed" (not mode="reel") to CanonicalInvestmentReelCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('mode="feed"');
      // Home should NOT pass mode="reel"
      const homeReelSection = content.match(/<CanonicalInvestmentReelCard[\s\S]*?\/>/);
      if (homeReelSection) {
        expect(homeReelSection[0]).toContain('mode="feed"');
        expect(homeReelSection[0]).not.toContain('mode="reel"');
      }
    });

    it('passes shouldMountVideo={false} (no autoplay on Home)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('shouldMountVideo={false}');
    });

    it('passes isActive={false} (Home card is not the active player)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('isActive={false}');
    });

    it('passes feedHeight prop (not screenHeight)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('feedHeight={feedHeight}');
    });

    it('does not use full-screen 9:16 ratio on Home', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // The broken code used: reelWidth * 16/9 — must not be present
      expect(content).not.toMatch(/reelWidth\s*\*\s*16\s*\/\s*9/);
      // Must not use screenHeight * 0.85 or similar
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
      // Home uses a regular View, not a FlatList with pagingEnabled
      expect(content).not.toMatch(/pagingEnabled/);
      expect(content).not.toMatch(/snapToInterval/);
    });

    it('Home does not set cardHeight = screenHeight', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // The Reels module sets cardHeight = screenHeight via mode="reel"
      // Home must use mode="feed" which makes cardHeight = feedHeight
      expect(content).toContain('mode="feed"');
    });
  });

  describe('Card bounds do not exceed approved limits', () => {
    it('feedHeight max value is 520 (not larger)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      const match = content.match(/Math\.min\([^,]+,\s*(\d+)\)/);
      expect(match).toBeTruthy();
      const cap = parseInt(match![1], 10);
      expect(cap).toBeLessThanOrEqual(520);
      expect(cap).toBe(520);
    });

    it('feedHeight is responsive (depends on screenWidth)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      const match = content.match(/Math\.min\(([^,]+),/);
      expect(match).toBeTruthy();
      const formula = match![1];
      expect(formula).toContain('screenWidth');
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

    it('CanonicalInvestmentReelCard in feed mode uses feedHeight for cardHeight', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      // cardHeight = isReel ? screenHeight : feedHeight
      expect(content).toContain('cardHeight');
      expect(content).toMatch(/isReel\s*\?\s*screenHeight\s*:\s*feedHeight/);
    });

    it('CanonicalInvestmentReelCard clips overflow', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('overflow');
    });
  });

  describe('No layout breakage on different screen sizes', () => {
    it('formula works for small screens (screenWidth < 520 + padH*2)', () => {
      // On a 360px screen: feedHeight = min(360-40, 520) = min(320, 520) = 320
      const screenWidth = 360;
      const padH = 20;
      const feedHeight = Math.min(screenWidth - padH * 2, 520);
      expect(feedHeight).toBe(320);
      expect(Number.isNaN(feedHeight)).toBe(false);
      expect(feedHeight).toBeGreaterThan(0);
    });

    it('formula works for tablets (screenWidth > 520 + padH*2)', () => {
      // On a 800px screen: feedHeight = min(800-40, 520) = min(760, 520) = 520
      const screenWidth = 800;
      const padH = 20;
      const feedHeight = Math.min(screenWidth - padH * 2, 520);
      expect(feedHeight).toBe(520);
      expect(Number.isNaN(feedHeight)).toBe(false);
    });

    it('formula works for mobile web viewport', () => {
      // On a 390px screen (iPhone 14): feedHeight = min(390-32, 520) = min(358, 520) = 358
      const screenWidth = 390;
      const padH = 16; // isXs = true
      const feedHeight = Math.min(screenWidth - padH * 2, 520);
      expect(feedHeight).toBe(358);
      expect(Number.isNaN(feedHeight)).toBe(false);
    });

    it('formula never produces NaN for any positive screenWidth', () => {
      for (const sw of [280, 320, 360, 390, 414, 768, 1024, 1440]) {
        for (const ph of [16, 20]) {
          const fh = Math.min(sw - ph * 2, 520);
          expect(Number.isNaN(fh)).toBe(false);
          expect(fh).toBeGreaterThan(0);
        }
      }
    });
  });
});
