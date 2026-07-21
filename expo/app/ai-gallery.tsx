import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  Alert,
  Image,
  Share,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Sparkles,
  Image as ImageIcon,
  Clock,
  Zap,
  Download,
  Trash2,
  RefreshCw,
  Building2,
  Landmark,
  TreePine,
  Home,
  Waves,
  Mountain,
  Wallet,
  BarChart3,
  MessageCircle,
  Shield,
  Users,
    Gift,
  Copy,
  Brain,
  FileText,
  Globe,
  Megaphone,
  CreditCard,
  TrendingUp,
  Search,
  Fingerprint,
  Coins,
  Share2,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Platform as _FSPlatform } from 'react-native';

const _getFileSystemLegacy = async () => {
  try {
    const mod = await import('expo-file-system');
    return mod;
  } catch { return null; }
};
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/constants/colors';

const { width: SW } = Dimensions.get('window');
const IMAGE_WIDTH = SW - 48;

const FREE_DAILY_LIMIT = 5;
const STORAGE_KEY_GENERATIONS = 'ipx_ai_gallery_daily';
const STORAGE_KEY_IMAGES = 'ipx_ai_gallery_images';

interface DailyGenData {
  date: string;
  count: number;
}

interface GeneratedImage {
  id: string;
  prompt: string;
  base64: string;
  mimeType: string;
  createdAt: string;
  category: string;
}

interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
  category: string;
  icon: React.ReactNode;
  color: string;
}

const getTodayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDailyGens = async (): Promise<DailyGenData> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_GENERATIONS);
    if (stored) {
      const parsed: DailyGenData = JSON.parse(stored);
      if (parsed.date === getTodayKey()) return parsed;
    }
  } catch (e) {
    console.log('[AIGallery] Error reading daily generations:', e);
  }
  return { date: getTodayKey(), count: 0 };
};

const incrementDailyGen = async (): Promise<DailyGenData> => {
  const current = await getDailyGens();
  const updated: DailyGenData = { date: getTodayKey(), count: current.count + 1 };
  try {
    await AsyncStorage.setItem(STORAGE_KEY_GENERATIONS, JSON.stringify(updated));
  } catch (e) {
    console.log('[AIGallery] Error saving daily generations:', e);
  }
  return updated;
};

const loadSavedImages = async (): Promise<GeneratedImage[]> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_IMAGES);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[AIGallery] Error loading saved images:', e);
  }
  return [];
};

const saveImages = async (images: GeneratedImage[]): Promise<void> => {
  try {
    const toSave = images.slice(0, 20);
    await AsyncStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(toSave));
  } catch (e) {
    console.log('[AIGallery] Error saving images:', e);
  }
};

interface TemplateCategory {
  id: string;
  label: string;
  color: string;
}

