import React, { useState, useCallback, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Animated} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  X,
  Building2,
  User,
  Bell,
  FileText,
  ArrowLeft,
  Wallet,
  Shield,
  Briefcase,
  BarChart3} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useGlobalSearch, SearchResult } from '@/lib/global-search';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  building: Building2,
  user: User,
  bell: Bell,
  'file-text': FileText,
  wallet: Wallet,
  shield: Shield,
  briefcase: Briefcase,
  'bar-chart': BarChart3,
  lock: Shield,
  users: User,
  image: FileText};

function getSearchIcon(icon: string) {
  return ICON_MAP[icon] || FileText;
}

const TYPE_COLORS: Record<string, string> = {
  property: Colors.primary,
  deal: Colors.primary,
  document: Colors.info,
  notification: Colors.warning,
  user: Colors.accent};

export default function SearchScreen() {
  const router = useRouter();
  const { query, results, isSearching, search, clear } = useGlobalSearch();
  const [inputValue, setInputValue] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const handleSearch = useCallback((text: string) => {
    setInputValue(text);
    void search(text);
  }, [search]);

  const handleClear = useCallback(() => {
    setInputValue('');
    clear();
  }, [clear]);

  const handleResultPress = useCallback((result: SearchResult) => {
    console.log('[Search] Navigate to:', result.route);
    router.push(result.route as any);
  }, [router]);

  const renderResult = useCallback(({ item }: { item: SearchResult }) => {
    const Icon = getSearchIcon(item.icon);
    const typeColor = TYPE_COLORS[item.type] || Colors.textSecondary;

    return (
      <TouchableOpacity
        style={styles.resultItem}
        onPress={() => handleResultPress(item)}
        activeOpacity={0.7}
        testID={`search-result-${item.id}`}
      >
        <View style={[styles.resultIcon, { backgroundColor: typeColor + '15' }]}>
          <Icon size={20} color={typeColor} />
        </View>
        <View style={styles.resultContent}>
          <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.resultSubtitle} numberOfLines={1}>{item.subtitle}</Text>
        </View>
        <View style={[styles.resultBadge, { backgroundColor: typeColor + '20' }]}>
          <Text style={[styles.resultBadgeText, { color: typeColor }]}>{item.type}</Text>
        </View>
      </TouchableOpacity>
    );
  }, [handleResultPress]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
            <View style={styles.searchBar}>
              <Search size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search properties, users, screens..."
                placeholderTextColor={Colors.textTertiary}
                value={inputValue}
                onChangeText={handleSearch}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                testID="search-input"
              />
              {inputValue.length > 0 && (
                <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <X size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {isSearching && (
            <View style={styles.loadingWrap}>
              <ShimmerIndicator color={Colors.primary} size="small" />
              <Text style={styles.loadingText}>Searching...</Text>
            </View>
          )}

          {!isSearching && results.length === 0 && query.length >= 2 && (
            <View style={styles.emptyWrap}>
              <Search size={48} color={Colors.surfaceBorder} />
              <Text style={styles.emptyTitle}>No results found</Text>
              <Text style={styles.emptySubtitle}>Try a different search term</Text>
            </View>
          )}

          {!isSearching && results.length === 0 && query.length < 2 && (
            <View style={styles.emptyWrap}>
              <Search size={48} color={Colors.surfaceBorder} />
              <Text style={styles.emptyTitle}>Search IVX Holdings</Text>
              <Text style={styles.emptySubtitle}>Find properties, users, documents, and more</Text>
            </View>
          )}

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={renderResult}
            contentContainerStyle={styles.resultsList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  container: {
    flex: 1},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  searchBar: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    height: 48,
    gap: 10},
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    height: '100%' as any},
  loadingWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 20,
    gap: 8},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14},
  emptyWrap: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingTop: 80,
    gap: 12},
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginTop: 8},
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 14},
  resultsList: {
    paddingHorizontal: 16,
    paddingBottom: 40},
  resultItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 12},
  resultIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  resultContent: {
    flex: 1},
  resultTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const},
  resultSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 2},
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const}});
