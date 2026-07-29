/**
 * useReducedMotion — respects the operating-system reduce-motion setting.
 *
 * When enabled:
 *   - Disable unnecessary animations (heart burst, progress bar transitions)
 *   - Avoid aggressive autoplay transitions
 *   - Preserve manual playback controls (play/pause still works)
 *   - Respect the OS setting on both iOS and Android
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const enabled = await AccessibilityInfo.isReduceMotionEnabled();
        if (mounted) setReducedMotion(enabled);
      } catch {
        // If we can't query, default to false (animations enabled)
      }
    };
    void check();

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) setReducedMotion(enabled);
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