const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: 'all', label: 'All', color: '#FFD700' },
  { id: 'properties', label: 'Properties', color: '#4A90D9' },
  { id: 'app-features', label: 'App Features', color: '#00C48C' },
  { id: 'finance', label: 'Finance', color: '#E91E63' },
  { id: 'people', label: 'People', color: '#9B59B6' },
];

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'luxury-tower',
    label: 'Luxury Tower',
    prompt: 'Photorealistic architectural rendering of a modern luxury residential skyscraper, 40 floors, glass and steel facade, rooftop infinity pool, lush landscaped ground level with palm trees, golden hour lighting, drone aerial perspective, 8K ultra-realistic quality, real estate marketing photo',
    category: 'Properties',
    icon: <Building2 size={18} color="#FFD700" />,
    color: '#FFD700',
  },
  {
    id: 'construction-progress',
    label: 'Under Construction',
    prompt: 'Ultra-realistic photo of a luxury high-rise residential building under construction, construction cranes, scaffolding, concrete floors being poured, blue sky background, city skyline visible, golden sunlight, professional real estate development photography, 8K quality',
    category: 'Properties',
    icon: <Building2 size={18} color="#FF6B35" />,
    color: '#FF6B35',
  },
  {
    id: 'beachfront-villa',
    label: 'Beachfront Villa',
    prompt: 'Stunning photorealistic image of a modern beachfront luxury villa with infinity pool overlooking the ocean, white architecture with large glass windows, tropical landscaping, sunset sky with warm colors reflecting on the water, professional architectural photography, 8K ultra-realistic',
    category: 'Properties',
    icon: <Waves size={18} color="#4A90D9" />,
    color: '#4A90D9',
  },
  {
    id: 'penthouse-interior',
    label: 'Penthouse Interior',
    prompt: 'Photorealistic interior of an ultra-luxury penthouse apartment, floor-to-ceiling windows with panoramic city skyline view at night, modern minimalist design, marble floors, designer furniture, warm ambient lighting, open concept living space, professional real estate photography, 8K quality',
    category: 'Properties',
    icon: <Home size={18} color="#E91E63" />,
    color: '#E91E63',
  },
  {
    id: 'eco-community',
    label: 'Eco Community',
    prompt: 'Photorealistic aerial view of a sustainable eco-friendly residential community, modern architecture with green rooftops, solar panels, central park with walking paths, communal gardens, electric car charging stations, lush greenery, clear blue sky, professional drone photography, 8K ultra-realistic',
    category: 'Properties',
    icon: <TreePine size={18} color="#00C48C" />,
    color: '#00C48C',
  },
  {
    id: 'mountain-resort',
    label: 'Mountain Resort',
    prompt: 'Ultra-realistic photo of a luxury mountain resort development, modern alpine architecture with large glass facades, snow-capped mountains in background, heated outdoor pool with steam rising, pine trees, winter golden hour lighting, professional real estate marketing photo, 8K quality',
    category: 'Properties',
    icon: <Mountain size={18} color="#9B59B6" />,
    color: '#9B59B6',
  },
  {
    id: 'smart-city',
    label: 'Smart City Block',
    prompt: 'Futuristic photorealistic rendering of a smart city mixed-use development block, interconnected modern buildings with LED facades, autonomous vehicle lanes, elevated walkways with gardens, holographic signage, sunset lighting, professional architectural visualization, 8K ultra-realistic quality',
    category: 'Properties',
    icon: <Landmark size={18} color="#7C4DFF" />,
    color: '#7C4DFF',
  },
  {
    id: 'waterfront-complex',
    label: 'Waterfront Complex',
    prompt: 'Stunning photorealistic image of a modern waterfront residential complex, curved glass buildings reflecting on calm harbor water, marina with luxury yachts, promenade with restaurants, blue twilight sky, city lights beginning to glow, professional real estate photography, 8K quality',
    category: 'Properties',
    icon: <Waves size={18} color="#1ABC9C" />,
    color: '#1ABC9C',
  },
  {
    id: 'marketplace-browsing',
    label: 'Property Marketplace',
    prompt: 'Photorealistic image of a young professional woman sitting in a modern minimalist living room, using a sleek smartphone showing a real estate investment app with property cards and prices, soft natural window light, shallow depth of field focused on the phone screen, luxury interior background blurred, cinematic 8K quality, lifestyle technology photography',
    category: 'App Features',
    icon: <Search size={18} color="#1ABC9C" />,
    color: '#1ABC9C',
  },
  {
    id: 'portfolio-dashboard',
    label: 'Portfolio Dashboard',
    prompt: 'Photorealistic image of a sleek modern desk setup with a large curved monitor and a smartphone both displaying real estate portfolio charts with green profit indicators, dark mode interface with gold accents, ambient LED desk lighting in warm gold tones, modern office with city skyline view through floor-to-ceiling windows at golden hour, professional product photography, 8K ultra-realistic',
    category: 'App Features',
    icon: <BarChart3 size={18} color="#3498DB" />,
    color: '#3498DB',
  },
  {
    id: 'wallet-payments',
    label: 'Digital Wallet',
    prompt: 'Photorealistic close-up of hands holding a premium smartphone displaying a sleek digital wallet interface with balance, transaction history and deposit button, golden credit card nearby on a marble surface, soft bokeh background with warm ambient light, shallow depth of field, luxury fintech lifestyle photography, 8K quality',
    category: 'Finance',
    icon: <Wallet size={18} color="#2ECC71" />,
    color: '#2ECC71',
  },
  {
    id: 'ai-chat-assistant',
    label: 'AI Chat Assistant',
    prompt: 'Photorealistic image of a person conversing with an AI assistant on their smartphone in a cozy modern cafe, the phone screen shows a sleek chat interface with message bubbles, holographic light particles emanating from the phone suggesting AI intelligence, warm cozy cafe interior with bokeh lights, cinematic shallow depth of field, professional lifestyle photography, 8K quality',
    category: 'App Features',
    icon: <MessageCircle size={18} color="#8E44AD" />,
    color: '#8E44AD',
  },
  {
    id: 'kyc-verification',
    label: 'KYC Verification',
    prompt: 'Photorealistic image of a person holding their passport next to their smartphone which shows a facial recognition scanning interface with green verification checkmarks, clean white modern environment, soft directional lighting, the phone displays a sleek verification progress screen, professional technology product photography, 8K ultra-realistic quality',
    category: 'App Features',
    icon: <Fingerprint size={18} color="#E67E22" />,
    color: '#E67E22',
  },
  {
    id: 'copy-investing',
    label: 'Copy Investing',
    prompt: 'Photorealistic image of two smartphones side by side on a modern glass desk, one showing a top investor profile with portfolio performance chart going up, the other showing a copy button being pressed with matching portfolio allocation, warm golden hour office lighting, city skyline background, professional fintech marketing photography, 8K quality',
    category: 'Finance',
    icon: <Copy size={18} color="#E67E22" />,
    color: '#E67E22',
  },
  {
    id: 'vip-luxury',
    label: 'VIP Experience',
    prompt: 'Photorealistic image of a luxury VIP lounge scene with a golden membership card on a polished dark marble table, a champagne glass nearby, smartphone showing exclusive premium real estate deals, dramatic low-key lighting with gold accents, velvet textures, premium luxury lifestyle photography, bokeh background with warm amber lights, 8K ultra-realistic',
    category: 'App Features',
    icon: <IVXBrandIcon size={18} />,
    color: '#FFD700',
  },
  {
    id: 'gift-shares',
    label: 'Gift Real Estate',
    prompt: 'Photorealistic image of an elegant gift box wrapped in gold and black premium paper with a bow, partially opened revealing a smartphone screen showing a property share gift card with a congratulations message, rose petals scattered around, soft romantic bokeh lighting, luxury gifting concept photography, 8K quality',
    category: 'App Features',
    icon: <Gift size={18} color="#E74C3C" />,
    color: '#E74C3C',
  },
  {
    id: 'referral-network',
    label: 'Referral Network',
    prompt: 'Photorealistic overhead shot of a diverse group of friends at a modern rooftop gathering, each holding smartphones showing referral bonus screens, connected by subtle golden light trails between the phones suggesting network connections, city skyline at sunset in background, warm social atmosphere, professional lifestyle photography, 8K quality',
    category: 'People',
    icon: <Users size={18} color="#FF6348" />,
    color: '#FF6348',
  },
  {
    id: 'security-biometric',
    label: 'Bank-Grade Security',
    prompt: 'Photorealistic image of a smartphone with a glowing fingerprint scanner on screen, surrounded by a translucent digital shield hologram with lock icons and encrypted data streams, dark sleek environment with blue and green security-themed lighting, cyber security concept art meets product photography, 8K ultra-realistic quality',
    category: 'App Features',
    icon: <Shield size={18} color="#27AE60" />,
    color: '#27AE60',
  },
  {
    id: 'smart-investing-ai',
    label: 'AI Smart Investing',
    prompt: 'Photorealistic image of a futuristic transparent holographic display showing AI-analyzed real estate data with heat maps, price predictions, trust scores, and market trends, a person in business attire interacting with it in a sleek modern office, blue and gold color scheme, dramatic cinematic lighting, professional futuristic concept photography, 8K quality',
    category: 'Finance',
    icon: <Brain size={18} color="#7C4DFF" />,
    color: '#7C4DFF',
  },
  {
    id: 'contracts-documents',
    label: 'AI Contracts',
    prompt: 'Photorealistic image of a tablet displaying a professionally formatted real estate contract with AI-generated highlights and annotations, next to a fountain pen and a notary stamp on a rich walnut desk, warm reading lamp light, stacks of organized documents in background, professional legal photography with modern tech twist, 8K quality',
    category: 'App Features',
    icon: <FileText size={18} color="#D35400" />,
    color: '#D35400',
  },
  {
    id: 'ipx-token-staking',
    label: 'IVXHOLDINGS Token & Staking',
    prompt: 'Photorealistic image of a gleaming golden coin with IVXHOLDINGS engraved on it, floating above a smartphone showing a staking dashboard with APY percentages and reward charts, surrounded by smaller floating coins and golden particle effects, dark luxury background with warm gold and amber lighting, cryptocurrency concept photography, 8K ultra-realistic',
    category: 'Finance',
    icon: <Coins size={18} color="#F1C40F" />,
    color: '#F1C40F',
  },
  {
    id: 'influencer-program',
    label: 'Influencer Program',
    prompt: 'Photorealistic image of a confident content creator filming a property tour with a professional camera setup and ring light, smartphone mounted showing their influencer dashboard with commission earnings and follower metrics, modern luxury property interior as backdrop, warm natural and studio mixed lighting, professional influencer marketing photography, 8K quality',
    category: 'People',
    icon: <Megaphone size={18} color="#9B59B6" />,
    color: '#9B59B6',
  },
  {
    id: 'global-investing',
    label: 'Global Real Estate',
    prompt: 'Photorealistic aerial view of iconic global city skylines seamlessly blended together - New York, Dubai, London, Singapore, Tokyo - with golden connecting light paths between them, a translucent globe hologram in the center with property pin markers, dramatic sunset sky, ultra-wide cinematic composition, 8K quality',
    category: 'Properties',
    icon: <Globe size={18} color="#16A085" />,
    color: '#16A085',
  },
  {
    id: 'fractional-investing',
    label: 'Invest from $10',
    prompt: 'Photorealistic image of a 10 dollar bill transforming into a miniature modern luxury building, the bill partially morphing with architectural elements emerging from it, placed on a clean white surface with soft studio lighting, creative conceptual photography showing fractional real estate investing, golden accent lighting, 8K ultra-realistic quality',
    category: 'Finance',
    icon: <TrendingUp size={18} color="#00C48C" />,
    color: '#00C48C',
  },
  {
    id: 'card-payment',
    label: 'Card & Bank Payments',
    prompt: 'Photorealistic image of multiple premium credit and debit cards fanned out on a modern minimalist desk next to a smartphone showing a successful deposit confirmation screen, clean modern fintech aesthetic, soft gradient lighting, marble and gold accents, professional product photography, 8K quality',
    category: 'Finance',
    icon: <CreditCard size={18} color="#3498DB" />,
    color: '#3498DB',
  },
];

