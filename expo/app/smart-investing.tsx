import React, { useState, useRef, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Switch,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import {
  ArrowLeft,
  Brain,
  Zap,
  Bell,
  Activity,
  RefreshCw,
  Receipt,
  Users,
  Target,
  Sparkles,
  TrendingUp,
  Shield,
  Clock} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { smartFeatures, SmartFeature, globalPresence } from '@/mocks/competitive-stats';
import { getResponsiveSize, isExtraSmallScreen } from '@/lib/responsive';

const iconMap: Record<string, any> = {
  Brain, Zap, Bell, Activity, RefreshCw, Receipt, Users, Target};

function SmartFeatureCard({ feature, index }: { feature: SmartFeature; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [enabled, setEnabled] = useState(feature.status === 'active');
  const IconComponent = iconMap[feature.icon] || Brain;
  const isComingSoon = feature.status === 'coming_soon';

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 100,
      useNativeDriver: true}).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.featureCard,
        isComingSoon && styles.featureCardComingSoon,
        { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
      ]}
    >
      <View style={styles.featureTop}>
        <View style={[styles.featureIconContainer, isComingSoon && { opacity: 0.5 }]}>
          <IconComponent size={22} color={isComingSoon ? Colors.textTertiary : Colors.primary} />
        </View>
        <View style={styles.featureMeta}>
          <View style={styles.featureTitleRow}>
            <Text style={[styles.featureTitle, isComingSoon && { color: Colors.textTertiary }]}>
              {feature.title}
            </Text>
            {isComingSoon ? (
              <View style={styles.comingSoonBadge}>
                <Clock size={10} color={Colors.warning} />
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            ) : (
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: Colors.backgroundTertiary, true: Colors.primary + '50' }}
                thumbColor={enabled ? Colors.primary : Colors.textTertiary}
              />
            )}
          </View>
          <Text style={[styles.featureDescription, isComingSoon && { color: Colors.textTertiary }]}>
            {feature.description}
          </Text>
        </View>
      </View>
      <View style={[styles.benefitBadge, isComingSoon && { opacity: 0.5 }]}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.benefitText}>{feature.benefit}</Text>
      </View>
    </Animated.View>
  );
}

