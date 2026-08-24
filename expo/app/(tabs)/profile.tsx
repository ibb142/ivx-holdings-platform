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
import {
  ChevronRight,
  LogOut,
  Settings,
  Shield,
  User,
  Wallet,
} from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';

/**
 * Profile is a critical navigation surface. It must paint usable UI before any
 * optional network/realtime/classification work. The previous screen mounted
 * multiple Supabase queries + realtime subscriptions + classification hooks at
 * once; any runtime failure in that chain could take the whole tab down and
 * leave the navigator showing only its black root background.
 *
 * Keep this shell deliberately dependency-light. Secondary profile modules are
 * reached through routes and can load their own data without risking this tab.
 */
export const IVX_PROFILE_FAILSAFE_MARKER = 'ivx-profile-failsafe-2026-08-24';

type SafeProfile = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ProfileAction({
  title,
  subtitle,
  icon,
  onPress,
  testID,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      style={styles.action}
      onPress={onPress}
      activeOpacity={0.75}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <View style={styles.actionTextWrap}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={20} color="#7E8797" />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { logout, profileData } = useAuth();

  const profile = useMemo<SafeProfile>(() => {
    const raw = (profileData ?? {}) as Record<string, unknown>;
    return {
      firstName: readString(raw.firstName),
      lastName: readString(raw.lastName),
      email: readString(raw.email),
      role: readString(raw.role).toLowerCase(),
    };
  }, [profileData]);

  const displayName = `${profile.firstName} ${profile.lastName}`.trim() || 'IVX Member';
  const isOwner = profile.role === 'owner' || profile.role === 'admin';

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

  const openOwner = () => {
    if (isOwner) {
      router.push('/admin/ivx-developer-workspace' as never);
      return;
    }
    router.push({ pathname: '/login', params: { ownerMode: '1' } } as never);
  };

  return (
    <View style={styles.root} testID="profile-root">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ACCOUNT</Text>
            <Text style={styles.title}>Profile</Text>
          </View>
          <TouchableOpacity
            testID="profile-settings"
            style={styles.settingsButton}
            onPress={() => router.push('/security-settings' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open security settings"
          >
            <Settings size={23} color="#F5F7FA" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identityCard} testID="profile-identity-card">
            <View style={styles.avatar}>
              <User size={31} color="#FFD700" />
            </View>
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.email} numberOfLines={1}>
                {profile.email || 'Signed in to IVX Holdings'}
              </Text>
              {isOwner ? (
                <View style={styles.ownerBadge}>
                  <Shield size={13} color="#0A0A0F" />
                  <Text style={styles.ownerBadgeText}>OWNER</Text>
                </View>
              ) : null}
            </View>
          </View>

          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.group}>
            <ProfileAction
              testID="profile-personal-info"
              title="Personal Information"
              subtitle="Name, email and phone"
              icon={<User size={21} color="#FFD700" />}
              onPress={() => router.push('/personal-info' as never)}
            />
            <ProfileAction
              testID="profile-wallet"
              title="Wallet & Payments"
              subtitle="Balance, funding and transactions"
              icon={<Wallet size={21} color="#FFD700" />}
              onPress={() => router.push('/wallet' as never)}
            />
            <ProfileAction
              testID="profile-security"
              title="Security"
              subtitle="Password, biometrics and account protection"
              icon={<Shield size={21} color="#FFD700" />}
              onPress={() => router.push('/security-settings' as never)}
            />
          </View>

          <Text style={styles.sectionLabel}>IVX CONTROL</Text>
          <View style={styles.group}>
            <ProfileAction
              testID="profile-owner-entry"
              title={isOwner ? 'Owner Console' : 'Owner Login'}
              subtitle={isOwner ? 'Open IVX owner workspace' : 'Approved-owner secure sign in'}
              icon={<Shield size={21} color="#FFD700" />}
              onPress={openOwner}
            />
          </View>

          <TouchableOpacity
            testID="profile-sign-out"
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOut size={20} color="#FF6B6B" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>

          <Text style={styles.marker}>IVX PROFILE SAFE MODE · {IVX_PROFILE_FAILSAFE_MARKER}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0F' },
  safeArea: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    minHeight: 76,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { color: '#776B31', fontSize: 10, letterSpacing: 2.2, fontWeight: '800' },
  title: { color: '#F7F7F7', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17171D',
    borderWidth: 1,
    borderColor: '#292931',
  },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 120 },
  identityCard: {
    minHeight: 116,
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15151B',
    borderWidth: 1,
    borderColor: '#2B2B33',
    marginBottom: 24,
  },
  avatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#211E0B',
    borderWidth: 1,
    borderColor: '#5A4F12',
  },
  identityText: { flex: 1, minWidth: 0, paddingLeft: 16 },
  name: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  email: { color: '#969CAB', fontSize: 13, marginTop: 5 },
  ownerBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    backgroundColor: '#FFD700',
  },
  ownerBadgeText: { color: '#0A0A0F', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionLabel: {
    color: '#747989',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginLeft: 4,
    marginBottom: 8,
    marginTop: 4,
  },
  group: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#282831',
    backgroundColor: '#141419',
    marginBottom: 22,
  },
  action: {
    minHeight: 74,
    paddingHorizontal: 15,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2B2B33',
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#211E0B',
  },
  actionTextWrap: { flex: 1, minWidth: 0, paddingHorizontal: 13 },
  actionTitle: { color: '#F4F4F5', fontSize: 15, fontWeight: '700' },
  actionSubtitle: { color: '#868C99', fontSize: 12, marginTop: 4 },
  logoutButton: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4C2528',
    backgroundColor: '#201315',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 2,
  },
  logoutText: { color: '#FF7777', fontSize: 15, fontWeight: '800' },
  marker: {
    marginTop: 22,
    color: '#383A43',
    textAlign: 'center',
    fontSize: 9,
    letterSpacing: 0.6,
  },
});
