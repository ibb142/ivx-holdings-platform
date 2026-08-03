import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { errorTracker } from '@/lib/error-tracking';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const errorInfo = info.componentStack?.slice(0, 500) || '';
    this.setState({ errorInfo });

    console.log('[ErrorBoundary] Caught render error:', error.message);
    console.log('[ErrorBoundary] Component stack:', errorInfo);

    try {
      errorTracker.captureError(error, 'fatal', {
        source: 'ErrorBoundary',
        componentStack: errorInfo.slice(0, 200)});
    } catch {
      console.log('[ErrorBoundary] Failed to report error to tracker');
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: '' });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <AlertTriangle size={32} color="#FF6B6B" />
            </View>
            <Text style={styles.title}>
              {this.props.fallbackTitle || 'Something went wrong'}
            </Text>
            <Text style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Text>
            {this.state.errorInfo ? (
              <ScrollView style={styles.stackScroll} horizontal={false}>
                <Text style={styles.stack} numberOfLines={6}>
                  {this.state.errorInfo.trim()}
                </Text>
              </ScrollView>
            ) : null}
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={this.handleReset}
              activeOpacity={0.8}
            >
              <RefreshCw size={16} color="#000" />
              <Text style={styles.resetBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24},
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FF6B6B15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  title: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    textAlign: 'center',
    marginBottom: 8},
  message: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16},
  stackScroll: {
    maxHeight: 100,
    width: '100%',
    marginBottom: 16,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10},
  stack: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16},
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14},
  resetBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700' as const}});
