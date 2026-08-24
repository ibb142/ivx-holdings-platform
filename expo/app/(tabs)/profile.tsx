import React, { useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

/**
 * Profile is deliberately a fail-safe navigation surface.
 *
 * Device QA on 2026-08-23 reproduced a production-only total black screen when
 * the previous Profile tree mounted. Home remained healthy and the process was
 * alive immediately before the Profile tab was selected. Keep this screen free
 * of realtime subscriptions, remote queries and optional image/icon renderers:
 * Profile must paint synchronously from authenticated local state first. Every
 * secondary feature remains reachable through simple route rows below.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { profileData, logout } = useAuth();

  const user = useMemo(() => {
    const raw = (profileData ?? {}) as Record<string, unknown>;
    const firstName = typeof raw.firstName === 'string' ? raw.firstName.trim() : '';
    const lastName = typeof raw.lastName === 'string' ? raw.lastName.trim() : '';
    const email = typeof raw.email === 'string' ? raw.email.trim() : '';
    const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';
    const displayName = `${firstName} ${lastName}`.trim() || 'IVX Member';
    return { displayName, email, role };
  }, [profileData]);

  const isOwner = user.role === 'owner' || user.role === 'admin';

  const rows = [
    { title: 'Personal Information', subtitle: 'Name, email and phone', route: '/personal-info' },
    { title: 'Wallet & Payments', subtitle: 'Balance, funding and transactions', route: '/wallet' },
    { title: 'Statements', subtitle: 'Monthly account statements', route: '/statements' },
    { title: 'Tax Documents', subtitle: 'Annual tax reports', route: '/tax-documents' },
    { title: 'Security', subtitle: 'Password and account protection', route: '/security-settings' },
    { title: 'Notifications', subtitle: 'Email, push and SMS preferences', route: '/notification-settings' },
    { title: 'Language', subtitle: 'Choose application language', route: '/language' },
    { title: 'Knowledge Base', subtitle: 'IVX guides and documentation', route: '/knowledge-base' },
    { title: 'Help & Support', subtitle: 'Open IVX support chat', route: '/(tabs)/chat' },
  ] as const;

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void logout();
        },
      },
    ]);
  };

  return (
    <View style={styles.root} testID="profile-screen-root" accessibilityLabel="Profile screen">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>IVX HOLDINGS</Text>
            <Text style={styles.title} testID="profile-title">Profile</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open security settings"
            testID="profile-settings-button"
            style={styles.headerButton}
            onPress={() => router.push('/security-settings' as any)}
          >
            <Text style={styles.headerButtonText}>Settings</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identityCard} testID="profile-identity-card">
            <View style={styles.avatar} accessibilityElementsHidden>
              <Text style={styles.avatarText}>
                {(user.displayName.charAt(0) || 'I').toUpperCase()}
              </Text>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.name}>{user.displayName}</Text>
              <Text style={styles.email}>{user.email || 'Signed in to IVX'}</Text>
              <View style={styles.rolePill}>
                <Text style={styles.roleText}>{isOwner ? 'OWNER' : 'MEMBER'}</Text>
              </View>
            </View>
          </View>

          {isOwner && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Owner Console"
              testID="profile-owner-console"
              style={styles.ownerCard}
              onPress={() => router.push('/admin/ivx-developer-workspace' as any)}
            >
              <View style={styles.rowText}>
                <Text style={styles.ownerTitle}>Owner Console</Text>
                <Text style={styles.ownerSubtitle}>Open IVX owner controls and developer workspace</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.sectionTitle}>ACCOUNT & SETTINGS</Text>
          <View style={styles.menuCard}>
            {rows.map((item, index) => (
              <TouchableOpacity
                key={item.route}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                testID={`profile-row-${index}`}
                style={[styles.menuRow, index < rows.length - 1 && styles.rowBorder]}
                onPress={() => router.push(item.route as any)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign Out"
            testID="profile-sign-out"
            style={styles.signOutButton}
            onPress={handleLogout}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>IVX Holdings · Secure Profile</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08090D',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#08090D',
  },
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
  eyebrow: {
    color: '#C6A900',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.1,
    marginBottom: 3,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 29,
    fontWeight: '800',
  },
  headerButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#171821',
    borderWidth: 1,
    borderColor: '#2D2F3B',
  },
  headerButtonText: {
    color: '#FFD700',
    fontWeight: '700',
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
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
  avatarText: {
    color: '#FFD700',
    fontSize: 28,
    fontWeight: '900',
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 3,
  },
  email: {
    color: '#9397A6',
    fontSize: 13,
    marginBottom: 8,
  },
  rolePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#2A2407',
  },
  roleText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  ownerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 17,
    borderRadius: 16,
    backgroundColor: '#211D08',
    borderWidth: 1,
    borderColor: '#665700',
    marginBottom: 22,
  },
  ownerTitle: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 3,
  },
  ownerSubtitle: {
    color: '#B6A85D',
    fontSize: 12,
    lineHeight: 17,
  },
  sectionTitle: {
    color: '#727685',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 9,
    marginLeft: 2,
  },
  menuCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#12131A',
    borderWidth: 1,
    borderColor: '#262833',
  },
  menuRow: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292B35',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#F2F3F5',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  rowSubtitle: {
    color: '#858997',
    fontSize: 12,
    lineHeight: 17,
  },
  chevron: {
    color: '#777C8A',
    fontSize: 28,
    lineHeight: 28,
    marginLeft: 12,
  },
  signOutButton: {
    marginTop: 22,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#58292E',
    backgroundColor: '#251316',
  },
  signOutText: {
    color: '#FF727D',
    fontSize: 15,
    fontWeight: '800',
  },
  footer: {
    color: '#4C4F5B',
    textAlign: 'center',
    fontSize: 11,
    marginTop: 20,
  },
});
