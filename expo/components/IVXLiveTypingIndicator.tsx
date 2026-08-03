import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type IVXLiveTypingIndicatorProps = {
  baseText: string;
  speedMs?: number;
};

export function IVXLiveTypingIndicator({ baseText, speedMs = 30 }: IVXLiveTypingIndicatorProps) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    const interval = setInterval(() => {
      setRevealed((prev) => {
        if (prev >= baseText.length) {
          clearInterval(interval);
          return baseText.length;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => clearInterval(interval);
  }, [baseText, speedMs]);

  return (
    <View style={styles.container} testID="ivx-owner-chat-live-typing">
      <Text style={styles.text}>
        {baseText.slice(0, revealed)}
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
