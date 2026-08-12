/**
 * IVXImage — Canonical progressive image component built on expo-image.
 *
 * Features:
 * - Always shows a shimmer skeleton placeholder during load
 * - Progressive fade-in on load success
 * - Explicit error state with retry
 * - Stable aspect ratio (no layout shift when image loads)
 * - Memory-disk cache policy for fast repeat loads
 * - Prefetch support for near-viewport images
 * - Accessible labels for screen readers
 * - Works on both mobile and web
 *
 * This wraps expo-image with IVX brand styling and is the single canonical
 * image component all screens should use.
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Image as ExpoImage, type ImageContentFit, type ImageSource } from 'expo-image';
import {
  View,
  StyleSheet,
  Animated,
  Platform,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
  AccessibilityInfo,
} from 'react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

export interface IVXImageProps {
  /** Primary image URI. */
  uri: string | null | undefined;
  /** Optional thumbnail/low-res URI shown while full image loads. */
  thumbnailUri?: string | null;
  /** Aspect ratio (width/height). Use to prevent layout shift. */
  aspectRatio?: number;
  /** Width — if omitted, fills container. */
  width?: number | string;
  /** Height — if omitted, derived from aspectRatio or fills container. */
  height?: number | string;
  /** Content fit mode. */
  contentFit?: ImageContentFit;
  /** Transition duration in ms for fade-in. */
  transitionDuration?: number;
  /** Placeholder background color. */
  placeholderColor?: string;
  /** Whether to show the shimmer loader. Default true. */
  showLoader?: boolean;
  /** Accessible label for screen readers. */
  accessibilityLabel?: string;
  /** Test ID for automated testing. */
  testID?: string;
  /** Additional style for the container. */
  style?: StyleProp<ViewStyle>;
  /** Additional style for the image. */
  imageStyle?: StyleProp<ImageStyle>;
  /** Whether to prefetch the image on mount (default: false). */
  prefetch?: boolean;
  /** Blur radius for thumbnail transition (0 = no blur). */
  blurRadius?: number;
}

const IVXImage = React.memo(function IVXImage({
  uri,
  thumbnailUri,
  aspectRatio,
  width,
  height,
  contentFit = 'cover',
  transitionDuration = 250,
  placeholderColor = Colors.surface,
  showLoader = true,
  accessibilityLabel,
  testID,
  style,
  imageStyle,
  prefetch = false,
  blurRadius = 0,
}: IVXImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);
  const sourceKey = `${uri}-${retryCount}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset state when URI changes
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    fadeAnim.setValue(0);
  }, [uri, fadeAnim]);

  // Prefetch on mount if requested
  useEffect(() => {
    if (prefetch && uri && uri.startsWith('http')) {
      ExpoImage.prefetch([uri]).catch(() => {});
    }
  }, [uri, prefetch]);

  const handleLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setLoaded(true);
    setErrored(false);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: transitionDuration,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [fadeAnim, transitionDuration]);

  const handleError = useCallback(() => {
    if (!mountedRef.current) return;
    setErrored(true);
    setLoaded(false);
    console.log('[IVXImage] Load failed:', uri?.substring(0, 80));
  }, [uri]);

  const handleRetry = useCallback(() => {
    setErrored(false);
    setLoaded(false);
    fadeAnim.setValue(0);
    setRetryCount((c) => c + 1);
    AccessibilityInfo.announceForAccessibility('Retrying image load...');
  }, [fadeAnim]);

  // Determine the source to render
  const source: ImageSource | null = useMemo(() => {
    if (!uri) return null;
    return { uri };
  }, [uri, retryCount]);

  // Compute container style with aspect ratio
  const containerStyle: StyleProp<ViewStyle> = useMemo(() => {
    const base: ViewStyle = { overflow: 'hidden' as const };
    if (width != null) base.width = width as any;
    if (height != null) base.height = height as any;
    if (aspectRatio != null) {
      base.aspectRatio = aspectRatio;
      // If only width is set, aspect ratio determines height
      if (height == null) {
        base.height = undefined as any;
      }
    }
    return base;
  }, [width, height, aspectRatio]);

  // ─── No URI: show placeholder ──────────────────────────────────────
  if (!uri || (errored && !source)) {
    return (
      <View
        style={[styles.container, containerStyle, { backgroundColor: placeholderColor }, style]}
        testID={testID ? `${testID}-placeholder` : undefined}
        accessibilityLabel={errored ? 'Image failed to load' : 'No image'}
      >
        {errored ? (
          <TouchableOpacityOnRetry onRetry={handleRetry} testID={testID} />
        ) : null}
      </View>
    );
  }

  // ─── Error state with retry ────────────────────────────────────────
  if (errored) {
    return (
      <View
        style={[styles.container, containerStyle, { backgroundColor: placeholderColor }, style]}
        testID={testID ? `${testID}-error` : undefined}
        accessibilityLabel="Image failed to load. Tap to retry."
        accessibilityRole="button"
      >
        <TouchableOpacityOnRetry onRetry={handleRetry} testID={testID} />
      </View>
    );
  }

  // ─── Loading + Image ───────────────────────────────────────────────
  return (
    <View
      style={[styles.container, containerStyle, { backgroundColor: placeholderColor }, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    >
      {/* Thumbnail (blurred) shown while full image loads */}
      {thumbnailUri && !loaded && (
        <ExpoImage
          source={{ uri: thumbnailUri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          blurRadius={blurRadius || 15}
          cachePolicy="memory-disk"
          testID={testID ? `${testID}-thumb` : undefined}
        />
      )}
      {/* Shimmer loader */}
      {!loaded && showLoader && !thumbnailUri && (
        <View style={styles.loaderWrap} pointerEvents="none">
          <ShimmerIndicator size="small" color="#ffffff30" />
        </View>
      )}
      {/* Full-resolution image with fade-in */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}
        key={sourceKey}
      >
        <ExpoImage
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={loaded ? undefined : { duration: transitionDuration }}
          cachePolicy="memory-disk"
          onLoad={handleLoad}
          onError={handleError}
          testID={testID ? `${testID}-image` : undefined}
        />
      </Animated.View>
    </View>
  );
});

// ─── Small inline retry button for error states ──────────────────────

function TouchableOpacityOnRetry({ onRetry, testID }: { onRetry: () => void; testID?: string }) {
  return (
    <View
      style={styles.retryIcon}
      onTouchEnd={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Retry image load"
      testID={testID ? `${testID}-retry` : undefined}
    >
      <View style={styles.retryIconLine} />
      <View style={[styles.retryIconLine, styles.retryIconLineRotated]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden' as const,
    backgroundColor: Colors.surface,
  },
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 2,
  },
  retryIcon: {
    width: 36,
    height: 36,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  retryIconLine: {
    position: 'absolute' as const,
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  retryIconLineRotated: {
    transform: [{ rotate: '-45deg' }],
  },
});

export default IVXImage;
