import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from 'expo-router';
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw } from 'lucide-react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type ProofTestPayload = {
  status?: string;
  source?: string;
  module?: string;
  timestamp?: string;
};

type LoadState = {
  loading: boolean;
  error: string | null;
  httpStatus: number | null;
  endpoint: string;
  payload: ProofTestPayload | null;
  fetchedAt: string | null;
};

function resolveApiBaseUrl(): string {
  const base =
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    'https://api.ivxholding.com';
  return base.replace(/\/+$/, '');
}

const PROOF_TEST_ENDPOINT = `${resolveApiBaseUrl()}/api/proof-test`;

const INITIAL_STATE: LoadState = {
  loading: false,
  error: null,
  httpStatus: null,
  endpoint: PROOF_TEST_ENDPOINT,
  payload: null,
  fetchedAt: null};

export default function IVXProofTestRoute() {
  const [state, setState] = useState<LoadState>(INITIAL_STATE);

  const runFetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(PROOF_TEST_ENDPOINT, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }});
      const text = await response.text();
      let payload: ProofTestPayload | null = null;
      try {
        payload = text ? (JSON.parse(text) as ProofTestPayload) : null;
      } catch {
        payload = null;
      }
      setState({
        loading: false,
        error: response.ok ? null : `HTTP ${response.status}`,
        httpStatus: response.status,
        endpoint: PROOF_TEST_ENDPOINT,
        payload,
        fetchedAt: new Date().toISOString()});
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Request failed',
        httpStatus: null,
        endpoint: PROOF_TEST_ENDPOINT,
        payload: null,
        fetchedAt: new Date().toISOString()});
    }
  }, []);

  useEffect(() => {
    void runFetch();
  }, [runFetch]);

  const isSuccess = state.payload?.status === 'success' && state.payload?.source === 'owner-ai';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Proof Test', headerStyle: { backgroundColor: '#0B0B0B' }, headerTintColor: '#FFFFFF' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <FlaskConical color="#FFB000" size={26} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>owner-ai-proof-test</Text>
            <Text style={styles.subtitle}>End-to-end proof: this page fetches the live backend endpoint and renders the returned JSON.</Text>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="proof-test-refetch"
          style={styles.primaryButton}
          onPress={runFetch}
          disabled={state.loading}
        >
          {state.loading ? <ShimmerIndicator color="#0B0B0B" /> : <RefreshCw color="#0B0B0B" size={18} />}
          <Text style={styles.primaryButtonText}>{state.loading ? 'Fetching…' : 'Fetch /api/proof-test'}</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Endpoint</Text>
          <Text style={styles.mono}>{state.endpoint}</Text>
          <Text style={styles.cardLabel}>HTTP status</Text>
          <Text style={styles.mono}>{state.httpStatus !== null ? String(state.httpStatus) : '—'}</Text>
        </View>

        {state.error ? (
          <View style={[styles.card, styles.errorCard]}>
            <View style={styles.rowGap}>
              <AlertTriangle color="#FF6B6B" size={18} />
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
          </View>
        ) : null}

        {state.payload ? (
          <View style={styles.card}>
            <View style={styles.rowGap}>
              {isSuccess ? <CheckCircle2 color="#00C48C" size={18} /> : <AlertTriangle color="#FFB000" size={18} />}
              <Text style={styles.cardLabel}>Returned JSON</Text>
            </View>
            <Text style={styles.code}>{JSON.stringify(state.payload, null, 2)}</Text>
            <Text style={styles.cardLabel}>Fetched at</Text>
            <Text style={styles.mono}>{state.fetchedAt ?? '—'}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0B' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' as const },
  subtitle: { color: '#9A9A9A', fontSize: 12, marginTop: 2, lineHeight: 18 },
  primaryButton: {
    backgroundColor: '#FFB000',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  primaryButtonText: { color: '#0B0B0B', fontWeight: '700' as const, fontSize: 15 },
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#222222',
    gap: 6},
  errorCard: { borderColor: '#7F1D1D' },
  errorText: { color: '#FF6B6B', flex: 1 },
  cardLabel: { color: '#9A9A9A', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 4 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mono: { color: '#E6E6E6', fontSize: 12, fontFamily: 'Courier' },
  code: { color: '#7DD3FC', fontSize: 13, fontFamily: 'Courier', lineHeight: 20 }});
