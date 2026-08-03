import React, { useState, useMemo, useCallback, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  Platform,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Globe,
  Lock,
  Star,
  MapPin,
  TrendingUp,
  DollarSign,
  Users,
  ChevronRight,
  Landmark,
  Briefcase,
  Shield,
  Building2,
  X,
  Download,
  ExternalLink,
  CheckCircle,
  Clock,
  Sparkles,
  Filter,
  Zap,
  RefreshCw,
  ChevronDown,
  AlertCircle,
  Database,
  FileText} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { LenderCategory } from '@/types';
import {
  DiscoveredLender,
  discoveredLenders,
  recentSearches,
  SEARCH_CATEGORIES,
  SEARCH_REGIONS,
  SUGGESTED_SEARCHES} from '@/mocks/lender-discovery';
import { LenderProvider, useLenders } from '@/lib/lender-context';
import { searchSECEdgar, SECSearchResult } from '@/lib/sec-edgar-service';
import { formatCurrencyCompact } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const formatCurrency = (amount: number): string => formatCurrencyCompact(amount);

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  google: { label: 'Google', color: '#4285F4' },
  sec_filing: { label: 'SEC Filing', color: '#00C48C' },
  sec_edgar: { label: 'SEC EDGAR', color: '#00C48C' }};

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

type SearchMode = 'web' | 'sec_edgar';

const DiscoveredCard = React.memo(({
  lender,
  onImport,
  imported}: {
  lender: DiscoveredLender;
  onImport: (id: string) => void;
  imported: boolean;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const sourceInfo = SOURCE_LABELS[lender.source] || { label: lender.source, color: Colors.textTertiary };

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, friction: 8 }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [scaleAnim]);

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.resultCard}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.sourceBadge}>
            <View style={[styles.sourceDot, { backgroundColor: sourceInfo.color }]} />
            <Text style={[styles.sourceText, { color: sourceInfo.color }]}>{sourceInfo.label}</Text>
          </View>
          <View style={styles.confidenceBadge}>
            <Zap size={10} color={lender.confidence >= 90 ? Colors.success : Colors.warning} />
            <Text style={[styles.confidenceText, {
              color: lender.confidence >= 90 ? Colors.success : Colors.warning}]}>
              {lender.confidence}% match
            </Text>
          </View>
        </View>

        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.typeIcon, {
              backgroundColor: lender.type === 'public' ? 'rgba(74,144,217,0.15)' : 'rgba(232,121,249,0.15)'}]}>
              {lender.type === 'public' ? <Globe size={16} color={Colors.accent} /> : <Lock size={16} color="#E879F9" />}
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>{lender.name}</Text>
              <Text style={styles.categoryLabel}>{CATEGORY_LABELS[lender.category]}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.cardDescription} numberOfLines={2}>{lender.description}</Text>

        <View style={styles.cardMetrics}>
          <View style={styles.metric}>
            <DollarSign size={12} color={Colors.primary} />
            <Text style={styles.metricLabel}>AUM</Text>
            <Text style={styles.metricValue}>{formatCurrency(lender.aum)}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metric}>
            <TrendingUp size={12} color={Colors.success} />
            <Text style={styles.metricLabel}>Min</Text>
            <Text style={styles.metricValue}>{formatCurrency(lender.minInvestment)}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metric}>
            <MapPin size={12} color={Colors.accent} />
            <Text style={styles.metricLabel}>HQ</Text>
            <Text style={styles.metricValue} numberOfLines={1}>{lender.city}</Text>
          </View>
        </View>

        <View style={styles.cardContactRow}>
          <View style={styles.contactInfo}>
            <Text style={styles.contactName}>{lender.contactName}</Text>
            <Text style={styles.contactTitle}>{lender.contactTitle}</Text>
          </View>
          {lender.website && (
            <TouchableOpacity style={styles.linkBtn}>
              <ExternalLink size={14} color={Colors.accent} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tagsRow}>
          {lender.preferredRegions.slice(0, 2).map((region) => (
            <View key={region} style={styles.regionTag}>
              <Globe size={9} color={Colors.textSecondary} />
              <Text style={styles.regionTagText}>{region}</Text>
            </View>
          ))}
          {lender.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.importBtn, imported && styles.importBtnDone]}
          onPress={() => !imported && onImport(lender.id)}
          disabled={imported}
        >
          {imported ? (
            <>
              <CheckCircle size={16} color={Colors.success} />
              <Text style={styles.importBtnDoneText}>Added to Directory</Text>
            </>
          ) : (
            <>
              <Download size={16} color={Colors.background} />
              <Text style={styles.importBtnText}>Import to Lender Directory</Text>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
});

