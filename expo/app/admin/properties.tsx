import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  MapPin,
  X,
  Check,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Property } from '@/types';
import { formatCurrencyWithDecimals, formatAmountInput, parseAmountInput } from '@/lib/formatters';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProgressiveList } from '@/lib/use-progressive-list';
import { EmptyState, ErrorState, ListFooter } from '@/components/ProgressiveStates';
import { fetchPropertiesPage, invalidatePropertiesCache } from '@/lib/canonical-query';
import { usePropertiesRealtime } from '@/lib/canonical-realtime';
import { OptimizedImage } from '@/components/OptimizedImage';
import { logAudit } from '@/lib/audit-trail';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'live' | 'coming_soon' | 'funded' | 'closed';

export default function PropertiesScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    city: '',
    country: '',
    pricePerShare: '',
    totalShares: '',
    yield: '',
    propertyType: 'residential' as Property['propertyType'],
    status: 'coming_soon' as Property['status'],
    description: ''});

  const queryClient = useQueryClient();
  usePropertiesRealtime(null);

  const propertiesList = useProgressiveList<Property>({
    queryKey: ['admin-properties'],
    pageSize: 10,
    staleTime: 1000 * 60 * 2,
    fetchPage: async (page: number, pageSize: number) => {
      const result = await fetchPropertiesPage(page, pageSize);
      const items = result.items.map((p: any): Property => ({
        id: p.id,
        name: p.name || 'Unnamed',
        location: p.location || '',
        city: p.location || '',
        country: 'US',
        images: p.image ? [p.image] : [],
        pricePerShare: Number(p.share_price) || 0,
        totalShares: Number(p.total_shares) || 1000,
        availableShares: Number(p.available_shares) || 0,
        minInvestment: 100,
        targetRaise: Number(p.price) || 0,
        currentRaise: (Number(p.total_shares) - Number(p.available_shares)) * Number(p.share_price) || 0,
        yield: Number(p.annual_yield) || 0,
        capRate: 0,
        irr: 0,
        occupancy: Number(p.occupancy_rate) || 0,
        propertyType: (p.type || 'residential') as any,
        status: p.status === 'active' ? 'live' : (p.status || 'coming_soon') as any,
        riskLevel: 'medium',
        description: '',
        highlights: [],
        documents: [],
        distributions: [],
        priceHistory: [],
        createdAt: p.created_at || new Date().toISOString(),
        closingDate: ''}));
      return { items, hasMore: result.hasMore };
    }});

  const properties = propertiesList.data;

  const addPropertyMutation = useMutation({
    mutationFn: async (input: { name: string; location: string; share_price: number; total_shares: number; annual_yield: number; type: string; status: string }) => {
      const { data, error } = await supabase.from('properties').insert([input]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data) => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      void logAudit({ entityType: 'property', entityId: _data?.id ?? 'unknown', action: 'CREATE', source: 'admin' });
      Alert.alert('Success', 'Property added successfully');
      setShowAddModal(false);
    },
    onError: (err: Error) => Alert.alert('Error', err.message)});

  const deletePropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', id);
      if (error) throw error;
      await logAudit({ entityType: 'property', entityId: id, action: 'DELETE', source: 'admin' });
    },
    onSuccess: () => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      Alert.alert('Success', 'Property deleted');
    },
    onError: (err: Error) => Alert.alert('Error', err.message)});

  const archivePropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').update({ status: 'archived' }).eq('id', id);
      if (error) throw error;
      await logAudit({ entityType: 'property', entityId: id, action: 'ARCHIVE', source: 'admin' });
    },
    onSuccess: () => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      Alert.alert('Archived', 'Property has been archived.');
    },
    onError: (err: Error) => Alert.alert('Error', 'Failed to archive: ' + err.message)});

  const restorePropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').update({ status: 'coming_soon' }).eq('id', id);
      if (error) throw error;
      await logAudit({ entityType: 'property', entityId: id, action: 'RESTORE', source: 'admin' });
    },
    onSuccess: () => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      Alert.alert('Restored', 'Property has been restored.');
    },
    onError: (err: Error) => Alert.alert('Error', 'Failed to restore: ' + err.message)});

  const publishPropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').update({ status: 'active' }).eq('id', id);
      if (error) throw error;
      await logAudit({ entityType: 'property', entityId: id, action: 'PUBLISH', source: 'admin' });
    },
    onSuccess: () => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      Alert.alert('Published', 'Property is now live for investors.');
    },
    onError: (err: Error) => Alert.alert('Error', 'Failed to publish: ' + err.message)});

  const unpublishPropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').update({ status: 'coming_soon' }).eq('id', id);
      if (error) throw error;
      await logAudit({ entityType: 'property', entityId: id, action: 'UNPUBLISH', source: 'admin' });
    },
    onSuccess: () => {
      invalidatePropertiesCache();
      void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
      propertiesList.refresh();
      Alert.alert('Unpublished', 'Property is no longer live.');
    },
    onError: (err: Error) => Alert.alert('Error', 'Failed to unpublish: ' + err.message)});

  const filteredProperties = useMemo(() => {
    let result = properties;

    if (filter !== 'all') {
      result = result.filter((p: Property) => p.status === filter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p: Property) =>
          p.name.toLowerCase().includes(query) ||
          p.city.toLowerCase().includes(query) ||
          p.country.toLowerCase().includes(query)
      );
    }

    return result;
  }, [filter, searchQuery, properties]);

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const getStatusColor = (status: Property['status']) => {
    switch (status) {
      case 'live':
        return Colors.positive;
      case 'coming_soon':
        return Colors.warning;
      case 'funded':
        return Colors.primary;
      case 'closed':
        return Colors.textTertiary;
    }
  };

  const getStatusLabel = (status: Property['status']) => {
    switch (status) {
      case 'live':
        return 'Live';
      case 'coming_soon':
        return 'Coming Soon';
      case 'funded':
        return 'Funded';
      case 'closed':
        return 'Closed';
    }
  };

  const handleAddProperty = () => {
    setFormData({
      name: '',
      location: '',
      city: '',
      country: '',
      pricePerShare: '',
      totalShares: '',
      yield: '',
      propertyType: 'residential',
      status: 'coming_soon',
      description: ''});
    setEditingProperty(null);
    setShowAddModal(true);
  };

  const handleEditProperty = (property: Property) => {
    setFormData({
      name: property.name,
      location: property.location,
      city: property.city,
      country: property.country,
      pricePerShare: formatAmountInput(String(property.pricePerShare)),
      totalShares: formatAmountInput(String(property.totalShares)),
      yield: property.yield.toString(),
      propertyType: property.propertyType,
      status: property.status,
      description: property.description});
    setEditingProperty(property);
    setShowAddModal(true);
  };

  const handleDeleteProperty = useCallback((property: Property) => {
    Alert.alert(
      'Delete Property',
      `Are you sure you want to delete "${property.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deletePropertyMutation.mutate(property.id);
          }},
      ]
    );
  }, [deletePropertyMutation]);

  const handleSaveProperty = useCallback(() => {
    if (!formData.name || !formData.city || !formData.pricePerShare) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (editingProperty) {
      supabase.from('properties').update({
        name: formData.name,
        location: formData.location || formData.city,
        share_price: parseFloat(parseAmountInput(formData.pricePerShare)) || 0,
        total_shares: parseInt(parseAmountInput(formData.totalShares)) || 1000,
        annual_yield: parseFloat(formData.yield) || 0,
        type: formData.propertyType,
        status: formData.status === 'live' ? 'active' : formData.status}).eq('id', editingProperty.id).then(({ error }: { error: any }) => {
        if (error) { Alert.alert('Error', error.message); return; }
        invalidatePropertiesCache();
        void queryClient.invalidateQueries({ queryKey: ['admin-properties', 'page-1'] });
        void logAudit({ entityType: 'property', entityId: editingProperty.id, action: 'UPDATE', source: 'admin' });
        propertiesList.refresh();
        Alert.alert('Success', 'Property updated');
        setShowAddModal(false);
      });
    } else {
      addPropertyMutation.mutate({
        name: formData.name,
        location: formData.location || formData.city,
        share_price: parseFloat(parseAmountInput(formData.pricePerShare)) || 0,
        total_shares: parseInt(parseAmountInput(formData.totalShares)) || 1000,
        annual_yield: parseFloat(formData.yield) || 0,
        type: formData.propertyType,
        status: formData.status === 'live' ? 'active' : formData.status});
    }
  }, [formData, editingProperty, addPropertyMutation, queryClient]);

  const PropertyFormModal = () => (
    <Modal
      visible={showAddModal}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowAddModal(false)}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {editingProperty ? 'Edit Property' : 'Add Property'}
          </Text>
          <TouchableOpacity onPress={handleSaveProperty}>
            <Check size={24} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Property Name *</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Marina Bay Residences"
              placeholderTextColor={Colors.textTertiary}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Location</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. 123 Marina Boulevard"
              placeholderTextColor={Colors.textTertiary}
              value={formData.location}
              onChangeText={(text) => setFormData({ ...formData, location: text })}
            />
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.formLabel}>City *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="City"
                placeholderTextColor={Colors.textTertiary}
                value={formData.city}
                onChangeText={(text) => setFormData({ ...formData, city: text })}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.formLabel}>Country *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Country"
                placeholderTextColor={Colors.textTertiary}
                value={formData.country}
                onChangeText={(text) => setFormData({ ...formData, country: text })}
              />
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.formLabel}>Price/Share *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="0.00"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                value={formData.pricePerShare}
                onChangeText={(text) =>
                  setFormData({ ...formData, pricePerShare: formatAmountInput(parseAmountInput(text)) })
                }
              />
            </View>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.formLabel}>Total Shares *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="0"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="number-pad"
                value={formData.totalShares}
                onChangeText={(text) =>
                  setFormData({ ...formData, totalShares: formatAmountInput(parseAmountInput(text)) })
                }
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Expected Yield (%)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.0"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="decimal-pad"
              value={formData.yield}
              onChangeText={(text) => setFormData({ ...formData, yield: text })}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Property Type</Text>
            <View style={styles.typeSelector}>
              {(['residential', 'commercial', 'mixed', 'industrial'] as const).map(
                (type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeOption,
                      formData.propertyType === type && styles.typeOptionActive,
                    ]}
                    onPress={() => setFormData({ ...formData, propertyType: type })}
                  >
                    <Text
                      style={[
                        styles.typeOptionText,
                        formData.propertyType === type && styles.typeOptionTextActive,
                      ]}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Status</Text>
            <View style={styles.typeSelector}>
              {(['coming_soon', 'live', 'funded', 'closed'] as const).map((status) => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.typeOption,
                    formData.status === status && styles.typeOptionActive,
                  ]}
                  onPress={() => setFormData({ ...formData, status })}
                >
                  <Text
                    style={[
                      styles.typeOptionText,
                      formData.status === status && styles.typeOptionTextActive,
                    ]}
                  >
                    {getStatusLabel(status)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Description</Text>
            <TextInput
              style={[styles.formInput, styles.formTextArea]}
              placeholder="Property description..."
              placeholderTextColor={Colors.textTertiary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
            />
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleSaveProperty}>
            <Text style={styles.saveButtonText}>
              {editingProperty ? 'Update Property' : 'Add Property'}
            </Text>
          </TouchableOpacity>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Properties</Text>
          <Text style={styles.subtitle}>{properties.length} total properties{propertiesList.isLoading ? ' (loading...)' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={handleAddProperty}>
          <Plus size={20} color="#fff" />
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Search size={20} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search properties..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All' },
          { key: 'live', label: 'Live' },
          { key: 'coming_soon', label: 'Coming Soon' },
          { key: 'funded', label: 'Funded' },
          { key: 'closed', label: 'Closed' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key as FilterType)}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        style={styles.list}
        data={filteredProperties}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={propertiesList.isRefreshing}
            onRefresh={() => {
              setRefreshing(true);
              void Promise.resolve(propertiesList.refresh()).finally(() => setRefreshing(false));
            }}
            tintColor={Colors.primary}
          />
        }
        onEndReached={propertiesList.loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          propertiesList.isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={{ color: Colors.textSecondary, marginTop: 12, fontSize: 13 }}>Loading properties...</Text>
            </View>
          ) : propertiesList.isError ? (
            <ErrorState
              message={propertiesList.error?.message ?? 'Failed to load properties'}
              onRetry={propertiesList.refresh}
            />
          ) : (
            <EmptyState title="No properties found" />
          )
        }
        ListFooterComponent={<ListFooter isFetchingMore={propertiesList.isFetchingMore} hasMore={propertiesList.hasMore} />}
        renderItem={({ item: property }) => (
          <View key={property.id} style={styles.propertyCard}>
            <OptimizedImage
              uri={property.images[0]}
              width={undefined}
              height={140}
              style={styles.propertyImage}
              borderRadius={0}
              placeholderText={property.name}
              testID={`property-img-${property.id}`}
            />
            <View style={styles.propertyContent}>
              <View style={styles.propertyHeader}>
                <View style={styles.propertyInfo}>
                  <Text style={styles.propertyName}>{property.name}</Text>
                  <View style={styles.locationRow}>
                    <MapPin size={12} color={Colors.textSecondary} />
                    <Text style={styles.propertyLocation}>
                      {property.city}, {property.country}
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getStatusColor(property.status) + '20' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: getStatusColor(property.status) },
                    ]}
                  >
                    {getStatusLabel(property.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.propertyStats}>
                <View style={styles.propStat}>
                  <Text style={styles.propStatLabel}>Price/Share</Text>
                  <Text style={styles.propStatValue}>
                    {formatCurrencyWithDecimals(property.pricePerShare)}
                  </Text>
                </View>
                <View style={styles.propStat}>
                  <Text style={styles.propStatLabel}>Target</Text>
                  <Text style={styles.propStatValue}>
                    {formatCurrency(property.targetRaise)}
                  </Text>
                </View>
                <View style={styles.propStat}>
                  <Text style={styles.propStatLabel}>Yield</Text>
                  <Text style={[styles.propStatValue, { color: Colors.positive }]}>
                    {property.yield}%
                  </Text>
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Funding Progress</Text>
                  <Text style={styles.progressPercent}>
                    {Math.round((property.currentRaise / property.targetRaise) * 100)}%
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(
                          (property.currentRaise / property.targetRaise) * 100,
                          100
                        )}%`},
                    ]}
                  />
                </View>
                <Text style={styles.progressAmount}>
                  {formatCurrency(property.currentRaise)} of{' '}
                  {formatCurrency(property.targetRaise)}
                </Text>
              </View>

              <View style={styles.propertyActions}>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => handleEditProperty(property)}
                >
                  <Edit3 size={16} color={Colors.primary} />
                  <Text style={styles.editButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteProperty(property)}
                >
                  <Trash2 size={16} color={Colors.negative} />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />

      <PropertyFormModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10},
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1},
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    gap: 4,
    flexShrink: 0},
  addButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600'},
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 12},
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    color: Colors.text},
  filterContainer: {
    maxHeight: 44,
    marginBottom: 12},
  filterContent: {
    paddingHorizontal: 20,
    gap: 10},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: '#fff'},
  list: {
    flex: 1,
    paddingHorizontal: 20},
  propertyCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border},
  propertyImage: {
    width: '100%',
    height: 140},
  propertyContent: {
    padding: 16},
  propertyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'},
  propertyInfo: {
    flex: 1},
  propertyName: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 4},
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  propertyLocation: {
    fontSize: 13,
    color: Colors.textSecondary},
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8},
  statusText: {
    fontSize: 11,
    fontWeight: '600'},
  propertyStats: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  propStat: {
    flex: 1},
  propStatLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 4},
  propStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  progressSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8},
  progressLabel: {
    fontSize: 12,
    color: Colors.textSecondary},
  progressPercent: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary},
  progressBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden'},
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3},
  progressAmount: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 6},
  propertyActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '15',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6},
  editButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary},
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.negative + '15',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6},
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.negative},
  bottomPadding: {
    height: 100},
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text},
  modalContent: {
    flex: 1,
    padding: 20},
  formGroup: {
    marginBottom: 20},
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8},
  formInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border},
  formTextArea: {
    minHeight: 100,
    paddingTop: 12},
  formRow: {
    flexDirection: 'row',
    gap: 12},
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  typeOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  typeOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  typeOptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary},
  typeOptionTextActive: {
    color: '#fff'},
  saveButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10},
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'}});
