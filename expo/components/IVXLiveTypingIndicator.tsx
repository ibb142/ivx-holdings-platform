import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type IVXLiveTypingIndicatorProps = {
  baseText: string;
  speedMs?: number;
};

/**
 * Minimal static typing indicator for normal chat.
 *
 * Shows "IVX is typing..." as a single static line — NO character reveal,
 * NO fake typing animation. This is the ONLY loading state
 * visible during normal chat. It disappears when the first real response
 * delta arrives.
 */
export function IVXLiveTypingIndicator({ baseText }: IVXLiveTypingIndicatorProps) {
  return (
    <View style={styles.container} testID="ivx-owner-chat-live-typing">
      <Text style={styles.text}>
        {baseText}
        <Text style={styles.caret}>▋</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(246,200,95,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.28)',
    marginBottom: 4,
    alignSelf: 'flex-start',
    marginLeft: 12},
  text: {
    flex: 1,
    color: '#F6C85F',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginLeft: 4},
  caret: {
    color: '#F6C85F'}});
