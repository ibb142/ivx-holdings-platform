/**
 * IVX Knowledge Base — Article Reader Screen
 *
 * Renders rich content blocks (headings, paragraphs, lists, code, callouts).
 * Route: /knowledge-base/article/[articleId]
 */
import React, { useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  Share} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Clock,
  User,
  Calendar,
  Tag,
  Info,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ChevronRight,
  BookOpen} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';
import {
  getArticleById,
  getCategoryById,
  getArticlesByCategory,
  type KBBlock,
  type KBArticle} from '@/lib/knowledge-base-data';
import { getResponsiveSize, isExtraSmallScreen } from '@/lib/responsive';

// ─── Block Renderers ────────────────────────────────────────────────────

function HeadingBlock({ text }: { text: string }) {
  return (
    <View style={blockStyles.headingWrap}>
      <View style={blockStyles.headingAccent} />
      <Text style={blockStyles.heading}>{text}</Text>
    </View>
  );
}

function ParagraphBlock({ text }: { text: string }) {
  return <Text style={blockStyles.paragraph}>{text}</Text>;
}

function ListBlock({ items }: { items: string[] }) {
  return (
    <View style={blockStyles.listWrap}>
      {items.map((item, idx) => (
        <View key={idx} style={blockStyles.listItem}>
          <View style={blockStyles.listBullet} />
          <Text style={blockStyles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <View style={blockStyles.codeWrap}>
      <View style={blockStyles.codeHeader}>
        <Text style={blockStyles.codeLang}>{language}</Text>
      </View>
      <Text style={blockStyles.codeText}>{code}</Text>
    </View>
  );
}

function CalloutBlock({ variant, text }: { variant: 'info' | 'warning' | 'danger' | 'success'; text: string }) {
  const config = {
    info: { bg: '#4A90D915', border: '#4A90D940', icon: Info, iconColor: '#4A90D9' },
    warning: { bg: '#F59E0B15', border: '#F59E0B40', icon: AlertTriangle, iconColor: '#F59E0B' },
    danger: { bg: '#FF4D4D15', border: '#FF4D4D40', icon: XCircle, iconColor: '#FF4D4D' },
    success: { bg: '#00C48C15', border: '#00C48C40', icon: CheckCircle2, iconColor: '#00C48C' }};
  const cfg = config[variant];
  const Icon = cfg.icon;
  return (
    <View style={[blockStyles.calloutWrap, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <View style={blockStyles.calloutHeader}>
        <Icon size={18} color={cfg.iconColor} strokeWidth={2.2} />
        <Text style={[blockStyles.calloutText, { color: cfg.iconColor }]}>{text}</Text>
      </View>
    </View>
  );
}

function DividerBlock() {
  return <View style={blockStyles.divider} />;
}

function renderBlock(block: KBBlock, index: number): React.ReactNode {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock key={index} text={block.text} />;
    case 'paragraph':
      return <ParagraphBlock key={index} text={block.text} />;
    case 'list':
      return <ListBlock key={index} items={block.items} />;
    case 'code':
      return <CodeBlock key={index} code={block.code} language={block.language} />;
    case 'callout':
      return <CalloutBlock key={index} variant={block.variant} text={block.text} />;
    case 'divider':
      return <DividerBlock key={index} />;
    default:
      return null;
  }
}

// ─── Related Article Row ────────────────────────────────────────────────

function RelatedArticleRow({ article, onPress }: { article: KBArticle; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.relatedRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={article.title}
    >
      <Text style={styles.relatedTitle} numberOfLines={2}>{article.title}</Text>
      <ChevronRight size={16} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────

export default function KnowledgeBaseArticleScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const params = useLocalSearchParams<{ articleId: string }>();
  const { width } = useWindowDimensions();

  const articleId = params.articleId ?? '';
  const article = useMemo(() => getArticleById(articleId), [articleId]);
  const category = useMemo(() => (article ? getCategoryById(article.categoryId) : undefined), [article]);
  const relatedArticles = useMemo(() => {
    if (!article) return [];
    return getArticlesByCategory(article.categoryId)
      .filter((a) => a.id !== article.id)
      .slice(0, 3);
  }, [article]);

  const screenSize = getResponsiveSize(width);
  const isXs = isExtraSmallScreen(screenSize);

  if (!article) {
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
            <Text style={styles.headerTitle}>Article</Text>
          </View>
        </SafeAreaView>
        <View style={styles.emptyState}>
          <BookOpen size={48} color={Colors.textTertiary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Article not found</Text>
          <Text style={styles.emptyText}>This article does not exist.</Text>
        </View>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${article.title}\n\n${article.summary}\n\n— IVX Knowledge Base`});
    } catch {
      // Silently ignore share errors
    }
  };

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
            {category && (
              <View style={[styles.headerCategoryTag, { backgroundColor: category.color + '18' }]}>
                <Text style={[styles.headerCategoryText, { color: category.color }]}>
                  {category.title}
                </Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: isXs ? 16 : 20 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Article Header */}
        <Text style={styles.articleTitle}>{article.title}</Text>
        <Text style={styles.articleSummary}>{article.summary}</Text>

        {/* Meta Row */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Clock size={13} color={Colors.textTertiary} />
            <Text style={styles.metaText}>{article.readTimeMin} min read</Text>
          </View>
          <View style={styles.metaItem}>
            <User size={13} color={Colors.textTertiary} />
            <Text style={styles.metaText}>{article.author}</Text>
          </View>
          <View style={styles.metaItem}>
            <Calendar size={13} color={Colors.textTertiary} />
            <Text style={styles.metaText}>{article.updatedAt}</Text>
          </View>
        </View>

        {/* Tags */}
        <View style={styles.tagsRow}>
          {article.tags.map((tag) => (
            <View key={tag} style={styles.tagPill}>
              <Tag size={10} color={Colors.textTertiary} />
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={styles.articleDivider} />

        {/* Content Blocks */}
        <View style={styles.blocksContainer}>
          {article.blocks.map((block, idx) => renderBlock(block, idx))}
        </View>

        {/* Related Articles */}
        {relatedArticles.length > 0 && (
          <View style={styles.relatedSection}>
            <Text style={styles.relatedLabel}>RELATED ARTICLES</Text>
            <View style={styles.relatedContainer}>
              {relatedArticles.map((rel) => (
                <RelatedArticleRow
                  key={rel.id}
                  article={rel}
                  onPress={() => router.replace(`/knowledge-base/article/${rel.id}` as any)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Share Button */}
      <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={handleShare}
          activeOpacity={0.7}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Share article"
        >
          <Text style={styles.shareButtonText}>Share Article</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

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
  headerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  headerTitleWrap: {
    flex: 1,
    marginLeft: 4},
  headerCategoryTag: {
    alignSelf: 'flex-start' as const,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4},
  headerCategoryText: {
    fontSize: 12,
    fontWeight: '700' as const},
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingBottom: 16},
  articleTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    lineHeight: 32},
  articleSummary: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 12,
    lineHeight: 22},
  metaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginTop: 16},
  metaItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5},
  metaText: {
    fontSize: 12,
    color: Colors.textTertiary},
  tagsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 14},
  tagPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5},
  tagText: {
    fontSize: 11,
    color: Colors.textSecondary},
  articleDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 20},
  blocksContainer: {
    gap: 14},
  relatedSection: {
    marginTop: 32},
  relatedLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase' as const},
  relatedContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden' as const},
  relatedRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder},
  relatedTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginRight: 8},
  bottomBar: {
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingHorizontal: 20,
    paddingVertical: 12},
  shareButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center' as const},
  shareButtonText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.black},
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

// ─── Block Styles ───────────────────────────────────────────────────────

const blockStyles = StyleSheet.create({
  headingWrap: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    marginTop: 8,
    marginBottom: 2},
  headingAccent: {
    width: 4,
    height: 22,
    borderRadius: 2,
    backgroundColor: Colors.gold,
    marginRight: 10,
    marginTop: 2},
  heading: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 24},
  paragraph: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22},
  listWrap: {
    gap: 8,
    paddingLeft: 4},
  listItem: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const},
  listBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.gold,
    marginTop: 8,
    marginRight: 10},
  listText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22},
  codeWrap: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden' as const},
  codeHeader: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  codeLang: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  codeText: {
    fontFamily: 'monospace' as const,
    fontSize: 13,
    color: '#E0E0E0',
    lineHeight: 20,
    padding: 14},
  calloutWrap: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14},
  calloutHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  calloutText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20},
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4}});
