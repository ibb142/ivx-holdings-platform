import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Platform,
  Easing,
  ImageBackground,
  ScrollView} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Shield,
  Brain,
  TrendingUp,
  Building2,
  DollarSign,
  Users,
  Lock,
  Zap,
  Globe,
  BarChart3,
  CheckCircle2,
  Star,
  ArrowUpRight,
  Layers,
  Cpu,
  FileCheck,
  Award,
  PieChart,
  Wallet,
  ChevronRight,
  Sparkles,
  Target,
  Home,
  Flame,
  CircleDollarSign,
  BadgeDollarSign,
  Trophy,
  Rocket,
  Eye} from 'lucide-react-native';

const { width: SW, height: SH } = Dimensions.get('window');
const SLIDE_SPEED = 8500;

const BG: Record<string, string> = {
  hero:       'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1400&q=95',
  vision:     'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1400&q=95',
  problem:    'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=1400&q=95',
  owner:      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1400&q=95',
  investor:   'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1400&q=95',
  ai:         'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1400&q=95',
  modules:    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1400&q=95',
  market:     'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1400&q=95',
  revenue:    'https://images.unsplash.com/photo-1554469384-e58fac16e23a?w=1400&q=95',
  growth:     'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1400&q=95',
  traction:   'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=1400&q=95',
  closing:    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1400&q=95'};

interface Slide {
  id: string; bg: string;
  type: 'hero'|'vision'|'problem'|'owner'|'investor'|'ai'|'modules'|'market'|'revenue'|'growth'|'traction'|'closing';
  label: string; title: string; subtitle: string; accent: string;
}

const SLIDES: Slide[] = [
  { id:'hero',     bg:BG.hero,     type:'hero',     label:'ENTERPRISE PITCH · 2026', title:'IVXHOLDINGS HOLDING LLC',                      subtitle:'The World\'s First AI-Powered Fractional Real Estate Empire — Built for $100 Billion AUM',       accent:'#D4AF37' },
  { id:'vision',   bg:BG.vision,   type:'vision',   label:'THE $100B VISION',         title:'Building the Future\nof Real Estate',  subtitle:'A $326 trillion market trapped in the 1980s. We are unlocking it with AI, fractional ownership, and viral growth mechanics.',  accent:'#C0A030' },
  { id:'problem',  bg:BG.problem,  type:'problem',  label:'THE BROKEN SYSTEM',        title:'Real Estate is\nLocked Away',          subtitle:'Millions want to invest. Billions are trapped. We end that today.',                            accent:'#E84545' },
  { id:'owner',    bg:BG.owner,    type:'owner',    label:'PROPERTY OWNER JOURNEY',   title:'Own It.\nAI Manages Everything.',      subtitle:'List in 2 minutes. Collect rent automatically. Never deal with a broker or lawyer again.',      accent:'#00C48C' },
  { id:'investor', bg:BG.investor, type:'investor', label:'INVESTOR JOURNEY',         title:'From $10\nto $10 Million.',            subtitle:'Invest in any property, anywhere, starting at $10. Daily liquidity. Zero lock-up. Full AI portfolio management.', accent:'#4A90D9' },
  { id:'ai',       bg:BG.ai,       type:'ai',       label:'AI PROFIT ENGINE',         title:'AI That Prints\nReturns 24/7',         subtitle:'Autonomous agents handle leasing, compliance, maintenance, and yield optimization around the clock.', accent:'#E91E63' },
  { id:'modules',  bg:BG.modules,  type:'modules',  label:'340+ FEATURES LIVE',       title:'One Platform.\nEvery Feature Built.',  subtitle:'From KYC to VIP — every module is built, tested, and production-ready right now.',               accent:'#FFB300' },
  { id:'market',   bg:BG.market,   type:'market',   label:'MARKET OPPORTUNITY',       title:'$326 Trillion.\nUntouched.',           subtitle:'The largest asset class on Earth — and 74% of it is still manually managed. That changes now.',  accent:'#D4AF37' },
  { id:'revenue',  bg:BG.revenue,  type:'revenue',  label:'REVENUE MODEL',            title:'7 Revenue\nStreams. All Active.',      subtitle:'Management fees, transaction cuts, VIP memberships, AI tools, referrals, data licensing, and IVXHOLDINGS tokens.', accent:'#FF6B35' },
  { id:'growth',   bg:BG.growth,   type:'growth',   label:'GROWTH TRAJECTORY',        title:'1M Users.\nYear One. Non-Negotiable.',subtitle:'Viral copy-investing, influencer AI, and referral rewards — the same fuel that powered Robinhood and Coinbase.', accent:'#9B59B6' },
  { id:'traction', bg:BG.traction, type:'traction', label:'TRACTION & PROOF',         title:'Already\nBuilt & Live.',              subtitle:'340+ features. Real code. Real users. Not a deck — a deployed platform ready to scale.',         accent:'#00D2FF' },
  { id:'closing',  bg:BG.closing,  type:'closing',  label:'JOIN THE REVOLUTION',      title:'The Moment is\nNow.',                 subtitle:'$100B AUM in 5 years. 100M users. The infrastructure is ready. We need your capital to ignite it.', accent:'#D4AF37' },
];

const PROBLEM_POINTS = [
  { icon: '⏳', text: 'Property listing takes 30–60 days', fix: '2 min with AI' },
  { icon: '🏦', text: '$50,000+ minimum to invest', fix: 'Start from $10' },
  { icon: '🔒', text: 'Capital locked for years', fix: 'Sell shares daily' },
  { icon: '📋', text: 'KYC/AML takes 3–7 days', fix: '60 seconds' },
  { icon: '🤝', text: 'Need broker, lawyer, agent', fix: 'AI handles all' },
  { icon: '📊', text: 'Zero transparency on returns', fix: 'Live AI data' },
];

const OWNER_STEPS = [
  { step:'01', title:'List in 2 Minutes',    desc:'AI scans documents, generates listing, and deploys to marketplace instantly.',   color:'#00C48C', icon: Home },
  { step:'02', title:'AI Finds Investors',   desc:'Smart matching engine connects your property with thousands of ready investors.', color:'#4A90D9', icon: Users },
  { step:'03', title:'Auto Rent Collection', desc:'AI handles lease signing, payments, maintenance requests, and compliance.',       color:'#FFB300', icon: CircleDollarSign },
  { step:'04', title:'Monthly Distributions',desc:'Rental income distributed automatically to all fractional owners on schedule.',   color:'#E91E63', icon: BadgeDollarSign },
];

const INVESTOR_STEPS = [
  { step:'01', title:'Open Account (60 sec)', desc:'KYC via AI in 60 seconds. Bank account linked. Portfolio live.',                  color:'#4A90D9', icon: FileCheck },
  { step:'02', title:'Browse Marketplace',    desc:'25+ filters. Side-by-side comparison. AI Trust Score on every property.',        color:'#00C48C', icon: Eye },
  { step:'03', title:'Invest from $10',       desc:'Fractional shares. Instant diversification. No lock-up period.',                 color:'#FFB300', icon: DollarSign },
  { step:'04', title:'AI Grows Portfolio',    desc:'Copy top investors. Auto-reinvest. Smart rebalancing. 24/7 monitoring.',          color:'#E91E63', icon: TrendingUp },
];

const AI_ENGINES = [
  { icon: Cpu,         label: 'Smart Leasing',   value: '2 min',  desc: 'Full AI lease generated',      color: '#E91E63' },
  { icon: TrendingUp,  label: 'Yield Optimizer', value: '+18%',   desc: 'Average return boost',          color: '#00C48C' },
  { icon: Users,       label: 'Tenant AI',        value: '99%',    desc: 'Match accuracy rate',           color: '#4A90D9' },
  { icon: Zap,         label: 'Auto Collect',     value: '24/7',   desc: 'Autonomous rent engine',        color: '#FFB300' },
  { icon: Shield,      label: 'Legal Shield',     value: 'AI',     desc: 'Contracts & dispute AI',        color: '#9B59B6' },
  { icon: BarChart3,   label: 'Market Intel',     value: 'Live',   desc: 'Real-time pricing signals',     color: '#FF6B35' },
];

const MODULES = [
  { icon: Building2,   label: 'Marketplace',  color: '#D4AF37' },
  { icon: BarChart3,   label: 'Portfolio',    color: '#00C48C' },
  { icon: Wallet,      label: 'Wallet',       color: '#4A90D9' },
  { icon: Brain,       label: 'AI Chat',      color: '#E91E63' },
  { icon: Shield,      label: 'KYC / AML',   color: '#FF6B35' },
  { icon: Users,       label: 'Referrals',    color: '#9B59B6' },
  { icon: Award,       label: 'VIP Tiers',    color: '#D4AF37' },
  { icon: Layers,      label: 'Admin',        color: '#4A90D9' },
  { icon: Lock,        label: 'Security',     color: '#00C48C' },
  { icon: FileCheck,   label: 'Documents',    color: '#FF6B35' },
  { icon: Globe,       label: 'Copy Invest',  color: '#E91E63' },
  { icon: Target,      label: 'Smart Invest', color: '#9B59B6' },
  { icon: Flame,       label: 'IVXHOLDINGS Earn',     color: '#D4AF37' },
  { icon: PieChart,    label: 'Analytics',    color: '#00C48C' },
  { icon: Rocket,      label: 'Influencer',   color: '#FF6B35' },
  { icon: Trophy,      label: 'Gamification', color: '#FFB300' },
];

const MARKET_STATS = [
  { label: 'Global Real Estate Market',   value: '$326T', bar: 0.95, color: '#D4AF37' },
  { label: 'Wealth Created via RE',       value: '90%',   bar: 0.90, color: '#00C48C' },
  { label: 'Annual Market Growth Rate',   value: '+8.2%', bar: 0.60, color: '#4A90D9' },
  { label: 'Properties Undigitized',      value: '74%',   bar: 0.74, color: '#E84545' },
];

const REVENUE_STREAMS = [
  { label: 'Property Management Fees', pct: '1–3% AUM',    icon: Building2,        color: '#D4AF37',  bar: 0.80 },
  { label: 'Transaction Commissions',  pct: '0.5–1.5%',    icon: DollarSign,       color: '#00C48C',  bar: 0.65 },
  { label: 'VIP Memberships',          pct: '$99–$999/mo', icon: Award,            color: '#E91E63',  bar: 0.55 },
  { label: 'AI Listing Fees',          pct: '$49/listing', icon: Sparkles,         color: '#4A90D9',  bar: 0.45 },
  { label: 'Data Licensing (B2B)',     pct: '$500K/yr+',   icon: BarChart3,        color: '#FF6B35',  bar: 0.35 },
  { label: 'IVXHOLDINGS Token Utility',        pct: 'Variable',    icon: CircleDollarSign, color: '#9B59B6',  bar: 0.30 },
];

const GROWTH_PHASES = [
  { phase: 'Q1',  target: '10K',  label: 'Private Beta',  color: '#4A90D9', h: 30  },
  { phase: 'Q2',  target: '100K', label: 'Public Launch', color: '#00C48C', h: 60  },
  { phase: 'Q3',  target: '500K', label: 'Series A',      color: '#FFB300', h: 100 },
  { phase: 'Q4',  target: '1M+',  label: 'Target',        color: '#D4AF37', h: 140 },
];

const TRACTION_ITEMS = [
  { value: '340+',  label: 'Features Built',      color: '#D4AF37',  icon: CheckCircle2 },
  { value: '18',    label: 'Platform Modules',    color: '#00C48C',  icon: Layers },
  { value: '$10',   label: 'Min Investment',       color: '#4A90D9',  icon: DollarSign },
  { value: '60 sec',label: 'KYC Completion',      color: '#E91E63',  icon: Zap },
  { value: '2 min', label: 'Property Listing',    color: '#FF6B35',  icon: Building2 },
  { value: '100M',  label: 'User Capacity Ready', color: '#9B59B6',  icon: Users },
];

function ProgressBar({ total, current, progress, onPress, accent }: {
  total: number; current: number; progress: Animated.Value; onPress: (i: number) => void; accent: string;
}) {
  return (
    <View style={pb.bar}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current;
        const w = active ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : done ? '100%' : '0%';
        return (
          <TouchableOpacity key={i} style={pb.seg} onPress={() => onPress(i)} activeOpacity={0.7}>
            <View style={pb.segBg}>
              <Animated.View style={[pb.segFill, { width: w, backgroundColor: accent }]} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const pb = StyleSheet.create({
  bar: { flexDirection: 'row', paddingHorizontal: 16, gap: 2, paddingVertical: 6 },
  seg: { flex: 1, height: 14, justifyContent: 'center' },
  segBg: { height: 2.5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' },
  segFill: { height: '100%', borderRadius: 2 }});

export default function InvestorPitchScreen() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);

  const slideProgress = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(60)).current;
  const subtitleO = useRef(new Animated.Value(0)).current;
  const labelO = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(Array.from({ length: 16 }, () => new Animated.Value(0))).current;
  const barAnims = useRef(Array.from({ length: 8 }, () => new Animated.Value(0))).current;
  const heroScale = useRef(new Animated.Value(0.88)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const moduleClickAnims = useRef(Array.from({ length: 16 }, () => new Animated.Value(1))).current;
  const accentLineAnim = useRef(new Animated.Value(0)).current;
  const counterAnims = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;

  const loopRefs = useRef<Animated.CompositeAnimation[]>([]);
  const progressRef = useRef<Animated.CompositeAnimation | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const slide = SLIDES[idx] ?? SLIDES[0];
  const total = SLIDES.length;

  const haptic = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const stopAll = useCallback(() => {
    loopRefs.current.forEach(l => l.stop());
    loopRefs.current = [];
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  const addLoop = useCallback((anim: Animated.CompositeAnimation) => {
    loopRefs.current.push(anim);
    anim.start();
  }, []);

  const stopProgress = useCallback(() => {
    if (progressRef.current) progressRef.current.stop();
  }, []);

  const startProgress = useCallback((slideIdx: number) => {
    slideProgress.setValue(0);
    stopProgress();
    const a = Animated.timing(slideProgress, { toValue: 1, duration: SLIDE_SPEED, useNativeDriver: false });
    progressRef.current = a;
    a.start(({ finished: done }) => {
      if (done) {
        if (slideIdx < total - 1) setIdx(prev => prev + 1);
        else { setPlaying(false); setFinished(true); }
      }
    });
  }, [slideProgress, total, stopProgress]);

  const animateSlide = useCallback((slideIdx: number) => {
    const s = SLIDES[slideIdx];
    stopAll();
    fadeAnim.setValue(0);
    titleY.setValue(60);
    subtitleO.setValue(0);
    labelO.setValue(0);
    heroScale.setValue(0.88);
    cardAnims.forEach(a => a.setValue(0));
    barAnims.forEach(a => a.setValue(0));
    glowAnim.setValue(0);
    accentLineAnim.setValue(0);
    shimmerAnim.setValue(0);
    counterAnims.forEach(a => a.setValue(0));

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(heroScale, { toValue: 1, friction: 8, tension: 30, useNativeDriver: true }),
      Animated.timing(labelO, { toValue: 1, duration: 500, delay: 120, useNativeDriver: true }),
      Animated.timing(titleY, { toValue: 0, duration: 650, delay: 180, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.timing(subtitleO, { toValue: 1, duration: 500, delay: 420, useNativeDriver: true }),
      Animated.timing(accentLineAnim, { toValue: 1, duration: 800, delay: 200, useNativeDriver: false }),
    ]).start();

    addLoop(Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.2, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])));
    addLoop(Animated.loop(Animated.sequence([
      Animated.timing(shimmerAnim, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(shimmerAnim, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])));

    if (s.type === 'hero' || s.type === 'closing') {
      addLoop(Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])));
    }

    if (s.type === 'problem') {
      PROBLEM_POINTS.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 8, tension: 40, delay: 500 + i * 130, useNativeDriver: true }).start();
      });
    }

    if (s.type === 'owner' || s.type === 'investor') {
      OWNER_STEPS.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 7, tension: 45, delay: 450 + i * 160, useNativeDriver: true }).start();
        Animated.timing(barAnims[i], { toValue: 1, duration: 600, delay: 600 + i * 160, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      });
    }

    if (s.type === 'ai') {
      AI_ENGINES.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 7, tension: 45, delay: 400 + i * 120, useNativeDriver: true }).start();
      });
    }

    if (s.type === 'modules') {
      MODULES.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 8, tension: 40, delay: 250 + i * 55, useNativeDriver: true }).start();
      });
      MODULES.forEach((_, i) => {
        const clickLoop = () => {
          const t = setTimeout(() => {
            Animated.sequence([
              Animated.timing(moduleClickAnims[i], { toValue: 0.82, duration: 100, useNativeDriver: true }),
              Animated.spring(moduleClickAnims[i], { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
            ]).start(() => {
              const t2 = setTimeout(clickLoop, 2500 + Math.random() * 3500);
              timeouts.current.push(t2);
            });
          }, 900 + i * 300 + Math.random() * 600);
          timeouts.current.push(t);
        };
        clickLoop();
      });
    }

    if (s.type === 'market' || s.type === 'revenue') {
      const count = s.type === 'market' ? MARKET_STATS.length : REVENUE_STREAMS.length;
      Array.from({ length: count }).forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 8, tension: 40, delay: 450 + i * 130, useNativeDriver: true }).start();
        Animated.timing(barAnims[i], { toValue: 1, duration: 1400, delay: 550 + i * 130, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      });
    }

    if (s.type === 'growth') {
      GROWTH_PHASES.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 7, tension: 45, delay: 400 + i * 160, useNativeDriver: true }).start();
        Animated.timing(barAnims[i], { toValue: 1, duration: 1600, delay: 550 + i * 160, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      });
    }

    if (s.type === 'traction') {
      TRACTION_ITEMS.forEach((_, i) => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 7, tension: 50, delay: 400 + i * 100, useNativeDriver: true }).start();
      });
    }

    if (s.type === 'vision') {
      [0,1,2,3].forEach(i => {
        Animated.spring(cardAnims[i], { toValue: 1, friction: 8, tension: 40, delay: 500 + i * 140, useNativeDriver: true }).start();
        Animated.timing(barAnims[i], { toValue: 1, duration: 1200, delay: 650 + i * 140, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      });
    }
  }, [stopAll, addLoop, fadeAnim, titleY, subtitleO, labelO, heroScale, cardAnims, barAnims, glowAnim, pulseAnim, moduleClickAnims, accentLineAnim, shimmerAnim, counterAnims]);

  useEffect(() => {
    animateSlide(idx);
    if (playing && !finished) startProgress(idx);
    return () => stopProgress();
  }, [idx, playing, finished]);

  useEffect(() => {
    return () => { stopAll(); stopProgress(); };
  }, []);

  const goTo = useCallback((i: number) => {
    haptic(); stopProgress(); setFinished(false); setIdx(i);
    if (!playing) setPlaying(true);
  }, [haptic, stopProgress, playing]);

  const togglePlay = useCallback(() => {
    haptic();
    if (finished) { setFinished(false); setIdx(0); setPlaying(true); return; }
    setPlaying(p => !p);
  }, [haptic, finished]);

  const goNext = useCallback(() => {
    haptic(); stopProgress();
    if (idx < total - 1) { setFinished(false); setIdx(p => p + 1); if (!playing) setPlaying(true); }
  }, [idx, total, haptic, stopProgress, playing]);

  const goPrev = useCallback(() => {
    haptic(); stopProgress();
    if (idx > 0) { setFinished(false); setIdx(p => p - 1); if (!playing) setPlaying(true); }
  }, [idx, haptic, stopProgress, playing]);

  const renderAccentLine = (color: string, extraStyle?: object) => (
    <Animated.View style={[s.accentLine, { backgroundColor: color, width: accentLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) }, extraStyle]} />
  );

  const renderContent = useCallback(() => {
    switch (slide.type) {

      case 'hero': return (
        <View style={s.heroWrap}>
          <Animated.View style={[s.heroCrown, { opacity: labelO, transform: [{ scale: pulseAnim }] }]}>
            <Sparkles size={13} color="#000" />
            <Text style={s.heroCrownText}>340+ FEATURES · BUILT & LIVE · 2026</Text>
          </Animated.View>
          {renderAccentLine(slide.accent, { alignSelf: 'center' as const, marginBottom: 8 })}
          <Animated.Text style={[s.heroTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }, { scale: heroScale }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent, { alignSelf: 'center' as const, width: 40, marginBottom: 12 })}
          <Animated.Text style={[s.heroSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <Animated.View style={[s.heroStatsRow, { opacity: subtitleO }]}>
            {[{ v:'$326T', l:'RE Market' }, { v:'$10', l:'Min Invest' }, { v:'9.8%', l:'Avg Return' }, { v:'24/7', l:'AI Active' }].map((item, i) => (
              <View key={i} style={[s.heroStat, i < 3 && { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.1)' }]}>
                <Text style={[s.heroStatV, { color: slide.accent }]}>{item.v}</Text>
                <Text style={s.heroStatL}>{item.l}</Text>
              </View>
            ))}
          </Animated.View>
        </View>
      );

      case 'vision': return (
        <View style={s.visionWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.visionCards}>
            {[
              { v:'$326T', l:'Total Market', sub:'Largest asset class on Earth', color:'#D4AF37' },
              { v:'100M',  l:'User Target',  sub:'Users served within 5 years',  color:'#00C48C' },
              { v:'$100B', l:'AUM Goal',     sub:'Assets under management',       color:'#4A90D9' },
              { v:'340+',  l:'Features',     sub:'Built and live today',           color:'#E91E63' },
            ].map((item, i) => (
              <Animated.View key={i} style={[s.visionCard, {
                opacity: cardAnims[i],
                borderColor: item.color + '40',
                transform: [{ scale: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }]}]}>
                <View style={[s.visionCardBar, { backgroundColor: item.color }]} />
                <Text style={[s.visionCardV, { color: item.color }]}>{item.v}</Text>
                <Text style={s.visionCardL}>{item.l}</Text>
                <Text style={s.visionCardSub}>{item.sub}</Text>
                <Animated.View style={[s.visionCardProgress, {
                  width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '80%'] }),
                  backgroundColor: item.color + '60'}]} />
              </Animated.View>
            ))}
          </View>
        </View>
      );

      case 'problem': return (
        <View style={s.problemWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.problemList}>
            {PROBLEM_POINTS.map((p, i) => (
              <Animated.View key={i} style={[s.problemRow, {
                opacity: cardAnims[i],
                transform: [{ translateX: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-35, 0] }) }]}]}>
                <View style={s.problemLeft}>
                  <Text style={s.problemEmoji}>{p.icon}</Text>
                  <Text style={s.problemText}>{p.text}</Text>
                </View>
                <View style={[s.problemFix, { borderColor: '#00C48C40' }]}>
                  <Text style={s.problemFixText}>{p.fix}</Text>
                </View>
              </Animated.View>
            ))}
          </View>
        </View>
      );

      case 'owner': return (
        <ScrollView style={s.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.stepsContainer}>
            {OWNER_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Animated.View key={i} style={[s.stepCard, {
                  borderColor: step.color + '40',
                  opacity: cardAnims[i],
                  transform: [{ translateX: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }]}]}>
                  <View style={[s.stepNumWrap, { backgroundColor: step.color }]}>
                    <Text style={s.stepNum}>{step.step}</Text>
                  </View>
                  <View style={s.stepBody}>
                    <View style={s.stepTitleRow}>
                      <Icon size={14} color={step.color} />
                      <Text style={[s.stepTitle, { color: step.color }]}>{step.title}</Text>
                    </View>
                    <Text style={s.stepDesc}>{step.desc}</Text>
                    <Animated.View style={[s.stepProgressBg]}>
                      <Animated.View style={[s.stepProgressFill, {
                        backgroundColor: step.color,
                        width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })}]} />
                    </Animated.View>
                  </View>
                </Animated.View>
              );
            })}
          </View>
        </ScrollView>
      );

      case 'investor': return (
        <ScrollView style={s.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.stepsContainer}>
            {INVESTOR_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Animated.View key={i} style={[s.stepCard, {
                  borderColor: step.color + '40',
                  opacity: cardAnims[i],
                  transform: [{ translateX: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }]}]}>
                  <View style={[s.stepNumWrap, { backgroundColor: step.color }]}>
                    <Text style={s.stepNum}>{step.step}</Text>
                  </View>
                  <View style={s.stepBody}>
                    <View style={s.stepTitleRow}>
                      <Icon size={14} color={step.color} />
                      <Text style={[s.stepTitle, { color: step.color }]}>{step.title}</Text>
                    </View>
                    <Text style={s.stepDesc}>{step.desc}</Text>
                    <Animated.View style={s.stepProgressBg}>
                      <Animated.View style={[s.stepProgressFill, {
                        backgroundColor: step.color,
                        width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })}]} />
                    </Animated.View>
                  </View>
                </Animated.View>
              );
            })}
          </View>
        </ScrollView>
      );

      case 'ai': return (
        <View style={s.aiWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.aiGrid}>
            {AI_ENGINES.map((item, i) => {
              const Icon = item.icon;
              return (
                <Animated.View key={i} style={[s.aiCard, {
                  borderColor: item.color + '45',
                  opacity: cardAnims[i],
                  transform: [{ scale: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }) }]}]}>
                  <Animated.View style={[s.aiIconWrap, { backgroundColor: item.color + '20', transform: [{ scale: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] }) }] }]}>
                    <Icon size={22} color={item.color} />
                  </Animated.View>
                  <Text style={[s.aiValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={s.aiLabel}>{item.label}</Text>
                  <Text style={s.aiDesc}>{item.desc}</Text>
                </Animated.View>
              );
            })}
          </View>
          <Animated.View style={[s.aiBanner, { opacity: subtitleO, borderColor: slide.accent + '40' }]}>
            <Brain size={16} color={slide.accent} />
            <Text style={[s.aiBannerText, { color: slide.accent }]}>IVXHOLDINGS AI saves owners 40+ hours/month on average</Text>
          </Animated.View>
        </View>
      );

      case 'modules': return (
        <View style={s.modulesWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.moduleGrid}>
            {MODULES.map((mod, i) => {
              const Icon = mod.icon;
              return (
                <Animated.View key={i} style={[s.moduleItem, {
                  opacity: cardAnims[i],
                  transform: [
                    { scale: Animated.multiply(cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), moduleClickAnims[i]) },
                  ]}]}>
                  <View style={[s.moduleIconBg, { backgroundColor: mod.color + '18', borderColor: mod.color + '45' }]}>
                    <Icon size={20} color={mod.color} />
                  </View>
                  <Text style={[s.moduleLabel, { color: mod.color }]}>{mod.label}</Text>
                </Animated.View>
              );
            })}
          </View>
          <Animated.View style={[s.moduleBadge, { opacity: subtitleO }]}>
            <CheckCircle2 size={14} color="#00C48C" />
            <Text style={s.moduleBadgeText}>All modules built, tested, production-ready. Zero technical debt.</Text>
          </Animated.View>
        </View>
      );

      case 'market': return (
        <View style={s.statsWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.statsList}>
            {MARKET_STATS.map((item, i) => (
              <Animated.View key={i} style={[s.statRow, {
                opacity: cardAnims[i],
                transform: [{ translateX: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-50, 0] }) }]}]}>
                <View style={[s.statValueBox, { borderLeftColor: item.color }]}>
                  <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={s.statLabel}>{item.label}</Text>
                </View>
                <View style={s.statBarBg}>
                  <Animated.View style={[s.statBarFill, {
                    width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${item.bar * 100}%`] }),
                    backgroundColor: item.color}]} />
                </View>
              </Animated.View>
            ))}
          </View>
        </View>
      );

      case 'revenue': return (
        <View style={s.statsWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.revenueList}>
            {REVENUE_STREAMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <Animated.View key={i} style={[s.revenueRow, {
                  borderColor: item.color + '30',
                  opacity: cardAnims[i],
                  transform: [{ translateX: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }]}]}>
                  <View style={[s.revenueIconWrap, { backgroundColor: item.color + '18' }]}>
                    <Icon size={16} color={item.color} />
                  </View>
                  <View style={s.revenueBody}>
                    <Text style={s.revenueLabel}>{item.label}</Text>
                    <View style={s.revenueBarBg}>
                      <Animated.View style={[s.revenueBarFill, {
                        width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${item.bar * 100}%`] }),
                        backgroundColor: item.color}]} />
                    </View>
                  </View>
                  <Text style={[s.revenuePct, { color: item.color }]}>{item.pct}</Text>
                </Animated.View>
              );
            })}
          </View>
          <Animated.View style={[s.revenueSummary, { opacity: subtitleO }]}>
            <ArrowUpRight size={16} color="#00C48C" />
            <Text style={s.revenueSummaryText}>Projected Year 1 Revenue: $8.5M+ across all streams</Text>
          </Animated.View>
        </View>
      );

      case 'growth': return (
        <View style={s.growthWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.growthChart}>
            {GROWTH_PHASES.map((phase, i) => (
              <Animated.View key={i} style={[s.growthCol, {
                opacity: cardAnims[i],
                transform: [{ scale: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }]}]}>
                <Text style={[s.growthTarget, { color: phase.color }]}>{phase.target}</Text>
                <View style={s.growthBarCol}>
                  <Animated.View style={[s.growthBar, {
                    backgroundColor: phase.color,
                    height: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: [4, phase.h] })}]} />
                </View>
                <View style={[s.growthPhaseTag, { backgroundColor: phase.color + '20', borderColor: phase.color + '40' }]}>
                  <Text style={[s.growthPhase, { color: phase.color }]}>{phase.phase}</Text>
                </View>
                <Text style={s.growthLabel}>{phase.label}</Text>
              </Animated.View>
            ))}
          </View>
          <Animated.View style={[s.growthBenchmark, { opacity: subtitleO }]}>
            <Text style={s.growthBenchmarkText}>📈  Robinhood: 1M users Year 1 with no AI.  IVXHOLDINGS is built to go 10× faster.</Text>
          </Animated.View>
          <Animated.View style={[s.growthEngines, { opacity: subtitleO }]}>
            {['Copy Investing', 'Influencer AI Engine', 'Viral Referrals', 'Social Sharing'].map((e, i) => (
              <View key={i} style={[s.growthChip, { borderColor: slide.accent + '50' }]}>
                <Zap size={10} color={slide.accent} />
                <Text style={[s.growthChipText, { color: slide.accent }]}>{e}</Text>
              </View>
            ))}
          </Animated.View>
        </View>
      );

      case 'traction': return (
        <View style={s.tractionWrap}>
          <Animated.Text style={[s.slideTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent)}
          <Animated.Text style={[s.slideSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <View style={s.tractionGrid}>
            {TRACTION_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <Animated.View key={i} style={[s.tractionCard, {
                  borderColor: item.color + '40',
                  opacity: cardAnims[i],
                  transform: [
                    { scale: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                    { translateY: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                  ]}]}>
                  <View style={[s.tractionIconWrap, { backgroundColor: item.color + '18' }]}>
                    <Icon size={18} color={item.color} />
                  </View>
                  <Text style={[s.tractionValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={s.tractionLabel}>{item.label}</Text>
                </Animated.View>
              );
            })}
          </View>
          <Animated.View style={[s.tractionBanner, { opacity: subtitleO, borderColor: slide.accent + '40' }]}>
            <Star size={14} color={slide.accent} fill={slide.accent} />
            <Text style={[s.tractionBannerText, { color: slide.accent }]}>
              This is not a concept. This is a deployed, scalable, production platform.
            </Text>
          </Animated.View>
        </View>
      );

      case 'closing': return (
        <View style={s.closingWrap}>
          <Animated.View style={[s.closingGlow, {
            backgroundColor: slide.accent + '12',
            opacity: glowAnim,
            transform: [{ scale: pulseAnim.interpolate({ inputRange: [1, 1.06], outputRange: [1, 1.3] }) }]}]} />
          {renderAccentLine(slide.accent, { alignSelf: 'center' as const, marginBottom: 12 })}
          <Animated.Text style={[s.closingTitle, { opacity: fadeAnim, transform: [{ translateY: titleY }, { scale: heroScale }], color: slide.accent }]}>
            {slide.title}
          </Animated.Text>
          {renderAccentLine(slide.accent, { alignSelf: 'center' as const, width: 40, marginBottom: 12 })}
          <Animated.Text style={[s.closingSubtitle, { opacity: subtitleO }]}>
            {slide.subtitle}
          </Animated.Text>
          <Animated.View style={[s.closingStatsRow, { opacity: subtitleO }]}>
            {[
              { v:'340+',  l:'Features Live',    color:'#D4AF37' },
              { v:'$100B', l:'AUM Goal',          color:'#00C48C' },
              { v:'100M',  l:'User Target',       color:'#4A90D9' },
              { v:'$10',   l:'Minimum Invest',    color:'#E91E63' },
            ].map((item, i) => (
              <View key={i} style={[s.closingStat, { borderColor: item.color + '40' }]}>
                <Text style={[s.closingStatV, { color: item.color }]}>{item.v}</Text>
                <Text style={s.closingStatL}>{item.l}</Text>
              </View>
            ))}
          </Animated.View>
          <Animated.View style={[s.closingActions, { opacity: subtitleO }]}>
            <TouchableOpacity
              style={[s.closingCta, { backgroundColor: slide.accent }]}
              onPress={() => router.push('/(tabs)/(home)' as any)}
              activeOpacity={0.85}
            >
              <Text style={s.closingCtaText}>Explore the Platform</Text>
              <ChevronRight size={18} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.closingSecondary}
              onPress={() => router.push('/investor-prospectus' as any)}
              activeOpacity={0.85}
            >
              <Text style={s.closingSecondaryText}>View Full Prospectus →</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      );

      default: return null;
    }
  }, [slide, fadeAnim, titleY, subtitleO, labelO, heroScale, cardAnims, barAnims, glowAnim, pulseAnim, shimmerAnim, moduleClickAnims, accentLineAnim, router]);

  const overlayOpacity = slide.type === 'hero' ? 0.78 : 0.86;

  return (
    <View style={s.container}>
      <ImageBackground source={{ uri: slide.bg }} style={s.bgImage} resizeMode="cover">
        <View style={[s.overlay, { backgroundColor: `rgba(4,4,8,${overlayOpacity})` }]} />

        <Animated.View style={[s.orbTop, { backgroundColor: slide.accent + '14', opacity: glowAnim, transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }] }]} />
        <Animated.View style={[s.orbBottom, { backgroundColor: slide.accent + '08', opacity: shimmerAnim }]} />

        <SafeAreaView style={s.safeTop} edges={['top']}>
          <View style={s.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} activeOpacity={0.7} testID="close-pitch">
              <X size={16} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
            <View style={s.topCenter}>
              <Animated.View style={[s.liveOrb, { backgroundColor: slide.accent, opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }]} />
              <Text style={s.topTitle}>INVESTOR PITCH</Text>
            </View>
            <View style={s.slideCount}>
              <Text style={s.slideCountN}>{idx + 1}</Text>
              <Text style={s.slideCountD}>/{total}</Text>
            </View>
          </View>
          <ProgressBar total={total} current={idx} progress={slideProgress} onPress={goTo} accent={slide.accent} />
          <Animated.View style={[s.slideLabel, { opacity: labelO }]}>
            <View style={[s.slideLabelBar, { backgroundColor: slide.accent }]} />
            <Text style={[s.slideLabelText, { color: slide.accent }]}>{slide.label}</Text>
          </Animated.View>
        </SafeAreaView>

        <View style={s.mainContent}>
          {renderContent()}
        </View>

        <SafeAreaView edges={['bottom']} style={s.bottomSafe}>
          <View style={s.controls}>
            <TouchableOpacity onPress={goPrev} style={[s.ctrlBtn, idx === 0 && s.ctrlDim]} disabled={idx === 0} activeOpacity={0.7}>
              <SkipBack size={18} color={idx === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlay} style={[s.playBtn, { backgroundColor: slide.accent }]} activeOpacity={0.8} testID="pitch-play-btn">
              {finished ? <RotateCcw size={22} color="#000" /> : playing ? <Pause size={22} color="#000" /> : <Play size={22} color="#000" style={{ marginLeft: 2 }} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={goNext} style={[s.ctrlBtn, idx === total - 1 && s.ctrlDim]} disabled={idx === total - 1} activeOpacity={0.7}>
              <SkipForward size={18} color={idx === total - 1 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)'} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#040408' },
  bgImage:      { flex: 1 },
  overlay:      { ...StyleSheet.absoluteFillObject },
  orbTop:       { position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -80, right: -80 },
  orbBottom:    { position: 'absolute', width: 260, height: 260, borderRadius: 130, bottom: SH * 0.2, left: -60, backgroundColor: 'rgba(255,255,255,0.03)' },

  safeTop:      { zIndex: 10 },
  topBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 2 },
  closeBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  topCenter:    { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveOrb:      { width: 7, height: 7, borderRadius: 4 },
  topTitle:     { fontSize: 11, fontWeight: '800' as const, color: '#fff', letterSpacing: 2.5 },
  slideCount:   { flexDirection: 'row', alignItems: 'baseline' },
  slideCountN:  { fontSize: 16, fontWeight: '900' as const, color: '#fff' },
  slideCountD:  { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: '500' as const },
  slideLabel:   { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingBottom: 2 },
  slideLabelBar:{ width: 18, height: 2.5, borderRadius: 2 },
  slideLabelText:{ fontSize: 9, fontWeight: '900' as const, letterSpacing: 2.8 },

  mainContent:  { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  scrollContent:{ flex: 1 },
  accentLine:   { height: 2.5, borderRadius: 2, marginVertical: 8 },

  bottomSafe:   {},
  controls:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, paddingVertical: 16, paddingHorizontal: 20 },
  ctrlBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  ctrlDim:      { opacity: 0.3 },
  playBtn:      { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },

  heroWrap:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 4 },
  heroCrown:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#D4AF37', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginBottom: 6 },
  heroCrownText:{ fontSize: 10, fontWeight: '900' as const, color: '#000', letterSpacing: 1 },
  heroTitle:    { fontSize: SW < 380 ? 40 : 48, fontWeight: '900' as const, color: '#fff', textAlign: 'center' as const, letterSpacing: 2, lineHeight: SW < 380 ? 46 : 54 },
  heroSubtitle: { fontSize: 13.5, color: 'rgba(255,255,255,0.7)', textAlign: 'center' as const, lineHeight: 21, maxWidth: SW - 50, marginTop: 4 },
  heroStatsRow: { flexDirection: 'row', marginTop: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  heroStat:     { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8 },
  heroStatV:    { fontSize: 18, fontWeight: '900' as const, letterSpacing: -0.3 },
  heroStatL:    { fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: '600' as const, marginTop: 3, letterSpacing: 0.5 },

  slideTitle:   { fontSize: SW < 380 ? 24 : 28, fontWeight: '900' as const, lineHeight: SW < 380 ? 30 : 34, marginBottom: 2, marginTop: 6 },
  slideSubtitle:{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', lineHeight: 19, marginBottom: 14, maxWidth: SW - 40 },

  visionWrap:   { flex: 1, justifyContent: 'center' },
  visionCards:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  visionCard:   { width: (SW - 48) / 2, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, borderWidth: 1, padding: 14, gap: 3, overflow: 'hidden' },
  visionCardBar:{ position: 'absolute', top: 0, left: 0, right: 0, height: 2.5 },
  visionCardV:  { fontSize: 26, fontWeight: '900' as const, letterSpacing: -0.5, marginTop: 8 },
  visionCardL:  { fontSize: 12, fontWeight: '800' as const, color: '#fff' },
  visionCardSub:{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 14 },
  visionCardProgress: { position: 'absolute', bottom: 0, left: 0, height: 2, borderRadius: 1 },

  problemWrap:  { flex: 1, justifyContent: 'center' },
  problemList:  { gap: 7, marginTop: 4 },
  problemRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  problemLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  problemEmoji: { fontSize: 18 },
  problemText:  { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' as const, flex: 1 },
  problemFix:   { backgroundColor: 'rgba(0,196,140,0.12)', borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  problemFixText:{ fontSize: 11, fontWeight: '800' as const, color: '#00C48C' },

  stepsContainer:{ gap: 10, paddingBottom: 20 },
  stepCard:     { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, borderWidth: 1, padding: 12, gap: 12, overflow: 'hidden' },
  stepNumWrap:  { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  stepNum:      { fontSize: 12, fontWeight: '900' as const, color: '#000', letterSpacing: 0.5 },
  stepBody:     { flex: 1, gap: 3 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepTitle:    { fontSize: 13, fontWeight: '800' as const },
  stepDesc:     { fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 16 },
  stepProgressBg:{ height: 2, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden', marginTop: 4 },
  stepProgressFill:{ height: '100%', borderRadius: 1 },

  aiWrap:       { flex: 1, justifyContent: 'center', gap: 8 },
  aiGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  aiCard:       { width: (SW - 48) / 3, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, padding: 10, alignItems: 'center', gap: 4 },
  aiIconWrap:   { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  aiValue:      { fontSize: 20, fontWeight: '900' as const, letterSpacing: -0.3 },
  aiLabel:      { fontSize: 10, fontWeight: '700' as const, color: '#fff', textAlign: 'center' as const },
  aiDesc:       { fontSize: 9, color: 'rgba(255,255,255,0.45)', textAlign: 'center' as const, lineHeight: 12 },
  aiBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, borderWidth: 1, padding: 10 },
  aiBannerText: { fontSize: 12, fontWeight: '700' as const, flex: 1 },

  modulesWrap:  { flex: 1, justifyContent: 'center', gap: 8 },
  moduleGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  moduleItem:   { alignItems: 'center', gap: 4, width: (SW - 40) / 4 - 7 },
  moduleIconBg: { width: 48, height: 48, borderRadius: 13, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  moduleLabel:  { fontSize: 9, fontWeight: '700' as const, textAlign: 'center' as const, letterSpacing: 0.2 },
  moduleBadge:  { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,196,140,0.1)', borderRadius: 10, padding: 9 },
  moduleBadgeText:{ fontSize: 11, color: '#00C48C', fontWeight: '700' as const, flex: 1 },

  statsWrap:    { flex: 1, justifyContent: 'center', gap: 8 },
  statsList:    { gap: 10 },
  statRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statValueBox: { width: 80, borderLeftWidth: 3, paddingLeft: 8 },
  statValue:    { fontSize: 17, fontWeight: '900' as const, letterSpacing: -0.3 },
  statLabel:    { fontSize: 9.5, color: 'rgba(255,255,255,0.45)', fontWeight: '600' as const, marginTop: 1 },
  statBarBg:    { flex: 1, height: 7, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' },
  statBarFill:  { height: '100%', borderRadius: 4 },

  revenueList:  { gap: 7 },
  revenueRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, padding: 10 },
  revenueIconWrap:{ width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  revenueBody:  { flex: 1, gap: 5 },
  revenueLabel: { fontSize: 12, fontWeight: '700' as const, color: '#fff' },
  revenueBarBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' },
  revenueBarFill:{ height: '100%', borderRadius: 2 },
  revenuePct:   { fontSize: 11, fontWeight: '800' as const, minWidth: 68, textAlign: 'right' as const },
  revenueSummary:{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,196,140,0.1)', borderRadius: 10, padding: 10, marginTop: 4 },
  revenueSummaryText:{ fontSize: 12, color: '#00C48C', fontWeight: '700' as const, flex: 1 },

  growthWrap:   { flex: 1, justifyContent: 'center', gap: 8 },
  growthChart:  { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingVertical: 12, gap: 6 },
  growthCol:    { alignItems: 'center', gap: 6, flex: 1 },
  growthTarget: { fontSize: 14, fontWeight: '900' as const, letterSpacing: -0.3 },
  growthBarCol: { alignItems: 'center', justifyContent: 'flex-end', height: 150 },
  growthBar:    { width: 32, borderRadius: 8 },
  growthPhaseTag:{ borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  growthPhase:  { fontSize: 11, fontWeight: '800' as const },
  growthLabel:  { fontSize: 9, color: 'rgba(255,255,255,0.45)', textAlign: 'center' as const },
  growthBenchmark:{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 10 },
  growthBenchmarkText:{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)', lineHeight: 17, textAlign: 'center' as const },
  growthEngines:{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  growthChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  growthChipText:{ fontSize: 10, fontWeight: '700' as const },

  tractionWrap: { flex: 1, justifyContent: 'center', gap: 10 },
  tractionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tractionCard: { width: (SW - 48) / 3, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center', gap: 5 },
  tractionIconWrap:{ width: 40, height: 40, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  tractionValue:{ fontSize: 18, fontWeight: '900' as const, letterSpacing: -0.3 },
  tractionLabel:{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', textAlign: 'center' as const, fontWeight: '600' as const },
  tractionBanner:{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, borderWidth: 1, padding: 12 },
  tractionBannerText:{ fontSize: 12, fontWeight: '700' as const, flex: 1 },

  closingWrap:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },
  closingGlow:  { position: 'absolute', width: SW * 1.2, height: SW * 1.2, borderRadius: SW * 0.6 },
  closingTitle: { fontSize: SW < 380 ? 32 : 38, fontWeight: '900' as const, textAlign: 'center' as const, lineHeight: SW < 380 ? 38 : 44 },
  closingSubtitle:{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center' as const, lineHeight: 20, maxWidth: SW - 50, marginBottom: 8 },
  closingStatsRow:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  closingStat:  { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, minWidth: (SW - 60) / 2 - 4 },
  closingStatV: { fontSize: 22, fontWeight: '900' as const, letterSpacing: -0.3 },
  closingStatL: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '600' as const, marginTop: 2 },
  closingActions:{ width: '100%', gap: 9, marginTop: 6 },
  closingCta:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 16 },
  closingCtaText:{ fontSize: 16, fontWeight: '900' as const, color: '#000', letterSpacing: 0.3 },
  closingSecondary:{ alignItems: 'center', paddingVertical: 10 },
  closingSecondaryText:{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '600' as const }});
