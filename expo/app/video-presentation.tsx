import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform,
  Easing,
  Alert,
  Share,
  Image,
  Linking} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system legacy removed - using web APIs instead
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ArrowLeft,
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ChevronRight,
  Film,
  Sparkles,
  Camera,
  Share2,
  MessageCircle,
  Mail,
  Copy,
  CheckCircle,
  ExternalLink,
  ArrowDownToLine,
  ArrowUpFromLine,
  Zap,
  Clock,
  Trash2,
  Image as ImageIcon,
  RefreshCw} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { SCREEN_MOCKUP_MAP } from '@/components/ScreenMockups';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');
const SPEED_FACTOR = 0.35;
const FREE_DAILY_LIMIT = 5;
const STORAGE_KEY_VIEWS = 'ipx_video_daily_views';
const STORAGE_KEY_IMAGES = 'ipx_pres_gen_images';
const STORAGE_KEY_UPLOADS = 'ipx_pres_uploads';
const APP_SHARE_URL = 'https://ivxholding.com/presentation';

const SHARE_MESSAGE =
  '\uD83C\uDFAC Check out the IVX HOLDINGS presentation! The future of real estate investing \u2014 AI-powered, fractional ownership from $10. 340+ features built & live.\n\n' +
  APP_SHARE_URL;

interface UploadedFile {
  id: string;
  label: string;
  uri: string;
  base64?: string;
  mimeType: string;
  mediaType: 'image' | 'video';
  uploadedAt: string;
}

interface GeneratedImage {
  id: string;
  label: string;
  base64: string;
  mimeType: string;
  createdAt: string;
}

interface PhotoTemplate {
  id: string;
  label: string;
  prompt: string;
  color: string;
}

interface SlideConfig {
  id: string;
  type: 'hero' | 'feature' | 'comparison' | 'pain' | 'stats' | 'construction' | 'ecosystem' | 'closing';
  title: string;
  subtitle?: string;
  accentColor: string;
  duration: number;
  featureValue?: string;
  featureDesc?: string[];
  mockupKey?: string;
}

interface DailyViewData {
  date: string;
  count: number;
}

const PHOTO_TEMPLATES: PhotoTemplate[] = [
  {
    id: 'luxury-tower',
    label: 'Luxury Tower 8K',
    prompt:
      'Photorealistic architectural rendering of a modern luxury residential skyscraper, 40 floors, glass and steel facade, rooftop infinity pool, lush landscaped ground level with palm trees, golden hour lighting, drone aerial perspective, 8K ultra-realistic quality, real estate marketing photo',
    color: '#FFD700'},
  {
    id: 'beachfront-villa',
    label: 'Beachfront Villa 8K',
    prompt:
      'Stunning photorealistic image of a modern beachfront luxury villa with infinity pool overlooking the ocean, white architecture with large glass windows, tropical landscaping, sunset sky with warm colors reflecting on the water, professional architectural photography, 8K ultra-realistic',
    color: '#4A90D9'},
  {
    id: 'penthouse',
    label: 'Penthouse Interior 8K',
    prompt:
      'Photorealistic interior of an ultra-luxury penthouse apartment, floor-to-ceiling windows with panoramic city skyline view at night, modern minimalist design, marble floors, designer furniture, warm ambient lighting, open concept living space, professional real estate photography, 8K quality',
    color: '#E91E63'},
  {
    id: 'construction-site',
    label: 'Under Construction 8K',
    prompt:
      'Ultra-realistic photo of a luxury high-rise residential building under construction, construction cranes, scaffolding, concrete floors being poured, blue sky background, city skyline visible, golden sunlight, professional real estate development photography, 8K quality',
    color: '#FF6B35'},
  {
    id: 'smart-city',
    label: 'Smart City 8K',
    prompt:
      'Futuristic photorealistic rendering of a smart city mixed-use development block, interconnected modern buildings with LED facades, autonomous vehicle lanes, elevated walkways with gardens, holographic signage, sunset lighting, professional architectural visualization, 8K ultra-realistic quality',
    color: '#7C4DFF'},
  {
    id: 'investment-dash',
    label: 'Investment Dashboard 8K',
    prompt:
      'Photorealistic image of a sleek modern desk with large curved monitor and smartphone both displaying real estate portfolio charts with green profit indicators, dark mode interface with gold accents, ambient LED desk lighting, modern office with city skyline view at golden hour, professional product photography, 8K ultra-realistic',
    color: '#00C48C'},
  {
    id: 'vip-luxury',
    label: 'VIP Experience 8K',
    prompt:
      'Photorealistic image of a luxury VIP lounge scene with a golden membership card on polished dark marble table, champagne glass nearby, smartphone showing exclusive premium real estate deals, dramatic low-key lighting with gold accents, velvet textures, premium luxury lifestyle photography, 8K ultra-realistic',
    color: '#C0392B'},
  {
    id: 'global-skylines',
    label: 'Global Real Estate 8K',
    prompt:
      'Photorealistic aerial view of iconic global city skylines seamlessly blended together - New York, Dubai, London, Singapore, Tokyo - with golden connecting light paths between them, a translucent globe hologram in the center with property pin markers, dramatic sunset sky, ultra-wide cinematic composition, 8K quality',
    color: '#16A085'},
];

const SLIDE_IMAGES: Record<string, string> = {
  hero: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80',
  solution: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80',
  listing: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80',
  kyc: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80',
  invest10: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
  liquidity: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
  'ai-power': 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80',
  construction: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80',
  marketplace: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
  portfolio: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=800&q=80',
  wallet: 'https://images.unsplash.com/photo-1554469384-e58fac16e23a?w=800&q=80',
  closing: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80',
  foundation: 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&q=80',
  ecosystem: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80',
  stats: 'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=800&q=80',
  problem: 'https://images.unsplash.com/photo-1494526585095-c41746248156?w=800&q=80',
  comparison: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
  viral: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80'};

const COMPARISON_DATA = [
  { traditional: 'List property in 30-60 days', ipx: 'List in 2 minutes with AI' },
  { traditional: 'KYC takes 3-7 days', ipx: 'KYC in 60 seconds' },
  { traditional: 'Need $50K+ minimum to invest', ipx: 'Start with $10' },
  { traditional: 'Money locked for years', ipx: 'Sell shares daily' },
  { traditional: 'Need a broker, lawyer, agent', ipx: 'AI handles everything' },
  { traditional: 'No transparency on returns', ipx: 'AI Trust Score + live data' },
  { traditional: 'Manual property management', ipx: 'AI manages everything' },
  { traditional: 'Word-of-mouth growth', ipx: 'Viral copy-investing + influencer AI engine' },
];

const STATS_DATA = [
  { label: 'Global RE Market', value: 326, prefix: '$', suffix: 'T', color: '#FFD700', barPct: 95 },
  { label: 'Avg Annual Return', value: 9.8, prefix: '', suffix: '%', color: '#00C48C', barPct: 78 },
  { label: 'Millionaires via RE', value: 90, prefix: '', suffix: '%', color: '#4A90D9', barPct: 90 },
  { label: 'Monthly Growth', value: 32, prefix: '+', suffix: '%', color: '#E91E63', barPct: 65 },
];

const ECO_ITEMS = [
  { text: 'Property owners list & earn in 2 steps', color: '#FFD700' },
  { text: 'Private lenders grow wealth passively', color: '#4A90D9' },
  { text: 'Regular people invest from just $10', color: '#00C48C' },
  { text: 'Influencers earn commissions automatically', color: '#E91E63' },
  { text: 'Realtors expand their network & income', color: '#9B59B6' },
  { text: 'AI removes every friction point', color: '#FF6B35' },
];

const PAIN_POINTS = [
  'Listing takes 30-60 days',
  'KYC verification: 3-7 days',
  '$50K+ minimum investment',
  'Money locked for years',
  'Need broker, lawyer, agent',
  'Zero transparency on returns',
  'Manual property management',
  'Slow word-of-mouth growth',
];

const FLOOR_COLORS = [
  'rgba(255, 107, 53, 1)',
  'rgba(255, 120, 64, 0.95)',
  'rgba(255, 133, 75, 0.9)',
  'rgba(255, 146, 86, 0.8)',
  'rgba(255, 159, 97, 0.65)',
  'rgba(255, 172, 108, 0.45)',
];

const SLIDES: SlideConfig[] = [
  { id: 'hero', type: 'hero', title: 'IVXHOLDINGS HOLDING', subtitle: 'The Future of Real Estate Investment', accentColor: '#FFD700', duration: 5000 },
  { id: 'problem', type: 'pain', title: 'Traditional Real Estate\nis Broken', accentColor: '#FF4D4D', duration: 6500 },
  { id: 'solution', type: 'hero', title: 'IVXHOLDINGS + AI\nChanges Everything', subtitle: 'Crushing every barrier with artificial intelligence', accentColor: '#00C48C', duration: 4500 },
  { id: 'comparison', type: 'comparison', title: 'Why This Crushes\nTraditional Real Estate', accentColor: '#FFD700', duration: 8000 },
  { id: 'listing', type: 'feature', title: 'AI-Powered Listing', subtitle: 'Replace the 30-60 day process', accentColor: '#4A90D9', duration: 5500, featureValue: '2 min', featureDesc: ['AI scans & structures data', 'Auto-generates listing', 'Instant market placement'], mockupKey: 'marketplace' },
  { id: 'kyc', type: 'feature', title: 'Instant Verification', subtitle: 'AI document scanning & biometrics', accentColor: '#9B59B6', duration: 5500, featureValue: '60 sec', featureDesc: ['Camera ID / passport scan', 'AI data extraction', 'Real-time verification'], mockupKey: 'onboarding' },
  { id: 'invest10', type: 'feature', title: 'Invest for Everyone', subtitle: 'No more $50K minimum barriers', accentColor: '#00C48C', duration: 5500, featureValue: '$10', featureDesc: ['Fractional ownership', 'Instant diversification', 'Zero lock-up period'], mockupKey: 'trading' },
  { id: 'liquidity', type: 'feature', title: 'Daily Liquidity', subtitle: 'Your money is never locked again', accentColor: '#FFB800', duration: 5500, featureValue: '24/7', featureDesc: ['Sell shares anytime', 'Instant settlement', 'No penalties or fees'], mockupKey: 'wallet' },
  { id: 'ai-power', type: 'feature', title: 'AI Does It All', subtitle: 'No broker. No lawyer. No agent.', accentColor: '#E91E63', duration: 5500, featureValue: 'AI', featureDesc: ['Smart contract automation', 'Full property management', 'Trust Score + live data'], mockupKey: 'ai' },
  { id: 'construction', type: 'construction', title: 'Development Investing', subtitle: 'Invest in properties under construction.\nWatch your investment grow floor by floor.', accentColor: '#FF6B35', duration: 7000 },
  { id: 'marketplace', type: 'feature', title: 'Property Marketplace', subtitle: 'Browse, search, filter & compare', accentColor: '#1ABC9C', duration: 5000, featureValue: '25+', featureDesc: ['Advanced search & filters', 'Side-by-side comparison', 'Interactive price charts'], mockupKey: 'marketplace' },
  { id: 'portfolio', type: 'feature', title: 'Portfolio Dashboard', subtitle: 'Real-time tracking of investments', accentColor: '#3498DB', duration: 5000, featureValue: '20+', featureDesc: ['Live gains & losses', 'Allocation view', 'Performance vs benchmark'], mockupKey: 'portfolio' },
  { id: 'wallet', type: 'feature', title: 'Wallet & Payments', subtitle: 'Fund your account in seconds', accentColor: '#2ECC71', duration: 5000, featureValue: '28', featureDesc: ['Bank ACH & wire transfers', 'Credit & debit cards', 'Instant deposits'], mockupKey: 'wallet' },
  { id: 'viral', type: 'feature', title: 'Viral Growth Engine', subtitle: 'Organic growth that scales itself', accentColor: '#7C4DFF', duration: 5500, featureValue: '10x', featureDesc: ['Copy top investors', 'Influencer AI engine', 'Tiered referral rewards'], mockupKey: 'growth' },
  { id: 'stats', type: 'stats', title: '340+ Features Built', accentColor: '#FFD700', duration: 6000 },
  { id: 'ecosystem', type: 'ecosystem', title: 'Self-Growing\nEcosystem', subtitle: 'Every user attracts more users.\nEvery property attracts more investors.\nAI removes every friction point.', accentColor: '#00C48C', duration: 5500 },
  { id: 'foundation', type: 'hero', title: '340+ Features\nBuilt & Live', subtitle: 'Marketplace \u00B7 Wallet \u00B7 AI Chat \u00B7 Portfolio \u00B7 KYC \u00B7 Copy Investing \u00B7 VIP \u00B7 Referrals \u00B7 Admin \u2014 everything ready.', accentColor: '#FFD700', duration: 5500 },
  { id: 'closing', type: 'closing', title: 'Join the\nRevolution', subtitle: 'Start investing in real estate today.\nFree to download. Start from $10.', accentColor: '#FFD700', duration: 6000 },
];

const getTodayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDailyViews = async (): Promise<DailyViewData> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_VIEWS);
    if (stored) {
      const parsed: DailyViewData = JSON.parse(stored);
      if (parsed.date === getTodayKey()) return parsed;
    }
  } catch (e) {
    console.log('[VideoPresentation] Error reading daily views:', e);
  }
  return { date: getTodayKey(), count: 0 };
};

