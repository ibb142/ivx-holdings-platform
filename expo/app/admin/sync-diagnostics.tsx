import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Globe,
  Layers,
  Clock,
  Shield,
  Zap,
  Activity,
  BarChart3,
  Image as ImageIcon} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { getLandingSyncStatus, syncToLandingPage } from '@/lib/landing-sync';
import { usePublishedJVDeals } from '@/lib/parse-deal';
import {
  CANONICAL_MIN_INVESTMENT,
  CANONICAL_DISTRIBUTION_LABEL,
  CANONICAL_CLAIMS,
  validatePublicClaim} from '@/lib/published-deal-card-model';
import { getDeployStatus } from '@/lib/landing-deploy';
import { fetchCanonicalDeals, getCanonicalCacheStats } from '@/lib/canonical-deals';
import {
  diagnoseDealsPhotos,
  getPhotoHealthPresentation,
  getPhotoSourcePresentation,
  type DealPhotoDiagnostic} from '@/lib/deal-photo-health';
import { performanceMonitor } from '@/lib/performance-monitor';
import { getAutoDeployStatus } from '@/lib/auto-deploy';
import { getAdminMemberRegistrySnapshot, type AdminMemberRegistrySnapshot } from '@/lib/member-registry';
import { getDeployAccessDiagnostic } from '@/lib/landing-deploy';
import { runLandingReadinessAudit, type ReadinessAuditResult } from '@/lib/landing-readiness-audit';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';


type StatusLevel = 'green' | 'yellow' | 'red';

interface AdminAuditCardItem {
  id: string;
  label: string;
  value: string;
  status: StatusLevel;
  detail?: string;
}

interface DiagnosticItem {
  id: string;
  label: string;
  value: string;
  status: StatusLevel;
  detail?: string;
}

