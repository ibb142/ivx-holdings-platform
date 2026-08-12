import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Animated} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ChevronRight,
  RefreshCw,
  TrendingUp,
  Building2,
  Check,
  Info,
  DollarSign,
  Calendar} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useHoldings } from '@/lib/data-hooks';
import { formatCurrencyWithDecimals } from '@/lib/formatters';

interface DRIPSetting {
  propertyId: string;
  propertyName: string;
  enabled: boolean;
  nextDividendDate: string;
  estimatedDividend: number;
  sharesOwned: number;
  pricePerShare: number;
}

export default function AutoReinvestScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { holdings } = useHoldings();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnims = useRef(holdings.map(() => new Animated.Value(0))).current;

  const [globalDRIP, setGlobalDRIP] = useState(false);
  const [dripSettings, setDripSettings] = useState<DRIPSetting[]>([]);

  React.useEffect(() => {
    if (holdings.length > 0 && dripSettings.length === 0) {
      setDripSettings(holdings.map(h => ({
        propertyId: h.propertyId,
        propertyName: h.property?.name || 'Property',
        enabled: false,
        nextDividendDate: '2026-06-01',
        estimatedDividend: h.shares * 0.40,
        sharesOwned: h.shares,
        pricePerShare: h.avgCostBasis || 0})));
    }
  }, [holdings, dripSettings.length]);

  useEffect(() => {
    slideAnims.forEach((anim, index) => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 400,
        delay: 100 + index * 100,
        useNativeDriver: true}).start();
    });
  }, [slideAnims]);

  const toggleGlobalDRIP = useCallback((value: boolean) => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setGlobalDRIP(value);
    setDripSettings(prev => prev.map(s => ({ ...s, enabled: value })));

    if (value) {
      logger.drip.log('Global auto-reinvest enabled for all holdings');
    } else {
      logger.drip.log('Global auto-reinvest disabled');
    }
  }, [pulseAnim]);

  const togglePropertyDRIP = useCallback((propertyId: string, value: boolean) => {
    setDripSettings(prev => {
      const updated = prev.map(s =>
        s.propertyId === propertyId ? { ...s, enabled: value } : s
      );
      const allEnabled = updated.every(s => s.enabled);
      setGlobalDRIP(allEnabled);
      return updated;
    });

    logger.drip.log(`Auto-reinvest ${value ? 'enabled' : 'disabled'} for property ${propertyId}`);
  }, []);

  const totalEstimatedDividend = dripSettings.reduce((sum, s) => sum + s.estimatedDividend, 0);
  const enabledCount = dripSettings.filter(s => s.enabled).length;
  const totalReinvestValue = dripSettings
    .filter(s => s.enabled)
    .reduce((sum, s) => sum + s.estimatedDividend, 0);

  const estimatedNewShares = dripSettings
    .filter(s => s.enabled)
    .reduce((sum, s) => sum + (s.estimatedDividend / s.pricePerShare), 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronRight size={24} color={Colors.text} style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Auto-Reinvest (DRIP)</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
          <View style={styles.heroCard}>
            <View style={styles.dripIcon}>
              <RefreshCw size={28} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Dividend Reinvestment</Text>
            <Text style={styles.heroSubtext}>
              Automatically reinvest your dividends to buy more shares. Compound your returns over time.
            </Text>
          </View>

          <Animated.View style={[styles.globalToggle, { transform: [{ scale: pulseAnim }] }]}>
            <View style={styles.globalToggleLeft}>
              <View style={[styles.globalIcon, { backgroundColor: globalDRIP ? Colors.success + '20' : Colors.backgroundTertiary }]}>
                <RefreshCw size={20} color={globalDRIP ? Colors.success : Colors.textTertiary} />
              </View>
              <View>
                <Text style={styles.globalToggleTitle}>Enable for All Holdings</Text>
                <Text style={styles.globalToggleSubtext}>
                  {enabledCount}/{dripSettings.length} properties active
                </Text>
              </View>
            </View>
            <Switch
              value={globalDRIP}
              onValueChange={toggleGlobalDRIP}
              trackColor={{ false: Colors.backgroundTertiary, true: Colors.success + '60' }}
              thumbColor={globalDRIP ? Colors.success : Colors.textTertiary}
            />
          </Animated.View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <DollarSign size={16} color={Colors.primary} />
              <Text style={styles.statValue}>{formatCurrencyWithDecimals(totalReinvestValue)}</Text>
              <Text style={styles.statLabel}>Next Reinvest</Text>
            </View>
            <View style={styles.statCard}>
              <TrendingUp size={16} color={Colors.success} />
              <Text style={styles.statValue}>{estimatedNewShares.toFixed(1)}</Text>
              <Text style={styles.statLabel}>New Shares</Text>
            </View>
            <View style={styles.statCard}>
              <Calendar size={16} color={Colors.info} />
              <Text style={styles.statValue}>Mar 1</Text>
              <Text style={styles.statLabel}>Next Payout</Text>
            </View>
          </View>

          <View style={styles.infoBox}>
            <Info size={16} color={Colors.info} />
            <Text style={styles.infoText}>
              When DRIP is enabled, dividends are automatically used to purchase additional shares at market price. No trading fees on reinvested dividends.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Holdings</Text>

          {dripSettings.map((setting, index) => (
            <Animated.View
              key={setting.propertyId}
              style={[
                styles.holdingCard,
                {
                  opacity: slideAnims[index] || 1,
                  transform: [{
                    translateY: (slideAnims[index] || new Animated.Value(1)).interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0]})}]},
              ]}
            >
              <View style={styles.holdingHeader}>
                <View style={styles.holdingLeft}>
                  <View style={styles.holdingIconCircle}>
                    <Building2 size={18} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.holdingName} numberOfLines={1}>{setting.propertyName}</Text>
                    <Text style={styles.holdingShares}>{setting.sharesOwned} shares</Text>
                  </View>
                </View>
                <Switch
                  value={setting.enabled}
                  onValueChange={(value) => togglePropertyDRIP(setting.propertyId, value)}
                  trackColor={{ false: Colors.backgroundTertiary, true: Colors.success + '60' }}
                  thumbColor={setting.enabled ? Colors.success : Colors.textTertiary}
                />
              </View>

              <View style={styles.holdingDetails}>
                <View style={styles.holdingDetail}>
                  <Text style={styles.holdingDetailLabel}>Est. Dividend</Text>
                  <Text style={styles.holdingDetailValue}>{formatCurrencyWithDecimals(setting.estimatedDividend)}</Text>
                </View>
                <View style={styles.holdingDetail}>
                  <Text style={styles.holdingDetailLabel}>Price/Share</Text>
                  <Text style={styles.holdingDetailValue}>{formatCurrencyWithDecimals(setting.pricePerShare)}</Text>
                </View>
                <View style={styles.holdingDetail}>
                  <Text style={styles.holdingDetailLabel}>New Shares</Text>
                  <Text style={[styles.holdingDetailValue, { color: Colors.success }]}>
                    +{(setting.estimatedDividend / setting.pricePerShare).toFixed(2)}
                  </Text>
                </View>
              </View>

              {setting.enabled && (
                <View style={styles.enabledBadge}>
                  <Check size={12} color={Colors.success} />
                  <Text style={styles.enabledBadgeText}>
                    Auto-reinvesting {formatCurrencyWithDecimals(setting.estimatedDividend)} on next payout
                  </Text>
                </View>
              )}
            </Animated.View>
          ))}

          <View style={styles.projectionCard}>
            <Text style={styles.projectionTitle}>12-Month Projection</Text>
            <Text style={styles.projectionSubtext}>
              If DRIP is enabled for all holdings
            </Text>
            <View style={styles.projectionRow}>
              <View style={styles.projectionItem}>
                <Text style={styles.projectionLabel}>Total Dividends</Text>
                <Text style={styles.projectionValue}>
                  {formatCurrencyWithDecimals(totalEstimatedDividend * 4)}
                </Text>
              </View>
              <View style={styles.projectionItem}>
                <Text style={styles.projectionLabel}>New Shares</Text>
                <Text style={styles.projectionValue}>
                  {(estimatedNewShares * 4).toFixed(0)}
                </Text>
              </View>
              <View style={styles.projectionItem}>
                <Text style={styles.projectionLabel}>Compound Value</Text>
                <Text style={[styles.projectionValue, { color: Colors.success }]}>
                  +{formatCurrencyWithDecimals(totalEstimatedDividend * 4 * 1.08)}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  dripIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtext: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  globalToggle: { gap: 4 },
  globalToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  globalIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  globalToggleTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  globalToggleSubtext: { color: Colors.textSecondary, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  infoBox: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14 },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  holdingCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  holdingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  holdingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  holdingIconCircle: { gap: 4 },
  holdingName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  holdingShares: { gap: 4 },
  holdingDetails: { gap: 4 },
  holdingDetail: { gap: 4 },
  holdingDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  holdingDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  enabledBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  enabledBadgeText: { fontSize: 11, fontWeight: '700' as const },
  projectionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  projectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  projectionSubtext: { color: Colors.textSecondary, fontSize: 13 },
  projectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  projectionLabel: { color: Colors.textSecondary, fontSize: 13 },
  projectionValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  scrollView: { backgroundColor: Colors.background }});
