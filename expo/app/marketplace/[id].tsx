import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  Calendar,
  DollarSign,
  Building2,
  Landmark,
  CheckCircle2,
  FileText,
  TrendingUp,
  Phone,
  Mail,
  Shield,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';

import { IVXImage } from '@/components/ivx';
import { formatCurrencyWithDecimals } from '@/lib/formatters';

interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  asking_price: number;
  currency_code: string;
  listing_type: string;
  listing_status: string;
  address_line1: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country_iso: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  building_size_sqm: number | null;
  lot_size_sqm: number | null;
  year_built: number | null;
  parking_spaces: number | null;
  property_type_code: string;
  features: Record<string, unknown>;
  images: string[];
  virtual_tour_url: string | null;
  is_verified: boolean;
  is_featured: boolean;
  view_count: number;
  offer_count: number;
  images_data: { url: string; caption: string | null; is_primary: boolean }[];
  amenities_data: { amenity: string; category: string }[];
  valuations_data: { valuation_amount: number; valuation_date: string; appraiser_name: string | null }[];
  pending_offers: { id: string; offer_amount: number; buyer_name: string }[];
  primary_broker: { full_name: string; email: string; phone: string; brokerage_name: string; photo_url: string | null; rating: number } | null;
}

export default function PropertyDetailsScreen() {
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const { data: property, isLoading } = useQuery<PropertyDetail>({
    queryKey: ['re-property', id],
    queryFn: async () => {
      const { data: listing, error } = await supabase
        .from('ivx_re_property_listings')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      const [imagesResult, amenitiesResult, valuationsResult, offersResult, brokerResult] = await Promise.all([
        supabase.from('ivx_re_property_images').select('url, caption, is_primary, sort_order').eq('listing_id', id).order('sort_order'),
        supabase.from('ivx_re_property_amenities').select('amenity, category').eq('listing_id', id),
        supabase.from('ivx_re_property_valuations').select('valuation_amount, valuation_date, appraiser_name').eq('listing_id', id).order('valuation_date', { ascending: false }).limit(1),
        supabase.from('ivx_re_offers').select('id, offer_amount, buyer_name').eq('listing_id', id).eq('offer_status', 'pending').order('offer_amount', { ascending: false }),
        supabase.from('ivx_re_broker_assignments').select('broker:ivx_re_brokers(full_name, email, phone, brokerage_name, photo_url, rating)').eq('listing_id', id).eq('is_primary', true).maybeSingle(),
      ]);

      return {
        ...listing,
        images_data: imagesResult.data || [],
        amenities_data: amenitiesResult.data || [],
        valuations_data: valuationsResult.data || [],
        pending_offers: offersResult.data || [],
        primary_broker: brokerResult.data?.broker || null,
      } as unknown as PropertyDetail;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });

  const allImages = useMemo(() => {
    if (!property) return [];
    const fromDb = property.images_data?.map((img: { url: string }) => img.url) || [];
    const fromJson = (property.images || []) as string[];
    return [...fromDb, ...fromJson].filter(Boolean);
  }, [property]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView>
          <View style={{ width: width, height: 250, backgroundColor: Colors.border }} />
          <View style={styles.content}>
            <View style={{ width: 150, height: 24, borderRadius: 4, backgroundColor: Colors.border }} />
            <View style={{ height: 10 }} />
            <View style={{ width: width - 32, height: 18, borderRadius: 4, backgroundColor: Colors.border }} />
            <View style={{ height: 6 }} />
            <View style={{ width: 200, height: 14, borderRadius: 4, backgroundColor: Colors.border }} />
            <View style={{ height: 20 }} />
            <View style={{ width: width - 32, height: 80, borderRadius: 8, backgroundColor: Colors.border }} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!property) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <Building2 size={48} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>Property not found</Text>
          <Text style={styles.emptyText}>This listing may have been removed or is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fullAddress = [
    property.address_line1,
    property.city,
    property.state_province,
    property.postal_code,
    property.country_iso,
  ].filter(Boolean).join(', ');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {property.is_verified && (
            <View style={styles.verifiedBadge}>
              <Shield size={12} color={Colors.gold} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image Gallery */}
        <View style={styles.galleryContainer}>
          {allImages.length > 0 ? (
            <>
              <IVXImage
                uri={allImages[selectedImageIndex]}
                width={width}
                height={280}
                style={styles.mainImage}
              />
              {allImages.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbnailRow}
                >
                  {allImages.map((img: string, idx: number) => (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setSelectedImageIndex(idx)}
                      style={[
                        styles.thumbnail,
                        idx === selectedImageIndex && styles.thumbnailActive,
                      ]}
                    >
                      <IVXImage uri={img} width={56} height={56} style={styles.thumbnailImage} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </>
          ) : (
            <View style={[styles.mainImagePlaceholder, { width }]}>
              <Building2 size={48} color={Colors.textSecondary} />
              <Text style={styles.placeholderText}>No images available</Text>
            </View>
          )}
        </View>

        {/* Price & Title */}
        <View style={styles.content}>
          <View style={styles.priceRow}>
            <Text style={styles.price}>
              {formatCurrencyWithDecimals(property.asking_price)}
            </Text>
            {property.is_featured && (
              <View style={styles.featuredTag}>
                <TrendingUp size={12} color="#000" />
                <Text style={styles.featuredTagText}>FEATURED</Text>
              </View>
            )}
          </View>
          <Text style={styles.title}>{property.title}</Text>
          {fullAddress && (
            <View style={styles.addressRow}>
              <MapPin size={14} color={Colors.textSecondary} />
              <Text style={styles.address}>{fullAddress}</Text>
            </View>
          )}

          {/* Key Details */}
          <View style={styles.detailsGrid}>
            {property.bedrooms != null && (
              <View style={styles.detailBox}>
                <BedDouble size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{property.bedrooms}</Text>
                <Text style={styles.detailLabel}>Bedrooms</Text>
              </View>
            )}
            {property.bathrooms != null && (
              <View style={styles.detailBox}>
                <Bath size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{property.bathrooms}</Text>
                <Text style={styles.detailLabel}>Bathrooms</Text>
              </View>
            )}
            {property.building_size_sqm != null && (
              <View style={styles.detailBox}>
                <Maximize size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{Math.round(property.building_size_sqm)}</Text>
                <Text style={styles.detailLabel}>m² Interior</Text>
              </View>
            )}
            {property.lot_size_sqm != null && (
              <View style={styles.detailBox}>
                <Landmark size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{Math.round(property.lot_size_sqm)}</Text>
                <Text style={styles.detailLabel}>m² Lot</Text>
              </View>
            )}
            {property.year_built != null && (
              <View style={styles.detailBox}>
                <Calendar size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{property.year_built}</Text>
                <Text style={styles.detailLabel}>Year Built</Text>
              </View>
            )}
            {property.parking_spaces != null && (
              <View style={styles.detailBox}>
                <Building2 size={18} color={Colors.gold} />
                <Text style={styles.detailValue}>{property.parking_spaces}</Text>
                <Text style={styles.detailLabel}>Parking</Text>
              </View>
            )}
          </View>

          {/* Description */}
          {property.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{property.description}</Text>
            </View>
          )}

          {/* Amenities */}
          {property.amenities_data && property.amenities_data.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Amenities</Text>
              <View style={styles.amenitiesGrid}>
                {property.amenities_data.map((amenity: { amenity: string; category: string }, idx: number) => (
                  <View key={idx} style={styles.amenityChip}>
                    <CheckCircle2 size={12} color={Colors.gold} />
                    <Text style={styles.amenityText}>{amenity.amenity}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Valuation */}
          {property.valuations_data && property.valuations_data.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Valuation</Text>
              <View style={styles.valuationCard}>
                <DollarSign size={20} color={Colors.gold} />
                <View style={styles.valuationInfo}>
                  <Text style={styles.valuationAmount}>
                    {formatCurrencyWithDecimals(property.valuations_data[0].valuation_amount)}
                  </Text>
                  <Text style={styles.valuationDate}>
                    Appraised {new Date(property.valuations_data[0].valuation_date).toLocaleDateString()}
                  </Text>
                  {property.valuations_data[0].appraiser_name && (
                    <Text style={styles.valuationAppraiser}>
                      by {property.valuations_data[0].appraiser_name}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Broker */}
          {property.primary_broker && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Listing Agent</Text>
              <View style={styles.brokerCard}>
                {property.primary_broker.photo_url ? (
                  <IVXImage
                    uri={property.primary_broker.photo_url}
                    width={48}
                    height={48}
                    style={styles.brokerPhoto}
                  />
                ) : (
                  <View style={styles.brokerPhotoPlaceholder}>
                    <Text style={styles.brokerInitial}>
                      {property.primary_broker.full_name.charAt(0)}
                    </Text>
                  </View>
                )}
                <View style={styles.brokerInfo}>
                  <Text style={styles.brokerName}>{property.primary_broker.full_name}</Text>
                  <Text style={styles.brokerBrokerage}>
                    {property.primary_broker.brokerage_name || 'Independent'}
                  </Text>
                  {property.primary_broker.rating > 0 && (
                    <Text style={styles.brokerRating}>
                      ★ {property.primary_broker.rating.toFixed(1)}
                    </Text>
                  )}
                </View>
              </View>
              {property.primary_broker.phone && (
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={() => Alert.alert('Contact', `Call ${property.primary_broker!.phone}`)}
                >
                  <Phone size={16} color={Colors.gold} />
                  <Text style={styles.contactButtonText}>Call Agent</Text>
                </TouchableOpacity>
              )}
              {property.primary_broker.email && (
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={() => Alert.alert('Contact', `Email ${property.primary_broker!.email}`)}
                >
                  <Mail size={16} color={Colors.gold} />
                  <Text style={styles.contactButtonText}>Email Agent</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Pending Offers */}
          {property.pending_offers && property.pending_offers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Active Offers ({property.pending_offers.length})
              </Text>
              {property.pending_offers.map((offer: { id: string; offer_amount: number; buyer_name: string }) => (
                <View key={offer.id} style={styles.offerRow}>
                  <Text style={styles.offerBuyer}>{offer.buyer_name}</Text>
                  <Text style={styles.offerAmount}>
                    {formatCurrencyWithDecimals(offer.offer_amount)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Risk Disclaimer */}
          <View style={styles.disclaimerCard}>
            <FileText size={14} color={Colors.textSecondary} />
            <Text style={styles.disclaimerText}>
              Real estate investments involve risk. Past performance does not guarantee future results.
              All investments require KYC verification and proof of funds before transaction completion.
              Consult a licensed attorney for legal advice specific to your jurisdiction.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Make Offer Button */}
      {property.listing_status === 'active' && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.makeOfferButton}
            onPress={() => router.push(`/marketplace/make-offer?listingId=${id}`)}
          >
            <DollarSign size={18} color="#000" />
            <Text style={styles.makeOfferText}>Make an Offer</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,215,0,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.gold,
  },
  galleryContainer: {
    position: 'relative',
  },
  mainImage: {
    width: '100%',
  },
  mainImagePlaceholder: {
    height: 250,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  thumbnailRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbnailActive: {
    borderColor: Colors.gold,
  },
  thumbnailImage: {
    borderRadius: 6,
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  price: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.gold,
  },
  featuredTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  featuredTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#000',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  address: {
    fontSize: 14,
    color: Colors.textSecondary,
    flex: 1,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  detailBox: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 4,
  },
  detailLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  amenitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  amenityText: {
    fontSize: 12,
    color: Colors.text,
  },
  valuationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  valuationInfo: {
    flex: 1,
  },
  valuationAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.gold,
  },
  valuationDate: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  valuationAppraiser: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  brokerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  brokerPhoto: {
    borderRadius: 24,
  },
  brokerPhotoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brokerInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.gold,
  },
  brokerInfo: {
    flex: 1,
  },
  brokerName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  brokerBrokerage: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  brokerRating: {
    fontSize: 12,
    color: Colors.gold,
    marginTop: 2,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  contactButtonText: {
    fontSize: 14,
    color: Colors.gold,
    fontWeight: '500',
  },
  offerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  offerBuyer: {
    fontSize: 14,
    color: Colors.text,
  },
  offerAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gold,
  },
  disclaimerCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  makeOfferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
  },
  makeOfferText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
});
