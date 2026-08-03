/**
 * Optimized image component with caching, placeholder, retry, and thumbnail-first loading.
 *
 * Features:
 * - Thumbnail-first progressive loading (low-res → high-res)
 * - Fixed dimensions to prevent layout shift
 * - Memory + disk cache via React Native Image cache policy
 * - Retry failed media (up to 3 attempts with backoff)
 * - Placeholder image with first-letter fallback
 * - Fade-in animation on load
 * - Memoized to prevent unnecessary re-renders
 * - No full-resolution image in list views (use thumbnail prop)
 */
import React, { useState, memo, useCallback, useRef, useEffect } from 'react';
import {View, Text, StyleSheet, Image as RNImage, Animated, Platform } from "react-native";
import Colors from '@/constants/colors';

type OptimizedImageProps = {
  /** Full-resolution image URI */
  uri?: string;
  /** Optional thumbnail URI — loaded first, then replaced by full image */
  thumbnailUri?: string;
  /** Fixed width — prevents layout shift */
  width?: number;
  /** Fixed height — prevents layout shift */
  height?: number;
  style?: any;
  borderRadius?: number;
  placeholderText?: string;
  resizeMode?: 'cover' | 'contain' | 'stretch';
  priority?: 'low' | 'normal' | 'high';
  cachePolicy?: 'none' | 'memory' | 'memory-disk';
  /** Maximum retry attempts on load failure */
  maxRetries?: number;
  testID?: string;
};

const _loadedUrls = new Set<string>();
const MAX_LOADED_CACHE = 300;

function markLoaded(uri: string): void {
  if (_loadedUrls.size >= MAX_LOADED_CACHE) {
    const first = _loadedUrls.values().next().value;
    if (first) _loadedUrls.delete(first);
  }
  _loadedUrls.add(uri);
}

function OptimizedImageImpl({
  uri,
  thumbnailUri,
  width,
  height,
  style,
  borderRadius = 12,
  placeholderText,
  resizeMode = 'cover',
  priority = 'normal',
  cachePolicy = 'memory-disk',
  maxRetries = 3,
  testID}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [showThumbnail, setShowThumbnail] = useState<boolean>(!!thumbnailUri);
  const [currentUri, setCurrentUri] = useState<string | undefined>(thumbnailUri ?? uri);
  const fadeAnim = useRef(new Animated.Value(_loadedUrls.has(currentUri ?? '') ? 1 : 0)).current;
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // When uri changes, reset state
  useEffect(() => {
    setShowThumbnail(!!thumbnailUri);
    setCurrentUri(thumbnailUri ?? uri);
    setLoaded(false);
    setFailed(false);
    setRetryCount(0);
  }, [uri, thumbnailUri]);

  const handleLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setLoaded(true);
    if (currentUri) markLoaded(currentUri);

    // If we were showing thumbnail, now switch to full image
    if (showThumbnail && thumbnailUri && uri && uri !== thumbnailUri) {
      setShowThumbnail(false);
      setCurrentUri(uri);
      setLoaded(false);
    } else {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web'}).start();
    }
  }, [currentUri, showThumbnail, thumbnailUri, uri, fadeAnim]);

  const handleError = useCallback(() => {
    if (!mountedRef.current) return;
    if (retryCount < maxRetries) {
      const delay = Math.min(500 * Math.pow(2, retryCount), 3000);
      console.log(`[OptimizedImage] Retry ${retryCount + 1}/${maxRetries} in ${delay}ms:`, currentUri?.substring(0, 80));
      setTimeout(() => {
        if (!mountedRef.current) return;
        setRetryCount(prev => prev + 1);
        // Force cache-busting reload by appending a retry param
        const separator = currentUri?.includes('?') ? '&' : '?';
        setCurrentUri(`${currentUri}${separator}retry=${retryCount + 1}`);
      }, delay);
    } else {
      setFailed(true);
      console.log('[OptimizedImage] Max retries exceeded:', currentUri?.substring(0, 80));
    }
  }, [retryCount, maxRetries, currentUri]);

  // Placeholder for missing URI or permanent failure
  if (!currentUri || (failed && !showThumbnail)) {
    return (
      <View
        style={[styles.placeholder, style, { width, height, borderRadius }]}
        testID={testID ? `${testID}-placeholder` : undefined}
      >
        <Text style={styles.placeholderText}>
          {placeholderText?.charAt(0)?.toUpperCase() ?? '?'}
        </Text>
      </View>
    );
  }

  const containerStyle = [
    style,
    { width, height, borderRadius, overflow: 'hidden' as const },
  ];

  return (
    <View style={containerStyle} testID={testID}>
      {!loaded && (
        <View style={[styles.loadingOverlay, { width, height, borderRadius }]}>
          {/* Instagram-style: subtle shimmer surface, no spinner */}
        </View>
      )}
      <Animated.Image
        source={{
          uri: currentUri,
          cache: cachePolicy === 'memory-disk' ? 'force-cache' : 'reload'}}
        style={[StyleSheet.absoluteFill, { borderRadius, opacity: loaded ? fadeAnim : 0 }]}
        resizeMode={resizeMode}
        onLoad={handleLoad}
        onError={handleError}
        progressiveRenderingEnabled={true}
        accessible={true}
        accessibilityLabel={placeholderText ?? 'Image'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center'},
  placeholderText: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.textTertiary},
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1}});

export const OptimizedImage = memo(OptimizedImageImpl);
export default OptimizedImage;
