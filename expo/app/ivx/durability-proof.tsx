import React, { useCallback, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  runOwnerAIDurabilityProof,
  type OwnerAIDurabilityProofResult} from '@/src/modules/ivx-owner-ai/services/ivxDurabilityProofService';

type FieldRowProps = {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'yes' | 'no';
};

function FieldRow({ label, value, mono, tone = 'default' }: FieldRowProps) {
  const valueStyle = [
    styles.fieldValue,
    mono ? styles.fieldValueMono : null,
    tone === 'yes' ? styles.fieldValueYes : null,
    tone === 'no' ? styles.fieldValueNo : null,
  ];
  return (
    <View style={styles.fieldRow} testID={`durability-field-${label}`}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={valueStyle} selectable>
        {value}
      </Text>
    </View>
  );
}

FieldRow.displayName = 'DurabilityFieldRow';

function boolTone(value: boolean): 'yes' | 'no' {
  return value ? 'yes' : 'no';
}

function boolText(value: boolean): string {
  return value ? 'YES' : 'NO';
}

function idText(value: string | null): string {
  return value && value.trim().length > 0 ? value : '—';
}

export default function IVXDurabilityProofRoute() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const [result, setResult] = useState<OwnerAIDurabilityProofResult | null>(null);

  const proofMutation = useMutation<OwnerAIDurabilityProofResult, Error, void>({
    mutationFn: async () => runOwnerAIDurabilityProof(),
    onSuccess: (data) => setResult(data)});

  const handleRun = useCallback((): void => {
    setResult(null);
    proofMutation.mutate();
  }, [proofMutation]);

  const isRunning = proofMutation.isPending;

  return (
    <ErrorBoundary fallbackTitle="Durability proof unavailable">
      <View style={styles.container} testID="ivx-durability-proof-screen">
        <Stack.Screen
          options={{
            title: 'Owner AI Durability Proof',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.text}}
        />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerRow}>
            <ShieldCheck color={Colors.primary} size={26} />
            <Text style={styles.headerTitle}>Owner AI Durability Proof</Text>
          </View>

          <Pressable
            style={[styles.runButton, isRunning ? styles.runButtonDisabled : null]}
            onPress={handleRun}
            disabled={isRunning}
            accessibilityRole="button"
            testID="durability-run-button"
          >
            {isRunning ? (
              <ShimmerIndicator color={Colors.black} />
            ) : (
              <Text style={styles.runButtonText}>Run Owner AI Durability Proof</Text>
            )}
          </Pressable>

          {isRunning ? (
            <View style={styles.statusBlock} testID="durability-running">
              <ShimmerIndicator color={Colors.primary} />
              <Text style={styles.statusText}>Sending → reloading → searching → comparing…</Text>
            </View>
          ) : null}

          {proofMutation.isError ? (
            <View style={styles.errorBlock} testID="durability-error">
              <XCircle color={Colors.error} size={20} />
              <Text style={styles.errorText}>{proofMutation.error?.message ?? 'Proof failed.'}</Text>
            </View>
          ) : null}

          {result ? (
            <View style={styles.resultCard} testID="durability-result">
              <FieldRow label="conversationId" value={idText(result.conversationId)} mono />
              <FieldRow label="userMessageId" value={idText(result.userMessageId)} mono />
              <FieldRow label="assistantMessageId" value={idText(result.assistantMessageId)} mono />
              <FieldRow label="reloadUserMessageId" value={idText(result.reloadUserMessageId)} mono />
              <FieldRow
                label="reloadAssistantMessageId"
                value={idText(result.reloadAssistantMessageId)}
                mono
              />
              <View style={styles.divider} />
              <FieldRow
                label="searchFound"
                value={boolText(result.searchFound)}
                tone={boolTone(result.searchFound)}
              />
              <FieldRow
                label="IDsMatch"
                value={boolText(result.idsMatch)}
                tone={boolTone(result.idsMatch)}
              />

              {result.error ? (
                <View style={styles.errorBlock} testID="durability-result-error">
                  <XCircle color={Colors.error} size={20} />
                  <Text style={styles.errorText}>{result.error}</Text>
                </View>
              ) : (
                <View style={styles.verdictRow}>
                  {result.idsMatch && result.searchFound ? (
                    <CheckCircle2 color={Colors.success ?? '#00C48C'} size={18} />
                  ) : (
                    <XCircle color={Colors.error} size={18} />
                  )}
                  <Text style={styles.verdictText}>
                    Owner AI durability: {result.idsMatch && result.searchFound ? 'YES' : 'NO'}
                  </Text>
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  scroll: {
    padding: 16,
    gap: 16},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    flex: 1},
  runButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18},
  runButtonDisabled: {
    opacity: 0.6},
  runButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '800' as const},
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  statusText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1},
  errorBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 12},
  errorText: {
    color: Colors.error,
    fontSize: 13,
    flex: 1},
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    gap: 12},
  fieldRow: {
    gap: 4},
  fieldLabel: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const},
  fieldValue: {
    color: Colors.text,
    fontSize: 14},
  fieldValueMono: {
    fontFamily: 'monospace',
    fontSize: 13},
  fieldValueYes: {
    color: Colors.success ?? '#00C48C',
    fontWeight: '800' as const},
  fieldValueNo: {
    color: Colors.error,
    fontWeight: '800' as const},
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 2},
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4},
  verdictText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const}});
