/**
 * ControlledImage — progressive image loading under the IVX media lifecycle.
 *
 * Lifecycle:
 *   - FAR AWAY: no URI loaded (metadata only)
 *   - NEAR VIEWPORT: thumbnail/poster prefetched
 *   - VISIBLE: full-resolution image loaded
 *   - OFF SCREEN: keep cached image but stop new loads
 *
 * Uses expo-image for high-performance decoding and memory management.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, type ImageContentFit, type ImageSource } from 'expo-image';
import { View, StyleSheet } from 'react-native';
import { useMediaLifecycleItem, useMediaLifecycleRegister, useMediaLifecycleStore } from '../hooks';
import { mediaLifecycleController } from '../controller';
import type { MediaScope } from '../types';

interface ControlledImageProps {
  mediaId: string;
  scope: MediaScope;
  module: string;
  sourceUrl: string | null;
  thumbnailUrl?: string | null;
  fullResolutionUrl?: string | null;
  postId?: string | null;
  messageId?: string | null;
  style?: React.ComponentProps<typeof Image>['style'];
  contentFit?: ImageContentFit;
  transitionDuration?: number;
  placeholderColor?: string;
  testID?: string;
}

export const ControlledImage: React.FC<ControlledImageProps> = React.memo(function ControlledImage({
  mediaId,
  scope,
  module,
  sourceUrl,
  thumbnailUrl,
  fullResolutionUrl,
  postId,
  messageId,
  style,
  contentFit = 'cover',
  transitionDuration = 200,
  placeholderColor = '#111',
  testID,
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const generationRef = useRef(0);

  useMediaLifecycleRegister(
    mediaId,
    scope,
    module,
    'image',
    sourceUrl,
    thumbnailUrl ?? null,
    fullResolutionUrl ?? null,
    postId ?? null,
    messageId ?? null,
  );

  const lifecycle = useMediaLifecycleItem(mediaId);
  const generation = useMediaLifecycleStore((state) => state.items[mediaId]?.mountGeneration ?? 0);

  useEffect(() => {
    generationRef.current = generation;
  }, [generation]);

  const visible = lifecycle?.visibilityPercent ? lifecycle.visibilityPercent > 0 : false;
  const readyOrVisible = lifecycle?.lifecycleState === 'ready' || lifecycle?.lifecycleState === 'visible' || visible;

  const activeSource = useMemo<ImageSource | null>(() => {
    if (readyOrVisible && fullResolutionUrl) return { uri: fullResolutionUrl };
    if (readyOrVisible && sourceUrl) return { uri: sourceUrl };
    if (thumbnailUrl) return { uri: thumbnailUrl };
    return null;
  }, [readyOrVisible, fullResolutionUrl, sourceUrl, thumbnailUrl]);

  const handleLoadStart = () => {
    mediaLifecycleController.setLoadStarted(mediaId);
  };

  const handleSuccess = () => {
    const current = mediaLifecycleController.getItem(mediaId);
    if (!current || current.mountGeneration !== generationRef.current) return;
    mediaLifecycleController.setCache(mediaId, 'memory');
    mediaLifecycleController.setDownload(mediaId, 'loaded');
    setLoaded(true);
    setLoadError(null);
  };

  const handleError = (error: unknown) => {
    const current = mediaLifecycleController.getItem(mediaId);
    if (!current || current.mountGeneration !== generationRef.current) return;
    const message = error instanceof Error ? error.message : 'Image failed';
    mediaLifecycleController.setError(mediaId, message);
    mediaLifecycleController.setDownload(mediaId, 'error');
    setLoadError(message);
  };

  if (!activeSource) {
    return (
      <View style={[styles.container, style]} testID={testID ? `${testID}-placeholder` : undefined}>
        <View style={[styles.container, { backgroundColor: placeholderColor }]} />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Image
        source={activeSource}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={loaded ? { duration: transitionDuration } : undefined}
        onLoadStart={handleLoadStart}
        onLoad={handleSuccess}
        onError={handleError}
        cachePolicy="memory-disk"
        testID={testID ? `${testID}-image` : undefined}
      />
      {!loaded && !loadError && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: placeholderColor }]} pointerEvents="none" />
      )}
      {loadError && (
        <View style={[StyleSheet.absoluteFill, styles.errorOverlay]} pointerEvents="none">
          <View style={styles.errorChip} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  errorOverlay: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorChip: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
});
