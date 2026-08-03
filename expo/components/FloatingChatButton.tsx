import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MessageCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';

const HIDE_ON_PATH_FRAGMENTS = ['/chat', '/ivx/chat', '/chat-hub'] as const;

/**
 * Always-visible floating chat launcher (WhatsApp-style) that opens the IVX AI
 * Chat tab from anywhere in the app. Hidden on the chat screens themselves so it
 * never overlaps the active conversation.
 */
export default function FloatingChatButton(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true}),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true}),
        Animated.delay(1600),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const isHidden = HIDE_ON_PATH_FRAGMENTS.some((fragment) =>
    (pathname ?? '').includes(fragment)
  );

  if (isHidden) {
    return null;
  }

  const handlePressIn = (): void => {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0}).start();
  };

  const handlePressOut = (): void => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8}).start();
  };

  const handlePress = (): void => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/(tabs)/chat' as never);
  };

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.4]});
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0]});

  const bottomOffset = Math.max(insets.bottom, 12) + 78;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottomOffset }]}
    >
      <View pointerEvents="box-none" style={styles.anchor}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulse,
            { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
          ]}
        />
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open IVX AI chat"
            testID="floating-chat-button"
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={styles.button}
          >
            <MessageCircle size={26} color={Colors.black} strokeWidth={2.5} />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>AI</Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 18,
    left: 0,
    alignItems: 'flex-end',
    paddingRight: 0},
  anchor: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 18},
  pulse: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary},
  button: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10},
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.black,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4},
  badgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '800' as const}});
