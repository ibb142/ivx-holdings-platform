import React, { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const HomeScreenContent = lazy(() => import('@/components/HomeScreenContent'));

type HomeBoundaryState = { error: Error | null };

class HomeRouteBoundary extends Component<{ children: ReactNode }, HomeBoundaryState> {
  state: HomeBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): HomeBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[HomeRouteBoundary] Owner home failed:', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container} testID="owner-home-error">
          <Text style={styles.title}>Owner Home needs to reload</Text>
          <Text style={styles.message}>IVX caught a Home module error instead of showing a black screen.</Text>
          <Text style={styles.detail}>{this.state.error.message}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => this.setState({ error: null })}
            style={styles.button}
            testID="owner-home-retry"
          >
            <Text style={styles.buttonText}>Reload Owner Home</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

function HomeLoading() {
  return (
    <View style={styles.container} testID="owner-home-loading">
      <Text style={styles.brand}>IVX HOLDINGS</Text>
      <ActivityIndicator color="#FFD700" size="large" />
      <Text style={styles.message}>Opening Owner Home…</Text>
    </View>
  );
}

export default function HomeRoute() {
  return (
    <HomeRouteBoundary>
      <Suspense fallback={<HomeLoading />}>
        <HomeScreenContent />
      </Suspense>
    </HomeRouteBoundary>
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
    fontWeight: '900',
    letterSpacing: 1,
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
