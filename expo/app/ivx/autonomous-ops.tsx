import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Database } from 'lucide-react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

export function EnterpriseAutonomousDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <SafeAreaProvider>
      <View style={{ paddingTop: insets.top }}>
        {/* Hero View End */}
        {/* New Tile Button */}
        <Pressable
          style={styles.ledgerTile}
          testID="open-112-production-ledger"
          accessibilityRole="button"
          accessibilityLabel='Open 112 IA Real Production Ledger'
          onPress={() => router.push('/ivx/agent-ledger')}
        >
          <Database />
          <View style={styles.ledgerTileText}>
            <Text style={styles.ledgerTileTitle}>112 IA Real Production Ledger</Text>
            <Text style={styles.ledgerTileSubtitle}>IA-by-IA work, productive time, status and proof evidence</Text>
          </View>
        </Pressable> 
        {/* Radar Panel Start */}
        <View>
          {/* Existing content */}
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  ledgerTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: 'surface',
    borderColor: 'primary',
    borderRadius: 15,
    padding: 14,
  },
  ledgerTileText: {
    flex: 1,
    gap: 2,
  },
  ledgerTileTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: 'primary',
  },
  ledgerTileSubtitle: {
    fontSize: 11,
    color: 'textSecondary',
  },
});
