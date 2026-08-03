import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert} from "react-native";
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Tag,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Clock,
  Shield,
  AlertCircle,
  X} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyWithDecimals, formatNumber } from '@/lib/formatters';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buyResaleListing, cancelResaleListing } from '@/lib/investment-service';
import type { ResaleListing } from '@/lib/investment-service';
import { useAuth } from '@/lib/auth-context';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

export default function ResaleMarketplaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const listingsQuery = useQuery({
    queryKey: ['resale-listings', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resale_listings')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[ResaleMarketplace] Fetch error:', error.message);
        return [];
      }
      return (data || []) as ResaleListing[];
    },
    staleTime: 1000 * 15});

  const myListingsQuery = useQuery({
    queryKey: ['resale-listings', 'mine'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('resale_listings')
        .select('*')
        .eq('seller_id', user.id)
        .in('status', ['active'])
        .order('created_at', { ascending: false });
      if (error) return [];
      return (data || []) as ResaleListing[];
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 15});

  const currentUserId = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    staleTime: 1000 * 60 * 10});

  const listings = listingsQuery.data ?? [];
  const myListings = myListingsQuery.data ?? [];
  const userId = currentUserId.data;

  const buyMutation = useMutation({
    mutationFn: async (listingId: string) => {
      return buyResaleListing(listingId);
    },
    onSuccess: (result) => {
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Purchase Complete', result.message, [
          { text: 'View Portfolio', onPress: () => router.push('/(tabs)/portfolio' as any) },
          { text: 'OK' },
        ]);
        void queryClient.invalidateQueries({ queryKey: ['resale-listings'] });
        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
        void queryClient.invalidateQueries({ queryKey: ['portfolio'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Purchase Failed', result.message);
      }
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    }});

  const cancelMutation = useMutation({
    mutationFn: async (listingId: string) => {
      return cancelResaleListing(listingId);
    },
    onSuccess: (result) => {
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Cancelled', result.message);
        void queryClient.invalidateQueries({ queryKey: ['resale-listings'] });
      } else {
        Alert.alert('Error', result.message);
      }
    }});

  const handleBuy = useCallback((listing: ResaleListing) => {
    if (listing.seller_id === userId) {
      Alert.alert('Cannot Buy', 'You cannot purchase your own listing.');
      return;
    }
    Alert.alert(
      'Confirm Purchase',
      `Buy ${formatNumber(listing.shares)} shares of ${listing.property_name} for ${formatCurrencyWithDecimals(listing.total_ask)} + 1% fee?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy Now',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            buyMutation.mutate(listing.id);
          }},
      ]
    );
  }, [userId, buyMutation]);

  const handleCancel = useCallback((listingId: string) => {
    Alert.alert(
      'Cancel Listing',
      'Are you sure you want to remove this listing from the marketplace?',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Listing',
          style: 'destructive',
          onPress: () => cancelMutation.mutate(listingId)},
      ]
    );
  }, [cancelMutation]);

  const onRefresh = () => {
    setRefreshing(true);
    void Promise.all([listingsQuery.refetch(), myListingsQuery.refetch()])
      .finally(() => setRefreshing(false));
  };

  const listingsData = listingsQuery.data;
  const otherListings = useMemo(() => {
    const all = listingsData ?? [];
    return all.filter(l => l.seller_id !== userId);
  }, [listingsData, userId]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Secondary Market</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.banner}>
          <Tag size={20} color={Colors.primary} />
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerTitle}>Investor-to-Investor Trading</Text>
            <Text style={styles.bannerSubtext}>
              Buy shares directly from other IVXHOLDINGS investors. Set your own price when listing, or buy at listed prices.
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{listings.length}</Text>
            <Text style={styles.statLabel}>Active Listings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {formatCurrencyWithDecimals(listings.reduce((s, l) => s + l.total_ask, 0))}
            </Text>
            <Text style={styles.statLabel}>Total Available</Text>
          </View>
        </View>

        {myListings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Active Listings</Text>
            {myListings.map(listing => (
              <View key={listing.id} style={styles.myListingCard}>
                <View style={styles.myListingInfo}>
                  <Text style={styles.listingPropertyName} numberOfLines={1}>{listing.property_name}</Text>
                  <Text style={styles.listingMeta}>
                    {formatNumber(listing.shares)} shares @ {formatCurrencyWithDecimals(listing.ask_price_per_share)}
                  </Text>
                  <View style={styles.listingDateRow}>
                    <Clock size={10} color={Colors.textTertiary} />
                    <Text style={styles.listingDate}>
                      Expires {new Date(listing.expires_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                <View style={styles.myListingActions}>
                  <Text style={styles.myListingTotal}>{formatCurrencyWithDecimals(listing.total_ask)}</Text>
                  <TouchableOpacity
                    style={styles.cancelListingBtn}
                    onPress={() => handleCancel(listing.id)}
                  >
                    <X size={12} color={Colors.error} />
                    <Text style={styles.cancelListingText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Available to Buy ({otherListings.length})
          </Text>

          {listingsQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ShimmerIndicator size="large" color={Colors.primary} />
            </View>
          ) : otherListings.length === 0 ? (
            <View style={styles.emptyState}>
              <ShoppingCart size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No listings available</Text>
              <Text style={styles.emptySubtext}>
                When investors list their shares for resale, they will appear here
              </Text>
            </View>
          ) : (
            otherListings.map(listing => {
              const premiumPercent = listing.original_cost_basis > 0
                ? ((listing.ask_price_per_share - listing.original_cost_basis) / listing.original_cost_basis * 100)
                : 0;
              const isPremium = premiumPercent > 0;

              return (
                <View key={listing.id} style={styles.listingCard}>
                  <View style={styles.listingHeader}>
                    <View style={styles.listingHeaderLeft}>
                      <Text style={styles.listingPropertyName} numberOfLines={1}>
                        {listing.property_name}
                      </Text>
                      <View style={styles.listingBadgesRow}>
                        <View style={[styles.priceBadge, { backgroundColor: isPremium ? Colors.error + '15' : Colors.success + '15' }]}>
                          {isPremium ? (
                            <TrendingUp size={10} color={Colors.error} />
                          ) : (
                            <TrendingDown size={10} color={Colors.success} />
                          )}
                          <Text style={[styles.priceBadgeText, { color: isPremium ? Colors.error : Colors.success }]}>
                            {premiumPercent >= 0 ? '+' : ''}{premiumPercent.toFixed(1)}% vs cost
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.listingDetails}>
                    <View style={styles.listingDetailItem}>
                      <Text style={styles.listingDetailLabel}>Shares</Text>
                      <Text style={styles.listingDetailValue}>{formatNumber(listing.shares)}</Text>
                    </View>
                    <View style={styles.listingDetailDivider} />
                    <View style={styles.listingDetailItem}>
                      <Text style={styles.listingDetailLabel}>Ask Price</Text>
                      <Text style={styles.listingDetailValue}>{formatCurrencyWithDecimals(listing.ask_price_per_share)}</Text>
                    </View>
                    <View style={styles.listingDetailDivider} />
                    <View style={styles.listingDetailItem}>
                      <Text style={styles.listingDetailLabel}>Total</Text>
                      <Text style={[styles.listingDetailValue, { color: Colors.primary }]}>
                        {formatCurrencyWithDecimals(listing.total_ask)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.listingFooter}>
                    <View style={styles.listingExpiryRow}>
                      <Clock size={11} color={Colors.textTertiary} />
                      <Text style={styles.listingExpiry}>
                        Expires {new Date(listing.expires_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.buyListingBtn, buyMutation.isPending && styles.buyListingBtnDisabled]}
                      onPress={() => handleBuy(listing)}
                      disabled={buyMutation.isPending}
                      activeOpacity={0.8}
                    >
                      {buyMutation.isPending ? (
                        <ShimmerIndicator size="small" color={Colors.black} />
                      ) : (
                        <>
                          <ShoppingCart size={14} color={Colors.black} />
                          <Text style={styles.buyListingBtnText}>Buy Now</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.disclaimerCard}>
          <View style={styles.disclaimerRow}>
            <Shield size={14} color={Colors.success} />
            <Text style={styles.disclaimerText}>All secondary market transactions are secured through IVXHOLDINGS escrow</Text>
          </View>
          <View style={styles.disclaimerRow}>
            <AlertCircle size={14} color={Colors.warning} />
            <Text style={styles.disclaimerText}>1% platform fee applies to both buyer and seller on resale transactions</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  headerRight: {
    width: 40},
  scrollView: {
    flex: 1},
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    margin: 16,
    padding: 16,
    backgroundColor: Colors.primary + '10',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
    gap: 12},
  bannerInfo: {
    flex: 1},
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  bannerSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18},
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 20},
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4},
  statValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 11,
    color: Colors.textTertiary},
  section: {
    marginHorizontal: 16,
    marginBottom: 20},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12},
  myListingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '25'},
  myListingInfo: {
    flex: 1,
    minWidth: 0},
  myListingActions: {
    alignItems: 'flex-end',
    gap: 6},
  myListingTotal: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.primary},
  cancelListingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.error + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5},
  cancelListingText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.error},
  listingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  listingHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12},
  listingHeaderLeft: {
    flex: 1},
  listingPropertyName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  listingBadgesRow: {
    flexDirection: 'row',
    gap: 6},
  priceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8},
  priceBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const},
  listingMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  listingDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4},
  listingDate: {
    fontSize: 10,
    color: Colors.textTertiary},
  listingDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12},
  listingDetailItem: {
    flex: 1,
    alignItems: 'center'},
  listingDetailDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder},
  listingDetailLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 3},
  listingDetailValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  listingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  listingExpiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  listingExpiry: {
    fontSize: 11,
    color: Colors.textTertiary},
  buyListingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10},
  buyListingBtnDisabled: {
    opacity: 0.6},
  buyListingBtnText: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.black},
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center'},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8},
  emptyText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text},
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20},
  disclaimerCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17}});