const SECResultCard = React.memo(({
  result,
  onImport,
  imported}: {
  result: SECSearchResult;
  onImport: (result: SECSearchResult) => void;
  imported: boolean;
}) => {
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
        style={styles.resultCard}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <View style={styles.cardTopRow}>
          <View style={[styles.sourceBadge, { backgroundColor: 'rgba(0,196,140,0.1)' }]}>
            <Database size={10} color="#00C48C" />
            <Text style={[styles.sourceText, { color: '#00C48C' }]}>SEC EDGAR</Text>
          </View>
          <View style={styles.confidenceBadge}>
            <FileText size={10} color={Colors.success} />
            <Text style={[styles.confidenceText, { color: Colors.success }]}>
              CIK: {result.cik}
            </Text>
          </View>
        </View>

        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.typeIcon, {
              backgroundColor: result.type === 'public' ? 'rgba(74,144,217,0.15)' : 'rgba(232,121,249,0.15)'}]}>
              {result.type === 'public' ? <Globe size={16} color={Colors.accent} /> : <Lock size={16} color="#E879F9" />}
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>{result.name}</Text>
              <Text style={styles.categoryLabel}>{CATEGORY_LABELS[result.category]} - {result.sicDescription}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.cardDescription} numberOfLines={2}>{result.description}</Text>

        <View style={styles.cardMetrics}>
          <View style={styles.metric}>
            <DollarSign size={12} color={Colors.primary} />
            <Text style={styles.metricLabel}>Est. AUM</Text>
            <Text style={styles.metricValue}>{formatCurrency(result.aum)}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metric}>
            <MapPin size={12} color={Colors.accent} />
            <Text style={styles.metricLabel}>State</Text>
            <Text style={styles.metricValue}>{result.state || 'N/A'}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metric}>
            <Zap size={12} color={Colors.success} />
            <Text style={styles.metricLabel}>Match</Text>
            <Text style={styles.metricValue}>{result.confidence}%</Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {result.tags.slice(0, 3).map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: 'rgba(0,196,140,0.1)' }]}>
              <Text style={[styles.tagText, { color: '#00C48C' }]}>{tag}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.importBtn, imported && styles.importBtnDone, !imported && { backgroundColor: '#00C48C' }]}
          onPress={() => !imported && onImport(result)}
          disabled={imported}
        >
          {imported ? (
            <>
              <CheckCircle size={16} color={Colors.success} />
              <Text style={styles.importBtnDoneText}>Added to Directory</Text>
            </>
          ) : (
            <>
              <Download size={16} color="#fff" />
              <Text style={[styles.importBtnText, { color: '#fff' }]}>Import SEC Entity</Text>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
});

