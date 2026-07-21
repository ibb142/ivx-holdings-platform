import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Shield,
  Award,
    Gem,
  ArrowLeft,
  Check,
  Lock,
  TrendingDown,
  Zap,
  Clock,
  Gift,
  Users,
  Headphones,
  Building2,
  BarChart3,
  Phone,
  Calendar,
  ChevronRight,
  Sparkles,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import Colors from '@/constants/colors';
import { VIP_TIERS, getUserVIPProgress, getTierByLevel, VIPTier, VIPTierLevel } from '@/mocks/vip-tiers';
import { useCurrentUser } from '@/lib/data-hooks';
import { formatNumber } from '@/lib/formatters';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TIER_ICONS: Record<string, React.ComponentType<any>> = {
  shield: Shield,
  award: Award,
  crown:   gem: Gem,
};

const TIER_GRADIENTS: Record<VIPTierLevel, [string, string]> = {
  bronze: ['#8B5E3C', '#CD7F32'],
  silver: ['#7A7E82', '#C0C0C0'],
  gold: ['#B8860B', '#FFD700'],
  platinum: ['#8A8D90', '#E5E4E2'],
};

const TIER_GLOW: Record<VIPTierLevel, string> = {
  bronze: '#CD7F3220',
  silver: '#C0C0C020',
  gold: '#FFD70025',
  platinum: '#E5E4E220',
};

