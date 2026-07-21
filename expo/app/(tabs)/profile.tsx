import React, { useEffect, useMemo } from 'react';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {
  User,
  Wallet,
  FileText,
  Bell,
  Shield,
  HelpCircle,
  Settings,
  LogOut,
  ChevronRight,
  BadgeCheck,
  Globe,
  LayoutDashboard,
  Mail,
  MapPin,
  Gift,
  MessageSquare,
  PieChart,
  BookOpen,
  Briefcase,
  Handshake,
  RefreshCw,
  Users,
  Scale,
  Brain,
  Code2,
  Rocket,
  BarChart3,
  CreditCard,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTranslation, useI18n } from '@/lib/i18n-context';
import { useAnalytics } from '@/lib/analytics-context';
import { formatDollar } from '@/lib/formatters';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';

interface MenuItemProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showBadge?: boolean;
  badgeColor?: string;
  isCompact?: boolean;
  testID?: string;
}

function MenuItem({ icon, title, subtitle, onPress, showBadge, badgeColor, isCompact = false, testID }: MenuItemProps) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, { padding: isCompact ? 12 : 16 }]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}${showBadge ? ', verified' : ''}`}
      accessibilityHint={`Opens ${title}`}
      testID={testID}
    >
      <View style={styles.menuItemLeft}>
        <View style={[styles.menuItemIcon, { width: isCompact ? 36 : 40, height: isCompact ? 36 : 40 }]}>{renderSafeViewChildren(icon)}</View>
        <View>
          <Text style={[styles.menuItemTitle, { fontSize: isCompact ? 13 : 15 }]}>{title}</Text>
          {subtitle && <Text style={[styles.menuItemSubtitle, { fontSize: isCompact ? 11 : 12 }]}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.menuItemRight}>
        {showBadge && (
          <View style={[styles.badge, { backgroundColor: badgeColor || Colors.success }]}>
            <BadgeCheck size={isCompact ? 12 : 14} color={Colors.white} />
          </View>
        )}
        <ChevronRight size={isCompact ? 18 : 20} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { logout, profileData } = useAuth();
  /* Auth state is intentionally NOT used to gate Owner Login — it is read only for the diagnostic panel below. */
  const { t } = useTranslation();
  const { currentLanguage } = useI18n();
  const { trackAction } = useAnalytics();

  const balanceQuery = useQuery({
    queryKey: ['wallet-balance', 'profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
      return data;
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!profileData,
  });

  const currentUser = useMemo(() => {
    const pd = profileData;
    const role = ((pd as any)?.role ?? '') as string;
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    return {
      id: pd?.id ?? '',
      email: pd?.email ?? '',
      firstName: pd?.firstName ?? '',
      lastName: pd?.lastName ?? '',
      avatar: (pd as any)?.avatar ?? '',
      phone: (pd as any)?.phone ?? '',
      country: (pd as any)?.country ?? '',
      role,
      isOwnerOrAdmin,
      kycStatus: (isOwnerOrAdmin ? 'approved' : (pd?.kycStatus ?? 'pending')) as 'approved' | 'pending' | 'in_review' | 'rejected',
      walletBalance: balanceQuery.data?.available ?? (pd as any)?.walletBalance ?? 0,
      totalInvested: balanceQuery.data?.invested ?? (pd as any)?.totalInvested ?? 0,
      totalReturns: (pd as any)?.totalReturns ?? 0,
    };
  }, [profileData, balanceQuery.data]);

  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isXs = isExtraSmallScreen(screenSize);

  // Treat the signed-in person as an owner session when their role is owner/admin
  // or their email matches the approved owner email. When true, the yellow card
  // stops prompting for a fresh login and opens the owner console instead.
  const ownerEmail = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim().toLowerCase();
  const isOwnerSession = currentUser.isOwnerOrAdmin
    || (!!currentUser.email && currentUser.email.trim().toLowerCase() === ownerEmail);
  const ownerCardTitle = isOwnerSession ? 'Owner Console' : 'Owner Login';
  const ownerCardSubtitle = isOwnerSession
    ? 'Signed in — open owner console'
    : 'Direct approved-owner sign in';

  const openOwnerLogin = (source: string) => {
    if (isOwnerSession) {
      console.log(`[Profile] Owner Console (${source}) tapped -> /admin/ivx-developer-workspace`);
      router.push('/admin/ivx-developer-workspace' as any);
      return;
    }
    console.log(`[Profile] Owner Login (${source}) tapped -> /login?ownerMode=1`);
    router.push({ pathname: '/login', params: { ownerMode: '1' } } as any);
  };

  // ── OWNER LOGIN DEVICE FIX v5 ─ diagnostic build stamp ───────────────────
  // This marker proves which bundle a device is actually running. If a device
  // does NOT show "v5" it is running an OLD/cached bundle, not this code.
  const OWNER_LOGIN_BUILD = 'OWNER LOGIN DEVICE FIX v5';
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  const { height: winHeight } = useWindowDimensions();
  const isPad = Platform.OS === 'ios' && (Platform as unknown as { isPad?: boolean }).isPad === true;
  const diag: { key: string; val: string }[] = [
    { key: 'SHOW_OWNER_LOGIN', val: 'true' },
    { key: 'platform', val: Platform.OS },
    { key: 'isAndroid', val: String(Platform.OS === 'android') },
    { key: 'isIOS', val: String(Platform.OS === 'ios') },
    { key: 'isPad/tablet', val: String(isPad) },
    { key: 'screenWidth', val: String(Math.round(width)) },
    { key: 'screenHeight', val: String(Math.round(winHeight)) },
    { key: 'authLoaded', val: String(profileData !== undefined) },
    { key: 'sessionPresent', val: String(!!profileData) },
    { key: 'bundleStamp', val: extra.buildMarker ?? 'n/a' },
    { key: 'appVersion', val: Constants.expoConfig?.version ?? 'n/a' },
  ];

  // Non-sensitive diagnostic: confirms the Administration section (incl. Owner Login)
  // mounted on this device. No emails, passwords, or tokens are ever logged here.
  useEffect(() => {
    console.log('[Profile] Administration rendered — owner-login-button=true admin-panel-button=true');
  }, []);

  const handleLogout = () => {
    Alert.alert(
      t('signOut'),
      t('signOutConfirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('signOut'), style: 'destructive', onPress: () => { trackAction('logout'); void logout(); } },
      ]
    );
  };

  const getKYCStatusText = () => {
    switch (currentUser.kycStatus) {
      case 'approved':
        return t('verified');
      case 'pending':
        return t('pendingReview');
      case 'in_review':
        return t('underReview');
      case 'rejected':
        return t('verificationFailed');
      default:
        return t('unverified');
    }
  };

  const getKYCStatusColor = () => {
    switch (currentUser.kycStatus) {
      case 'approved':
        return Colors.success;
      case 'pending':
      case 'in_review':
        return Colors.warning;
      case 'rejected':
        return Colors.error;
      default:
        return Colors.textTertiary;
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: isXs ? 16 : 20 }]}>
          <Text style={[styles.headerTitle, { fontSize: isXs ? 24 : 28 }]}>{t('profile')}</Text>
          <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/security-settings' as any)}>
            <Settings size={isXs ? 22 : 24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={[styles.emergencyBanner, { marginHorizontal: isXs ? 16 : 20 }]} testID="owner-login-build-stamp-top">
            <Text style={styles.emergencyBannerText}>{OWNER_LOGIN_BUILD}</Text>
            <Text style={styles.emergencyBannerSub}>{Platform.OS} · {Math.round(width)}×{Math.round(winHeight)} · v{Constants.expoConfig?.version ?? '?'}</Text>
          </View>

          <TouchableOpacity
            style={[styles.ownerLoginButton, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 14 : 16, marginBottom: 12 }]}
            onPress={() => openOwnerLogin('top')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Owner Login"
            testID="owner-login-button-top"
          >
            <View style={[styles.ownerLoginIcon, { width: isCompact ? 38 : 44, height: isCompact ? 38 : 44 }]}>
              <Shield size={isXs ? 20 : 24} color={Colors.background} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.ownerLoginTitle, { fontSize: isXs ? 15 : 17 }]}>{ownerCardTitle}</Text>
              <Text style={[styles.ownerLoginSubtitle, { fontSize: isXs ? 11 : 12 }]}>{ownerCardSubtitle}</Text>
            </View>
            <ChevronRight size={isCompact ? 20 : 22} color={Colors.background} />
          </TouchableOpacity>

          <View style={[styles.diagPanel, { marginHorizontal: isXs ? 16 : 20 }]} testID="owner-login-diagnostic-panel">
            <Text style={styles.diagTitle}>OWNER LOGIN DIAGNOSTIC</Text>
            {diag.map((d) => (
              <View key={d.key} style={styles.diagRow}>
                <Text style={styles.diagKey}>{d.key}</Text>
                <Text style={styles.diagVal}>{d.val}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.profileCard, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 16 : 20 }]}>
            <Image
              source={{ uri: currentUser.avatar }}
              style={[styles.avatar, { width: isXs ? 60 : 72, height: isXs ? 60 : 72, borderRadius: isXs ? 30 : 36 }]}
            />
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.userName, { fontSize: isXs ? 17 : 20 }]}>
                  {currentUser.firstName} {currentUser.lastName}
                </Text>
                {currentUser.kycStatus === 'approved' && (
                  <BadgeCheck size={isXs ? 18 : 20} color={Colors.success} />
                )}
              </View>
              <Text style={[styles.userEmail, { fontSize: isXs ? 12 : 14 }]}>{currentUser.email}</Text>
              {!currentUser.isOwnerOrAdmin && (
                <View style={styles.kycBadge}>
                  <View style={[styles.kycDot, { backgroundColor: getKYCStatusColor() }]} />
                  <Text style={[styles.kycText, { color: getKYCStatusColor(), fontSize: isXs ? 11 : 12 }]}>
                    {getKYCStatusText()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('account')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<User size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('personalInfo')}
                subtitle={t('nameEmailPhone')}
                onPress={() => router.push('/personal-info' as any)}
                isCompact={isCompact}
              />
              {currentUser.role !== 'owner' && currentUser.role !== 'admin' && (
                <MenuItem
                  icon={<Shield size={isXs ? 18 : 20} color={Colors.success} />}
                  title={t('identityVerification')}
                  subtitle={'Optional — Not required to invest'}
                  onPress={() => router.push('/kyc-verification' as any)}
                  showBadge={currentUser.kycStatus === 'approved'}
                  badgeColor={getKYCStatusColor()}
                  isCompact={isCompact}
                />
              )}
              <MenuItem
                icon={<Globe size={isXs ? 18 : 20} color={Colors.info} />}
                title={t('taxInfo')}
                subtitle={currentUser.country}
                onPress={() => router.push('/tax-info' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('walletPayments')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<Wallet size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('walletPayments')}
                subtitle={`Balance: ${formatDollar(currentUser.walletBalance)}`}
                onPress={() => router.push('/wallet' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('documentsReports')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<BarChart3 size={isXs ? 18 : 20} color={'#4A90D9'} />}
                title="Analytics Report"
                subtitle="Real-time traffic & insights"
                onPress={() => router.push('/analytics-report' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<MessageSquare size={isXs ? 18 : 20} color={'#00C9A7'} />}
                title="SMS Reports"
                subtitle="Deliveries to Kimberly & Sharon"
                onPress={() => router.push('/sms-reports' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<PieChart size={isXs ? 18 : 20} color={Colors.success} />}
                title={t('investorProspectus')}
                subtitle={t('profitProjections')}
                onPress={() => router.push('/investor-prospectus' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<FileText size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('statements')}
                subtitle={t('monthlyStatements')}
                onPress={() => router.push('/statements' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<FileText size={isXs ? 18 : 20} color={Colors.info} />}
                title={t('taxDocuments')}
                subtitle={t('annualReports')}
                onPress={() => router.push('/tax-documents' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Scale size={isXs ? 18 : 20} color={'#1a3a5c'} />}
                title={t('contractGenerator')}
                subtitle={t('contractGeneratorDesc')}
                onPress={() => router.push('/contract-generator' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('preferences')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<Globe size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('language')}
                subtitle={currentLanguage ? `${currentLanguage.nativeName} (${currentLanguage.name})` : 'English'}
                onPress={() => router.push('/language' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Bell size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('notifications')}
                subtitle={t('emailPushSms')}
                onPress={() => router.push('/notification-settings' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Shield size={isXs ? 18 : 20} color={Colors.error} />}
                title={t('security')}
                subtitle={t('password2fa')}
                onPress={() => router.push('/security-settings' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('investorTools').toUpperCase()}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<IVXBrandIcon size={isXs ? 18 : 20} />}
                title={t('vipTiers')}
                subtitle={t('vipTiersDesc')}
                onPress={() => router.push('/vip-tiers' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Gift size={isXs ? 18 : 20} color={'#FF6B9D'} />}
                title={t('giftShares')}
                subtitle={t('giftSharesDesc')}
                onPress={() => router.push('/gift-shares' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<RefreshCw size={isXs ? 18 : 20} color={Colors.success} />}
                title={t('autoReinvestDrip')}
                subtitle={t('autoReinvestDesc')}
                onPress={() => router.push('/auto-reinvest' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Users size={isXs ? 18 : 20} color={Colors.info} />}
                title={t('topInvestors')}
                subtitle={t('topInvestorsDesc')}
                onPress={() => router.push('/copy-investing' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('rewardsOpportunities')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<Rocket size={isXs ? 18 : 20} color={'#FF6B6B'} />}
                title='Viral Growth Engine'
                subtitle='24/7 growth machine · $25 share rewards'
                onPress={() => router.push('/viral-growth' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Gift size={isXs ? 18 : 20} color={Colors.positive} />}
                title={t('referralsEarnings')}
                subtitle={t('referralsDesc')}
                onPress={() => router.push('/referrals' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Briefcase size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('becomeAgent')}
                subtitle={t('agentDesc')}
                onPress={() => router.push('/agent-apply' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Handshake size={isXs ? 18 : 20} color={Colors.info} />}
                title={t('becomeBroker')}
                subtitle={t('brokerDesc')}
                onPress={() => router.push('/broker-apply' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>BUSINESS CARD</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<CreditCard size={isXs ? 18 : 20} color={'#FFD700'} />}
                title='IVX Business Card'
                subtitle='QR card · Social links · Share instantly'
                onPress={() => router.push('/business-card' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('support')}</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<BookOpen size={isXs ? 18 : 20} color={Colors.positive} />}
                title={t('appGuide')}
                subtitle={t('appGuideDesc')}
                onPress={() => router.push('/app-guide' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<PieChart size={isXs ? 18 : 20} color={Colors.accent} />}
                title={'App Demo'}
                subtitle={'Interactive walkthrough'}
                onPress={() => router.push('/app-demo' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<HelpCircle size={isXs ? 18 : 20} color={Colors.primary} />}
                title={t('helpSupport')}
                subtitle={t('chatSupport')}
                onPress={() => router.push('/(tabs)/chat' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<FileText size={isXs ? 18 : 20} color={Colors.textSecondary} />}
                title={t('legal')}
                subtitle={t('legalDesc')}
                onPress={() => router.push('/legal' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>AI & AUTOMATION</Text>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20 }]}>
              <MenuItem
                icon={<Brain size={isXs ? 18 : 20} color='#A855F7' />}
                title='AI & Automation Report'
                subtitle='13 modules · 90+ functions · WhatsApp alerts'
                onPress={() => router.push('/ai-automation-report' as any)}
                isCompact={isCompact}
              />
              <MenuItem
                icon={<Code2 size={isXs ? 18 : 20} color='#0EA5E9' />}
                title='API Integration List'
                subtitle='All APIs with registration links'
                onPress={() => router.push('/api-list' as any)}
                isCompact={isCompact}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: isXs ? 16 : 20, fontSize: isXs ? 12 : 14 }]}>{t('administration')}</Text>
            <TouchableOpacity
              style={[styles.ownerLoginButton, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 14 : 16 }]}
              onPress={() => openOwnerLogin('administration')}
              activeOpacity={0.8}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Owner Login, direct approved-owner sign in inside the app"
              testID="owner-login-button"
            >
              <View style={[styles.ownerLoginIcon, { width: isCompact ? 38 : 44, height: isCompact ? 38 : 44 }]}>
                <Shield size={isXs ? 20 : 24} color={Colors.background} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.ownerLoginTitle, { fontSize: isXs ? 15 : 17 }]}>{ownerCardTitle}</Text>
                <Text style={[styles.ownerLoginSubtitle, { fontSize: isXs ? 11 : 12 }]}>{isOwnerSession ? 'Signed in — open owner console inside the app' : 'Direct approved-owner sign in inside the app'}</Text>
              </View>
              <ChevronRight size={isCompact ? 20 : 22} color={Colors.background} />
            </TouchableOpacity>
            <View style={[styles.menuGroup, { marginHorizontal: isXs ? 16 : 20, marginTop: 12 }]}>
              <MenuItem
                icon={<LayoutDashboard size={isXs ? 18 : 20} color={Colors.warning} />}
                title={t('adminPanel')}
                subtitle={t('adminDesc')}
                onPress={() => {
                  console.log('[Profile] Admin Panel tapped -> /admin');
                  router.push('/admin' as any);
                }}
                isCompact={isCompact}
                testID="admin-panel-button"
              />
            </View>
          </View>

          <TouchableOpacity style={[styles.logoutButton, { marginHorizontal: isXs ? 16 : 20, paddingVertical: isXs ? 14 : 16 }]} onPress={handleLogout}>
            <LogOut size={isXs ? 18 : 20} color={Colors.error} />
            <Text style={[styles.logoutText, { fontSize: isXs ? 14 : 15 }]}>{t('signOut')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.companySection, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 16 : 20 }]}
            onPress={() => router.push('/company-info' as any)}
            activeOpacity={0.7}
          >
            <View style={styles.companyHeader}>
              <Image
                source={IVX_LOGO_SOURCE}
                style={[styles.companyLogo, { width: isXs ? 40 : 48, height: isXs ? 40 : 48 }]}
                resizeMode="contain"
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.companyName, { fontSize: isXs ? 17 : 20 }]}>IVX HOLDINGS LLC</Text>
                <Text style={{ fontSize: isXs ? 11 : 12, color: Colors.primary, marginTop: 2 }}>{t('tapToViewContact')}</Text>
              </View>
              <ChevronRight size={20} color={Colors.textTertiary} />
            </View>
            <View style={styles.companyDetails}>
              <View style={styles.companyDetailRow}>
                <MapPin size={isXs ? 14 : 16} color={Colors.textTertiary} />
                <Text style={[styles.companyDetailText, { fontSize: isXs ? 11 : 13 }]}>1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131</Text>
              </View>
              <View style={styles.companyDetailRow}>
                <Mail size={isXs ? 14 : 16} color={Colors.textTertiary} />
                <Text style={[styles.companyDetailText, { fontSize: isXs ? 11 : 13 }]}>support@ivxholding.com</Text>
              </View>
              <View style={styles.companyDetailRow}>
                <Mail size={isXs ? 14 : 16} color={Colors.primary} />
                <Text style={[styles.companyDetailText, { fontSize: isXs ? 11 : 13 }]}>ceo@ivxholding.com</Text>
              </View>
            </View>
            <Text style={[styles.companyLegal, { fontSize: isXs ? 10 : 11 }]}>
              © 2026 IVX HOLDINGS LLC. All rights reserved. Licensed and regulated.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ownerLoginButton, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 14 : 16, marginBottom: 16 }]}
            onPress={() => openOwnerLogin('bottom')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Owner Login"
            testID="owner-login-button-bottom"
          >
            <View style={[styles.ownerLoginIcon, { width: isCompact ? 38 : 44, height: isCompact ? 38 : 44 }]}>
              <Shield size={isXs ? 20 : 24} color={Colors.background} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.ownerLoginTitle, { fontSize: isXs ? 15 : 17 }]}>{ownerCardTitle}</Text>
              <Text style={[styles.ownerLoginSubtitle, { fontSize: isXs ? 11 : 12 }]}>{ownerCardSubtitle}</Text>
            </View>
            <ChevronRight size={isCompact ? 20 : 22} color={Colors.background} />
          </TouchableOpacity>

          <View style={[styles.emergencyBanner, { marginHorizontal: isXs ? 16 : 20 }]} testID="owner-login-build-stamp-bottom">
            <Text style={styles.emergencyBannerText}>{OWNER_LOGIN_BUILD}</Text>
            <Text style={styles.emergencyBannerSub}>bottom marker · {Platform.OS}</Text>
          </View>

          <Text style={styles.versionText}>{t('versionLabel')} 1.2.1</Text>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  headerTitle: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  settingsButton: {
    padding: 8,
  },
  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  avatar: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  profileInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  userName: {
    fontWeight: '700' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  userEmail: {
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  kycBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kycDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  kycText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: Colors.textTertiary,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    flexShrink: 1,
  },
  menuGroup: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  ownerLoginHighlight: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    backgroundColor: Colors.surfaceLight,
  },
  ownerLoginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.primary,
    borderRadius: 14,
  },
  emergencyBanner: {
    backgroundColor: '#D32029',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  emergencyBannerText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  emergencyBannerSub: {
    color: '#FFFFFF',
    fontSize: 11,
    opacity: 0.9,
    marginTop: 2,
  },
  ownerLoginTopBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  ownerLoginIcon: {
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerLoginTitle: {
    color: Colors.background,
    fontWeight: '800' as const,
  },
  ownerLoginSubtitle: {
    color: Colors.background,
    opacity: 0.85,
    marginTop: 2,
  },
  adminSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminBuildStamp: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  adminBuildStampText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.background,
    letterSpacing: 0.5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  menuItemIcon: {
    borderRadius: 10,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemTitle: {
    color: Colors.text,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  menuItemSubtitle: {
    color: Colors.textTertiary,
    marginTop: 2,
    flexShrink: 1,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.error + '15',
    borderRadius: 14,
    marginBottom: 24,
  },
  logoutText: {
    color: Colors.error,
    fontWeight: '700' as const,
  },
  versionText: {
    color: Colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 4,
  },
  buildStampText: {
    color: Colors.primary,
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  companySection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  companyLogo: {
    borderRadius: 12,
  },
  companyName: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  companyDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  companyDetails: {
    gap: 8,
    marginBottom: 12,
  },
  companyDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  companyDetailText: {
    color: Colors.textSecondary,
    flex: 1,
  },
  companyLegal: {
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 12,
  },
  bottomPadding: {
    height: 120,
  },
  buildStampTop: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  buildStampTopText: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  buildStampTopSub: {
    color: Colors.background,
    fontSize: 10,
    opacity: 0.85,
    marginTop: 2,
  },
  diagPanel: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 12,
    marginBottom: 12,
  },
  diagTitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  diagKey: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  diagVal: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  scrollView: {
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 160,
    flexGrow: 1,
  },
});
