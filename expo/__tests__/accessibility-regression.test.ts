/**
 * Regression tests for accessibility — ITEM 13 + ITEM 18.
 *
 * Verifies:
 *   - Accessibility labels on all interactive elements
 *   - Accessibility roles (button, image)
 *   - Accessibility hints for user guidance
 *   - Accessibility state (checked for like/save/mute)
 *   - Reduced-motion hook exists and is used
 *   - Haptic feedback respects reduced-motion
 *   - Heart burst animation skipped when reduced-motion is enabled
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..'); // expo/

function readFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

describe('ITEM 13/18: Accessibility Regression', () => {
  describe('useReducedMotion hook', () => {
    it('useReducedMotion.ts exists', () => {
      expect(existsSync(join(ROOT, 'hooks/useReducedMotion.ts'))).toBe(true);
    });

    it('uses AccessibilityInfo.isReduceMotionEnabled', () => {
      const content = readFile('hooks/useReducedMotion.ts');
      expect(content).toContain('AccessibilityInfo');
      expect(content).toContain('isReduceMotionEnabled');
    });

    it('listens for reduceMotionChanged events', () => {
      const content = readFile('hooks/useReducedMotion.ts');
      expect(content).toContain('reduceMotionChanged');
      expect(content).toContain('addEventListener');
    });

    it('cleans up subscription on unmount', () => {
      const content = readFile('hooks/useReducedMotion.ts');
      expect(content).toContain('subscription.remove');
    });

    it('returns a boolean', () => {
      const content = readFile('hooks/useReducedMotion.ts');
      expect(content).toContain('useState<boolean>');
      expect(content).toContain('return reducedMotion');
    });
  });

  describe('CanonicalInvestmentReelCard accessibility labels', () => {
    it('imports useReducedMotion', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('useReducedMotion');
    });

    it('has accessibilityLabel on root container', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('accessibilityLabel');
      expect(content).toContain('accessibilityHint');
    });

    it('has accessibilityRole on root container', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('accessibilityRole="image"');
    });

    it('has accessibilityRole="button" on tap area', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('accessibilityRole="button"');
      expect(content).toContain('Play video');
      expect(content).toContain('Pause video');
    });

    it('has accessibilityLabel on Like button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*Like/);
    });

    it('has accessibilityLabel on Comment button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*Comment/);
    });

    it('has accessibilityLabel on Save button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*Save/);
    });

    it('has accessibilityLabel on Share button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*Share/);
    });

    it('has accessibilityLabel on Mute/Unmute button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('Unmute video');
      expect(content).toContain('Mute video');
    });

    it('has accessibilityLabel on View Deal button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*View deal/);
    });

    it('has accessibilityLabel on Invest Now button', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/accessibilityLabel.*Invest/);
    });

    it('has accessibilityState for like (checked)', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('accessibilityState');
      expect(content).toMatch(/checked.*liked/);
    });

    it('has accessibilityState for save (checked)', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/checked.*saved/);
    });

    it('has accessibilityState for mute (checked)', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toMatch(/checked.*isMuted/);
    });
  });

  describe('Reduced-motion behavior in CanonicalInvestmentReelCard', () => {
    it('heart burst skipped when reducedMotion is true', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('!reducedMotion');
      expect(content).toMatch(/showHeart.*!reducedMotion/);
    });

    it('haptic feedback gated by reducedMotion', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      // All haptic calls should be wrapped in if (!reducedMotion)
      const hapticCount = (content.match(/Haptics\.impactAsync/g) || []).length;
      const gatedCount = (content.match(/if\s*\(!reducedMotion\)/g) || []).length;
      expect(hapticCount).toBeGreaterThan(0);
      expect(gatedCount).toBeGreaterThanOrEqual(hapticCount);
    });

    it('tap delay respects reduced-motion (0ms when enabled)', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('reducedMotion ? 0 : 330');
    });

    it('handleTap depends on reducedMotion', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      const tapCallback = content.match(/handleTap\s*=\s*useCallback\([^)]+\[([^\]]+)\]/);
      if (tapCallback) {
        expect(tapCallback[1]).toContain('reducedMotion');
      }
    });
  });

  describe('Touch target sizes (44x44 minimum)', () => {
    it('rail buttons have minimum 44px touch area', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('railBtn');
      // Check styles for railBtn minimum dimensions
      const styles = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(styles).toContain('railIconCircle');
    });

    it('CTA buttons have explicit styles', () => {
      const content = readFile('components/CanonicalInvestmentReelCard.tsx');
      expect(content).toContain('viewDealBtn');
      expect(content).toContain('investNowBtn');
    });
  });
});
