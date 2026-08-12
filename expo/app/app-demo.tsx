import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ChevronRight} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  IntroMockup,
  OpportunityMockup,
  PlatformMockup,
  OnboardingMockup,
  MarketplaceMockup,
  TradingMockup,
  PortfolioMockup,
  WalletMockup,
  TokenomicsMockup,
  AIMockup,
  AdminMockup,
  SecurityMockup,
  GrowthMockup,
  MetricsMockup,
  ClosingMockup} from '@/components/ScreenMockups';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SLIDE_DURATION = 5000;

interface DemoSlide {
  id: string;
  title: string;
  subtitle: string;
  highlights: string[];
  accentColor: string;
  Mockup: React.FC;
}

const DEMO_SLIDES: DemoSlide[] = [
  {
    id: 'intro',
    title: 'Welcome to IVX HOLDINGS',
    subtitle: 'Premium real estate investment platform accessible to everyone. Start with just $100.',
    highlights: ['Fractional ownership', 'SEC compliant', 'Global properties'],
    accentColor: '#FFD700',
    Mockup: IntroMockup},
  {
    id: 'opportunity',
    title: 'Market Opportunity',
    subtitle: 'The $326 trillion real estate market — now accessible through fractional investing.',
    highlights: ['$326T global market', '90% millionaires via RE', '+8.2% annual growth'],
    accentColor: '#4A90D9',
    Mockup: OpportunityMockup},
  {
    id: 'platform',
    title: 'Platform Overview',
    subtitle: '340+ features across marketplace, analytics, wallet, AI, security, and admin.',
    highlights: ['Cross-platform', 'AI-powered', '340+ features'],
    accentColor: '#00C48C',
    Mockup: PlatformMockup},
  {
    id: 'onboarding',
    title: 'Secure Onboarding',
    subtitle: 'Multi-step KYC verification with AI-powered document scanning and biometric auth.',
    highlights: ['AI document scan', 'Biometric auth', '1-2 day approval'],
    accentColor: '#9B59B6',
    Mockup: OnboardingMockup},
  {
    id: 'marketplace',
    title: 'Property Marketplace',
    subtitle: 'Browse curated properties worldwide. Filter, compare, and invest instantly.',
    highlights: ['Global listings', 'Smart filters', 'Instant investing'],
    accentColor: '#FF6B6B',
    Mockup: MarketplaceMockup},
  {
    id: 'trading',
    title: 'Investment Engine',
    subtitle: 'Buy and sell shares with market or limit orders. Real-time pricing 24/7.',
    highlights: ['Market & limit orders', 'Real-time charts', 'DRIP reinvest'],
    accentColor: '#FFB800',
    Mockup: TradingMockup},
  {
    id: 'portfolio',
    title: 'Portfolio Dashboard',
    subtitle: 'Track holdings, performance, gains & losses, and transaction history.',
    highlights: ['Performance charts', 'P&L tracking', 'Activity log'],
    accentColor: '#4A90D9',
    Mockup: PortfolioMockup},
  {
    id: 'wallet',
    title: 'Digital Wallet',
    subtitle: 'Add funds via card, ACH, or wire. Withdraw anytime with bank-level security.',
    highlights: ['Multiple payment methods', 'Instant deposits', 'Secure withdrawals'],
    accentColor: '#2ECC71',
    Mockup: WalletMockup},
  {
    id: 'tokenomics',
    title: 'IVXHOLDINGS Token Economy',
    subtitle: 'Stake IVXHOLDINGS tokens for rewards, governance voting, and exclusive tier benefits.',
    highlights: ['12.5% APY staking', 'Governance votes', 'VIP tiers'],
    accentColor: '#F39C12',
    Mockup: TokenomicsMockup},
  {
    id: 'ai',
    title: 'AI Assistant',
    subtitle: '24/7 AI-powered support for portfolio analysis, recommendations, and guidance.',
    highlights: ['Portfolio analysis', 'Smart recommendations', 'Tax optimization'],
    accentColor: '#E91E63',
    Mockup: AIMockup},
  {
    id: 'admin',
    title: 'Admin Command Center',
    subtitle: 'Full management dashboard — users, properties, transactions, marketing & AI studio.',
    highlights: ['User management', 'Transaction control', 'AI content studio'],
    accentColor: '#FFD700',
    Mockup: AdminMockup},
  {
    id: 'security',
    title: 'Enterprise Security',
    subtitle: 'End-to-end encryption, 2FA, SEC compliance, GDPR ready, 24/7 threat monitoring.',
    highlights: ['E2E encryption', 'SEC & GDPR', '98/100 score'],
    accentColor: '#607D8B',
    Mockup: SecurityMockup},
  {
    id: 'growth',
    title: 'Growth Engine',
    subtitle: 'Referral program, influencer network, and tiered commission system.',
    highlights: ['$500/referral', 'Multi-tier rewards', 'Influencer program'],
    accentColor: '#00BCD4',
    Mockup: GrowthMockup},
  {
    id: 'metrics',
    title: 'Performance Analytics',
    subtitle: 'User growth, transaction volume, ROI metrics, and NPS tracking in real-time.',
    highlights: ['+32% user growth', '$4.2M volume', '9.8% avg return'],
    accentColor: '#FF5722',
    Mockup: MetricsMockup},
  {
    id: 'closing',
    title: 'Start Investing Today',
    subtitle: 'Join thousands already building wealth through real estate. Download free.',
    highlights: ['Free to download', 'Start from $100', 'iOS, Android & Web'],
    accentColor: '#FFD700',
    Mockup: ClosingMockup},
];

