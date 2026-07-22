import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Modal,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  Building2,
  DollarSign,
  TrendingUp,
  Handshake,
  Home,
  Zap,
  RefreshCw,
  Copy,
  Layers,
  Brain,
  ChevronRight,
  X,
  CheckCircle2,
  Lock,
  Percent,
  Clock,
  Shield,
  Star,
} from 'lucide-react-native';
import Colors from '@/constants/colors';

interface ToolStat {
  label: string;
  value: string;
}

interface ProfitTool {
  id: number;
  iconBg: string;
  accentColor: string;
  title: string;
  subtitle: string;
  stats: ToolStat[];
  audience: 'lender' | 'investor' | 'both';
  description: string;
  benefits: string[];
  minInvestment: string;
  expectedReturn: string;
  term: string;
}

const TOOLS: ProfitTool[] = [
  {
    id: 1,
    iconBg: Colors.success + '20',
    accentColor: Colors.success,
    title: 'Private Mortgage Lending',
    subtitle: 'Lend directly against real estate with 1st lien protection',
    stats: [
      { label: 'Avg. Yield', value: '10–14%' },
      { label: 'LTV', value: '≤85%' },
      { label: 'Term', value: '6–24 mo' },
    ],
    audience: 'lender',
    description: 'Act as the bank. You fund short-term property loans secured by a first lien on real estate. If the borrower defaults, you own the property.',
    benefits: [
      'First lien security — senior to all other claims',
      'Monthly interest payments directly to you',
      'Title insurance protects your position',
      'Professionally underwritten deals only',
    ],
    minInvestment: '$25,000',
    expectedReturn: '10–14% APR',
    term: '6–24 months',
  },
  {
    id: 2,
    iconBg: Colors.gold + '20',
    accentColor: Colors.gold,
    title: 'Fractional Property Ownership',
    subtitle: 'Own shares of premium income-generating properties',
    stats: [
      { label: 'Min. Buy-in', value: '$100' },
      { label: 'Rental Yield', value: '6–9%' },
      { label: 'Appreciation', value: '+12% avg' },
    ],
    audience: 'investor',
    description: 'Buy fractional shares of vetted real estate assets. Earn proportional rental income and benefit from property value appreciation — no landlord headaches.',
    benefits: [
      'Start with as little as $100',
      'Monthly rental distributions',
      'Diversify across multiple properties',
      'Professionally managed assets',
    ],
    minInvestment: '$100',
    expectedReturn: '6–9% rental + appreciation',
    term: 'Ongoing / liquid',
  },
  {
    id: 3,
    iconBg: Colors.info + '20',
    accentColor: Colors.info,
    title: 'Tokenized Debt Acquisition',
    subtitle: 'Buy discounted mortgage notes at 60–80 cents on the dollar',
    stats: [
      { label: 'Discount', value: '20–40%' },
      { label: 'IRR', value: '15–22%' },
      { label: 'Backed by', value: 'Real Estate' },
    ],
    audience: 'lender',
    description: 'Purchase non-performing or performing mortgage notes below face value. Resolve them through reinstatement, modification, or foreclosure for significant returns.',
    benefits: [
      'Buy at a deep discount = built-in equity',
      'Multiple exit strategies available',
      'Blockchain-tokenized for transparency',
      'Legal title chain fully verified',
    ],
    minInvestment: '$10,000',
    expectedReturn: '15–22% IRR',
    term: '12–36 months',
  },
  {
    id: 4,
    iconBg: Colors.gold + '20',
    accentColor: Colors.gold,
    title: 'Land Partnership Program',
    subtitle: 'Partner with developers — land + capital = profit split',
    stats: [
      { label: 'Cash Back', value: '60%' },
      { label: 'Profit Split', value: '30%' },
      { label: 'Timeline', value: '30 mo' },
    ],
    audience: 'both',
    description: 'Bring land or capital to a development deal. Receive 60% of your investment back in cash, then share 30% of the net development profit at completion.',
    benefits: [
      '60% capital return within 12 months',
      '30% share of net development profit',
      'Professional project management included',
      'Clear legal structure and milestones',
    ],
    minInvestment: '$50,000',
    expectedReturn: '30% net profit share',
    term: '24–36 months',
  },
  {
    id: 5,
    iconBg: Colors.teal + '20',
    accentColor: Colors.teal,
    title: 'Rental Income Sharing',
    subtitle: 'Earn passive monthly distributions from rental cash flow',
    stats: [
      { label: 'Payout', value: 'Monthly' },
      { label: 'Yield', value: '7–10%' },
      { label: 'Occupancy', value: '>92%' },
    ],
    audience: 'investor',
    description: 'Pool capital with other investors into high-occupancy rental properties. Receive your pro-rata share of net rental income every month, deposited directly to your wallet.',
    benefits: [
      'Monthly passive income, no work required',
      'Portfolio of multiple rental units',
      'Professional property management',
      'Full financial transparency & reporting',
    ],
    minInvestment: '$500',
    expectedReturn: '7–10% annual yield',
    term: 'Open-ended',
  },
  {
    id: 6,
    iconBg: Colors.coral + '20',
    accentColor: Colors.coral,
    title: 'Bridge Loan Financing',
    subtitle: 'Short-term high-yield loans for fix-and-flip investors',
    stats: [
      { label: 'Rate', value: '12–16%' },
      { label: 'LTV', value: '≤75%' },
      { label: 'Term', value: '3–12 mo' },
    ],
    audience: 'lender',
    description: 'Fund experienced real estate investors who need fast capital for acquisitions and renovations. Earn premium interest rates on short-duration secured loans.',
    benefits: [
      'High interest rates for short commitment',
      'Secured against the subject property',
      'Borrowers are pre-vetted professionals',
      'Exit via payoff, sale, or refinance',
    ],
    minInvestment: '$15,000',
    expectedReturn: '12–16% APR',
    term: '3–12 months',
  },
  {
    id: 7,
    iconBg: Colors.success + '20',
    accentColor: Colors.success,
    title: 'Auto-Reinvestment Engine',
    subtitle: 'Compound your returns automatically — set and forget',
    stats: [
      { label: 'Compounding', value: 'Monthly' },
      { label: 'Boost', value: '+3.2%/yr' },
      { label: 'Effort', value: 'Zero' },
    ],
    audience: 'investor',
    description: 'Enable auto-reinvest and every payout is automatically deployed back into new investments. Harness the power of compounding to grow wealth significantly faster.',
    benefits: [
      'No manual action required',
      'Compound interest grows your base faster',
      'Customize reinvestment rules by asset type',
      'Pause or adjust anytime',
    ],
    minInvestment: '$0 (add-on feature)',
    expectedReturn: '+3.2% annual compound boost',
    term: 'Continuous',
  },
  {
    id: 8,
    iconBg: Colors.purple + '20',
    accentColor: Colors.purple,
    title: 'Copy Investing',
    subtitle: 'Mirror the exact portfolio of top-performing investors',
    stats: [
      { label: 'Top Returns', value: '+28%' },
      { label: 'Leaders', value: '50+' },
      { label: 'Sync', value: 'Real-time' },
    ],
    audience: 'investor',
    description: 'Select a verified top investor and automatically replicate their positions proportionally. No research needed — let the experts work for you.',
    benefits: [
      'Access institutional-level strategies',
      'Proportional allocation mirrors their moves',
      'Full transparency into their portfolio',
      'Switch or stop copying anytime',
    ],
    minInvestment: '$250',
    expectedReturn: 'Mirrors selected investor',
    term: 'Flexible',
  },
  {
    id: 9,
    iconBg: Colors.gold + '20',
    accentColor: Colors.gold,
    title: 'IVXHOLDINGS Yield Farming',
    subtitle: 'Earn a share of all platform transaction fees via IVXHOLDINGS holdings',
    stats: [
      { label: 'Fee Share', value: '0.5–2%' },
      { label: 'Paid in', value: 'IVXHOLDINGS' },
      { label: 'Frequency', value: 'Weekly' },
    ],
    audience: 'both',
    description: 'Hold IVXHOLDINGS tokens and earn a proportional share of every transaction fee generated on the platform. The more the platform grows, the more you earn.',
    benefits: [
      'Passive income from platform growth',
      'No lock-up required',
      'Rewards compound as platform scales',
      'Transparent on-chain fee distribution',
    ],
    minInvestment: '$50 (IVXHOLDINGS tokens)',
    expectedReturn: 'Variable — grows with platform',
    term: 'Indefinite',
  },
  {
    id: 10,
    iconBg: Colors.warning + '20',
    accentColor: Colors.warning,
    title: 'Smart Portfolio Builder',
    subtitle: 'AI builds and rebalances your ideal investment mix',
    stats: [
      { label: 'AI Models', value: '3 tiers' },
      { label: 'Rebalance', value: 'Auto' },
      { label: 'Avg. Return', value: '+18%' },
    ],
    audience: 'investor',
    description: 'Answer 5 questions about your goals and risk tolerance. Our AI constructs an optimized portfolio across all available asset classes and rebalances it continuously.',
    benefits: [
      'Personalized to your risk profile',
      'Diversified across debt, equity & yield',
      'Automatic rebalancing keeps you on track',
      'Performance benchmarked & reported weekly',
    ],
    minInvestment: '$500',
    expectedReturn: '15–22% blended annual',
    term: 'Long-term optimized',
  },
];

