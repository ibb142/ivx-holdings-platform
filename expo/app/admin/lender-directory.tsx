import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  Dimensions,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Filter,
  Building2,
  Lock,
  Globe,
  Star,
  Mail,
  Phone,
  MapPin,
  TrendingUp,
  DollarSign,
  Users,
  ChevronRight,
  Landmark,
  Briefcase,
  Shield,
  CircleDot,
  X} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Lender, LenderType, LenderCategory, LenderStatus } from '@/types';
import { useLenders } from '@/lib/lender-context';
import { formatCurrencyCompact } from '@/lib/formatters';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const formatCurrency = (amount: number): string => formatCurrencyCompact(amount);

const STATUS_COLORS: Record<LenderStatus, string> = {
  active: Colors.success,
  inactive: Colors.textTertiary,
  prospect: Colors.accent,
  contacted: Colors.warning,
  interested: '#E879F9',
  committed: Colors.primary};

const STATUS_LABELS: Record<LenderStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  prospect: 'Prospect',
  contacted: 'Contacted',
  interested: 'Interested',
  committed: 'Committed'};

const CATEGORY_ICONS: Record<LenderCategory, React.ReactNode> = {
  bank: <Landmark size={14} color={Colors.text} />,
  credit_union: <Building2 size={14} color={Colors.text} />,
  hedge_fund: <TrendingUp size={14} color={Colors.text} />,
  private_equity: <Briefcase size={14} color={Colors.text} />,
  family_office: <Users size={14} color={Colors.text} />,
  reit: <Building2 size={14} color={Colors.text} />,
  pension_fund: <Shield size={14} color={Colors.text} />,
  insurance: <Shield size={14} color={Colors.text} />,
  individual: <Users size={14} color={Colors.text} />,
  crowdfunding: <Globe size={14} color={Colors.text} />};

const CATEGORY_LABELS: Record<LenderCategory, string> = {
  bank: 'Bank',
  credit_union: 'Credit Union',
  hedge_fund: 'Hedge Fund',
  private_equity: 'Private Equity',
  family_office: 'Family Office',
  reit: 'REIT',
  pension_fund: 'Pension Fund',
  insurance: 'Insurance',
  individual: 'Individual',
  crowdfunding: 'Crowdfunding'};

type FilterTab = 'all' | 'public' | 'private';

