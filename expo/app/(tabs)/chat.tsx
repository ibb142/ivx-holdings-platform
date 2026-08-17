import React, { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const ChatScreenContent = lazy(() => import('@/components/ChatScreenContent'));

type ChatRouteBoundaryProps = { children: ReactNode };
type ChatRouteBoundaryState = { error: Error | null; retryKey: number };

class ChatRouteBoundary extends Component<ChatRouteBoundaryProps, ChatRouteBoundaryState> {
  state: ChatRouteBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ChatRouteBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChatRouteBoundary] Chat module failed to render:', error.message, info.componentStack);
  }

  private retry = () => {
    this.setState(({ retryKey }) => ({ error: null, retryKey: retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container} testID="chat-route-error">
          <Text style={styles.title}>Chat is temporarily unavailable</Text>
          <Text style={styles.message}>The rest of IVX is still available. Retry the chat module below.</Text>
          <Text style={styles.detail}>{this.state.error.message}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={this.retry}
            style={styles.button}
            testID="chat-route-retry"
          >
            <Text style={styles.buttonText}>Retry Chat</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

function ChatRouteLoading() {
  return (
    <View style={styles.container} testID="chat-route-loading">
      <Text style={styles.brand}>IVX Holdings</Text>
      <ActivityIndicator color="#FFD700" size="large" />
      <Text style={styles.message}>Opening Chat…</Text>
    </View>
  );
}

export default function ChatRoute() {
  return (
    <ChatRouteBoundary>
      <Suspense fallback={<ChatRouteLoading />}>
        <ChatScreenContent />
      </Suspense>
    </ChatRouteBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0F',
    padding: 24,
  },
  brand: {
    color: '#FFD700',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    color: '#A3A3A3',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 14,
  },
  detail: {
    color: '#777777',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 10,
  },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 13,
    marginTop: 22,
  },
  buttonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