function AIInsightCard() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.insightCard, { transform: [{ scale: pulseAnim }] }]}>
      <View style={styles.insightHeader}>
        <View style={styles.insightIconContainer}>
          <Brain size={24} color={Colors.primary} />
        </View>
        <View style={styles.insightLiveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>AI Insight — Live</Text>
        </View>
      </View>
      <Text style={styles.insightTitle}>Portfolio Recommendation</Text>
      <Text style={styles.insightBody}>
        Based on current market conditions and your risk profile, I recommend increasing your allocation to Dubai Marina Residences by 15%. Rising tourism and Expo 2025 aftermath are driving rental demand up 22% YoY.
      </Text>
      <View style={styles.insightMetrics}>
        <View style={styles.insightMetric}>
          <TrendingUp size={14} color={Colors.success} />
          <Text style={styles.insightMetricText}>Expected +3.2% yield boost</Text>
        </View>
        <View style={styles.insightMetric}>
          <Shield size={14} color="#4ECDC4" />
          <Text style={styles.insightMetricText}>Risk level: Medium-Low</Text>
        </View>
      </View>
      <View style={styles.insightActions}>
        <TouchableOpacity style={styles.insightActionPrimary} activeOpacity={0.8}>
          <Text style={styles.insightActionPrimaryText}>Apply Suggestion</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.insightActionSecondary} activeOpacity={0.7}>
          <Text style={styles.insightActionSecondaryText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function GlobalReachSection() {
  return (
    <View style={styles.globalSection}>
      <Text style={styles.globalTitle}>Global Reach</Text>
      <Text style={styles.globalSubtitle}>Properties across 9 countries, 4 continents</Text>
      <View style={styles.globalGrid}>
        {globalPresence.map((country, i) => (
          <View key={i} style={styles.globalCard}>
            <Text style={styles.globalCountry}>{country.country}</Text>
            <Text style={styles.globalValue}>{country.totalValue}</Text>
            <Text style={styles.globalProperties}>{country.properties} properties</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function SmartInvestingScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const screenSize = getResponsiveSize(width);
  const isXs = isExtraSmallScreen(screenSize);

  const activeFeatures = smartFeatures.filter(f => f.status === 'active');
  const comingSoonFeatures = smartFeatures.filter(f => f.status === 'coming_soon');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Smart Investing</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.heroSection}>
            <View style={styles.heroGlow} />
            <Brain size={36} color={Colors.primary} style={{ marginBottom: 16 }} />
            <Text style={styles.heroTitle}>AI-Powered{'\n'}Wealth Building</Text>
            <Text style={styles.heroSubtitle}>
              Our proprietary AI analyzes 200+ market signals, property metrics, and economic indicators to maximize your returns while minimizing risk.
            </Text>
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>+3.2%</Text>
                <Text style={styles.heroStatLabel}>Better Returns</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>48hr</Text>
                <Text style={styles.heroStatLabel}>Early Warnings</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>87</Text>
                <Text style={styles.heroStatLabel}>Risk Factors</Text>
              </View>
            </View>
          </View>

          <AIInsightCard />

          <Text style={styles.sectionLabel}>Active Features</Text>
          {activeFeatures.map((feature, index) => (
            <SmartFeatureCard key={feature.id} feature={feature} index={index} />
          ))}

          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Coming Soon</Text>
          {comingSoonFeatures.map((feature, index) => (
            <SmartFeatureCard key={feature.id} feature={feature} index={index + activeFeatures.length} />
          ))}

          <GlobalReachSection />

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.push('/(tabs)/market' as any)}
            activeOpacity={0.8}
          >
            <Sparkles size={20} color={Colors.background} />
            <Text style={styles.ctaText}>Start Smart Investing</Text>
          </TouchableOpacity>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12},
  backButton: {
    padding: 8},
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  scrollContent: {
    padding: 20,
    paddingBottom: 140},
  heroSection: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 16},
  heroGlow: {
    position: 'absolute',
    top: 20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary + '12'},
  heroTitle: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: '800' as const,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 32},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20},
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16},
  heroStat: {
    alignItems: 'center',
    gap: 2},
  heroStatValue: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '800' as const},
  heroStatLabel: {
    color: Colors.textTertiary,
    fontSize: 11},
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.surfaceBorder},
  insightCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10},
  insightIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  insightLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success},
  liveText: {
    color: Colors.textSecondary,
    fontSize: 13},
  insightTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 8},
  insightBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12},
  insightMetrics: {
    gap: 8,
    marginBottom: 12},
  insightMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  insightMetricText: {
    color: Colors.textSecondary,
    fontSize: 13},
  insightActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4},
  insightActionPrimary: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  insightActionPrimaryText: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: '700' as const},
  insightActionSecondary: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundTertiary},
  insightActionSecondaryText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  sectionLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 12},
  featureCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  featureCardComingSoon: {
    opacity: 0.6},
  featureTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10},
  featureIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0},
  featureMeta: {
    flex: 1,
    flexDirection: 'column',
    gap: 4},
  featureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  featureTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    flex: 1},
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.warning + '20',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3},
  comingSoonText: {
    color: Colors.warning,
    fontSize: 11,
    fontWeight: '600' as const},
  featureDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  benefitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '12',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start'},
  benefitText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const},
  globalSection: {
    marginBottom: 20},
  globalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 4},
  globalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 12},
  globalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  globalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: '45%',
    flex: 1},
  globalCountry: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 4},
  globalValue: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 2},
  globalProperties: {
    color: Colors.textTertiary,
    fontSize: 11},
  ctaButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8},
  ctaText: {
    color: Colors.background,
    fontSize: 16,
    fontWeight: '700' as const},
  bottomPadding: {
    height: 40}});
