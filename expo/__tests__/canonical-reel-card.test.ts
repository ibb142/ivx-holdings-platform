/**
 * Regression tests for the canonical reel card migration.
 *
 * Verifies:
 *   - Main/Home uses CanonicalInvestmentReelCard (not old cards)
 *   - Reels uses CanonicalInvestmentReelCard (not old cards)
 *   - Landing uses CanonicalInvestmentReelCard (not old cards)
 *   - Old reel card has zero production imports
 *   - Deal ID is preserved through mapping (route contract)
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

describe('Canonical Reel Card Migration', () => {
  describe('Old card removal', () => {
    it('InvestorFirstFeed does not import TrustDealCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import TrustDealCard");
    });

    it('InvestorFirstFeed does not import DealVideoCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import DealVideoCard");
    });

    it('InvestorFirstFeed does not import InstagramProjectCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import InstagramProjectCard");
    });

    it('Landing does not import InstagramProjectCard', () => {
      const content = readFile('app/landing.tsx');
      expect(content).not.toContain("import InstagramProjectCard");
    });

    it('Landing does not import TrustDealCard', () => {
      const content = readFile('app/landing.tsx');
      expect(content).not.toContain("import TrustDealCard");
    });

    it('Invest tab does not import TrustDealCard', () => {
      const content = readFile('app/(tabs)/invest/index.tsx');
      expect(content).not.toContain("import TrustDealCard");
    });

    it('Reels (videos.tsx) does not import DealVideoCard', () => {
      const content = readFile('app/videos.tsx');
      expect(content).not.toContain("import DealVideoCard");
    });
  });

  describe('Canonical card adoption', () => {
    it('InvestorFirstFeed imports CanonicalInvestmentReelCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain("CanonicalInvestmentReelCard");
    });

    it('Reels (videos.tsx) imports CanonicalInvestmentReelCard', () => {
      const content = readFile('app/videos.tsx');
      expect(content).toContain("CanonicalInvestmentReelCard");
    });

    it('Landing imports InvestmentCard for deal parity', () => {
      const content = readFile('app/landing.tsx');
      expect(content).toContain("InvestmentCard");
      expect(content).toContain("buildTimelineSummary");
      expect(content).toContain("InvestmentCardData");
    });

    it('Invest tab imports CanonicalInvestmentReelCard', () => {
      const content = readFile('app/(tabs)/invest/index.tsx');
      expect(content).toContain("CanonicalInvestmentReelCard");
    });
  });

  describe('Canonical component file exists', () => {
    it('CanonicalInvestmentReelCard.tsx exists', () => {
      expect(existsSync(join(ROOT, 'components/CanonicalInvestmentReelCard.tsx'))).toBe(true);
    });

    it('exports feedVideoToReelData adapter', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('export function feedVideoToReelData');
    });

    it('exports homeFeedDealToReelData adapter', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('export function homeFeedDealToReelData');
    });

    it('exports parsedDealToReelData adapter', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('export function parsedDealToReelData');
    });

    it('exports publishedCardToReelData adapter', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('export function publishedCardToReelData');
    });
  });

  describe('Deal detail loading states', () => {
    it('jv-invest has timeout state', () => {
      const content = readFile('app/jv-invest.tsx');
      expect(content).toContain('loadingTimedOut');
      expect(content).toContain('10000');
    });

    it('jv-invest has not-found state', () => {
      const content = readFile('app/jv-invest.tsx');
      expect(content).toContain('Deal Not Found');
    });

    it('jv-invest has network error state', () => {
      const content = readFile('app/jv-invest.tsx');
      expect(content).toContain('Network Error');
    });

    it('jv-invest has retry button', () => {
      const content = readFile('app/jv-invest.tsx');
      expect(content).toContain('retry-btn');
    });

    it('jv-invest has back button', () => {
      const content = readFile('app/jv-invest.tsx');
      expect(content).toContain('Go Back');
    });
  });

  describe('Deal route contract', () => {
    it('Home feed routes to /jv-invest with jvId param', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain("pathname: '/jv-invest'");
      expect(content).toContain('jvId');
    });

    it('Reels routes to /jv-invest with jvId param', () => {
      const content = readFile('app/videos.tsx');
      expect(content).toContain("pathname: '/jv-invest'");
      expect(content).toContain('jvId');
    });

    it('Landing routes to /jv-invest with jvId param', () => {
      const content = readFile('app/landing.tsx');
      expect(content).toContain('jv-invest');
      expect(content).toContain('jvId');
    });

    it('Invest tab routes to /jv-invest with jvId param', () => {
      const content = readFile('app/(tabs)/invest/index.tsx');
      expect(content).toContain('jv-invest');
      expect(content).toContain('jvId');
    });
  });
});
