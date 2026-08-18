import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CheckCircle2, XCircle, Cpu, GitBranch, Hash, Clock, Zap, Box } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import Colors from '@/constants/colors';
import { getIVXBuildInfo } from '@/constants/build-info';

interface AutonomousProofData {
  ok: boolean;
  marker: string;
  timestamp: string;
  backendCommitSha: string;
  bootTime: string | null;
  githubHead: string | null;
  renderDeploySha: string | null;
  healthSha: string | null;
  versionSha: string | null;
  lastJobId: string | null;
  lastJobStatus: string | null;
  lastDeploymentTimestamp: string | null;
  shaParity: {
    githubHead: string | null;
    renderDeploySha: string | null;
    healthSha: string | null;
    versionSha: string | null;
    allMatch: boolean;
  };
  verified: boolean;
}

function shortenSha(sha: string | null): string {
  if (!sha) return '—';
  return sha.length > 12 ? sha.substring(0, 12) : sha;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

const Row = ({ icon: Icon, label, value, tone }: { icon: typeof Cpu; label: string; value: string; tone?: 'default' | 'error' | 'success' }) => (
  <View style={styles.row}>
    <Icon size={14} color={tone === 'error' ? Colors.error : tone === 'success' ? Colors.positive : Colors.gold} />
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, tone === 'error' ? styles.valueError : tone === 'success' ? styles.valueSuccess : null]} numberOfLines={1} ellipsizeMode="tail">{value}</Text>
  </View>
);

export function IVXAutonomousProofCard(): React.JSX.Element {
  const buildInfo = getIVXBuildInfo();
  const apiBase = Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://api.ivxholding.com';

  const proofQuery = useQuery<AutonomousProofData>({
    queryKey: ['ivx.autonomousProof'],
    queryFn: async () => {
      const resp = await fetch(`${apiBase}/api/ivx/autonomous-proof`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json() as AutonomousProofData;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  const data = proofQuery.data;
  const isLoading = proofQuery.isLoading && !data;
  const isError = proofQuery.isError && !data;
  const verified = data?.verified ?? false;

  const handleRefresh = useCallback(() => {
    void proofQuery.refetch();
  }, [proofQuery]);

  return (
    <View style={styles.container} testID="ivx-autonomous-proof-card">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Box size={16} color={Colors.gold} />
          <Text style={styles.headerTitle}>IVX Autonomous Proof</Text>
        </View>
        {verified ? (
          <View style={styles.verifiedBadge} testID="ivx-proof-verified">
            <CheckCircle2 size={14} color="#00C48C" />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        ) : (
          <View style={styles.unverifiedBadge} testID="ivx-proof-unverified">
            <XCircle size={14} color={Colors.error} />
            <Text style={styles.unverifiedText}>Mismatch</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.gold} />
          <Text style={styles.loadingText}>Fetching live diagnostics…</Text>
        </View>
      ) : isError ? (
        <View style={styles.errorRow}>
          <XCircle size={14} color={Colors.error} />
          <Text style={styles.errorText}>Failed to load diagnostics. Pull to retry.</Text>
        </View>
      ) : data ? (
        <>
          <Row icon={Cpu} label="Frontend" value={buildInfo.appVersion} />
          <Row icon={Hash} label="Backend SHA" value={shortenSha(data.backendCommitSha)} tone={data.backendCommitSha === 'unknown' ? 'error' : 'default'} />
          <Row icon={Zap} label="Last Job ID" value={data.lastJobId ?? '—'} />
          <Row icon={Clock} label="Job Status" value={data.lastJobStatus ?? '—'} tone={data.lastJobStatus === 'completed' ? 'success' : data.lastJobStatus === 'failed' ? 'error' : 'default'} />
          <Row icon={Clock} label="Last Deploy" value={formatTimestamp(data.lastDeploymentTimestamp)} />

          <View style={styles.paritySection}>
            <Text style={styles.parityTitle}>SHA Parity Check</Text>
            <Row icon={GitBranch} label="GitHub HEAD" value={shortenSha(data.shaParity.githubHead)} tone={data.shaParity.githubHead ? 'default' : 'error'} />
            <Row icon={Hash} label="Render" value={shortenSha(data.shaParity.renderDeploySha)} tone={data.shaParity.renderDeploySha ? 'default' : 'error'} />
            <Row icon={Cpu} label="/health" value={shortenSha(data.shaParity.healthSha)} tone={data.shaParity.healthSha ? 'default' : 'error'} />
            <Row icon={Cpu} label="/version" value={shortenSha(data.shaParity.versionSha)} tone={data.shaParity.versionSha ? 'default' : 'error'} />
            <View style={[styles.parityResult, verified ? styles.parityOk : styles.parityFail]}>
              <Text style={[styles.parityResultText, verified ? styles.parityOkText : styles.parityFailText]}>
                {verified ? '✓ All four SHAs match' : '✗ SHA mismatch detected'}
              </Text>
            </View>
          </View>

          <TouchableOpacity onPress={handleRefresh} style={styles.refreshButton} testID="ivx-proof-refresh">
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800' as const,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00C48C22',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  verifiedText: {
    color: '#00C48C',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  unverifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FF444422',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  unverifiedText: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 13,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FF444422',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
    gap: 6,
  },
  label: {
    color: '#888',
    fontSize: 12,
    width: 100,
  },
  value: {
    color: '#fff',
    fontSize: 12,
    flex: 1,
    fontWeight: '600' as const,
  },
  valueError: {
    color: Colors.error,
  },
  valueSuccess: {
    color: '#00C48C',
  },
  paritySection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  parityTitle: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: '700' as const,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  parityResult: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  parityOk: {
    backgroundColor: '#00C48C18',
  },
  parityFail: {
    backgroundColor: '#FF444418',
  },
  parityResultText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  parityOkText: {
    color: '#00C48C',
  },
  parityFailText: {
    color: Colors.error,
  },
  refreshButton: {
    marginTop: 10,
    backgroundColor: '#333',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  refreshText: {
    color: Colors.gold,
    fontSize: 12,
    fontWeight: '600' as const,
  },
});
