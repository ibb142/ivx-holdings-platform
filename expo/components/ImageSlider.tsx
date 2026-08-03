import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import {View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
  useWindowDimensions,
  Modal,
  Animated,
  StatusBar,
  Platform} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ChevronLeft, ChevronRight, ZoomIn, ImageOff } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface ImageSliderProps {
  images: string[];
  height?: number;
  showPagination?: boolean;
  onImagePress?: (index: number) => void;
}

const INDICATOR_SIZE = 7;
const INDICATOR_ACTIVE_WIDTH = 24;
const INDICATOR_GAP = 6;

const ImageSlider = memo(function ImageSlider({
  images: imagesProp,
  height = 320,
  showPagination = true,
  onImagePress}: ImageSliderProps) {
  const images = React.useMemo(() => {
    const filtered = Array.isArray(imagesProp) ? imagesProp.filter(img => img && img.length > 0) : [];
    return filtered.length > 0 ? filtered.slice(0, 8) : [];
  }, [imagesProp]);

  const isEmpty = images.length === 0;

  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [loadingStates, setLoadingStates] = useState<Record<number, boolean>>({});

  const scrollViewRef = useRef<ScrollView>(null);
  const fullscreenScrollRef = useRef<ScrollView>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState<number>(screenWidth);
  const insets = useSafeAreaInsets();

  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const w = event.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 1) {
      console.log('[ImageSlider] Container width measured:', w);
      setContainerWidth(w);
    }
  }, [containerWidth]);

  const indicatorAnims = useRef<Animated.Value[]>(
    images.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))
  ).current;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  const animateIndicators = useCallback((newIndex: number) => {
    images.forEach((_, i) => {
      const anim = indicatorAnims[i];
      if (anim) {
        Animated.spring(anim, {
          toValue: i === newIndex ? 1 : 0,
          useNativeDriver: false,
          tension: 60,
          friction: 8}).start();
      }
    });
  }, [images, indicatorAnims]);

  const activeIndexRef = useRef<number>(0);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const layoutWidth = event.nativeEvent.layoutMeasurement?.width;
    const w = layoutWidth && layoutWidth > 0 ? layoutWidth : (containerWidth > 0 ? containerWidth : screenWidth);
    const newIndex = Math.round(contentOffsetX / w);
    console.log('[ImageSlider] scroll offset:', contentOffsetX, 'width:', w, 'index:', newIndex);
    if (newIndex >= 0 && newIndex < images.length && newIndex !== activeIndexRef.current) {
      activeIndexRef.current = newIndex;
      setActiveIndex(newIndex);
      animateIndicators(newIndex);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [images.length, containerWidth, screenWidth, animateIndicators]);

  const handleMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const layoutWidth = event.nativeEvent.layoutMeasurement?.width;
    const w = layoutWidth && layoutWidth > 0 ? layoutWidth : (containerWidth > 0 ? containerWidth : screenWidth);
    const newIndex = Math.round(contentOffsetX / w);
    console.log('[ImageSlider] momentumEnd offset:', contentOffsetX, 'width:', w, 'index:', newIndex);
    if (newIndex >= 0 && newIndex < images.length) {
      activeIndexRef.current = newIndex;
      setActiveIndex(newIndex);
      animateIndicators(newIndex);
    }
  }, [images.length, containerWidth, screenWidth, animateIndicators]);

  const handleFullscreenScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const newIndex = Math.round(contentOffsetX / screenWidth);
    if (newIndex !== fullscreenIndex && newIndex >= 0 && newIndex < images.length) {
      setFullscreenIndex(newIndex);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [fullscreenIndex, images.length, screenWidth]);

  const openFullscreen = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFullscreenIndex(index);
    setFullscreenVisible(true);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true}),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 9}),
    ]).start();

    if (onImagePress) {
      onImagePress(index);
    }
  }, [fadeAnim, scaleAnim, onImagePress]);

  const closeFullscreen = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true}),
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 200,
        useNativeDriver: true}),
    ]).start(() => {
      setFullscreenVisible(false);
    });
  }, [fadeAnim, scaleAnim]);

  useEffect(() => {
    if (fullscreenVisible && fullscreenScrollRef.current) {
      setTimeout(() => {
        fullscreenScrollRef.current?.scrollTo({
          x: fullscreenIndex * screenWidth,
          animated: false});
      }, 50);
    }
  }, [fullscreenVisible, fullscreenIndex, screenWidth]);

  const navigateFullscreen = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? Math.min(fullscreenIndex + 1, images.length - 1)
      : Math.max(fullscreenIndex - 1, 0);

    if (newIndex !== fullscreenIndex) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFullscreenIndex(newIndex);
      fullscreenScrollRef.current?.scrollTo({
        x: newIndex * screenWidth,
        animated: true});
    }
  }, [fullscreenIndex, images.length, screenWidth]);

  const handleImageLoad = useCallback((index: number) => {
    setLoadingStates(prev => ({ ...prev, [index]: false }));
  }, []);

  const handleImageLoadStart = useCallback((index: number) => {
    setLoadingStates(prev => ({ ...prev, [index]: true }));
  }, []);

  const getHighResUrl = useCallback((url: string) => {
    return url;
  }, []);

  if (isEmpty) {
    return (
      <View style={[styles.container, styles.emptyContainer, { height }]}>
        <ImageOff size={32} color={Colors.textTertiary} />
        <Text style={styles.emptyText}>No photos uploaded</Text>
        <Text style={styles.emptySubtext}>Images will appear once uploaded by admin</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        bounces={false}
      >
        {images.map((image, index) => (
          <TouchableOpacity
            key={index}
            activeOpacity={0.92}
            onPress={() => openFullscreen(index)}
            style={[styles.imageContainer, { width: containerWidth, height }]}
          >
            {loadingStates[index] && (
              <View style={styles.loadingOverlay}>
                <ShimmerIndicator size="small" color={Colors.primary} />
              </View>
            )}
            <Image
              source={{ uri: getHighResUrl(image) }}
              style={styles.image}
              resizeMode="cover"
              onLoadStart={() => handleImageLoadStart(index)}
              onLoad={() => handleImageLoad(index)}
              onError={() => { handleImageLoad(index); console.log('[ImageSlider] Image failed to load:', image?.substring(0, 60)); }}
            />
            <View style={styles.imageGradientBottom} />
            <View style={styles.imageGradientTop} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {showPagination && images.length > 1 && (
        <View style={styles.indicatorBar}>
          <View style={styles.indicatorTrack}>
            {images.map((_, index) => {
              const anim = indicatorAnims[index];
              if (!anim) return null;
              const widthAnim = anim.interpolate({
                inputRange: [0, 1],
                outputRange: [INDICATOR_SIZE, INDICATOR_ACTIVE_WIDTH]});
              const opacityAnim = anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1]});
              const bgAnim = anim.interpolate({
                inputRange: [0, 1],
                outputRange: ['rgba(255,255,255,0.5)', Colors.primary]});

              return (
                <Animated.View
                  key={index}
                  style={[
                    styles.indicator,
                    {
                      width: widthAnim,
                      opacity: opacityAnim,
                      backgroundColor: bgAnim},
                  ]}
                />
              );
            })}
          </View>
        </View>
      )}

      {images.length > 1 && (
        <View style={styles.counterContainer}>
          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {activeIndex + 1}<Text style={styles.counterSeparator}> / </Text>{images.length}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.zoomHint}>
        <ZoomIn size={14} color="rgba(255,255,255,0.6)" />
      </View>

      <Modal
        visible={fullscreenVisible}
        animationType="none"
        transparent
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <Animated.View style={[styles.fullscreenContainer, { opacity: fadeAnim }]}>
          {Platform.OS !== 'web' && <StatusBar barStyle="light-content" />}

          <Animated.View style={[styles.fullscreenContent, { transform: [{ scale: scaleAnim }] }]}>
            <ScrollView
              ref={fullscreenScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleFullscreenScroll}
              scrollEventThrottle={16}
              decelerationRate="fast"
              bounces={false}
            >
              {images.map((image, index) => (
                <View key={index} style={[styles.fullscreenImageWrapper, { width: screenWidth, height: screenHeight }]}>
                  <Image
                    source={{ uri: getHighResUrl(image) }}
                    style={styles.fullscreenImage}
                    resizeMode="contain"
                  />
                </View>
              ))}
            </ScrollView>
          </Animated.View>

          <View style={[styles.fullscreenHeader, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
            <TouchableOpacity
              style={styles.fullscreenCloseBtn}
              onPress={closeFullscreen}
              activeOpacity={0.7}
            >
              <X size={22} color="#fff" />
            </TouchableOpacity>

            <View style={styles.fullscreenCounterPill}>
              <Text style={styles.fullscreenCounterText}>
                {fullscreenIndex + 1} / {images.length}
              </Text>
            </View>

            <View style={{ width: 40 }} />
          </View>

          {images.length > 1 && (
            <>
              {fullscreenIndex > 0 && (
                <TouchableOpacity
                  style={[styles.fullscreenNavBtn, styles.fullscreenNavLeft]}
                  onPress={() => navigateFullscreen('prev')}
                  activeOpacity={0.7}
                >
                  <ChevronLeft size={28} color="#fff" />
                </TouchableOpacity>
              )}
              {fullscreenIndex < images.length - 1 && (
                <TouchableOpacity
                  style={[styles.fullscreenNavBtn, styles.fullscreenNavRight]}
                  onPress={() => navigateFullscreen('next')}
                  activeOpacity={0.7}
                >
                  <ChevronRight size={28} color="#fff" />
                </TouchableOpacity>
              )}
            </>
          )}

          <View style={[styles.fullscreenFooter, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.fullscreenIndicatorRow}>
              {images.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.fullscreenDot,
                    index === fullscreenIndex && styles.fullscreenDotActive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.fullscreenQualityBadge}>8K Ultra HD</Text>
          </View>
        </Animated.View>
      </Modal>
    </View>
  );
});

export default ImageSlider;

const styles = StyleSheet.create({
  container: {
    position: 'relative' as const,
    backgroundColor: '#000',
    overflow: 'hidden' as const},
  imageContainer: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  image: {
    width: '100%',
    height: '100%'},
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: '#111',
    zIndex: 1},
  imageGradientBottom: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'transparent',
    borderBottomWidth: 0},
  imageGradientTop: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent'},
  indicatorBar: {
    position: 'absolute' as const,
    bottom: 14,
    left: 0,
    right: 0,
    alignItems: 'center' as const},
  indicatorTrack: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: INDICATOR_GAP,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)'},
  indicator: {
    height: INDICATOR_SIZE,
    borderRadius: INDICATOR_SIZE / 2},
  counterContainer: {
    position: 'absolute' as const,
    top: 12,
    right: 12},
  counterPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14},
  counterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.3},
  counterSeparator: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11},
  zoomHint: {
    position: 'absolute' as const,
    bottom: 14,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    padding: 6},
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000'},
  fullscreenContent: {
    flex: 1},
  fullscreenImageWrapper: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  fullscreenImage: {
    width: '100%',
    height: '100%'},
  fullscreenHeader: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingBottom: 12},
  fullscreenCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  fullscreenCounterPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20},
  fullscreenCounterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.5},
  fullscreenNavBtn: {
    position: 'absolute' as const,
    top: '48%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginTop: -22},
  fullscreenNavLeft: {
    left: 12},
  fullscreenNavRight: {
    right: 12},
  fullscreenFooter: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
    paddingTop: 12},
  fullscreenIndicatorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 10},
  fullscreenDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.3)'},
  fullscreenDotActive: {
    width: 22,
    backgroundColor: Colors.primary},
  fullscreenQualityBadge: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '600' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const},
  emptyContainer: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderStyle: 'dashed' as const,
    gap: 8},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600' as const,
    marginTop: 4},
  emptySubtext: {
    color: Colors.textTertiary,
    fontSize: 12}});
