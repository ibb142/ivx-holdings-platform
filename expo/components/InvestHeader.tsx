import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Building2, DollarSign, Users, Plus } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency } from '@/lib/formatters';

interface InvestHeaderProps {
  propertiesCount: number;
  totalVolume: number;
  investorsCount: number;
  onSubmit: () => void;
  t: (key: string) => string;
}

const InvestHeader = memo(function InvestHeader({
  propertiesCount,
  totalVolume,
  investorsCount,
  onSubmit,
  t}: InvestHeaderProps) {
  return (
    <View style={styles.headerCard}>
      <View style={styles.headerTop}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {t('propertyInvestment')}
          </Text>
          <Text style={styles.headerSubtitle}>{t('fractionalOwnership')}</Text>
        </View>
        <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
          <Plus size={14} color={Colors.black} />
          <Text style={styles.submitButtonText}>{t('submitLabel')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: Colors.primary + '20' }]}>
            <Building2 size={18} color={Colors.primary} />
          </View>
          <Text style={styles.statValue}>{propertiesCount}</Text>
          <Text style={styles.statLabel}>{t('properties')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: Colors.success + '20' }]}>
            <DollarSign size={18} color={Colors.success} />
          </View>
          <Text style={styles.statValue}>{formatCurrency(totalVolume, true)}</Text>
          <Text style={styles.statLabel}>{t('totalVolume')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: Colors.info + '20' }]}>
            <Users size={18} color={Colors.info} />
          </View>
          <Text style={styles.statValue}>{investorsCount}</Text>
          <Text style={styles.statLabel}>{t('investors')}</Text>
        </View>
      </View>
    </View>
  );
});

export default InvestHeader;

const styles = StyleSheet.create({
  headerCard: {
    margin: 20,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10},
  headerTitleWrap: {
    flex: 1,
    minWidth: 0},
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text},
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 4},
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 0},
  submitButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 14},
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center'},
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6},
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  statValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 11},
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.surfaceBorder}});
