import React, { useMemo } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

/** Stable authenticated in-app entrypoint to the Owner Dashboard. */
export default function OwnerConsoleRoute() {
  const { isLoading, isAuthenticated, profileData } = useAuth();
  const openAccess = isOpenAccessModeEnabled();
  const isOwner = useMemo(() => {
    if (openAccess) return true;
    const role = ((profileData as { role?: string } | null)?.role ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [openAccess, profileData]);

  if (isLoading) {
    return (
      <View style={styles.center} testID="owner-console-auth-verifying">
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.text}>Verifying owner access…</Text>
      </View>
    );
  }

  if (!openAccess && (!isAuthenticated || !isOwner)) {
    return <Redirect href="/login?ownerMode=1" />;
  }

  return <Redirect href="/admin/dashboard" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  text: { marginTop: 12, color: Colors.textSecondary, fontSize: 14, fontWeight: '600' as const },
});