function LenderSearchScreenContent() {
  const router = useRouter();
  // Safe access: if the LenderProvider is ever missing from the tree, `useLenders()`
  // returns undefined. Guarding here turns a hard crash
  // ("Cannot read property 'importDiscoveredLender' of undefined") into a recoverable message.
  const lenderContext = useLenders();
  const importServiceUnavailable = !lenderContext;
  const importDiscoveredLender = lenderContext?.importDiscoveredLender;
  const importSECLender = lenderContext?.importSECLender;
  const importMultipleDiscovered = lenderContext?.importMultipleDiscovered;
  const importMultipleSEC = lenderContext?.importMultipleSEC;
  const isImported = useMemo(
    () => lenderContext?.isImported ?? ((_name: string) => false),
    [lenderContext]
  );

  const notifyImportUnavailable = useCallback(() => {
    Alert.alert('Import unavailable', 'Import service unavailable. Please retry after reload.');
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('web');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<LenderCategory | 'all'>('all');
  const [selectedRegion, setSelectedRegion] = useState('Global');
  const [showFilters, setShowFilters] = useState(false);
  const [showRegionPicker, setShowRegionPicker] = useState(false);
  const [localImportedIds, setLocalImportedIds] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<DiscoveredLender[]>([]);
  const [secResults, setSecResults] = useState<SECSearchResult[]>([]);
  const [secImportedCiks, setSecImportedCiks] = useState<string[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const handleWebSearch = useCallback(() => {
    if (!searchQuery.trim() && selectedCategory === 'all') return;

    setIsSearching(true);
    setHasSearched(false);
    startPulse();

    setTimeout(() => {
      let results = [...discoveredLenders];

      if (selectedCategory !== 'all') {
        results = results.filter(l => l.category === selectedCategory);
      }
      if (selectedRegion !== 'Global') {
        results = results.filter(l =>
          l.preferredRegions.some(r => r.toLowerCase().includes(selectedRegion.toLowerCase())) ||
          l.country.toLowerCase().includes(selectedRegion.toLowerCase())
        );
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        results = results.filter(l =>
          l.name.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.city.toLowerCase().includes(q) ||
          l.country.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q) ||
          l.tags.some(t => t.toLowerCase().includes(q))
        );
      }

      results.sort((a, b) => b.confidence - a.confidence);

      stopPulse();
      setSearchResults(results);
      setIsSearching(false);
      setHasSearched(true);
      console.log('[LenderSearch] Web search completed:', results.length, 'results');
    }, 2200);
  }, [searchQuery, selectedCategory, selectedRegion, startPulse, stopPulse]);

  const handleSECSearch = useCallback(async () => {
    const query = searchQuery.trim() || 'real estate lending';
    setIsSearching(true);
    setHasSearched(false);
    startPulse();

    try {
      console.log('[LenderSearch] SEC EDGAR search for:', query);
      const results = await searchSECEdgar(query);
      stopPulse();
      setSecResults(results);
      setIsSearching(false);
      setHasSearched(true);
      console.log('[LenderSearch] SEC search completed:', results.length, 'results');
    } catch (error) {
      console.log('[LenderSearch] SEC search error:', error);
      stopPulse();
      setSecResults([]);
      setIsSearching(false);
      setHasSearched(true);
    }
  }, [searchQuery, startPulse, stopPulse]);

  const handleSearch = useCallback(() => {
    if (searchMode === 'sec_edgar') {
      handleSECSearch();
    } else {
      handleWebSearch();
    }
  }, [searchMode, handleSECSearch, handleWebSearch]);

  const handleSuggestedSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setIsSearching(true);
    setHasSearched(false);

    setTimeout(() => {
      const results = [...discoveredLenders].sort((a, b) => b.confidence - a.confidence);
      setSearchResults(results);
      setIsSearching(false);
      setHasSearched(true);
    }, 2000);
  }, []);

  const handleImport = useCallback((id: string) => {
    const lender = discoveredLenders.find(l => l.id === id) || searchResults.find(l => l.id === id);
    if (!lender) return;

    Alert.alert(
      'Import Lender',
      'Add this lender to your directory? They will appear in Lender Directory and can receive AI Outreach emails.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            if (!importDiscoveredLender) {
              notifyImportUnavailable();
              return;
            }
            importDiscoveredLender(lender);
            setLocalImportedIds(prev => [...prev, id]);
            console.log('[LenderSearch] Lender imported to directory:', lender.name);
          }},
      ]
    );
  }, [searchResults, importDiscoveredLender, notifyImportUnavailable]);

  const handleSECImport = useCallback((result: SECSearchResult) => {
    Alert.alert(
      'Import SEC Entity',
      `Add "${result.name}" (CIK: ${result.cik}) to your lender directory? This is real SEC-registered data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            if (!importSECLender) {
              notifyImportUnavailable();
              return;
            }
            importSECLender(result);
            setSecImportedCiks(prev => [...prev, result.cik]);
            console.log('[LenderSearch] SEC entity imported:', result.name);
          }},
      ]
    );
  }, [importSECLender, notifyImportUnavailable]);

  const handleImportAll = useCallback(() => {
    if (searchMode === 'sec_edgar') {
      const notImported = secResults.filter(r => !secImportedCiks.includes(r.cik) && !isImported(r.name));
      if (notImported.length === 0) return;

      Alert.alert(
        'Import All SEC Entities',
        `Add ${notImported.length} SEC-registered entities to your directory?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import All',
            onPress: () => {
              if (!importMultipleSEC) {
                notifyImportUnavailable();
                return;
              }
              const count = importMultipleSEC(notImported);
              setSecImportedCiks(prev => [...prev, ...notImported.map(r => r.cik)]);
              console.log('[LenderSearch] Bulk SEC import:', count, 'entities');
            }},
        ]
      );
    } else {
      const notImported = searchResults.filter(l => !localImportedIds.includes(l.id) && !isImported(l.name));
      if (notImported.length === 0) return;

      Alert.alert(
        'Import All Lenders',
        `Add ${notImported.length} lender${notImported.length !== 1 ? 's' : ''} to your directory?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import All',
            onPress: () => {
              if (!importMultipleDiscovered) {
                notifyImportUnavailable();
                return;
              }
              const count = importMultipleDiscovered(notImported);
              setLocalImportedIds(prev => [...prev, ...notImported.map(l => l.id)]);
              console.log('[LenderSearch] Bulk import:', count, 'lenders');
            }},
        ]
      );
    }
  }, [searchMode, secResults, secImportedCiks, searchResults, localImportedIds, isImported, importMultipleSEC, importMultipleDiscovered, notifyImportUnavailable]);

  const importedCount = useMemo(() => {
    if (searchMode === 'sec_edgar') {
      return secResults.filter(r => secImportedCiks.includes(r.cik) || isImported(r.name)).length;
    }
    return searchResults.filter(l => localImportedIds.includes(l.id) || isImported(l.name)).length;
  }, [searchMode, searchResults, localImportedIds, secResults, secImportedCiks, isImported]);

  const totalResults = searchMode === 'sec_edgar' ? secResults.length : searchResults.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Lender Discovery</Text>
          <View style={styles.googleBadge}>
            {searchMode === 'sec_edgar' ? (
              <>
                <Database size={10} color="#00C48C" />
                <Text style={[styles.googleBadgeText, { color: '#00C48C' }]}>SEC EDGAR - Real Data</Text>
              </>
            ) : (
              <>
                <Globe size={10} color="#4285F4" />
                <Text style={styles.googleBadgeText}>Web Search Powered</Text>
              </>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.filterToggle, showFilters && styles.filterToggleActive]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} color={showFilters ? Colors.background : Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, searchMode === 'web' && styles.modeBtnActive]}
            onPress={() => { setSearchMode('web'); setHasSearched(false); }}
          >
            <Globe size={14} color={searchMode === 'web' ? Colors.background : Colors.textSecondary} />
            <Text style={[styles.modeBtnText, searchMode === 'web' && styles.modeBtnTextActive]}>Web Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, searchMode === 'sec_edgar' && styles.modeBtnActiveSEC]}
            onPress={() => { setSearchMode('sec_edgar'); setHasSearched(false); }}
          >
            <Database size={14} color={searchMode === 'sec_edgar' ? '#fff' : Colors.textSecondary} />
            <Text style={[styles.modeBtnText, searchMode === 'sec_edgar' && { color: '#fff' }]}>SEC EDGAR</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchBox}>
            <Search size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchMode === 'sec_edgar' ? 'Search SEC registered entities...' : 'Search private lenders, firms, investors...'}
              placeholderTextColor={Colors.inputPlaceholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.searchBtn,
              isSearching && styles.searchBtnDisabled,
              searchMode === 'sec_edgar' && { backgroundColor: '#00C48C' },
            ]}
            onPress={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? (
              <ShimmerIndicator color="#fff" size="small" />
            ) : (
              <>
                {searchMode === 'sec_edgar' ? <Database size={18} color="#fff" /> : <Search size={18} color={Colors.background} />}
                <Text style={[styles.searchBtnText, { color: '#fff' }]}>
                  {searchMode === 'sec_edgar' ? 'Search SEC EDGAR' : 'Search Web'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {searchMode === 'web' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryScrollContent}>
            {SEARCH_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[styles.catChip, selectedCategory === cat.value && styles.catChipActive]}
                onPress={() => setSelectedCategory(cat.value)}
              >
                {cat.value === 'private_equity' && <Briefcase size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                {cat.value === 'family_office' && <Users size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                {cat.value === 'hedge_fund' && <TrendingUp size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                {cat.value === 'bank' && <Landmark size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                {cat.value === 'reit' && <Building2 size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                {cat.value === 'pension_fund' && <Shield size={13} color={selectedCategory === cat.value ? Colors.background : Colors.textSecondary} />}
                <Text style={[styles.catChipText, selectedCategory === cat.value && styles.catChipTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {searchMode === 'sec_edgar' && !hasSearched && !isSearching && (
          <View style={styles.secInfoCard}>
            <Database size={20} color="#00C48C" />
            <View style={styles.secInfoContent}>
              <Text style={styles.secInfoTitle}>SEC EDGAR - Real Lender Data</Text>
              <Text style={styles.secInfoText}>
                Search the U.S. Securities and Exchange Commission's EDGAR database for real, registered investment entities. Results include CIK numbers, SIC codes, and verified filing data. No API key needed.
              </Text>
              <View style={styles.secQuickSearches}>
                <Text style={styles.secQuickLabel}>Quick searches:</Text>
                {['real estate trust', 'mortgage', 'investment fund', 'capital management'].map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.secQuickBtn}
                    onPress={() => { setSearchQuery(q); }}
                  >
                    <Text style={styles.secQuickBtnText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {showFilters && searchMode === 'web' && (
          <View style={styles.filterPanel}>
            <Text style={styles.filterLabel}>Region</Text>
            <TouchableOpacity
              style={styles.regionSelect}
              onPress={() => setShowRegionPicker(!showRegionPicker)}
            >
              <MapPin size={16} color={Colors.primary} />
              <Text style={styles.regionSelectText}>{selectedRegion}</Text>
              <ChevronDown size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {showRegionPicker && (
              <ScrollView style={styles.regionList} nestedScrollEnabled>
                {SEARCH_REGIONS.map((region) => (
                  <TouchableOpacity
                    key={region}
                    style={[styles.regionOption, selectedRegion === region && styles.regionOptionActive]}
                    onPress={() => {
                      setSelectedRegion(region);
                      setShowRegionPicker(false);
                    }}
                  >
                    <Text style={[styles.regionOptionText, selectedRegion === region && styles.regionOptionTextActive]}>
                      {region}
                    </Text>
                    {selectedRegion === region && <CheckCircle size={14} color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {isSearching && (
          <View style={styles.searchingState}>
            <Animated.View style={{ opacity: pulseAnim }}>
              <View style={[styles.searchingIcon, searchMode === 'sec_edgar' && { backgroundColor: 'rgba(0,196,140,0.12)' }]}>
                {searchMode === 'sec_edgar' ? <Database size={32} color="#00C48C" /> : <Globe size={32} color="#4285F4" />}
              </View>
            </Animated.View>
            <Text style={styles.searchingTitle}>
              {searchMode === 'sec_edgar' ? 'Searching SEC EDGAR...' : 'Searching the web...'}
            </Text>
            <Text style={styles.searchingSubtitle}>
              {searchMode === 'sec_edgar'
                ? 'Querying SEC EDGAR full-text search for registered entities'
                : 'Scanning Google & SEC filings (free sources only)'}
            </Text>
          </View>
        )}

        {!hasSearched && !isSearching && searchMode === 'web' && (
          <>
            <View style={styles.suggestedSection}>
              <View style={styles.suggestedHeader}>
                <Sparkles size={16} color={Colors.primary} />
                <Text style={styles.suggestedTitle}>Suggested Searches</Text>
              </View>
              {SUGGESTED_SEARCHES.map((query, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.suggestedItem}
                  onPress={() => handleSuggestedSearch(query)}
                >
                  <Search size={14} color={Colors.textTertiary} />
                  <Text style={styles.suggestedText} numberOfLines={1}>{query}</Text>
                  <ChevronRight size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Clock size={16} color={Colors.textSecondary} />
                <Text style={styles.recentTitle}>Recent Searches</Text>
              </View>
              {recentSearches.map((search) => (
                <TouchableOpacity
                  key={search.id}
                  style={styles.recentItem}
                  onPress={() => handleSuggestedSearch(search.query)}
                >
                  <View style={styles.recentItemLeft}>
                    <RefreshCw size={12} color={Colors.textTertiary} />
                    <View>
                      <Text style={styles.recentQuery} numberOfLines={1}>{search.query}</Text>
                      <Text style={styles.recentMeta}>
                        {search.resultsCount} results · {new Date(search.searchedAt).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.infoCard}>
              <AlertCircle size={18} color={Colors.accent} />
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardTitle}>How it works</Text>
                <Text style={styles.infoCardText}>
                  Search the web for private lenders, institutional investors, family offices, and more. Import discovered lenders into your directory, then use AI Outreach to send personalized investment invitations.
                </Text>
              </View>
            </View>
          </>
        )}

        {hasSearched && !isSearching && (
          <>
            <View style={styles.resultsHeader}>
              <View>
                <Text style={styles.resultsCount}>
                  {totalResults} {searchMode === 'sec_edgar' ? 'entit' : 'lender'}{totalResults !== 1 ? (searchMode === 'sec_edgar' ? 'ies' : 's') : (searchMode === 'sec_edgar' ? 'y' : '')} found
                </Text>
                <Text style={styles.resultsSubtext}>
                  {searchMode === 'sec_edgar'
                    ? 'From SEC EDGAR full-text search database'
                    : 'From Google & SEC filings (free sources)'}
                </Text>
              </View>
              {totalResults > 0 && (
                <TouchableOpacity style={styles.importAllBtn} onPress={handleImportAll}>
                  <Download size={14} color={Colors.primary} />
                  <Text style={styles.importAllText}>
                    {importedCount === totalResults ? 'All Imported' : 'Import All'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {importedCount > 0 && (
              <View style={styles.importedBanner}>
                <CheckCircle size={16} color={Colors.success} />
                <Text style={styles.importedBannerText}>
                  {importedCount} {searchMode === 'sec_edgar' ? 'entit' : 'lender'}{importedCount !== 1 ? (searchMode === 'sec_edgar' ? 'ies' : 's') : (searchMode === 'sec_edgar' ? 'y' : '')} imported to your directory
                </Text>
              </View>
            )}

            <View style={styles.resultsList}>
              {searchMode === 'sec_edgar' ? (
                secResults.map((result) => (
                  <SECResultCard
                    key={result.id}
                    result={result}
                    onImport={handleSECImport}
                    imported={secImportedCiks.includes(result.cik) || isImported(result.name)}
                  />
                ))
              ) : (
                searchResults.map((lender) => (
                  <DiscoveredCard
                    key={lender.id}
                    lender={lender}
                    onImport={handleImport}
                    imported={localImportedIds.includes(lender.id) || isImported(lender.name)}
                  />
                ))
              )}
            </View>

            {totalResults === 0 && (
              <View style={styles.emptyState}>
                <Search size={48} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No {searchMode === 'sec_edgar' ? 'entities' : 'lenders'} found</Text>
                <Text style={styles.emptyText}>
                  {searchMode === 'sec_edgar'
                    ? 'Try different keywords like "real estate trust" or "mortgage"'
                    : 'Try different keywords, category, or region'}
                </Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  googleBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  googleBadgeText: { fontSize: 11, fontWeight: '700' as const },
  filterToggle: { padding: 8 },
  filterToggleActive: { backgroundColor: Colors.primary + '15', borderRadius: 8 },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  modeToggle: { gap: 4 },
  modeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  modeBtnActiveSEC: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  modeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  modeBtnTextActive: { color: '#000' },
  searchSection: { marginBottom: 16 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  searchBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  searchBtnDisabled: { opacity: 0.4 },
  searchBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  categoryScroll: { gap: 8 },
  categoryScrollContent: { flex: 1, gap: 4 },
  catChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { color: Colors.textSecondary, fontSize: 13 },
  catChipTextActive: { color: Colors.black },
  secInfoCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  secInfoContent: { flex: 1, gap: 4 },
  secInfoTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  secInfoText: { color: Colors.textSecondary, fontSize: 13 },
  secQuickSearches: { gap: 4 },
  secQuickLabel: { color: Colors.textSecondary, fontSize: 13 },
  secQuickBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  secQuickBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  filterPanel: { gap: 4 },
  filterLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 8 },
  regionSelect: { gap: 4 },
  regionSelectText: { color: Colors.textSecondary, fontSize: 13 },
  regionList: { gap: 8 },
  regionOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  regionOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  regionOptionText: { color: Colors.textSecondary, fontSize: 13 },
  regionOptionTextActive: { color: Colors.primary },
  searchingState: { gap: 4 },
  searchingIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  searchingTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  searchingSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  suggestedSection: { marginBottom: 16 },
  suggestedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  suggestedTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  suggestedItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  suggestedText: { color: Colors.textSecondary, fontSize: 13 },
  recentSection: { marginBottom: 16 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  recentTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  recentItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  recentItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  recentQuery: { gap: 4 },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoCardContent: { flexDirection: 'row', gap: 10 },
  infoCardTitle: { color: Colors.info, fontSize: 14, fontWeight: '700' as const, marginBottom: 4 },
  infoCardText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  resultsCount: { gap: 8 },
  resultsSubtext: { color: Colors.textSecondary, fontSize: 13 },
  importAllBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  importAllText: { color: Colors.textSecondary, fontSize: 13 },
  importedBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  importedBannerText: { color: Colors.textSecondary, fontSize: 13 },
  resultsList: { gap: 8 },
  resultCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceText: { color: Colors.textSecondary, fontSize: 13 },
  confidenceBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  confidenceText: { color: Colors.textSecondary, fontSize: 13 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  cardTitleWrap: { gap: 4 },
  cardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  categoryLabel: { color: Colors.textSecondary, fontSize: 13 },
  cardDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  cardMetrics: { gap: 4 },
  metric: { gap: 4 },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  metricSep: { gap: 4 },
  cardContactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactInfo: { flex: 1 },
  contactName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  contactTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  linkBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  regionTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  regionTagText: { color: Colors.textSecondary, fontSize: 13 },
  tag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: Colors.textSecondary, fontSize: 13 },
  importBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  importBtnDone: { gap: 4 },
  importBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  importBtnDoneText: { color: Colors.textSecondary, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptyText: { color: Colors.textTertiary, fontSize: 14 }});
