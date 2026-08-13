import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ShieldCheck,
  ShieldAlert,
  FileCheck,
  Building,
  Ban,
  BadgeCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { ownerApi, type OwnerProfile, type ComplianceStep } from '@/lib/ivx-owner-api';
import { EmptyState } from '@/components/ProgressiveStates';

const fontWeightBold = 'bold' as const;
const fontWeightSemiBold = '600' as const;
const fontWeightMedium = '500' as const;

type StatusKey = 'verified' | 'approved' | 'passed' | 'completed' | 'pending' | 'in_review' | 'not_started' | 'not_checked' | 'rejected' | 'failed' | 'not_submitted';

function statusColor(status: string): string {
  const positiveStatuses = ['verified', 'approved', 'passed', 'completed'];
  const pendingStatuses = ['pending', 'in_review', 'in progress'];
  const negativeStatuses = ['rejected', 'failed'];

  if (positiveStatuses.some((s) => status.includes(s))) return Colors.success;
  if (pendingStatuses.some((s) => status.includes(s))) return Colors.warning;
  if (negativeStatuses.some((s) => status.includes(s))) return Colors.error;
  return Colors.textSecondary;
}

function statusIcon(status: string): React.ReactNode {
  const color = statusColor(status);
  if (status.includes('verified') || status.includes('approved') || status.includes('passed') || status.includes('completed')) {
    return <CheckCircle2 size={20} color={color} />;
  }
  if (status.includes('pending') || status.includes('review') || status.includes('progress')) {
    return <Clock size={20} color={color} />;
  }
  if (status.includes('rejected') || status.includes('failed')) {
    return <XCircle size={20} color={color} />;
  }
  return <AlertCircle size={20} color={color} />;
}

