/**
 * IVX Knowledge Base — Category Detail Screen
 *
 * Lists all articles within a knowledge base category.
 * Route: /knowledge-base/[categoryId]
 */
import React, { useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  BookOpen,
  Network,
  Users,
  TrendingUp,
  FileText,
  Briefcase,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Shield} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  getCategoryById,
  getArticlesByCategory,
  type KBArticle} from '@/lib/knowledge-base-data';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  Network, Users, TrendingUp, FileText, Briefcase, Building2,
  AlertTriangle, CheckCircle2, ClipboardCheck, Shield};

function ArticleRow({
  article,
  categoryColor,
  onPress,
  isCompact}: {
  article: KBArticle;
  categoryColor: string;
  onPress: () => void;
  isCompact: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.articleRow, isCompact && styles.articleRowCompact]}
      onPress={onPress}
      activeOpacity={0.7}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={article.title}
      accessibilityHint={`Read ${article.title}`}
    >
      <View style={styles.articleRowLeft}>
        <View style={[styles.articleNumberDot, { backgroundColor: categoryColor + '20' }]}>
          <Text style={[styles.articleNumberText, { color: categoryColor }]}>
            {article.id.split('-').pop()?.toUpperCase()}
          </Text>
        </View>
        <View style={styles.articleRowContent}>
          <Text style={[styles.articleRowTitle, { fontSize: isCompact ? 13 : 15 }]} numberOfLines={2}>
            {article.title}
          </Text>
          <Text style={[styles.articleRowSummary, { fontSize: isCompact ? 11 : 12 }]} numberOfLines={2}>
            {article.summary}
          </Text>
          <View style={styles.articleRowMeta}>
            <View style={styles.articleRowTags}>
              {article.tags.slice(0, 3).map((tag) => (
                <View key={tag} style={styles.articleRowTag}>
                  <Text style={styles.articleRowTagText}>#{tag}</Text>
                </View>
              ))}
            </View>
            <View style={styles.articleRowReadTime}>
              <Clock size={11} color={Colors.textTertiary} />
              <Text style={styles.articleRowReadTimeText}>{article.readTimeMin} min</Text>
            </View>
          </View>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function KnowledgeBaseCategoryScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId: string }>();
  const { width } = useWindowDimensions();

  const categoryId = params.categoryId ?? '';
  const category = useMemo(() => getCategoryById(categoryId), [categoryId]);
  const articles = useMemo(() => getArticlesByCategory(categoryId), [categoryId]);

  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isXs = isExtraSmallScreen(screenSize);

  if (!category) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
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
            <Text style={styles.headerTitle}>Not Found</Text>
          </View>
        </SafeAreaView>
        <View style={styles.emptyState}>
          <BookOpen size={48} color={Colors.textTertiary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Category not found</Text>
          <Text style={styles.emptyText}>This category does not exist.</Text>
        </View>
      </View>
    );
  }

  const Icon = ICON_MAP[category.icon] ?? BookOpen;

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
            <Text style={styles.headerTitle} numberOfLines={1}>Knowledge Base</Text>
            <Text style={styles.headerSubtitle}>Browse articles</Text>
          </View>
        </View>

        {/* Category Hero */}
        <View style={[styles.categoryHero, { marginHorizontal: isXs ? 16 : 20 }]}>
          <View style={[styles.categoryHeroIcon, { backgroundColor: category.color + '18' }]}>
            <Icon size={32} color={category.color} strokeWidth={2.2} />
          </View>
          <View style={styles.categoryHeroContent}>
            <Text style={styles.categoryHeroTitle}>{category.title}</Text>
            <Text style={styles.categoryHeroSubtitle}>{category.subtitle}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Article List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: isXs ? 16 : 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>
          {articles.length} ARTICLE{articles.length !== 1 ? 'S' : ''}
        </Text>
        <View style={styles.articlesContainer}>
          {articles.map((article) => (
            <ArticleRow
              key={article.id}
              article={article}
              categoryColor={category.color}
              onPress={() => router.push(`/knowledge-base/article/${article.id}` as any)}
              isCompact={isCompact}
            />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  categoryHero: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  categoryHeroIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  categoryHeroContent: {
    flex: 1,
    marginLeft: 16},
  categoryHeroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text},
  categoryHeroSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18},
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingBottom: 32},
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase' as const},
  articlesContainer: {
    gap: 10},
  articleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  articleRowCompact: {
    padding: 12},
  articleRowLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    marginRight: 8},
  articleNumberDot: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  articleNumberText: {
    fontSize: 11,
    fontWeight: '800' as const},
  articleRowContent: {
    flex: 1,
    marginLeft: 14},
  articleRowTitle: {
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 20},
  articleRowSummary: {
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 16},
  articleRowMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: 8},
  articleRowTags: {
    flexDirection: 'row' as const,
    gap: 6,
    flex: 1},
  articleRowTag: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2},
  articleRowTagText: {
    fontSize: 10,
    color: Colors.textTertiary},
  articleRowReadTime: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3},
  articleRowReadTimeText: {
    fontSize: 11,
    color: Colors.textTertiary},
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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
    marginTop: 8}});
