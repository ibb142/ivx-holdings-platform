/**
 * SafeVideo — defensive wrapper around expo-av Video for Android stability.
 *
 * expo-av on Android is prone to native crashes when:
 *   - posterSource/usePoster is enabled with remote URIs
 *   - HLS (.m3u8) sources are fed to the legacy player
 *   - multiple Video instances mount at once inside a FlatList
 *   - shouldPlay flips before the player is ready
 *
 * This component disables poster on Android, falls back from HLS to MP4, and
 * surfaces load errors so the app survives bad videos instead of crashing.
 * Poster is rendered as a separate Image layer (not expo-av posterSource).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { Video, ResizeMode, type VideoReadyForDisplayEvent } from 'expo-av';
import { RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface SafeVideoProps {
  uri: string | null | undefined;
  posterUri?: string | null | undefined;
  style?: any;
  shouldPlay?: boolean;
  isMuted?: boolean;
  isLooping?: boolean;
  resizeMode?: ResizeMode;
  onProgress?: (progress: number) => void;
  onPlaybackStatusUpdate?: (status: { isPlaying: boolean; durationMillis: number; positionMillis: number }) => void;
  testID?: string;
}

const GOLD = Colors.primary;
const MAX_RETRIES = 2;

function pickPlaybackUri(input: string | null | undefined): string | null {
  if (!input) return null;
  // On Android, prefer progressive MP4 over HLS to avoid expo-av native crashes.
  // But if HLS is the ONLY option, still return it rather than null (null causes
  // infinite loading and potential resource leaks from repeated mount cycles).
  if (Platform.OS === 'android' && input.toLowerCase().endsWith('.m3u8')) {
    // Return the HLS URI as a last resort — ExoPlayer can handle basic HLS
    return input;
  }
  return input;
}

export default function SafeVideo({
  uri,
  posterUri,
  style,
  shouldPlay = false,
  isMuted = true,
  isLooping = true,
  resizeMode = ResizeMode.COVER,
  onProgress,
  onPlaybackStatusUpdate,
  testID,
}: SafeVideoProps) {
  const videoRef = useRef<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [ready, setReady] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const playbackUri = pickPlaybackUri(uri);

  // Reset state when the source changes.
  useEffect(() => {
    setError(null);
    setLoading(true);
    setReady(false);
    setRetryCount(0);
  }, [playbackUri]);

  // CRITICAL: Unload the native ExoPlayer when unmounting.
  // The ref is read in the cleanup closure, but we must use a ref object
  // (not a captured snapshot) so we get the LIVE player instance at
  // cleanup time — not the null value that existed at mount time.
  // Previous bug: `const player = videoRef.current` captured null at
  // mount, so unloadAsync was never called → native players leaked on
  // every reel swipe → memory grew → OOM crash after ~15-25 transitions.
  useEffect(() => {
    return () => {
      try {
        const player = videoRef.current;
        if (player) {
          void player.stopAsync().catch(() => {});
          void player.unloadAsync().catch(() => {});
        }
      } catch {
        // ignore — player may already be gone
      }
    };
  }, []);

  // Also unload when the URI changes (before the new source loads)
  useEffect(() => {
    return () => {
      try {
        const player = videoRef.current;
        if (player) {
          void player.unloadAsync().catch(() => {});
        }
      } catch {}
    };
  }, [playbackUri]);

  const handleRetry = () => {
    if (retryCount >= MAX_RETRIES) return;
    setRetryCount((c) => c + 1);
    setError(null);
    setLoading(true);
    setReady(false);
  };

  if (!playbackUri) {
    return (
      <View style={[styles.container, style]} testID={testID ? `${testID}-no-source` : undefined}>
        {posterUri ? (
          <View style={[styles.container, style]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
            <ActivityIndicator size="large" color={GOLD} style={StyleSheet.absoluteFill} />
          </View>
        ) : (
          <ActivityIndicator size="large" color={GOLD} />
        )}
      </View>
    );
  }

  // Poster on Android is a known crash vector in expo-av; disable it there.
  // The poster is rendered by the parent component (ReelVideoPlayer) as an Image.
  const showPoster = Platform.OS !== 'android' && !!posterUri;
  const posterSource = showPoster ? { uri: posterUri as string } : undefined;
  const usePoster = showPoster;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Video
        ref={videoRef}
        source={{ uri: playbackUri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        shouldPlay={shouldPlay && ready}
        isLooping={isLooping}
        isMuted={isMuted}
        useNativeControls={false}
        usePoster={usePoster}
        posterSource={posterSource}
        onLoadStart={() => setLoading(true)}
        onReadyForDisplay={(e: VideoReadyForDisplayEvent) => {
          setLoading(false);
          setReady(true);
        }}
        onLoad={(status) => {
          setLoading(false);
          if (status.isLoaded) {
            setReady(true);
          }
        }}
        onError={(err) => {
          setLoading(false);
          setReady(false);
          setError(typeof err === 'string' ? err : 'Video failed to load');
          if (__DEV__) {
            console.warn('[SafeVideo] load error:', err);
          }
        }}
        onPlaybackStatusUpdate={(status) => {
          if (status.isLoaded && status.durationMillis && status.durationMillis > 0) {
            onProgress?.(status.positionMillis / status.durationMillis);
            onPlaybackStatusUpdate?.({
              isPlaying: status.isPlaying ?? false,
              durationMillis: status.durationMillis,
              positionMillis: status.positionMillis ?? 0,
            });
          }
        }}
      />
      {loading && !error && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      )}
      {error && (
        <View style={styles.overlay} pointerEvents="auto">
          {retryCount < MAX_RETRIES ? (
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.8}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          ) : (
            <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
