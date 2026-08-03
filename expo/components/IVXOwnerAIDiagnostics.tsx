import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Cpu, GitBranch, Hash, Package, Server, Smartphone, X, AlertTriangle, Box } from 'lucide-react-native';
import Constants from 'expo-constants';
import { getIVXBuildInfo, type IVXBuildInfo } from '@/constants/build-info';
import Colors from '@/constants/colors';
import { SafeIcon } from '@/lib/safe-icon';
import { getIVXRuntimeInfo } from '@/lib/runtime-environment';

export interface IVXOwnerAIDiagnosticsProps {
  /** Visible only when true. Production builds default to false. */
  visible?: boolean;
  /** Called when the owner taps the Close button. */
  onClose?: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toISOString();
  } catch {
    return iso;
  }
}

export function IVXOwnerAIDiagnostics({ visible = true, onClose }: IVXOwnerAIDiagnosticsProps): React.JSX.Element | null {
  const [buildInfo, setBuildInfo] = useState<IVXBuildInfo>(getIVXBuildInfo());
  const [copied, setCopied] = useState(false);
  const runtime = getIVXRuntimeInfo();

  useEffect(() => {
    setBuildInfo(getIVXBuildInfo());
  }, []);

  if (!visible) {
    return null;
  }

  const packageName = Constants.expoConfig?.android?.package ?? Constants.expoConfig?.ios?.bundleIdentifier ?? 'unknown';
  const versionCode = String(Constants.expoConfig?.android?.versionCode ?? 'unknown');
  const apiEnv = buildInfo.apiBaseUrl;

  const diagnosticText = [
    `App: ${buildInfo.appVersion} (${buildInfo.commitShort})`,
    `versionCode: ${versionCode}`,
    `Package: ${packageName}`,
    `Build marker: ${buildInfo.buildMarker}`,
    `Build timestamp: ${formatDate(buildInfo.buildTimestamp)}`,
    `Bundle boot: ${new Date(buildInfo.bundleBootEpochMs).toISOString()}`,
    `Watchdog patch: ${buildInfo.watchdogPatchVersion}`,
    `Environment: ${buildInfo.environment}`,
    `Runtime: ${buildInfo.runtimeKind}`,
    `API: ${apiEnv}`,
    `Supabase project: ${buildInfo.supabaseProjectHint}`,
    buildInfo.easProjectId ? `EAS project: ${buildInfo.easProjectId}` : null,
    buildInfo.frontendDeployMarker ? `Deploy marker: ${buildInfo.frontendDeployMarker}` : null,
  ].filter(Boolean).join('\n');

  const handleCopy = async () => {
    await Clipboard.setStringAsync(diagnosticText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Row = ({ icon, label, value, tone }: { icon: typeof Cpu; label: string; value: string; tone?: 'default' | 'error' }) => (
    <View style={styles.row}>
      <SafeIcon icon={icon} name={label} size={14} color={tone === 'error' ? Colors.error : Colors.gold} />
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone === 'error' ? styles.valueError : null]} numberOfLines={1} ellipsizeMode="tail">{value}</Text>
    </View>
  );

  const showUnidentifiedWarning = !buildInfo.isIdentified && (typeof __DEV__ === 'undefined' || !__DEV__);

  return (
    <View style={styles.container} testID="ivx-owner-ai-diagnostics">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <SafeIcon icon={Box} name="Box" size={14} color={Colors.gold} />
          <Text style={styles.headerTitle}>Build Information</Text>
        </View>
        {onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close diagnostics"
            testID="ivx-owner-ai-diagnostics-close"
            style={styles.closeButton}
          >
            <SafeIcon icon={X} name="X" size={16} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {showUnidentifiedWarning ? (
        <View style={styles.warningRow}>
          <SafeIcon icon={AlertTriangle} name="AlertTriangle" size={14} color={Colors.error} />
          <Text style={styles.warningText} numberOfLines={2}>{buildInfo.unidentifiedReason ?? 'Unidentified production build.'}</Text>
        </View>
      ) : null}

      <Row icon={Smartphone} label="Version" value={buildInfo.appVersion} />
      <Row icon={Hash} label="versionCode" value={versionCode} />
      <Row icon={GitBranch} label="Git SHA" value={buildInfo.commitShort} tone={buildInfo.commitShort === 'local' ? 'error' : 'default'} />
      <Row icon={Cpu} label="Build time" value={formatDate(buildInfo.buildTimestamp)} />
      <Row icon={Server} label="API env" value={apiEnv} tone={apiEnv === 'unknown' ? 'error' : 'default'} />
      <Row icon={Package} label="Bundle" value={packageName} />
      <Row icon={Cpu} label="Watchdog" value={buildInfo.watchdogPatchVersion} />
      <Row icon={Server} label="Environment" value={buildInfo.environment} />
      <Row icon={Smartphone} label="Runtime" value={buildInfo.runtimeKind} />
      <Row icon={Server} label="Supabase" value={buildInfo.supabaseProjectHint} />
      {buildInfo.easProjectId ? <Row icon={Hash} label="EAS project" value={buildInfo.easProjectId} /> : null}
      {runtime.isExpoGo ? <Row icon={Smartphone} label="Expo Go" value="yes — dev runtime" /> : null}

      <Pressable onPress={handleCopy} style={styles.copyButton} testID="ivx-owner-ai-diagnostics-copy">
        <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy diagnostics'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700' as const},
  closeButton: {
    padding: 4},
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${Colors.error}22`,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    gap: 8},
  warningText: {
    color: Colors.error,
    fontSize: 11,
    flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6},
  label: {
    color: '#888',
    fontSize: 12,
    width: 90,
    marginLeft: 8},
  value: {
    color: '#fff',
    fontSize: 12,
    flex: 1,
    fontWeight: '600' as const},
  valueError: {
    color: Colors.error},
  copyButton: {
    marginTop: 8,
    backgroundColor: '#333',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center'},
  copyText: {
    color: Colors.gold,
    fontSize: 12,
    fontWeight: '600' as const}});
