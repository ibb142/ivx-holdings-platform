import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  useWindowDimensions,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  Filter,
  X,
  TrendingUp,
  Building2,
  Landmark,
  Home as HomeIcon,
  Briefcase,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';

import { EmptyState } from '@/components/ProgressiveStates';
import { IVXImage } from '@/components/ivx';
import { formatCurrencyWithDecimals } from '@/lib/formatters';

type PropertyType = 'all' | 'residential' | 'commercial' | 'land' | 'mixed_use';

interface REListing {
  id: string;
  title: string;
  asking_price: number;
  currency_code: string;
  city: string;
  country_iso: string;
  bedrooms: number | null;
  bathrooms: number | null;
  building_size_sqm: number | null;
  lot_size_sqm: number | null;
  property_type_code: string;
  listing_type: string;
  is_featured: boolean;
  images: string[];
  description: string;
  listing_status: string;
}

const TYPE_FILTERS: { key: PropertyType; label: string; icon: typeof HomeIcon }[] = [
  { key: 'all', label: 'All', icon: Building2 },
  { key: 'residential', label: 'Residential', icon: HomeIcon },
  { key: 'commercial', label: 'Commercial', icon: Briefcase },
  { key: 'land', label: 'Land', icon: Landmark },
];

export default function MarketplaceScreen() {
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<PropertyType>('all');
  const [refreshing, setRefreshing] = useState(false);

  const cardWidth = useMemo(() => {
    if (width < 480) return width - 32;
    if (width < 768) return (width - 48) / 2;
    return (width - 64) / 3;
  }, [width]);

  const { data: properties, isLoading, refetch } = useQuery<REListing[]>({
    queryKey: ['re-marketplace', typeFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('ivx_re_property_listings')
        .select('*')
        .in('listing_status', ['active', 'under_contract'])
        .eq('is_verified', true)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30);

      if (typeFilter !== 'all') {
        query = query.eq('property_type_code', typeFilter);
      }

      if (searchQuery.trim()) {
        query = query.or(
          `title.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%,country_iso.ilike.%${searchQuery}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as REListing[];
    },
    staleTime: 1000 * 60 * 2,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const featuredProperties = useMemo<REListing[]>(
    () => properties?.filter((p: REListing) => p.is_featured) || [],
    [properties]
  );

  const regularProperties = useMemo<REListing[]>(
    () => properties?.filter((p: REListing) => !p.is_featured) || [],
    [properties]
  );

  const renderPropertyCard = useCallback(
    (item: REListing) => {
      const primaryImage = item.images?.[0] || null;
      return (
        <TouchableOpacity
          key={item.id}
          style={[styles.card, { width: cardWidth }]}
          onPress={() => router.push(`/marketplace/${item.id}`)}
          activeOpacity={0.85}
        >
          <View style={styles.cardImageContainer}>
            {primaryImage ? (
              <IVXImage
                uri={primaryImage}
                width={cardWidth}
                height={cardWidth * 0.6}
                style={styles.cardImage}
              />
            ) : (
              <View style={[styles.cardImagePlaceholder, { width: cardWidth, height: cardWidth * 0.6 }]}>
                <Building2 size={32} color={Colors.textSecondary} />
              </View>
            )}
            {item.is_featured && (
              <View style={styles.featuredBadge}>
                <TrendingUp size={10} color="#000" />
                <Text style={styles.featuredText}>FEATURED</Text>
              </View>
            )}
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>
                {item.listing_type === 'sale' ? 'FOR SALE' : 'FOR RENT'}
              </Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardPrice}>
              {formatCurrencyWithDecimals(item.asking_price)}
            </Text>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={styles.cardLocation}>
              <MapPin size={11} color={Colors.textSecondary} />
              <Text style={styles.cardLocationText} numberOfLines={1}>
                {item.city || 'Location TBD'}, {item.country_iso || '—'}
              </Text>
            </View>
            <View style={styles.cardDetails}>
              {item.bedrooms != null && (
                <View style={styles.detailItem}>
                  <BedDouble size={12} color={Colors.textSecondary} />
                  <Text style={styles.detailText}>{item.bedrooms} Beds</Text>
                </View>
              )}
              {item.bathrooms != null && (
                <View style={styles.detailItem}>
                  <Bath size={12} color={Colors.textSecondary} />
                  <Text style={styles.detailText}>{item.bathrooms} Baths</Text>
                </View>
              )}
              {item.building_size_sqm != null && (
                <View style={styles.detailItem}>
                  <Maximize size={12} color={Colors.textSecondary} />
                  <Text style={styles.detailText}>{Math.round(item.building_size_sqm)} m²</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [cardWidth, router]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Marketplace</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.filterRow}>
            {TYPE_FILTERS.map((f) => (
              <View key={f.key} style={styles.filterChip}>
                <View style={{ width: 60, height: 28, borderRadius: 14, backgroundColor: Colors.border }} />
              </View>
            ))}
          </View>
          <View style={styles.cardGrid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[styles.card, { width: cardWidth }]}>
                <View style={{ width: cardWidth, height: cardWidth * 0.6, backgroundColor: Colors.border }} />
                <View style={styles.cardBody}>
                  <View style={{ width: 100, height: 16, borderRadius: 4, backgroundColor: Colors.border }} />
                  <View style={{ height: 6 }} />
                  <View style={{ width: 120, height: 12, borderRadius: 4, backgroundColor: Colors.border }} />
                  <View style={{ height: 6 }} />
                  <View style={{ width: 80, height: 10, borderRadius: 4, backgroundColor: Colors.border }} />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Marketplace</Text>
        <Text style={styles.headerSubtitle}>
          {properties?.length || 0} verified {properties?.length === 1 ? 'property' : 'properties'}
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <Search size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by city, country, or title..."
          placeholderTextColor={Colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <X size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {TYPE_FILTERS.map((filter) => {
          const Icon = filter.icon;
          const isActive = typeFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setTypeFilter(filter.key)}
            >
              <Icon size={13} color={isActive ? '#000' : Colors.textSecondary} />
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        data={regularProperties}
        keyExtractor={(item: REListing) => item.id}
        numColumns={width >= 768 ? 2 : 1}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={width >= 768 ? styles.row : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />
        }
        ListHeaderComponent={
          featuredProperties.length > 0 ? (
            <View style={styles.featuredSection}>
              <Text style={styles.sectionTitle}>Featured</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.featuredScroll}
              >
                {featuredProperties.map(renderPropertyCard)}
              </ScrollView>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={<Building2 size={48} color={Colors.textSecondary} />}
            title="No properties found"
            message="Try adjusting your filters or check back soon for new listings."
          />
        }
        renderItem={({ item }: { item: REListing }) => renderPropertyCard(item)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    marginLeft: 8,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  filterText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#000',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  row: {
    gap: 12,
  },
  featuredSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  featuredScroll: {
    gap: 12,
    paddingRight: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardImageContainer: {
    position: 'relative',
  },
  cardImage: {
    width: '100%',
  },
  cardImagePlaceholder: {
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  featuredText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#000',
  },
  statusBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFF',
  },
  cardBody: {
    padding: 12,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.gold,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
    marginBottom: 4,
  },
  cardLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 8,
  },
  cardLocationText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  cardDetails: {
    flexDirection: 'row',
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  detailText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  scrollContent: {
    padding: 16,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});
