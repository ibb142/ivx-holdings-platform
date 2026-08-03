import React, { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { checkOwnerAccess, OwnerAccessProfile } from '@/lib/owner-access-check';

interface OwnerOnlyProps {
  children: ReactNode;
  /** Optional profile object; falls back to the authenticated user's role. */
  profile?: OwnerAccessProfile | null;
  /** Custom node rendered when access is denied. */
  fallback?: ReactNode;
}

/**
 * Gates its children behind owner access. Renders a clear "Owner Access Only"
 * notice (or a custom fallback) when the current user is not an owner.
 */
export function OwnerOnly({ children, profile, fallback }: OwnerOnlyProps) {
  const { user, userRole } = useAuth();

  const access = useMemo(
    () => checkOwnerAccess(user, profile ?? { role: userRole }),
    [user, profile, userRole],
  );

  if (!access.allowed) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }

    return (
      <View style={styles.container} testID="owner-access-denied">
        <View style={styles.iconWrap}>
          <Lock size={28} color={Colors.warning} />
        </View>
        <Text style={styles.title}>Owner Access Only</Text>
        <Text style={styles.reason}>{access.reason}</Text>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12},
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.warning + '22'},
  title: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  reason: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const}});

export default OwnerOnly;
