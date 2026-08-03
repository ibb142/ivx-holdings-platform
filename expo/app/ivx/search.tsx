import React, { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { Search as SearchIcon, MessageSquare, X, ServerCrash, Database, HardDrive } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ivxChatService, type IVXOwnerMessageSearchResult } from '@/src/modules/ivx-owner-ai/services';
import { sanitizeUserFacingChatText } from '@/src/modules/chat/services/visibleTextSanitizer';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const MIN_QUERY_LENGTH = 2;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'});
}

function senderLabel(result: IVXOwnerMessageSearchResult): string {
  const role = result.message.senderRole;
  if (role === 'assistant') return 'IVX Owner AI';
  if (role === 'system') return 'System';
  return result.message.senderLabel?.trim() || 'Owner';
}

export default function IVXOwnerSearchRoute() {
  const router = useRouter();
  const [query, setQuery] = useState<string>('');
  const [submitted, setSubmitted] = useState<string>('');

  const searchMutation = useMutation<IVXOwnerMessageSearchResult[], Error, string>({
    mutationFn: async (q) => {
      console.log('[IVXOwnerSearchRoute] Running search:', q);
      return ivxChatService.searchOwnerMessages({ query: q, limit: 100 });
    }});

  const trimmedQuery = useMemo<string>(() => query.trim(), [query]);
  const canSearch = trimmedQuery.length >= MIN_QUERY_LENGTH;

  const handleSubmit = useCallback((): void => {
    if (!canSearch) return;
    setSubmitted(trimmedQuery);
    searchMutation.mutate(trimmedQuery);
  }, [canSearch, searchMutation, trimmedQuery]);

  const handleClear = useCallback((): void => {
    setQuery('');
    setSubmitted('');
    searchMutation.reset();
  }, [searchMutation]);

  const handleOpenResult = useCallback((result: IVXOwnerMessageSearchResult): void => {
    router.push({
      pathname: '/ivx/chat',
      params: {
        conversationId: result.conversationId,
        highlightMessageId: result.message.id}});
  }, [router]);

  const results = searchMutation.data ?? [];

  const renderItem = useCallback(({ item }: { item: IVXOwnerMessageSearchResult }) => {
    const snippet = sanitizeUserFacingChatText(item.snippet || item.message.body || '');
    const SourceIcon = item.source === 'remote_db' ? Database : HardDrive;
    return (
      <Pressable
        style={styles.resultCard}
        onPress={() => handleOpenResult(item)}
        accessibilityRole="button"
        accessibilityLabel={`Open message from ${senderLabel(item)}`}
        testID={`ivx-search-result-${item.message.id}`}
      >
        <View style={styles.resultHeader}>
          <View style={styles.resultSenderRow}>
            <MessageSquare size={14} color={Colors.primary} />
            <Text style={styles.resultSender}>{senderLabel(item)}</Text>
          </View>
          <Text style={styles.resultTime}>{formatTimestamp(item.matchedAt)}</Text>
        </View>
        <Text style={styles.resultSnippet} numberOfLines={3}>
          {snippet || '(empty message)'}
        </Text>
        <View style={styles.resultFooter}>
          <SourceIcon size={12} color={Colors.textTertiary} />
          <Text style={styles.resultSource}>
            {item.source === 'remote_db' ? 'Server match' : 'Local cache match'} · {item.conversationTitle} · {item.conversationId}
          </Text>
        </View>
      </Pressable>
    );
  }, [handleOpenResult]);

  return (
    <ErrorBoundary fallbackTitle="IVX search unavailable">
      <View style={styles.container} testID="ivx-owner-search-screen">
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <SearchIcon size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search owner conversations"
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={handleSubmit}
              testID="ivx-owner-search-input"
            />
            {query.length > 0 ? (
              <Pressable onPress={handleClear} hitSlop={12} testID="ivx-owner-search-clear">
                <X size={18} color={Colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={[styles.searchButton, !canSearch ? styles.searchButtonDisabled : null]}
            onPress={handleSubmit}
            disabled={!canSearch}
            testID="ivx-owner-search-submit"
          >
            <Text style={[styles.searchButtonText, !canSearch ? styles.searchButtonTextDisabled : null]}>Search</Text>
          </Pressable>
        </View>

        <View style={styles.hintRow}>
          <Text style={styles.hintText}>
            Searches all IVX owner conversations on the server, with a local cache fallback when offline.
          </Text>
        </View>

        {searchMutation.isPending ? (
          <View style={styles.stateBlock} testID="ivx-owner-search-loading">
            <ShimmerIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Searching messages…</Text>
          </View>
        ) : searchMutation.isError ? (
          <View style={styles.stateBlock} testID="ivx-owner-search-error">
            <ServerCrash size={28} color={Colors.error} />
            <Text style={styles.stateTitle}>Search failed</Text>
            <Text style={styles.stateText}>{searchMutation.error?.message ?? 'Unknown error.'}</Text>
            <Pressable style={styles.retryButton} onPress={handleSubmit} testID="ivx-owner-search-retry">
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : submitted.length === 0 ? (
          <View style={styles.stateBlock} testID="ivx-owner-search-idle">
            <SearchIcon size={28} color={Colors.textTertiary} />
            <Text style={styles.stateTitle}>Search IVX conversations</Text>
            <Text style={styles.stateText}>Type at least {MIN_QUERY_LENGTH} characters and tap Search.</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.stateBlock} testID="ivx-owner-search-empty">
            <SearchIcon size={28} color={Colors.textTertiary} />
            <Text style={styles.stateTitle}>No matches</Text>
            <Text style={styles.stateText}>No messages contain &quot;{submitted}&quot;.</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => `${item.source}-${item.conversationId}-${item.message.id}`}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            testID="ivx-owner-search-results"
            ListHeaderComponent={
              <Text style={styles.resultsHeader}>
                {results.length} {results.length === 1 ? 'match' : 'matches'} for &quot;{submitted}&quot;
              </Text>
            }
          />
        )}
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8},
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 18,
    paddingHorizontal: 12,
    minHeight: 44},
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    paddingVertical: 10},
  searchButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 18,
    paddingHorizontal: 16},
  searchButtonDisabled: {
    backgroundColor: Colors.surfaceLight},
  searchButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const},
  searchButtonTextDisabled: {
    color: Colors.textTertiary},
  hintRow: {
    paddingHorizontal: 16,
    paddingBottom: 8},
  hintText: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 16},
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10},
  resultsHeader: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 8},
  resultCard: {
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 8},
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12},
  resultSenderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  resultSender: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  resultTime: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const},
  resultSnippet: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20},
  resultFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  resultSource: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const},
  stateBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32},
  stateTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    textAlign: 'center'},
  stateText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'},
  retryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10},
  retryButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const}});
