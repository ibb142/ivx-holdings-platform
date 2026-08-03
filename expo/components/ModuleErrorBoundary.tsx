/**
 * ModuleErrorBoundary — per-module crash isolation.
 *
 * Wraps individual screen sections (Reels, Members, Projects, Deals) so a
 * crash in one module shows a retry button for that section instead of
 * crashing the entire application.
 *
 * Error categories: AUTH_ERROR, NETWORK_ERROR, DATA_ERROR, RENDER_ERROR,
 * CONFIG_ERROR, UNKNOWN_ERROR
 */
import React, { Component, type ReactNode } from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from "react-native";
import { RefreshCw, AlertCircle } from 'lucide-react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type ErrorCategory =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'DATA_ERROR'
  | 'RENDER_ERROR'
  | 'CONFIG_ERROR'
  | 'UNKNOWN_ERROR';

interface Props {
  moduleName: string;
  children: ReactNode;
  /** Optional fallback render when no error */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  category: ErrorCategory;
  traceId: string | null;
}

function classifyError(error: Error): ErrorCategory {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('maximum update depth') || msg.includes('render')) return 'RENDER_ERROR';
  if (msg.includes('auth') || msg.includes('session') || msg.includes('token')) return 'AUTH_ERROR';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return 'NETWORK_ERROR';
  if (msg.includes('supabase url') || msg.includes('config')) return 'CONFIG_ERROR';
  if (msg.includes('data') || msg.includes('parse') || msg.includes('json')) return 'DATA_ERROR';
  return 'UNKNOWN_ERROR';
}

function generateTraceId(): string {
  return 'IVX-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

const CATEGORY_MESSAGES: Record<ErrorCategory, string> = {
  AUTH_ERROR: 'Authentication required. Please sign in and try again.',
  NETWORK_ERROR: 'Network connection issue. Check your internet and retry.',
  DATA_ERROR: 'Could not load data from the server.',
  RENDER_ERROR: 'This section encountered a rendering error.',
  CONFIG_ERROR: 'Configuration issue detected.',
  UNKNOWN_ERROR: 'An unexpected error occurred.'};

export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, category: 'UNKNOWN_ERROR', traceId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      category: classifyError(error),
      traceId: generateTraceId()};
  }

  componentDidCatch(error: Error) {
    console.warn(`[ModuleErrorBoundary:${this.props.moduleName}]`, this.state.traceId, this.state.category, error.message);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, category: 'UNKNOWN_ERROR', traceId: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <AlertCircle size={28} color="#FF6B6B" />
            </View>
            <Text style={styles.moduleName}>{this.props.moduleName}</Text>
            <Text style={styles.message}>{CATEGORY_MESSAGES[this.state.category]}</Text>
            {this.state.traceId && (
              <Text style={styles.traceId}>Trace: {this.state.traceId}</Text>
            )}
            <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry} activeOpacity={0.8}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.retryText}>Retry {this.props.moduleName}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Loading placeholder for module sections */
export function ModuleLoading({ moduleName }: { moduleName: string }) {
  return (
    <View style={styles.container}>
      <ShimmerIndicator size="large" color="#FFD700" />
      <Text style={styles.loadingText}>Loading {moduleName}…</Text>
    </View>
  );
}

/** Empty state for module sections */
export function ModuleEmptyState({ moduleName, message }: { moduleName: string; message?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.emptyTitle}>{moduleName}</Text>
      <Text style={styles.emptyMessage}>{message || 'No content available right now.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    minHeight: 200},
  card: {
    backgroundColor: '#14141B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 24,
    alignItems: 'center',
    maxWidth: 320},
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FF6B6B15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  moduleName: {
    color: '#FF6B6B',
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 8},
  message: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8},
  traceId: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace' as const,
    marginBottom: 16},
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12},
  retryText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700' as const},
  loadingText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '600' as const,
    marginTop: 12},
  emptyTitle: {
    color: '#888',
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 8},
  emptyMessage: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center'}});
