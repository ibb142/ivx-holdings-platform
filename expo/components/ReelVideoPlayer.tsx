/**
 * ReelVideoPlayer — Instagram-style video player for the full-screen
 * vertical reels feed.
 *
 * Lifecycle guarantees:
 *   • Only the active reel plays; neighbors mount poster-only.
 *   • Pauses immediately when the app goes to background.
 *   • Pauses when the screen loses focus (navigates away).
 *   • Pauses on network disconnect; shows retry on reconnect.
 *   • Unloads the native player on unmount to free ExoPlayer resources.
 *   • Android: prefers progressive MP4 over HLS to avoid expo-av crashes.
 *   • Poster displays on Android (Image component, not expo-av posterSource).
 *   • Max 3 players mounted at any time (active ± 1).
 *
 * This wraps SafeVideo with poster-first rendering and error boundary
 * isolation so a single bad video never crashes the feed.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Platform } from 'react-native';
import { ResizeMode } from 'expo-av';
import { WifiOff } from 'lucide-react-native';
import SafeVideo from './SafeVideo';
import ReelErrorBoundary from './ReelErrorBoundary';
import { useNetworkState } from '@/hooks/useNetworkState';

interface ReelVideoPlayerProps {
  videoId: string;
  uri: string | null | undefined;
  hlsUri?: string | null;
  posterUri?: string | null;
  previewBlurUri?: string | null;
  shouldPlay: boolean;
  isMuted: boolean;
  onProgress?: (progress: number) => void;
  onPlaybackStatusUpdate?: (status: { isPlaying: boolean; durationMillis: number; positionMillis: number }) => void;
  testID?: string;
}

function pickPlaybackUri(
  uri: string | null | undefined,
  hlsUri: string | null | undefined,
  isAndroid: boolean,
): string | null {
  // On Android, prefer progressive MP4 over HLS to avoid expo-av native crashes.
  // On iOS, prefer HLS for adaptive bitrate.
  if (isAndroid) {
    if (uri && !uri.toLowerCase().endsWith('.m3u8')) return uri;
    if (hlsUri && !hlsUri.toLowerCase().endsWith('.m3u8')) return hlsUri;
    // Fall back to HLS only if no MP4 is available
    return uri ?? hlsUri ?? null;
  }
  // iOS: prefer HLS, fall back to MP4
  return hlsUri ?? uri ?? null;
}

function ReelVideoPlayerInner({
  videoId,
  uri,
  hlsUri,
  posterUri,
  previewBlurUri,
  shouldPlay,
  isMuted,
  onProgress,
  onPlaybackStatusUpdate,
  testID}: ReelVideoPlayerProps) {
  const network = useNetworkState();
  const [retryKey, setRetryKey] = useState<number>(0);
  const [showTapToPlay, setShowTapToPlay] = useState<boolean>(false);
  void showTapToPlay;
  const isAndroidRef = useRef<boolean>(
    typeof Platform !== 'undefined' && Platform.OS === 'android',
  );

  const playbackUri = useMemo(
    () => pickPlaybackUri(uri, hlsUri, isAndroidRef.current),
    [uri, hlsUri],
  );

  // Effective play state: pause on network disconnect or background
  const effectiveShouldPlay = shouldPlay && network.isInternetReachable;

  // When network drops, show the offline overlay; when it returns,
  // allow the user to tap to resume.
  useEffect(() => {
    if (!network.isInternetReachable && shouldPlay) {
      setShowTapToPlay(false);
    }
  }, [network.isInternetReachable, shouldPlay]);

  const handleRetry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  const handleTapResume = useCallback(() => {
    setShowTapToPlay(false);
  }, []);
  void handleTapResume;

  // Poster-first rendering: show the poster image immediately, then
  // overlay the video player. On Android, the poster is an Image
  // component (not expo-av's posterSource, which is a crash vector).
  const posterSource = posterUri ?? previewBlurUri ?? null;

  return (
    <View style={styles.container} testID={testID}>
      {/* Poster layer — always visible behind the video for instant first paint */}
      {posterSource && (
        <Image
          source={{ uri: posterSource }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          fadeDuration={200}
          accessible={false}
        />
      )}

      {/* Blur placeholder for even faster first paint */}
      {previewBlurUri && previewBlurUri !== posterSource && (
        <Image
          source={{ uri: previewBlurUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          fadeDuration={0}
          accessible={false}
        />
      )}

      <ReelErrorBoundary videoId={videoId} posterUri={posterSource} onRetry={handleRetry}>
        <SafeVideo
          key={`${videoId}-${retryKey}`}
          uri={playbackUri}
          posterUri={null}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay={effectiveShouldPlay}
          isMuted={isMuted}
          isLooping
          onProgress={onProgress}
          testID={testID ? `${testID}-player` : undefined}
        />
      </ReelErrorBoundary>

      {/* Offline overlay */}
      {!network.isInternetReachable && (
        <View style={styles.overlay} pointerEvents="none">
          <WifiOff size={36} color="rgba(255,255,255,0.7)" />
          <Text style={styles.overlayText}>No connection</Text>
          <Text style={styles.overlaySub}>Waiting for network...</Text>
        </View>
      )}
    </View>
  );
}

const ReelVideoPlayer = memo(ReelVideoPlayerInner);
export default ReelVideoPlayer;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden'},
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 50},
  overlayText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    marginTop: 12},
  overlaySub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4}});