const incrementDailyView = async (): Promise<DailyViewData> => {
  const current = await getDailyViews();
  const updated: DailyViewData = { date: getTodayKey(), count: current.count + 1 };
  try {
    await AsyncStorage.setItem(STORAGE_KEY_VIEWS, JSON.stringify(updated));
  } catch (e) {
    console.log('[VideoPresentation] Error saving daily views:', e);
  }
  return updated;
};

const loadUploadedFiles = async (): Promise<UploadedFile[]> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_UPLOADS);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[VideoPresentation] Error loading uploads:', e);
  }
  return [];
};

const saveUploadedFiles = async (files: UploadedFile[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_UPLOADS, JSON.stringify(files.slice(0, 10)));
  } catch (e) {
    console.log('[VideoPresentation] Error saving uploads:', e);
  }
};

const loadSavedImages = async (): Promise<GeneratedImage[]> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_IMAGES);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[VideoPresentation] Error loading images:', e);
  }
  return [];
};

const saveImagesToStorage = async (images: GeneratedImage[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(images.slice(0, 20)));
  } catch (e) {
    console.log('[VideoPresentation] Error saving images:', e);
  }
};

function ProgressSegments({ total, current, progress, onPress, accentColor }: {
  total: number; current: number; progress: Animated.Value; onPress: (idx: number) => void; accentColor: string;
}) {
  return (
    <View style={styles.progressBar}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < current;
        const isActive = i === current;
        const fillWidth = isActive
          ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
          : filled ? '100%' : '0%';
        return (
          <TouchableOpacity key={i} style={styles.progressSegment} onPress={() => onPress(i)} activeOpacity={0.7}>
            <View style={styles.progressSegmentBg}>
              <Animated.View style={[styles.progressSegmentFill, { width: fillWidth, backgroundColor: accentColor }]} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function VideoPresentationScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [mode, setMode] = useState<'hub' | 'presentation'>('hub');
  const [presentationStyle, setPresentationStyle] = useState<'investor' | 'product'>('investor');

  useEffect(() => {
    console.log('[VideoPresentation] v5 loaded - Investor Pitch + Product Demo style selector');
    console.log('[VideoPresentation] Platform:', Platform.OS);
    console.log('[VideoPresentation] Templates:', PHOTO_TEMPLATES.length);
  }, []);

  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [dailyViews, setDailyViews] = useState<DailyViewData>({ date: getTodayKey(), count: 0 });
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [statCounters, setStatCounters] = useState<number[]>([0, 0, 0, 0]);
  const [constructionPct, setConstructionPct] = useState(0);

  const hubFadeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;
  const heroScaleAnim = useRef(new Animated.Value(0.5)).current;
  const itemAnims = useRef(Array.from({ length: 10 }, () => new Animated.Value(0))).current;
  const extraAnim = useRef(new Animated.Value(0)).current;
  const barAnims = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const closingPulseAnim = useRef(new Animated.Value(1)).current;
  const slideProgress = useRef(new Animated.Value(0)).current;
  const accentLineAnim = useRef(new Animated.Value(0)).current;
  const badgeAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const loopRefs = useRef<Animated.CompositeAnimation[]>([]);
  const counterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const constCounterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLimitReached = useMemo(() => dailyViews.count >= FREE_DAILY_LIMIT, [dailyViews]);
  const remaining = useMemo(() => Math.max(0, FREE_DAILY_LIMIT - dailyViews.count), [dailyViews]);
  const slide = SLIDES[currentSlide] ?? SLIDES[0];
  const totalSlides = SLIDES.length;

  useEffect(() => {
    getDailyViews().then(setDailyViews);
    loadSavedImages().then(setGeneratedImages);
    loadUploadedFiles().then(setUploadedFiles);
    Animated.timing(hubFadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const shareViaWhatsApp = useCallback(async () => {
    triggerHaptic();
    const encoded = encodeURIComponent(SHARE_MESSAGE);
    const waUrl = `https://wa.me/?text=${encoded}`;
    try {
      await Linking.openURL(waUrl);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
      console.log('[VideoPresentation] Shared via WhatsApp');
    } catch (e) {
      console.log('[VideoPresentation] WhatsApp error:', e);
      try {
        if (Platform.OS !== 'web') {
          await Share.share({ message: SHARE_MESSAGE });
          setShareSuccess(true);
          setTimeout(() => setShareSuccess(false), 2500);
        } else {
          Alert.alert('WhatsApp', 'Could not open WhatsApp. Make sure it is installed.');
        }
      } catch {
        Alert.alert('Share Error', 'Could not share. Please try again.');
      }
    }
  }, [triggerHaptic]);

  const shareViaEmail = useCallback(async () => {
    triggerHaptic();
    const subject = encodeURIComponent('IVX HOLDINGS \u2014 AI Real Estate Platform Presentation');
    const body = encodeURIComponent(SHARE_MESSAGE);
    try {
      await Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
    } catch {
      try {
        if (Platform.OS !== 'web') await Share.share({ message: SHARE_MESSAGE });
        else Alert.alert('Email', 'Could not open email client.');
      } catch {
        Alert.alert('Email', 'Could not open email client.');
      }
    }
  }, [triggerHaptic]);

  const copyShareLink = useCallback(async () => {
    triggerHaptic();
    await Clipboard.setStringAsync(SHARE_MESSAGE);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    console.log('[VideoPresentation] Link copied');
  }, [triggerHaptic]);

  const openNativeShare = useCallback(async () => {
    triggerHaptic();
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: 'IVX HOLDINGS Presentation', text: SHARE_MESSAGE, url: APP_SHARE_URL });
        } else {
          await Clipboard.setStringAsync(SHARE_MESSAGE);
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2000);
        }
      } else {
        await Share.share({ message: SHARE_MESSAGE, title: 'IVX HOLDINGS Presentation' });
      }
    } catch (e) {
      console.log('[VideoPresentation] Native share error:', e);
    }
  }, [triggerHaptic]);

  const handleGenerate = useCallback(async (template: PhotoTemplate) => {
    if (isGenerating) return;
    if (isLimitReached) {
      Alert.alert('Daily Limit', 'You have used all 5 free generations today. Come back tomorrow!');
      return;
    }
    triggerHaptic();
    setIsGenerating(true);
    setActiveTemplateId(template.id);
    console.log('[VideoPresentation] Generating:', template.label);

    try {
      const { generateImage: aiGenImage } = await import('@/lib/ai-service');
      const imgResult = await aiGenImage(template.prompt, '1024x1024');
      if (!imgResult) throw new Error('Image generation unavailable');
      console.log('[VideoPresentation] Image generated successfully');

      const newImage: GeneratedImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        label: template.label,
        base64: imgResult.base64Data,
        mimeType: imgResult.mimeType,
        createdAt: new Date().toISOString()};
      const updated = await incrementDailyView();
      setDailyViews(updated);
      setGeneratedImages(prev => {
        const next = [newImage, ...prev];
        saveImagesToStorage(next);
        return next;
      });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Image Ready!', 'Your 8K photo-realistic image is ready. Scroll down to view, download or share it.');
    } catch (error) {
      console.error('[VideoPresentation] Generation error:', error);
      Alert.alert('Generation Failed', 'Could not generate image. Please try again.');
    } finally {
      setIsGenerating(false);
      setActiveTemplateId(null);
    }
  }, [isGenerating, isLimitReached, triggerHaptic]);

  const handleDownloadImage = useCallback(async (image: GeneratedImage) => {
    triggerHaptic();
    console.log('[VideoPresentation] Downloading image:', image.label);

    if (Platform.OS === 'web') {
      try {
        const link = document.createElement('a');
        link.href = `data:${image.mimeType};base64,${image.base64}`;
        link.download = `ipx-8k-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Alert.alert('Downloaded', 'Image downloaded to your device.');
      } catch {
        await Clipboard.setStringAsync(SHARE_MESSAGE);
        Alert.alert('Copied', 'Share link copied to clipboard.');
      }
      return;
    }

    try {
      await Share.share({ message: SHARE_MESSAGE, title: 'IVXHOLDINGS 8K Photo' });
    } catch (e) {
      console.error('[VideoPresentation] Download error:', e);
      try {
        await Share.share({ message: SHARE_MESSAGE, title: 'IVXHOLDINGS 8K Image' });
      } catch {
        Alert.alert('Download Error', 'Could not save image. Please try again.');
      }
    }
  }, [triggerHaptic]);

  const handleShareImageWhatsApp = useCallback(async (image: GeneratedImage) => {
    triggerHaptic();
    const waText = '\uD83C\uDFAC Check out this 8K IVXHOLDINGS real estate render!\n\n' + APP_SHARE_URL;
    console.log('[VideoPresentation] Share image platform:', Platform.OS);
    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          const byteChars = atob(image.base64);
          const byteNums = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
          const byteArr = new Uint8Array(byteNums);
          const blob = new Blob([byteArr], { type: image.mimeType });
          const fileObj = new File([blob], `ipx-8k-${Date.now()}.png`, { type: image.mimeType });
          if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
            await navigator.share({ files: [fileObj], title: 'IVXHOLDINGS 8K Image', text: waText });
            setShareSuccess(true);
            setTimeout(() => setShareSuccess(false), 2500);
            return;
          }
          await navigator.share({ title: 'IVXHOLDINGS 8K Image', text: waText, url: APP_SHARE_URL });
          setShareSuccess(true);
          setTimeout(() => setShareSuccess(false), 2500);
          return;
        }
      } catch (e) {
        console.log('[VideoPresentation] web share image error:', e);
      }
      const encoded = encodeURIComponent(waText);
      try { await Linking.openURL(`https://wa.me/?text=${encoded}`); } catch { Alert.alert('Error', 'Could not open WhatsApp.'); }
      return;
    }
    try {
      await Share.share({ message: waText });
    } catch (e) {
      console.error('[VideoPresentation] Image WhatsApp share error:', e);
      const encoded = encodeURIComponent(waText);
      try {
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      } catch {
        try { await Share.share({ message: waText }); } catch { /* */ }
      }
    }
  }, [triggerHaptic]);

  const handleShareUploadedWhatsApp = useCallback(async (file: UploadedFile) => {
    triggerHaptic();
    const waText = '🎬 IVX HOLDINGS — AI Real Estate Investment Platform\n\nCheck out this presentation!\n\n' + APP_SHARE_URL;
    if (Platform.OS === 'web') {
      const encoded = encodeURIComponent(waText);
      try { await Linking.openURL(`https://wa.me/?text=${encoded}`); } catch { Alert.alert('Error', 'Could not open WhatsApp.'); }
      return;
    }
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: 'Share via WhatsApp' });
      } else {
        const encoded = encodeURIComponent(waText);
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      }
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
    } catch (e) {
      console.error('[VideoPresentation] Share uploaded error:', e);
      try {
        const encoded = encodeURIComponent(waText);
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      } catch {
        await Share.share({ message: waText });
      }
    }
  }, [triggerHaptic]);

  const handleDeleteUpload = useCallback((fileId: string) => {
    triggerHaptic();
    Alert.alert('Delete File', 'Remove this uploaded file?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          setUploadedFiles(prev => {
            const next = prev.filter(f => f.id !== fileId);
            saveUploadedFiles(next);
            return next;
          });
        }},
    ]);
  }, [triggerHaptic]);

  const handleUploadVideo = useCallback(async () => {
    triggerHaptic();
    setIsUploading(true);
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.onchange = async (e: Event) => {
          const target = e.target as HTMLInputElement;
          const file = target.files?.[0];
          if (!file) { setIsUploading(false); return; }
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const dataUrl = ev.target?.result as string;
            const newFile: UploadedFile = {
              id: `up_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              label: file.name,
              uri: dataUrl,
              mimeType: file.type,
              mediaType: file.type.startsWith('video') ? 'video' : 'image',
              uploadedAt: new Date().toISOString()};
            setUploadedFiles(prev => {
              const next = [newFile, ...prev];
              saveUploadedFiles(next);
              return next;
            });
            setIsUploading(false);
            console.log('[VideoPresentation] File uploaded (web):', file.name);
          };
          reader.readAsDataURL(file);
        };
        input.oncancel = () => setIsUploading(false);
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Needed', 'Please allow media library access to upload files.');
        setIsUploading(false);
        return;
      }
      console.log('[VideoPresentation] Opening media picker...');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        base64: false});
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const isVideo = asset.type === 'video';
        const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
        const newFile: UploadedFile = {
          id: `up_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          label: asset.fileName ?? (isVideo ? 'Video' : 'Image'),
          uri: asset.uri,
          mimeType,
          mediaType: isVideo ? 'video' : 'image',
          uploadedAt: new Date().toISOString()};
        setUploadedFiles(prev => {
          const next = [newFile, ...prev];
          saveUploadedFiles(next);
          return next;
        });
        console.log('[VideoPresentation] File uploaded:', newFile.label);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      console.error('[VideoPresentation] Upload error:', e);
      Alert.alert('Error', 'Could not open media picker.');
    } finally {
      setIsUploading(false);
    }
  }, [triggerHaptic]);

  const handleDeleteImage = useCallback((imageId: string) => {
    triggerHaptic();
    Alert.alert('Delete Image', 'Remove this image?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          setGeneratedImages(prev => {
            const next = prev.filter(img => img.id !== imageId);
            saveImagesToStorage(next);
            return next;
          });
        }},
    ]);
  }, [triggerHaptic]);

  const handleDownloadPresentation = useCallback(async () => {
    triggerHaptic();
    const content =
      '\uD83C\uDFAC IVX HOLDINGS \u2014 8K Cinematic Presentation\n\n' +
      '\uD83D\uDCE5 Full Presentation Package:\n' + APP_SHARE_URL + '\n\n' +
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
      '\u2705 340+ Features Built & Live\n\u2705 AI-Powered Real Estate Platform\n' +
      '\u2705 Fractional Ownership from $10\n\u2705 8K Ultra HD Quality\n' +
      '\u2705 18 Comprehensive Chapters\n' +
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n' +
      'Download the IVX HOLDINGS app for the full experience.';
    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(content);
        Alert.alert('Copied', 'Presentation content copied to clipboard.');
      } else {
        await Share.share({ message: content, title: 'Download IVXHOLDINGS Presentation' });
      }
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
    } catch (e) {
      console.log('[VideoPresentation] Download error:', e);
      Alert.alert('Error', 'Could not download. Please try again.');
    }
  }, [triggerHaptic]);

  const stopLoops = useCallback(() => {
    loopRefs.current.forEach(l => l.stop());
    loopRefs.current = [];
  }, []);

  const clearCounters = useCallback(() => {
    if (counterRef.current) { clearInterval(counterRef.current); counterRef.current = null; }
    if (constCounterRef.current) { clearInterval(constCounterRef.current); constCounterRef.current = null; }
  }, []);

  const startLoop = useCallback((anim: Animated.CompositeAnimation) => {
    loopRefs.current.push(anim);
    anim.start();
  }, []);

  const stopProgress = useCallback(() => {
    if (progressAnimRef.current) progressAnimRef.current.stop();
  }, []);

  const animateSlideIn = useCallback((slideIndex: number) => {
    const s = SLIDES[slideIndex];
    stopLoops();
    clearCounters();
    fadeAnim.setValue(0); titleAnim.setValue(0); subtitleAnim.setValue(0);
    heroScaleAnim.setValue(0.5); itemAnims.forEach(a => a.setValue(0));
    extraAnim.setValue(0); barAnims.forEach(a => a.setValue(0));
    glowAnim.setValue(0); closingPulseAnim.setValue(1);
    accentLineAnim.setValue(0); badgeAnim.setValue(0); shimmerAnim.setValue(0);
    setStatCounters([0, 0, 0, 0]); setConstructionPct(0);

    const common: Animated.CompositeAnimation[] = [
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(titleAnim, { toValue: 1, duration: 400, delay: 80, useNativeDriver: true }),
    ];
    if (s.subtitle) common.push(Animated.timing(subtitleAnim, { toValue: 1, duration: 350, delay: 250, useNativeDriver: true }));

    const typed: Animated.CompositeAnimation[] = [];
    switch (s.type) {
      case 'hero':
        typed.push(
          Animated.spring(heroScaleAnim, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
          Animated.timing(accentLineAnim, { toValue: 1, duration: 700, delay: 200, useNativeDriver: false }),
          Animated.timing(badgeAnim, { toValue: 1, duration: 400, delay: 400, useNativeDriver: true })
        );
        startLoop(Animated.loop(Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])));
        break;
      case 'pain':
        PAIN_POINTS.forEach((_, i) => {
          typed.push(Animated.timing(itemAnims[i], { toValue: 1, duration: 250, delay: 350 + i * 150, useNativeDriver: true }));
        });
        typed.push(Animated.timing(accentLineAnim, { toValue: 1, duration: 500, delay: 150, useNativeDriver: false }));
        break;
      case 'comparison':
        typed.push(Animated.timing(extraAnim, { toValue: 1, duration: 350, delay: 250, useNativeDriver: true }));
        COMPARISON_DATA.forEach((_, i) => {
          typed.push(Animated.timing(itemAnims[i], { toValue: 1, duration: 250, delay: 500 + i * 170, useNativeDriver: true }));
        });
        typed.push(Animated.timing(badgeAnim, { toValue: 1, duration: 400, delay: 2200, useNativeDriver: true }));
        break;
      case 'feature':
        typed.push(
          Animated.spring(extraAnim, { toValue: 1, friction: 5, tension: 40, delay: 150, useNativeDriver: true }),
          Animated.timing(accentLineAnim, { toValue: 1, duration: 500, delay: 300, useNativeDriver: false })
        );
        (s.featureDesc || []).forEach((_, i) => {
          typed.push(Animated.timing(itemAnims[i], { toValue: 1, duration: 250, delay: 450 + i * 170, useNativeDriver: true }));
        });
        typed.push(Animated.timing(badgeAnim, { toValue: 1, duration: 350, delay: 700, useNativeDriver: true }));
        startLoop(Animated.loop(Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])));
        break;
      case 'construction':
        for (let i = 0; i < 6; i++) {
          typed.push(Animated.spring(itemAnims[i], { toValue: 1, friction: 7, tension: 40, delay: 400 + i * 280, useNativeDriver: true }));
        }
        typed.push(Animated.timing(barAnims[0], { toValue: 1, duration: 2400, delay: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false }));
        typed.push(Animated.timing(badgeAnim, { toValue: 1, duration: 350, delay: 2100, useNativeDriver: true }));
        const cStart = Date.now();
        constCounterRef.current = setInterval(() => {
          const elapsed = Date.now() - cStart - 400;
          if (elapsed < 0) return;
          const p = Math.min(elapsed / 2400, 1);
          setConstructionPct(Math.round((1 - Math.pow(1 - p, 3)) * 78));
          if (p >= 1 && constCounterRef.current) { clearInterval(constCounterRef.current); constCounterRef.current = null; }
        }, 30);
        startLoop(Animated.loop(Animated.sequence([
          Animated.timing(extraAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(extraAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])));
        break;
      case 'stats':
        STATS_DATA.forEach((_, i) => {
          typed.push(
            Animated.timing(itemAnims[i], { toValue: 1, duration: 350, delay: 250 + i * 150, useNativeDriver: true }),
            Animated.timing(barAnims[i], { toValue: 1, duration: 1300, delay: 400 + i * 150, easing: Easing.out(Easing.cubic), useNativeDriver: false })
          );
        });
        typed.push(Animated.timing(badgeAnim, { toValue: 1, duration: 350, delay: 1300, useNativeDriver: true }));
        const sStart = Date.now();
        counterRef.current = setInterval(() => {
          const elapsed = Date.now() - sStart - 400;
          if (elapsed < 0) return;
          const p = Math.min(elapsed / 1800, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setStatCounters(STATS_DATA.map(st => {
            const val = eased * st.value;
            return st.value % 1 === 0 ? Math.round(val) : Math.round(val * 10) / 10;
          }));
          if (p >= 1 && counterRef.current) { clearInterval(counterRef.current); counterRef.current = null; }
        }, 30);
        break;
      case 'ecosystem':
        typed.push(Animated.spring(extraAnim, { toValue: 1, friction: 6, tension: 40, delay: 150, useNativeDriver: true }));
        ECO_ITEMS.forEach((_, i) => {
          typed.push(Animated.timing(itemAnims[i], { toValue: 1, duration: 280, delay: 350 + i * 150, useNativeDriver: true }));
        });
        typed.push(Animated.timing(accentLineAnim, { toValue: 1, duration: 1000, delay: 300, useNativeDriver: false }));
        break;
      case 'closing':
        typed.push(
          Animated.spring(heroScaleAnim, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
          Animated.timing(accentLineAnim, { toValue: 1, duration: 700, delay: 200, useNativeDriver: false })
        );
        startLoop(Animated.loop(Animated.sequence([
          Animated.timing(closingPulseAnim, { toValue: 1.04, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(closingPulseAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])));
        startLoop(Animated.loop(Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])));
        break;
    }
    Animated.parallel(common.concat(typed)).start();
  }, [stopLoops, clearCounters, startLoop]);

  const startProgressTimer = useCallback((slideIndex: number) => {
    slideProgress.setValue(0);
    if (progressAnimRef.current) progressAnimRef.current.stop();
    const anim = Animated.timing(slideProgress, { toValue: 1, duration: SLIDES[slideIndex].duration * SPEED_FACTOR, useNativeDriver: false });
    progressAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) {
        if (slideIndex < SLIDES.length - 1) setCurrentSlide(prev => prev + 1);
        else { setIsPlaying(false); setIsFinished(true); }
      }
    });
  }, []);

  useEffect(() => {
    if (mode !== 'presentation') return;
    animateSlideIn(currentSlide);
    if (isPlaying && !isFinished) startProgressTimer(currentSlide);
    return () => { stopProgress(); };
  }, [currentSlide, isPlaying, isFinished, mode]);

  useEffect(() => {
    return () => { stopLoops(); clearCounters(); stopProgress(); };
  }, []);

  const goToSlide = useCallback((idx: number) => {
    triggerHaptic(); stopProgress(); setIsFinished(false); setCurrentSlide(idx);
    if (!isPlaying) setIsPlaying(true);
  }, [stopProgress, triggerHaptic, isPlaying]);

  const togglePlay = useCallback(() => {
    triggerHaptic();
    if (isFinished) { setIsFinished(false); setCurrentSlide(0); setIsPlaying(true); return; }
    setIsPlaying(prev => !prev);
  }, [triggerHaptic, isFinished]);

  const goNext = useCallback(() => {
    triggerHaptic(); stopProgress();
    if (currentSlide < totalSlides - 1) { setIsFinished(false); setCurrentSlide(prev => prev + 1); if (!isPlaying) setIsPlaying(true); }
  }, [currentSlide, totalSlides, triggerHaptic, stopProgress, isPlaying]);

  const goPrev = useCallback(() => {
    triggerHaptic(); stopProgress();
    if (currentSlide > 0) { setIsFinished(false); setCurrentSlide(prev => prev - 1); if (!isPlaying) setIsPlaying(true); }
  }, [currentSlide, triggerHaptic, stopProgress, isPlaying]);

  const enterPresentation = useCallback(() => {
    triggerHaptic();
    if (presentationStyle === 'product') {
      router.push('/app-demo' as any);
      return;
    }
    setCurrentSlide(0); setIsPlaying(true); setIsFinished(false);
    setMode('presentation');
  }, [triggerHaptic, presentationStyle, router]);

  const exitPresentation = useCallback(() => {
    triggerHaptic(); stopProgress(); stopLoops(); clearCounters();
    setIsPlaying(false); setMode('hub');
  }, [triggerHaptic, stopProgress, stopLoops, clearCounters]);

  const slideCounterText = useMemo(() => `${currentSlide + 1} / ${totalSlides}`, [currentSlide, totalSlides]);

  const renderSlideContent = () => {
    switch (slide.type) {
      case 'hero': return (
        <View style={styles.heroCentered}>
          <Animated.View style={[styles.heroGlowOrb, { backgroundColor: slide.accentColor, opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.18] }), transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.4] }) }] }]} />
          <Animated.View style={[styles.heroAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }) }]} />
          <Animated.View style={{ transform: [{ scale: heroScaleAnim }], opacity: titleAnim }}>
            <Text style={[styles.heroTitle, { color: slide.accentColor }]}>{slide.title}</Text>
          </Animated.View>
          <Animated.View style={[styles.heroAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 50] }) }]} />
          {slide.subtitle && <Animated.Text style={[styles.heroSubtitle, { opacity: subtitleAnim, transform: [{ translateY: subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>{slide.subtitle}</Animated.Text>}
          <Animated.View style={[styles.heroBadge, { borderColor: slide.accentColor + '40', opacity: badgeAnim, transform: [{ scale: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}>
            <View style={[styles.heroBadgeDot, { backgroundColor: slide.accentColor }]} />
            <Text style={[styles.heroBadgeText, { color: slide.accentColor }]}>{slide.id === 'hero' ? 'PREMIUM PLATFORM' : slide.id === 'solution' ? 'AI-POWERED' : 'LIVE NOW'}</Text>
          </Animated.View>
        </View>
      );
      case 'pain': return (
        <View style={styles.painContainer}>
          <Animated.View style={[styles.painAccentBar, { backgroundColor: slide.accentColor, height: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SH * 0.45] }) }]} />
          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }}>
            <Text style={styles.painTitle}>{slide.title}</Text>
          </Animated.View>
          <View style={styles.painList}>
            {PAIN_POINTS.map((point, i) => (
              <Animated.View key={i} style={[styles.painRow, { opacity: itemAnims[i], transform: [{ translateX: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] }]}>
                <View style={styles.painXBadge}><Text style={styles.painXText}>{'\u2715'}</Text></View>
                <Text style={styles.painText}>{point}</Text>
              </Animated.View>
            ))}
          </View>
        </View>
      );
      case 'comparison': return (
        <View style={styles.compContainer}>
          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Text style={styles.compTitle}>{slide.title}</Text>
          </Animated.View>
          <Animated.View style={[styles.compHeader, { opacity: extraAnim }]}>
            <View style={styles.compHeaderCellLeft}><Text style={styles.compHeaderTextOld}>Traditional</Text></View>
            <View style={[styles.compHeaderCellRight, { backgroundColor: slide.accentColor + '18' }]}><Text style={[styles.compHeaderTextNew, { color: slide.accentColor }]}>IVXHOLDINGS + AI</Text></View>
          </Animated.View>
          {COMPARISON_DATA.map((row, i) => (
            <Animated.View key={i} style={[styles.compRow, i % 2 === 0 && styles.compRowAlt, { opacity: itemAnims[i], transform: [{ translateX: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
              <View style={styles.compCellLeft}><Text style={styles.compTextOld} numberOfLines={3}>{row.traditional}</Text></View>
              <View style={styles.compCellRight}><Text style={[styles.compTextNew, { color: slide.accentColor }]} numberOfLines={3}>{row.ipx}</Text></View>
            </Animated.View>
          ))}
          <Animated.View style={[styles.compBadge, { opacity: badgeAnim, transform: [{ translateY: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
            <Text style={[styles.compBadgeText, { color: slide.accentColor }]}>IVXHOLDINGS eliminates every friction point</Text>
          </Animated.View>
        </View>
      );
      case 'feature': {
        const MockupComp = slide.mockupKey ? SCREEN_MOCKUP_MAP[slide.mockupKey] : null;
        return (
          <View style={styles.featureContainer}>
            <Animated.View style={[styles.featureGlow, { backgroundColor: slide.accentColor, opacity: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.12] }), transform: [{ scale: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.15] }) }] }]} />
            {MockupComp ? (
              <>
                <View style={styles.featureMockupTop}>
                  <Animated.View style={[styles.featureValueChip, { borderColor: slide.accentColor + '50', backgroundColor: slide.accentColor + '18', opacity: extraAnim, transform: [{ scale: extraAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
                    <Text style={[styles.featureValueChipText, { color: slide.accentColor }]}>{slide.featureValue}</Text>
                  </Animated.View>
                  <Animated.View style={[styles.featureAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) }]} />
                  <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                    <Text style={styles.featureTitleCompact}>{slide.title}</Text>
                  </Animated.View>
                </View>
                <Animated.View style={{ opacity: extraAnim, transform: [{ translateY: extraAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
                  <View style={styles.mockupInner}>
                    <MockupComp />
                  </View>
                </Animated.View>
                <View style={styles.featureDescListCompact}>
                  {(slide.featureDesc || []).map((desc, i) => (
                    <Animated.View key={i} style={[styles.featureDescRow, { opacity: itemAnims[i], transform: [{ translateX: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
                      <View style={[styles.featureDescDot, { backgroundColor: slide.accentColor }]} />
                      <Text style={styles.featureDescText}>{desc}</Text>
                    </Animated.View>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Animated.View style={[styles.featureValueWrap, { opacity: extraAnim, transform: [{ scale: extraAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
                  <Text style={[styles.featureValue, { color: slide.accentColor }]}>{slide.featureValue}</Text>
                </Animated.View>
                <Animated.View style={[styles.featureAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) }]} />
                <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }] }}>
                  <Text style={styles.featureTitle}>{slide.title}</Text>
                </Animated.View>
                {slide.subtitle && <Animated.Text style={[styles.featureSubtitle, { opacity: subtitleAnim, transform: [{ translateY: subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{slide.subtitle}</Animated.Text>}
                <View style={styles.featureDescList}>
                  {(slide.featureDesc || []).map((desc, i) => (
                    <Animated.View key={i} style={[styles.featureDescRow, { opacity: itemAnims[i], transform: [{ translateY: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
                      <View style={[styles.featureDescDot, { backgroundColor: slide.accentColor }]} />
                      <Text style={styles.featureDescText}>{desc}</Text>
                    </Animated.View>
                  ))}
                </View>
                <Animated.View style={[styles.featureBadge, { borderColor: slide.accentColor + '30', backgroundColor: slide.accentColor + '08', opacity: badgeAnim, transform: [{ scale: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
                  <Text style={[styles.featureBadgeText, { color: slide.accentColor }]}>{slide.id.replace(/-/g, ' ').toUpperCase()}</Text>
                </Animated.View>
              </>
            )}
          </View>
        );
      }
      case 'construction': return (
        <View style={styles.constContainer}>
          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Text style={styles.constTitle}>{slide.title}</Text>
          </Animated.View>
          <View style={styles.buildingArea}>
            <View style={styles.craneArea}>
              <View style={[styles.cranePole, { backgroundColor: slide.accentColor + '60' }]} />
              <View style={[styles.craneCounter, { backgroundColor: slide.accentColor + '50' }]} />
              <Animated.View style={[styles.craneArm, { backgroundColor: slide.accentColor + '60', transform: [{ rotate: extraAnim.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) }] }]} />
            </View>
            <View style={styles.building}>
              {[5, 4, 3, 2, 1, 0].map(floorIdx => (
                <Animated.View key={floorIdx} style={[styles.floor, { backgroundColor: FLOOR_COLORS[floorIdx], opacity: itemAnims[floorIdx], transform: [{ translateY: itemAnims[floorIdx].interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: itemAnims[floorIdx].interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
                  <View style={styles.windowRow}>{[0, 1, 2].map(w => <View key={w} style={styles.windowSquare} />)}</View>
                  <View style={styles.floorLabel}><Text style={styles.floorLabelText}>F{floorIdx + 1}</Text></View>
                </Animated.View>
              ))}
            </View>
            <View style={[styles.foundation, { backgroundColor: slide.accentColor + '30', borderColor: slide.accentColor + '50' }]} />
          </View>
          <View style={styles.constProgressWrap}>
            <View style={styles.constProgressBg}>
              <Animated.View style={[styles.constProgressFill, { backgroundColor: slide.accentColor, width: barAnims[0].interpolate({ inputRange: [0, 1], outputRange: ['0%', '78%'] }) }]} />
            </View>
            <Text style={[styles.constProgressText, { color: slide.accentColor }]}>{constructionPct}% Complete</Text>
          </View>
          <Animated.View style={[styles.constInvestBadge, { borderColor: slide.accentColor + '40', opacity: badgeAnim, transform: [{ translateY: badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
            <Text style={[styles.constInvestText, { color: slide.accentColor }]}>Your investment grows with every floor</Text>
          </Animated.View>
          {slide.subtitle && <Animated.Text style={[styles.constSubtitle, { opacity: subtitleAnim, transform: [{ translateY: subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{slide.subtitle}</Animated.Text>}
        </View>
      );
      case 'stats': return (
        <View style={styles.statsContainer}>
          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Text style={styles.statsTitle}>{slide.title}</Text>
          </Animated.View>
          <View style={styles.statsGrid}>
            {STATS_DATA.map((stat, i) => (
              <Animated.View key={i} style={[styles.statCard, { borderColor: stat.color + '25', opacity: itemAnims[i], transform: [{ translateY: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <Text style={[styles.statValue, { color: stat.color }]}>{stat.prefix}{statCounters[i]}{stat.suffix}</Text>
                <View style={styles.statBarBg}>
                  <Animated.View style={[styles.statBarFill, { backgroundColor: stat.color, width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${stat.barPct}%`] }) }]} />
                </View>
              </Animated.View>
            ))}
          </View>
        </View>
      );
      case 'ecosystem': return (
        <View style={styles.ecoContainer}>
          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Text style={[styles.ecoTitle, { color: slide.accentColor }]}>{slide.title}</Text>
          </Animated.View>
          <Animated.View style={[styles.ecoCenterBadge, { borderColor: slide.accentColor + '50', backgroundColor: slide.accentColor + '10', opacity: extraAnim, transform: [{ scale: extraAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
            <Text style={[styles.ecoCenterText, { color: slide.accentColor }]}>IVXHOLDINGS</Text>
          </Animated.View>
          <View style={styles.ecoList}>
            {ECO_ITEMS.map((item, i) => (
              <Animated.View key={i} style={[styles.ecoRow, { opacity: itemAnims[i], transform: [{ translateX: itemAnims[i].interpolate({ inputRange: [0, 1], outputRange: [i % 2 === 0 ? -25 : 25, 0] }) }] }]}>
                <View style={[styles.ecoDot, { backgroundColor: item.color }]} />
                <Text style={styles.ecoText}>{item.text}</Text>
              </Animated.View>
            ))}
          </View>
          {slide.subtitle && <Animated.Text style={[styles.ecoSubtitle, { opacity: subtitleAnim, transform: [{ translateY: subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }] }]}>{slide.subtitle}</Animated.Text>}
        </View>
      );
      case 'closing': return (
        <View style={styles.closingContainer}>
          <Animated.View style={[styles.closingGlowOrb, { backgroundColor: slide.accentColor, opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.16] }), transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.4] }) }] }]} />
          <Animated.View style={[styles.closingAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 100] }) }]} />
          <Animated.View style={{ transform: [{ scale: closingPulseAnim }, { scale: heroScaleAnim }], opacity: titleAnim }}>
            <Text style={[styles.closingTitle, { color: slide.accentColor }]}>{slide.title}</Text>
          </Animated.View>
          {slide.subtitle && <Animated.Text style={[styles.closingSubtitle, { opacity: subtitleAnim, transform: [{ translateY: subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>{slide.subtitle}</Animated.Text>}
          <Animated.View style={[styles.closingAccentLine, { backgroundColor: slide.accentColor, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) }]} />
        </View>
      );
      default: return null;
    }
  };

  const renderPresentation = () => (
    <View style={styles.container}>
      <View style={[styles.bgFill, { backgroundColor: slide.accentColor + '05' }]} />
      <View style={[styles.bgOrb, { backgroundColor: slide.accentColor + '08', top: SH * 0.08, left: -70 }]} />
      <View style={[styles.bgOrb, { backgroundColor: slide.accentColor + '05', bottom: SH * 0.15, right: -50 }]} />

      <SafeAreaView style={styles.safeTop} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={exitPresentation} style={styles.closeBtn} activeOpacity={0.7} testID="exit-presentation">
            <X size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.topBarCenter}>
            <View style={[styles.liveIndicator, { backgroundColor: slide.accentColor }]} />
            <Text style={styles.topBarTitle}>Investor Pitch</Text>
          </View>
          <Text style={styles.slideCounter}>{slideCounterText}</Text>
        </View>
        <ProgressSegments total={totalSlides} current={currentSlide} progress={slideProgress} onPress={goToSlide} accentColor={slide.accentColor} />
      </SafeAreaView>

      <Animated.View style={[styles.slideContent, { opacity: fadeAnim }]}>
        {SLIDE_IMAGES[slide.id] && (
          <>
            <Image source={{ uri: SLIDE_IMAGES[slide.id] }} style={styles.slidePhotoRealistic} resizeMode="cover" />
            <View style={styles.slidePhotoOverlay} />
          </>
        )}
        {renderSlideContent()}
      </Animated.View>

      <SafeAreaView edges={['bottom']} style={styles.controlsArea}>
        <View style={styles.controls}>
          <TouchableOpacity onPress={goPrev} style={[styles.controlBtn, currentSlide === 0 && styles.controlBtnDisabled]} disabled={currentSlide === 0} activeOpacity={0.7}>
            <SkipBack size={20} color={currentSlide === 0 ? Colors.textTertiary : Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlay} style={[styles.playBtn, { backgroundColor: slide.accentColor }]} activeOpacity={0.8}>
            {isFinished ? <RotateCcw size={24} color="#000" /> : isPlaying ? <Pause size={24} color="#000" /> : <Play size={24} color="#000" style={{ marginLeft: 2 }} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={goNext} style={[styles.controlBtn, currentSlide === totalSlides - 1 && styles.controlBtnDisabled]} disabled={currentSlide === totalSlides - 1} activeOpacity={0.7}>
            <SkipForward size={20} color={currentSlide === totalSlides - 1 ? Colors.textTertiary : Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.presShareRow}>
          <TouchableOpacity style={styles.presWABtn} onPress={shareViaWhatsApp} activeOpacity={0.85} testID="pres-wa-btn">
            <MessageCircle size={16} color="#fff" />
            <Text style={styles.presWAText}>WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presDownloadBtn} onPress={handleDownloadPresentation} activeOpacity={0.8} testID="pres-download-btn">
            <ArrowDownToLine size={16} color="#00C48C" />
            <Text style={styles.presDownloadText}>Download</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presMoreBtn} onPress={openNativeShare} activeOpacity={0.8}>
            <Share2 size={16} color={slide.accentColor} />
          </TouchableOpacity>
        </View>
        {isFinished && (
          <TouchableOpacity style={[styles.ctaButton, { backgroundColor: slide.accentColor }]} onPress={() => { exitPresentation(); router.push('/(tabs)/(home)' as any); }} activeOpacity={0.8}>
            <Text style={styles.ctaText}>Start Exploring</Text>
            <ChevronRight size={18} color="#000" />
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );

  const renderHub = () => (
    <View style={styles.container}>
      <Image source={{ uri: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80' }} style={styles.hubHeroBg} resizeMode="cover" />
      <View style={styles.hubHeroBgOverlay} />
      <View style={styles.hubGridPattern} />
      <View style={[styles.hubGlowBlob, { top: -80, left: -80, backgroundColor: 'rgba(212,160,23,0.18)' }]} />
      <View style={[styles.hubGlowBlob, { bottom: 200, right: -60, backgroundColor: 'rgba(0,120,255,0.10)', width: 220, height: 220 }]} />

      <SafeAreaView style={styles.hubSafeArea} edges={['top']}>
        <Animated.View style={[styles.hubTopBar, { opacity: hubFadeAnim }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.hubBackBtn} activeOpacity={0.7} testID="hub-back-btn">
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.hubLiveBadge}>
            <View style={styles.hubLiveDot} />
            <Text style={styles.hubLiveText}>LIVE PLATFORM</Text>
          </View>
          <View style={styles.quotaBadge}>
            <Sparkles size={10} color="#FFD700" />
            <Text style={[styles.quotaBadgeText, isLimitReached && { color: '#FF6B6B' }]}>{remaining}/{FREE_DAILY_LIMIT}</Text>
          </View>
        </Animated.View>
      </SafeAreaView>

      <Animated.View style={[styles.hubContent, { opacity: hubFadeAnim }]}>
        <ScrollView style={styles.hubScroll} contentContainerStyle={styles.hubScrollContent} showsVerticalScrollIndicator={false}>

          {shareSuccess && (
            <View style={styles.successToast}>
              <CheckCircle size={16} color="#00C48C" />
              <Text style={styles.successToastText}>Shared successfully!</Text>
            </View>
          )}

          <View style={styles.hubHeroSection}>
            <View style={styles.hubHeroBadgeRow}>
              <View style={styles.hubHeroTagEnterprise}>
                <Text style={styles.hubHeroTagEnterpriseText}>ENTERPRISE</Text>
              </View>
              <View style={styles.hubHeroTagBillion}>
                <Text style={styles.hubHeroTagBillionText}>$100B+ PLATFORM</Text>
              </View>
            </View>
            <Text style={styles.hubHeroTitle}>Investor{`\n`}<Text style={styles.hubHeroTitleAccent}>Presentation</Text></Text>
            <Text style={styles.hubHeroSubtitle}>Photo-realistic renders · Cinematic pitch deck · AI-powered real estate</Text>
            <View style={styles.hubMetricsRow}>
              <View style={styles.hubMetricItem}>
                <Text style={styles.hubMetricValue}>$326<Text style={styles.hubMetricSuffix}>T</Text></Text>
                <Text style={styles.hubMetricLabel}>Market Size</Text>
              </View>
              <View style={styles.hubMetricDivider} />
              <View style={styles.hubMetricItem}>
                <Text style={[styles.hubMetricValue, { color: '#00C48C' }]}>340<Text style={styles.hubMetricSuffix}>+</Text></Text>
                <Text style={styles.hubMetricLabel}>Features Live</Text>
              </View>
              <View style={styles.hubMetricDivider} />
              <View style={styles.hubMetricItem}>
                <Text style={[styles.hubMetricValue, { color: '#4A90D9' }]}>$10</Text>
                <Text style={styles.hubMetricLabel}>Min. Invest</Text>
              </View>
              <View style={styles.hubMetricDivider} />
              <View style={styles.hubMetricItem}>
                <Text style={[styles.hubMetricValue, { color: '#E91E63' }]}>AI</Text>
                <Text style={styles.hubMetricLabel}>Powered</Text>
              </View>
            </View>
          </View>

          <View style={styles.styleSection}>
            <View style={styles.styleSectionHeader}>
              <Film size={13} color="rgba(255,255,255,0.35)" />
              <Text style={styles.styleSectionLabel}>PRESENTATION STYLE</Text>
            </View>
            <View style={styles.styleCardRow}>
              <TouchableOpacity
                style={[styles.styleCard, presentationStyle === 'investor' && styles.styleCardActive]}
                onPress={() => { triggerHaptic(); setPresentationStyle('investor'); }}
                activeOpacity={0.8}
                testID="style-investor-btn"
              >
                {presentationStyle === 'investor' && <View style={[styles.styleCardGlow, { backgroundColor: '#D4A017' }]} />}
                <View style={[styles.styleCardIconWrap, { backgroundColor: presentationStyle === 'investor' ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.06)' }]}>
                  <Zap size={20} color={presentationStyle === 'investor' ? '#D4A017' : 'rgba(255,255,255,0.4)'} />
                </View>
                <Text style={[styles.styleCardTitle, presentationStyle === 'investor' && { color: '#D4A017' }]}>Investor Pitch</Text>
                <Text style={styles.styleCardSub}>8K cinematic for investors</Text>
                {presentationStyle === 'investor' && <View style={styles.styleCardActiveDot} />}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.styleCard, presentationStyle === 'product' && styles.styleCardActiveBlue]}
                onPress={() => { triggerHaptic(); setPresentationStyle('product'); }}
                activeOpacity={0.8}
                testID="style-product-btn"
              >
                {presentationStyle === 'product' && <View style={[styles.styleCardGlow, { backgroundColor: '#4A90D9' }]} />}
                <View style={[styles.styleCardIconWrap, { backgroundColor: presentationStyle === 'product' ? 'rgba(74,144,217,0.2)' : 'rgba(255,255,255,0.06)' }]}>
                  <Play size={20} color={presentationStyle === 'product' ? '#4A90D9' : 'rgba(255,255,255,0.4)'} />
                </View>
                <Text style={[styles.styleCardTitle, presentationStyle === 'product' && { color: '#4A90D9' }]}>Product Demo</Text>
                <Text style={styles.styleCardSub}>Full feature walkthrough</Text>
                {presentationStyle === 'product' && <View style={[styles.styleCardActiveDot, { backgroundColor: '#4A90D9' }]} />}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.hubMasterPlayBtn, presentationStyle === 'product' && { borderColor: 'rgba(74,144,217,0.4)' }]}
            onPress={enterPresentation}
            activeOpacity={0.88}
            testID="start-presentation-btn"
          >
            <Image source={{ uri: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80' }} style={styles.hubMasterPlayBg} resizeMode="cover" />
            <View style={styles.hubMasterPlayOverlay} />
            <View style={styles.hubMasterPlayContent}>
              <View style={styles.hubMasterPlayLeft}>
                <View style={[styles.hubMasterPlayIconWrap, { backgroundColor: presentationStyle === 'product' ? '#4A90D9' : '#D4A017' }]}>
                  <Play size={32} color="#000" style={{ marginLeft: 4 }} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.hubMasterPlayTitle}>{presentationStyle === 'investor' ? 'Play Investor Pitch' : 'Play Product Demo'}</Text>
                  <Text style={styles.hubMasterPlaySub}>{presentationStyle === 'investor' ? `${totalSlides} cinematic slides · 8K ultra HD backgrounds` : '15 screens · Animated · Full feature UI'}</Text>
                  <View style={styles.hubMasterPlayTags}>
                    {presentationStyle === 'investor' ? (
                      <>
                        <View style={styles.hubMasterPlayTag}><Text style={styles.hubMasterPlayTagText}>8K ULTRA HD</Text></View>
                        <View style={[styles.hubMasterPlayTag, { backgroundColor: 'rgba(255,255,255,0.15)' }]}><Text style={styles.hubMasterPlayTagText}>CINEMATIC</Text></View>
                        <View style={[styles.hubMasterPlayTag, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={styles.hubMasterPlayTagText}>~3 MIN</Text></View>
                      </>
                    ) : (
                      <>
                        <View style={[styles.hubMasterPlayTag, { backgroundColor: 'rgba(74,144,217,0.25)' }]}><Text style={[styles.hubMasterPlayTagText, { color: '#4A90D9' }]}>LIVE DEMO</Text></View>
                        <View style={[styles.hubMasterPlayTag, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={styles.hubMasterPlayTagText}>AI VOICE</Text></View>
                        <View style={[styles.hubMasterPlayTag, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={styles.hubMasterPlayTagText}>340+ FEATURES</Text></View>
                      </>
                    )}
                  </View>
                </View>
              </View>
              <ChevronRight size={22} color="rgba(255,255,255,0.8)" />
            </View>
          </TouchableOpacity>

          <View style={styles.hubPresentationGrid}>
            <TouchableOpacity
              style={[styles.hubGridCard, styles.hubGridCardLeft]}
              onPress={() => router.push('/investor-pitch' as any)}
              activeOpacity={0.85}
              testID="enterprise-pitch-btn"
            >
              <Image source={{ uri: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=600&q=80' }} style={styles.hubGridCardBg} resizeMode="cover" />
              <View style={styles.hubGridCardOverlay} />
              <View style={styles.hubGridCardContent}>
                <View style={[styles.hubGridCardBadge, { backgroundColor: '#00C48C' }]}>
                  <Text style={styles.hubGridCardBadgeText}>NEW</Text>
                </View>
                <View style={styles.hubGridCardBottom}>
                  <Sparkles size={16} color="#00C48C" />
                  <Text style={styles.hubGridCardTitle}>Enterprise{`\n`}Pitch Deck</Text>
                  <Text style={styles.hubGridCardSub}>9 slides · Owner protection · Revenue</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.hubGridCard, styles.hubGridCardRight]}
              onPress={() => router.push('/app-demo' as any)}
              activeOpacity={0.85}
              testID="start-app-demo-btn"
            >
              <Image source={{ uri: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80' }} style={styles.hubGridCardBg} resizeMode="cover" />
              <View style={styles.hubGridCardOverlay} />
              <View style={styles.hubGridCardContent}>
                <View style={[styles.hubGridCardBadge, { backgroundColor: '#4A90D9' }]}>
                  <Text style={styles.hubGridCardBadgeText}>LIVE</Text>
                </View>
                <View style={styles.hubGridCardBottom}>
                  <Play size={16} color="#4A90D9" />
                  <Text style={styles.hubGridCardTitle}>App{`\n`}Demo</Text>
                  <Text style={styles.hubGridCardSub}>15 screens · Animated · Full UI</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.hubShareBlock}>
            <View style={styles.hubShareBlockHeader}>
              <Share2 size={14} color="rgba(255,255,255,0.5)" />
              <Text style={styles.hubShareBlockTitle}>Share Presentation</Text>
            </View>
            <View style={styles.hubShareBlockRow}>
              <TouchableOpacity style={styles.hubShareBlockWA} onPress={shareViaWhatsApp} activeOpacity={0.85} testID="hub-wa-btn">
                <MessageCircle size={18} color="#fff" />
                <Text style={styles.hubShareBlockWAText}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.hubShareBlockAction} onPress={shareViaEmail} activeOpacity={0.8}>
                <Mail size={18} color="#4A90D9" />
                <Text style={styles.hubShareBlockActionText}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.hubShareBlockAction} onPress={copyShareLink} activeOpacity={0.8}>
                {copiedLink ? <CheckCircle size={18} color="#00C48C" /> : <Copy size={18} color="#FFD700" />}
                <Text style={[styles.hubShareBlockActionText, copiedLink && { color: '#00C48C' }]}>{copiedLink ? 'Copied!' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.hubShareBlockAction} onPress={openNativeShare} activeOpacity={0.8}>
                <ExternalLink size={18} color="#FF6B35" />
                <Text style={styles.hubShareBlockActionText}>More</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.hubDividerSection}>
            <View style={styles.hubDividerLine} />
            <View style={styles.hubDividerBadge}>
              <Camera size={12} color="#E91E63" />
              <Text style={styles.hubDividerText}>8K PHOTO REALISTIC STUDIO</Text>
            </View>
            <View style={styles.hubDividerLine} />
          </View>

          <View style={styles.hubPhotoStudioCard}>
            <View style={styles.hubPhotoStudioHeader}>
              <View>
                <Text style={styles.hubPhotoStudioTitle}>AI Image Generator</Text>
                <Text style={styles.hubPhotoStudioSub}>Generate photorealistic 8K property renders for your pitch</Text>
              </View>
              <View style={styles.hubPhotoQuotaBox}>
                <Text style={[styles.hubPhotoQuotaNum, isLimitReached && { color: '#FF6B6B' }]}>{remaining}</Text>
                <Text style={styles.hubPhotoQuotaLabel}>left today</Text>
              </View>
            </View>

            {isGenerating && (
              <View style={styles.generatingBanner}>
                <ShimmerIndicator size="small" color="#FFD700" />
                <Text style={styles.generatingText}>Generating 8K photorealistic render...</Text>
                <Text style={styles.generatingHint}>Takes 10–30 seconds</Text>
              </View>
            )}

            <View style={styles.templateGrid}>
              {PHOTO_TEMPLATES.map(template => {
                const isActive = activeTemplateId === template.id;
                return (
                  <TouchableOpacity
                    key={template.id}
                    style={[styles.templateCard, { borderColor: template.color + '30' }, isActive && { borderColor: template.color, backgroundColor: template.color + '10' }, isLimitReached && styles.templateCardDisabled]}
                    onPress={() => handleGenerate(template)}
                    disabled={isGenerating || isLimitReached}
                    activeOpacity={0.7}
                    testID={`template-${template.id}`}
                  >
                    <View style={[styles.templateIconWrap, { backgroundColor: template.color + '15' }]}>
                      {isActive ? <ShimmerIndicator size="small" color={template.color} /> : <Camera size={18} color={template.color} />}
                    </View>
                    <View style={styles.templateInfo}>
                      <Text style={styles.templateLabel}>{template.label}</Text>
                      <Text style={styles.templateCategory}>Tap to generate</Text>
                    </View>
                    {isActive ? (
                      <View style={styles.templateGenBadge}><RefreshCw size={12} color="#FFD700" /></View>
                    ) : (
                      <View style={[styles.templateGenBtn, { backgroundColor: template.color + '20' }]}><Sparkles size={12} color={template.color} /></View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.hubUploadDownloadRow}>
            <TouchableOpacity style={styles.hubUploadBtn} onPress={handleUploadVideo} activeOpacity={0.85} testID="hub-upload-btn" disabled={isUploading}>
              {isUploading ? <ShimmerIndicator size="small" color="#4A90D9" /> : <ArrowUpFromLine size={22} color="#4A90D9" />}
              <Text style={styles.hubUploadLabel}>{isUploading ? 'Uploading...' : 'Upload File'}</Text>
              <Text style={styles.hubActionHint}>Image or Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.hubDownloadBtn} onPress={handleDownloadPresentation} activeOpacity={0.85} testID="hub-download-btn">
              <ArrowDownToLine size={22} color="#00C48C" />
              <Text style={styles.hubDownloadLabel}>Download</Text>
              <Text style={styles.hubActionHint}>Save to device</Text>
            </TouchableOpacity>
          </View>

          {uploadedFiles.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: 8 }]}>
                <ArrowUpFromLine size={16} color="#4A90D9" />
                <Text style={styles.sectionTitle}>My Uploads</Text>
                <Text style={styles.galleryCount}>{uploadedFiles.length} files</Text>
              </View>
              <View style={styles.uploadedList}>
                {uploadedFiles.map(file => (
                  <View key={file.id} style={styles.uploadedCard}>
                    <View style={styles.uploadedThumb}>
                      {file.mediaType === 'image' ? (
                        Platform.OS === 'web' ? (
                          // @ts-ignore
                          <img src={file.uri} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <Image source={{ uri: file.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        )
                      ) : (
                        <View style={styles.uploadedVideoThumb}>
                          <Film size={28} color="rgba(255,255,255,0.5)" />
                          <Text style={styles.uploadedVideoLabel}>VIDEO</Text>
                        </View>
                      )}
                      <View style={[styles.uploadedTypeBadge, { backgroundColor: file.mediaType === 'video' ? 'rgba(74,144,217,0.85)' : 'rgba(0,196,140,0.85)' }]}>
                        <Text style={styles.uploadedTypeBadgeText}>{file.mediaType.toUpperCase()}</Text>
                      </View>
                    </View>
                    <View style={styles.uploadedInfo}>
                      <Text style={styles.uploadedName} numberOfLines={1}>{file.label}</Text>
                      <Text style={styles.uploadedDate}>
                        {new Date(file.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <View style={styles.uploadedActions}>
                      <TouchableOpacity style={styles.uploadedWABtn} onPress={() => handleShareUploadedWhatsApp(file)} activeOpacity={0.7} testID={`share-upload-wa-${file.id}`}>
                        <MessageCircle size={14} color="#fff" />
                        <Text style={styles.uploadedWABtnText}>WhatsApp</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.uploadedDeleteBtn} onPress={() => handleDeleteUpload(file.id)} activeOpacity={0.7}>
                        <Trash2 size={14} color="#FF4D4D" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {generatedImages.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                <ImageIcon size={16} color="#FFD700" />
                <Text style={styles.sectionTitle}>My Gallery</Text>
                <Text style={styles.galleryCount}>{generatedImages.length} images</Text>
              </View>
              <View style={styles.galleryList}>
                {generatedImages.map(img => (
                  <View key={img.id} style={styles.galleryCard}>
                    <View style={styles.galleryImage}>
                      {Platform.OS === 'web' ? (
                        // @ts-ignore
                        <img src={`data:${img.mimeType};base64,${img.base64}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <Image source={{ uri: `data:${img.mimeType};base64,${img.base64}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      )}
                    </View>
                    <View style={styles.galleryInfo}>
                      <View style={styles.galleryMeta}>
                        <Text style={styles.galleryLabel}>{img.label}</Text>
                        <Text style={styles.galleryDate}>
                          {new Date(img.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <View style={styles.galleryActions}>
                        <TouchableOpacity style={styles.galleryActionBtn} onPress={() => handleDownloadImage(img)} activeOpacity={0.7} testID={`download-${img.id}`}>
                          <ArrowDownToLine size={16} color="#00C48C" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.galleryActionBtn, { backgroundColor: 'rgba(37,211,102,0.1)' }]} onPress={() => handleShareImageWhatsApp(img)} activeOpacity={0.7} testID={`share-wa-${img.id}`}>
                          <MessageCircle size={16} color="#25D366" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.galleryActionBtn, { backgroundColor: 'rgba(255,77,77,0.08)' }]} onPress={() => handleDeleteImage(img.id)} activeOpacity={0.7} testID={`delete-${img.id}`}>
                          <Trash2 size={14} color="#FF4D4D" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.hubInfoCard}>
            <Clock size={14} color={Colors.textTertiary} />
            <Text style={styles.hubInfoText}>
              {FREE_DAILY_LIMIT} free AI generations per day. Resets at midnight. Generated images saved in gallery with download & WhatsApp sharing.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </View>
  );

  if (mode === 'presentation') return renderPresentation();
  return renderHub();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#03040A' },
  bgFill: { ...StyleSheet.absoluteFillObject },
  bgOrb: { position: 'absolute', width: 220, height: 220, borderRadius: 110 },
  hubHeroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 320, opacity: 0.18 },
  hubHeroBgOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 320, backgroundColor: 'rgba(3,4,10,0.7)' },
  hubGridPattern: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.03 },
  hubGlowBlob: { position: 'absolute', width: 300, height: 300, borderRadius: 150 },
  hubTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  hubLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,196,140,0.1)', borderWidth: 1, borderColor: 'rgba(0,196,140,0.25)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  hubLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00C48C' },
  hubLiveText: { fontSize: 10, fontWeight: '800' as const, color: '#00C48C', letterSpacing: 1.5 },
  hubHeroSection: { paddingTop: 8, paddingBottom: 20, gap: 10 },
  hubHeroBadgeRow: { flexDirection: 'row', gap: 8 },
  hubHeroTagEnterprise: { backgroundColor: 'rgba(212,160,23,0.15)', borderWidth: 1, borderColor: 'rgba(212,160,23,0.35)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  hubHeroTagEnterpriseText: { fontSize: 9, fontWeight: '900' as const, color: '#D4A017', letterSpacing: 2 },
  hubHeroTagBillion: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  hubHeroTagBillionText: { fontSize: 9, fontWeight: '900' as const, color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5 },
  hubHeroTitle: { fontSize: 42, fontWeight: '900' as const, color: '#FFFFFF', lineHeight: 48, letterSpacing: -0.5 },
  hubHeroTitleAccent: { color: '#D4A017' },
  hubHeroSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 19 },
  hubMetricsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, marginTop: 4 },
  hubMetricItem: { flex: 1, alignItems: 'center', gap: 2 },
  hubMetricValue: { fontSize: 20, fontWeight: '900' as const, color: '#D4A017', letterSpacing: -0.5 },
  hubMetricSuffix: { fontSize: 14, fontWeight: '700' as const },
  hubMetricLabel: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: '600' as const, letterSpacing: 0.5 },
  hubMetricDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.08)' },
  hubMasterPlayBtn: { borderRadius: 20, overflow: 'hidden', marginBottom: 12, height: 110, borderWidth: 1.5, borderColor: 'rgba(212,160,23,0.4)' },
  hubMasterPlayBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hubMasterPlayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,4,10,0.72)' },
  hubMasterPlayContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 16 },
  hubMasterPlayLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  hubMasterPlayIconWrap: { width: 58, height: 58, borderRadius: 16, backgroundColor: '#D4A017', justifyContent: 'center', alignItems: 'center' },
  hubMasterPlayTitle: { fontSize: 20, fontWeight: '900' as const, color: '#FFFFFF', letterSpacing: 0.2 },
  hubMasterPlaySub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 16 },
  hubMasterPlayTags: { flexDirection: 'row', gap: 6, marginTop: 4 },
  hubMasterPlayTag: { backgroundColor: 'rgba(212,160,23,0.25)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  hubMasterPlayTagText: { fontSize: 8, fontWeight: '900' as const, color: '#D4A017', letterSpacing: 1 },
  hubPresentationGrid: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  hubGridCard: { flex: 1, height: 180, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  hubGridCardLeft: {},
  hubGridCardRight: {},
  hubGridCardBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hubGridCardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,4,10,0.65)' },
  hubGridCardContent: { flex: 1, padding: 14, justifyContent: 'space-between' },
  hubGridCardBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  hubGridCardBadgeText: { fontSize: 9, fontWeight: '900' as const, color: '#000', letterSpacing: 1 },
  hubGridCardBottom: { gap: 4 },
  hubGridCardTitle: { fontSize: 18, fontWeight: '900' as const, color: '#FFFFFF', lineHeight: 22 },
  hubGridCardSub: { fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 14 },
  hubShareBlock: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 14, marginBottom: 20, gap: 12 },
  hubShareBlockHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hubShareBlockTitle: { fontSize: 12, fontWeight: '700' as const, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 },
  hubShareBlockRow: { flexDirection: 'row', gap: 8 },
  hubShareBlockWA: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#25D366', borderRadius: 12, paddingVertical: 12 },
  hubShareBlockWAText: { fontSize: 14, fontWeight: '800' as const, color: '#fff' },
  hubShareBlockAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingVertical: 10 },
  hubShareBlockActionText: { fontSize: 10, fontWeight: '700' as const, color: 'rgba(255,255,255,0.55)' },
  hubDividerSection: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  hubDividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  hubDividerBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(233,30,99,0.1)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(233,30,99,0.2)' },
  hubDividerText: { fontSize: 9, fontWeight: '900' as const, color: '#E91E63', letterSpacing: 1.2 },
  hubPhotoStudioCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: 16, marginBottom: 14, gap: 14 },
  hubPhotoStudioHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  hubPhotoStudioTitle: { fontSize: 18, fontWeight: '900' as const, color: Colors.text },
  hubPhotoStudioSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2, lineHeight: 17 },
  hubPhotoQuotaBox: { alignItems: 'center', backgroundColor: 'rgba(212,160,23,0.1)', borderWidth: 1, borderColor: 'rgba(212,160,23,0.2)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  hubPhotoQuotaNum: { fontSize: 22, fontWeight: '900' as const, color: '#D4A017' },
  hubPhotoQuotaLabel: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: '600' as const },
  hubUploadDownloadRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  hubBgGlow: { position: 'absolute', top: -60, left: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,215,0,0.04)' },
  hubBgGlow2: { position: 'absolute', bottom: 80, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(74,144,217,0.03)' },

  hubEnterprisePitchCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,196,140,0.06)', borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(0,196,140,0.35)', padding: 16, marginBottom: 10, gap: 14 },
  hubEnterprisePitchLeft: { width: 52, height: 52, borderRadius: 14, backgroundColor: '#00C48C', justifyContent: 'center', alignItems: 'center' },
  hubEnterprisePitchIcon: { justifyContent: 'center', alignItems: 'center' },
  hubEnterprisePitchTitle: { fontSize: 15, fontWeight: '800' as const, color: '#00C48C', letterSpacing: 0.2, marginBottom: 2 },

  hubSafeArea: { zIndex: 10 },
  hubHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  hubBackBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', justifyContent: 'center', alignItems: 'center' },
  hubHeaderCenter: { flex: 1 },
  hubTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hubTitle: { fontSize: 18, fontWeight: '800' as const, color: Colors.text, letterSpacing: 0.3 },
  hubSubtitle: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  quotaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(212,160,23,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(212,160,23,0.25)' },
  quotaBadgeText: { fontSize: 13, fontWeight: '800' as const, color: '#D4A017' },

  hubContent: { flex: 1 },
  hubScroll: { flex: 1 },
  hubScrollContent: { paddingHorizontal: 16, paddingTop: 0 },

  photoHeroCard: { backgroundColor: 'rgba(233,30,99,0.06)', borderWidth: 1.5, borderColor: 'rgba(233,30,99,0.18)', borderRadius: 20, padding: 18, marginBottom: 16, gap: 10 },
  photoHeroBadgeRow: { flexDirection: 'row', gap: 8 },
  photoHeroBadge: { backgroundColor: 'rgba(233,30,99,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  photoHeroBadgeText: { fontSize: 10, fontWeight: '900' as const, color: '#E91E63', letterSpacing: 1.2 },
  photoHeroAiBadge: { backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  photoHeroAiBadgeText: { fontSize: 10, fontWeight: '900' as const, color: '#FFD700', letterSpacing: 1.2 },
  photoHeroTitle: { fontSize: 22, fontWeight: '900' as const, color: '#E91E63', letterSpacing: 0.3 },
  photoHeroDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  photoHeroStatsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  photoHeroStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  photoHeroStatValue: { fontSize: 18, fontWeight: '900' as const, color: Colors.text },
  photoHeroStatLabel: { fontSize: 10, color: Colors.textTertiary, fontWeight: '600' as const },

  shareAndActionsSection: { marginBottom: 20 },

  waMainBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#25D366', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 14, marginBottom: 10 },
  waMainIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  waMainInfo: { flex: 1, gap: 2 },
  waMainTitle: { fontSize: 17, fontWeight: '900' as const, color: '#fff' },
  waMainSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },

  uploadedList: { gap: 12, marginTop: 6, marginBottom: 20 },
  uploadedCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  uploadedThumb: { width: '100%', height: 180, backgroundColor: '#111', overflow: 'hidden', position: 'relative' as const },
  uploadedVideoThumb: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: 'rgba(74,144,217,0.08)' },
  uploadedVideoLabel: { fontSize: 10, fontWeight: '800' as const, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5 },
  uploadedTypeBadge: { position: 'absolute' as const, top: 10, left: 10, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  uploadedTypeBadgeText: { fontSize: 9, fontWeight: '900' as const, color: '#fff', letterSpacing: 1 },
  uploadedInfo: { paddingHorizontal: 14, paddingTop: 10, gap: 2 },
  uploadedName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  uploadedDate: { fontSize: 11, color: Colors.textTertiary },
  uploadedActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  uploadedWABtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#25D366', borderRadius: 10, paddingVertical: 10 },
  uploadedWABtnText: { fontSize: 13, fontWeight: '800' as const, color: '#fff' },
  uploadedDeleteBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,77,77,0.08)', borderWidth: 1, borderColor: 'rgba(255,77,77,0.15)', justifyContent: 'center', alignItems: 'center' },

  hubActionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  hubDownloadBtn: { flex: 1, backgroundColor: 'rgba(0,196,140,0.08)', borderWidth: 1.5, borderColor: 'rgba(0,196,140,0.25)', borderRadius: 16, paddingVertical: 18, alignItems: 'center', gap: 6 },
  hubDownloadLabel: { fontSize: 14, fontWeight: '800' as const, color: '#00C48C' },
  hubUploadBtn: { flex: 1, backgroundColor: 'rgba(74,144,217,0.08)', borderWidth: 1.5, borderColor: 'rgba(74,144,217,0.25)', borderRadius: 16, paddingVertical: 18, alignItems: 'center', gap: 6 },
  hubUploadLabel: { fontSize: 14, fontWeight: '800' as const, color: '#4A90D9' },
  hubActionHint: { fontSize: 10, color: Colors.textTertiary, marginTop: -2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '800' as const, color: Colors.text, flex: 1 },

  successToast: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,196,140,0.12)', borderWidth: 1, borderColor: 'rgba(0,196,140,0.25)', paddingVertical: 10, borderRadius: 12, marginBottom: 12 },
  successToastText: { fontSize: 13, fontWeight: '700' as const, color: '#00C48C' },

  hubDemoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,196,140,0.06)', borderWidth: 1.5, borderColor: 'rgba(0,196,140,0.25)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14, gap: 14, marginBottom: 16 },
  hubDemoLeft: {},
  hubDemoIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#00C48C', justifyContent: 'center', alignItems: 'center' },
  hubDemoInfo: { flex: 1, gap: 4 },
  hubPitchCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.06)', borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.2)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14, gap: 14, marginBottom: 16 },
  hubPitchLeft: {},
  hubPitchIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFD700', justifyContent: 'center', alignItems: 'center' },
  hubPitchInfo: { flex: 1, gap: 4 },
  hubPitchTitle: { fontSize: 18, fontWeight: '900' as const, color: '#FFD700', letterSpacing: 0.2 },
  hubPitchSub: { fontSize: 12, color: Colors.textSecondary },
  hubPitchTags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  hubPitchTag: { backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  hubPitchTagText: { fontSize: 10, fontWeight: '800' as const, color: '#FFD700', letterSpacing: 0.5 },
  hubShareRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  hubShareSmall: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 10 },
  hubShareSmallText: { fontSize: 11, fontWeight: '700' as const, color: 'rgba(255,255,255,0.6)' },
  sectionBadge: { backgroundColor: 'rgba(233,30,99,0.12)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sectionBadgeText: { fontSize: 10, fontWeight: '800' as const, color: '#E91E63', letterSpacing: 0.8 },
  sectionDesc: { fontSize: 13, color: Colors.textTertiary, marginBottom: 14, lineHeight: 18 },

  generatingBanner: { alignItems: 'center', gap: 8, paddingVertical: 24, marginBottom: 14, backgroundColor: 'rgba(255,215,0,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,215,0,0.12)' },
  generatingText: { fontSize: 14, fontWeight: '700' as const, color: '#FFD700' },
  generatingHint: { fontSize: 11, color: Colors.textTertiary },

  templateGrid: { gap: 10, marginBottom: 20 },
  templateCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  templateCardDisabled: { opacity: 0.4 },
  templateIconWrap: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  templateInfo: { flex: 1 },
  templateLabel: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  templateCategory: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  templateGenBtn: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  templateGenBadge: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.1)' },

  galleryCount: { fontSize: 12, color: Colors.textTertiary, fontWeight: '600' as const },
  galleryList: { gap: 16, marginTop: 10 },
  galleryCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  galleryImage: { width: '100%', height: SW * 0.7, backgroundColor: '#111', overflow: 'hidden' },
  galleryInfo: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  galleryMeta: { flex: 1, gap: 2 },
  galleryLabel: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  galleryDate: { fontSize: 11, color: Colors.textTertiary },
  galleryActions: { flexDirection: 'row', gap: 8 },
  galleryActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },

  hubInfoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  hubInfoText: { fontSize: 12, color: Colors.textTertiary, flex: 1, lineHeight: 17 },

  safeTop: { zIndex: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  topBarCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveIndicator: { width: 8, height: 8, borderRadius: 4 },
  topBarTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, letterSpacing: 0.5 },
  slideCounter: { fontSize: 13, fontWeight: '600' as const, color: Colors.textTertiary, minWidth: 36, textAlign: 'right' as const },

  progressBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 2, paddingTop: 6, paddingBottom: 4 },
  progressSegment: { flex: 1, height: 14, justifyContent: 'center' },
  progressSegmentBg: { height: 2.5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  progressSegmentFill: { height: '100%', borderRadius: 2 },

  slideContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  slidePhotoRealistic: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
  slidePhotoOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,4,6,0.45)' },

  heroCentered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  heroGlowOrb: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  heroAccentLine: { height: 2, borderRadius: 1 },
  heroTitle: { fontSize: 38, fontWeight: '900' as const, textAlign: 'center' as const, lineHeight: 44, letterSpacing: 2 },
  heroSubtitle: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 22, maxWidth: 300, marginTop: 4 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 8 },
  heroBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.5 },

  painContainer: { gap: 14, paddingLeft: 4 },
  painAccentBar: { position: 'absolute', left: 0, top: 0, width: 3, borderRadius: 2 },
  painTitle: { fontSize: 24, fontWeight: '900' as const, color: '#FF4D4D', lineHeight: 30, paddingLeft: 12 },
  painList: { gap: 6, paddingLeft: 12 },
  painRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  painXBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,77,77,0.15)', justifyContent: 'center', alignItems: 'center' },
  painXText: { fontSize: 11, fontWeight: '800' as const, color: '#FF4D4D' },
  painText: { fontSize: 14, color: Colors.textSecondary, flex: 1 },

  compContainer: { gap: 8 },
  compTitle: { fontSize: 20, fontWeight: '900' as const, color: Colors.text, lineHeight: 26, textAlign: 'center' as const, marginBottom: 4 },
  compHeader: { flexDirection: 'row', gap: 2 },
  compHeaderCellLeft: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: 'rgba(255,77,77,0.1)', borderRadius: 6 },
  compHeaderTextOld: { fontSize: 11, fontWeight: '800' as const, color: '#FF4D4D', letterSpacing: 0.5 },
  compHeaderCellRight: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  compHeaderTextNew: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.5 },
  compRow: { flexDirection: 'row', gap: 2 },
  compRowAlt: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 4 },
  compCellLeft: { flex: 1, paddingVertical: 5, paddingHorizontal: 8 },
  compCellRight: { flex: 1, paddingVertical: 5, paddingHorizontal: 8 },
  compTextOld: { fontSize: 11, color: Colors.textTertiary, lineHeight: 15 },
  compTextNew: { fontSize: 11, fontWeight: '700' as const, lineHeight: 15 },
  compBadge: { alignItems: 'center', marginTop: 6 },
  compBadgeText: { fontSize: 12, fontWeight: '700' as const, fontStyle: 'italic' as const },

  featureContainer: { alignItems: 'center', gap: 10 },
  featureGlow: { position: 'absolute', width: 200, height: 200, borderRadius: 100 },
  featureValueWrap: { marginBottom: 4 },
  featureValue: { fontSize: 64, fontWeight: '900' as const, letterSpacing: -1, textAlign: 'center' as const },
  featureAccentLine: { height: 2, borderRadius: 1 },
  featureTitle: { fontSize: 24, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const },
  featureSubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, maxWidth: 280 },
  featureDescList: { gap: 8, marginTop: 6, width: '100%', maxWidth: 280 },
  featureDescRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureDescDot: { width: 6, height: 6, borderRadius: 3 },
  featureDescText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  featureBadge: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 5, marginTop: 6 },
  featureBadgeText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 1.2 },
  featureMockupTop: { alignItems: 'center' as const, gap: 6, width: '100%' as const },
  featureValueChip: { borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 7 },
  featureValueChipText: { fontSize: 26, fontWeight: '900' as const, letterSpacing: -0.5 },
  featureTitleCompact: { fontSize: 19, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const, lineHeight: 24 },
  mockupInner: { transform: [{ scale: 0.76 }], marginVertical: -32, width: '100%' as const },
  featureDescListCompact: { gap: 5, width: '100%' as const, maxWidth: 320, marginTop: 2 },

  constContainer: { alignItems: 'center', gap: 10 },
  constTitle: { fontSize: 22, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const },
  buildingArea: { alignItems: 'center', position: 'relative', marginTop: 4 },
  craneArea: { width: 160, height: 38, position: 'relative', marginBottom: -2 },
  cranePole: { position: 'absolute', left: 75, bottom: 0, width: 3, height: 38, borderRadius: 1 },
  craneArm: { position: 'absolute', left: 78, top: 0, width: 55, height: 3, borderRadius: 1 },
  craneCounter: { position: 'absolute', right: 85, top: 0, width: 22, height: 3, borderRadius: 1 },
  building: { width: 150, gap: 3 },
  floor: { height: 28, borderRadius: 3, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  windowRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  windowSquare: { width: 18, height: 16, borderRadius: 2, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.08)' },
  floorLabel: { width: 22, alignItems: 'flex-end' },
  floorLabelText: { fontSize: 8, fontWeight: '700' as const, color: 'rgba(255,255,255,0.4)' },
  foundation: { width: 164, height: 8, borderRadius: 2, borderWidth: 1, marginTop: 2 },
  constProgressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 200, marginTop: 8 },
  constProgressBg: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  constProgressFill: { height: '100%', borderRadius: 3 },
  constProgressText: { fontSize: 12, fontWeight: '800' as const, minWidth: 55 },
  constInvestBadge: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5 },
  constInvestText: { fontSize: 11, fontWeight: '700' as const },
  constSubtitle: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' as const, lineHeight: 18, maxWidth: 260, marginTop: 2 },

  statsContainer: { gap: 14 },
  statsTitle: { fontSize: 24, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const },
  statsGrid: { gap: 10 },
  statCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  statLabel: { fontSize: 11, color: Colors.textTertiary, width: 85 },
  statValue: { fontSize: 20, fontWeight: '900' as const, minWidth: 65 },
  statBarBg: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  statBarFill: { height: '100%', borderRadius: 3 },

  ecoContainer: { alignItems: 'center', gap: 10 },
  ecoTitle: { fontSize: 24, fontWeight: '900' as const, textAlign: 'center' as const, lineHeight: 30 },
  ecoCenterBadge: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  ecoCenterText: { fontSize: 16, fontWeight: '900' as const, letterSpacing: 1 },
  ecoList: { gap: 8, width: '100%', paddingHorizontal: 10 },
  ecoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  ecoDot: { width: 8, height: 8, borderRadius: 4 },
  ecoText: { fontSize: 13, color: Colors.text, flex: 1, fontWeight: '500' as const },
  ecoSubtitle: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' as const, lineHeight: 18, maxWidth: 280, marginTop: 4 },

  closingContainer: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  closingGlowOrb: { position: 'absolute', width: 280, height: 280, borderRadius: 140 },
  closingAccentLine: { height: 2.5, borderRadius: 1 },
  closingTitle: { fontSize: 42, fontWeight: '900' as const, textAlign: 'center' as const, lineHeight: 48, letterSpacing: 1 },
  closingSubtitle: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 22, maxWidth: 300 },

  controlsArea: { paddingHorizontal: 24, paddingBottom: 8 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, paddingVertical: 10 },
  controlBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  controlBtnDisabled: { opacity: 0.4 },
  playBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },

  presShareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  presWABtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#25D366', paddingVertical: 11, borderRadius: 12 },
  presWAText: { fontSize: 13, fontWeight: '800' as const, color: '#fff' },
  presDownloadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(0,196,140,0.1)', borderWidth: 1, borderColor: 'rgba(0,196,140,0.25)', paddingVertical: 11, borderRadius: 12 },
  presDownloadText: { fontSize: 13, fontWeight: '700' as const, color: '#00C48C' },
  presMoreBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },

  ctaButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 4, marginBottom: 8 },
  ctaText: { fontSize: 15, fontWeight: '800' as const, color: '#000' },

  styleSection: { marginBottom: 14 },
  styleSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  styleSectionLabel: { fontSize: 10, fontWeight: '900' as const, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 },
  styleCardRow: { flexDirection: 'row', gap: 10 },
  styleCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, gap: 6, overflow: 'hidden' as const },
  styleCardActive: { backgroundColor: 'rgba(212,160,23,0.08)', borderColor: 'rgba(212,160,23,0.5)' },
  styleCardActiveBlue: { backgroundColor: 'rgba(74,144,217,0.08)', borderColor: 'rgba(74,144,217,0.5)' },
  styleCardGlow: { position: 'absolute' as const, top: -30, right: -30, width: 90, height: 90, borderRadius: 45, opacity: 0.12 },
  styleCardIconWrap: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  styleCardTitle: { fontSize: 15, fontWeight: '900' as const, color: '#fff', letterSpacing: 0.2 },
  styleCardSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 15 },
  styleCardActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D4A017', marginTop: 4 }});