export default function ComplianceCenterScreen() {
  const router = useRouter();

  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile, isRefetching: profileRefetching } = useQuery({
    queryKey: ['owner-profile'],
    queryFn: () => ownerApi.getProfile(),
  });

  const { data: workflowData, isLoading: workflowLoading, refetch: refetchWorkflow, isRefetching: workflowRefetching } = useQuery({
    queryKey: ['compliance-workflow'],
    queryFn: () => ownerApi.getWorkflow(),
  });

  const { data: consentsData, isLoading: consentsLoading } = useQuery({
    queryKey: ['consents'],
    queryFn: () => ownerApi.getConsents(),
  });

  const profile: OwnerProfile | null = profileData?.profile ?? null;
  const steps: ComplianceStep[] = workflowData?.steps ?? [];
  const consents: unknown[] = consentsData?.consents ?? [];

  const isLoading = profileLoading || workflowLoading;
  const isRefetching = profileRefetching || workflowRefetching;

  const handleRefresh = () => {
    refetchProfile();
    refetchWorkflow();
  };

  const complianceCards = useMemo(() => {
    if (!profile) return [];
    return [
      {
        key: 'kyc',
        label: 'Identity Verification (KYC)',
        status: profile.kyc_status,
        icon: <FileCheck size={20} color={statusColor(profile.kyc_status)} />,
      },
      {
        key: 'kyb',
        label: 'Business Verification (KYB)',
        status: profile.kyb_status,
        icon: <Building size={20} color={statusColor(profile.kyb_status)} />,
      },
      {
        key: 'sanctions',
        label: 'Sanctions & AML Screening',
        status: profile.sanctions_status,
        icon: <Ban size={20} color={statusColor(profile.sanctions_status)} />,
      },
      {
        key: 'accreditation',
        label: 'Investor Accreditation',
        status: profile.accreditation_status,
        icon: <BadgeCheck size={20} color={statusColor(profile.accreditation_status)} />,
      },
    ];
  }, [profile]);

  const overallProgress = useMemo(() => {
    if (!profile) return 0;
    const statuses = [profile.kyc_status, profile.kyb_status, profile.sanctions_status, profile.accreditation_status];
    const completed = statuses.filter((s) => s.includes('verified') || s.includes('approved') || s.includes('passed')).length;
    return (completed / statuses.length) * 100;
  }, [profile]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading compliance status…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={Colors.gold}
            colors={[Colors.gold]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Compliance</Text>
          <Text style={styles.headerSubtitle}>
            Verification & regulatory status
          </Text>
        </View>

        {/* Overall Progress */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.progressLabel}>Overall Compliance</Text>
              <Text style={styles.progressValue}>{Math.round(overallProgress)}%</Text>
            </View>
            {overallProgress === 100 ? (
              <ShieldCheck size={28} color={Colors.success} />
            ) : (
              <ShieldAlert size={28} color={Colors.warning} />
            )}
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${overallProgress}%` },
              ]}
            />
          </View>
        </View>

        {/* Verification Cards */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Verification Status</Text>
        </View>
        <View style={styles.cardsList}>
          {complianceCards.map((card: { key: string; label: string; status: string; icon: React.ReactNode }) => (
            <View key={card.key} style={styles.statusCard}>
              <View style={styles.statusCardLeft}>
                <View style={[styles.statusIcon, { backgroundColor: `${statusColor(card.status)}15` }]}>
                  {card.icon}
                </View>
                <View>
                  <Text style={styles.statusLabel}>{card.label}</Text>
                  <Text style={[styles.statusValue, { color: statusColor(card.status) }]}>
                    {card.status.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
              {statusIcon(card.status)}
            </View>
          ))}
        </View>

        {/* Risk Rating */}
        {profile?.risk_rating && (
          <View style={styles.riskCard}>
            <Text style={styles.riskLabel}>Risk Rating</Text>
            <Text style={[styles.riskValue, { color: statusColor(profile.risk_rating) }]}>
              {profile.risk_rating}
            </Text>
          </View>
        )}

        {/* Compliance Workflow */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Workflow Steps</Text>
        </View>
        {steps.length === 0 ? (
          <EmptyState
            title="No workflow steps"
            message="Compliance workflow steps will appear here when assigned."
          />
        ) : (
          <View style={styles.stepsList}>
            {steps.map((step: ComplianceStep) => (
              <React.Fragment key={step.id}>
                <WorkflowStepRow step={step} />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Consents */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Consent Records</Text>
        </View>
        {consents.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>No consent records</Text>
          </View>
        ) : (
          <View style={styles.consentsList}>
            {(consents as Record<string, unknown>[]).map((consent: Record<string, unknown>, idx: number) => (
              <View key={(consent.id as string) ?? idx} style={styles.consentRow}>
                <View style={styles.consentInfo}>
                  <Text style={styles.consentType}>
                    {String(consent.consent_type ?? 'Unknown').replace(/_/g, ' ')}
                  </Text>
                  <Text style={styles.consentDate}>
                    {consent.granted_at
                      ? new Date(consent.granted_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </Text>
                </View>
                <Text style={[
                  styles.consentStatus,
                  { color: consent.is_granted ? Colors.success : Colors.error },
                ]}>
                  {consent.is_granted ? 'Granted' : 'Revoked'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/owner-portfolio')}
          >
            <ShieldCheck size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Portfolio</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/payments-center')}
          >
            <FileCheck size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Payments</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/marketplace')}
          >
            <ChevronRight size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Marketplace</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function WorkflowStepRow({ step }: { step: ComplianceStep }) {
  const color = statusColor(step.status);
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepIcon, { backgroundColor: `${color}15` }]}>
        {statusIcon(step.status)}
      </View>
      <View style={styles.stepInfo}>
        <Text style={styles.stepName} numberOfLines={1}>
          {step.step_name}
        </Text>
        <View style={styles.stepMeta}>
          <Text style={[styles.stepStatus, { color }]}>
            {step.status.replace(/_/g, ' ')}
          </Text>
          {step.due_date && (
            <Text style={styles.stepDue}>
              Due {new Date(step.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          )}
        </View>
      </View>
      <ChevronRight size={16} color={Colors.textSecondary} />
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: fontWeightBold,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  progressCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginTop: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  progressValue: {
    fontSize: 28,
    fontWeight: fontWeightBold,
    color: Colors.gold,
    marginTop: 2,
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  cardsList: {
    gap: 10,
  },
  statusCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  statusCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  statusValue: {
    fontSize: 12,
    fontWeight: fontWeightMedium,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  riskCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  riskLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  riskValue: {
    fontSize: 16,
    fontWeight: fontWeightBold,
    textTransform: 'capitalize',
  },
  stepsList: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepInfo: {
    flex: 1,
  },
  stepName: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  stepMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  stepStatus: {
    fontSize: 11,
    fontWeight: fontWeightMedium,
    textTransform: 'capitalize',
  },
  stepDue: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  emptyInline: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyInlineText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  consentsList: {
    gap: 8,
  },
  consentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  consentInfo: {
    flex: 1,
  },
  consentType: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
    textTransform: 'capitalize',
  },
  consentDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  consentStatus: {
    fontSize: 12,
    fontWeight: fontWeightSemiBold,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  quickActionBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: fontWeightMedium,
    color: Colors.textSecondary,
  },
});
