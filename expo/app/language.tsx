import React, { useState, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Check, Search, X, Globe } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useI18n, SUPPORTED_LANGUAGES, LanguageCode } from '@/lib/i18n-context';

const FLAG_EMOJIS: Record<string, string> = {
  en: '🇺🇸',
  zh: '🇨🇳',
  hi: '🇮🇳',
  es: '🇪🇸',
  fr: '🇫🇷',
  ar: '🇸🇦',
  bn: '🇧🇩',
  pt: '🇧🇷',
  ru: '🇷🇺',
  ja: '🇯🇵',
  de: '🇩🇪',
  jv: '🇮🇩',
  ko: '🇰🇷',
  vi: '🇻🇳',
  tr: '🇹🇷',
  it: '🇮🇹',
  th: '🇹🇭',
  ta: '🇮🇳',
  mr: '🇮🇳',
  ur: '🇵🇰',
  pl: '🇵🇱',
  uk: '🇺🇦',
  nl: '🇳🇱',
  id: '🇮🇩',
  el: '🇬🇷',
  cs: '🇨🇿',
  ro: '🇷🇴',
  hu: '🇭🇺',
  sv: '🇸🇪',
  ms: '🇲🇾'};

export default function LanguageScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { language, setLanguage, currentLanguage } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAnim] = useState(() => new Animated.Value(1));
  const { width } = useWindowDimensions();

  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return SUPPORTED_LANGUAGES;
    const q = searchQuery.toLowerCase();
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleSelect = useCallback(
    async (code: LanguageCode) => {
      Animated.sequence([
        Animated.timing(selectedAnim, {
          toValue: 0.95,
          duration: 80,
          useNativeDriver: true}),
        Animated.timing(selectedAnim, {
          toValue: 1,
          duration: 80,
          useNativeDriver: true}),
      ]).start();

      await setLanguage(code);
      setTimeout(() => router.back(), 300);
    },
    [setLanguage, router, selectedAnim]
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
            <X size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Language</Text>
          <View style={styles.closeBtn} />
        </View>

        <View style={styles.currentBanner}>
          <View style={styles.currentIconWrap}>
            <Globe size={20} color={Colors.primary} />
          </View>
          <View style={styles.currentInfo}>
            <Text style={styles.currentLabel}>Current Language</Text>
            <Text style={styles.currentValue}>
              {FLAG_EMOJIS[currentLanguage.code] || '🌐'} {currentLanguage.nativeName}
            </Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search languages..."
            placeholderTextColor={Colors.inputPlaceholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {filteredLanguages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langItem,
                  isSelected && styles.langItemSelected,
                ]}
                onPress={() => handleSelect(lang.code)}
                activeOpacity={0.7}
                testID={`lang-${lang.code}`}
              >
                <Text style={styles.flag}>{FLAG_EMOJIS[lang.code] || '🌐'}</Text>
                <View style={styles.langInfo}>
                  <Text
                    style={[
                      styles.langNative,
                      isSelected && styles.langNativeSelected,
                    ]}
                  >
                    {lang.nativeName}
                  </Text>
                  <Text style={styles.langName}>{lang.name}</Text>
                </View>
                {isSelected && (
                  <View style={styles.checkWrap}>
                    <Check size={18} color={Colors.primary} strokeWidth={3} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {filteredLanguages.length === 0 && (
            <View style={styles.emptyState}>
              <Globe size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No languages found</Text>
              <Text style={styles.emptySubtitle}>
                Try a different search term
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12},
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  currentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: Colors.primary + '12',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  currentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12},
  currentInfo: {
    flex: 1},
  currentLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2},
  currentValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    padding: 0},
  list: {
    flex: 1,
    backgroundColor: Colors.background},
  listContent: {
    paddingHorizontal: 16},
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  langItemSelected: {
    borderColor: Colors.primary + '60',
    backgroundColor: Colors.primary + '08'},
  flag: {
    fontSize: 28,
    marginRight: 14},
  langInfo: {
    flex: 1},
  langNative: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2},
  langNativeSelected: {
    color: Colors.primary},
  langName: {
    fontSize: 13,
    color: Colors.textTertiary},
  checkWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center'},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10},
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text},
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textTertiary}});
