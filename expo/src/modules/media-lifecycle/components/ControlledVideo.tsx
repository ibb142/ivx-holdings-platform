/**
 * ControlledVideo — single-source-of-truth video lifecycle wrapper.
 *
 * Enforces the controller's decisions:
 *   - only the primary visible video plays
 *   - visible-but-not-primary videos are prepared but paused
 *   - nearby videos are mounted with poster only
 *   - far-off videos are unmounted to release decoder resources
 *
 * Wraps the existing SafeVideo component for playback stability.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { ResizeMode } from 'expo-av';
import SafeVideo from '@/components/SafeVideo';
import { useMediaLifecycleItem, useMediaLifecycleRegister } from '../hooks';
import { mediaLifecycleController } from '../controller';
import type { MediaScope } from '../types';

interface ControlledVideoProps {
  mediaId: string;
  scope: MediaScope;
  module: string;
  uri: string | null;
  posterUri?: string | null;
  hlsUri?: string | null;
  postId?: string | null;
  messageId?: string | null;
  style?: React.ComponentProps<typeof View>['style'];
  resizeMode?: 'cover' | 'contain' | 'stretch';
  isLooping?: boolean;
  isMuted?: boolean;
  onProgress?: (progress: number) => void;
  testID?: string;
}

export const ControlledVideo: React.FC<ControlledVideoProps> = React.memo(function ControlledVideo({
  mediaId,
  scope,
  module,
  uri,
  posterUri,
  hlsUri,
  postId,
  messageId,
  style,
  resizeMode = 'cover',
  isLooping = true,
  isMuted = true,
  onProgress,
  testID,
}) {
  const generationRef = useRef(0);
  const uriRef = useRef(uri);

  useMediaLifecycleRegister(
    mediaId,
    scope,
    module,
    'video',
    uri,
    posterUri ?? null,
    hlsUri ?? null,
    postId ?? null,
    messageId ?? null,
  );

  const lifecycle = useMediaLifecycleItem(mediaId);
  const generation = lifecycle?.mountGeneration ?? 0;

  useEffect(() => {
    generationRef.current = generation;
  }, [generation]);

  useEffect(() => {
    // If the URI changes while this component is mounted, the cell may have
    // been recycled. Bump the generation so stale async responses are rejected.
    if (uriRef.current !== uri) {
      uriRef.current = uri;
      mediaLifecycleController.bumpGeneration(mediaId);
    }
  }, [uri, mediaId]);

  const lifecycleState = lifecycle?.lifecycleState ?? 'idle';
  const shouldMount = lifecycleState !== 'released' && lifecycleState !== 'idle';
  const shouldPlay = lifecycleState === 'active' && lifecycle?.isActive === true;
  const playerState = lifecycle?.playerState ?? 'none';

  useEffect(() => {
    const current = mediaLifecycleController.getItem(mediaId);
    if (!current) return;
    if (shouldPlay && current.playerState !== 'playing') {
      mediaLifecycleController.setPlayer(mediaId, 'playing');
    } else if (!shouldPlay && playerState === 'playing') {
      mediaLifecycleController.setPlayer(mediaId, 'paused');
    }
  }, [shouldPlay, mediaId, playerState]);

  if (!shouldMount) {
    return (
      <View style={[styles.container, style]} testID={testID ? `${testID}-poster` : undefined}>
        {posterUri ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        ) : null}
      </View>
    );
  }

  const expoResizeMode = resizeMode === 'contain' ? ResizeMode.CONTAIN : resizeMode === 'stretch' ? ResizeMode.STRETCH : ResizeMode.COVER;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <SafeVideo
        uri={uri}
        posterUri={posterUri}
        style={StyleSheet.absoluteFill}
        shouldPlay={shouldPlay}
        isMuted={isMuted}
        isLooping={isLooping}
        resizeMode={expoResizeMode}
        onProgress={onProgress}
        testID={testID ? `${testID}-player` : undefined}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
});
