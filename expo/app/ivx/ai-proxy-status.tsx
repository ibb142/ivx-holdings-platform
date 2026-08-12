import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from 'expo-router';
import { Bot, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react-native';
import { getIVXAccessToken, getIVXOwnerAIEndpoint } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';

type ProxyStatusPayload = {
  ok?: boolean;
  proxyRoute?: string;
  proxyOwnedBy?: string;
  ownerSessionRequired?: boolean;
  rollbackPath?: {
    clientDirectGatewayToggleEnv?: string;
    defaultEnabled?: boolean;
    note?: string;
  };
  runtime?: {
    provider?: string;
    gateway?: string;
    layer?: string;
    phase?: string;
    model?: string;
    endpointConfigured?: boolean;
    gatewayUrlPresent?: boolean;
    gatewayKeyPresent?: boolean;
    backendKeySource?: string;
    legacyExternalToolkitKeyDetected?: boolean;
    configured?: boolean;
  };
  deploymentMarker?: string;
  timestamp?: string;
};

type LoadState = {
  loading: boolean;
  error: string | null;
  status: number | null;
  endpoint: string | null;
  payload: ProxyStatusPayload | null;
  fetchedAt: string | null;
};

const INITIAL_STATE: LoadState = {
  loading: false,
  error: null,
  status: null,
  endpoint: null,
  payload: null,
  fetchedAt: null};

function deriveProxyStatusEndpoint(): string | null {
  const ownerAIEndpoint = getIVXOwnerAIEndpoint();
  if (!ownerAIEndpoint) {
    return null;
  }
  const trimmed = ownerAIEndpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/api/ivx/owner-ai')) {
    return `${trimmed}/proxy-status`;
  }
  return `${trimmed}/proxy-status`;
}

export default function IVXAIProxyStatusScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const [state, setState] = useState<LoadState>(INITIAL_STATE);

  const runCheck = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const endpoint = deriveProxyStatusEndpoint();
    if (!endpoint) {
      setState({
        loading: false,
        error: 'IVX Owner AI endpoint is not configured.',
        status: null,
        endpoint: null,
        payload: null,
        fetchedAt: new Date().toISOString()});
      return;
    }

    try {
      const accessToken = await getIVXAccessToken();
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})}});
      const text = await response.text();
      let payload: ProxyStatusPayload | null = null;
      try {
        payload = text ? (JSON.parse(text) as ProxyStatusPayload) : null;
      } catch {
        payload = null;
      }
      setState({
        loading: false,
        error: response.ok ? null : `HTTP ${response.status}`,
        status: response.status,
        endpoint,
        payload,
        fetchedAt: new Date().toISOString()});
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Request failed',
        status: null,
        endpoint,
        payload: null,
        fetchedAt: new Date().toISOString()});
    }
  }, []);

  const runtime = state.payload?.runtime ?? null;
  const rollback = state.payload?.rollbackPath ?? null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'IVX AI Proxy', headerStyle: { backgroundColor: '#0B0B0B' }, headerTintColor: '#FFFFFF' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Bot color="#FFB000" size={26} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>IVX AI Proxy Runtime Proof</Text>
            <Text style={styles.subtitle}>Verifies IVX-owned AI proxy is live and the external toolkit client-direct path is off.</Text>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="ivx-ai-proxy-run-check"
          style={styles.primaryButton}
          onPress={runCheck}
          disabled={state.loading}
        >
          {state.loading ? <ShimmerIndicator color="#0B0B0B" /> : <RefreshCw color="#0B0B0B" size={18} />}
          <Text style={styles.primaryButtonText}>{state.loading ? 'Checking…' : 'Run runtime proof'}</Text>
        </TouchableOpacity>

        {state.endpoint ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Status endpoint</Text>
            <Text style={styles.mono}>{state.endpoint}</Text>
          </View>
        ) : null}

        {state.error ? (
          <View style={[styles.card, styles.errorCard]}>
            <View style={styles.rowGap}>
              <AlertTriangle color="#FF6B6B" size={18} />
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
          </View>
        ) : null}

        {state.payload ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Proxy</Text>
              <Row label="Route" value={state.payload.proxyRoute ?? '—'} />
              <Row label="Owned by" value={state.payload.proxyOwnedBy ?? '—'} />
              <Row label="Owner session required" value={state.payload.ownerSessionRequired ? 'yes' : 'no'} />
              <Row label="HTTP" value={state.status !== null ? String(state.status) : '—'} />
            </View>

            {runtime ? (
              <View style={styles.card}>
                <View style={styles.rowGap}>
                  <ShieldCheck color={runtime.configured ? '#00C48C' : '#FF6B6B'} size={18} />
                  <Text style={styles.cardLabel}>Runtime</Text>
                </View>
                <Row label="Configured" value={runtime.configured ? 'yes' : 'no'} />
                <Row label="Provider" value={runtime.provider ?? '—'} />
                <Row label="Gateway" value={runtime.gateway ?? '—'} />
                <Row label="Model" value={runtime.model ?? '—'} />
                <Row label="Endpoint configured" value={runtime.endpointConfigured ? 'yes' : 'no'} />
                <Row label="Gateway URL present" value={runtime.gatewayUrlPresent ? 'yes' : 'no'} />
                <Row label="Gateway key present" value={runtime.gatewayKeyPresent ? 'yes' : 'no'} />
                <Row label="Backend key source" value={runtime.backendKeySource ?? '—'} />
                <Row
                  label="Legacy external toolkit key in backend env"
                  value={runtime.legacyExternalToolkitKeyDetected ? 'detected (safe to remove)' : 'not present'}
                />
              </View>
            ) : null}

            {rollback ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Rollback path</Text>
                <Row label="Toggle env" value={rollback.clientDirectGatewayToggleEnv ?? '—'} />
                <Row label="Default enabled" value={rollback.defaultEnabled ? 'yes' : 'no'} />
                {rollback.note ? <Text style={styles.note}>{rollback.note}</Text> : null}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Deployment marker</Text>
              <Text style={styles.mono}>{state.payload.deploymentMarker ?? '—'}</Text>
              <Text style={styles.cardLabel}>Server timestamp</Text>
              <Text style={styles.mono}>{state.payload.timestamp ?? '—'}</Text>
              <Text style={styles.cardLabel}>Fetched at</Text>
              <Text style={styles.mono}>{state.fetchedAt ?? '—'}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0B' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' as const },
  subtitle: { color: '#9A9A9A', fontSize: 12, marginTop: 2 },
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { color: '#CFCFCF', fontSize: 13 },
  rowValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' as const },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mono: { color: '#E6E6E6', fontSize: 12, fontFamily: 'Courier' },
  note: { color: '#9A9A9A', fontSize: 12, marginTop: 4, lineHeight: 18 }});
