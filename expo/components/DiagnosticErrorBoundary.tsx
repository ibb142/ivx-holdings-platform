// IVX Diagnostic ErrorBoundary
// Shows the FULL error message + stack trace on the phone screen
// so we can see exactly what crashes without needing logs.
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform} from 'react-native';

type ErrorCategory =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'DATA_ERROR'
  | 'RENDER_ERROR'
  | 'CONFIG_ERROR'
  | 'UNKNOWN_ERROR';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  traceId: string | null;
  category: ErrorCategory;
}

function classifyError(error: Error): ErrorCategory {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('maximum update depth') || msg.includes('render') || msg.includes('component')) {
    return 'RENDER_ERROR';
  }
  if (msg.includes('auth') || msg.includes('session') || msg.includes('token') || msg.includes('unauthorized')) {
    return 'AUTH_ERROR';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('connection')) {
    return 'NETWORK_ERROR';
  }
  if (msg.includes('supabase url') || msg.includes('config') || msg.includes('api key')) {
    return 'CONFIG_ERROR';
  }
  if (msg.includes('data') || msg.includes('parse') || msg.includes('json')) {
    return 'DATA_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

function generateTraceId(): string {
  return 'IVX-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  AUTH_ERROR: 'Authentication Error',
  NETWORK_ERROR: 'Network Error',
  DATA_ERROR: 'Data Error',
  RENDER_ERROR: 'IVX encountered a rendering error',
  CONFIG_ERROR: 'Configuration Error',
  UNKNOWN_ERROR: 'Unexpected Error'};

export class DiagnosticErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null, traceId: null, category: 'UNKNOWN_ERROR' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      traceId: generateTraceId(),
      category: classifyError(error)};
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[IVX CRASH]', this.state.traceId, this.state.category, error.message, error.stack, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, traceId: null, category: 'UNKNOWN_ERROR' });
  };

  render() {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    const { error, errorInfo, traceId, category } = this.state;
    const platformInfo = `${Platform.OS} ${Platform.Version}`;

    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.title}>{CATEGORY_LABELS[category]}</Text>
          <Text style={styles.subtitle}>{traceId ? `Trace ID: ${traceId}` : ''}</Text>

          <View style={styles.section}>
            <Text style={styles.label}>Error Category</Text>
            <Text style={styles.value}>{category}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Platform</Text>
            <Text style={styles.value}>{platformInfo}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Error Message</Text>
            <Text style={styles.errorText}>{error.message}</Text>
          </View>

          {/* Full stack trace preserved in diagnostics but shown below the fold */}
          <View style={styles.section}>
            <Text style={styles.label}>Stack Trace (diagnostics)</Text>
            <Text style={styles.stackText}>{error.stack || '(no stack)'}</Text>
          </View>

          {errorInfo && errorInfo.componentStack ? (
            <View style={styles.section}>
              <Text style={styles.label}>Component Stack (diagnostics)</Text>
              <Text style={styles.stackText}>{errorInfo.componentStack}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a0000'},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingTop: 60},
  title: {
    color: '#FF4444',
    fontSize: 24,
    fontWeight: 'bold' as const,
    marginBottom: 4},
  subtitle: {
    color: '#FF8888',
    fontSize: 14,
    marginBottom: 24},
  section: {
    marginBottom: 16,
    backgroundColor: '#2a0000',
    borderRadius: 8,
    padding: 12},
  label: {
    color: '#FF8888',
    fontSize: 12,
    fontWeight: 'bold' as const,
    marginBottom: 6,
    textTransform: 'uppercase' as const},
  value: {
    color: '#FFAAAA',
    fontSize: 14,
    fontFamily: 'monospace' as const},
  errorText: {
    color: '#FFCCCC',
    fontSize: 15,
    fontFamily: 'monospace' as const},
  stackText: {
    color: '#DDAAAA',
    fontSize: 11,
    fontFamily: 'monospace' as const,
    lineHeight: 16},
  button: {
    backgroundColor: '#FF4444',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center' as const,
    marginTop: 8,
    marginBottom: 40},
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold' as const}});
