import React, { useState, useRef, useCallback, useEffect } from 'react';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import {View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Image,
  ScrollView} from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Home,
  TrendingUp,
  Briefcase,
  User,
  Building2,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  Zap} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useIntro } from '@/lib/intro-context';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface OnboardingFlowProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  sparkles: Sparkles,
  home: Home,
  building: Building2,
  trending: TrendingUp,
  briefcase: Briefcase,
  user: User,
  zap: Zap};

export default function OnboardingFlow({ visible, onClose, onComplete }: OnboardingFlowProps) {
  const { width, height } = useWindowDimensions();
  const { activeSteps, isLoading, completeOnboarding } = useIntro();
  const [currentStep, setCurrentStep] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const logoScaleAnim = useRef(new Animated.Value(0.8)).current;
  const logoOpacityAnim = useRef(new Animated.Value(0)).current;
  const brandTextAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  const isSmall = width < 375;
  const step = activeSteps[currentStep];

  const getIcon = useCallback((iconType: string, size: number, color: string) => {
    const IconComponent = ICON_MAP[iconType] || Sparkles;
    return <IconComponent size={size} color={color} />;
  }, []);

  const animateTransition = useCallback((direction: 'next' | 'prev', callback: () => void) => {
    const toValue = direction === 'next' ? -width : width;
    
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true}),
      Animated.timing(slideAnim, {
        toValue: toValue * 0.3,
        duration: 150,
        useNativeDriver: true}),
    ]).start(() => {
      callback();
      slideAnim.setValue(direction === 'next' ? width * 0.3 : -width * 0.3);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true}),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          useNativeDriver: true}),
      ]).start();
    });
  }, [fadeAnim, slideAnim, width]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep < activeSteps.length - 1) {
      animateTransition('next', () => setCurrentStep(prev => prev + 1));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      completeOnboarding();
      onComplete();
    }
  }, [currentStep, activeSteps.length, animateTransition, onComplete, completeOnboarding]);

  const handlePrev = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep > 0) {
      animateTransition('prev', () => setCurrentStep(prev => prev - 1));
    }
  }, [currentStep, animateTransition]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    completeOnboarding();
    onClose();
  }, [onClose, completeOnboarding]);

  const handleDotPress = useCallback((index: number) => {
    if (index === currentStep) return;
    Haptics.selectionAsync();
    const direction = index > currentStep ? 'next' : 'prev';
    animateTransition(direction, () => setCurrentStep(index));
  }, [currentStep, animateTransition]);

  useEffect(() => {
    if (visible && currentStep === 0) {
      Animated.sequence([
        Animated.parallel([
          Animated.spring(logoScaleAnim, {
            toValue: 1,
            friction: 4,
            tension: 40,
            useNativeDriver: true}),
          Animated.timing(logoOpacityAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true}),
        ]),
        Animated.timing(brandTextAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true}),
      ]).start();

      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true}),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true}),
        ])
      );
      glowLoop.start();

      return () => {
        glowLoop.stop();
      };
    }
  }, [visible, currentStep]);

  if (isLoading) {
    return (
      <Modal visible={visible} animationType="fade" transparent={false}>
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
        </View>
      </Modal>
    );
  }

  if (!step || activeSteps.length === 0) {
    return null;
  }

  const isFirstStep = currentStep === 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={handleSkip}
    >
      <View style={styles.container}>
        {isFirstStep ? (
          <LinearGradient
            colors={['#0D0D0D', '#1A1A1A', '#0D0D0D']}
            style={StyleSheet.absoluteFillObject}
          />
        ) : null}
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
            {!isFirstStep && (
              <View style={styles.logoContainer}>
                <Image
                  source={IVX_LOGO_SOURCE}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
            )}
            <TouchableOpacity onPress={handleSkip} style={styles.closeButton}>
              <X size={24} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, isFirstStep && styles.scrollContentCentered]}
            showsVerticalScrollIndicator={false}
          >
            {isFirstStep ? (
              <Animated.View
                style={[
                  styles.heroContent,
                  {
                    opacity: fadeAnim,
                    transform: [{ translateX: slideAnim }]},
                ]}
              >
                <View style={styles.heroLogoSection}>
                  <Animated.View
                    style={[
                      styles.outerGlowRing,
                      {
                        opacity: glowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.2, 0.6]}),
                        transform: [{
                          scale: glowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.2]})}]},
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.glowRing,
                      {
                        opacity: glowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.4, 1]}),
                        transform: [{
                          scale: glowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.12]})}]},
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.innerGlowRing,
                      {
                        opacity: glowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.5, 0.9]}),
                        transform: [{
                          scale: glowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1.05, 1]})}]},
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.heroLogoContainer,
                      {
                        opacity: logoOpacityAnim,
                        transform: [{ scale: logoScaleAnim }]},
                    ]}
                  >
                    <Image
                      source={IVX_LOGO_SOURCE}
                      style={styles.heroLogo}
                      resizeMode="contain"
                    />
                  </Animated.View>
                </View>

                <Animated.View
                  style={[
                    styles.heroBrandSection,
                    {
                      opacity: brandTextAnim,
                      transform: [{
                        translateY: brandTextAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0]})}]},
                  ]}
                >
                  <Text style={styles.heroBrandName}>IVXHOLDINGS</Text>
                  <View style={styles.llcBadge}>
                    <Text style={styles.llcText}>LLC</Text>
                  </View>
                </Animated.View>

                <Animated.View
                  style={[
                    styles.heroTaglineSection,
                    {
                      opacity: brandTextAnim,
                      transform: [{
                        translateY: brandTextAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [30, 0]})}]},
                  ]}
                >
                  <View style={styles.goldLine} />
                  <Text style={styles.heroTagline}>LUXURY HOLDINGS</Text>
                  <View style={styles.goldLine} />
                </Animated.View>

                <Animated.Text
                  style={[
                    styles.heroDescription,
                    {
                      opacity: brandTextAnim},
                  ]}
                >
                  Your gateway to fractional real estate investing.
                  Start building your property portfolio from just $50.
                </Animated.Text>

                <Animated.View
                  style={[
                    styles.heroFeaturesContainer,
                    {
                      opacity: brandTextAnim},
                  ]}
                >
                  {step.features.map((feature, index) => (
                    <View key={feature.id || index} style={styles.heroFeatureRow}>
                      <View style={styles.heroFeatureDot} />
                      <Text style={styles.heroFeatureText}>{feature.text}</Text>
                    </View>
                  ))}
                </Animated.View>
              </Animated.View>
            ) : (
            <Animated.View
              style={[
                styles.content,
                {
                  opacity: fadeAnim,
                  transform: [{ translateX: slideAnim }]},
              ]}
            >
              <View style={styles.iconContainer}>
                <View style={[styles.iconBackground, { backgroundColor: step.gradientStart + '20' }]}>
                  {getIcon(step.iconType, 48, step.gradientStart)}
                </View>
              </View>

              <Text style={[styles.title, isSmall && styles.titleSmall]}>{step.title}</Text>
              <Text style={[styles.description, isSmall && styles.descriptionSmall]}>
                {step.description}
              </Text>

              {step.imageUrl ? (
                <View style={styles.imageContainer}>
                  <Image
                    source={{ uri: step.imageUrl }}
                    style={[styles.stepImage, { height: height * 0.18 }]}
                    resizeMode="cover"
                  />
                  <View style={[styles.imageOverlay, { backgroundColor: step.gradientStart + '30' }]} />
                </View>
              ) : null}

              <View style={styles.featuresContainer}>
                {step.features.map((feature, index) => (
                  <View key={feature.id || index} style={styles.featureRow}>
                    <View style={[styles.featureDot, { backgroundColor: step.gradientStart }]} />
                    <Text style={[styles.featureText, isSmall && styles.featureTextSmall]}>
                      {feature.text}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.dotsContainer}>
              {activeSteps.map((_, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => handleDotPress(index)}
                  style={styles.dotTouchable}
                >
                  <Animated.View
                    style={[
                      styles.dot,
                      index === currentStep && styles.dotActive,
                      index === currentStep && { backgroundColor: step.gradientStart },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.buttonsContainer}>
              {currentStep > 0 && (
                <TouchableOpacity
                  style={styles.prevButton}
                  onPress={handlePrev}
                >
                  <ChevronLeft size={20} color={Colors.text} />
                  <Text style={styles.prevButtonText}>Back</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.nextButton,
                  { backgroundColor: step.gradientStart },
                  currentStep === 0 && styles.nextButtonFull,
                ]}
                onPress={handleNext}
              >
                <Text style={styles.nextButtonText}>
                  {currentStep === activeSteps.length - 1 ? "Let's Go!" : 'Next'}
                </Text>
                {currentStep < activeSteps.length - 1 && (
                  <ChevronRight size={20} color={Colors.black} />
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.stepIndicator}>
              {currentStep + 1} of {activeSteps.length}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center'},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8},
  scrollContentCentered: {
    flexGrow: 1,
    justifyContent: 'center'},
  heroContent: {
    alignItems: 'center',
    paddingHorizontal: 24},
  heroLogoSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    width: 160,
    height: 160},
  outerGlowRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  glowRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: Colors.primary + '50'},
  innerGlowRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  heroLogoContainer: {
    width: 88,
    height: 88,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.primary + '60'},
  heroLogo: {
    width: '100%',
    height: '100%'},
  heroBrandSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8},
  heroBrandName: {
    fontSize: 28,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: 3},
  llcBadge: {
    backgroundColor: Colors.primary + '20',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  llcText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1},
  heroTaglineSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20},
  goldLine: {
    width: 32,
    height: 1,
    backgroundColor: Colors.primary + '60'},
  heroTagline: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 4},
  heroDescription: {
    color: Colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 8},
  heroFeaturesContainer: {
    gap: 12,
    width: '100%',
    paddingHorizontal: 16},
  heroFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  heroFeatureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary},
  heroFeatureText: {
    color: Colors.textSecondary,
    fontSize: 14},
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 12},
  skipText: {
    color: Colors.textTertiary,
    fontSize: 15,
    fontWeight: '500' as const},
  logoContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    overflow: 'hidden'},
  logo: {
    width: '100%',
    height: '100%'},
  closeButton: {
    padding: 6},
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingBottom: 20},
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20},
  iconContainer: {
    marginBottom: 24},
  iconBackground: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center'},
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 12},
  titleSmall: {
    fontSize: 22},
  description: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
    paddingHorizontal: 8},
  descriptionSmall: {
    fontSize: 14,
    lineHeight: 20},
  imageContainer: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24},
  stepImage: {
    width: '100%',
    borderRadius: 16},
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16},
  featuresContainer: {
    gap: 14,
    width: '100%',
    paddingHorizontal: 8},
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  featureDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  featureText: {
    color: Colors.textSecondary,
    fontSize: 15,
    flex: 1},
  featureTextSmall: {
    fontSize: 13},
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 14},
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6},
  dotTouchable: {
    padding: 4},
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surfaceBorder},
  dotActive: {
    width: 24,
    borderRadius: 4},
  buttonsContainer: {
    flexDirection: 'row',
    gap: 12},
  prevButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  prevButtonText: {
    color: Colors.text,
    fontWeight: '600' as const,
    fontSize: 15},
  nextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14},
  nextButtonFull: {
    flex: 1},
  nextButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 16},
  stepIndicator: {
    color: Colors.textTertiary,
    fontSize: 12,
    textAlign: 'center'}});