function ProgressSegments({
  total,
  current,
  progress,
  onPress,
  accentColor}: {
  total: number;
  current: number;
  progress: Animated.Value;
  onPress: (idx: number) => void;
  accentColor: string;
}) {
  return (
    <View style={styles.progressBar}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < current;
        const isActive = i === current;
        const fillWidth = isActive
          ? progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%']})
          : filled
          ? '100%'
          : '0%';

        return (
          <TouchableOpacity
            key={i}
            style={styles.progressSegment}
            onPress={() => onPress(i)}
            activeOpacity={0.7}
          >
            <View style={styles.progressSegmentBg}>
              <Animated.View
                style={[
                  styles.progressSegmentFill,
                  { width: fillWidth, backgroundColor: accentColor },
                ]}
              />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function AppDemoScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFinished, setIsFinished] = useState(false);

  const slideProgress = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const mockupScale = useRef(new Animated.Value(0.85)).current;
  const mockupTranslateY = useRef(new Animated.Value(30)).current;
  const titleTranslateY = useRef(new Animated.Value(20)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const highlightAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const slide = DEMO_SLIDES[currentSlide];
  const totalSlides = DEMO_SLIDES.length;

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const animateSlideIn = useCallback(() => {
    fadeAnim.setValue(0);
    mockupScale.setValue(0.85);
    mockupTranslateY.setValue(30);
    titleTranslateY.setValue(20);
    subtitleOpacity.setValue(0);
    highlightAnims.forEach((a) => a.setValue(0));

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true}),
      Animated.spring(mockupScale, {
        toValue: 1,
        friction: 8,
        tension: 50,
        useNativeDriver: true}),
      Animated.spring(mockupTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true}),
      Animated.timing(titleTranslateY, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true}),
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: 500,
        delay: 200,
        useNativeDriver: true}),
      ...highlightAnims.map((a, i) =>
        Animated.spring(a, {
          toValue: 1,
          friction: 8,
          tension: 40,
          delay: 400 + i * 150,
          useNativeDriver: true})
      ),
    ]).start();
  }, [fadeAnim, mockupScale, mockupTranslateY, titleTranslateY, subtitleOpacity, highlightAnims]);

  const startProgressTimer = useCallback(() => {
    slideProgress.setValue(0);
    if (progressAnimRef.current) {
      progressAnimRef.current.stop();
    }
    const anim = Animated.timing(slideProgress, {
      toValue: 1,
      duration: SLIDE_DURATION,
      useNativeDriver: false});
    progressAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) {
        if (currentSlide < totalSlides - 1) {
          setCurrentSlide((prev) => prev + 1);
        } else {
          setIsPlaying(false);
          setIsFinished(true);
        }
      }
    });
  }, [slideProgress, currentSlide, totalSlides]);

  const stopProgress = useCallback(() => {
    if (progressAnimRef.current) {
      progressAnimRef.current.stop();
    }
  }, []);

  useEffect(() => {
    animateSlideIn();
    if (isPlaying && !isFinished) {
      startProgressTimer();
    }
    return () => {
      stopProgress();
    };
  }, [currentSlide, isPlaying, isFinished]);

  const goToSlide = useCallback(
    (idx: number) => {
      triggerHaptic();
      stopProgress();
      setIsFinished(false);
      setCurrentSlide(idx);
      if (!isPlaying) {
        setIsPlaying(true);
      }
    },
    [stopProgress, triggerHaptic, isPlaying]
  );

  const togglePlay = useCallback(() => {
    triggerHaptic();
    if (isFinished) {
      setIsFinished(false);
      setCurrentSlide(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((prev) => !prev);
  }, [triggerHaptic, isFinished]);

  const goNext = useCallback(() => {
    triggerHaptic();
    stopProgress();
    if (currentSlide < totalSlides - 1) {
      setIsFinished(false);
      setCurrentSlide((prev) => prev + 1);
      if (!isPlaying) setIsPlaying(true);
    }
  }, [currentSlide, totalSlides, triggerHaptic, stopProgress, isPlaying]);

  const goPrev = useCallback(() => {
    triggerHaptic();
    stopProgress();
    if (currentSlide > 0) {
      setIsFinished(false);
      setCurrentSlide((prev) => prev - 1);
      if (!isPlaying) setIsPlaying(true);
    }
  }, [currentSlide, triggerHaptic, stopProgress, isPlaying]);

  const handleClose = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [triggerHaptic, router]);

  const slideCounterText = useMemo(
    () => `${currentSlide + 1} / ${totalSlides}`,
    [currentSlide, totalSlides]
  );

  const MockupComponent = slide.Mockup;

  return (
    <View style={styles.container}>
      <View style={[styles.bgGlow, { backgroundColor: slide.accentColor + '08' }]} />
      <View
        style={[
          styles.bgGlowOrb,
          { backgroundColor: slide.accentColor + '12', top: SCREEN_H * 0.15, left: -60 },
        ]}
      />
      <View
        style={[
          styles.bgGlowOrb,
          { backgroundColor: slide.accentColor + '08', bottom: SCREEN_H * 0.1, right: -40 },
        ]}
      />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
            <X size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.topBarCenter}>
            <View style={[styles.liveIndicator, { backgroundColor: slide.accentColor }]} />
            <Text style={styles.topBarTitle}>App Demo</Text>
          </View>
          <Text style={styles.slideCounter}>{slideCounterText}</Text>
        </View>

        <ProgressSegments
          total={totalSlides}
          current={currentSlide}
          progress={slideProgress}
          onPress={goToSlide}
          accentColor={slide.accentColor}
        />
      </SafeAreaView>

      <View style={styles.content}>
        <Animated.View
          style={[
            styles.mockupContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: mockupScale }, { translateY: mockupTranslateY }]},
          ]}
        >
          <View style={styles.mockupShadow}>
            <View style={[styles.mockupGlow, { shadowColor: slide.accentColor }]} />
            <View style={styles.mockupWrapper}>
              <MockupComponent />
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.textContent,
            {
              opacity: fadeAnim,
              transform: [{ translateY: titleTranslateY }]},
          ]}
        >
          <View style={styles.slideLabel}>
            <View style={[styles.slideLabelDot, { backgroundColor: slide.accentColor }]} />
            <Text style={[styles.slideLabelText, { color: slide.accentColor }]}>
              {slide.id.replace(/-/g, ' ').toUpperCase()}
            </Text>
          </View>

          <Text style={styles.slideTitle}>{slide.title}</Text>

          <Animated.Text style={[styles.slideSubtitle, { opacity: subtitleOpacity }]}>
            {slide.subtitle}
          </Animated.Text>

          <View style={styles.highlightsRow}>
            {slide.highlights.map((h, i) => (
              <Animated.View
                key={h}
                style={[
                  styles.highlightChip,
                  {
                    borderColor: slide.accentColor + '40',
                    backgroundColor: slide.accentColor + '10',
                    opacity: highlightAnims[i],
                    transform: [
                      {
                        translateY: highlightAnims[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [10, 0]})},
                    ]},
                ]}
              >
                <Text style={[styles.highlightText, { color: slide.accentColor }]}>{h}</Text>
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.controlsArea}>
        <View style={styles.controls}>
          <TouchableOpacity
            onPress={goPrev}
            style={[styles.controlBtn, currentSlide === 0 && styles.controlBtnDisabled]}
            disabled={currentSlide === 0}
            activeOpacity={0.7}
          >
            <SkipBack size={20} color={currentSlide === 0 ? Colors.textTertiary : Colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={togglePlay}
            style={[styles.playBtn, { backgroundColor: slide.accentColor }]}
            activeOpacity={0.8}
          >
            {isFinished ? (
              <RotateCcw size={24} color="#000" />
            ) : isPlaying ? (
              <Pause size={24} color="#000" />
            ) : (
              <Play size={24} color="#000" style={{ marginLeft: 2 }} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goNext}
            style={[
              styles.controlBtn,
              currentSlide === totalSlides - 1 && styles.controlBtnDisabled,
            ]}
            disabled={currentSlide === totalSlides - 1}
            activeOpacity={0.7}
          >
            <SkipForward
              size={20}
              color={currentSlide === totalSlides - 1 ? Colors.textTertiary : Colors.text}
            />
          </TouchableOpacity>
        </View>

        {isFinished && (
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: slide.accentColor }]}
            onPress={() => router.push('/(tabs)/(home)' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaText}>Start Exploring the App</Text>
            <ChevronRight size={18} color="#000" />
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060608'},
  bgGlow: {
    ...StyleSheet.absoluteFillObject},
  bgGlowOrb: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100},
  safeArea: {
    zIndex: 10},
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8},
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center'},
  topBarCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4},
  topBarTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.5},
  slideCounter: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    minWidth: 50,
    textAlign: 'right' as const},
  progressBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 3,
    paddingTop: 6,
    paddingBottom: 4},
  progressSegment: {
    flex: 1,
    height: 16,
    justifyContent: 'center'},
  progressSegmentBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden'},
  progressSegmentFill: {
    height: '100%',
    borderRadius: 2},
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24},
  mockupContainer: {
    alignItems: 'center',
    marginBottom: 24},
  mockupShadow: {
    width: SCREEN_W - 80,
    maxWidth: 320,
    position: 'relative'},
  mockupGlow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    bottom: -10,
    borderRadius: 24,
    ...(Platform.OS === 'web'
      ? {}
      : {
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.4,
          shadowRadius: 30,
          elevation: 20})},
  mockupWrapper: {
    borderRadius: 20,
    overflow: 'hidden'},
  textContent: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8},
  slideLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  slideLabelDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  slideLabelText: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.5},
  slideTitle: {
    fontSize: 24,
    fontWeight: '900' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    lineHeight: 30},
  slideSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    maxWidth: 320},
  highlightsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4},
  highlightChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1},
  highlightText: {
    fontSize: 12,
    fontWeight: '700' as const},
  controlsArea: {
    paddingHorizontal: 24,
    paddingBottom: 8},
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 12},
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center'},
  controlBtnDisabled: {
    opacity: 0.4},
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center'},
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
    marginBottom: 8},
  ctaText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#000'}});
