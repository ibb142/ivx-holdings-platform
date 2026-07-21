import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { LogOut, Shield } from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import Colors from '@/constants/colors';

export function OwnerAuthActions(): React.ReactElement | null {
  const router = useRouter();
  const { isAuthenticated, logout, userRole } = useAuth();

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      'This clears the current Supabase session and returns you to the landing screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void logout();
            router.replace('/landing' as never);
          },
        },
      ],
    );
  };

  const handleOwnerLogin = () => {
    router.push({ pathname: '/login', params: { mode: 'owner' } } as never);
  };

  return (
    <View style={styles.card} testID="owner-auth-actions">
      <View style={styles.row}>
        <Shield size={14} color={Colors.primary} />
        <Text style={styles.title}>Owner session</Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.label}>Signed in:</Text>
        <Text style={styles.value}>{isAuthenticated ? 'yes' : 'no'}</Text>
      </View>
      {userRole ? (
        <View style={styles.statusRow}>
          <Text style={styles.label}>Role:</Text>
          <Text style={styles.value}>{userRole}</Text>
        </View>
      ) : null}
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, styles.secondaryButton]}
          onPress={handleSignOut}
          testID="owner-auth-actions-sign-out"
        >
          <LogOut size={14} color={Colors.text} />
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.primaryButton]}
          onPress={handleOwnerLogin}
          testID="owner-auth-actions-owner-login"
        >
          <IVXBrandIcon size={14} />
          <Text style={styles.primaryButtonText}>Owner login</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.25)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  value: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  primaryButtonText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
});
