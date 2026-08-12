import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
  Platform,
  Alert,
  Share,
  Linking} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Wand2,
  Film,
  Sparkles,
  ChevronRight,
  RefreshCw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Clock,
  CheckCircle2,
  Zap,
  Target,
  Briefcase,
  Gauge,
  Camera,
  MessageCircle,
  ArrowUpFromLine,
  ArrowDownToLine,
  Trash2,
  CheckCircle,
  Share2,
  Image as ImageIcon} from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { generateText, generateImage as aiGenerateImage } from '@/lib/ai-service';
import { SCREEN_MOCKUP_MAP } from '@/components/ScreenMockups';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WAVE_BAR_COUNT = 5;


interface PresentationSlide {
  id: string;
  title: string;
  subtitle: string;
  narration: string;
  bulletPoints: string[];
  imageUrl: string | null;
  themeColor: string;
  icon: string;
  screenFeatures: string[];
}

interface StyleOption {
  id: string;
  name: string;
  description: string;
  iconName: string;
  color: string;
  tone: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  { id: 'investor', name: 'Investor Pitch', description: '8K cinematic for investors', iconName: 'briefcase', color: '#FFD700', tone: 'professional, persuasive, data-driven, use financial metrics and ROI projections' },
  { id: 'demo', name: 'Product Demo', description: 'Full feature walkthrough', iconName: 'zap', color: '#4A90D9', tone: 'engaging, technical but accessible, highlight UX and innovation' },
  { id: 'executive', name: 'Executive Brief', description: 'Quick C-suite highlights', iconName: 'target', color: '#00C48C', tone: 'concise, impactful, focus on market opportunity and competitive advantage' },
];

const SECTION_CONFIGS = [
  { id: 'intro', title: 'IVXHOLDINGS Real Estate', subtitle: 'The Future of Property Investment', icon: '🏛️', color: '#FFD700' },
  { id: 'opportunity', title: 'Market Opportunity', subtitle: '$326T Global Real Estate Market', icon: '🌍', color: '#4A90D9' },
  { id: 'platform', title: 'Platform Overview', subtitle: '340+ Features Built-In', icon: '🚀', color: '#00C48C' },
  { id: 'onboarding', title: 'Smart Onboarding', subtitle: 'KYC & Verification', icon: '🛡️', color: '#9B59B6' },
  { id: 'marketplace', title: 'Property Marketplace', subtitle: 'Curated Opportunities', icon: '🏘️', color: '#FF6B6B' },
  { id: 'trading', title: 'Investment Engine', subtitle: 'Fractional Trading', icon: '📈', color: '#FFB800' },
  { id: 'portfolio', title: 'Portfolio Intelligence', subtitle: 'AI-Powered Analytics', icon: '💼', color: '#4A90D9' },
  { id: 'wallet', title: 'Digital Wallet', subtitle: 'Multi-Payment Infrastructure', icon: '💰', color: '#2ECC71' },
  { id: 'tokenomics', title: 'IVXHOLDINGS Token Economy', subtitle: 'Blockchain Rewards', icon: '🪙', color: '#F39C12' },
  { id: 'ai', title: 'AI Suite', subtitle: 'Intelligent Automation', icon: '🤖', color: '#E91E63' },
  { id: 'admin', title: 'Admin Command Center', subtitle: '45+ Management Tools', icon: '👑', color: '#FFD700' },
  { id: 'security', title: 'Enterprise Security', subtitle: 'SEC & GDPR Compliant', icon: '🔐', color: '#607D8B' },
  { id: 'growth', title: 'Growth Engine', subtitle: 'Referrals & Influencers', icon: '📊', color: '#00BCD4' },
  { id: 'metrics', title: 'Key Metrics', subtitle: 'Platform Performance', icon: '⚡', color: '#FF5722' },
  { id: 'closing', title: 'Invest With IVXHOLDINGS', subtitle: 'The Opportunity Is Now', icon: '✨', color: '#FFD700' },
];