const TOOL_ICONS: Record<number, React.ReactNode> = {
  1: <Building2 size={26} color={Colors.success} />,
  2: <Layers size={26} color={Colors.gold} />,
  3: <DollarSign size={26} color={Colors.info} />,
  4: <Handshake size={26} color={Colors.gold} />,
  5: <Home size={26} color={Colors.teal} />,
  6: <Zap size={26} color={Colors.coral} />,
  7: <RefreshCw size={26} color={Colors.success} />,
  8: <Copy size={26} color={Colors.purple} />,
  9: <TrendingUp size={26} color={Colors.gold} />,
  10: <Brain size={26} color={Colors.warning} />,
};

const AUDIENCE_COLORS = {
  lender: { bg: Colors.success + '20', text: Colors.success, label: 'Private Lender' },
  investor: { bg: Colors.gold + '20', text: Colors.gold, label: 'Regular Investor' },
  both: { bg: Colors.info + '20', text: Colors.info, label: 'Lender & Investor' },
};

function ToolCard({ tool, onPress }: { tool: ProfitTool; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start();
  };

  const aud = AUDIENCE_COLORS[tool.audience];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.toolCard}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        testID={`tool-card-${tool.id}`}
      >
        <View style={styles.toolCardTop}>
          <View style={styles.toolCardLeft}>
            <View style={[styles.toolIconBox, { backgroundColor: tool.iconBg }]}>
              {TOOL_ICONS[tool.id]}
            </View>
            <View style={styles.toolNumberBadge}>
              <Text style={styles.toolNumberText}>{tool.id < 10 ? `0${tool.id}` : `${tool.id}`}</Text>
            </View>
          </View>
          <View style={styles.toolCardMeta}>
            <View style={styles.toolBadgeRow}>
              <View style={[styles.audienceBadge, { backgroundColor: aud.bg }]}>
                <Text style={[styles.audienceBadgeText, { color: aud.text }]}>{aud.label}</Text>
              </View>
            </View>
            <Text style={styles.toolTitle}>{tool.title}</Text>
            <Text style={styles.toolSubtitle}>{tool.subtitle}</Text>
          </View>
        </View>

        <View style={styles.toolStats}>
          {tool.stats.map((stat, i) => (
            <View key={i} style={styles.toolStat}>
              <Text style={[styles.toolStatValue, { color: tool.accentColor }]}>{stat.value}</Text>
              <Text style={styles.toolStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.toolCardFooter}>
          <Text style={[styles.learnMore, { color: tool.accentColor }]}>Learn more</Text>
          <ChevronRight size={16} color={tool.accentColor} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function ToolDetailModal({ tool, onClose }: { tool: ProfitTool; onClose: () => void }) {
  const aud = AUDIENCE_COLORS[tool.audience];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBox, { backgroundColor: tool.iconBg }]}>
                {TOOL_ICONS[tool.id]}
              </View>
              <TouchableOpacity style={styles.modalClose} onPress={onClose}>
                <X size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.audienceBadge, { backgroundColor: aud.bg, alignSelf: 'flex-start' as const, marginBottom: 10 }]}>
              <Text style={[styles.audienceBadgeText, { color: aud.text }]}>{aud.label}</Text>
            </View>

            <Text style={styles.modalTitle}>{tool.title}</Text>
            <Text style={styles.modalDesc}>{tool.description}</Text>

            <View style={styles.modalMetaRow}>
              <View style={[styles.modalMetaCard, { borderColor: tool.accentColor + '40' }]}>
                <DollarSign size={16} color={tool.accentColor} />
                <Text style={styles.modalMetaLabel}>Min. Investment</Text>
                <Text style={[styles.modalMetaValue, { color: tool.accentColor }]}>{tool.minInvestment}</Text>
              </View>
              <View style={[styles.modalMetaCard, { borderColor: tool.accentColor + '40' }]}>
                <TrendingUp size={16} color={tool.accentColor} />
                <Text style={styles.modalMetaLabel}>Expected Return</Text>
                <Text style={[styles.modalMetaValue, { color: tool.accentColor }]}>{tool.expectedReturn}</Text>
              </View>
              <View style={[styles.modalMetaCard, { borderColor: tool.accentColor + '40' }]}>
                <Clock size={16} color={tool.accentColor} />
                <Text style={styles.modalMetaLabel}>Term</Text>
                <Text style={[styles.modalMetaValue, { color: tool.accentColor }]}>{tool.term}</Text>
              </View>
            </View>

            <Text style={styles.benefitsTitle}>Key Benefits</Text>
            {tool.benefits.map((b, i) => (
              <View key={i} style={styles.benefitRow}>
                <CheckCircle2 size={16} color={tool.accentColor} />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}

            <View style={styles.modalBottomPad} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function ProfitToolsScreen() {
  const [selectedTool, setSelectedTool] = useState<ProfitTool | null>(null);
  const [filter, setFilter] = useState<'all' | 'lender' | 'investor'>('all');

  const filtered = TOOLS.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'lender') return t.audience === 'lender' || t.audience === 'both';
    if (filter === 'investor') return t.audience === 'investor' || t.audience === 'both';
    return true;
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '10 Profit Tools', headerShown: true }} />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroIconRow}>
            <Shield size={20} color={Colors.success} />
            <Star size={20} color={Colors.primary} />
            <TrendingUp size={20} color={Colors.info} />
          </View>
          <Text style={styles.heroTitle}>10 Ways to Profit</Text>
          <Text style={styles.heroSubtitle}>
            Curated tools for private lenders and investors to build wealth through real estate
          </Text>
          <View style={styles.heroBadges}>
            <View style={styles.heroBadge}>
              <Lock size={12} color={Colors.success} />
              <Text style={styles.heroBadgeText}>Asset-Backed</Text>
            </View>
            <View style={styles.heroBadge}>
              <Percent size={12} color={Colors.primary} />
              <Text style={styles.heroBadgeText}>Up to 22% Returns</Text>
            </View>
            <View style={styles.heroBadge}>
              <CheckCircle2 size={12} color={Colors.info} />
              <Text style={styles.heroBadgeText}>Vetted Deals</Text>
            </View>
          </View>
        </View>

        <View style={styles.filterRow}>
          {(['all', 'lender', 'investor'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
              testID={`filter-${f}`}
            >
              <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
                {f === 'all' ? 'All Tools' : f === 'lender' ? 'Private Lender' : 'Investor'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.listSection}>
          {filtered.map(tool => (
            <ToolCard key={tool.id} tool={tool} onPress={() => setSelectedTool(tool)} />
          ))}
        </View>

        <View style={styles.disclaimerCard}>
          <Shield size={16} color={Colors.textTertiary} />
          <Text style={styles.disclaimerText}>
            All investments carry risk. Returns shown are targets based on historical performance. Past results do not guarantee future returns. Always consult a licensed financial advisor.
          </Text>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      {selectedTool !== null && (
        <ToolDetailModal tool={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  heroCard: {
    margin: 20,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.success + '30',
    alignItems: 'center',
  },
  heroIconRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  heroTitle: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '900' as const,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  heroBadges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  heroBadgeText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  filterRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: 'center',
  },
  filterBtnActive: {
    backgroundColor: Colors.primary,
  },
  filterBtnText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  filterBtnTextActive: {
    color: Colors.black,
    fontWeight: '800' as const,
  },
  listSection: {
    paddingHorizontal: 20,
    gap: 14,
  },
  toolCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  toolCardTop: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  toolCardLeft: {
    position: 'relative',
  },
  toolIconBox: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolNumberBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  toolNumberText: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '800' as const,
  },
  toolCardMeta: {
    flex: 1,
  },
  toolBadgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  audienceBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  audienceBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  toolTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    marginBottom: 3,
    lineHeight: 20,
  },
  toolSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  toolStats: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  toolStat: {
    flex: 1,
    alignItems: 'center',
  },
  toolStatValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    marginBottom: 2,
  },
  toolStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '500' as const,
  },
  toolCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'flex-end',
  },
  learnMore: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  disclaimerCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  disclaimerText: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  bottomPad: {
    height: 120,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    maxHeight: '88%' as const,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalIconBox: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '900' as const,
    marginBottom: 10,
    lineHeight: 28,
  },
  modalDesc: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },
  modalMetaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  modalMetaCard: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  modalMetaLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    fontWeight: '500' as const,
  },
  modalMetaValue: {
    fontSize: 12,
    fontWeight: '800' as const,
    textAlign: 'center',
  },
  benefitsTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    marginBottom: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  benefitText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  modalBottomPad: {
    height: 30,
  },
});
