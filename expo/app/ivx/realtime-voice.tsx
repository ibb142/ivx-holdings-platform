/**
 * IVX Realtime Voice Screen — ChatGPT-level voice conversation
 *
 * Full-duplex-like voice experience over WebSocket:
 *   - Push-to-talk: hold mic to speak, release to send
 *   - Live AI text streaming (token-by-token)
 *   - Progressive TTS audio playback (sentence-by-sentence)
 *   - Interrupt AI at any time (barge-in)
 *   - Conversation history with live transcript
 *
 * Powered by GPT-4o (same model as ChatGPT) via IVX backend WebSocket.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Mic, Square, X, Radio, Volume2, Zap, ChevronLeft } from 'lucide-react-native';
import { useRealtimeVoice, type RealtimeVoiceState } from '@/hooks/useRealtimeVoice';
import Colors from '@/constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STATE_LABELS: Record<RealtimeVoiceState, string> = {
  idle: 'Tap to speak',
  connecting: 'Connecting…',
  connected: 'Connected — tap to speak',
  recording: 'Listening…',
  listening: 'Processing…',
  speaking: 'AI speaking…',
  error: 'Connection error',
};

const STATE_COLORS: Record<RealtimeVoiceState, string> = {
  idle: Colors.muted,
  connecting: Colors.warning,
  connected: Colors.success,
  recording: Colors.primary,
  listening: Colors.warning,
  speaking: Colors.info,
  error: Colors.error,
};

export default function RealtimeVoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);

  const voice = useRealtimeVoice({
    voice: 'nova',
    onError: (msg) => console.error('[RealtimeVoice] Error:', msg),
  });

  // Auto-connect on mount
  useEffect(() => {
    voice.connect();
    return () => voice.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    if (voice.conversation.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [voice.conversation]);

  // ── Animated pulse for recording/speaking ───────────────────────────────────

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const isActive = voice.state === 'recording' || voice.state === 'speaking';
    if (!isActive) {
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }).start();
      Animated.timing(ringAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );

    const ringLoop = Animated.loop(
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
    );

    pulseLoop.start();
    ringLoop.start();

    return () => {
      pulseLoop.stop();
      ringLoop.stop();
    };
  }, [voice.state, pulseAnim, ringAnim]);

  // ── Button handlers ──────────────────────────────────────────────────────────

  const handleMicPress = useCallback(async () => {
    if (voice.state === 'recording') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await voice.stopRecording();
    } else if (voice.isConnected) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await voice.startRecording();
    }
  }, [voice]);

  const handleInterrupt = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    voice.interrupt();
  }, [voice]);

  const handleClose = useCallback(() => {
    voice.disconnect();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home' as never);
    }
  }, [voice, router]);

  const isRecording = voice.state === 'recording';
  const isSpeaking = voice.state === 'speaking';
  const isProcessing = voice.state === 'listening' || voice.state === 'connecting';
  const canInterrupt = isSpeaking || voice.state === 'listening';
  const stateColor = STATE_COLORS[voice.state] || Colors.muted;
  const stateLabel = STATE_LABELS[voice.state] || 'Ready';

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={handleClose} style={styles.headerButton} hitSlop={12}>
          <ChevronLeft size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.statusDot, { backgroundColor: voice.isConnected ? Colors.success : Colors.muted }]} />
          <Text style={styles.headerTitle}>IVX Voice</Text>
        </View>
        <Pressable
          onPress={() => voice.clearConversation()}
          style={styles.headerButton}
          hitSlop={12}
          accessibilityLabel="Clear conversation"
        >
          <X size={20} color={Colors.text} />
        </Pressable>
      </View>

      {/* ── Connection banner ── */}
      {!voice.isConnected && voice.state !== 'error' && (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={Colors.warning} />
          <Text style={styles.bannerText}>Connecting to IVX voice server…</Text>
        </View>
      )}

      {voice.error && (
        <View style={[styles.banner, styles.errorBanner]}>
          <Text style={styles.bannerText}>{voice.error}</Text>
          <Pressable onPress={() => voice.connect()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── Conversation transcript ── */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.conversation}
        contentContainerStyle={styles.conversationContent}
        showsVerticalScrollIndicator={false}
      >
        {voice.conversation.length === 0 && (
          <View style={styles.emptyState}>
            <Radio size={48} color={Colors.muted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Real-time Voice</Text>
            <Text style={styles.emptySubtitle}>
              Hold the mic button and speak naturally. The AI will respond with voice
              and text in real-time. You can interrupt at any time.
            </Text>
            <View style={styles.capabilityRow}>
              <View style={styles.capability}>
                <Zap size={14} color={Colors.primary} />
                <Text style={styles.capabilityText}>GPT-4o</Text>
              </View>
              <View style={styles.capability}>
                <Volume2 size={14} color={Colors.info} />
                <Text style={styles.capabilityText}>Streaming TTS</Text>
              </View>
              <View style={styles.capability}>
                <Mic size={14} color={Colors.success} />
                <Text style={styles.capabilityText}>Push-to-talk</Text>
              </View>
            </View>
          </View>
        )}

        {voice.conversation.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.messageBubble,
              msg.role === 'user' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                msg.role === 'user' ? styles.userText : styles.aiText,
              ]}
            >
              {msg.content}
            </Text>
          </View>
        ))}

        {/* Live AI streaming text */}
        {voice.aiResponse.length > 0 && (
          <View style={[styles.messageBubble, styles.aiBubble, styles.streamingBubble]}>
            <Text style={[styles.messageText, styles.aiText]}>
              {voice.aiResponse}
              <Text style={styles.cursor}>▌</Text>
            </Text>
          </View>
        )}

        {/* Processing indicator */}
        {isProcessing && voice.aiResponse.length === 0 && (
          <View style={styles.processingRow}>
            <ActivityIndicator size="small" color={stateColor} />
            <Text style={[styles.processingText, { color: stateColor }]}>{stateLabel}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Voice orb + controls ── */}
      <View style={styles.controlArea}>
        {/* State label */}
        <Text style={[styles.stateLabel, { color: stateColor }]}>{stateLabel}</Text>

        {/* Animated voice orb */}
        <View style={styles.orbContainer}>
          {/* Expanding ring */}
          {isRecording && (
            <Animated.View
              style={[
                styles.orbRing,
                {
                  opacity: ringAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 0],
                  }),
                  transform: [{
                    scale: ringAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 2.5],
                    }),
                  }],
                },
              ]}
            />
          )}

          {/* Pulse glow when speaking */}
          {isSpeaking && (
            <Animated.View
              style={[
                styles.orbGlow,
                {
                  opacity: pulseAnim.interpolate({
                    inputRange: [1, 1.15],
                    outputRange: [0.3, 0.6],
                  }),
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            />
          )}

          {/* Main mic button */}
          <Animated.View
            style={[
              styles.orbWrapper,
              {
                transform: isRecording || isSpeaking
                  ? [{ scale: pulseAnim }]
                  : [{ scale: 1 }],
              },
            ]}
          >
            <Pressable
              onPress={handleMicPress}
              style={[
                styles.orb,
                { backgroundColor: isRecording ? stateColor : Colors.surface },
                isRecording && styles.orbRecording,
              ]}
              disabled={!voice.isConnected && voice.state !== 'recording'}
              accessibilityLabel={isRecording ? 'Stop recording' : 'Start speaking'}
              accessibilityRole="button"
            >
              {isRecording ? (
                <Square size={32} color={Colors.white} fill={Colors.white} />
              ) : isProcessing ? (
                <ActivityIndicator size="large" color={stateColor} />
              ) : (
                <Mic size={36} color={voice.isConnected ? Colors.text : Colors.muted} />
              )}
            </Pressable>
          </Animated.View>
        </View>

        {/* Secondary controls */}
        <View style={styles.secondaryControls}>
          {canInterrupt ? (
            <Pressable
              onPress={handleInterrupt}
              style={styles.interruptButton}
              hitSlop={12}
              accessibilityLabel="Interrupt AI"
            >
              <Text style={styles.interruptText}>Tap to interrupt</Text>
            </Pressable>
          ) : (
            <View style={styles.hintRow}>
              <Text style={styles.hintText}>
                {isRecording ? 'Release to send' : 'Hold mic to speak'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  bannerText: {
    fontSize: 13,
    color: Colors.text,
  },
  retryText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  conversation: {
    flex: 1,
    paddingHorizontal: 16,
  },
  conversationContent: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  capabilityRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  capability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
  },
  capabilityText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.text,
  },
  messageBubble: {
    maxWidth: SCREEN_WIDTH * 0.82,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
  },
  streamingBubble: {
    borderWidth: 0.5,
    borderColor: Colors.info,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  userText: {
    color: Colors.white,
  },
  aiText: {
    color: Colors.text,
  },
  cursor: {
    color: Colors.info,
    fontWeight: '700',
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  processingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  controlArea: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  stateLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  orbContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary,
  },
  orbGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.info,
  },
  orbWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  orbRecording: {
    borderColor: Colors.white,
    borderWidth: 3,
  },
  secondaryControls: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintRow: {
    alignItems: 'center',
  },
  hintText: {
    fontSize: 13,
    color: Colors.muted,
  },
  interruptButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  interruptText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.error,
  },
});
