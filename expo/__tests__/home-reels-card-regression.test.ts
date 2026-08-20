import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const home = readFileSync(join(ROOT, 'components/InvestorFirstFeed.tsx'), 'utf-8');

describe('Home feed video safety regression', () => {
  it('renders deal blocks with InvestmentCard', () => {
    expect(home).toContain("import InvestmentCard");
    expect(home).toContain('<InvestmentCard');
  });

  it('renders video blocks as poster-only previews', () => {
    expect(home).toContain("block.type === 'video'");
    expect(home).toContain('videoPreview');
    expect(home).toContain('videoPoster');
    expect(home).toContain('TouchableOpacity');
  });

  it('does not mount the canonical/native reel player on Home', () => {
    expect(home).not.toContain('CanonicalInvestmentReelCard');
    expect(home).not.toMatch(/from\s+['"]expo-av['"]/);
    expect(home).not.toMatch(/require\(\s*['"]expo-av['"]\s*\)/);
    expect(home).not.toMatch(/from\s+['"]expo-video['"]/);
    expect(home).not.toMatch(/require\(\s*['"]expo-video['"]\s*\)/);
    expect(home).not.toContain('shouldMountVideo');
  });

  it('opens the dedicated Reels route when a preview is tapped', () => {
    expect(home).toContain("pathname: '/videos'");
    expect(home).toContain("type: 'reel'");
    expect(home).toContain('focus: block.video.id');
  });

  it('keeps video preview accessible and bounded', () => {
    expect(home).toContain('accessibilityRole="button"');
    expect(home).toContain('accessibilityLabel={`Open project video: ${title}`}');
    expect(home).toContain("width: '100%'");
    expect(home).toContain("overflow: 'hidden'");
    expect(home).toContain('minHeight: 220');
  });

  it('keeps per-card crash containment', () => {
    expect(home).toContain('class CardBoundary');
    expect(home).toContain('getDerivedStateFromError');
    expect(home).toContain('<CardBoundary');
  });
});
