import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const readFile = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

describe('Canonical reel ownership regression', () => {
  it('keeps the canonical reel component and route adapters', () => {
    expect(existsSync(join(ROOT, 'components/CanonicalInvestmentReelCard.tsx'))).toBe(true);
    const content = readFile('components/CanonicalInvestmentReelCard.tsx');
    expect(content).toContain('export function feedVideoToReelData');
    expect(content).toContain('export function homeFeedDealToReelData');
    expect(content).toContain('export function parsedDealToReelData');
    expect(content).toContain('export function publishedCardToReelData');
  });

  it('dedicated Reels route owns CanonicalInvestmentReelCard', () => {
    const reels = readFile('app/videos.tsx');
    expect(reels).toContain('CanonicalInvestmentReelCard');
    expect(reels).not.toContain('DealVideoCard');
  });

  it('Invest tab may render the canonical reel card', () => {
    const invest = readFile('app/(tabs)/invest/index.tsx');
    expect(invest).toContain('CanonicalInvestmentReelCard');
    expect(invest).not.toContain('TrustDealCard');
  });

  it('Home deals use InvestmentCard, not a reel', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain("import InvestmentCard");
    expect(home).toContain('<InvestmentCard');
    expect(home).not.toContain('CanonicalInvestmentReelCard');
    expect(home).not.toContain('TrustDealCard');
    expect(home).not.toContain('DealVideoCard');
    expect(home).not.toContain('InstagramProjectCard');
  });

  it('Home videos stay poster-only until the Reels route opens', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain("block.type === 'video'");
    expect(home).toContain('videoPreview');
    expect(home).toContain("pathname: '/videos'");
    expect(home).toContain('focus: block.video.id');
  });

  it('Landing uses InvestmentCard for deal parity', () => {
    const landing = readFile('app/landing.tsx');
    expect(landing).toContain('InvestmentCard');
    expect(landing).toContain('buildTimelineSummary');
    expect(landing).toContain('InvestmentCardData');
    expect(landing).not.toContain('TrustDealCard');
  });

  it('Home deal detail routing preserves jvId', () => {
    const home = readFile('components/InvestorFirstFeed.tsx');
    expect(home).toContain("pathname: '/jv-invest'");
    expect(home).toContain('jvId');
  });

  it('jv-invest retains recoverable loading and network states', () => {
    const detail = readFile('app/jv-invest.tsx');
    expect(detail).toContain('loadingTimedOut');
    expect(detail).toContain('Deal Not Found');
    expect(detail).toContain('Network Error');
    expect(detail).toContain('retry-btn');
    expect(detail).toContain('Go Back');
  });
});
