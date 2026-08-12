import React, { useState, useRef, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import {
  Shield,
  Scale,
  Lock,
  FileCheck,
  Search,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Fingerprint,
  Database,
  CheckCircle2,
  ArrowLeft,
  PiggyBank,
  FileText,
  Calculator,
  ArrowRightLeft,
  Banknote,
  Eye,
  Building2,
  Globe,
  Award} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { trustFeatures, ownerProtections, TrustFeature, OwnerProtection } from '@/mocks/competitive-stats';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';

const iconMap: Record<string, any> = {
  Shield, Scale, Lock, FileCheck, Search, ShieldCheck, Fingerprint, Database,
  PiggyBank, FileText, Calculator, ArrowRightLeft, Banknote, Eye};

type CategoryFilter = 'all' | 'security' | 'legal' | 'financial' | 'insurance';

function TrustFeatureCard({ feature, index }: { feature: TrustFeature; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const IconComponent = iconMap[feature.icon] || Shield;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 80,
      useNativeDriver: true}).start();
  }, []);

  const categoryColors: Record<string, string> = {
    security: '#FF6B6B',
    legal: '#4ECDC4',
    financial: '#FFD700',
    insurance: '#45B7D1'};

  return (
    <Animated.View style={[styles.trustCard, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
      <View style={styles.trustCardHeader}>
        <View style={[styles.trustIconContainer, { backgroundColor: (categoryColors[feature.category] || Colors.primary) + '18' }]}>
          <IconComponent size={22} color={categoryColors[feature.category] || Colors.primary} />
        </View>
        <View style={styles.trustCardMeta}>
          <Text style={styles.trustCardTitle}>{feature.title}</Text>
          <View style={[styles.categoryBadge, { backgroundColor: (categoryColors[feature.category] || Colors.primary) + '20' }]}>
            <Text style={[styles.categoryBadgeText, { color: categoryColors[feature.category] || Colors.primary }]}>
              {feature.category.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.trustCardDescription}>{feature.description}</Text>
      <View style={styles.verifiedBadge}>
        <CheckCircle2 size={14} color={Colors.success} />
        <Text style={styles.verifiedText}>Verified & Active</Text>
      </View>
    </Animated.View>
  );
}

function OwnerProtectionCard({ protection, index }: { protection: OwnerProtection; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const expandAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const IconComponent = iconMap[protection.icon] || Shield;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 80,
      useNativeDriver: true}).start();
  }, []);

  const toggleExpand = () => {
    setExpanded(!expanded);
    Animated.spring(expandAnim, {
      toValue: expanded ? 0 : 1,
      useNativeDriver: false,
      friction: 8}).start();
  };

  return (
    <Animated.View style={[styles.protectionCard, { opacity: fadeAnim }]}>
      <TouchableOpacity onPress={toggleExpand} activeOpacity={0.7} style={styles.protectionHeader}>
        <View style={styles.protectionLeft}>
          <View style={styles.protectionIconContainer}>
            <IconComponent size={22} color={Colors.primary} />
          </View>
          <View style={styles.protectionMeta}>
            <Text style={styles.protectionTitle}>{protection.title}</Text>
            <Text style={styles.protectionDescription} numberOfLines={expanded ? undefined : 2}>{protection.description}</Text>
          </View>
        </View>
        {expanded ? (
          <ChevronUp size={20} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={20} color={Colors.textSecondary} />
        )}
      </TouchableOpacity>
      {expanded && (
        <View style={styles.protectionDetails}>
          {protection.details.map((detail, i) => (
            <View key={i} style={styles.detailRow}>
              <CheckCircle2 size={16} color={Colors.success} />
              <Text style={styles.detailText}>{detail}</Text>
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

export default function TrustCenterScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [activeSection, setActiveSection] = useState<'trust' | 'owner'>('trust');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const screenSize = getResponsiveSize(width);
  const isXs = isExtraSmallScreen(screenSize);

  const filteredFeatures = categoryFilter === 'all'
    ? trustFeatures
    : trustFeatures.filter(f => f.category === categoryFilter);

  const categories: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'security', label: 'Security' },
    { key: 'legal', label: 'Legal' },
    { key: 'financial', label: 'Financial' },
    { key: 'insurance', label: 'Insurance' },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trust & Security</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroSection}>
            <View style={styles.heroRow}>
              <View style={styles.heroIconOuter}>
                <Shield size={24} color={Colors.primary} />
              </View>
              <View style={styles.heroTextBlock}>
                <Text style={styles.heroTitle}>Your Investment is Protected</Text>
                <Text style={styles.heroSubtitle}>
                  Bank-grade security, legal compliance, and insurance protect every dollar you invest
                </Text>
              </View>
            </View>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Building2 size={14} color={Colors.primary} />
                <Text style={styles.heroStatValue}>284</Text>
                <Text style={styles.heroStatLabel}>Properties</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Globe size={14} color={Colors.primary} />
                <Text style={styles.heroStatValue}>9</Text>
                <Text style={styles.heroStatLabel}>Countries</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Award size={14} color={Colors.primary} />
                <Text style={styles.heroStatValue}>0</Text>
                <Text style={styles.heroStatLabel}>Incidents</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionTabs}>
            <TouchableOpacity
              style={[styles.sectionTab, activeSection === 'trust' && styles.sectionTabActive]}
              onPress={() => setActiveSection('trust')}
            >
              <Shield size={16} color={activeSection === 'trust' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.sectionTabText, activeSection === 'trust' && styles.sectionTabTextActive]}>
                Investor Protection
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sectionTab, activeSection === 'owner' && styles.sectionTabActive]}
              onPress={() => setActiveSection('owner')}
            >
              <FileText size={16} color={activeSection === 'owner' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.sectionTabText, activeSection === 'owner' && styles.sectionTabTextActive]}>
                Owner Guarantees
              </Text>
            </TouchableOpacity>
          </View>
          {activeSection === 'trust' ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryFilters}>
                {categories.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.categoryPill, categoryFilter === cat.key && styles.categoryPillActive]}
                    onPress={() => setCategoryFilter(cat.key)}
                  >
                    <Text style={[styles.categoryPillText, categoryFilter === cat.key && styles.categoryPillTextActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {filteredFeatures.map((feature, index) => (
                <TrustFeatureCard key={feature.id} feature={feature} index={index} />
              ))}
            </>
          ) : (
            <>
              <View style={styles.ownerHero}>
                <Text style={styles.ownerHeroTitle}>Property Owner Bill of Rights</Text>
                <Text style={styles.ownerHeroSubtitle}>
                  We built IVXHOLDINGS to empower property owners, not take from them. Every protection below is legally binding.
                </Text>
              </View>
              {ownerProtections.map((protection, index) => (
                <OwnerProtectionCard key={protection.id} protection={protection} index={index} />
              ))}
            </>
          )}
          <View style={styles.bottomPadding} />
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
  heroSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, width: '100%' as const },
  heroIconOuter: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  heroTextBlock: { flex: 1, gap: 4 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, marginBottom: 4 },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroStat: { alignItems: 'center', gap: 2 },
  heroStatValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  heroStatLabel: { color: Colors.textTertiary, fontSize: 11 },
  heroStatDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  sectionTabs: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  sectionTab: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder, flexShrink: 1 },
  sectionTabActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  sectionTabText: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  sectionTabTextActive: { color: '#000' },
  scrollContent: { padding: 20, paddingBottom: 140 },
  categoryFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  categoryPillActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  categoryPillText: { color: Colors.textSecondary, fontSize: 13 },
  categoryPillTextActive: { color: '#000' },
  trustCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  trustCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  trustIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  trustCardMeta: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  trustCardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flexShrink: 1 },
  categoryBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  categoryBadgeText: { fontSize: 11, fontWeight: '700' as const },
  trustCardDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8 },
  verifiedText: { color: Colors.textSecondary, fontSize: 13 },
  ownerHero: { alignItems: 'center', marginBottom: 16, gap: 6, paddingHorizontal: 4 },
  ownerHeroTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, textAlign: 'center' as const },
  ownerHeroSubtitle: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' as const, textAlign: 'center' as const, lineHeight: 18 },
  protectionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  protectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  protectionLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  protectionIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  protectionMeta: { flex: 1, gap: 4 },
  protectionTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  protectionDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  protectionDetails: { gap: 8, marginTop: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailText: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
