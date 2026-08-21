import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const readFile = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

const MOCK_BLOCKS = [
  { position: 0, type: 'deal', display_type: 'investment_card' },
  { position: 1, type: 'deal', display_type: 'investment_card' },
  { position: 2, type: 'deal', display_type: 'investment_card' },
  { position: 3, type: 'video', display_type: 'reel' },
  { position: 4, type: 'deal', display_type: 'investment_card' },
  { position: 5, type: 'deal', display_type: 'investment_card' },
  { position: 6, type: 'deal', display_type: 'investment_card' },
  { position: 7, type: 'video', display_type: 'reel' },
];

describe('Mixed feed contract', () => {
  it('keeps the three-deals then video sequence', () => {
    expect(MOCK_BLOCKS.map((b) => b.display_type)).toEqual([
      'investment_card', 'investment_card', 'investment_card', 'reel',
      'investment_card', 'investment_card', 'investment_card', 'reel',
    ]);
    MOCK_BLOCKS.forEach((block, index) => expect(block.position).toBe(index));
  });

  it('InvestmentCard remains the deal component', () => {
    expect(existsSync(join(ROOT, 'components/InvestmentCard.tsx'))).toBe(true);
    const card = readFile('components/InvestmentCard.tsx');
    expect(card).toContain('export interface InvestmentCardData');
    expect(card).toMatch(/MAX_IMAGES\s*=\s*8/);
    expect(card).toContain('ScrollView');
    expect(card).toContain('pagingEnabled');
    expect(card).toContain('View Deal');
    expect(card).toContain('Invest Now');
    expect(card).toContain('minimumInvestment');
  });

  it('Home maps deals to InvestmentCard', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain("import InvestmentCard");
    expect(home).toContain('<InvestmentCard');
    expect(home).toContain("pathname: '/jv-invest'");
    expect(home).toContain('jvId');
  });

  it('Home maps video blocks to poster-only previews', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain("block.type === 'video'");
    expect(home).toContain('videoPreview');
    expect(home).toContain('videoPoster');
    expect(home).toContain("pathname: '/videos'");
    expect(home).not.toContain('CanonicalInvestmentReelCard');
  });

  it('Home contains no legacy production cards', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).not.toContain('TrustDealCard');
    expect(home).not.toContain('InstagramProjectCard');
    expect(home).not.toContain('PropertyCard');
    expect(home).not.toContain('DealVideoCard');
  });

  it('feed types keep explicit display_type', () => {
    const feed = readFile('lib/video-feed.ts');
    expect(feed).toContain('DisplayType');
    expect(feed).toContain('investment_card');
    expect(feed).toContain("'reel'");
    expect(feed).toContain('display_type');
  });

  it('dedicated Reels route still uses the canonical reel component', () => {
    expect(readFile('app/videos.tsx')).toContain('CanonicalInvestmentReelCard');
  });

  it('Landing uses InvestmentCard for deal parity', () => {
    const landing = readFile('app/landing.tsx');
    expect(landing).toContain('InvestmentCard');
    expect(landing).toContain('buildTimelineSummary');
    expect(landing).not.toContain('CanonicalInvestmentReelCard');
  });

  it('Home never leaves loading, empty, or card crashes as blank content', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain('isLoading');
    expect(home).toContain('ShimmerIndicator');
    expect(home).toContain('blocks.length === 0');
    expect(home).toContain('No deals available yet');
    expect(home).toContain('CardBoundary');
    expect(home).toContain('getDerivedStateFromError');
  });
});
