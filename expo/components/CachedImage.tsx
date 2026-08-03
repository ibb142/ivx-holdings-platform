import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {Image,
  View,
  StyleSheet,
  Animated,
  Platform,
  ImageStyle,
  ViewStyle,
  ImageResizeMode} from "react-native";

const _memoryCache = new Map<string, boolean>();
const _prefetchQueue: string[] = [];
let _prefetchTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_CACHE_SIZE = 200;

function addToCache(uri: string): void {
  if (_memoryCache.size >= MAX_CACHE_SIZE) {
    const first = _memoryCache.keys().next().value;
    if (first) _memoryCache.delete(first);
  }
  _memoryCache.set(uri, true);
}

export function prefetchImages(urls: string[]): void {
  const toPrefetch = urls.filter(u => u && u.startsWith('http') && !_memoryCache.has(u));
  _prefetchQueue.push(...toPrefetch);

  if (_prefetchTimer) return;
  _prefetchTimer = setTimeout(() => {
    _prefetchTimer = null;
    const batch = _prefetchQueue.splice(0, 6);
    batch.forEach(uri => {
      Image.prefetch(uri)
        .then(() => {
          addToCache(uri);
        })
        .catch(() => {});
    });
    if (_prefetchQueue.length > 0) {
      prefetchImages([]);
    }
  }, 50);
}

interface CachedImageProps {
  uri: string;
  style?: ImageStyle | ImageStyle[];
  containerStyle?: ViewStyle;
  resizeMode?: ImageResizeMode;
  fadeDuration?: number;
  showLoader?: boolean;
  placeholderColor?: string;
  testID?: string;
}

const CachedImage = React.memo(function CachedImage({
  uri,
  style,
  containerStyle,
  resizeMode = 'cover',
  fadeDuration = 250,
  showLoader = true,
  placeholderColor = '#1a1a2e',
  testID}: CachedImageProps) {
  const isCached = _memoryCache.has(uri);
  const fadeAnim = useRef(new Animated.Value(isCached ? 1 : 0)).current;
  const [loading, setLoading] = useState(!isCached);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const onLoadEnd = useCallback(() => {
    if (!mountedRef.current) return;
    addToCache(uri);
    setLoading(false);
    if (!isCached) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: fadeDuration,
        useNativeDriver: Platform.OS !== 'web'}).start();
    }
  }, [uri, isCached, fadeAnim, fadeDuration]);

  const onError = useCallback(() => {
    if (!mountedRef.current) return;
    setLoading(false);
    setError(true);
    console.log('[CachedImage] Load failed:', uri?.substring(0, 80));
  }, [uri]);

  if (!uri || error) {
    return (
      <View style={[styles.placeholder, { backgroundColor: placeholderColor }, containerStyle, style as ViewStyle]} testID={testID}>
        <View style={styles.errorIcon}>
          <View style={styles.errorLine} />
          <View style={[styles.errorLine, styles.errorLineRotated]} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      {loading && showLoader && (
        <View style={[styles.loaderWrap, { backgroundColor: placeholderColor }]}>
          <ShimmerIndicator size="small" color="#ffffff40" />
        </View>
      )}
      <Animated.Image
        source={{ uri, cache: 'force-cache' }}
        style={[style, { opacity: fadeAnim }]}
        resizeMode={resizeMode}
        onLoadEnd={onLoadEnd}
        onError={onError}
        progressiveRenderingEnabled={true}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden'},
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center'},
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1},
  errorIcon: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center'},
  errorLine: {
    position: 'absolute' as const,
    width: 20,
    height: 2,
    backgroundColor: '#ffffff30',
    borderRadius: 1,
    transform: [{ rotate: '45deg' }]},
  errorLineRotated: {
    transform: [{ rotate: '-45deg' }]}});

export default CachedImage;
