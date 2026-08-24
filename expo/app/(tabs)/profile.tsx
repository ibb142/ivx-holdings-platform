import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

export const IVX_PROFILE_FULL_FAILSAFE_MARKER = 'ivx-profile-full-failsafe-2026-08-24';

type RouteItem = {
  title: string;
  subtitle: string;
  route: string;
  ownerOnly?: boolean;
  memberOnly?: boolean;
};

type Section = {
  title: string;
  items: RouteItem[];
};

const SECTIONS: Section[] = [
  {
    title: 'ACCOUNT',
    items: [
      { title: 'Personal Information', subtitle: 'Name, email and phone', route: '/personal-info' },
      { title: 'Identity Verification', subtitle: 'Optional identity and KYC information', route: '/kyc-verification', memberOnly: true },
      { title: 'Tax Information', subtitle: 'Country and tax profile', route: '/tax-info' },
    ],
  },
  {
    title: 'WALLET & PAYMENTS',
    items: [
      { title: 'Wallet & Payments', subtitle: 'Balance, funding and transactions', route: '/wallet' },
    ],
  },
  {
    title: 'DOCUMENTS & REPORTS',
    items: [
      { title: 'Analytics Report', subtitle: 'Traffic and investment insights', route: '/analytics-report' },
      { title: 'SMS Reports', subtitle: 'Messaging delivery reports', route: '/sms-reports' },
      { title: 'Investor Prospectus', subtitle: 'Investment and profit projections', route: '/investor-prospectus' },
      { title: 'Statements', subtitle: 'Monthly account statements', route: '/statements' },
      { title: 'Tax Documents', subtitle: 'Annual tax reports', route: '/tax-documents' },
      { title: 'Contract Generator', subtitle: 'Create investment contracts', route: '/contract-generator' },
    ],
  },
  {
    title: 'PREFERENCES',
    items: [
      { title: 'Language', subtitle: 'Choose application language', route: '/language' },
      { title: 'Notifications', subtitle: 'Email, push and SMS preferences', route: '/notification-settings' },
      { title: 'Security', subtitle: 'Password, biometrics and account protection', route: '/security-settings' },
    ],
  },
  {
    title: 'INVESTOR TOOLS',
    items: [
      { title: 'VIP Tiers', subtitle: 'Membership and investor benefits', route: '/vip-tiers' },
      { title: 'Gift Shares', subtitle: 'Gift investment shares', route: '/gift-shares' },
      { title: 'Auto Reinvest', subtitle: 'Automatic reinvestment controls', route: '/auto-reinvest' },
      { title: 'Top Investors', subtitle: 'Copy investing and investor discovery', route: '/copy-investing' },
    ],
  },
  {
    title: 'REWARDS & OPPORTUNITIES',
    items: [
      { title: 'Viral Growth Engine', subtitle: 'Growth and sharing rewards', route: '/viral-growth' },
      { title: 'Referrals & Earnings', subtitle: 'Referral activity and rewards', route: '/referrals' },
      { title: 'Become an Agent', subtitle: 'Agent application', route: '/agent-apply' },
      { title: 'Become a Broker', subtitle: 'Broker application', route: '/broker-apply' },
    ],
  },
  {
    title: 'BUSINESS CARD',
    items: [
      { title: 'IVX Business Card', subtitle: 'QR card, social links and sharing', route: '/business-card' },
    ],
  },
  {
    title: 'SUPPORT',
    items: [
      { title: 'IVX Agent Hub', subtitle: 'Domain agents and assistance', route: '/agent-hub' },
      { title: 'Knowledge Base', subtitle: 'Architecture, investing, QA and security', route: '/knowledge-base' },
      { title: 'App Guide', subtitle: 'Learn how to use IVX Holdings', route: '/app-guide' },
      { title: 'App Demo', subtitle: 'Interactive product walkthrough', route: '/app-demo' },
      { title: 'Help & Support', subtitle: 'Open IVX support chat', route: '/(tabs)/chat' },
      { title: 'Legal', subtitle: 'Terms, policies and legal information', route: '/legal' },
    ],
  },
  {
    title: 'AI & AUTOMATION',
    items: [
      { title: 'AI & Automation Report', subtitle: 'AI modules and automation status', route: '/ai-automation-report' },
      { title: 'API Integration List', subtitle: 'Connected APIs and integration references', route: '/api-list' },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { title: 'Admin Panel', subtitle: 'Administration dashboard', route: '/admin', ownerOnly: true },
    ],
  },
  {
    title: 'COMPANY',
    items: [
      { title: 'IVX Holdings LLC', subtitle: 'Company and contact information', route: '/company-info' },
    ],
  },
];

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ProfileRow({ item, onPress, index }: { item: RouteItem; onPress: () => void; index: number }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.75}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.subtitle}`}
      testID={`profile-route-${index}`}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { profileData, logout } = useAuth();

  const profile = useMemo(() => {
    const raw = (profileData ?? {}) as Record<string, unknown>;
    const firstName = safeString(raw.firstName);
    const lastName = safeString(raw.lastName);
    const email = safeString(raw.email);
    const role = safeString(raw.role).toLowerCase();
    return {
      displayName: `${firstName} ${lastName}`.trim() || 'IVX Member',
      email,
      role,
    };
  }, [profileData]);

  const isOwner = profile.role === 'owner' || profile.role === 'admin';

  const visibleSections = useMemo(
    () => SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.ownerOnly || isOwner) && (!item.memberOnly || !isOwner)),
    })).filter((section) => section.items.length > 0),
    [isOwner],
  );

  const openOwner = () => {
    if (isOwner) {
      router.push('/admin/ivx-developer-workspace' as any);
      return;
    }
    router.push({ pathname: '/login', params: { ownerMode: '1' } } as any);
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  let routeIndex = 0;

  return (
    <View style={styles.root} testID="profile-root" accessibilityLabel="Profile screen">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>IVX HOLDINGS</Text>
            <Text style={styles.title} testID="profile-title">Profile</Text>
          </View>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => router.push('/security-settings' as any)}
            accessibilityRole="button"
            accessibilityLabel="Open security settings"
            testID="profile-settings"
          >
            <Text style={styles.settingsText}>Settings</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.identityCard} testID="profile-identity-card">
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profile.displayName.charAt(0).toUpperCase() || 'I'}</Text>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.name} numberOfLines={1}>{profile.displayName}</Text>
              <Text style={styles.email} numberOfLines={1}>{profile.email || 'Signed in to IVX Holdings'}</Text>
              <View style={styles.rolePill}>
                <Text style={styles.roleText}>{isOwner ? 'OWNER' : 'MEMBER'}</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.ownerCard}
            onPress={openOwner}
            accessibilityRole="button"
            accessibilityLabel={isOwner ? 'Owner Console' : 'Owner Login'}
            testID="owner-login-button"
          >
            <View style={styles.rowCopy}>
              <Text style={styles.ownerTitle}>{isOwner ? 'Owner Console' : 'Owner Login'}</Text>
              <Text style={styles.ownerSubtitle}>
                {isOwner ? 'Open owner controls and IVX developer workspace' : 'Approved-owner secure sign in'}
              </Text>
            </View>
            <Text style={styles.ownerChevron}>›</Text>
          </TouchableOpacity>

          {visibleSections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.group}>
                {section.items.map((item) => {
                  const index = routeIndex++;
                  return (
                    <ProfileRow
                      key={item.route}
                      item={item}
                      index={index}
                      onPress={() => router.push(item.route as any)}
                    />
                  );
                })}
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Sign Out"
            testID="profile-sign-out"
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>IVX PROFILE FULL SAFE MODE · {IVX_PROFILE_FULL_FAILSAFE_MARKER}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090D' },
  safeArea: { flex: 1, backgroundColor: '#08090D' },
  header: {
    minHeight: 82,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#252733',
  },
  eyebrow: { color: '#C6A900', fontSize: 10, fontWeight: '800', letterSpacing: 2.1, marginBottom: 3 },
  title: { color: '#FFFFFF', fontSize: 29, fontWeight: '800' },
  settingsButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#171821',
    borderWidth: 1,
    borderColor: '#2D2F3B',
  },
  settingsText: { color: '#FFD700', fontWeight: '700', fontSize: 13 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 130 },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#12131A',
    borderWidth: 1,
    borderColor: '#262833',
    marginBottom: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#26210A',
    borderWidth: 1,
    borderColor: '#665600',
    marginRight: 14,
  },
  avatarText: { color: '#FFD700', fontSize: 28, fontWeight: '900' },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', marginBottom: 3 },
  email: { color: '#9397A6', fontSize: 13, marginBottom: 8 },
  rolePill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, backgroundColor: '#2A2407' },
  roleText: { color: '#FFD700', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  ownerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 17,
    borderRadius: 16,
    backgroundColor: '#211D08',
    borderWidth: 1,
    borderColor: '#665700',
    marginBottom: 24,
  },
  ownerTitle: { color: '#FFD700', fontSize: 16, fontWeight: '800', marginBottom: 3 },
  ownerSubtitle: { color: '#B6A85D', fontSize: 12, lineHeight: 17 },
  ownerChevron: { color: '#FFD700', fontSize: 28, marginLeft: 12 },
  section: { marginBottom: 20 },
  sectionTitle: { color: '#727685', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 9, marginLeft: 2 },
  group: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#12131A', borderWidth: 1, borderColor: '#262833' },
  row: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292B35',
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#F2F3F5', fontSize: 15, fontWeight: '700', marginBottom: 3 },
  rowSubtitle: { color: '#858997', fontSize: 12, lineHeight: 17 },
  chevron: { color: '#777C8A', fontSize: 28, lineHeight: 28, marginLeft: 12 },
  signOutButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#58292E',
    backgroundColor: '#251316',
    marginTop: 2,
  },
  signOutText: { color: '#FF727D', fontSize: 15, fontWeight: '800' },
  footer: { color: '#4C4F5B', textAlign: 'center', fontSize: 9, letterSpacing: 0.4, marginTop: 22 },
});