export default function SyncDiagnosticsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const publishedJV = usePublishedJVDeals({ refetchIntervalMs: false });

  const syncStatusQuery = useQuery({
    queryKey: ['sync-diagnostics-status'],
    queryFn: getLandingSyncStatus,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const imageAuditQuery = useQuery<DealPhotoDiagnostic[]>({
    queryKey: ['sync-diagnostics-image-audit'],
    queryFn: async (): Promise<DealPhotoDiagnostic[]> => {
      const canonicalResult = await fetchCanonicalDeals(true);
      return diagnoseDealsPhotos(canonicalResult.deals);
    },
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const forceSyncMutation = useMutation({
    mutationFn: () => syncToLandingPage(),
    onSuccess: (result) => {
      console.log('[SyncDiag] Force sync result:', result.success, 'deals:', result.syncedDeals);
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-status'] });
      void queryClient.invalidateQueries({ queryKey: ['auto-deploy-status'] });
    }});

  const autoDeployQuery = useQuery({
    queryKey: ['auto-deploy-status'],
    queryFn: getAutoDeployStatus,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const memberRegistryQuery = useQuery<AdminMemberRegistrySnapshot>({
    queryKey: ['sync-diagnostics-member-registry'],
    queryFn: () => getAdminMemberRegistrySnapshot(),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const deployAccessQuery = useQuery({
    queryKey: ['sync-diagnostics-deploy-access'],
    queryFn: getDeployAccessDiagnostic,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const readinessAuditQuery = useQuery<ReadinessAuditResult>({
    queryKey: ['sync-diagnostics-readiness-audit'],
    queryFn: () => runLandingReadinessAudit(),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchInterval: false});

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-status'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-image-audit'] });
      void queryClient.invalidateQueries({ queryKey: ['auto-deploy-status'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-member-registry'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-deploy-access'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-diagnostics-readiness-audit'] });
      void publishedJV.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, publishedJV]);

  const status = syncStatusQuery.data;
  const appVisibleCount = publishedJV.deals.length;
  const imageDiagnostics = imageAuditQuery.data;
  const imageDiagnosticsList = imageDiagnostics ?? [];

  const cacheStats = getCanonicalCacheStats();
  const perfSummary = performanceMonitor.getSummary();
  const readinessAudit = readinessAuditQuery.data;
  const readiness30k = readinessAudit?.scaleAssessments.find((assessment) => assessment.targetUsers === 30000);
  const readiness1M = readinessAudit?.scaleAssessments.find((assessment) => assessment.targetUsers === 1000000);

  const claimChecks = useMemo(() => {
    const testClaims = [
      '$50 minimum investment',
      'Monthly distributions',
      'Not FDIC insured',
      'IVX Holdings LLC',
    ];
    return testClaims.map(claim => ({
      claim,
      ...validatePublicClaim(claim)}));
  }, []);

  const imageAuditSummary = useMemo(() => {
    const items = imageDiagnostics ?? [];
    return items.reduce((acc, item) => {
      acc.total += 1;
      if (item.status === 'healthy') acc.healthy += 1;
      if (item.status === 'warning') acc.warning += 1;
      if (item.status === 'broken') acc.broken += 1;
      if (item.source === 'db') acc.db += 1;
      if (item.source === 'storage') acc.storage += 1;
      if (item.source === 'fallback') acc.fallback += 1;
      if (item.source === 'none') acc.missing += 1;
      return acc;
    }, {
      total: 0,
      healthy: 0,
      warning: 0,
      broken: 0,
      db: 0,
      storage: 0,
      fallback: 0,
      missing: 0});
  }, [imageDiagnostics]);

  const diagnostics: DiagnosticItem[] = [];

  diagnostics.push({
    id: 'jv-deals-published',
    label: 'Published JV Deals (Supabase)',
    value: status ? String(status.publishedDealsCount) : '...',
    status: status?.publishedDealsCount != null && status.publishedDealsCount > 0 ? 'green' : 'yellow',
    detail: 'jv_deals table — single source of truth'});

  diagnostics.push({
    id: 'landing-deals-count',
    label: 'Landing Deals (Derived)',
    value: status ? String(status.landingDealsCount) : '...',
    status: status ? (status.inSync ? 'green' : 'red') : 'yellow',
    detail: 'landing_deals table — auto-generated, read-only'});

  diagnostics.push({
    id: 'canonical-api-count',
    label: 'Canonical API Count',
    value: status ? String(status.canonicalApiCount) : '...',
    status: status?.canonicalApiCount != null && status.canonicalApiCount > 0 ? 'green' : 'yellow',
    detail: 'Same as published jv_deals — canonical endpoint'});

  diagnostics.push({
    id: 'app-visible-count',
    label: 'App Visible Deals',
    value: String(appVisibleCount),
    status: appVisibleCount > 0 ? 'green' : 'yellow',
    detail: 'Deals visible in app Invest screen right now'});

  diagnostics.push({
    id: 'sync-status',
    label: 'Sync Status',
    value: status?.inSync ? 'IN SYNC' : 'OUT OF SYNC',
    status: status?.inSync ? 'green' : 'red',
    detail: status?.inSync
      ? 'jv_deals and landing_deals counts match'
      : `Mismatch: ${status?.publishedDealsCount ?? '?'} published vs ${status?.landingDealsCount ?? '?'} landing`});

  diagnostics.push({
    id: 'last-sync',
    label: 'Last Sync Time',
    value: status?.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never',
    status: status?.lastSync ? 'green' : 'yellow'});

  diagnostics.push({
    id: 'last-deploy',
    label: 'Last Deploy Time',
    value: status?.lastDeployTime ? new Date(status.lastDeployTime).toLocaleString() : 'Never',
    status: status?.lastDeployTime ? 'green' : 'yellow'});

  diagnostics.push({
    id: 'last-deploy-error',
    label: 'Last Deploy Error',
    value: status?.lastDeployError || 'None',
    status: status?.lastDeployError ? 'red' : 'green'});

  diagnostics.push({
    id: 'min-investment',
    label: 'Canonical Min Investment',
    value: `${CANONICAL_MIN_INVESTMENT}`,
    status: 'green',
    detail: 'Shared across app and landing page'});

  diagnostics.push({
    id: 'distribution-freq',
    label: 'Canonical Distribution',
    value: CANONICAL_DISTRIBUTION_LABEL,
    status: 'green',
    detail: 'Shared across app and landing page'});

  const deployStatus = getDeployStatus();
  diagnostics.push({
    id: 'deploy-mode',
    label: 'Deploy Mode',
    value: deployStatus.pipelineLabel,
    status: deployStatus.publicDeployConfigured ? 'green' : deployStatus.canDeploy ? 'yellow' : 'red',
    detail: deployStatus.publicDeployConfigured
      ? 'Landing sync runs in-app and the public website pipeline is configured end-to-end.'
      : deployStatus.missingRequirements.length > 0
        ? `Missing: ${deployStatus.missingRequirements.join(', ')}`
        : 'Landing sync runs in-app. GitHub Actions and AWS deliver the public landing when configured.'});

  diagnostics.push({
    id: 'compliance-note',
    label: 'Compliance Disclaimer',
    value: CANONICAL_CLAIMS.complianceNote ? 'Active' : 'Missing',
    status: CANONICAL_CLAIMS.complianceNote ? 'green' : 'red',
    detail: CANONICAL_CLAIMS.complianceNote});

  const countMismatch = status && !status.inSync;
  const appVsApiMismatch = status && appVisibleCount !== status.publishedDealsCount;

  const adminAuditCards = useMemo(() => {
    const memberSnapshot = memberRegistryQuery.data;
    const deployAccess = deployAccessQuery.data;
    const cards: { id: string; title: string; items: AdminAuditCardItem[] }[] = [
      {
        id: 'scale-readiness',
        title: 'Scale Readiness',
        items: [
          {
            id: 'scale-readiness-30k',
            label: '30K audit',
            value: readiness30k ? (readiness30k.status === 'pass' ? 'Passed' : readiness30k.status === 'warn' ? 'Needs review' : 'Blocked') : readinessAuditQuery.isPending ? 'Loading' : 'Unavailable',
            status: readiness30k ? (readiness30k.status === 'pass' ? 'green' : readiness30k.status === 'warn' ? 'yellow' : 'red') : readinessAuditQuery.isPending ? 'yellow' : 'red',
            detail: readiness30k ? `${readiness30k.summary} Evidence: ${readiness30k.evidence}.` : '30K launch-path audit has not returned yet.'},
          {
            id: 'scale-readiness-1m',
            label: '1M audit',
            value: readiness1M ? (readiness1M.status === 'pass' ? 'Passed' : readiness1M.status === 'warn' ? 'Needs review' : 'Blocked') : readinessAuditQuery.isPending ? 'Loading' : 'Unavailable',
            status: readiness1M ? (readiness1M.status === 'pass' ? 'green' : readiness1M.status === 'warn' ? 'yellow' : 'red') : readinessAuditQuery.isPending ? 'yellow' : 'red',
            detail: readiness1M ? `${readiness1M.summary} Evidence: ${readiness1M.evidence}.` : '1M audit has not returned yet.'},
          {
            id: 'scale-readiness-summary',
            label: 'Audit summary',
            value: readinessAudit ? `${readinessAudit.blockerCount} blockers · ${readinessAudit.warningCount} warnings` : readinessAuditQuery.isPending ? 'Running' : 'Unavailable',
            status: readinessAudit ? (readinessAudit.overallStatus === 'pass' ? 'green' : readinessAudit.overallStatus === 'warn' ? 'yellow' : 'red') : readinessAuditQuery.isPending ? 'yellow' : 'red',
            detail: readinessAudit?.summary ?? 'Readiness audit summary is not available yet.'},
        ]},
      {
        id: 'owner-access',
        title: 'Owner Access',
        items: [
          {
            id: 'owner-authenticated',
            label: 'Authenticated session',
            value: auth.isAuthenticated ? 'Live' : 'Missing',
            status: auth.isAuthenticated ? 'green' : 'red'},
          {
            id: 'owner-role',
            label: 'Resolved role',
            value: deployAccess?.role ?? auth.userRole ?? 'unknown',
            status: (deployAccess?.role ?? auth.userRole) && (deployAccess?.role ?? auth.userRole) !== 'investor' ? 'green' : 'yellow'},
          {
            id: 'owner-trusted',
            label: 'Trusted owner route',
            value: auth.isOwnerIPAccess ? 'Restored' : 'Normal session',
            status: auth.isOwnerIPAccess ? 'green' : 'yellow',
            detail: auth.detectedIP ? `Detected IP ${auth.detectedIP}` : 'Network identity not currently resolved'},
        ]},
      {
        id: 'member-retention',
        title: 'Member Retention',
        items: [
          {
            id: 'member-merged-count',
            label: 'Durable member registry',
            value: memberSnapshot ? String(memberSnapshot.mergedCount) : '...',
            status: memberSnapshot && memberSnapshot.mergedCount > 0 ? 'green' : 'yellow'},
          {
            id: 'member-remote-profiles',
            label: 'Remote profiles',
            value: memberSnapshot ? String(memberSnapshot.remoteProfileCount) : '...',
            status: memberSnapshot && memberSnapshot.remoteProfileCount > 0 ? 'green' : 'yellow'},
          {
            id: 'member-local-recovery',
            label: 'Local-only safety net',
            value: memberSnapshot ? String(memberSnapshot.staleLocalOnlyCount) : '...',
            status: memberSnapshot && memberSnapshot.staleLocalOnlyCount === 0 ? 'green' : 'yellow',
            detail: memberSnapshot ? `Waitlist shadows ${memberSnapshot.remoteWaitlistShadowCount}` : undefined},
        ]},
      {
        id: 'write-paths',
        title: 'Backend + Write Paths',
        items: [
          {
            id: 'deploy-guard',
            label: 'Deploy access guard',
            value: deployAccess?.allowed ? 'Verified' : 'Blocked',
            status: deployAccess?.allowed ? 'green' : 'red',
            detail: deployAccess?.reason},
          {
            id: 'deploy-token',
            label: 'Fresh auth token',
            value: deployAccess?.tokenAvailable ? 'Ready' : 'Missing',
            status: deployAccess?.tokenAvailable ? 'green' : 'red'},
          {
            id: 'auto-deploy-live',
            label: 'Auto-deploy pipeline',
            value: autoDeployQuery.data?.config.enabled ? 'Enabled' : 'Disabled',
            status: autoDeployQuery.data?.config.enabled ? 'green' : 'yellow',
            detail: autoDeployQuery.data?.lastDeploy?.timestamp
              ? `Last run ${new Date(autoDeployQuery.data.lastDeploy.timestamp).toLocaleString()}`
              : 'No deploy run recorded yet'},
        ]},
    ];

    return cards;
  }, [auth.detectedIP, auth.isAuthenticated, auth.isOwnerIPAccess, auth.userRole, autoDeployQuery.data, deployAccessQuery.data, memberRegistryQuery.data, readiness1M, readiness30k, readinessAudit, readinessAuditQuery.isPending]);

  const getStatusIcon = (level: StatusLevel) => {
    switch (level) {
      case 'green': return <CheckCircle2 size={16} color="#00C48C" />;
      case 'yellow': return <AlertTriangle size={16} color="#FFD700" />;
      case 'red': return <XCircle size={16} color="#FF4D4D" />;
    }
  };

  const getStatusBg = (level: StatusLevel) => {
    switch (level) {
      case 'green': return 'rgba(0,196,140,0.08)';
      case 'yellow': return 'rgba(255,215,0,0.08)';
      case 'red': return 'rgba(255,77,77,0.08)';
    }
  };

  const getStatusBorder = (level: StatusLevel) => {
    switch (level) {
      case 'green': return 'rgba(0,196,140,0.2)';
      case 'yellow': return 'rgba(255,215,0,0.2)';
      case 'red': return 'rgba(255,77,77,0.2)';
    }
  };

  const overallStatus: StatusLevel = countMismatch || appVsApiMismatch ? 'red' : (status?.publishedDealsCount === 0 ? 'yellow' : 'green');

  const renderDiagRow = (item: DiagnosticItem) => (
    <View key={item.id} style={styles.diagRow}>
      <View style={styles.diagLeft}>
        {getStatusIcon(item.status)}
        <View style={styles.diagTextWrap}>
          <Text style={styles.diagLabel}>{item.label}</Text>
          {item.detail ? <Text style={styles.diagDetail}>{item.detail}</Text> : null}
        </View>
      </View>
      <Text style={[styles.diagValue, { color: item.status === 'red' ? '#FF4D4D' : item.status === 'green' ? '#00C48C' : Colors.text }]}>{item.value}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Sync Diagnostics</Text>
          <Text style={styles.headerSub}>App vs Landing Page Health</Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.refreshBtn}
          disabled={refreshing}
        >
          <RefreshCw size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={[styles.overallCard, { backgroundColor: getStatusBg(overallStatus), borderColor: getStatusBorder(overallStatus) }]}>
          <View style={styles.overallRow}>
            {overallStatus === 'green' ? (
              <Shield size={28} color="#00C48C" />
            ) : overallStatus === 'yellow' ? (
              <AlertTriangle size={28} color="#FFD700" />
            ) : (
              <XCircle size={28} color="#FF4D4D" />
            )}
            <View style={styles.overallTextWrap}>
              <Text style={styles.overallTitle}>
                {overallStatus === 'green' ? 'All Systems In Sync' :
                 overallStatus === 'yellow' ? 'Attention Required' : 'Sync Issues Detected'}
              </Text>
              <Text style={styles.overallSub}>
                {overallStatus === 'green'
                  ? 'App and landing page are displaying the same deal data from jv_deals.'
                  : countMismatch
                    ? `jv_deals has ${status?.publishedDealsCount} published deals but landing_deals has ${status?.landingDealsCount}. Run sync to fix.`
                    : appVsApiMismatch
                      ? `App shows ${appVisibleCount} deals but API has ${status?.publishedDealsCount}. Refresh or check filters.`
                      : 'No published deals found. Publish deals to populate both app and landing.'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Shield size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Live Admin Audit</Text>
        </View>

        <View style={styles.auditPanelCard} testID="sync-diagnostics-admin-audit-panel">
          <Text style={styles.auditPanelTitle}>Owner, member, backend, deploy, and readiness status</Text>
          <Text style={styles.auditPanelSubtext}>This panel stays visible so admin can verify trusted access, registration durability, write-path readiness, and the live 30K audit in one place.</Text>
          {adminAuditCards.map((card) => (
            <View key={card.id} style={styles.auditGroupCard}>
              <Text style={styles.auditGroupTitle}>{card.title}</Text>
              {card.items.map((item) => (
                <View key={item.id} style={styles.auditItemRow}>
                  <View style={styles.auditItemTextWrap}>
                    <Text style={styles.auditItemLabel}>{item.label}</Text>
                    {item.detail ? <Text style={styles.auditItemDetail}>{item.detail}</Text> : null}
                  </View>
                  <Text style={[
                    styles.auditItemValue,
                    { color: item.status === 'green' ? '#00C48C' : item.status === 'red' ? '#FF7D7D' : '#FFD36A' },
                  ]}>
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {(countMismatch || appVsApiMismatch) ? (
          <TouchableOpacity
            style={styles.syncBtn}
            onPress={() => forceSyncMutation.mutate()}
            disabled={forceSyncMutation.isPending}
            activeOpacity={0.85}
          >
            {forceSyncMutation.isPending ? (
              <ShimmerIndicator size="small" color="#000" />
            ) : (
              <Zap size={18} color="#000" />
            )}
            <Text style={styles.syncBtnText}>
              {forceSyncMutation.isPending ? 'Syncing...' : 'Force Sync Now'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {forceSyncMutation.isSuccess ? (
          <View style={styles.syncResult}>
            <CheckCircle2 size={14} color="#00C48C" />
            <Text style={styles.syncResultText}>
              Sync completed: {forceSyncMutation.data?.syncedDeals} deals synced
              {forceSyncMutation.data?.errors.length ? ` (${forceSyncMutation.data.errors.length} errors)` : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Database size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Data Sources</Text>
        </View>

        {diagnostics.slice(0, 4).map(renderDiagRow)}

        <View style={styles.sectionHeader}>
          <Layers size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Sync Health</Text>
        </View>

        {diagnostics.slice(4, 8).map(renderDiagRow)}

        <View style={styles.sectionHeader}>
          <Globe size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Content Consistency</Text>
        </View>

        {diagnostics.slice(8).map(renderDiagRow)}

        <View style={styles.sectionHeader}>
          <ImageIcon size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Deal Image Health</Text>
        </View>

        {imageAuditQuery.isPending ? (
          <View style={styles.imageAuditEmptyCard}>
            <ShimmerIndicator size="small" color={Colors.primary} />
            <Text style={styles.imageAuditEmptyTitle}>Scanning published deal media</Text>
            <Text style={styles.imageAuditEmptyText}>Checking each live deal for DB, Storage, and Fallback image paths.</Text>
          </View>
        ) : imageDiagnosticsList.length === 0 ? (
          <View style={styles.imageAuditEmptyCard}>
            <AlertTriangle size={18} color="#FFD700" />
            <Text style={styles.imageAuditEmptyTitle}>No published deals to audit yet</Text>
            <Text style={styles.imageAuditEmptyText}>Publish at least one deal and this panel will show photo-source health before ads go live.</Text>
          </View>
        ) : (
          <>
            <View style={styles.imageAuditSummaryCard}>
              <View style={styles.imageAuditSummaryRow}>
                <View style={styles.imageAuditStat}>
                  <Text style={styles.imageAuditStatValue}>{imageAuditSummary.total}</Text>
                  <Text style={styles.imageAuditStatLabel}>Deals</Text>
                </View>
                <View style={styles.imageAuditStat}>
                  <Text style={[styles.imageAuditStatValue, { color: '#00C48C' }]}>{imageAuditSummary.healthy}</Text>
                  <Text style={styles.imageAuditStatLabel}>Healthy</Text>
                </View>
                <View style={styles.imageAuditStat}>
                  <Text style={[styles.imageAuditStatValue, { color: '#FFD36A' }]}>{imageAuditSummary.warning}</Text>
                  <Text style={styles.imageAuditStatLabel}>Warning</Text>
                </View>
                <View style={styles.imageAuditStat}>
                  <Text style={[styles.imageAuditStatValue, { color: '#FF7D7D' }]}>{imageAuditSummary.broken}</Text>
                  <Text style={styles.imageAuditStatLabel}>Broken</Text>
                </View>
              </View>
              <Text style={styles.imageAuditSummaryText}>
                Sources — DB: {imageAuditSummary.db} · Storage: {imageAuditSummary.storage} · Fallback: {imageAuditSummary.fallback} · Missing: {imageAuditSummary.missing}
              </Text>
            </View>

            {imageDiagnosticsList.map((item) => {
              const sourcePresentation = getPhotoSourcePresentation(item.source);
              const healthPresentation = getPhotoHealthPresentation(item.status);

              return (
                <View key={item.dealId || item.dealTitle} style={styles.imageDealCard} testID={`image-health-${item.dealId}`}>
                  <View style={styles.imageDealTopRow}>
                    <View style={styles.imageDealTitleWrap}>
                      <Text style={styles.imageDealTitle}>{item.dealTitle}</Text>
                      <Text style={styles.imageDealSubtitle}>
                        Live {item.resolvedPhotos.length} · DB {item.dbPhotos.length} · Storage {item.storagePhotos.length} · Fallback {item.fallbackPhotos.length}
                      </Text>
                    </View>
                    <View style={styles.imageBadgeRow}>
                      <View style={[
                        styles.imageBadge,
                        {
                          backgroundColor: sourcePresentation.backgroundColor,
                          borderColor: sourcePresentation.borderColor},
                      ]}>
                        <Text style={[styles.imageBadgeText, { color: sourcePresentation.textColor }]}>{sourcePresentation.label}</Text>
                      </View>
                      <View style={[
                        styles.imageBadge,
                        {
                          backgroundColor: healthPresentation.backgroundColor,
                          borderColor: healthPresentation.borderColor},
                      ]}>
                        <Text style={[styles.imageBadgeText, { color: healthPresentation.textColor }]}>{healthPresentation.label}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.imageDealDescription}>{item.sourceDescription}</Text>
                  {item.issues.length > 0 ? (
                    <View style={styles.imageIssueList}>
                      {item.issues.map((issue, index) => (
                        <View key={`${item.dealId}-issue-${index}`} style={styles.imageIssueRow}>
                          <AlertTriangle size={12} color="#FFD36A" />
                          <Text style={styles.imageIssueText}>{issue}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.imageIssueRow}>
                      <CheckCircle2 size={12} color="#00C48C" />
                      <Text style={styles.imageIssueText}>Primary deal images are ready for investor traffic.</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        <View style={styles.sectionHeader}>
          <Activity size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Performance Metrics</Text>
        </View>

        <View style={styles.perfCard}>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Cache Hit Rate</Text>
            <Text style={[styles.perfValue, { color: cacheStats.cacheHitRate > 50 ? '#00C48C' : '#FFD700' }]}>
              {cacheStats.cacheHitRate}%
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Last Fetch Latency</Text>
            <Text style={[styles.perfValue, {
              color: (cacheStats.lastFetchLatencyMs ?? 0) < 500 ? '#00C48C' :
                     (cacheStats.lastFetchLatencyMs ?? 0) < 2000 ? '#FFD700' : '#FF4D4D'
            }]}>
              {cacheStats.lastFetchLatencyMs != null ? `${cacheStats.lastFetchLatencyMs}ms` : 'N/A'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Total API Fetches</Text>
            <Text style={styles.perfValue}>{cacheStats.totalFetches}</Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Cache Hits</Text>
            <Text style={styles.perfValue}>{cacheStats.cacheHits}</Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Cached Deals</Text>
            <Text style={styles.perfValue}>{cacheStats.cachedDealCount}</Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Cache Source</Text>
            <Text style={styles.perfValue}>{cacheStats.cachedSource ?? 'none'}</Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Perf Tracked Endpoints</Text>
            <Text style={styles.perfValue}>{perfSummary.trackedEndpoints}</Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Memory Warnings</Text>
            <Text style={[styles.perfValue, { color: perfSummary.memoryWarnings > 0 ? '#FF4D4D' : '#00C48C' }]}>
              {perfSummary.memoryWarnings}
            </Text>
          </View>
          {perfSummary.slowestApi ? (
            <View style={styles.perfRow}>
              <Text style={styles.perfLabel}>Slowest API</Text>
              <Text style={styles.perfValue}>{perfSummary.slowestApi.endpoint} ({perfSummary.slowestApi.avgMs}ms)</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <BarChart3 size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Claim Validation</Text>
        </View>

        <View style={styles.claimCard}>
          <Text style={styles.claimCardTitle}>Removed Claims (Do NOT use publicly)</Text>
          {CANONICAL_CLAIMS.removedClaims.map((claim, i) => (
            <View key={`removed-${i}`} style={styles.claimRow}>
              <XCircle size={14} color="#FF4D4D" />
              <Text style={styles.claimRemovedText}>{claim}</Text>
            </View>
          ))}
        </View>

        <View style={styles.claimCard}>
          <Text style={styles.claimCardTitle}>Approved Disclaimers</Text>
          {CANONICAL_CLAIMS.disclaimers.map((d, i) => (
            <View key={`disc-${i}`} style={styles.claimRow}>
              <CheckCircle2 size={14} color="#00C48C" />
              <Text style={styles.claimApprovedText}>{d}</Text>
            </View>
          ))}
        </View>

        <View style={styles.claimCard}>
          <Text style={styles.claimCardTitle}>Active Claim Checks</Text>
          {claimChecks.map((check, i) => (
            <View key={`check-${i}`} style={styles.claimRow}>
              {check.valid ? (
                <CheckCircle2 size={14} color="#00C48C" />
              ) : (
                <XCircle size={14} color="#FF4D4D" />
              )}
              <View style={styles.claimTextWrap}>
                <Text style={[styles.claimCheckText, { color: check.valid ? '#00C48C' : '#FF4D4D' }]}>
                  {check.claim}
                </Text>
                {check.reason ? <Text style={styles.claimReasonText}>{check.reason}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Globe size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Deployment Pipeline</Text>
        </View>

        <View style={styles.pipelineCard}>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Pipeline</Text>
            <Text style={[styles.perfValue, { color: deployStatus.publicDeployConfigured ? '#00C48C' : '#FFD700' }]}>
              {deployStatus.pipelineLabel}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>GitHub Actions</Text>
            <Text style={[styles.perfValue, { color: deployStatus.githubActionsConfigured ? '#00C48C' : '#FFD700' }]}>
              {deployStatus.githubActionsConfigured ? 'Ready' : 'Missing'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>GitHub Repository</Text>
            <Text style={[styles.perfValue, { color: deployStatus.githubRepositoryConfigured ? '#00C48C' : '#FF7D7D' }]}>
              {deployStatus.githubRepository || 'Not set'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>AWS S3</Text>
            <Text style={[styles.perfValue, { color: deployStatus.awsConfigured ? '#00C48C' : '#FFD700' }]}>
              {deployStatus.awsConfigured ? 'Configured' : 'Needs review'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>S3 Bucket</Text>
            <Text style={[styles.perfValue, { color: deployStatus.s3Bucket ? '#00C48C' : '#FF7D7D' }]}>
              {deployStatus.s3Bucket || 'Not set'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>AWS Region</Text>
            <Text style={[styles.perfValue, { color: deployStatus.awsRegion ? '#00C48C' : '#FF7D7D' }]}>
              {deployStatus.awsRegion || 'Not set'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>CloudFront</Text>
            <Text style={[styles.perfValue, { color: deployStatus.cloudFrontConfigured ? '#00C48C' : '#FFD700' }]}>
              {deployStatus.cloudFrontConfigured ? deployStatus.cloudFrontDistributionId : 'Optional / pending'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Auto-deploy</Text>
            <Text style={[styles.perfValue, { color: autoDeployQuery.data?.config.enabled ? '#00C48C' : '#FFD700' }]}>
              {autoDeployQuery.data?.config.enabled ? 'Enabled' : 'Disabled'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Publish trigger</Text>
            <Text style={[styles.perfValue, { color: autoDeployQuery.data?.config.deployOnDealPublish ? '#00C48C' : '#FFD700' }]}>
              {autoDeployQuery.data?.config.deployOnDealPublish ? 'On' : 'Off'}
            </Text>
          </View>
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>Last auto-deploy</Text>
            <Text style={styles.perfValue}>
              {autoDeployQuery.data?.lastDeploy?.timestamp ? new Date(autoDeployQuery.data.lastDeploy.timestamp).toLocaleString() : 'Never'}
            </Text>
          </View>
          {deployStatus.missingRequirements.length > 0 ? (
            <View style={styles.pipelineErrorBox}>
              <Text style={styles.pipelineErrorTitle}>Missing pipeline requirements</Text>
              {deployStatus.missingRequirements.map((item, index) => (
                <Text key={`pipeline-missing-${index}`} style={styles.pipelineErrorText}>{item}</Text>
              ))}
            </View>
          ) : null}
          {autoDeployQuery.data?.lastDeploy?.errors?.length ? (
            <View style={styles.pipelineErrorBox}>
              <Text style={styles.pipelineErrorTitle}>Latest deploy issues</Text>
              {autoDeployQuery.data.lastDeploy.errors.slice(0, 3).map((error, index) => (
                <Text key={`pipeline-error-${index}`} style={styles.pipelineErrorText}>{error}</Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Clock size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Architecture (Backend-Only Deploy)</Text>
        </View>

        <View style={styles.archCard}>
          <Text style={styles.archTitle}>Data Flow</Text>
          <View style={styles.archFlow}>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>jv_deals</Text>
              <Text style={styles.archNodeSub}>Source of Truth</Text>
            </View>
            <Text style={styles.archArrow}>{"→"}</Text>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>App</Text>
              <Text style={styles.archNodeSub}>usePublishedJVDeals()</Text>
            </View>
          </View>
          <View style={styles.archFlow}>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>jv_deals</Text>
              <Text style={styles.archNodeSub}>Source of Truth</Text>
            </View>
            <Text style={styles.archArrow}>{"→"}</Text>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>landing_deals</Text>
              <Text style={styles.archNodeSub}>Auto-derived</Text>
            </View>
            <Text style={styles.archArrow}>{"→"}</Text>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>Website</Text>
              <Text style={styles.archNodeSub}>ivxholding.com</Text>
            </View>
          </View>
          <View style={styles.archFlow}>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>Shared Model</Text>
              <Text style={styles.archNodeSub}>published-deal-card-model.ts</Text>
            </View>
            <Text style={styles.archArrow}>{"→"}</Text>
            <View style={styles.archNode}>
              <Text style={styles.archNodeTitle}>Both</Text>
              <Text style={styles.archNodeSub}>App + Landing</Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 12},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.3},
  headerSub: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,215,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center'},
  scroll: {
    flex: 1},
  overallCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18},
  overallRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14},
  overallTextWrap: {
    flex: 1},
  overallTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const,
    marginBottom: 4},
  overallSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  syncBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14},
  syncBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800' as const},
  auditPanelCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#0B1526',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.24)'},
  auditPanelTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: -0.2},
  auditPanelSubtext: {
    color: '#9DB0C9',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12},
  auditGroupCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 10},
  auditGroupTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 8},
  auditItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6},
  auditItemTextWrap: {
    flex: 1},
  auditItemLabel: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const},
  auditItemDetail: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  auditItemValue: {
    maxWidth: '44%' as const,
    fontSize: 12,
    fontWeight: '800' as const,
    textAlign: 'right'},
  syncResult: {
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,196,140,0.08)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,196,140,0.2)'},
  syncResultText: {
    color: '#00C48C',
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12},
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: -0.2},
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'},
  diagLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1},
  diagTextWrap: {
    flex: 1},
  diagLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const},
  diagDetail: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  diagValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    marginLeft: 10,
    flexShrink: 0},
  imageAuditSummaryCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 12},
  imageAuditSummaryRow: {
    flexDirection: 'row',
    gap: 10},
  imageAuditStat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)'},
  imageAuditStatValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const},
  imageAuditStatLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 4},
  imageAuditSummaryText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  imageAuditEmptyCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 10,
    alignItems: 'center'},
  imageAuditEmptyTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    textAlign: 'center' as const},
  imageAuditEmptyText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center' as const},
  imageDealCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 10},
  imageDealTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10},
  imageDealTitleWrap: {
    flex: 1},
  imageDealTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const},
  imageDealSubtitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 4},
  imageBadgeRow: {
    alignItems: 'flex-end',
    gap: 8},
  imageBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5},
  imageBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.7},
  imageDealDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  imageIssueList: {
    gap: 8},
  imageIssueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  imageIssueText: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18},
  perfCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 10},
  perfRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  perfLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1},
  perfValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'right' as const,
    flexShrink: 0,
    maxWidth: '50%'},
  claimCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 10},
  claimCardTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 4},
  claimRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  claimRemovedText: {
    color: '#FF4D4D',
    fontSize: 12,
    flex: 1,
    textDecorationLine: 'line-through'},
  claimApprovedText: {
    color: '#00C48C',
    fontSize: 12,
    flex: 1},
  claimTextWrap: {
    flex: 1},
  claimCheckText: {
    fontSize: 12,
    fontWeight: '600' as const},
  claimReasonText: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  pipelineCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 10},
  pipelineErrorBox: {
    marginTop: 6,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.16)',
    borderRadius: 12,
    padding: 12,
    gap: 6},
  pipelineErrorTitle: {
    color: '#FF7D7D',
    fontSize: 12,
    fontWeight: '700' as const},
  pipelineErrorText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  archCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 14},
  archTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4},
  archFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'},
  archNode: {
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8},
  archNodeTitle: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const},
  archNodeSub: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 1},
  archArrow: {
    color: Colors.textTertiary,
    fontSize: 16,
    fontWeight: '600' as const},
  bottomPad: {
    height: 100}});
