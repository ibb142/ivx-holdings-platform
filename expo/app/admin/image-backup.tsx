import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  HardDrive,
  Cloud,
  Link2,
  RefreshCw,
  Download,
  Scan,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getBackupStats,
  getLastHealthReport,
  runImageHealthScan,
  createFullImageBackup,
  importExistingImages,
  getBrokenImages,
  forceRecoverImage} from '@/lib/image-backup';

export default function ImageBackupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedSection, setExpandedSection] = useState<string | null>('stats');

  const statsQuery = useQuery({
    queryKey: ['image-backup-stats'],
    queryFn: getBackupStats,
    staleTime: 30_000});

  const reportQuery = useQuery({
    queryKey: ['image-health-report'],
    queryFn: getLastHealthReport,
    staleTime: 30_000});

  const brokenQuery = useQuery({
    queryKey: ['broken-images'],
    queryFn: getBrokenImages,
    staleTime: 30_000});

  const scanMutation = useMutation({
    mutationFn: () => runImageHealthScan({ forceFullScan: true, maxImages: 100 }),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: ['image-backup-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['image-health-report'] });
      void queryClient.invalidateQueries({ queryKey: ['broken-images'] });
      Alert.alert(
        'Scan Complete',
        `Scanned ${report.totalImages} images\n${report.healthyCount} healthy\n${report.degradedCount} degraded\n${report.brokenCount} broken\n${report.recoveredCount} recovered`,
      );
    },
    onError: (err: Error) => {
      Alert.alert('Scan Failed', err.message);
    }});

  const backupMutation = useMutation({
    mutationFn: createFullImageBackup,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['image-backup-stats'] });
      Alert.alert('Backup Complete', `${result.backedUpCount} images backed up to Supabase`);
    },
    onError: (err: Error) => {
      Alert.alert('Backup Failed', err.message);
    }});

  const importMutation = useMutation({
    mutationFn: importExistingImages,
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: ['image-backup-stats'] });
      Alert.alert('Import Complete', `${count} images imported into backup registry`);
    }});

  const recoverMutation = useMutation({
    mutationFn: (imageId: string) => forceRecoverImage(imageId),
    onSuccess: (result, _imageId) => {
      void queryClient.invalidateQueries({ queryKey: ['broken-images'] });
      void queryClient.invalidateQueries({ queryKey: ['image-backup-stats'] });
      if (result.recovered) {
        Alert.alert('Recovered', `Image restored from: ${result.source}`);
      } else {
        Alert.alert('Recovery Failed', 'All recovery sources exhausted for this image');
      }
    }});

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['image-backup-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['image-health-report'] });
    void queryClient.invalidateQueries({ queryKey: ['broken-images'] });
  }, [queryClient]);

  const stats = statsQuery.data;
  const report = reportQuery.data;
  const brokenImages = brokenQuery.data ?? [];

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#00C48C';
      case 'degraded': return '#FFB800';
      case 'broken': return '#FF4757';
      case 'recovered': return '#4ECDC4';
      default: return '#666';
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
            <ArrowLeft size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Shield size={20} color="#FFD700" />
            <Text style={styles.headerTitle}>Image Backup Protection</Text>
          </View>
          <View style={styles.headerRight} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={statsQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor="#FFD700"
          />
        }
      >
        <View style={styles.statusBanner}>
          {stats && stats.brokenCount > 0 ? (
            <>
              <ShieldAlert size={28} color="#FF4757" />
              <View style={styles.statusTextWrap}>
                <Text style={styles.statusTitle}>{stats.brokenCount} Broken Image{stats.brokenCount > 1 ? 's' : ''} Detected</Text>
                <Text style={styles.statusSub}>Run a scan to attempt auto-recovery</Text>
              </View>
            </>
          ) : stats && stats.totalTracked > 0 ? (
            <>
              <ShieldCheck size={28} color="#00C48C" />
              <View style={styles.statusTextWrap}>
                <Text style={[styles.statusTitle, { color: '#00C48C' }]}>All Images Protected</Text>
                <Text style={styles.statusSub}>{stats.totalTracked} images tracked with backup</Text>
              </View>
            </>
          ) : (
            <>
              <ShieldOff size={28} color="#666" />
              <View style={styles.statusTextWrap}>
                <Text style={styles.statusTitle}>No Images Tracked Yet</Text>
                <Text style={styles.statusSub}>Import existing images to start protection</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            testID="scan-btn"
          >
            {scanMutation.isPending ? (
              <ShimmerIndicator size="small" color="#000" />
            ) : (
              <Scan size={18} color="#000" />
            )}
            <Text style={styles.actionBtnTextDark}>
              {scanMutation.isPending ? 'Scanning...' : 'Health Scan'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSecondary]}
            onPress={() => backupMutation.mutate()}
            disabled={backupMutation.isPending}
            testID="backup-btn"
          >
            {backupMutation.isPending ? (
              <ShimmerIndicator size="small" color="#FFD700" />
            ) : (
              <Cloud size={18} color="#FFD700" />
            )}
            <Text style={styles.actionBtnText}>
              {backupMutation.isPending ? 'Backing up...' : 'Full Backup'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSecondary]}
            onPress={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            testID="import-btn"
          >
            {importMutation.isPending ? (
              <ShimmerIndicator size="small" color="#4ECDC4" />
            ) : (
              <Download size={18} color="#4ECDC4" />
            )}
            <Text style={styles.actionBtnText}>
              {importMutation.isPending ? 'Importing...' : 'Import'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('stats')}>
          <HardDrive size={18} color="#FFD700" />
          <Text style={styles.sectionTitle}>Backup Statistics</Text>
        </TouchableOpacity>
        {expandedSection === 'stats' && stats && (
          <View style={styles.sectionBody}>
            <View style={styles.statGrid}>
              <StatCard label="Total Tracked" value={stats.totalTracked} color="#FFD700" />
              <StatCard label="Healthy" value={stats.healthyCount} color="#00C48C" />
              <StatCard label="Degraded" value={stats.degradedCount} color="#FFB800" />
              <StatCard label="Broken" value={stats.brokenCount} color="#FF4757" />
              <StatCard label="Unknown" value={stats.unknownCount} color="#666" />
              <StatCard label="Local Backup" value={stats.withLocalBackup} color="#4ECDC4" />
              <StatCard label="Supabase Path" value={stats.withSupabasePath} color="#4A90D9" />
              <StatCard label="Backup URLs" value={stats.withBackupUrls} color="#A78BFA" />
            </View>
            {stats.lastScanAt && (
              <View style={styles.lastScanRow}>
                <Clock size={14} color="#888" />
                <Text style={styles.lastScanText}>
                  Last scan: {new Date(stats.lastScanAt).toLocaleString()}
                </Text>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('report')}>
          <RefreshCw size={18} color="#4ECDC4" />
          <Text style={styles.sectionTitle}>Last Health Report</Text>
        </TouchableOpacity>
        {expandedSection === 'report' && (
          <View style={styles.sectionBody}>
            {report ? (
              <>
                <View style={styles.reportSummary}>
                  <Text style={styles.reportLabel}>Scanned: {report.totalImages} images in {report.scanDurationMs}ms</Text>
                  <Text style={styles.reportLabel}>Date: {new Date(report.scannedAt).toLocaleString()}</Text>
                </View>
                <View style={styles.reportBarContainer}>
                  {report.healthyCount > 0 && (
                    <View style={[styles.reportBar, { flex: report.healthyCount, backgroundColor: '#00C48C' }]} />
                  )}
                  {report.degradedCount > 0 && (
                    <View style={[styles.reportBar, { flex: report.degradedCount, backgroundColor: '#FFB800' }]} />
                  )}
                  {report.brokenCount > 0 && (
                    <View style={[styles.reportBar, { flex: report.brokenCount, backgroundColor: '#FF4757' }]} />
                  )}
                  {report.recoveredCount > 0 && (
                    <View style={[styles.reportBar, { flex: report.recoveredCount, backgroundColor: '#4ECDC4' }]} />
                  )}
                </View>
                <View style={styles.reportLegend}>
                  <LegendItem color="#00C48C" label={`Healthy (${report.healthyCount})`} />
                  <LegendItem color="#FFB800" label={`Degraded (${report.degradedCount})`} />
                  <LegendItem color="#FF4757" label={`Broken (${report.brokenCount})`} />
                  <LegendItem color="#4ECDC4" label={`Recovered (${report.recoveredCount})`} />
                </View>
                {report.details.length > 0 && (
                  <View style={styles.detailsList}>
                    {report.details
                      .filter(d => d.status !== 'healthy')
                      .slice(0, 20)
                      .map((detail, idx) => (
                        <View key={`${detail.imageId}-${idx}`} style={styles.detailRow}>
                          {detail.status === 'recovered' ? (
                            <CheckCircle2 size={14} color="#4ECDC4" />
                          ) : detail.status === 'degraded' ? (
                            <AlertTriangle size={14} color="#FFB800" />
                          ) : (
                            <XCircle size={14} color="#FF4757" />
                          )}
                          <View style={styles.detailInfo}>
                            <Text style={styles.detailId} numberOfLines={1}>{detail.imageId}</Text>
                            <Text style={[styles.detailStatus, { color: getHealthColor(detail.status) }]}>
                              {detail.status.toUpperCase()}
                              {detail.recoverySource ? ` via ${detail.recoverySource}` : ''}
                            </Text>
                          </View>
                          <Text style={styles.detailTime}>{detail.responseTimeMs}ms</Text>
                        </View>
                      ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.emptyText}>No scan report yet. Run a health scan first.</Text>
            )}
          </View>
        )}

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('broken')}>
          <ShieldAlert size={18} color="#FF4757" />
          <Text style={styles.sectionTitle}>
            Broken Images ({brokenImages.length})
          </Text>
        </TouchableOpacity>
        {expandedSection === 'broken' && (
          <View style={styles.sectionBody}>
            {brokenImages.length === 0 ? (
              <View style={styles.emptyState}>
                <CheckCircle2 size={32} color="#00C48C" />
                <Text style={styles.emptyStateText}>No broken images detected</Text>
              </View>
            ) : (
              brokenImages.slice(0, 30).map((entry) => (
                <View key={entry.imageId} style={styles.brokenCard}>
                  <View style={styles.brokenCardHeader}>
                    <XCircle size={16} color="#FF4757" />
                    <Text style={styles.brokenId} numberOfLines={1}>{entry.imageId}</Text>
                  </View>
                  <Text style={styles.brokenUrl} numberOfLines={2}>{entry.primaryUrl}</Text>
                  <View style={styles.brokenMeta}>
                    <Text style={styles.brokenMetaText}>Entity: {entry.entityType}/{entry.entityId}</Text>
                    <Text style={styles.brokenMetaText}>Fails: {entry.failCount}</Text>
                  </View>
                  <View style={styles.brokenSources}>
                    {entry.localUri && (
                      <View style={styles.sourceTag}>
                        <HardDrive size={10} color="#4ECDC4" />
                        <Text style={styles.sourceTagText}>Local</Text>
                      </View>
                    )}
                    {entry.supabaseStoragePath && (
                      <View style={styles.sourceTag}>
                        <Cloud size={10} color="#4A90D9" />
                        <Text style={styles.sourceTagText}>Supabase</Text>
                      </View>
                    )}
                    {entry.backupUrls.length > 0 && (
                      <View style={styles.sourceTag}>
                        <Link2 size={10} color="#A78BFA" />
                        <Text style={styles.sourceTagText}>{entry.backupUrls.length} backup URL{entry.backupUrls.length > 1 ? 's' : ''}</Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.recoverBtn}
                    onPress={() => recoverMutation.mutate(entry.imageId)}
                    disabled={recoverMutation.isPending}
                  >
                    {recoverMutation.isPending ? (
                      <ShimmerIndicator size="small" color="#FFD700" />
                    ) : (
                      <Wrench size={14} color="#FFD700" />
                    )}
                    <Text style={styles.recoverBtnText}>Force Recover</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('how')}>
          <Shield size={18} color="#A78BFA" />
          <Text style={styles.sectionTitle}>How Protection Works</Text>
        </TouchableOpacity>
        {expandedSection === 'how' && (
          <View style={styles.sectionBody}>
            <ProtectionStep
              num={1}
              title="Multi-Layer Storage"
              desc="Every image is stored in: AsyncStorage registry, Supabase image_registry table, Supabase Storage bucket, and local device file system."
            />
            <ProtectionStep
              num={2}
              title="Automatic Health Scans"
              desc="Every 4 hours, the app checks if image URLs are still accessible via HEAD requests. Degraded images get flagged."
            />
            <ProtectionStep
              num={3}
              title="Auto-Recovery Chain"
              desc="If an image breaks, recovery is attempted from: backup URLs → local file cache → Supabase Storage → Supabase DB records."
            />
            <ProtectionStep
              num={4}
              title="URL Propagation"
              desc="When an image is recovered, the new URL is automatically updated across all registries and data sources."
            />
            <ProtectionStep
              num={5}
              title="Protection Flag"
              desc="All images are marked as protected by default, preventing accidental deletion."
            />
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function ProtectionStep({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <View style={styles.protStep}>
      <View style={styles.protStepNum}>
        <Text style={styles.protStepNumText}>{num}</Text>
      </View>
      <View style={styles.protStepContent}>
        <Text style={styles.protStepTitle}>{title}</Text>
        <Text style={styles.protStepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A'},
  safeTop: {
    backgroundColor: '#0D0D0D'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,215,0,0.1)'},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  headerTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700' as const},
  headerRight: {
    width: 36},
  scroll: {
    flex: 1},
  scrollContent: {
    paddingBottom: 40},
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 14},
  statusTextWrap: {
    flex: 1},
  statusTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const},
  statusSub: {
    color: '#888',
    fontSize: 13,
    marginTop: 2},
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20},
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10},
  actionPrimary: {
    backgroundColor: '#FFD700'},
  actionSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'},
  actionBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600' as const},
  actionBtnTextDark: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700' as const},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)'},
  sectionTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600' as const},
  sectionBody: {
    paddingHorizontal: 16,
    paddingBottom: 16},
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8},
  statCard: {
    width: '47%' as any,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  statValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums']},
  statLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500' as const,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  lastScanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12},
  lastScanText: {
    color: '#888',
    fontSize: 12},
  reportSummary: {
    marginTop: 8,
    gap: 4},
  reportLabel: {
    color: '#AAA',
    fontSize: 13},
  reportBarContainer: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)'},
  reportBar: {
    height: 8},
  reportLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10},
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5},
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  legendText: {
    color: '#AAA',
    fontSize: 11},
  detailsList: {
    marginTop: 12,
    gap: 6},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8},
  detailInfo: {
    flex: 1},
  detailId: {
    color: '#CCC',
    fontSize: 11,
    fontFamily: 'monospace'},
  detailStatus: {
    fontSize: 10,
    fontWeight: '700' as const,
    marginTop: 2},
  detailTime: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace'},
  emptyText: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10},
  emptyStateText: {
    color: '#888',
    fontSize: 14},
  brokenCard: {
    backgroundColor: 'rgba(255,71,87,0.06)',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,71,87,0.15)'},
  brokenCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  brokenId: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1},
  brokenUrl: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 6},
  brokenMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8},
  brokenMetaText: {
    color: '#666',
    fontSize: 11},
  brokenSources: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8},
  sourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6},
  sourceTagText: {
    color: '#AAA',
    fontSize: 10},
  recoverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)'},
  recoverBtnText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600' as const},
  protStep: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12},
  protStepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(167,139,250,0.15)',
    justifyContent: 'center',
    alignItems: 'center'},
  protStepNumText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700' as const},
  protStepContent: {
    flex: 1},
  protStepTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600' as const},
  protStepDesc: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18},
  bottomSpacer: {
    height: 40}});
