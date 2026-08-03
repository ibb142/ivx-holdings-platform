import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { resolveSupabaseUrl, resolveSupabaseAnonKey } from '@/lib/supabase-env';
import { supabase, forceProductionSupabaseClient, getSupabaseConfigAudit } from '@/lib/supabase';
import Colors from '@/constants/colors';

function getProjectRef(url: string): string {
  try {
    return new URL(url).hostname.replace(/\.supabase\.co$/, '');
  } catch {
    return 'unknown';
  }
}

function isJwtShape(key: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
}

type DiagnosticState = {
  mobileUrlRef: string;
  backendUrlRef: string;
  keyPresent: boolean;
  keyValidJwt: boolean;
  testResult: 'idle' | 'running' | 'ok' | 'fail';
  testStatus: number | null;
  testMessage: string;
  issuerMatch: boolean | null;
  lastError: string | null;
  configSource: string;
  hostMatch: boolean;
};

export function SupabaseAuthDiagnostic(): React.ReactElement {
  const [state, setState] = useState<DiagnosticState>(() => {
    const url = resolveSupabaseUrl();
    const key = resolveSupabaseAnonKey();
    const audit = getSupabaseConfigAudit();
    return {
      mobileUrlRef: getProjectRef(url),
      backendUrlRef: 'kvclcdjmjghndxsngfzb',
      keyPresent: key.length > 0,
      keyValidJwt: isJwtShape(key),
      testResult: 'idle',
      testStatus: null,
      testMessage: 'Tap run test',
      issuerMatch: null,
      lastError: null,
      configSource: audit.usingFallback ? 'fallback' : 'env',
      hostMatch: getProjectRef(url) === 'kvclcdjmjghndxsngfzb'};
  });

  const runTest = async () => {
    setState((s) => ({ ...s, testResult: 'running', testMessage: 'Testing...' }));
    try {
      const audit = getSupabaseConfigAudit();
      if (!audit.host.includes('kvclcdjmjghndxsngfzb')) {
        forceProductionSupabaseClient();
      }
      // No hardcoded credentials — this diagnostic must not auto-submit.
      // It only checks the Supabase client config (URL + key) without sending
      // a password. A real sign-in test requires the owner to enter credentials.
      const { data, error } = await supabase.auth.getSession();
      const status = (error as { status?: number })?.status ?? null;
      const message = error?.message ?? 'OK';
      const issuerMatch = data.session?.access_token
        ? data.session.access_token.includes('kvclcdjmjghndxsngfzb')
        : false;
      const currentAudit = getSupabaseConfigAudit();
      setState((s) => ({
        ...s,
        testResult: error ? 'fail' : 'ok',
        testStatus: status,
        testMessage: message,
        issuerMatch,
        lastError: error ? JSON.stringify(error) : null,
        configSource: currentAudit.usingFallback ? 'fallback' : 'env',
        hostMatch: currentAudit.host.includes('kvclcdjmjghndxsngfzb')}));
    } catch (e) {
      setState((s) => ({
        ...s,
        testResult: 'fail',
        testStatus: null,
        testMessage: e instanceof Error ? e.message : String(e),
        issuerMatch: false,
        lastError: null}));
    }
  };

  useEffect(() => {
    void runTest();
  }, []);

  const ok = state.keyPresent && state.keyValidJwt && state.testResult === 'ok';

  return (
    <View style={[styles.card, ok ? styles.cardOk : styles.cardFail]}>
      <Text style={styles.title}>Auth Config Diagnostic</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Mobile Supabase ref:</Text>
        <Text style={styles.value}>{state.mobileUrlRef}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Backend Supabase ref:</Text>
        <Text style={styles.value}>{state.backendUrlRef}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Refs match:</Text>
        <Text style={styles.value}>{state.hostMatch ? 'yes' : 'NO'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Config source:</Text>
        <Text style={styles.value}>{state.configSource}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Anon key present:</Text>
        <Text style={styles.value}>{state.keyPresent ? 'yes' : 'no'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Anon key valid JWT:</Text>
        <Text style={styles.value}>{state.keyValidJwt ? 'yes' : 'no'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Sign-in test:</Text>
        <Text style={styles.value}>{state.testResult}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>HTTP status:</Text>
        <Text style={styles.value}>{state.testStatus ?? '—'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Issuer match:</Text>
        <Text style={styles.value}>{state.issuerMatch === null ? '—' : state.issuerMatch ? 'yes' : 'no'}</Text>
      </View>
      <Text style={styles.message} selectable>{state.testMessage}</Text>
      {state.lastError ? <Text style={styles.message} selectable>{state.lastError}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={() => void runTest()}>
        <Text style={styles.buttonText}>Run test again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12},
  cardOk: { backgroundColor: 'rgba(34,197,94,0.12)' },
  cardFail: { backgroundColor: 'rgba(239,68,68,0.12)' },
  title: { color: Colors.text, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: Colors.textSecondary, fontSize: 12 },
  value: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  message: { color: Colors.textSecondary, fontSize: 11, marginTop: 8 },
  button: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center'},
  buttonText: { color: Colors.black, fontSize: 12, fontWeight: '700' }});
