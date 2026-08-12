/**
 * IVX Knowledge Base — Main Screen
 *
 * Searchable grid of 10 knowledge categories with article counts.
 * Accessible from Profile tab → "Knowledge Base".
 */
import React, { useMemo, useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  useWindowDimensions,
  FlatList} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  X,
  Network,
  Users,
  TrendingUp,
  FileText,
  Briefcase,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Shield,
  ChevronRight,
  Clock,
  BookOpen} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  KB_CATEGORIES,
  KB_ARTICLES,
  KB_TOTAL_ARTICLES,
  KB_TOTAL_CATEGORIES,
  searchArticles,
  getCategoryById,
  type KBCategory} from '@/lib/knowledge-base-data';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';

// Icon mapping — maps string names from data to lucide components
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  Network,
  Users,
  TrendingUp,
  FileText,
  Briefcase,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Shield};

function CategoryCard({
  category,
  onPress,
  isCompact}: {
  category: KBCategory;
  onPress: () => void;
  isCompact: boolean;
}) {
  const Icon = ICON_MAP[category.icon] ?? BookOpen;
  return (
    <TouchableOpacity
      style={[styles.categoryCard, isCompact && styles.categoryCardCompact]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${category.title}, ${category.articleCount} articles`}
      accessibilityHint={`Browse ${category.title} articles`}
      activeOpacity={0.7}
    >
      <View style={[styles.categoryIconWrap, { backgroundColor: category.color + '18' }]}>
        <Icon size={isCompact ? 22 : 26} color={category.color} strokeWidth={2.2} />
      </View>
      <View style={styles.categoryContent}>
        <Text style={[styles.categoryTitle, { fontSize: isCompact ? 13 : 15 }]} numberOfLines={1}>
          {category.title}
        </Text>
        <Text style={[styles.categorySubtitle, { fontSize: isCompact ? 11 : 12 }]} numberOfLines={2}>
          {category.subtitle}
        </Text>
        <View style={styles.categoryMetaRow}>
          <View style={[styles.articleCountBadge, { backgroundColor: category.color + '12' }]}>
            <Text style={[styles.articleCountText, { color: category.color }]}>
              {category.articleCount}
            </Text>
          </View>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

function SearchArticleRow({
  articleId,
  title,
  summary,
  categoryId,
  readTimeMin,
  onPress}: {
  articleId: string;
  title: string;
  summary: string;
  categoryId: string;
  readTimeMin: number;
  onPress: () => void;
}) {
  const category = getCategoryById(categoryId);
  return (
    <TouchableOpacity
      style={styles.searchResultRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.searchResultContent}>
        <View style={styles.searchResultHeader}>
          {category && (
            <View style={[styles.searchCategoryTag, { backgroundColor: category.color + '18' }]}>
              <Text style={[styles.searchCategoryText, { color: category.color }]}>
                {category.title}
              </Text>
            </View>
          )}
          <View style={styles.searchReadTime}>
            <Clock size={11} color={Colors.textTertiary} />
            <Text style={styles.searchReadTimeText}>{readTimeMin} min</Text>
          </View>
        </View>
        <Text style={styles.searchResultTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.searchResultSummary} numberOfLines={2}>
          {summary}
        </Text>
      </View>
      <ChevronRight size={16} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function KnowledgeBaseScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState<string>('');

  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isXs = isExtraSmallScreen(screenSize);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchArticles(searchQuery);
  }, [searchQuery]);

  const handleCategoryPress = useCallback(
    (categoryId: string) => {
      router.push(`/knowledge-base/${categoryId}` as any);
    },
    [router]
  );

  const handleArticlePress = useCallback(
    (articleId: string) => {
      router.push(`/knowledge-base/article/${articleId}` as any);
    },
    [router]
  );

  const isSearching = searchQuery.trim().length > 0;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={Colors.text} strokeWidth={2.3} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Knowledge Base</Text>
            <Text style={styles.headerSubtitle}>
              {KB_TOTAL_CATEGORIES} categories · {KB_TOTAL_ARTICLES} articles
            </Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrap}>
          <View style={styles.searchInputWrap}>
            <Search size={18} color={Colors.textTertiary} strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search articles, tags, content…"
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              accessible={true}
              accessibilityLabel="Search knowledge base"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={18} color={Colors.textTertiary} strokeWidth={2.2} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Content */}
      {isSearching ? (
        <FlatList
        onEndReachedThreshold={5}
        onEndReached={() => { /* IVX: pagination hook point */ }}
          data={searchResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SearchArticleRow
              articleId={item.id}
              title={item.title}
              summary={item.summary}
              categoryId={item.categoryId}
              readTimeMin={item.readTimeMin}
              onPress={() => handleArticlePress(item.id)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Search size={40} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>No results found</Text>
              <Text style={styles.emptyText}>
                Try searching for "arquitectura", "seguridad", "likes", or "QA"
              </Text>
            </View>
          }
          contentContainerStyle={styles.searchList}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: isXs ? 16 : 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Stats banner */}
          <View style={styles.statsBanner}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{KB_TOTAL_CATEGORIES}</Text>
              <Text style={styles.statLabel}>Categories</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{KB_TOTAL_ARTICLES}</Text>
              <Text style={styles.statLabel}>Articles</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>10</Text>
              <Text style={styles.statLabel}>Topics</Text>
            </View>
          </View>

          {/* Categories */}
          <Text style={styles.sectionLabel}>CATEGORIES</Text>
          <View style={styles.categoriesContainer}>
            {KB_CATEGORIES.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onPress={() => handleCategoryPress(category.id)}
                isCompact={isCompact}
              />
            ))}
          </View>

          {/* Recent articles */}
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>RECENTLY UPDATED</Text>
          <View style={styles.recentContainer}>
            {KB_ARTICLES.slice(0, 5).map((article) => {
              const cat = getCategoryById(article.categoryId);
              return (
                <TouchableOpacity
                  key={article.id}
                  style={styles.recentRow}
                  onPress={() => handleArticlePress(article.id)}
                  activeOpacity={0.7}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={article.title}
                >
                  <View style={[styles.recentDot, { backgroundColor: cat?.color ?? Colors.gold }]} />
                  <View style={styles.recentContent}>
                    <Text style={styles.recentTitle} numberOfLines={2}>
                      {article.title}
                    </Text>
                    <Text style={styles.recentMeta}>
                      {cat?.title} · {article.readTimeMin} min read
                    </Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12},
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginLeft: -4},
  headerTitleWrap: {
    flex: 1,
    marginLeft: 4},
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12},
  searchInputWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    marginLeft: 10,
    padding: 0},
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingBottom: 32},
  statsBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-around' as const,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statItem: {
    alignItems: 'center' as const},
  statNumber: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.gold},
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.surfaceBorder},
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase' as const},
  categoriesContainer: {
    gap: 10},
  categoryCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  categoryCardCompact: {
    padding: 12},
  categoryIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  categoryContent: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8},
  categoryTitle: {
    fontWeight: '700' as const,
    color: Colors.text},
  categorySubtitle: {
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 17},
  categoryMetaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 8},
  articleCountBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3},
  articleCountText: {
    fontSize: 11,
    fontWeight: '700' as const},
  recentContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden' as const},
  recentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder},
  recentDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  recentContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8},
  recentTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  recentMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 3},
  searchList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32},
  searchResultRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  searchResultContent: {
    flex: 1,
    marginRight: 8},
  searchResultHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 6,
    gap: 8},
  searchCategoryTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  searchCategoryText: {
    fontSize: 10,
    fontWeight: '700' as const},
  searchReadTime: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3},
  searchReadTimeText: {
    fontSize: 11,
    color: Colors.textTertiary},
  searchResultTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  searchResultSummary: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18},
  emptyState: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingTop: 80,
    paddingHorizontal: 32},
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16},
  emptyText: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    marginTop: 8,
    lineHeight: 18}});
