import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
    DollarSign,
  Building2,
  Percent,
  Settings,
  Lock,
  Unlock,
  Edit3,
  X,
  Check,
  ChevronRight,
  AlertCircle,
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  ArrowLeft,
  Key,
  Eye,
  MessageSquare,
  Trash2,
  Wifi,
  Fingerprint,
  ShieldCheck,
  WifiOff,
  LayoutGrid,
  Search,
  Globe,
  Database,
  Server,
  Rocket,
  Bot,
  Users,
  Mail,
  BarChart3,
  Megaphone,
  Shield,
  Activity,
  KeyRound,
  Network,
  Monitor,
  RefreshCw,
  Sliders,
  Zap,
  FileText,
  ExternalLink,
  Home as HomeIcon,
  TrendingUp,
  Briefcase,
  User as UserIcon,
  LayoutDashboard,
  Code,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJVDeals, archiveJVDeal } from '@/lib/jv-storage';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import { useAuth, getStoredOwnerIP, clearOwnerIP } from '@/lib/auth-context';

import { supabase } from '@/lib/supabase';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';
import { useFeeConfigurations } from '@/lib/admin-queries';
import { useUpsertFeeConfiguration, useUpsertPlatformSetting, usePlatformSettings, useUpsertPropertyControl, probePersistenceHealth, applyPlatformPersistenceMigration, type PersistenceHealth, type ApplyMigrationResult } from '@/lib/platform-persistence';

import { Property, FeeConfiguration } from '@/types';

interface PlatformSettings {
  minInvestment: number;
  maxInvestment: number;
  platformFeePercent: number;
  dividendDistributionDay: number;
  autoReinvestEnabled: boolean;
  maintenanceMode: boolean;
  newSignupsEnabled: boolean;
  tradingEnabled: boolean;
}

interface PropertyControl extends Property {
  tradingPaused: boolean;
  priceAdjustment: number;
  ownerShare: number;
}

interface JVDealControl {
  id: string;
  name: string;
  location: string;
  type: string;
  totalInvestment: number;
  currentRaised: number;
  targetAmount: number;
  expectedROI: number;
  status: string;
  ownerShare: number;
  tradingPaused: boolean;
}

