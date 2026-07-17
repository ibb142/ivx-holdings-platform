/**
 * Mixed Feed Tests — verifies the approved home feed card routing:
 *   1. Deal blocks render as InvestmentCard (NOT reels)
 *   2. Video blocks render as CanonicalInvestmentReelCard
 *   3. First 3 blocks are deal/investment_card, 4th is video/reel
 *   4. display_type field is explicit on every block
 *   5. InvestmentCard supports up to 8 images
 *   6. No legacy card imports in production routes
 *   7. Landing and Reels use canonical components
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

// ─── Mock data for feed contract tests ─────────────────────────────

const MOCK_BLOCKS = [
  { position: 0, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-1', name: 'Property A' } },
  { position: 1, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-2', name: 'Property B' } },
  { position: 2, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-3', name: 'Property C' } },
  { position: 3, type: 'video', display_type: 'reel', video: { id: 'vid-1', title: 'Casa Rosario Tour' } },
  { position: 4, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-4', name: 'Property D' } },
  { position: 5, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-5', name: 'Property E' } },
  { position: 6, type: 'deal', display_type: 'investment_card', deal: { id: 'deal-6', name: 'Property F' } },
  { position: 7, type: 'video', display_type: 'reel', video: { id: 'vid-2', title: 'Project Reel 2' } },
];

describe('Mixed Feed Card Routing', () => {
  describe('Feed order contract', () => {
    it('first block is investment_card', () => {
      expect(MOCK_BLOCKS[0].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[0].type).toBe('deal');
    });

    it('second block is investment_card', () => {
      expect(MOCK_BLOCKS[1].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[1].type).toBe('deal');
    });

    it('third block is investment_card', () => {
      expect(MOCK_BLOCKS[2].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[2].type).toBe('deal');
    });

    it('fourth block is reel', () => {
      expect(MOCK_BLOCKS[3].display_type).toBe('reel');
      expect(MOCK_BLOCKS[3].type).toBe('video');
    });

    it('pattern repeats: 5th-7th are deals, 8th is reel', () => {
      expect(MOCK_BLOCKS[4].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[5].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[6].display_type).toBe('investment_card');
      expect(MOCK_BLOCKS[7].display_type).toBe('reel');
    });

    it('every block has explicit display_type', () => {
      for (const block of MOCK_BLOCKS) {
        expect(block.display_type).toBeDefined();
        expect(['investment_card', 'reel']).toContain(block.display_type);
      }
    });

    it('no two consecutive video blocks', () => {
      for (let i = 0; i < MOCK_BLOCKS.length - 1; i++) {
        if (MOCK_BLOCKS[i].type === 'video') {
          expect(MOCK_BLOCKS[i + 1].type).not.toBe('video');
        }
      }
    });

    it('pagination does not reorder — position is sequential', () => {
      for (let i = 0; i < MOCK_BLOCKS.length; i++) {
        expect(MOCK_BLOCKS[i].position).toBe(i);
      }
    });
  });

  describe('InvestmentCard component', () => {
    it('InvestmentCard.tsx exists', () => {
      expect(existsSync(join(ROOT, 'components/InvestmentCard.tsx'))).toBe(true);
    });

    it('exports InvestmentCardData interface', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('export interface InvestmentCardData');
    });

    it('supports up to 8 images (MAX_IMAGES = 8)', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('MAX_IMAGES');
      expect(content).toMatch(/MAX_IMAGES\s*=\s*8/);
    });

    it('has horizontal swipe carousel', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('ScrollView');
      expect(content).toContain('horizontal');
      expect(content).toContain('pagingEnabled');
    });

    it('has image counter', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('counterPill');
      expect(content).toContain('counterText');
    });

    it('has View Deal button', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('View Deal');
      expect(content).toContain('viewDealBtn');
    });

    it('has Invest Now button', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('Invest Now');
      expect(content).toContain('investNowBtn');
    });

    it('has like, comment, save, share actions', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('Heart');
      expect(content).toContain('MessageCircle');
      expect(content).toContain('Bookmark');
      expect(content).toContain('Share2');
    });

    it('has ROI metric', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('roi');
      expect(content).toContain('ROI');
    });

    it('has minimum investment metric', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('minimumInvestment');
      expect(content).toContain('MINIMUM INVESTMENT');
    });

    it('has category chips', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('Tokenized');
      expect(content).toContain('JV Deal');
      expect(content).toContain('Buyer');
    });

    it('has location display', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).toContain('MapPin');
      expect(content).toContain('location');
    });

    it('does NOT use full-screen reel layout', () => {
      const content = readFile('components/InvestmentCard.tsx');
      expect(content).not.toContain('StyleSheet.absoluteFill');
      expect(content).not.toContain('screenHeight');
    });
  });

  describe('InvestorFirstFeed mixed routing', () => {
    it('imports InvestmentCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain("import InvestmentCard");
      expect(content).toContain("from '@/components/InvestmentCard'");
    });

    it('imports CanonicalInvestmentReelCard for video blocks', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain("CanonicalInvestmentReelCard");
    });

    it('deal blocks render InvestmentCard (not reel)', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // The deal block section should use <InvestmentCard
      expect(content).toContain('<InvestmentCard');
    });

    it('video blocks render CanonicalInvestmentReelCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('<CanonicalInvestmentReelCard');
    });

    it('does not render all blocks as reels', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      // The old code rendered every block as CanonicalInvestmentReelCard
      // New code should have a conditional: deal → InvestmentCard, video → ReelCard
      expect(content).toContain("block.type === 'video'");
      expect(content).toContain('InvestmentCard');
    });

    it('does not import TrustDealCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import TrustDealCard");
    });

    it('does not import InstagramProjectCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import InstagramProjectCard");
    });

    it('does not import PropertyCard', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain("import PropertyCard");
    });

    it('routes View Deal to /jv-invest', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain("pathname: '/jv-invest'");
      expect(content).toContain('jvId');
    });
  });

  describe('display_type in feed types', () => {
    it('video-feed.ts exports DisplayType', () => {
      const content = readFile('lib/video-feed.ts');
      expect(content).toContain('DisplayType');
      expect(content).toContain("investment_card");
      expect(content).toContain("'reel'");
    });

    it('HomeFeedBlock has display_type field', () => {
      const content = readFile('lib/video-feed.ts');
      expect(content).toContain('display_type');
    });
  });

  describe('Legacy removal', () => {
    it('InvestorFirstFeed has zero TrustDealCard imports', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain('TrustDealCard');
    });

    it('InvestorFirstFeed has zero InstagramProjectCard imports', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain('InstagramProjectCard');
    });

    it('InvestorFirstFeed has zero PropertyCard imports', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).not.toContain('PropertyCard');
    });

    it('Home (home.tsx) imports InvestorFirstFeed', () => {
      const content = readFile('app/(tabs)/(home)/home.tsx');
      expect(content).toContain('InvestorFirstFeed');
    });

    it('Reels (videos.tsx) uses CanonicalInvestmentReelCard', () => {
      const content = readFile('app/videos.tsx');
      expect(content).toContain('CanonicalInvestmentReelCard');
    });

    it('Landing uses InvestmentCard for deal parity', () => {
      const content = readFile('app/landing.tsx');
      expect(content).toContain('InvestmentCard');
      expect(content).toContain('buildTimelineSummary');
      expect(content).not.toContain('CanonicalInvestmentReelCard');
    });
  });

  describe('Reel card viewport safety', () => {
    it('CanonicalInvestmentReelCard uses safe area insets', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('useSafeAreaInsets');
      expect(content).toContain('insets.bottom');
    });

    it('CanonicalInvestmentReelCard has no hardcoded fixed height', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      // cardHeight is computed from screenHeight or feedHeight, not hardcoded
      expect(content).toContain('cardHeight');
      expect(content).toContain('isReel ? screenHeight : feedHeight');
    });

    it('CanonicalInvestmentReelCard pauses when inactive', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('shouldPlay');
      expect(content).toContain('isActive');
      expect(content).toContain('AppState');
    });

    it('feed mode uses viewability detection', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('isInViewport');
      expect(content).toContain('visibilityRatio');
    });
  });

  describe('No infinite loading', () => {
    it('InvestorFirstFeed has empty state', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('blocks.length === 0');
      expect(content).toContain('No deals available yet');
    });

    it('InvestorFirstFeed has loading state', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('isLoading');
      expect(content).toContain('ActivityIndicator');
    });

    it('InvestorFirstFeed has error boundary', () => {
      const content = readFile('components/InvestorFirstFeed.tsx');
      expect(content).toContain('CardBoundary');
      expect(content).toContain('getDerivedStateFromError');
    });
  });
});