const LenderCard = React.memo(({ lender, onPress }: { lender: Lender; onPress: (id: string) => void }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, friction: 8 }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [scaleAnim]);

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.lenderCard}
        onPress={() => onPress(lender.id)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.typeIcon, { backgroundColor: lender.type === 'public' ? 'rgba(74,144,217,0.15)' : 'rgba(232,121,249,0.15)' }]}>
              {lender.type === 'public' ? <Globe size={16} color={Colors.accent} /> : <Lock size={16} color="#E879F9" />}
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>{lender.name}</Text>
              <View style={styles.categoryRow}>
                {CATEGORY_ICONS[lender.category]}
                <Text style={styles.categoryText}>{CATEGORY_LABELS[lender.category]}</Text>
              </View>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[lender.status]}20` }]}>
            <CircleDot size={8} color={STATUS_COLORS[lender.status]} />
            <Text style={[styles.statusText, { color: STATUS_COLORS[lender.status] }]}>
              {STATUS_LABELS[lender.status]}
            </Text>
          </View>
        </View>

        <Text style={styles.cardDescription} numberOfLines={2}>{lender.description}</Text>

        <View style={styles.cardMetrics}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>AUM</Text>
            <Text style={styles.metricValue}>{formatCurrency(lender.aum)}</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Invested</Text>
            <Text style={[styles.metricValue, { color: lender.totalInvested > 0 ? Colors.success : Colors.textTertiary }]}>
              {lender.totalInvested > 0 ? formatCurrency(lender.totalInvested) : '—'}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Rating</Text>
            <View style={styles.ratingRow}>
              {Array.from({ length: lender.rating }).map((_, i) => (
                <Star key={i} size={10} color={Colors.primary} fill={Colors.primary} />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.contactInfo}>
            <Text style={styles.contactName} numberOfLines={1}>{lender.contactName}</Text>
            <Text style={styles.contactTitle} numberOfLines={1}>{lender.contactTitle}</Text>
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.iconBtn}>
              <Mail size={16} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn}>
              <Phone size={16} color={Colors.success} />
            </TouchableOpacity>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </View>
        </View>

        {lender.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {lender.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function LenderDirectoryScreen() {
  const router = useRouter();
  const { allLenders, stats } = useLenders();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<LenderCategory | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<LenderStatus | 'all'>('all');

  const filteredLenders = useMemo(() => {
    let result = [...allLenders];

    if (activeTab !== 'all') {
      result = result.filter(l => l.type === activeTab);
    }
    if (selectedCategory !== 'all') {
      result = result.filter(l => l.category === selectedCategory);
    }
    if (selectedStatus !== 'all') {
      result = result.filter(l => l.status === selectedStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.country.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    }

    return result.sort((a, b) => b.aum - a.aum);
  }, [allLenders, activeTab, selectedCategory, selectedStatus, searchQuery]);

  const handleLenderPress = useCallback((id: string) => {
    console.log('[LenderDirectory] Lender pressed:', id);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedCategory('all');
    setSelectedStatus('all');
    setSearchQuery('');
  }, []);

  const categories: (LenderCategory | 'all')[] = ['all', 'bank', 'private_equity', 'hedge_fund', 'reit', 'family_office', 'pension_fund', 'insurance', 'credit_union', 'individual', 'crowdfunding'];
  const statuses: (LenderStatus | 'all')[] = ['all', 'active', 'interested', 'committed', 'contacted', 'prospect', 'inactive'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Lender Directory</Text>
        <TouchableOpacity
          style={[styles.filterToggle, showFilters && styles.filterToggleActive]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} color={showFilters ? Colors.background : Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: 'rgba(74,144,217,0.1)' }]}>
            <Globe size={18} color={Colors.accent} />
            <Text style={styles.statValue}>{stats.publicLenders}</Text>
            <Text style={styles.statLabel}>Public</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: 'rgba(232,121,249,0.1)' }]}>
            <Lock size={18} color="#E879F9" />
            <Text style={styles.statValue}>{stats.privateLenders}</Text>
            <Text style={styles.statLabel}>Private</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: 'rgba(0,196,140,0.1)' }]}>
            <DollarSign size={18} color={Colors.success} />
            <Text style={styles.statValue}>{formatCurrency(stats.totalInvested)}</Text>
            <Text style={styles.statLabel}>Invested</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: 'rgba(255,215,0,0.1)' }]}>
            <TrendingUp size={18} color={Colors.primary} />
            <Text style={styles.statValue}>{stats.totalImported}</Text>
            <Text style={styles.statLabel}>Imported</Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search lenders, contacts, cities..."
            placeholderTextColor={Colors.inputPlaceholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tabRow}>
          {(['all', 'public', 'private'] as FilterTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              {tab === 'public' && <Globe size={14} color={activeTab === tab ? Colors.background : Colors.textSecondary} />}
              {tab === 'private' && <Lock size={14} color={activeTab === tab ? Colors.background : Colors.textSecondary} />}
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'all' ? `All (${allLenders.length})` : tab === 'public' ? `Public (${stats.publicLenders})` : `Private (${stats.privateLenders})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {showFilters && (
          <View style={styles.filterSection}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>Filters</Text>
              <TouchableOpacity onPress={clearFilters}>
                <Text style={styles.clearFiltersText}>Clear all</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.filterChip, selectedCategory === cat && styles.filterChipActive]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text style={[styles.filterChipText, selectedCategory === cat && styles.filterChipTextActive]}>
                    {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.filterLabel, { marginTop: 12 }]}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              {statuses.map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[styles.filterChip, selectedStatus === st && styles.filterChipActive]}
                  onPress={() => setSelectedStatus(st)}
                >
                  {st !== 'all' && <CircleDot size={8} color={selectedStatus === st ? Colors.background : STATUS_COLORS[st]} />}
                  <Text style={[styles.filterChipText, selectedStatus === st && styles.filterChipTextActive]}>
                    {st === 'all' ? 'All' : STATUS_LABELS[st]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.resultHeader}>
          <Text style={styles.resultCount}>{filteredLenders.length} lender{filteredLenders.length !== 1 ? 's' : ''}</Text>
          <Text style={styles.sortLabel}>Sorted by AUM</Text>
        </View>

        <View style={styles.lenderList}>
          {filteredLenders.map((lender) => (
            <LenderCard key={lender.id} lender={lender} onPress={handleLenderPress} />
          ))}
        </View>

        {filteredLenders.length === 0 && (
          <View style={styles.emptyState}>
            <Search size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No lenders found</Text>
            <Text style={styles.emptyText}>Try adjusting your filters or search query</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  filterToggle: { padding: 8 },
  filterToggleActive: { backgroundColor: Colors.primary + '15', borderRadius: 8 },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  tabRow: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  filterSection: { marginBottom: 12 },
  filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  filterTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  clearFiltersText: { color: Colors.textSecondary, fontSize: 13 },
  filterLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 8 },
  filterScroll: { marginBottom: 12 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  resultCount: { gap: 8 },
  sortLabel: { color: Colors.textSecondary, fontSize: 13 },
  lenderList: { gap: 8 },
  lenderCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  cardTitleWrap: { gap: 4 },
  cardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryText: { color: Colors.textSecondary, fontSize: 13 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  cardDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  cardMetrics: { gap: 4 },
  metric: { gap: 4 },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  metricDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  contactInfo: { flex: 1 },
  contactName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  contactTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  iconBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: Colors.textSecondary, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptyText: { color: Colors.textTertiary, fontSize: 14 }});