const FALLBACK_NARRATIONS: Record<string, { narration: string; bullets: string[] }> = {
  intro: {
    narration: 'Welcome to IVXHOLDINGS Real Estate, the revolutionary investment platform transforming how the world invests in property. Built with cutting-edge technology and designed for the modern investor, IVXHOLDINGS puts institutional-grade real estate opportunities in the palm of your hand.',
    bullets: ['$326 Trillion global real estate market', 'Fractional ownership from just $100', 'SEC-compliant investment structure', '340+ features across the platform']},
  opportunity: {
    narration: 'The global real estate market represents the largest asset class in the world at over 326 trillion dollars. Until now, only institutional investors had access to the best opportunities. IVXHOLDINGS is democratizing real estate investment through fractional ownership and blockchain technology.',
    bullets: ['Largest asset class globally at $326T', '90% of millionaires built wealth via real estate', 'Only 15% of Americans invest directly', 'Fractional ownership removes all barriers']},
  platform: {
    narration: 'IVXHOLDINGS is a complete investment ecosystem with over 340 features designed to provide a seamless, institutional-grade experience. From AI-powered analytics to automated compliance, every detail has been engineered for excellence.',
    bullets: ['340+ features built and integrated', 'AI-powered investment recommendations', 'Real-time market data and analytics', 'Multi-platform: iOS, Android, and Web']},
  onboarding: {
    narration: 'Our smart onboarding ensures every investor is verified and compliant from day one. AI-powered KYC verification and biometric authentication maintain the highest standards of security — open to all investors with no accreditation barriers.',
    bullets: ['AI-powered document verification', 'Biometric authentication built-in', 'Open to all investors — no accreditation required', 'GDPR-compliant data handling']},
  marketplace: {
    narration: 'Our curated property marketplace features vetted investment opportunities across residential, commercial, and mixed-use real estate. Advanced filters, interactive maps, and detailed financial projections help investors make informed decisions.',
    bullets: ['Curated, pre-vetted properties', '25+ advanced filter options', 'Interactive property maps', 'Detailed ROI projections per listing']},
  trading: {
    narration: 'The IVXHOLDINGS trading engine enables fractional real estate investment with institutional-grade execution. Place market and limit orders, set up automated investing schedules, and reinvest dividends automatically with our DRIP program.',
    bullets: ['Fractional shares from $100', 'Market and limit order types', 'Automated recurring investments', 'DRIP dividend reinvestment']},
  portfolio: {
    narration: 'Track your entire real estate portfolio with AI-powered analytics. Interactive performance charts, asset allocation views, and benchmark comparisons give you complete visibility into your investments at all times.',
    bullets: ['Real-time portfolio valuation', 'Interactive performance charts', 'AI-powered investment insights', 'Tax reporting documentation']},
  wallet: {
    narration: 'Our digital wallet supports multiple payment methods including ACH transfers, wire deposits, card payments, and cryptocurrency. Instant withdrawal processing and complete fee transparency ensure a frictionless experience.',
    bullets: ['ACH, wire, and card payments', 'Instant withdrawal processing', 'Complete fee transparency', 'Multi-currency support']},
  tokenomics: {
    narration: 'The IVXHOLDINGS token ecosystem rewards active participants with enhanced yields, governance rights, and exclusive platform benefits. Stake tokens for additional returns, vote on platform decisions, and unlock premium features.',
    bullets: ['Token staking for enhanced yields', 'Governance voting rights', 'Tiered benefit system', 'Referral bonus multipliers']},
  ai: {
    narration: 'Our AI suite powers every aspect of the platform. From intelligent chatbots and automated email outreach to AI-generated video presentations and predictive analytics, artificial intelligence is at the core of IVXHOLDINGS.',
    bullets: ['24/7 AI investment assistant', 'AI-powered email engine', 'Automated video generation', 'Predictive market analytics']},
  admin: {
    narration: 'The admin command center provides complete platform control with over 45 management tools. Monitor transactions, manage users, run marketing campaigns, and analyze performance metrics from a single dashboard.',
    bullets: ['45+ admin management tools', 'Real-time transaction monitoring', 'Integrated email marketing engine', 'AI-powered outreach automation']},
  security: {
    narration: 'IVXHOLDINGS employs enterprise-grade security including end-to-end encryption, two-factor authentication, and continuous activity monitoring. Fully SEC-compliant and GDPR-ready, your investments and data are always protected.',
    bullets: ['End-to-end encryption', 'Two-factor authentication', 'SEC and GDPR compliance', 'Continuous threat monitoring']},
  growth: {
    narration: 'Our growth engine includes a multi-tier referral program, influencer partnerships, and social media command center. These tools enable organic platform growth while rewarding early adopters and community builders.',
    bullets: ['Multi-tier referral program', 'Influencer partnership platform', 'Social media command center', 'Gamified engagement system']},
  metrics: {
    narration: 'IVXHOLDINGS delivers measurable results. Our platform tracks key performance indicators across user acquisition, transaction volume, portfolio growth, and investor satisfaction for continuous improvement and transparency.',
    bullets: ['User acquisition and retention', 'Transaction volume growth rate', 'Average portfolio return tracking', 'Net promoter score monitoring']},
  closing: {
    narration: 'The future of real estate investment is here. IVXHOLDINGS combines cutting-edge technology with institutional-grade infrastructure to create the most comprehensive property investment platform ever built. Start building your real estate portfolio today.',
    bullets: ['Start investing with just $100', 'Join thousands of active investors', 'Download free on iOS and Android', 'Contact us for partnerships']}};

const STYLE_ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  briefcase: Briefcase,
  zap: Zap,
  target: Target};

const SCREEN_FEATURE_MAP: Record<string, string[]> = {
  intro: ['Onboarding Flow', 'Multi-Platform', 'Instant Sign-Up'],
  opportunity: ['Market Data', 'Growth Charts', 'Industry Stats'],
  platform: ['340+ Features', '6 Core Modules', 'Cross-Platform'],
  onboarding: ['AI Document Scan', 'Biometric Auth', 'KYC Steps'],
  marketplace: ['Property Search', 'Smart Filters', 'ROI Projections'],
  trading: ['Market Orders', 'Limit Orders', 'DRIP Reinvest'],
  portfolio: ['Live Valuation', 'Performance Charts', 'Asset Allocation'],
  wallet: ['ACH / Wire / Card', 'Crypto Support', 'Instant Withdraw'],
  tokenomics: ['Staking Rewards', 'Governance Votes', 'Tier Benefits'],
  ai: ['AI Chat Assistant', 'Smart Suggestions', 'Portfolio Analysis'],
  admin: ['45+ Admin Tools', 'Real-Time Monitoring', 'Email Engine'],
  security: ['E2E Encryption', '2FA Enabled', 'SEC Compliant'],
  growth: ['Referral Program', 'Influencer Hub', 'Social Command'],
  metrics: ['User Growth KPIs', 'Txn Volume', 'NPS Tracking'],
  closing: ['Start from $100', 'Free Download', 'iOS + Android + Web']};

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5];

const PHOTO_STORAGE_KEY = 'ipx_aivideo_photos';
const PHOTO_DAILY_KEY = 'ipx_aivideo_daily';
const FREE_PHOTO_LIMIT = 5;
const APP_SHARE_URL = 'https://ipxholding.com/presentation';
const WHATSAPP_MSG = '\uD83C\uDFAC IVX HOLDINGS \u2014 The Future of Real Estate Investing! AI-powered, fractional ownership from $10. 340+ features built & live.\n\n' + APP_SHARE_URL;

const getTodayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface PhotoItem {
  id: string;
  label: string;
  base64: string;
  mimeType: string;
  createdAt: string;
}

const PHOTO_TEMPLATES = [
  { id: 'luxury-tower', label: 'Luxury Tower 8K', color: '#FFD700', prompt: 'Photorealistic architectural rendering of a modern luxury residential skyscraper, 40 floors, glass and steel facade, rooftop infinity pool, palm trees, golden hour lighting, drone aerial perspective, 8K ultra-realistic quality' },
  { id: 'beachfront', label: 'Beachfront Villa 8K', color: '#4A90D9', prompt: 'Stunning photorealistic modern beachfront luxury villa with infinity pool overlooking the ocean, white architecture, tropical landscaping, sunset sky, professional architectural photography, 8K ultra-realistic' },
  { id: 'penthouse', label: 'Penthouse Interior 8K', color: '#E91E63', prompt: 'Photorealistic interior of ultra-luxury penthouse, floor-to-ceiling windows with panoramic city skyline at night, modern minimalist design, marble floors, designer furniture, warm ambient lighting, 8K quality' },
  { id: 'construction', label: 'Under Construction 8K', color: '#FF6B35', prompt: 'Ultra-realistic luxury high-rise under construction, cranes, scaffolding, concrete floors, city skyline, golden sunlight, professional real estate development photography, 8K quality' },
  { id: 'smart-city', label: 'Smart City 8K', color: '#7C4DFF', prompt: 'Futuristic photorealistic smart city mixed-use development, interconnected buildings with LED facades, autonomous vehicle lanes, elevated walkways, holographic signage, sunset lighting, 8K ultra-realistic' },
  { id: 'invest-dash', label: 'Investment Dashboard 8K', color: '#00C48C', prompt: 'Photorealistic sleek modern desk with curved monitor and smartphone displaying real estate portfolio charts, green profit indicators, dark mode UI with gold accents, ambient LED lighting, city skyline, 8K ultra-realistic' },
];