export default function AIGalleryScreen() {
  const router = useRouter();
  const [dailyGens, setDailyGens] = useState<DailyGenData>({ date: getTodayKey(), count: 0 });
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'generate' | 'gallery'>('generate');
  const [activeCategory, setActiveCategory] = useState('all');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isLimitReached = useMemo(() => dailyGens.count >= FREE_DAILY_LIMIT, [dailyGens]);
  const remaining = useMemo(() => Math.max(0, FREE_DAILY_LIMIT - dailyGens.count), [dailyGens]);

  const filteredTemplates = useMemo(() => {
    if (activeCategory === 'all') return PROMPT_TEMPLATES;
    return PROMPT_TEMPLATES.filter(t => t.category.toLowerCase() === activeCategory.replace('-', ' '));
  }, [activeCategory]);

  useEffect(() => {
    getDailyGens().then(setDailyGens);
    loadSavedImages().then(setImages);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(headerAnim, { toValue: 1, duration: 600, delay: 100, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  const handleGenerate = useCallback(async (template: PromptTemplate) => {
    if (isLimitReached) {
      Alert.alert('Daily Limit Reached', 'You have used all 5 free AI generations today. Come back tomorrow for 5 more!');
      return;
    }
    if (isGenerating) return;

    triggerHaptic();
    setIsGenerating(true);
    setActivePrompt(template.id);

    console.log('[AIGallery] Generating image with prompt:', template.label);

    try {
      const { generateImage: aiGenImage } = await import('@/lib/ai-service');
      const imgResult = await aiGenImage(template.prompt, '1024x1024');
      if (!imgResult) throw new Error('Image generation unavailable');
      console.log('[AIGallery] Image generated successfully');

      const newImage: GeneratedImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        prompt: template.label,
        base64: imgResult.base64Data,
        mimeType: imgResult.mimeType,
        createdAt: new Date().toISOString(),
        category: template.category,
      };

      const updated = await incrementDailyGen();
      setDailyGens(updated);

      setImages(prev => {
        const next = [newImage, ...prev];
        saveImages(next);
        return next;
      });

      setSelectedTab('gallery');

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('[AIGallery] Generation error:', error);
      Alert.alert('Generation Failed', 'Could not generate image. Please try again.');
    } finally {
      setIsGenerating(false);
      setActivePrompt(null);
    }
  }, [isLimitReached, isGenerating, triggerHaptic]);

  const handleDeleteImage = useCallback((imageId: string) => {
    triggerHaptic();
    Alert.alert('Delete Image', 'Remove this generated image?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setImages(prev => {
            const next = prev.filter(img => img.id !== imageId);
            saveImages(next);
            return next;
          });
        },
      },
    ]);
  }, [triggerHaptic]);

  const handleDownloadImage = useCallback(async (img: GeneratedImage) => {
    triggerHaptic();
    console.log('[AIGallery] Downloading image:', img.prompt);
    if (Platform.OS === 'web') {
      try {
        const link = document.createElement('a');
        link.href = `data:${img.mimeType};base64,${img.base64}`;
        link.download = `ipx-8k-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Alert.alert('Downloaded', 'Image saved to your device.');
      } catch {
        await Clipboard.setStringAsync(`IVXHOLDINGS 8K Image - https://ipxholding.com`);
        Alert.alert('Copied', 'Share link copied to clipboard.');
      }
      return;
    }
    try {
      const byteChars = atob(img.base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNums)], { type: img.mimeType });
      const fileObj = new File([blob], `ipx-8k-${Date.now()}.png`, { type: img.mimeType });
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [fileObj] })) {
        await navigator.share({ files: [fileObj], title: 'IVXHOLDINGS 8K Image' });
      } else {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          Alert.alert('Info', 'Native file sharing requires the Expo Go app.');
        } else {
          Alert.alert('Saved', 'Image saved to device.');
        }
      }
    } catch (e) {
      console.error('[AIGallery] Download error:', e);
      Alert.alert('Error', 'Could not save image. Please try again.');
    }
  }, [triggerHaptic]);

  const handleShareWhatsApp = useCallback(async (img: GeneratedImage) => {
    triggerHaptic();
    const waText = '🏙️ Check out this 8K AI-generated real estate render from IVX HOLDINGS!\n\nhttps://ipxholding.com/presentation';
    if (Platform.OS === 'web') {
      const encoded = encodeURIComponent(waText);
      try { await Linking.openURL(`https://wa.me/?text=${encoded}`); } catch { Alert.alert('Error', 'Could not open WhatsApp.'); }
      return;
    }
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Share.share({ message: waText });
      } else {
        const encoded = encodeURIComponent(waText);
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      }
    } catch (e) {
      console.error('[AIGallery] WhatsApp share error:', e);
      try {
        const encoded = encodeURIComponent(waText);
        await Linking.openURL(`https://wa.me/?text=${encoded}`);
      } catch {
        await Share.share({ message: waText });
      }
    }
  }, [triggerHaptic]);

  const handleClearAll = useCallback(() => {
    if (images.length === 0) return;
    triggerHaptic();
    Alert.alert('Clear Gallery', 'Remove all generated images?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: () => {
          setImages([]);
          saveImages([]);
        },
      },
    ]);
  }, [images.length, triggerHaptic]);

  return (
    <View style={styles.container}>
      <View style={styles.bgGlow} />
      <View style={styles.bgGlow2} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Animated.View style={[styles.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerTitleRow}>
              <Sparkles size={16} color="#FFD700" />
              <Text style={styles.headerTitle}>AI Image Studio</Text>
            </View>
            <Text style={styles.headerSubtitle}>Realistic Property Renders</Text>
          </View>
          <View style={styles.counterBadge}>
            <Text style={[styles.counterText, isLimitReached && styles.counterTextLimit]}>
              {remaining}/{FREE_DAILY_LIMIT}
            </Text>
          </View>
        </Animated.View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'generate' && styles.tabActive]}
            onPress={() => { setSelectedTab('generate'); triggerHaptic(); }}
            activeOpacity={0.7}
          >
            <Sparkles size={14} color={selectedTab === 'generate' ? '#FFD700' : Colors.textTertiary} />
            <Text style={[styles.tabText, selectedTab === 'generate' && styles.tabTextActive]}>Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'gallery' && styles.tabActive]}
            onPress={() => { setSelectedTab('gallery'); triggerHaptic(); }}
            activeOpacity={0.7}
          >
            <ImageIcon size={14} color={selectedTab === 'gallery' ? '#FFD700' : Colors.textTertiary} />
            <Text style={[styles.tabText, selectedTab === 'gallery' && styles.tabTextActive]}>
              Gallery ({images.length})
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {selectedTab === 'generate' ? (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.quotaCard}>
              <View style={styles.quotaHeader}>
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Zap size={20} color="#FFD700" />
                </Animated.View>
                <Text style={styles.quotaTitle}>Free Daily AI Generations</Text>
              </View>
              <View style={styles.quotaDots}>
                {Array.from({ length: FREE_DAILY_LIMIT }).map((_, i) => {
                  const used = i < dailyGens.count;
                  const isNext = i === dailyGens.count;
                  return (
                    <View key={i} style={[styles.quotaDot, used ? styles.quotaDotUsed : isNext ? styles.quotaDotNext : styles.quotaDotAvail]}>
                      <Text style={[styles.quotaDotNum, used && styles.quotaDotNumUsed]}>{i + 1}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={styles.quotaBarWrap}>
                <View style={styles.quotaBarBg}>
                  <View style={[styles.quotaBarFill, { width: `${(dailyGens.count / FREE_DAILY_LIMIT) * 100}%` }]} />
                </View>
                <Text style={styles.quotaLabel}>
                  {isLimitReached ? 'Resets at midnight' : `${remaining} remaining`}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Choose a Scene</Text>
            <Text style={styles.sectionDesc}>
              Generate photorealistic images for app features, properties & more
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryContent}
            >
              {TEMPLATE_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryChip,
                    activeCategory === cat.id && { backgroundColor: cat.color + '20', borderColor: cat.color + '50' },
                  ]}
                  onPress={() => { setActiveCategory(cat.id); triggerHaptic(); }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.categoryChipText,
                    activeCategory === cat.id && { color: cat.color },
                  ]}>
                    {cat.label}
                  </Text>
                  {activeCategory === cat.id && (
                    <View style={[styles.categoryChipDot, { backgroundColor: cat.color }]} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.promptGrid}>
              {filteredTemplates.map((template) => {
                const isActive = activePrompt === template.id;
                return (
                  <TouchableOpacity
                    key={template.id}
                    style={[
                      styles.promptCard,
                      { borderColor: template.color + '30' },
                      isActive && { borderColor: template.color, backgroundColor: template.color + '10' },
                      isLimitReached && styles.promptCardDisabled,
                    ]}
                    onPress={() => handleGenerate(template)}
                    disabled={isGenerating || isLimitReached}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.promptIconWrap, { backgroundColor: template.color + '15' }]}>
                      {isActive ? (
                        <ActivityIndicator size="small" color={template.color} />
                      ) : (
                        template.icon
                      )}
                    </View>
                    <View style={styles.promptInfo}>
                      <Text style={styles.promptLabel}>{template.label}</Text>
                      <Text style={styles.promptCategory}>{template.category}</Text>
                    </View>
                    {isActive ? (
                      <View style={styles.genBadge}>
                        <RefreshCw size={12} color="#FFD700" />
                      </View>
                    ) : (
                      <View style={[styles.genBtn, { backgroundColor: template.color + '20' }]}>
                        <Sparkles size={12} color={template.color} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {isGenerating && (
              <View style={styles.generatingBanner}>
                <ActivityIndicator size="small" color="#FFD700" />
                <Text style={styles.generatingText}>Generating realistic image...</Text>
                <Text style={styles.generatingHint}>This may take 10-30 seconds</Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <Clock size={14} color={Colors.textTertiary} />
              <Text style={styles.infoText}>
                {FREE_DAILY_LIMIT} free AI-generated realistic images per day. Resets every midnight. Images are saved in your gallery.
              </Text>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {images.length > 0 && (
              <TouchableOpacity style={styles.clearAllBtn} onPress={handleClearAll} activeOpacity={0.7}>
                <Trash2 size={14} color="#FF4D4D" />
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            )}

            {images.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <ImageIcon size={40} color={Colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>No Images Yet</Text>
                <Text style={styles.emptyDesc}>
                  Generate your first realistic property image from the Generate tab
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => setSelectedTab('generate')}
                  activeOpacity={0.7}
                >
                  <Sparkles size={16} color="#000" />
                  <Text style={styles.emptyBtnText}>Start Generating</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.galleryList}>
                {images.map((img) => (
                  <View key={img.id} style={styles.galleryCard}>
                    <View style={styles.galleryImageWrap}>
                      {Platform.OS === 'web' ? (
                        // @ts-ignore
                        <img
                          src={`data:${img.mimeType};base64,${img.base64}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                          }}
                          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                            console.log('[AIGallery] Image load error:', e);
                          }}
                        />
                      ) : (
                        <Image
                          source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                          style={styles.galleryImageFill}
                          resizeMode="cover"
                          onError={(e) => console.log('[AIGallery] Image error:', e.nativeEvent)}
                        />
                      )}
                      <View style={styles.galleryImageOverlay}>
                        <View style={styles.galleryBadge}>
                          <Text style={styles.galleryBadgeText}>{img.category}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.galleryInfoBlock}>
                      <Text style={styles.galleryLabel} numberOfLines={1}>{img.prompt}</Text>
                      <Text style={styles.galleryDate}>
                        {new Date(img.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <View style={styles.galleryActions}>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleShareWhatsApp(img)}
                        activeOpacity={0.7}
                      >
                        <MessageCircle size={16} color="#25D366" />
                        <Text style={[styles.actionBtnText, { color: '#25D366' }]}>WhatsApp</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleDownloadImage(img)}
                        activeOpacity={0.7}
                      >
                        <Download size={16} color="#FFD700" />
                        <Text style={[styles.actionBtnText, { color: '#FFD700' }]}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionBtnDanger}
                        onPress={() => handleDeleteImage(img.id)}
                        activeOpacity={0.7}
                      >
                        <Trash2 size={16} color="#FF4D4D" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#040406',
  },
  bgGlow: {
    position: 'absolute',
    top: -60,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,215,0,0.04)',
  },
  bgGlow2: {
    position: 'absolute',
    bottom: 80,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(74,144,217,0.03)',
  },
  safeArea: {
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  counterBadge: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },
  counterText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#FFD700',
  },
  counterTextLimit: {
    color: '#FF6B6B',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: 'rgba(255,215,0,0.1)',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
  },
  tabTextActive: {
    color: '#FFD700',
    fontWeight: '700' as const,
  },
  content: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 140,
  },
  quotaCard: {
    backgroundColor: 'rgba(255,215,0,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.12)',
    padding: 16,
    gap: 12,
    marginBottom: 20,
  },
  quotaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quotaTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFD700',
  },
  quotaDots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  quotaDot: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  quotaDotUsed: {
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderColor: 'rgba(255,215,0,0.15)',
  },
  quotaDotNext: {
    backgroundColor: 'rgba(255,215,0,0.18)',
    borderColor: 'rgba(255,215,0,0.5)',
  },
  quotaDotAvail: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quotaDotNum: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: 'rgba(255,215,0,0.5)',
  },
  quotaDotNumUsed: {
    color: 'rgba(255,215,0,0.25)',
  },
  quotaBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  quotaBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  quotaBarFill: {
    height: '100%',
    backgroundColor: '#FFD700',
    borderRadius: 2,
  },
  quotaLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: 'rgba(255,215,0,0.6)',
    minWidth: 75,
    textAlign: 'right' as const,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginBottom: 16,
    lineHeight: 18,
  },
  promptGrid: {
    gap: 10,
  },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  promptCardDisabled: {
    opacity: 0.4,
  },
  promptIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptInfo: {
    flex: 1,
  },
  promptLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  promptCategory: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  genBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  genBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
  },
  generatingBanner: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    marginTop: 16,
    backgroundColor: 'rgba(255,215,0,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.12)',
  },
  generatingText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFD700',
  },
  generatingHint: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  infoText: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1,
    lineHeight: 17,
  },
  categoryScroll: {
    marginBottom: 14,
    marginHorizontal: -16,
  },
  categoryContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
  },
  categoryChipDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,77,77,0.08)',
    marginBottom: 12,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FF4D4D',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    maxWidth: 260,
    lineHeight: 18,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFD700',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#000',
  },
  galleryList: {
    gap: 16,
  },
  galleryCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  galleryImageWrap: {
    width: '100%',
    height: IMAGE_WIDTH * 0.75,
    backgroundColor: '#1a1a1a',
    position: 'relative' as const,
  },
  galleryImageFill: {
    width: '100%',
    height: '100%',
  },
  galleryImageOverlay: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row' as const,
    justifyContent: 'flex-start' as const,
  },
  galleryBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  galleryBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFD700',
    letterSpacing: 0.4,
  },
  galleryInfoBlock: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 3,
  },
  galleryLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  galleryDate: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  galleryActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  actionBtnDanger: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.15)',
  },
});