export default function VIPTiersScreen() {
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const heroScale = useRef(new Animated.Value(0.95)).current;
  const [activeTierIndex, setActiveTierIndex] = useState<number>(0);
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  const { user: currentUserData } = useCurrentUser();
  const progress = useMemo(() => getUserVIPProgress(currentUserData?.totalInvested ?? 0), [currentUserData?.totalInvested]);
  const currentTier = useMemo(() => getTierByLevel(progress.currentTier), [progress.currentTier]);

  const tierOrder: VIPTierLevel[] = ['bronze', 'silver', 'gold', 'platinum'];
  const currentTierIndex = tierOrder.indexOf(progress.currentTier);

  useEffect(() => {
    setActiveTierIndex(currentTierIndex);
  }, [currentTierIndex]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideUp, {
        toValue: 0,
        friction: 12,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.spring(heroScale, {
        toValue: 1,
        friction: 10,
        tension: 35,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(progressAnim, {
      toValue: progress.progressPercent / 100,
      duration: 1400,
      useNativeDriver: false,
    }).start();

    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      })
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth, screenWidth],
  });

  const renderTierIcon = useCallback((tier: VIPTier, size: number, color: string) => {
    const IconComponent = TIER_ICONS[tier.icon] || Shield;
    return <IconComponent size={size} color={color} />;
  }, []);

  const nextTierName = currentTierIndex < 3
    ? tierOrder[currentTierIndex + 1]?.charAt(0).toUpperCase() + tierOrder[currentTierIndex + 1]?.slice(1)
    : null;

  const amountToNext = progress.nextTierThreshold - progress.totalInvested;

  const renderPerkIcon = useCallback((perk: string) => {
    const lowerPerk = perk.toLowerCase();
    if (lowerPerk.includes('trading') || lowerPerk.includes('fee')) return TrendingDown;
    if (lowerPerk.includes('apy') || lowerPerk.includes('earn') || lowerPerk.includes('boost')) return Zap;
    if (lowerPerk.includes('early') || lowerPerk.includes('access')) return Clock;
    if (lowerPerk.includes('referral') || lowerPerk.includes('bonus')) return Gift;
    if (lowerPerk.includes('community') || lowerPerk.includes('event') || lowerPerk.includes('network')) return Users;
    if (lowerPerk.includes('support') || lowerPerk.includes('manager')) return Headphones;
    if (lowerPerk.includes('property') || lowerPerk.includes('deal') || lowerPerk.includes('exclusive') || lowerPerk.includes('pick')) return Building2;
    if (lowerPerk.includes('portfolio') || lowerPerk.includes('insight') || lowerPerk.includes('market')) return BarChart3;
    if (lowerPerk.includes('strategy') || lowerPerk.includes('call') || lowerPerk.includes('1-on-1')) return Phone;
    if (lowerPerk.includes('monthly')) return Calendar;
    return Check;
  }, []);

  const activeTier = VIP_TIERS[activeTierIndex];
  const isActiveTierUnlocked = activeTierIndex <= currentTierIndex;
  const isActiveTierCurrent = activeTierIndex === currentTierIndex;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#0A0A0A', '#0D0D10', '#0A0A0A']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
            <ArrowLeft size={18} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Membership</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <Animated.View style={[
            styles.heroCard,
            {
              opacity: fadeIn,
              transform: [{ translateY: slideUp }, { scale: heroScale }],
            },
          ]}>
            <LinearGradient
              colors={[TIER_GLOW[progress.currentTier], '#0A0A0A00']}
              style={styles.heroGlow}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
            <View style={styles.heroInner}>
              <View style={styles.heroCardTop}>
                <View style={styles.heroBadgeRow}>
                  <LinearGradient
                    colors={TIER_GRADIENTS[progress.currentTier]}
                    style={styles.heroIconBg}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {renderTierIcon(currentTier, 20, '#000')}
                  </LinearGradient>
                  <View>
                    <Text style={styles.heroTierName}>{currentTier.name}</Text>
                    <Text style={styles.heroMemberLabel}>Member since Jan 2024</Text>
                  </View>
                </View>
                <View style={[styles.pointsPill, { backgroundColor: currentTier.color + '14' }]}>
                  <Sparkles size={11} color={currentTier.color} />
                  <Text style={[styles.pointsPillText, { color: currentTier.color }]}>
                    {formatNumber(progress.pointsEarned)}
                  </Text>
                </View>
              </View>

              <View style={styles.heroAmountBlock}>
                <Text style={styles.heroAmountLabel}>Total Invested</Text>
                <Text style={styles.heroAmount}>${formatNumber(progress.totalInvested)}</Text>
              </View>

              {progress.currentTier !== 'platinum' ? (
                <View style={styles.heroProgressBlock}>
                  <View style={styles.heroProgressMeta}>
                    <Text style={styles.heroProgressText}>
                      <Text style={{ color: currentTier.color, fontWeight: '700' as const }}>${formatNumber(amountToNext)}</Text>
                      {' '}to {nextTierName}
                    </Text>
                    <Text style={[styles.heroProgressPct, { color: currentTier.color }]}>
                      {Math.round(progress.progressPercent)}%
                    </Text>
                  </View>
                  <View style={styles.heroProgressTrack}>
                    <Animated.View style={[styles.heroProgressFill, { width: progressWidth }]}>
                      <LinearGradient
                        colors={TIER_GRADIENTS[progress.currentTier]}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      />
                    </Animated.View>
                    <Animated.View
                      style={[styles.shimmer, { transform: [{ translateX: shimmerTranslate }] }]}
                    >
                      <LinearGradient
                        colors={['transparent', 'rgba(255,255,255,0.06)', 'transparent']}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      />
                    </Animated.View>
                  </View>
                </View>
              ) : (
                <View style={[styles.maxTierBanner, { backgroundColor: currentTier.color + '0D' }]}>
                  <Gem size={14} color={currentTier.color} />
                  <Text style={[styles.maxTierText, { color: currentTier.color }]}>
                    Highest tier unlocked
                  </Text>
                </View>
              )}

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatBox}>
                  <TrendingDown size={14} color="#00C48C" />
                  <Text style={styles.heroStatValue}>
                    {currentTier.tradingFeeDiscount > 0 ? `-${currentTier.tradingFeeDiscount}%` : '0%'}
                  </Text>
                  <Text style={styles.heroStatLabel}>Fees</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatBox}>
                  <Zap size={14} color="#FFD700" />
                  <Text style={styles.heroStatValue}>
                    {currentTier.earnApyBoost > 0 ? `+${currentTier.earnApyBoost}%` : 'Base'}
                  </Text>
                  <Text style={styles.heroStatLabel}>APY</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatBox}>
                  <Clock size={14} color="#4A90D9" />
                  <Text style={styles.heroStatValue}>
                    {currentTier.earlyAccessDays > 0 ? `${currentTier.earlyAccessDays}d` : '—'}
                  </Text>
                  <Text style={styles.heroStatLabel}>Early</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatBox}>
                  <Gift size={14} color="#FF8C00" />
                  <Text style={styles.heroStatValue}>${formatNumber(currentTier.referralBonus)}</Text>
                  <Text style={styles.heroStatLabel}>Refer</Text>
                </View>
              </View>
            </View>
          </Animated.View>

          <Animated.View style={[styles.tierNavSection, { opacity: fadeIn }]}>
            <Text style={styles.sectionTitle}>Explore Tiers</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tierTabsContainer}
            >
              {VIP_TIERS.map((tier, index) => {
                const isSelected = index === activeTierIndex;
                const isUnlocked = index <= currentTierIndex;
                return (
                  <TouchableOpacity
                    key={tier.id}
                    onPress={() => setActiveTierIndex(index)}
                    activeOpacity={0.7}
                    style={[
                      styles.tierTab,
                      isSelected && {
                        borderColor: tier.color + '50',
                        backgroundColor: tier.color + '0A',
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={isSelected ? TIER_GRADIENTS[tier.level] : [Colors.surfaceBorder, Colors.surfaceBorder]}
                      style={styles.tierTabIcon}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      {renderTierIcon(tier, 13, isSelected ? '#000' : Colors.textTertiary)}
                    </LinearGradient>
                    <Text style={[
                      styles.tierTabName,
                      isSelected && { color: tier.color },
                    ]}>
                      {tier.name}
                    </Text>
                    {!isUnlocked && (
                      <Lock size={9} color={Colors.textTertiary} style={{ marginLeft: 2 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>

          <Animated.View style={[styles.tierDetailSection, { opacity: fadeIn }]}>
            <View style={styles.tierDetailCard}>
              <View style={styles.tierDetailHeader}>
                <LinearGradient
                  colors={TIER_GRADIENTS[activeTier.level]}
                  style={styles.tierDetailIconBg}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  {renderTierIcon(activeTier, 24, '#000')}
                </LinearGradient>
                <View style={styles.tierDetailMeta}>
                  <View style={styles.tierDetailNameRow}>
                    <Text style={[styles.tierDetailName, { color: activeTier.color }]}>
                      {activeTier.name}
                    </Text>
                    {isActiveTierCurrent && (
                      <View style={[styles.activeBadge, { backgroundColor: activeTier.color }]}>
                        <Text style={styles.activeBadgeText}>Your Tier</Text>
                      </View>
                    )}
                    {!isActiveTierUnlocked && (
                      <View style={styles.lockedBadge}>
                        <Lock size={10} color={Colors.textTertiary} />
                        <Text style={styles.lockedBadgeText}>Locked</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.tierDetailRange}>
                    {activeTier.maxInvestment
                      ? `$${formatNumber(activeTier.minInvestment)} — $${formatNumber(activeTier.maxInvestment)}`
                      : `$${formatNumber(activeTier.minInvestment)}+`}
                  </Text>
                </View>
              </View>

              <View style={styles.tierMetricsGrid}>
                <View style={[styles.metricCard, { borderColor: activeTier.color + '18' }]}>
                  <TrendingDown size={16} color="#00C48C" />
                  <Text style={styles.metricValue}>
                    {activeTier.tradingFeeDiscount > 0 ? `${activeTier.tradingFeeDiscount}%` : '0%'}
                  </Text>
                  <Text style={styles.metricLabel}>Fee Discount</Text>
                </View>
                <View style={[styles.metricCard, { borderColor: activeTier.color + '18' }]}>
                  <Zap size={16} color="#FFD700" />
                  <Text style={styles.metricValue}>
                    {activeTier.earnApyBoost > 0 ? `+${activeTier.earnApyBoost}%` : 'Base'}
                  </Text>
                  <Text style={styles.metricLabel}>APY Boost</Text>
                </View>
                <View style={[styles.metricCard, { borderColor: activeTier.color + '18' }]}>
                  <Clock size={16} color="#4A90D9" />
                  <Text style={styles.metricValue}>
                    {activeTier.earlyAccessDays > 0 ? `${activeTier.earlyAccessDays} days` : 'None'}
                  </Text>
                  <Text style={styles.metricLabel}>Early Access</Text>
                </View>
                <View style={[styles.metricCard, { borderColor: activeTier.color + '18' }]}>
                  <Gift size={16} color="#FF8C00" />
                  <Text style={styles.metricValue}>${formatNumber(activeTier.referralBonus)}</Text>
                  <Text style={styles.metricLabel}>Referral</Text>
                </View>
              </View>

              <View style={styles.perksBlock}>
                <Text style={styles.perksTitle}>Benefits</Text>
                {activeTier.perks.map((perk, pi) => {
                  const PerkIcon = renderPerkIcon(perk);
                  return (
                    <View key={pi} style={styles.perkRow}>
                      <View style={[
                        styles.perkIconCircle,
                        {
                          backgroundColor: isActiveTierUnlocked
                            ? activeTier.color + '12'
                            : Colors.surfaceBorder + '60',
                        },
                      ]}>
                        <PerkIcon
                          size={13}
                          color={isActiveTierUnlocked ? activeTier.color : Colors.textTertiary}
                        />
                      </View>
                      <Text style={[
                        styles.perkText,
                        !isActiveTierUnlocked && { color: Colors.textTertiary },
                      ]}>
                        {perk}
                      </Text>
                      {isActiveTierUnlocked && (
                        <Check size={14} color={activeTier.color} />
                      )}
                    </View>
                  );
                })}
              </View>

              {!isActiveTierUnlocked && (
                <View style={styles.unlockBlock}>
                  <LinearGradient
                    colors={[activeTier.color + '10', activeTier.color + '05']}
                    style={styles.unlockGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.unlockTitle}>
                      Invest ${formatNumber(activeTier.minInvestment - progress.totalInvested)} more
                    </Text>
                    <Text style={styles.unlockSubtitle}>to unlock {activeTier.name} tier</Text>
                    <View style={styles.unlockProgressTrack}>
                      <View style={[
                        styles.unlockProgressFill,
                        {
                          width: `${Math.min((progress.totalInvested / activeTier.minInvestment) * 100, 100)}%`,
                          backgroundColor: activeTier.color,
                        },
                      ]} />
                    </View>
                    <View style={styles.unlockRange}>
                      <Text style={styles.unlockRangeText}>
                        ${formatNumber(progress.totalInvested)}
                      </Text>
                      <Text style={styles.unlockRangeText}>
                        ${formatNumber(activeTier.minInvestment)}
                      </Text>
                    </View>
                  </LinearGradient>
                </View>
              )}
            </View>
          </Animated.View>

          <Animated.View style={[styles.journeySection, { opacity: fadeIn }]}>
            <Text style={styles.sectionTitle}>Your Journey</Text>
            <View style={styles.journeyTrack}>
              {tierOrder.map((level, i) => {
                const tier = getTierByLevel(level);
                const isReached = i <= currentTierIndex;
                const isCurrent = i === currentTierIndex;
                return (
                  <TouchableOpacity
                    key={level}
                    activeOpacity={0.7}
                    onPress={() => setActiveTierIndex(i)}
                    style={styles.journeyStep}
                  >
                    {i > 0 && (
                      <View style={[
                        styles.journeyLine,
                        isReached && { backgroundColor: tier.color + '40' },
                      ]} />
                    )}
                    <View style={[
                      styles.journeyDot,
                      isReached && {
                        backgroundColor: tier.color,
                        shadowColor: tier.color,
                        shadowOpacity: 0.4,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 0 },
                        elevation: 4,
                      },
                      isCurrent && {
                        borderWidth: 3,
                        borderColor: tier.color + '40',
                      },
                    ]}>
                      {isReached ? (
                        renderTierIcon(tier, 12, '#000')
                      ) : (
                        <Lock size={9} color={Colors.textTertiary} />
                      )}
                    </View>
                    <Text style={[
                      styles.journeyName,
                      isReached && { color: Colors.text },
                      isCurrent && { color: tier.color, fontWeight: '700' as const },
                    ]}>
                      {tier.name}
                    </Text>
                    <Text style={styles.journeyAmount}>
                      ${formatNumber(tier.minInvestment)}+
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          <View style={styles.ctaSection}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push('/market' as any)}
              style={styles.ctaButton}
            >
              <LinearGradient
                colors={TIER_GRADIENTS[progress.currentTier]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              />
              <Text style={styles.ctaText}>Invest Now</Text>
              <ChevronRight size={18} color="#000" />
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 140,
  },

  heroCard: {
    marginHorizontal: 16,
    marginBottom: 28,
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    left: -20,
    right: -20,
    height: 100,
  },
  heroInner: {
    backgroundColor: '#111114',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1E1E22',
    overflow: 'hidden',
  },
  heroCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    paddingBottom: 0,
    gap: 8,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIconBg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTierName: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  heroMemberLabel: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500' as const,
  },
  pointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pointsPillText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },

  heroAmountBlock: {
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  heroAmountLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  heroAmount: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
    letterSpacing: -1,
  },

  heroProgressBlock: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  heroProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  heroProgressText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500' as const,
  },
  heroProgressPct: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  heroProgressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#1E1E22',
    overflow: 'hidden',
  },
  heroProgressFill: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
  },

  maxTierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  maxTierText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },

  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 20,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1E',
  },
  heroStatBox: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  heroStatValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  heroStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
  },
  heroStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#1E1E22',
  },

  tierNavSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  tierTabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tierTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E1E22',
    backgroundColor: '#111114',
  },
  tierTabIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierTabName: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
  },

  tierDetailSection: {
    paddingHorizontal: 16,
    marginBottom: 28,
  },
  tierDetailCard: {
    backgroundColor: '#111114',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1E1E22',
    overflow: 'hidden',
  },
  tierDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    paddingBottom: 16,
  },
  tierDetailIconBg: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierDetailMeta: {
    flex: 1,
  },
  tierDetailNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  tierDetailName: {
    fontSize: 20,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.surfaceBorder + '80',
  },
  lockedBadgeText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  tierDetailRange: {
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '500' as const,
    marginTop: 3,
  },

  tierMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 4,
  },
  metricCard: {
    width: (SCREEN_WIDTH - 72) / 2,
    backgroundColor: '#0D0D10',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1A1A1E',
    gap: 6,
  },
  metricValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '500' as const,
    flexShrink: 1,
  },

  perksBlock: {
    padding: 20,
    paddingTop: 16,
  },
  perksTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 14,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  perkIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: {
    color: Colors.textSecondary,
    fontSize: 14,
    flex: 1,
    fontWeight: '400' as const,
    lineHeight: 20,
  },

  unlockBlock: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  unlockGradient: {
    borderRadius: 16,
    padding: 18,
  },
  unlockTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 2,
  },
  unlockSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '500' as const,
    marginBottom: 14,
  },
  unlockProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1E1E22',
    overflow: 'hidden',
  },
  unlockProgressFill: {
    height: 4,
    borderRadius: 2,
  },
  unlockRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  unlockRangeText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '500' as const,
  },

  journeySection: {
    marginBottom: 28,
  },
  journeyTrack: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    backgroundColor: '#111114',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E1E22',
  },
  journeyStep: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  journeyLine: {
    position: 'absolute',
    left: 0,
    right: '50%',
    top: 15,
    height: 2,
    backgroundColor: '#1E1E22',
  },
  journeyDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1E22',
    borderColor: 'transparent',
    borderWidth: 0,
    zIndex: 1,
  },
  journeyName: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 8,
  },
  journeyAmount: {
    color: Colors.textTertiary,
    fontSize: 9,
    marginTop: 2,
    fontWeight: '500' as const,
  },

  ctaSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  ctaButton: {
    height: 52,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ctaText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  scrollView: {
    backgroundColor: '#0A0A0A',
  },
});