export default function AIVideoStudio() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [slides, setSlides] = useState<PresentationSlide[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isGeneratingPhoto, setIsGeneratingPhoto] = useState(false);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState('investor');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const imageScaleAnim = useRef(new Animated.Value(1)).current;
  const textSlideAnim = useRef(new Animated.Value(0)).current;
  const waveBarAnims = useRef(
    Array.from({ length: WAVE_BAR_COUNT }, () => new Animated.Value(0.15))
  ).current;
  const slidesRef = useRef<PresentationSlide[]>([]);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  slidesRef.current = slides;

  useEffect(() => {
    return () => {
      console.log('[AIVideo] Cleanup: stopping speech and timers');
      Speech.stop().catch(() => {});
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];
    if (isSpeaking) {
      waveBarAnims.forEach((bar, i) => {
        const anim = Animated.loop(
          Animated.sequence([
            Animated.timing(bar, { toValue: 0.7 + (i % 3) * 0.15, duration: 220 + i * 60, useNativeDriver: true }),
            Animated.timing(bar, { toValue: 0.15 + (i % 2) * 0.1, duration: 180 + i * 50, useNativeDriver: true }),
          ])
        );
        anim.start();
        animations.push(anim);
      });
    } else {
      waveBarAnims.forEach((bar) => {
        Animated.timing(bar, { toValue: 0.15, duration: 250, useNativeDriver: true }).start();
      });
    }
    return () => { animations.forEach(a => a.stop()); };
  }, [isSpeaking, waveBarAnims]);

  useEffect(() => {
    if (isPlaying) {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((p) => p + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || slides.length === 0) return;

    let cancelled = false;
    const slideData = slidesRef.current[currentSlide];
    if (!slideData) return;

    console.log(`[AIVideo] Playing slide ${currentSlide + 1}/${slides.length}: ${slideData.title}`);

    fadeAnim.setValue(0);
    textSlideAnim.setValue(24);
    imageScaleAnim.setValue(1.0);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(textSlideAnim, { toValue: 0, duration: 550, useNativeDriver: true }),
      Animated.timing(imageScaleAnim, { toValue: 1.08, duration: 10000, useNativeDriver: true }),
    ]).start();

    const advanceToNext = () => {
      if (cancelled) return;
      if (currentSlide < slides.length - 1) {
        setCurrentSlide((p) => p + 1);
      } else {
        setIsPlaying(false);
        console.log('[AIVideo] Presentation finished');
      }
    };

    if (voiceEnabled) {
      const narrationTimer = setTimeout(() => {
        if (cancelled) return;
        try {
          setIsSpeaking(true);
          Speech.speak(slideData.narration, {
            rate: voiceSpeed,
            pitch: 1.0,
            language: 'en-US',
            onDone: () => {
              if (cancelled) return;
              setIsSpeaking(false);
              playTimerRef.current = setTimeout(advanceToNext, 1200);
            },
            onStopped: () => { setIsSpeaking(false); },
            onError: () => {
              if (cancelled) return;
              setIsSpeaking(false);
              playTimerRef.current = setTimeout(advanceToNext, 3000);
            }});
        } catch {
          setIsSpeaking(false);
          playTimerRef.current = setTimeout(advanceToNext, 5000);
        }
      }, 500);

      return () => {
        cancelled = true;
        clearTimeout(narrationTimer);
        if (playTimerRef.current) clearTimeout(playTimerRef.current);
        Speech.stop().catch(() => {});
        setIsSpeaking(false);
      };
    } else {
      const readTime = Math.max(4000, slideData.narration.length * 45);
      playTimerRef.current = setTimeout(advanceToNext, readTime);
      return () => {
        cancelled = true;
        if (playTimerRef.current) clearTimeout(playTimerRef.current);
      };
    }
  }, [isPlaying, currentSlide, slides.length, voiceEnabled, voiceSpeed, fadeAnim, textSlideAnim, imageScaleAnim]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      console.log('[AIVideo] Starting 8K presentation generation');
      const style = STYLE_OPTIONS.find((s) => s.id === selectedStyle) || STYLE_OPTIONS[0];
      const generated: PresentationSlide[] = [];

      for (let i = 0; i < SECTION_CONFIGS.length; i++) {
        const config = SECTION_CONFIGS[i];
        setGenerationStep(`Writing script: ${config.title}`);
        setGenerationProgress(((i * 2) / (SECTION_CONFIGS.length * 2)) * 100);

        let narration = '';
        let bulletPoints: string[] = [];

        try {
          const prompt = `You are writing a narration script for a professional 8K video presentation about IVXHOLDINGS Real Estate Investment Platform.\nStyle: ${style.tone}\nSection: "${config.title}" (${config.subtitle})\nWrite a compelling 3-4 sentence narration paragraph (50-70 words) suitable for voice-over.\nThen list exactly 4 key data points as short bullet points (max 8 words each).\nFormat exactly as:\nNARRATION: [your narration]\nBULLETS: [bullet1] | [bullet2] | [bullet3] | [bullet4]`;

          const result = await generateText(prompt);
          const parts = result.split('BULLETS:');
          narration = (parts[0] || '').replace('NARRATION:', '').trim();
          if (parts[1]) {
            bulletPoints = parts[1].split('|').map((b: string) => b.trim()).filter((b: string) => b.length > 0).slice(0, 4);
          }
        } catch (err) {
          console.log(`[AIVideo] Text gen fallback for ${config.id}`, err);
        }

        if (!narration) {
          const fb = FALLBACK_NARRATIONS[config.id];
          if (fb) { narration = fb.narration; bulletPoints = fb.bullets; }
          else { narration = `${config.title}. ${config.subtitle}.`; bulletPoints = ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4']; }
        }

        setGenerationStep(`Creating 8K visual: ${config.title}`);
        setGenerationProgress((((i * 2) + 1) / (SECTION_CONFIGS.length * 2)) * 100);

        let imageUrl: string | null = null;
        try {
          const imagePrompt = `Professional cinematic 8K screenshot for "${config.title}" of a luxury real estate fintech app. Dark theme, gold (#FFD700) accent. Sleek mobile UI showing ${config.subtitle}. Ultra premium, dark background, sharp details, high-end fintech aesthetic.`;
          const imgResult = await aiGenerateImage(imagePrompt, '1792x1024');
          if (imgResult?.base64Data) {
            imageUrl = `data:${imgResult.mimeType};base64,${imgResult.base64Data}`;
          }
        } catch (err) {
          console.log(`[AIVideo] Image gen skipped for ${config.id}`, err);
        }

        const screenFeatures = SCREEN_FEATURE_MAP[config.id] || [];

        generated.push({
          id: config.id,
          title: config.title,
          subtitle: config.subtitle,
          narration,
          bulletPoints,
          imageUrl,
          themeColor: config.color,
          icon: config.icon,
          screenFeatures});
      }
      return generated;
    },
    onSuccess: (data) => {
      console.log('[AIVideo] Generation complete:', data.length, 'slides');
      setSlides(data);
      setCurrentSlide(0);
      setGenerationProgress(100);
      setGenerationStep('Complete');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      console.error('[AIVideo] Generation failed:', error);
    }});

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      Speech.stop().catch(() => {});
      setIsSpeaking(false);
    } else {
      if (currentSlide >= slides.length - 1) {
        setCurrentSlide(0);
        setElapsedSeconds(0);
      }
      setIsPlaying(true);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [isPlaying, currentSlide, slides.length]);

  const goToSlide = useCallback((index: number) => {
    if (index < 0 || index >= slides.length) return;
    Speech.stop().catch(() => {});
    setIsSpeaking(false);
    setCurrentSlide(index);
    if (!isPlaying) {
      fadeAnim.setValue(0);
      textSlideAnim.setValue(20);
      imageScaleAnim.setValue(1.0);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(textSlideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(imageScaleAnim, { toValue: 1.05, duration: 6000, useNativeDriver: true }),
      ]).start();
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [slides.length, isPlaying, fadeAnim, textSlideAnim, imageScaleAnim]);

  const nextSlide = useCallback(() => {
    if (currentSlide < slides.length - 1) goToSlide(currentSlide + 1);
  }, [currentSlide, slides.length, goToSlide]);

  const prevSlide = useCallback(() => {
    if (currentSlide > 0) goToSlide(currentSlide - 1);
  }, [currentSlide, goToSlide]);

  const toggleVoice = useCallback(() => {
    if (voiceEnabled) {
      Speech.stop().catch(() => {});
      setIsSpeaking(false);
    }
    setVoiceEnabled((p) => !p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [voiceEnabled]);

  const cycleSpeed = useCallback(() => {
    setVoiceSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const previewVoice = useCallback(() => {
    Speech.stop().catch(() => {});
    Speech.speak('Welcome to IVXHOLDINGS Real Estate, the future of property investment.', {
      rate: voiceSpeed,
      pitch: 1.0,
      language: 'en-US'});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [voiceSpeed]);

  useEffect(() => {
    AsyncStorage.getItem(PHOTO_STORAGE_KEY).then(raw => {
      if (raw) setPhotos(JSON.parse(raw));
    }).catch(() => {});
    AsyncStorage.getItem(PHOTO_DAILY_KEY).then(raw => {
      if (raw) {
        const d = JSON.parse(raw);
        if (d.date === getTodayKey()) setPhotoCount(d.count);
      }
    }).catch(() => {});
  }, []);

  const handleGeneratePhoto = useCallback(async (template: typeof PHOTO_TEMPLATES[0]) => {
    if (isGeneratingPhoto) return;
    if (photoCount >= FREE_PHOTO_LIMIT) {
      Alert.alert('Daily Limit', `You have used all ${FREE_PHOTO_LIMIT} free photo generations today. Come back tomorrow!`);
      return;
    }
    setIsGeneratingPhoto(true);
    setActivePhotoId(template.id);
    console.log('[AIVideo] Generating photo:', template.label);
    try {
      const imageResult = await aiGenerateImage(template.prompt, '1024x1024');
      if (!imageResult) throw new Error('Image generation unavailable');
      const newPhoto: PhotoItem = {
        id: `p_${Date.now()}`,
        label: template.label,
        base64: imageResult.base64Data,
        mimeType: imageResult.mimeType,
        createdAt: new Date().toISOString()};
      const newCount = photoCount + 1;
      setPhotoCount(newCount);
      await AsyncStorage.setItem(PHOTO_DAILY_KEY, JSON.stringify({ date: getTodayKey(), count: newCount }));
      setPhotos(prev => {
        const next = [newPhoto, ...prev].slice(0, 20);
        AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('\u2705 Image Ready!', 'Your 8K photo-realistic image is saved. Scroll down to view & share it.');
    } catch (e) {
      console.error('[AIVideo] Photo gen error:', e);
      Alert.alert('Generation Failed', 'Could not generate image. Please try again.');
    } finally {
      setIsGeneratingPhoto(false);
      setActivePhotoId(null);
    }
  }, [isGeneratingPhoto, photoCount]);

  const shareViaWhatsApp = useCallback(async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const encoded = encodeURIComponent(WHATSAPP_MSG);
    try {
      await Linking.openURL(`https://wa.me/?text=${encoded}`);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
    } catch {
      try {
        if (Platform.OS !== 'web') await Share.share({ message: WHATSAPP_MSG });
        else Alert.alert('WhatsApp', 'Could not open WhatsApp. Make sure it is installed.');
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2500);
      } catch { Alert.alert('Error', 'Could not share.'); }
    }
  }, []);

  const handleUploadVideo = useCallback(async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'web') {
      Alert.alert('Upload Video', 'Video upload is available on the mobile app.');
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Needed', 'Please allow media library access to upload videos.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (!result.canceled && result.assets?.[0]) {
        const videoUri = result.assets[0].uri;
        Alert.alert('Video Selected', 'Share your video now!', [
          { text: 'Share via WhatsApp', onPress: async () => {
            try {
              const avail = await Sharing.isAvailableAsync();
              if (avail) await Sharing.shareAsync(videoUri, { mimeType: 'video/*', dialogTitle: 'Share via WhatsApp' });
              else await Share.share({ message: WHATSAPP_MSG });
              setShareSuccess(true);
              setTimeout(() => setShareSuccess(false), 2500);
            } catch { Alert.alert('Error', 'Could not share video.'); }
          }},
          { text: 'Share More Options', onPress: async () => {
            try {
              const avail = await Sharing.isAvailableAsync();
              if (avail) await Sharing.shareAsync(videoUri, { mimeType: 'video/*' });
              else await Share.share({ message: WHATSAPP_MSG });
            } catch { Alert.alert('Error', 'Could not share.'); }
          }},
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    } catch (e) {
      console.error('[AIVideo] Upload error:', e);
      Alert.alert('Error', 'Could not open video picker.');
    }
  }, []);

  const handleDeletePhoto = useCallback((photoId: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Delete Image', 'Remove this image?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setPhotos(prev => {
          const next = prev.filter(p => p.id !== photoId);
          AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      }},
    ]);
  }, []);

  const handleSharePhotoWhatsApp = useCallback(async (photo: PhotoItem) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'web') {
      const encoded = encodeURIComponent(WHATSAPP_MSG);
      try { await Linking.openURL(`https://wa.me/?text=${encoded}`); } catch { Alert.alert('Error', 'Could not open WhatsApp.'); }
      return;
    }
    try {
      const avail = await Sharing.isAvailableAsync();
      if (avail) {
        await Share.share({ message: WHATSAPP_MSG, title: 'IVXHOLDINGS Photo' });
      } else {
        const encoded = encodeURIComponent(WHATSAPP_MSG);
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      }
    } catch {
      const encoded = encodeURIComponent(WHATSAPP_MSG);
      try { await Linking.openURL(`https://wa.me/?text=${encoded}`); } catch { Alert.alert('Error', 'Could not share.'); }
    }
  }, []);

  const formatTime = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  const totalEstimatedTime = useMemo(() => slides.length * 12, [slides.length]);
  const timelineProgress = useMemo(() => slides.length > 1 ? currentSlide / (slides.length - 1) : 0, [currentSlide, slides.length]);
  const currentSlideData = slides[currentSlide] || null;

  const renderStyleIcon = useCallback((iconName: string, color: string, size: number) => {
    const IconComponent = STYLE_ICON_MAP[iconName];
    if (IconComponent) return <IconComponent size={size} color={color} />;
    return <Briefcase size={size} color={color} />;
  }, []);

  const renderScreenMockup = useCallback((sectionId: string) => {
    const MockupComponent = SCREEN_MOCKUP_MAP[sectionId];
    if (MockupComponent) return <MockupComponent />;
    return null;
  }, []);

  const renderGenerationScreen = () => (
    <View style={styles.genContainer}>
      <View style={styles.heroArea}>
        <View style={styles.heroGlow}>
          <View style={styles.heroIconBox}>
            <Film size={44} color={Colors.primary} />
          </View>
        </View>
        <Text style={styles.heroTitle}>AI Cinematic Presentation</Text>
        <View style={styles.heroBadgeRow}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>8K ULTRA HD</Text>
          </View>
          <View style={[styles.heroBadge, { backgroundColor: '#4A90D920' }]}>
            <Text style={[styles.heroBadgeText, { color: '#4A90D9' }]}>AI VOICE</Text>
          </View>
        </View>
        <Text style={styles.heroDesc}>
          Generate a professional video presentation with AI voice narration, cinematic visuals, and {SECTION_CONFIGS.length} chapters covering every feature.
        </Text>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>PRESENTATION STYLE</Text>
        <View style={styles.styleRow}>
          {STYLE_OPTIONS.map((opt) => {
            const isSelected = selectedStyle === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.styleCard,
                  isSelected && { borderColor: opt.color, backgroundColor: opt.color + '10' },
                ]}
                onPress={() => {
                  setSelectedStyle(opt.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.styleIconWrap, { backgroundColor: opt.color + '18' }]}>
                  {renderStyleIcon(opt.iconName, opt.color, 22)}
                </View>
                <Text style={[styles.styleCardName, isSelected && { color: opt.color }]}>{opt.name}</Text>
                <Text style={styles.styleCardDesc}>{opt.description}</Text>
                {isSelected && <View style={[styles.styleSelectedDot, { backgroundColor: opt.color }]} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>VOICE NARRATION</Text>
        <View style={styles.voiceSettingsRow}>
          <TouchableOpacity
            style={[styles.voiceToggle, voiceEnabled && styles.voiceToggleActive]}
            onPress={() => { setVoiceEnabled((p) => !p); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            activeOpacity={0.7}
          >
            {voiceEnabled ? <Volume2 size={18} color={Colors.primary} /> : <VolumeX size={18} color={Colors.textTertiary} />}
            <Text style={[styles.voiceToggleText, voiceEnabled && { color: Colors.primary }]}>
              {voiceEnabled ? 'Voice ON' : 'Voice OFF'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.speedChip} onPress={cycleSpeed} activeOpacity={0.7}>
            <Gauge size={16} color={Colors.textSecondary} />
            <Text style={styles.speedChipText}>{voiceSpeed}x</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.previewChip} onPress={previewVoice} activeOpacity={0.7}>
            <Play size={14} color={Colors.primary} />
            <Text style={styles.previewChipText}>Preview</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Sparkles size={18} color={Colors.primary} />
          <Text style={styles.statValue}>{SECTION_CONFIGS.length}</Text>
          <Text style={styles.statLabel}>Chapters</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Clock size={18} color={Colors.accent} />
          <Text style={styles.statValue}>~3 min</Text>
          <Text style={styles.statLabel}>Duration</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Film size={18} color={Colors.positive} />
          <Text style={styles.statValue}>8K</Text>
          <Text style={styles.statLabel}>Quality</Text>
        </View>
      </View>

      <View style={styles.featureBlock}>
        <Text style={styles.featureBlockTitle}>What's Included</Text>
        {[
          'AI-generated voice narration for every chapter',
          'Ultra HD cinematic visual mockups',
          'Smooth animated transitions between slides',
          'Professional investor-ready tone',
          'Covers all 340+ platform features',
          '15 comprehensive presentation chapters',
        ].map((text, idx) => (
          <View key={idx} style={styles.featureItem}>
            <CheckCircle2 size={16} color={Colors.positive} />
            <Text style={styles.featureItemText}>{text}</Text>
          </View>
        ))}
      </View>

      {generateMutation.isPending ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressHeader}>
            <Wand2 size={20} color={Colors.primary} />
            <Text style={styles.progressTitle}>Generating 8K Presentation...</Text>
          </View>
          <Text style={styles.progressStep}>{generationStep}</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.round(generationProgress)}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{Math.round(generationProgress)}%</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.generateBtn}
          onPress={() => generateMutation.mutate()}
          activeOpacity={0.8}
        >
          <Film size={22} color={Colors.black} />
          <Text style={styles.generateBtnText}>Generate 8K Presentation</Text>
        </TouchableOpacity>
      )}

      {generateMutation.isError && (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>Generation failed. Please try again.</Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.shareActionsBlock}>
        <Text style={styles.sectionLabel}>SHARE & UPLOAD</Text>
        {shareSuccess && (
          <View style={styles.successToast}>
            <CheckCircle size={16} color="#00C48C" />
            <Text style={styles.successToastText}>Shared successfully!</Text>
          </View>
        )}
        <TouchableOpacity style={styles.waBtn} onPress={shareViaWhatsApp} activeOpacity={0.85}>
          <View style={styles.waBtnIcon}><MessageCircle size={24} color="#fff" /></View>
          <View style={styles.waBtnInfo}>
            <Text style={styles.waBtnTitle}>Share via WhatsApp</Text>
            <Text style={styles.waBtnSub}>Send presentation link to contacts</Text>
          </View>
          <ChevronRight size={18} color="rgba(37,211,102,0.6)" />
        </TouchableOpacity>
        <View style={styles.uploadShareRow}>
          <TouchableOpacity style={styles.uploadBtn} onPress={handleUploadVideo} activeOpacity={0.85}>
            <ArrowUpFromLine size={20} color="#4A90D9" />
            <Text style={styles.uploadBtnLabel}>Upload Video</Text>
            <Text style={styles.uploadBtnHint}>From gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareMoreBtn} onPress={async () => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            try {
              if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
                await navigator.share({ title: 'IVX HOLDINGS', text: WHATSAPP_MSG, url: APP_SHARE_URL });
              } else if (Platform.OS !== 'web') {
                await Share.share({ message: WHATSAPP_MSG, title: 'IVX HOLDINGS Presentation' });
              } else {
                await Clipboard.setStringAsync(WHATSAPP_MSG);
                Alert.alert('Copied', 'Link copied to clipboard.');
              }
              setShareSuccess(true);
              setTimeout(() => setShareSuccess(false), 2500);
            } catch { /* cancelled */ }
          }} activeOpacity={0.85}>
            <Share2 size={20} color="#FFD700" />
            <Text style={styles.shareMoreLabel}>More Options</Text>
            <Text style={styles.uploadBtnHint}>All apps</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.photoStudioBlock}>
        <View style={styles.photoStudioHeader}>
          <Camera size={18} color="#E91E63" />
          <Text style={styles.sectionLabel}>PHOTO REALISTIC STUDIO</Text>
          <View style={styles.photoQuotaBadge}>
            <Text style={[styles.photoQuotaText, photoCount >= FREE_PHOTO_LIMIT && { color: '#FF6B6B' }]}>
              {Math.max(0, FREE_PHOTO_LIMIT - photoCount)}/{FREE_PHOTO_LIMIT}
            </Text>
          </View>
        </View>
        <Text style={styles.photoStudioDesc}>Generate stunning 8K photorealistic real estate images using AI</Text>
        {isGeneratingPhoto && (
          <View style={styles.photoGeneratingBanner}>
            <ShimmerIndicator size="small" color="#FFD700" />
            <Text style={styles.photoGeneratingText}>Generating 8K image... (10–30 sec)</Text>
          </View>
        )}
        <View style={styles.photoTemplateGrid}>
          {PHOTO_TEMPLATES.map(t => {
            const isActive = activePhotoId === t.id;
            const disabled = isGeneratingPhoto || photoCount >= FREE_PHOTO_LIMIT;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.photoTemplateCard, { borderColor: t.color + '30' }, isActive && { borderColor: t.color, backgroundColor: t.color + '12' }, disabled && { opacity: 0.4 }]}
                onPress={() => handleGeneratePhoto(t)}
                disabled={disabled}
                activeOpacity={0.7}
              >
                <View style={[styles.photoTemplateIcon, { backgroundColor: t.color + '15' }]}>
                  {isActive ? <ShimmerIndicator size="small" color={t.color} /> : <Camera size={16} color={t.color} />}
                </View>
                <View style={styles.photoTemplateInfo}>
                  <Text style={styles.photoTemplateLabel}>{t.label}</Text>
                  <Text style={styles.photoTemplateSub}>Tap to generate</Text>
                </View>
                <Sparkles size={14} color={t.color} />
              </TouchableOpacity>
            );
          })}
        </View>
        {photos.length > 0 && (
          <View style={styles.photoGallery}>
            <View style={styles.photoGalleryHeader}>
              <ImageIcon size={16} color="#FFD700" />
              <Text style={styles.photoGalleryTitle}>My Gallery ({photos.length})</Text>
            </View>
            {photos.map(photo => (
              <View key={photo.id} style={styles.photoCard}>
                <Image source={{ uri: `data:${photo.mimeType};base64,${photo.base64}` }} style={styles.photoCardImage} resizeMode="cover" />
                <View style={styles.photoCardInfo}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.photoCardLabel}>{photo.label}</Text>
                    <Text style={styles.photoCardDate}>{new Date(photo.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <View style={styles.photoCardActions}>
                    <TouchableOpacity style={styles.photoActionBtn} onPress={() => handleSharePhotoWhatsApp(photo)} activeOpacity={0.7}>
                      <MessageCircle size={16} color="#25D366" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.photoActionBtn, { backgroundColor: 'rgba(255,77,77,0.08)' }]} onPress={() => handleDeletePhoto(photo.id)} activeOpacity={0.7}>
                      <Trash2 size={14} color="#FF4D4D" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );

  const renderWaveform = () => (
    <View style={styles.waveformRow}>
      {waveBarAnims.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              backgroundColor: currentSlideData?.themeColor || Colors.primary,
              transform: [{ scaleY: bar }]},
          ]}
        />
      ))}
    </View>
  );

  const renderPlayer = () => {
    if (!currentSlideData) return null;

    return (
      <View style={[styles.playerWrap, isFullscreen && styles.playerFullscreen]}>
        <View style={styles.storyProgress}>
          {slides.map((_, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.storyBar,
                idx === currentSlide && styles.storyBarActive,
                idx < currentSlide && styles.storyBarDone,
              ]}
              onPress={() => { if (!isPlaying) goToSlide(idx); }}
            />
          ))}
        </View>

        <Animated.View style={[styles.slideCard, { opacity: fadeAnim }]}>
          <View style={styles.mockupWrap}>
            <Animated.View style={{ transform: [{ scale: imageScaleAnim }] }}>
              {renderScreenMockup(currentSlideData.id)}
            </Animated.View>
            <View style={styles.mockupOverlayGradient} />
            <View style={styles.qualityBadge}>
              <Text style={styles.qualityBadgeText}>8K ULTRA HD</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE RENDER</Text>
            </View>
          </View>

          {currentSlideData.screenFeatures.length > 0 && (
            <View style={styles.featuresStrip}>
              {currentSlideData.screenFeatures.map((feat, idx) => (
                <View key={idx} style={[styles.featureTag, { backgroundColor: currentSlideData.themeColor + '12', borderColor: currentSlideData.themeColor + '25' }]}>
                  <Text style={[styles.featureTagText, { color: currentSlideData.themeColor }]}>{feat}</Text>
                </View>
              ))}
            </View>
          )}

          <Animated.View style={[styles.slideContent, { transform: [{ translateY: textSlideAnim }] }]}>
            <View style={styles.slideTitleRow}>
              <Text style={styles.slideEmoji}>{currentSlideData.icon}</Text>
              <View style={styles.slideTitleCol}>
                <Text style={styles.slideTitle}>{currentSlideData.title}</Text>
                <Text style={[styles.slideSubtitle, { color: currentSlideData.themeColor }]}>{currentSlideData.subtitle}</Text>
              </View>
              <View style={[styles.slideCounter, { backgroundColor: currentSlideData.themeColor + '15' }]}>
                <Text style={[styles.slideCounterText, { color: currentSlideData.themeColor }]}>
                  {currentSlide + 1}/{slides.length}
                </Text>
              </View>
            </View>

            <View style={[styles.narrationBox, { borderLeftColor: currentSlideData.themeColor }]}>
              <Text style={styles.narrationText}>{currentSlideData.narration}</Text>
            </View>

            {isSpeaking && (
              <View style={styles.speakingRow}>
                {renderWaveform()}
                <Text style={[styles.speakingLabel, { color: currentSlideData.themeColor }]}>Narrating...</Text>
              </View>
            )}

            <View style={styles.bulletsWrap}>
              {currentSlideData.bulletPoints.map((bp, idx) => (
                <View key={idx} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: currentSlideData.themeColor }]} />
                  <Text style={styles.bulletText}>{bp}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </Animated.View>

        <View style={styles.timelineRow}>
          <Text style={styles.timeText}>{formatTime(elapsedSeconds)}</Text>
          <View style={styles.timelineBarBg}>
            <View style={[styles.timelineBarFill, { width: `${timelineProgress * 100}%`, backgroundColor: currentSlideData.themeColor }]} />
          </View>
          <Text style={styles.timeText}>{formatTime(totalEstimatedTime)}</Text>
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={prevSlide} disabled={currentSlide === 0}>
            <SkipBack size={22} color={currentSlide === 0 ? Colors.textTertiary : Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.playBtn, { backgroundColor: currentSlideData.themeColor }]}
            onPress={togglePlay}
          >
            {isPlaying ? <Pause size={30} color={Colors.black} /> : <Play size={30} color={Colors.black} style={{ marginLeft: 3 }} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={nextSlide} disabled={currentSlide >= slides.length - 1}>
            <SkipForward size={22} color={currentSlide >= slides.length - 1 ? Colors.textTertiary : Colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity style={[styles.quickAction, voiceEnabled && styles.quickActionActive]} onPress={toggleVoice}>
            {voiceEnabled ? <Volume2 size={16} color={Colors.primary} /> : <VolumeX size={16} color={Colors.textTertiary} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={cycleSpeed}>
            <Text style={styles.quickActionSpeedText}>{voiceSpeed}x</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => { setIsPlaying(false); Speech.stop().catch(() => {}); setIsSpeaking(false); setIsFullscreen((p) => !p); }}>
            {isFullscreen ? <Minimize2 size={16} color={Colors.text} /> : <Maximize2 size={16} color={Colors.text} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => {
              setIsPlaying(false);
              Speech.stop().catch(() => {});
              setIsSpeaking(false);
              setSlides([]);
              setCurrentSlide(0);
              setGenerationProgress(0);
              setElapsedSeconds(0);
            }}
          >
            <RefreshCw size={16} color={Colors.text} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderChapterList = () => (
    <View style={styles.chapterSection}>
      <Text style={styles.chapterSectionTitle}>Chapters</Text>
      {slides.map((slide, idx) => {
        const isActive = idx === currentSlide;
        const isDone = idx < currentSlide;
        return (
          <TouchableOpacity
            key={slide.id}
            style={[styles.chapterItem, isActive && styles.chapterItemActive]}
            onPress={() => { if (!isPlaying) { goToSlide(idx); scrollRef.current?.scrollTo({ y: 0, animated: true }); } }}
            activeOpacity={0.7}
          >
            <View style={[styles.chapterNum, { backgroundColor: isActive ? slide.themeColor + '25' : isDone ? Colors.positive + '15' : Colors.backgroundTertiary }]}>
              {isDone ? (
                <CheckCircle2 size={14} color={Colors.positive} />
              ) : (
                <Text style={[styles.chapterNumText, isActive && { color: slide.themeColor }]}>{idx + 1}</Text>
              )}
            </View>
            <View style={styles.chapterInfo}>
              <Text style={styles.chapterName}>{slide.icon} {slide.title}</Text>
              <Text style={styles.chapterSub}>{slide.subtitle}</Text>
            </View>
            {isActive && (
              <View style={[styles.nowBadge, { backgroundColor: slide.themeColor + '20' }]}>
                <Text style={[styles.nowBadgeText, { color: slide.themeColor }]}>{isPlaying ? 'LIVE' : 'NOW'}</Text>
              </View>
            )}
            <ChevronRight size={14} color={Colors.textTertiary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { Speech.stop().catch(() => {}); router.back(); }}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>AI Presentation Studio</Text>
          <Text style={styles.headerSub}>8K Cinematic • AI Voice</Text>
        </View>
        <View style={styles.headerBadge}>
          <Sparkles size={13} color={Colors.primary} />
          <Text style={styles.headerBadgeText}>AI</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {slides.length === 0 ? renderGenerationScreen() : (
          <>
            {renderPlayer()}
            {!isFullscreen && renderChapterList()}
          </>
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  headerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  headerBadgeText: { color: Colors.black, fontSize: 11, fontWeight: '700' as const },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 140 },
  bottomPad: { height: 120 },
  genContainer: { gap: 8 },
  heroArea: { gap: 4 },
  heroGlow: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary + '10' },
  heroIconBox: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  heroBadgeText: { fontSize: 11, fontWeight: '700' as const },
  heroDesc: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  sectionBlock: { gap: 4 },
  sectionLabel: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  styleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  styleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  styleIconWrap: { gap: 4 },
  styleCardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  styleCardDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  styleSelectedDot: { width: 8, height: 8, borderRadius: 4 },
  voiceSettingsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceToggle: { gap: 4 },
  voiceToggleActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  voiceToggleText: { color: Colors.textSecondary, fontSize: 13 },
  speedChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  speedChipText: { color: Colors.textSecondary, fontSize: 13 },
  previewChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  previewChipText: { color: Colors.textSecondary, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  featureBlock: { gap: 4 },
  featureBlockTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  featureItemText: { color: Colors.textSecondary, fontSize: 13 },
  generateBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  progressBlock: { gap: 4 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  progressStep: { gap: 4 },
  progressBarBg: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  progressPercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { color: Colors.textSecondary, fontSize: 13 },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 20 },

  shareActionsBlock: { gap: 12 },
  successToast: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,196,140,0.1)', borderWidth: 1, borderColor: 'rgba(0,196,140,0.2)', paddingVertical: 10, borderRadius: 12 },
  successToastText: { fontSize: 13, fontWeight: '700' as const, color: '#00C48C' },
  waBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#25D366', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  waBtnIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  waBtnInfo: { flex: 1, gap: 2 },
  waBtnTitle: { fontSize: 16, fontWeight: '900' as const, color: '#fff' },
  waBtnSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  uploadShareRow: { flexDirection: 'row', gap: 10 },
  uploadBtn: { flex: 1, backgroundColor: 'rgba(74,144,217,0.08)', borderWidth: 1.5, borderColor: 'rgba(74,144,217,0.25)', borderRadius: 14, paddingVertical: 16, alignItems: 'center', gap: 5 },
  uploadBtnLabel: { fontSize: 13, fontWeight: '800' as const, color: '#4A90D9' },
  uploadBtnHint: { fontSize: 10, color: Colors.textTertiary },
  shareMoreBtn: { flex: 1, backgroundColor: 'rgba(255,215,0,0.06)', borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.2)', borderRadius: 14, paddingVertical: 16, alignItems: 'center', gap: 5 },
  shareMoreLabel: { fontSize: 13, fontWeight: '800' as const, color: '#FFD700' },

  photoStudioBlock: { gap: 12 },
  photoStudioHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoStudioDesc: { fontSize: 13, color: Colors.textTertiary, lineHeight: 18, marginBottom: 4 },
  photoQuotaBadge: { marginLeft: 'auto' as const, backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)' },
  photoQuotaText: { fontSize: 12, fontWeight: '800' as const, color: '#FFD700' },
  photoGeneratingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, backgroundColor: 'rgba(255,215,0,0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,215,0,0.1)' },
  photoGeneratingText: { fontSize: 13, fontWeight: '600' as const, color: '#FFD700' },
  photoTemplateGrid: { gap: 8 },
  photoTemplateCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  photoTemplateIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  photoTemplateInfo: { flex: 1 },
  photoTemplateLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  photoTemplateSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },

  photoGallery: { gap: 10, marginTop: 4 },
  photoGalleryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoGalleryTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  photoCard: { borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  photoCardImage: { width: '100%', height: 200, backgroundColor: '#111' },
  photoCardInfo: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  photoCardLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  photoCardDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  photoCardActions: { flexDirection: 'row', gap: 8 },
  photoActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(37,211,102,0.1)', justifyContent: 'center', alignItems: 'center' },
  playerWrap: { gap: 4 },
  playerFullscreen: { flex: 1 },
  storyProgress: { gap: 4 },
  storyBar: { gap: 4 },
  storyBarActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  storyBarDone: { gap: 4 },
  slideCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  imageWrap: { gap: 4 },
  slideImage: { width: '100%', height: 180, borderRadius: 12 },
  imageGradientOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  qualityBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  qualityBadgeText: { fontSize: 11, fontWeight: '700' as const },
  mockupWrap: { gap: 4 },
  mockupOverlayGradient: { gap: 4 },
  liveBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveBadgeText: { fontSize: 11, fontWeight: '700' as const },
  featuresStrip: { gap: 4 },
  featureTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  featureTagText: { color: Colors.textSecondary, fontSize: 13 },
  imagePlaceholder: { gap: 4 },
  placeholderIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  placeholderGlow: { gap: 4 },
  slideContent: { flex: 1, gap: 4 },
  slideTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slideEmoji: { gap: 4 },
  slideTitleCol: { gap: 4 },
  slideTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  slideSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  slideCounter: { gap: 4 },
  slideCounterText: { color: Colors.textSecondary, fontSize: 13 },
  narrationBox: { gap: 4 },
  narrationText: { color: Colors.textSecondary, fontSize: 13 },
  speakingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waveformRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waveBar: { gap: 4 },
  speakingLabel: { color: Colors.textSecondary, fontSize: 13 },
  bulletsWrap: { gap: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletDot: { width: 8, height: 8, borderRadius: 4 },
  bulletText: { color: Colors.textSecondary, fontSize: 13 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeText: { color: Colors.textSecondary, fontSize: 13 },
  timelineBarBg: { gap: 4 },
  timelineBarFill: { gap: 4 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  playBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickAction: { gap: 4 },
  quickActionActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  quickActionSpeedText: { color: Colors.textSecondary, fontSize: 13 },
  chapterSection: { marginBottom: 16 },
  chapterSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  chapterItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  chapterItemActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  chapterNum: { gap: 4 },
  chapterNumText: { color: Colors.textSecondary, fontSize: 13 },
  chapterInfo: { flex: 1 },
  chapterName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  chapterSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  nowBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  nowBadgeText: { fontSize: 11, fontWeight: '700' as const }});