function OwnerIPAccessCard() {
  const { isOwnerIPAccess, detectedIP, activateOwnerAccess } = useAuth();
  const [storedIP, setStoredIP] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getStoredOwnerIP().then(setStoredIP);
  }, [isOwnerIPAccess]);

  const handleActivate = async () => {
    setLoading(true);
    try {
      const result = await activateOwnerAccess();
      if (result.success) {
        const ip = await getStoredOwnerIP();
        setStoredIP(ip);
        Alert.alert('Trusted Device Updated', result.message);
      } else {
        Alert.alert('Failed', result.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    Alert.alert('Deactivate Trusted Owner Access', 'This will require normal login next time on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          await clearOwnerIP();
          setStoredIP(null);
          Alert.alert('Deactivated', 'Trusted owner auto-access disabled. You will need to sign in next time.');
        },
      },
    ]);
  };

  return (
    <View style={ipCardStyles.container}>
      <View style={ipCardStyles.header}>
        <View style={[ipCardStyles.iconWrap, { backgroundColor: isOwnerIPAccess ? '#00C48C20' : '#4A90D920' }]}>
          {isOwnerIPAccess ? <Wifi size={20} color="#00C48C" /> : <WifiOff size={18} color="#4A90D9" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ipCardStyles.title}>Trusted Owner Device</Text>
          <Text style={ipCardStyles.sub}>
            {isOwnerIPAccess
              ? `Active · IP: ${detectedIP ?? storedIP ?? 'detected'}`
              : storedIP
                ? `Verified IP: ${storedIP}`
                : 'Not configured'}
          </Text>
        </View>
        {isOwnerIPAccess && (
          <View style={ipCardStyles.liveBadge}>
            <View style={ipCardStyles.liveDot} />
            <Text style={ipCardStyles.liveText}>ACTIVE</Text>
          </View>
        )}
      </View>
      <View style={ipCardStyles.actions}>
        {!storedIP ? (
          <TouchableOpacity
            style={ipCardStyles.activateBtn}
            onPress={handleActivate}
            disabled={loading}
          >
            <Fingerprint size={16} color="#000" />
            <Text style={ipCardStyles.activateBtnText}>
              {loading ? 'Verifying...' : 'Verify This Device'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={ipCardStyles.actionRow}>
            <TouchableOpacity
              style={ipCardStyles.refreshBtn}
              onPress={handleActivate}
              disabled={loading}
            >
              <Wifi size={14} color={Colors.primary} />
              <Text style={ipCardStyles.refreshBtnText}>{loading ? 'Updating...' : 'Refresh Verification'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ipCardStyles.deactivateBtn} onPress={handleDeactivate}>
              <WifiOff size={14} color={Colors.negative} />
              <Text style={ipCardStyles.deactivateBtnText}>Deactivate</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const ipCardStyles = StyleSheet.create({
  container: {
    backgroundColor: '#0A1520',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#4A90D930',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  sub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#00C48C18',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00C48C',
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#00C48C',
    letterSpacing: 0.5,
  },
  actions: {
    marginTop: 12,
  },
  activateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  activateBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#000',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  refreshBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '18',
    borderRadius: 10,
    paddingVertical: 10,
  },
  refreshBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  deactivateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.negative + '15',
    borderRadius: 10,
    paddingVertical: 10,
  },
  deactivateBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.negative,
  },
});

export default function OwnerControlsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'revenue' | 'properties' | 'fees' | 'settings' | 'modules'>('modules');
  const [moduleSearch, setModuleSearch] = useState<string>('');
  const [editFeeModalVisible, setEditFeeModalVisible] = useState(false);
  const [editPropertyModalVisible, setEditPropertyModalVisible] = useState(false);
  
  const [selectedFee, setSelectedFee] = useState<FeeConfiguration | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<PropertyControl | null>(null);

  const platformSettingsQuery = usePlatformSettings('platform');
  const upsertSetting = useUpsertPlatformSetting();
  const upsertPropertyControl = useUpsertPropertyControl();
  const { configurations: feeConfigurations } = useFeeConfigurations();
  const upsertFee = useUpsertFeeConfiguration();
  const [healthRows, setHealthRows] = useState<PersistenceHealth[] | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [migrationApplying, setMigrationApplying] = useState<boolean>(false);
  const [lastMigration, setLastMigration] = useState<ApplyMigrationResult | null>(null);

  const runHealthProbe = async () => {
    setHealthLoading(true);
    try {
      const rows = await probePersistenceHealth();
      setHealthRows(rows);
    } catch (e) {
      console.log('[Owner Controls] persistence probe failed:', e);
    } finally {
      setHealthLoading(false);
    }
  };

  const applyMigration = async () => {
    setMigrationApplying(true);
    try {
      const result = await applyPlatformPersistenceMigration();
      setLastMigration(result);
      if (result.ok) {
        const rows = await probePersistenceHealth();
        setHealthRows(rows);
      }
    } catch (e) {
      console.log('[Owner Controls] migration apply failed:', e);
      setLastMigration({ ok: false, endpoint: '', httpStatus: 0, command: null, rowCount: null, error: String(e), timestamp: new Date().toISOString() });
    } finally {
      setMigrationApplying(false);
    }
  };

  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>({
    minInvestment: 100,
    maxInvestment: 1000000,
    platformFeePercent: 2.5,
    dividendDistributionDay: 15,
    autoReinvestEnabled: true,
    maintenanceMode: false,
    newSignupsEnabled: true,
    tradingEnabled: true,
  });

  useEffect(() => {
    const rows = platformSettingsQuery.data ?? [];
    if (rows.length === 0) return;
    const next: Partial<PlatformSettings> = {};
    for (const r of rows) {
      const v = r.value as unknown;
      if (r.key === 'minInvestment' && typeof v === 'number') next.minInvestment = v;
      if (r.key === 'maxInvestment' && typeof v === 'number') next.maxInvestment = v;
      if (r.key === 'platformFeePercent' && typeof v === 'number') next.platformFeePercent = v;
      if (r.key === 'dividendDistributionDay' && typeof v === 'number') next.dividendDistributionDay = v;
      if (r.key === 'autoReinvestEnabled' && typeof v === 'boolean') next.autoReinvestEnabled = v;
      if (r.key === 'maintenanceMode' && typeof v === 'boolean') next.maintenanceMode = v;
      if (r.key === 'newSignupsEnabled' && typeof v === 'boolean') next.newSignupsEnabled = v;
      if (r.key === 'tradingEnabled' && typeof v === 'boolean') next.tradingEnabled = v;
    }
    if (Object.keys(next).length > 0) {
      setPlatformSettings((prev) => ({ ...prev, ...next }));
    }
  }, [platformSettingsQuery.data]);

  const [editedFee, setEditedFee] = useState({
    percentage: '',
    minFee: '',
    maxFee: '',
    isActive: true,
  });

  const [editedProperty, setEditedProperty] = useState({
    tradingPaused: false,
    priceAdjustment: '',
    ownerShare: '',
  });

  const propertiesQuery = useQuery<any[]>({
    queryKey: ['admin-owner-properties'],
    queryFn: async () => {
      console.log('[Owner Controls] Fetching properties from Supabase');
      const { data, error } = await supabase.from('properties').select('*').limit(200);
      if (error) { console.log('[Owner Controls] properties error:', error.message); return []; }
      return data ?? [];
    },
    staleTime: 30000,
  });

  const statsQuery = useQuery({
    queryKey: ['admin-owner-stats'],
    queryFn: async () => {
      console.log('[Owner Controls] Fetching stats from canonical registry + Supabase');
      const [registryMembers, txRes] = await Promise.all([
        fetchAdminMemberRegistry(),
        supabase.from('transactions').select('amount,type,status').limit(1000),
      ]);
      const txData = txRes.data ?? [];
      const totalFees = txData.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0) * 0.025, 0);
      const monthFees = totalFees * 0.3;
      return {
        totalFeesCollected: totalFees,
        feesThisMonth: monthFees,
        feesByType: {
          buy: totalFees * 0.4,
          sell: totalFees * 0.25,
          withdrawal: totalFees * 0.2,
          deposit: totalFees * 0.15,
        },
        totalMembers: registryMembers.length,
        totalTransactions: txData.length,
      };
    },
    staleTime: 30000,
  });

  const feeStats = useMemo(() => statsQuery.data ?? { totalFeesCollected: 0, feesThisMonth: 0, feesByType: { buy: 0, sell: 0, withdrawal: 0, deposit: 0 }, totalMembers: 0, totalTransactions: 0, averageFeeAmount: 0 }, [statsQuery.data]);

  const propertyControls: PropertyControl[] = useMemo(() => {
    const props = propertiesQuery.data ?? [];
    return props.map((p: any, index: number) => ({
      id: p.id,
      name: p.name || 'Unnamed',
      location: p.location || '',
      city: p.location || '',
      country: 'US',
      images: [p.image || ''],
      pricePerShare: Number(p.share_price) || 0,
      totalShares: Number(p.total_shares) || 1000,
      availableShares: Number(p.available_shares) || 0,
      minInvestment: 100,
      targetRaise: Number(p.price) || 0,
      currentRaise: (Number(p.total_shares) - Number(p.available_shares)) * Number(p.share_price) || 0,
      yield: Number(p.annual_yield) || 0,
      capRate: 0,
      irr: 0,
      occupancy: Number(p.occupancy_rate) || 0,
      propertyType: (p.type || 'residential') as any,
      status: (p.status || 'active') as any,
      riskLevel: 'medium' as const,
      description: '',
      highlights: [],
      documents: [],
      distributions: [],
      priceHistory: [],
      createdAt: p.created_at || new Date().toISOString(),
      closingDate: '',
      tradingPaused: index === 2,
      priceAdjustment: 0,
      ownerShare: 15 + (index * 2),
    }));
  }, [propertiesQuery.data]);

  const jvQuery = useQuery<any>({
    queryKey: ['jvAgreements.list'],
    queryFn: async () => {
      console.log('[JV-Storage] Fetching JV deals for owner controls');
      const result = await fetchJVDeals({ limit: 50 });
      return { deals: result.deals ?? [] };
    },
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const jvDealControls: JVDealControl[] = useMemo(() => {
    const deals = (jvQuery.data?.deals ?? []) as Array<{
      id: string;
      projectName: string;
      propertyAddress?: string;
      type: string;
      totalInvestment: number;
      expectedROI: number;
      status: string;
      partners: Array<{ equityShare: number }>;
      poolTiers?: Array<{ targetAmount: number; currentRaised: number }>;
    }>;
    console.log('[Owner Controls] Real JV deals from backend:', deals.length, deals.map(d => `${d.id}: ${d.projectName}`));
    return deals.map((jv) => {
      const totalTarget = jv.poolTiers?.reduce((sum, t) => sum + t.targetAmount, 0) ?? jv.totalInvestment;
      const totalRaised = jv.poolTiers?.reduce((sum, t) => sum + t.currentRaised, 0) ?? 0;
      return {
        id: jv.id,
        name: jv.projectName,
        location: jv.propertyAddress ?? '',
        type: jv.type,
        totalInvestment: jv.totalInvestment,
        currentRaised: totalRaised,
        targetAmount: totalTarget,
        expectedROI: jv.expectedROI,
        status: jv.status,
        ownerShare: jv.partners?.[0]?.equityShare ?? 0,
        tradingPaused: false,
      };
    });
  }, [jvQuery.data]);

  const totalRevenue = useMemo(() => {
    const feeRevenue = feeStats.totalFeesCollected;
    const propertyCommissions = propertyControls.reduce((sum, p) => {
      return sum + (p.currentRaise * 0.025);
    }, 0);
    return feeRevenue + propertyCommissions;
  }, [feeStats, propertyControls]);

  const monthlyRevenue = useMemo(() => {
    return feeStats.feesThisMonth + (propertyControls.reduce((sum, p) => p.currentRaise, 0) * 0.025 / 12);
  }, [feeStats, propertyControls]);

  const formatCurrency = (amount: number) => formatCurrencyWithDecimals(amount);

  const formatPrice = (amount: number) => {
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
  };

  const safePercent = (part: number, total: number): string => {
    const p = Number(part) || 0;
    const t = Number(total) || 0;
    if (t === 0) return '0.0';
    const result = (p / t) * 100;
    if (!isFinite(result) || isNaN(result)) return '0.0';
    return result.toFixed(1);
  };

  const openEditFeeModal = (fee: FeeConfiguration) => {
    setSelectedFee(fee);
    setEditedFee({
      percentage: fee.percentage.toString(),
      minFee: fee.minFee.toString(),
      maxFee: fee.maxFee.toString(),
      isActive: fee.isActive,
    });
    setEditFeeModalVisible(true);
  };

  const openEditPropertyModal = (property: PropertyControl) => {
    setSelectedProperty(property);
    setEditedProperty({
      tradingPaused: property.tradingPaused,
      priceAdjustment: property.priceAdjustment.toString(),
      ownerShare: property.ownerShare.toString(),
    });
    setEditPropertyModalVisible(true);
  };

  const handleSaveFee = async () => {
    if (!selectedFee) return;
    const percentage = parseFloat(editedFee.percentage);
    const minFee = parseFloat(editedFee.minFee || '0');
    const maxFee = parseFloat(editedFee.maxFee || '0');
    if (isNaN(percentage) || percentage < 0 || percentage > 50) {
      Alert.alert('Invalid Input', 'Percentage must be between 0 and 50%');
      return;
    }
    try {
      await upsertFee.mutateAsync({
        id: selectedFee.id,
        type: selectedFee.type,
        name: selectedFee.name,
        percentage,
        minFee: isNaN(minFee) ? 0 : minFee,
        maxFee: isNaN(maxFee) ? 0 : maxFee,
        isActive: editedFee.isActive,
      });
      Alert.alert('Success', 'Fee configuration saved to database');
      setEditFeeModalVisible(false);
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Unknown error');
    }
  };

  const handleSaveProperty = async () => {
    if (!selectedProperty) return;
    const ownerShare = parseFloat(editedProperty.ownerShare);
    const priceAdjustment = parseFloat(editedProperty.priceAdjustment || '0');
    if (isNaN(ownerShare) || ownerShare < 0 || ownerShare > 100) {
      Alert.alert('Invalid Input', 'Owner share must be between 0 and 100%');
      return;
    }
    try {
      await upsertPropertyControl.mutateAsync({
        propertyId: selectedProperty.id,
        isLocked: editedProperty.tradingPaused,
        overridePrice: isNaN(priceAdjustment) ? null : priceAdjustment,
        metadata: { ownerShare, priceAdjustmentPercent: isNaN(priceAdjustment) ? 0 : priceAdjustment },
      });
      Alert.alert('Success', 'Property controls saved to database');
      setEditPropertyModalVisible(false);
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Unknown error');
    }
  };

  const handleToggleTrading = (property: PropertyControl) => {
    const action = property.tradingPaused ? 'resume' : 'pause';
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Trading`,
      `Are you sure you want to ${action} trading for ${property.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            Alert.alert('Success', `Trading ${action}d for ${property.name}`);
          },
        },
      ]
    );
  };

  const handleSaveSettings = async () => {
    try {
      const entries: Array<{ key: string; value: unknown }> = [
        { key: 'minInvestment', value: platformSettings.minInvestment },
        { key: 'maxInvestment', value: platformSettings.maxInvestment },
        { key: 'platformFeePercent', value: platformSettings.platformFeePercent },
        { key: 'dividendDistributionDay', value: platformSettings.dividendDistributionDay },
        { key: 'autoReinvestEnabled', value: platformSettings.autoReinvestEnabled },
        { key: 'maintenanceMode', value: platformSettings.maintenanceMode },
        { key: 'newSignupsEnabled', value: platformSettings.newSignupsEnabled },
        { key: 'tradingEnabled', value: platformSettings.tradingEnabled },
      ];
      for (const e of entries) {
        await upsertSetting.mutateAsync({ key: e.key, value: e.value, category: 'platform' });
      }
      Alert.alert('Success', 'Platform settings saved to database');
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Unknown error');
    }
  };

  const renderRevenue = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.ownerBadge}>
        <IVXBrandIcon size={24} />
        <Text style={styles.ownerBadgeText}>Owner Dashboard</Text>
      </View>

      <OwnerIPAccessCard />

      <TouchableOpacity
        style={[styles.staffActivityLink, { borderColor: '#FFD70040' }]}
        onPress={() => router.push('/ivx/independence' as any)}
        testID="owner-dashboard-independence-tracker-link"
      >
        <View style={[styles.revenueIcon, { backgroundColor: '#FFD70020' }]}> 
          <ShieldCheck size={20} color="#FFD700" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffActivityTitle}>Independence Tracker</Text>
          <Text style={styles.staffActivityDesc}>7-day external dependency removal plan and proof route</Text>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.staffActivityLink}
        onPress={() => router.push('/admin/staff-activity')}
      >
        <View style={[styles.revenueIcon, { backgroundColor: '#9B59B6' + '20' }]}>
          <Eye size={20} color="#9B59B6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffActivityTitle}>Staff Activity Tracker</Text>
          <Text style={styles.staffActivityDesc}>See what your staff views & does</Text>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.staffActivityLink, { borderColor: '#2ECC7130' }]}
        onPress={() => router.push('/sms-reports' as any)}
      >
        <View style={[styles.revenueIcon, { backgroundColor: '#2ECC71' + '20' }]}>
          <MessageSquare size={20} color="#2ECC71" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffActivityTitle}>SMS Reports</Text>
          <Text style={styles.staffActivityDesc}>SMS deliveries for Kimberly, Sharon & more</Text>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.staffActivityLink, { borderColor: '#FFB80030' }]}
        onPress={() => router.push('/admin/jv-deals' as any)}
        testID="admin-jv-deals-link"
      >
        <View style={[styles.revenueIcon, { backgroundColor: '#FFB800' + '20' }]}>  
          <Building2 size={20} color="#FFB800" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffActivityTitle}>JV Deal Management</Text>
          <Text style={styles.staffActivityDesc}>Edit, publish & manage JV deals</Text>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>

      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <Text style={styles.heroLabel}>Total Platform Revenue</Text>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        </View>
        <Text style={styles.heroValue}>{formatCurrency(totalRevenue)}</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <ArrowUpRight size={14} color={Colors.positive} />
            <Text style={styles.heroStatText}>+23.5% this month</Text>
          </View>
        </View>
      </View>

      <View style={styles.revenueGrid}>
        <View style={styles.revenueCard}>
          <View style={[styles.revenueIcon, { backgroundColor: Colors.positive + '20' }]}>
            <Banknote size={20} color={Colors.positive} />
          </View>
          <Text style={styles.revenueLabel}>Monthly Revenue</Text>
          <Text style={styles.revenueValue}>{formatCurrency(monthlyRevenue)}</Text>
        </View>
        <View style={styles.revenueCard}>
          <View style={[styles.revenueIcon, { backgroundColor: Colors.primary + '20' }]}>
            <Percent size={20} color={Colors.primary} />
          </View>
          <Text style={styles.revenueLabel}>Fee Revenue</Text>
          <Text style={styles.revenueValue}>{formatCurrency(feeStats.totalFeesCollected)}</Text>
        </View>
        <View style={styles.revenueCard}>
          <View style={[styles.revenueIcon, { backgroundColor: Colors.accent + '20' }]}>
            <Building2 size={20} color={Colors.accent} />
          </View>
          <Text style={styles.revenueLabel}>Property Commissions</Text>
          <Text style={styles.revenueValue}>{formatCurrency(totalRevenue - feeStats.totalFeesCollected)}</Text>
        </View>
        <View style={styles.revenueCard}>
          <View style={[styles.revenueIcon, { backgroundColor: Colors.warning + '20' }]}>
            <CircleDollarSign size={20} color={Colors.warning} />
          </View>
          <Text style={styles.revenueLabel}>Pending Fees</Text>
          <Text style={styles.revenueValue}>{formatCurrency(12.50)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Revenue Breakdown</Text>
      <View style={styles.breakdownCard}>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownDot, { backgroundColor: Colors.primary }]} />
            <Text style={styles.breakdownLabel}>Buy Transaction Fees</Text>
          </View>
          <View style={styles.breakdownRight}>
            <Text style={styles.breakdownValue}>{formatCurrency(feeStats.feesByType.buy)}</Text>
            <Text style={styles.breakdownPercent}>
              {safePercent(feeStats.feesByType.buy, feeStats.totalFeesCollected)}%
            </Text>
          </View>
        </View>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownDot, { backgroundColor: Colors.accent }]} />
            <Text style={styles.breakdownLabel}>Sell Transaction Fees</Text>
          </View>
          <View style={styles.breakdownRight}>
            <Text style={styles.breakdownValue}>{formatCurrency(feeStats.feesByType.sell)}</Text>
            <Text style={styles.breakdownPercent}>
              {safePercent(feeStats.feesByType.sell, feeStats.totalFeesCollected)}%
            </Text>
          </View>
        </View>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownDot, { backgroundColor: Colors.negative }]} />
            <Text style={styles.breakdownLabel}>Withdrawal Fees</Text>
          </View>
          <View style={styles.breakdownRight}>
            <Text style={styles.breakdownValue}>{formatCurrency(feeStats.feesByType.withdrawal)}</Text>
            <Text style={styles.breakdownPercent}>
              {safePercent(feeStats.feesByType.withdrawal, feeStats.totalFeesCollected)}%
            </Text>
          </View>
        </View>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownDot, { backgroundColor: Colors.positive }]} />
            <Text style={styles.breakdownLabel}>Property Commissions</Text>
          </View>
          <View style={styles.breakdownRight}>
            <Text style={styles.breakdownValue}>{formatCurrency(totalRevenue - feeStats.totalFeesCollected)}</Text>
            <Text style={styles.breakdownPercent}>
              {safePercent(totalRevenue - feeStats.totalFeesCollected, totalRevenue)}%
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Platform Stats</Text>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{feeStats.totalMembers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{propertyControls.length}</Text>
          <Text style={styles.statLabel}>Properties</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{feeStats.totalTransactions}</Text>
          <Text style={styles.statLabel}>Transactions</Text>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const queryClient = useQueryClient();

  const archiveJVMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Owner Controls] Archiving JV deal:', input.id);
      const { data, error } = await archiveJVDeal(input.id);
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Owner Controls] JV deal archived');
      void queryClient.invalidateQueries({ queryKey: ['jvAgreements.list'] });
      void queryClient.invalidateQueries({ queryKey: ['jv-agreements'] });
      void queryClient.invalidateQueries({ queryKey: ['published-jv-deals'] });
      Alert.alert('Archived', 'Deal archived. You can restore it from Admin > Trash Bin.');
    },
    onError: (err: Error) => {
      console.error('[Owner Controls] Archive JV error:', err);
      Alert.alert('Error', 'Failed to archive deal: ' + (err.message || 'Unknown error'));
    },
  });



  const handleArchiveJVDeal = (deal: JVDealControl) => {
    Alert.alert(
      'Archive JV Deal',
      `Archive "${deal.name}"?\n\nIt will be hidden but can be restored from Admin > Trash Bin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            console.log('[Owner Controls] Archiving JV deal:', deal.id, deal.name);
            archiveJVMutation.mutate({ id: deal.id });
          },
        },
      ]
    );
  };

  const handleToggleJVTrading = (deal: JVDealControl) => {
    const action = deal.tradingPaused ? 'resume' : 'pause';
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Investing`,
      `Are you sure you want to ${action} investing for ${deal.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            Alert.alert('Success', `Investing ${action}d for ${deal.name}`);
          },
        },
      ]
    );
  };

  const renderProperties = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.infoCard}>
        <AlertCircle size={20} color={Colors.primary} />
        <Text style={styles.infoText}>
          Control trading status, pricing, and your ownership share for each property
        </Text>
      </View>

      {jvDealControls.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <Text style={styles.sectionTitle}>JV Deals ({jvDealControls.length})</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#00C48C15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, gap: 4 }}
                onPress={() => router.push('/admin/publication-log' as any)}
                testID="owner-publication-log"
              >
                <Eye size={14} color="#00C48C" />
                <Text style={{ color: '#00C48C', fontSize: 12, fontWeight: '700' as const }}>Pub Log</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#4A90D915', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, gap: 4 }}
                onPress={() => router.push('/admin/trash-bin' as any)}
                testID="owner-jv-trash-bin"
              >
                <Trash2 size={14} color="#4A90D9" />
                <Text style={{ color: '#4A90D9', fontSize: 12, fontWeight: '700' as const }}>Trash Bin</Text>
              </TouchableOpacity>
            </View>
          </View>
          {jvDealControls.map((deal) => (
            <View key={deal.id} style={[styles.propertyControlCard, { borderColor: '#FFB80030' }]}>
              <View style={styles.propertyHeader}>
                <View style={styles.propertyInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.propertyName}>{deal.name}</Text>
                    <View style={{ backgroundColor: '#FFB80020', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: '#FFB800', fontSize: 10, fontWeight: '700' as const }}>JV</Text>
                    </View>
                  </View>
                  <Text style={styles.propertyLocation}>{deal.location}</Text>
                </View>
                <View style={[
                  styles.tradingBadge,
                  { backgroundColor: deal.status === 'active' ? Colors.positive + '20' : Colors.textSecondary + '20' }
                ]}>
                  {deal.status === 'active' ? (
                    <Unlock size={12} color={Colors.positive} />
                  ) : (
                    <Lock size={12} color={Colors.textSecondary} />
                  )}
                  <Text style={[
                    styles.tradingBadgeText,
                    { color: deal.status === 'active' ? Colors.positive : Colors.textSecondary }
                  ]}>
                    {deal.status === 'active' ? 'Active' : deal.status}
                  </Text>
                </View>
              </View>

              <View style={styles.propertyStats}>
                <View style={styles.propertyStat}>
                  <Text style={styles.propertyStatLabel}>Total Investment</Text>
                  <Text style={styles.propertyStatValue}>{formatCurrency(deal.totalInvestment)}</Text>
                </View>
                <View style={styles.propertyStat}>
                  <Text style={styles.propertyStatLabel}>Funded</Text>
                  <Text style={styles.propertyStatValue}>
                    {deal.targetAmount > 0 ? Math.round((deal.currentRaised / deal.targetAmount) * 100) : 0}%
                  </Text>
                </View>
                <View style={styles.propertyStat}>
                  <Text style={styles.propertyStatLabel}>Your Share</Text>
                  <Text style={[styles.propertyStatValue, { color: '#FFB800' }]}>
                    {deal.ownerShare}%
                  </Text>
                </View>
              </View>

              <View style={styles.propertyRevenue}>
                <Text style={styles.propertyRevenueLabel}>Expected ROI</Text>
                <Text style={[styles.propertyRevenueValue, { color: Colors.positive }]}>
                  {deal.expectedROI}%
                </Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>Raised: {formatCurrency(deal.currentRaised)}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>Target: {formatCurrency(deal.targetAmount)}</Text>
              </View>

              <View style={styles.propertyActions}>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: deal.tradingPaused ? Colors.positive + '15' : Colors.negative + '15' }
                  ]}
                  onPress={() => handleToggleJVTrading(deal)}
                >
                  {deal.tradingPaused ? (
                    <>
                      <Unlock size={16} color={Colors.positive} />
                      <Text style={[styles.actionBtnText, { color: Colors.positive }]}>Resume</Text>
                    </>
                  ) : (
                    <>
                      <Lock size={16} color={Colors.negative} />
                      <Text style={[styles.actionBtnText, { color: Colors.negative }]}>Pause</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#FFB800' + '15' }]}
                  onPress={() => router.push('/admin/jv-deals' as any)}
                >
                  <Edit3 size={16} color="#FFB800" />
                  <Text style={[styles.actionBtnText, { color: '#FFB800' }]}>Manage</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#FFB80015' }]}
                  onPress={() => handleArchiveJVDeal(deal)}
                  testID={`owner-jv-archive-${deal.id}`}
                >
                  <Trash2 size={16} color="#FFB800" />
                  <Text style={[styles.actionBtnText, { color: '#FFB800' }]}>Archive</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Token Properties</Text>
      {propertyControls.map((property) => (
        <View key={property.id} style={styles.propertyControlCard}>
          <View style={styles.propertyHeader}>
            <View style={styles.propertyInfo}>
              <Text style={styles.propertyName}>{property.name}</Text>
              <Text style={styles.propertyLocation}>{property.city}, {property.country}</Text>
            </View>
            <View style={[
              styles.tradingBadge,
              { backgroundColor: property.tradingPaused ? Colors.negative + '20' : Colors.positive + '20' }
            ]}>
              {property.tradingPaused ? (
                <Lock size={12} color={Colors.negative} />
              ) : (
                <Unlock size={12} color={Colors.positive} />
              )}
              <Text style={[
                styles.tradingBadgeText,
                { color: property.tradingPaused ? Colors.negative : Colors.positive }
              ]}>
                {property.tradingPaused ? 'Paused' : 'Active'}
              </Text>
            </View>
          </View>

          <View style={styles.propertyStats}>
            <View style={styles.propertyStat}>
              <Text style={styles.propertyStatLabel}>Price/Share</Text>
              <Text style={styles.propertyStatValue}>{formatPrice(property.pricePerShare)}</Text>
            </View>
            <View style={styles.propertyStat}>
              <Text style={styles.propertyStatLabel}>Funded</Text>
              <Text style={styles.propertyStatValue}>
                {Math.round((property.currentRaise / property.targetRaise) * 100)}%
              </Text>
            </View>
            <View style={styles.propertyStat}>
              <Text style={styles.propertyStatLabel}>Your Share</Text>
              <Text style={[styles.propertyStatValue, { color: Colors.primary }]}>
                {property.ownerShare}%
              </Text>
            </View>
          </View>

          <View style={styles.propertyRevenue}>
            <Text style={styles.propertyRevenueLabel}>Your Revenue from this Property</Text>
            <Text style={styles.propertyRevenueValue}>
              {formatCurrency(property.currentRaise * (property.ownerShare / 100) * 0.1)}
            </Text>
          </View>

          <View style={styles.propertyActions}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: property.tradingPaused ? Colors.positive + '15' : Colors.negative + '15' }
              ]}
              onPress={() => handleToggleTrading(property)}
            >
              {property.tradingPaused ? (
                <>
                  <Unlock size={16} color={Colors.positive} />
                  <Text style={[styles.actionBtnText, { color: Colors.positive }]}>Resume</Text>
                </>
              ) : (
                <>
                  <Lock size={16} color={Colors.negative} />
                  <Text style={[styles.actionBtnText, { color: Colors.negative }]}>Pause</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.primary + '15' }]}
              onPress={() => openEditPropertyModal(property)}
            >
              <Edit3 size={16} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Configure</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderFees = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.infoCard}>
        <Percent size={20} color={Colors.primary} />
        <Text style={styles.infoText}>
          Set transaction fees to generate revenue from all platform activities
        </Text>
      </View>

      <View style={styles.feeSummary}>
        <View style={styles.feeSummaryItem}>
          <Text style={styles.feeSummaryLabel}>Total Fees Collected</Text>
          <Text style={styles.feeSummaryValue}>{formatCurrency(feeStats.totalFeesCollected)}</Text>
        </View>
        <View style={styles.feeSummaryDivider} />
        <View style={styles.feeSummaryItem}>
          <Text style={styles.feeSummaryLabel}>Avg Fee Amount</Text>
          <Text style={styles.feeSummaryValue}>{formatCurrency((feeStats as any).averageFeeAmount ?? 0)}</Text>
        </View>
      </View>

      {feeConfigurations.map((fee) => (
        <TouchableOpacity
          key={fee.id}
          style={styles.feeCard}
          onPress={() => openEditFeeModal(fee)}
          activeOpacity={0.7}
        >
          <View style={styles.feeHeader}>
            <View style={styles.feeInfo}>
              <Text style={styles.feeName}>{fee.name}</Text>
              <Text style={styles.feeType}>{fee.type.toUpperCase()}</Text>
            </View>
            <View style={[
              styles.feeStatusBadge,
              { backgroundColor: fee.isActive ? Colors.positive + '20' : Colors.textSecondary + '20' }
            ]}>
              <Text style={[
                styles.feeStatusText,
                { color: fee.isActive ? Colors.positive : Colors.textSecondary }
              ]}>
                {fee.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>

          <View style={styles.feeDetails}>
            <View style={styles.feeDetail}>
              <Text style={styles.feeDetailLabel}>Rate</Text>
              <Text style={styles.feeDetailValue}>{fee.percentage}%</Text>
            </View>
            <View style={styles.feeDetail}>
              <Text style={styles.feeDetailLabel}>Min</Text>
              <Text style={styles.feeDetailValue}>{formatCurrency(fee.minFee)}</Text>
            </View>
            <View style={styles.feeDetail}>
              <Text style={styles.feeDetailLabel}>Max</Text>
              <Text style={styles.feeDetailValue}>{formatCurrency(fee.maxFee)}</Text>
            </View>
          </View>

          <View style={styles.feeFooter}>
            <Text style={styles.feeFooterText}>Tap to edit</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </View>
        </TouchableOpacity>
      ))}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.infoCard}>
        <Settings size={20} color={Colors.primary} />
        <Text style={styles.infoText}>
          Configure platform-wide settings and controls
        </Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Investment Limits</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Minimum Investment</Text>
          <Text style={styles.settingValue}>{formatCurrency(platformSettings.minInvestment)}</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Maximum Investment</Text>
          <Text style={styles.settingValue}>{formatCurrency(platformSettings.maxInvestment)}</Text>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Platform Fee</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Commission Rate</Text>
          <Text style={[styles.settingValue, { color: Colors.primary }]}>
            {platformSettings.platformFeePercent}%
          </Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Dividend Distribution Day</Text>
          <Text style={styles.settingValue}>Day {platformSettings.dividendDistributionDay}</Text>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Platform Controls</Text>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Trading Enabled</Text>
            <Text style={styles.toggleDesc}>Allow users to buy and sell shares</Text>
          </View>
          <Switch
            value={platformSettings.tradingEnabled}
            onValueChange={(value) => setPlatformSettings({ ...platformSettings, tradingEnabled: value })}
            trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
            thumbColor={platformSettings.tradingEnabled ? Colors.primary : Colors.textTertiary}
          />
        </View>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>New Signups</Text>
            <Text style={styles.toggleDesc}>Allow new user registrations</Text>
          </View>
          <Switch
            value={platformSettings.newSignupsEnabled}
            onValueChange={(value) => setPlatformSettings({ ...platformSettings, newSignupsEnabled: value })}
            trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
            thumbColor={platformSettings.newSignupsEnabled ? Colors.primary : Colors.textTertiary}
          />
        </View>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Auto-Reinvest</Text>
            <Text style={styles.toggleDesc}>Enable automatic dividend reinvestment</Text>
          </View>
          <Switch
            value={platformSettings.autoReinvestEnabled}
            onValueChange={(value) => setPlatformSettings({ ...platformSettings, autoReinvestEnabled: value })}
            trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
            thumbColor={platformSettings.autoReinvestEnabled ? Colors.primary : Colors.textTertiary}
          />
        </View>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Maintenance Mode</Text>
            <Text style={styles.toggleDesc}>Temporarily disable platform access</Text>
          </View>
          <Switch
            value={platformSettings.maintenanceMode}
            onValueChange={(value) => {
              if (value) {
                Alert.alert(
                  'Enable Maintenance Mode',
                  'This will prevent all users from accessing the platform. Are you sure?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Enable', style: 'destructive', onPress: () => setPlatformSettings({ ...platformSettings, maintenanceMode: true }) }
                  ]
                );
              } else {
                setPlatformSettings({ ...platformSettings, maintenanceMode: value });
              }
            }}
            trackColor={{ false: Colors.border, true: Colors.negative + '80' }}
            thumbColor={platformSettings.maintenanceMode ? Colors.negative : Colors.textTertiary}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.saveSettingsBtn} onPress={handleSaveSettings} disabled={upsertSetting.isPending}>
        <Check size={20} color="#fff" />
        <Text style={styles.saveSettingsBtnText}>{upsertSetting.isPending ? 'Saving…' : 'Save All Settings'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.apiKeysBtn}
        onPress={() => router.push('/admin/api-keys' as any)}
        activeOpacity={0.8}
      >
        <View style={styles.apiKeysBtnLeft}>
          <View style={styles.apiKeysBtnIcon}>
            <Key size={18} color="#FF9900" />
          </View>
          <View>
            <Text style={styles.apiKeysBtnTitle}>API Keys Vault</Text>
            <Text style={styles.apiKeysBtnSub}>View & copy all environment credentials</Text>
          </View>
        </View>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </TouchableOpacity>

      <View style={[styles.settingsCard, { marginTop: 12 }]} testID="owner-persistence-health-card">
        <Text style={styles.settingsTitle}>Persistence Health</Text>
        <Text style={[styles.toggleDesc, { marginBottom: 10 }]}>Verifies all 7 owner-controlled Supabase tables resolve from this device.</Text>
        <TouchableOpacity
          style={[styles.saveSettingsBtn, { backgroundColor: Colors.primary, marginBottom: 12 }]}
          onPress={runHealthProbe}
          disabled={healthLoading}
          activeOpacity={0.85}
        >
          <Activity size={18} color={Colors.black} />
          <Text style={styles.saveSettingsBtnText}>{healthLoading ? 'Probing…' : (healthRows ? 'Re-run probe' : 'Run probe')}</Text>
        </TouchableOpacity>
        {healthRows?.map((r) => {
          const color = r.ok ? Colors.positive : (r.missing ? Colors.warning : Colors.negative);
          const label = r.ok ? 'ok' : (r.missing ? 'missing' : 'error');
          return (
            <View key={r.table} style={styles.settingRow}>
              <Text style={styles.settingLabel}>{r.table}</Text>
              <Text style={[styles.settingValue, { color }]}>{label}</Text>
            </View>
          );
        })}
        {healthRows && healthRows.some((r) => r.missing) && (
          <>
            <Text style={[styles.toggleDesc, { color: Colors.warning, marginTop: 8 }]}>Phase 1 tables missing. Tap below to apply the migration via the owner-only backend.</Text>
            <TouchableOpacity
              style={[styles.saveSettingsBtn, { backgroundColor: Colors.warning, marginTop: 10 }]}
              onPress={applyMigration}
              disabled={migrationApplying}
              activeOpacity={0.85}
              testID="owner-persistence-apply-migration"
            >
              <Activity size={18} color={Colors.black} />
              <Text style={styles.saveSettingsBtnText}>{migrationApplying ? 'Applying migration…' : 'Apply Phase 1 migration now'}</Text>
            </TouchableOpacity>
          </>
        )}
        {lastMigration ? (
          <View style={{ marginTop: 10 }}>
            <Text style={[styles.toggleDesc, { color: lastMigration.ok ? Colors.positive : Colors.negative }]}>
              {lastMigration.ok
                ? `Migration applied (${lastMigration.command ?? 'SQL'}). Re-probing…`
                : `Migration failed: ${lastMigration.error ?? 'unknown error'}`}
            </Text>
            {lastMigration.endpoint ? (
              <Text style={[styles.toggleDesc, { color: Colors.textSecondary, marginTop: 2 }]}>HTTP {lastMigration.httpStatus} · {lastMigration.endpoint}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const ALL_MODULES: { id: string; name: string; desc: string; route: string; category: string; color: string; icon: any }[] = [
    { id: 'admin-hub', name: 'Admin Hub', desc: 'Full admin dashboard with all modules', route: '/admin', category: 'Core', color: '#FFD700', icon: LayoutGrid },
    { id: 'admin-dashboard', name: 'Admin Dashboard', desc: 'Operations dashboard', route: '/admin/dashboard', category: 'Core', color: '#FFD700', icon: LayoutGrid },
    { id: 'admin-intro', name: 'Admin Intro', desc: 'Admin walkthrough', route: '/admin/intro', category: 'Core', color: '#FFD700', icon: FileText },
    { id: 'activation-center', name: 'Activation Center', desc: 'Activate platform features', route: '/activation-center', category: 'Core', color: '#FFD700', icon: Zap },
    { id: 'trust-center', name: 'Trust Center', desc: 'Security & compliance', route: '/trust-center', category: 'Core', color: '#FFD700', icon: ShieldCheck },
    { id: 'system-blueprint-root', name: 'System Blueprint (root)', desc: 'Platform blueprint overview', route: '/system-blueprint', category: 'Core', color: '#FFD700', icon: Network },
    { id: 'system-map', name: 'System Blueprint', desc: 'Live architecture map & health', route: '/admin/system-map', category: 'Core', color: '#FFD700', icon: Network },
    { id: 'system-monitor', name: '24/7 Command Center', desc: 'Realtime system monitor', route: '/admin/system-monitor', category: 'Core', color: '#FFD700', icon: Monitor },
    { id: 'system-health', name: 'System Health', desc: 'Uptime & performance', route: '/system-health', category: 'Core', color: '#FFD700', icon: Activity },
    { id: 'backend-audit', name: 'Backend Audit', desc: 'API & backend status', route: '/backend-audit', category: 'Core', color: '#FFD700', icon: Server },
    { id: 'app-report', name: 'App Report', desc: 'App performance & usage', route: '/app-report', category: 'Core', color: '#FFD700', icon: FileText },
    { id: 'feature-control', name: 'Feature Control', desc: 'Toggle features on/off', route: '/admin/feature-control', category: 'Core', color: '#FFD700', icon: Zap },
    { id: 'control-tower', name: 'Control Tower', desc: 'Master operations console', route: '/admin/control-tower', category: 'Core', color: '#FFD700', icon: Monitor },
    { id: 'sync-diagnostics', name: 'Sync Diagnostics', desc: 'Data sync health', route: '/admin/sync-diagnostics', category: 'Core', color: '#FFD700', icon: RefreshCw },

    { id: 'landing-control', name: 'Landing Page Control', desc: 'Edit & toggle landing sections', route: '/admin/landing-control', category: 'Landing & Public', color: '#4A90D9', icon: Sliders },
    { id: 'landing-analytics', name: 'Landing Analytics', desc: 'Visitors & traffic', route: '/admin/landing-analytics', category: 'Landing & Public', color: '#4A90D9', icon: BarChart3 },
    { id: 'landing-submissions', name: 'Landing Submissions', desc: 'Form submissions', route: '/admin/landing-submissions', category: 'Landing & Public', color: '#4A90D9', icon: Mail },
    { id: 'landing-preview', name: 'Public Landing Preview', desc: 'View live landing page', route: '/landing', category: 'Landing & Public', color: '#4A90D9', icon: Globe },
    { id: 'deploy-waitlist', name: 'Deploy Waitlist', desc: 'Investor waitlist table', route: '/admin/deploy-waitlist', category: 'Landing & Public', color: '#4A90D9', icon: Rocket },
    { id: 'waitlist-admin', name: 'Waitlist Admin', desc: 'Manage waitlist', route: '/admin/waitlist-admin', category: 'Landing & Public', color: '#4A90D9', icon: Users },
    { id: 'banners', name: 'Banners', desc: 'Hero images & promos', route: '/admin/banners', category: 'Landing & Public', color: '#4A90D9', icon: LayoutGrid },

    { id: 'properties', name: 'Properties', desc: 'Real estate portfolio', route: '/admin/properties', category: 'Deals & Assets', color: '#00C48C', icon: Building2 },
    { id: 'jv-deals', name: 'JV Deals', desc: 'Joint venture management', route: '/admin/jv-deals', category: 'Deals & Assets', color: '#00C48C', icon: Building2 },
    { id: 'land-partners', name: 'Land Partners', desc: 'Lots & parcels', route: '/admin/land-partners', category: 'Deals & Assets', color: '#00C48C', icon: Building2 },
    { id: 'title-companies', name: 'Title Companies', desc: 'Escrow & closing', route: '/admin/title-companies', category: 'Deals & Assets', color: '#00C48C', icon: Building2 },
    { id: 'lender-directory', name: 'Lender Directory', desc: 'Banks & financing', route: '/admin/lender-directory', category: 'Deals & Assets', color: '#00C48C', icon: Building2 },
    { id: 'lender-search', name: 'Lender Search', desc: 'Find financing', route: '/admin/lender-search', category: 'Deals & Assets', color: '#00C48C', icon: Search },
    { id: 'lender-sync', name: 'Lender Sync', desc: 'Update lender data', route: '/admin/lender-sync', category: 'Deals & Assets', color: '#00C48C', icon: RefreshCw },
    { id: 'publication-log', name: 'Publication Log', desc: 'Deal publish history', route: '/admin/publication-log', category: 'Deals & Assets', color: '#00C48C', icon: FileText },

    { id: 'members', name: 'Members', desc: 'Users & investors', route: '/admin/members', category: 'Users & Investors', color: '#4ECDC4', icon: Users },
    { id: 'applications', name: 'Applications', desc: 'Broker / agent applications', route: '/admin/applications', category: 'Users & Investors', color: '#4ECDC4', icon: FileText },
    { id: 'team', name: 'Team Management', desc: 'Staff & roles', route: '/admin/team', category: 'Users & Investors', color: '#4ECDC4', icon: Users },
    { id: 'registration-audit', name: 'Registration Audit', desc: 'Signup & device audit', route: '/admin/registration-audit', category: 'Users & Investors', color: '#4ECDC4', icon: Shield },
    { id: 'investor-profits', name: 'Investor Profits', desc: 'Dividends & ROI', route: '/admin/investor-profits', category: 'Users & Investors', color: '#4ECDC4', icon: DollarSign },
    { id: 'kyc-verification', name: 'KYC Verification', desc: 'Identity verification', route: '/kyc-verification', category: 'Users & Investors', color: '#4ECDC4', icon: ShieldCheck },
    { id: 'vip-tiers', name: 'VIP Tiers', desc: 'Premium membership tiers', route: '/vip-tiers', category: 'Users & Investors', color: '#4ECDC4', icon: IVXBrandIcon },
    { id: 'agent-apply', name: 'Agent Applications', desc: 'Agent intake', route: '/agent-apply', category: 'Users & Investors', color: '#4ECDC4', icon: FileText },
    { id: 'broker-apply', name: 'Broker Applications', desc: 'Broker intake', route: '/broker-apply', category: 'Users & Investors', color: '#4ECDC4', icon: FileText },
    { id: 'influencer-apply', name: 'Influencer Applications', desc: 'Influencer intake', route: '/influencer-apply', category: 'Users & Investors', color: '#4ECDC4', icon: FileText },
    { id: 'waitlist-public', name: 'Public Waitlist', desc: 'Investor waitlist page', route: '/waitlist', category: 'Users & Investors', color: '#4ECDC4', icon: Users },

    { id: 'fees-admin', name: 'Fees & Pricing', desc: 'Commissions & rates', route: '/admin/fees', category: 'Finance', color: '#FF9F43', icon: Percent },
    { id: 'transactions', name: 'Transactions', desc: 'Deposits & withdrawals', route: '/admin/transactions', category: 'Finance', color: '#FF9F43', icon: ArrowUpRight },

    { id: 'marketing', name: 'Marketing', desc: 'Campaigns & ads', route: '/admin/marketing', category: 'Marketing', color: '#FF6B9D', icon: Megaphone },
    { id: 'broadcast', name: 'Broadcast', desc: 'Mass push & notifications', route: '/admin/broadcast', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'social-command', name: 'Social Command', desc: 'Social media center', route: '/admin/social-command', category: 'Marketing', color: '#FF6B9D', icon: Megaphone },
    { id: 'viral-growth', name: 'Viral Growth', desc: 'Referrals & sharing', route: '/admin/viral-growth', category: 'Marketing', color: '#FF6B9D', icon: Rocket },
    { id: 'influencers', name: 'Influencers', desc: 'Ambassador program', route: '/admin/influencers', category: 'Marketing', color: '#FF6B9D', icon: Users },
    { id: 'retargeting', name: 'Retargeting', desc: 'Remarketing audiences', route: '/admin/retargeting', category: 'Marketing', color: '#FF6B9D', icon: BarChart3 },
    { id: 'traffic-control', name: 'Traffic Control', desc: 'UTM & sources', route: '/admin/traffic-control', category: 'Marketing', color: '#FF6B9D', icon: Globe },
    { id: 'sms-reports', name: 'SMS Reports', desc: 'Text delivery reports', route: '/sms-reports', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'sms-dashboard', name: 'SMS Dashboard', desc: 'SMS overview', route: '/sms-dashboard', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'sms-compose', name: 'SMS Compose', desc: 'Send new SMS', route: '/sms-compose', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'sms-history', name: 'SMS History', desc: 'Past SMS messages', route: '/sms-history', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'send-test-sms', name: 'Send Test SMS', desc: 'Test SMS delivery', route: '/send-test-sms', category: 'Marketing', color: '#FF6B9D', icon: MessageSquare },
    { id: 'send-test-email', name: 'Send Test Email', desc: 'Test email delivery', route: '/send-test-email', category: 'Email', color: '#38BDF8', icon: Mail },

    { id: 'email-management', name: 'Email Management', desc: 'Templates & campaigns', route: '/admin/email-management', category: 'Email', color: '#38BDF8', icon: Mail },
    { id: 'email-engine', name: 'Email Engine', desc: 'SMTP & delivery', route: '/admin/email-engine', category: 'Email', color: '#38BDF8', icon: Settings },
    { id: 'email-accounts', name: 'Email Accounts', desc: 'Connected inboxes', route: '/admin/email-accounts', category: 'Email', color: '#38BDF8', icon: Mail },
    { id: 'email-inbox', name: 'Email Inbox', desc: 'Sent & received', route: '/admin/email-inbox', category: 'Email', color: '#38BDF8', icon: Mail },

    { id: 'growth', name: 'Growth Analytics', desc: 'KPI metrics', route: '/admin/growth', category: 'Analytics', color: '#A78BFA', icon: BarChart3 },
    { id: 'analytics-report', name: 'Analytics Report', desc: 'Live visitors & GA', route: '/analytics-report', category: 'Analytics', color: '#A78BFA', icon: BarChart3 },
    { id: 'outreach-analytics', name: 'Outreach Analytics', desc: 'Campaign performance', route: '/admin/outreach-analytics', category: 'Analytics', color: '#A78BFA', icon: BarChart3 },
    { id: 'engagement', name: 'Engagement', desc: 'Active user metrics', route: '/admin/engagement', category: 'Analytics', color: '#A78BFA', icon: Activity },
    { id: 'visitor-intelligence', name: 'Visitor Intelligence', desc: 'Behavior & heatmap', route: '/admin/visitor-intelligence', category: 'Analytics', color: '#A78BFA', icon: Eye },

    { id: 'ivx-developer-workspace', name: 'Code Developer Workspace', desc: 'IVX IA senior-developer console', route: '/admin/ivx-developer-workspace', category: 'AI / IVX IA', color: '#00C48C', icon: Code },
    { id: 'ivx-developer-actions', name: 'Approved Developer Actions', desc: 'Owner-approved patch/commit/SQL/deploy with audit', route: '/admin/ivx-developer-actions', category: 'AI / IVX IA', color: '#00C48C', icon: Code },
    { id: 'ivx-agent-jobs', name: 'IVX Agent Jobs', desc: 'Block 22 backend worker queue', route: '/admin/ivx-agent-jobs', category: 'AI / IVX IA', color: '#FFD700', icon: Bot },
    { id: 'ai-outreach', name: 'AI Outreach', desc: 'Automated drip campaigns', route: '/admin/ai-outreach', category: 'AI / IVX IA', color: '#A78BFA', icon: Bot },
    { id: 'ai-video', name: 'AI Video', desc: 'Generate AI video', route: '/admin/ai-video', category: 'AI / IVX IA', color: '#A78BFA', icon: Bot },
    { id: 'ai-gallery', name: 'AI Gallery', desc: 'Generated assets', route: '/ai-gallery', category: 'AI / IVX IA', color: '#A78BFA', icon: LayoutGrid },
    { id: 'ai-automation-report', name: 'AI Automation Report', desc: 'Agent task status', route: '/ai-automation-report', category: 'AI / IVX IA', color: '#A78BFA', icon: Bot },
    { id: 'lead-intelligence', name: 'Lead Intelligence', desc: 'Lead scoring', route: '/admin/lead-intelligence', category: 'AI / IVX IA', color: '#A78BFA', icon: Bot },
    { id: 'global-intelligence', name: 'Global Intelligence', desc: 'Market trends', route: '/global-intelligence', category: 'AI / IVX IA', color: '#A78BFA', icon: Globe },

    { id: 'ivx-owner-vars', name: 'Owner Variables', desc: 'Env vars & runtime proof', route: '/ivx/variables', category: 'Variables & Deploy', color: '#FF9900', icon: KeyRound },
    { id: 'api-keys', name: 'API Keys Vault', desc: 'View / copy credentials', route: '/admin/api-keys', category: 'Variables & Deploy', color: '#FF9900', icon: Key },
    { id: 'authenticator', name: 'Authenticator', desc: '2FA codes & security', route: '/authenticator', category: 'Variables & Deploy', color: '#FF9900', icon: ShieldCheck },
    { id: 'ivx-independence', name: 'Independence Tracker', desc: 'IVX independence plan', route: '/ivx/independence', category: 'Variables & Deploy', color: '#FF9900', icon: ShieldCheck },
    { id: 'supabase-scripts', name: 'Supabase SQL', desc: 'DB scripts & migrations', route: '/admin/supabase-scripts', category: 'Variables & Deploy', color: '#FF9900', icon: Database },
    { id: 'supabase-export', name: 'Supabase Export', desc: 'Export DB data', route: '/supabase-export', category: 'Variables & Deploy', color: '#FF9900', icon: Database },
    { id: 'v1-brief', name: 'V1 Brief', desc: 'Launch brief & specs', route: '/v1-brief', category: 'Variables & Deploy', color: '#FF9900', icon: FileText },
    { id: 'ivx-ai-proxy-status', name: 'IVX AI Proxy', desc: 'AI proxy runtime proof', route: '/ivx/ai-proxy-status', category: 'Variables & Deploy', color: '#FF9900', icon: Bot },

    { id: 'audit-log', name: 'Audit Trail', desc: 'Full action history', route: '/admin/audit-log', category: 'Audit & Recovery', color: '#9A9A9A', icon: Shield },
    { id: 'data-recovery', name: 'Data Recovery', desc: 'Restore deleted data', route: '/admin/data-recovery', category: 'Audit & Recovery', color: '#9A9A9A', icon: RefreshCw },
    { id: 'image-backup', name: 'Image Backup', desc: 'Photo storage health', route: '/admin/image-backup', category: 'Audit & Recovery', color: '#9A9A9A', icon: Shield },
    { id: 'trash-bin', name: 'Trash Bin', desc: 'Recycle & restore', route: '/admin/trash-bin', category: 'Audit & Recovery', color: '#9A9A9A', icon: Trash2 },
    { id: 'quality-control', name: 'Quality Control', desc: 'QC checks', route: '/admin/quality-control', category: 'Audit & Recovery', color: '#9A9A9A', icon: ShieldCheck },
    { id: 'staff-activity', name: 'Staff Activity', desc: 'See what staff did', route: '/admin/staff-activity', category: 'Audit & Recovery', color: '#9A9A9A', icon: Eye },
    { id: 'admin-chat-room', name: 'Admin Message Room', desc: 'Shared admin chat', route: '/admin/chat-room', category: 'Audit & Recovery', color: '#9A9A9A', icon: MessageSquare },
    { id: 'developer-handoff', name: 'Developer Handoff', desc: 'Tech specs export', route: '/admin/developer-handoff', category: 'Audit & Recovery', color: '#9A9A9A', icon: FileText },
    { id: 'app-docs', name: 'Docs & Legal', desc: 'Contracts & legal', route: '/admin/app-docs', category: 'Audit & Recovery', color: '#9A9A9A', icon: FileText },
  ];

  const filteredModules = ALL_MODULES.filter((m) => {
    if (!moduleSearch.trim()) return true;
    const q = moduleSearch.trim().toLowerCase();
    return m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
  });

  const modulesByCategory = filteredModules.reduce<Record<string, typeof ALL_MODULES>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  const renderAllModules = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.ownerBadge}>
        <IVXBrandIcon size={20} />
        <Text style={styles.ownerBadgeText}>All Owner & Admin Modules ({ALL_MODULES.length})</Text>
      </View>

      <View style={styles.moduleSearchBox}>
        <Search size={16} color={Colors.textSecondary} />
        <TextInput
          value={moduleSearch}
          onChangeText={setModuleSearch}
          placeholder="Search modules..."
          placeholderTextColor={Colors.textTertiary}
          style={styles.moduleSearchInput}
          testID="owner-modules-search"
        />
        {moduleSearch.length > 0 && (
          <TouchableOpacity onPress={() => setModuleSearch('')}>
            <X size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {Object.entries(modulesByCategory).map(([category, items]) => (
        <View key={category} style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: items[0].color }} />
            <Text style={styles.sectionTitle}>{category}</Text>
            <Text style={{ color: Colors.textTertiary, fontSize: 12 }}>({items.length})</Text>
          </View>
          <View style={styles.moduleGrid}>
            {items.map((m) => {
              const Icon = m.icon ?? LayoutGrid;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.moduleCard, { borderColor: m.color + '40' }]}
                  onPress={() => router.push(m.route as any)}
                  testID={`owner-module-${m.id}`}
                  activeOpacity={0.7}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: m.color + '20' }]}>
                    <Icon size={18} color={m.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.moduleName} numberOfLines={1}>{m.name}</Text>
                    <Text style={styles.moduleDesc} numberOfLines={2}>{m.desc}</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {filteredModules.length === 0 && (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <Text style={{ color: Colors.textSecondary }}>No modules match "{moduleSearch}"</Text>
        </View>
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/(home)/home' as any)} style={styles.backBtn} testID="owner-back-home">
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={[styles.headerLeft, { flex: 1 }]}>
          <IVXBrandIcon size={28} />
          <View>
            <Text style={styles.title}>Owner Controls</Text>
            <Text style={styles.subtitle}>Full platform management</Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickNavWrap}
        contentContainerStyle={styles.quickNavContent}
      >
        {[
          { key: 'home', label: 'Home', icon: HomeIcon, route: '/(tabs)/(home)/home' },
          { key: 'invest', label: 'Invest', icon: TrendingUp, route: '/(tabs)/invest' },
          { key: 'market', label: 'Market', icon: BarChart3, route: '/(tabs)/market' },
          { key: 'portfolio', label: 'Portfolio', icon: Briefcase, route: '/(tabs)/portfolio' },
          { key: 'chat', label: 'Chat', icon: MessageSquare, route: '/(tabs)/chat' },
          { key: 'profile', label: 'Profile', icon: UserIcon, route: '/(tabs)/profile' },
          { key: 'admin', label: 'Admin Hub', icon: LayoutDashboard, route: '/admin' },
        ].map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.quickNavChip}
            onPress={() => router.push(item.route as any)}
            testID={`owner-quicknav-${item.key}`}
            activeOpacity={0.8}
          >
            <item.icon size={14} color="#FFD700" />
            <Text style={styles.quickNavText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.tabContainer}>
        {[
          { key: 'modules', label: 'All', icon: LayoutGrid },
          { key: 'revenue', label: 'Revenue', icon: DollarSign },
          { key: 'properties', label: 'Properties', icon: Building2 },
          { key: 'fees', label: 'Fees', icon: Percent },
          { key: 'settings', label: 'Settings', icon: Settings },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as typeof activeTab)}
          >
            <tab.icon size={16} color={activeTab === tab.key ? '#fff' : Colors.textSecondary} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'revenue' && renderRevenue()}
      {activeTab === 'properties' && renderProperties()}
      {activeTab === 'fees' && renderFees()}
      {activeTab === 'settings' && renderSettings()}
      {activeTab === 'modules' && renderAllModules()}

      <Modal
        visible={editFeeModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditFeeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Fee Configuration</Text>
              <TouchableOpacity onPress={() => setEditFeeModalVisible(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedFee && (
              <>
                <View style={styles.modalInfo}>
                  <Percent size={24} color={Colors.primary} />
                  <Text style={styles.modalInfoText}>{selectedFee.name}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Fee Percentage (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={editedFee.percentage}
                    onChangeText={(text) => setEditedFee({ ...editedFee, percentage: text })}
                    keyboardType="decimal-pad"
                    placeholder="0.0"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.inputRow}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Min Fee ($)</Text>
                    <TextInput
                      style={styles.input}
                      value={editedFee.minFee}
                      onChangeText={(text) => setEditedFee({ ...editedFee, minFee: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={Colors.textTertiary}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Max Fee ($)</Text>
                    <TextInput
                      style={styles.input}
                      value={editedFee.maxFee}
                      onChangeText={(text) => setEditedFee({ ...editedFee, maxFee: text })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={Colors.textTertiary}
                    />
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Fee Active</Text>
                  <Switch
                    value={editedFee.isActive}
                    onValueChange={(value) => setEditedFee({ ...editedFee, isActive: value })}
                    trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
                    thumbColor={editedFee.isActive ? Colors.primary : Colors.textTertiary}
                  />
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveFee}>
                  <Check size={20} color="#fff" />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={editPropertyModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditPropertyModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Property Controls</Text>
              <TouchableOpacity onPress={() => setEditPropertyModalVisible(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedProperty && (
              <>
                <View style={styles.modalInfo}>
                  <Building2 size={24} color={Colors.primary} />
                  <Text style={styles.modalInfoText}>{selectedProperty.name}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Your Ownership Share (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={editedProperty.ownerShare}
                    onChangeText={(text) => setEditedProperty({ ...editedProperty, ownerShare: text })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Price Adjustment (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={editedProperty.priceAdjustment}
                    onChangeText={(text) => setEditedProperty({ ...editedProperty, priceAdjustment: text })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={styles.inputHint}>Positive to increase, negative to decrease price</Text>
                </View>

                <View style={styles.switchRow}>
                  <View>
                    <Text style={styles.switchLabel}>Pause Trading</Text>
                    <Text style={styles.switchHint}>Temporarily halt all trading for this property</Text>
                  </View>
                  <Switch
                    value={editedProperty.tradingPaused}
                    onValueChange={(value) => setEditedProperty({ ...editedProperty, tradingPaused: value })}
                    trackColor={{ false: Colors.border, true: Colors.negative + '80' }}
                    thumbColor={editedProperty.tradingPaused ? Colors.negative : Colors.textTertiary}
                  />
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProperty} disabled={upsertPropertyControl.isPending}>
                  <Check size={20} color="#fff" />
                  <Text style={styles.saveBtnText}>{upsertPropertyControl.isPending ? 'Saving…' : 'Save Changes'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  headerLeft: { flex: 1, minWidth: 0 },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  quickNavWrap: { maxHeight: 48, marginBottom: 10 },
  quickNavContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  quickNavChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.surface, borderWidth: 1, borderColor: '#FFD70033' },
  quickNavText: { color: Colors.text, fontSize: 12, fontWeight: '700' as const },
  tabContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  content: { flex: 1, paddingHorizontal: 20 },
  ownerBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  ownerBadgeText: { fontSize: 11, fontWeight: '700' as const },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  heroLabel: { color: Colors.textTertiary, fontSize: 13 },
  liveIndicator: { width: 4, borderRadius: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { color: Colors.textSecondary, fontSize: 13 },
  heroValue: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroStat: { alignItems: 'center', gap: 2 },
  heroStatText: { color: Colors.textSecondary, fontSize: 13 },
  revenueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  revenueCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  revenueIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  revenueLabel: { color: Colors.textSecondary, fontSize: 13 },
  revenueValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  breakdownCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  breakdownRight: { alignItems: 'flex-end' },
  breakdownValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  breakdownPercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  propertyControlCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  propertyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  propertyInfo: { flex: 1 },
  propertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  propertyLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tradingBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tradingBadgeText: { fontSize: 11, fontWeight: '700' as const },
  propertyStats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  propertyStat: { gap: 2 },
  propertyStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  propertyStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  propertyRevenue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  propertyRevenueLabel: { color: Colors.textSecondary, fontSize: 13 },
  propertyRevenueValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  propertyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  feeSummary: { flexDirection: 'row', gap: 16, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 12, marginBottom: 12 },
  feeSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  feeSummaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  feeSummaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  feeSummaryDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  feeCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  feeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  feeInfo: { flex: 1 },
  feeName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  feeType: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  feeStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  feeStatusText: { color: Colors.textSecondary, fontSize: 13 },
  feeDetails: { flexDirection: 'row', gap: 12, marginTop: 8 },
  feeDetail: { gap: 2 },
  feeDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  feeDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  feeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  feeFooterText: { color: Colors.textSecondary, fontSize: 13 },
  settingsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  settingsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingLabel: { color: Colors.textSecondary, fontSize: 13 },
  settingValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  toggleLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, flex: 1 },
  toggleDesc: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  saveSettingsBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  saveSettingsBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  apiKeysBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#FF990030' },
  apiKeysBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  apiKeysBtnIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FF990015', alignItems: 'center', justifyContent: 'center' },
  apiKeysBtnTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  apiKeysBtnSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalInfo: { backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, marginBottom: 12 },
  modalInfoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  inputHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  switchLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, flex: 1 },
  switchHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  staffActivityLink: { flexDirection: 'row' as const, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#9B59B630', gap: 14 },
  staffActivityTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  staffActivityDesc: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  moduleSearchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12 },
  moduleSearchInput: { flex: 1, color: Colors.text, fontSize: 14, padding: 0 },
  moduleGrid: { gap: 8 },
  moduleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1 },
  moduleIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  moduleName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  moduleDesc: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
});
