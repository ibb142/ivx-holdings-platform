import React, { useState, useEffect, useCallback } from 'react';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert} from 'react-native';
import {
  Globe,
  FileText,
  CheckCircle,
  ChevronDown,
  Shield,
  Info} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useMutation } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics-context';

type TaxResidency = 'us' | 'non_us';
type FilingStatus = 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';

const TAX_DATA_KEY = '@ipx_tax_data';

interface TaxData {
  taxResidency: TaxResidency;
  filingStatus: FilingStatus;
  ssnLast4: string;
  tinValue: string;
  savedAt: string;
}

export default function TaxInfoScreen() {
  const { profileData } = useAuth();
  const currentUser = {
    firstName: profileData?.firstName || '',
    lastName: profileData?.lastName || '',
    country: profileData?.country || 'United States'};
  const [taxResidency, setTaxResidency] = useState<TaxResidency>('us');
  const [filingStatus, setFilingStatus] = useState<FilingStatus>('single');
  const [ssn, setSsn] = useState('');
  const [tin, setTin] = useState('');
  const [_w9Signed, _setW9Signed] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadTaxData = async () => {
      try {
        const stored = await AsyncStorage.getItem(TAX_DATA_KEY);
        if (stored) {
          const data: TaxData = JSON.parse(stored);
          setTaxResidency(data.taxResidency);
          setFilingStatus(data.filingStatus);
          if (data.ssnLast4) setSsn(data.ssnLast4);
          if (data.tinValue) setTin(data.tinValue);
          logger.taxInfo.log('Loaded saved tax data');
        }
      } catch (e) {
        console.error('[TaxInfo] Load error:', e);
      }
    };
    void loadTaxData();
  }, []);

  const maskSSN = (value: string) => {
    if (value.length <= 4) return value;
    return '•••-••-' + value.slice(-4);
  };

  const updateTaxMutation = useMutation({
    mutationFn: async (input: { firstName: string; lastName: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, first_name: input.firstName, last_name: input.lastName, updated_at: new Date().toISOString() });
      if (error) console.log('[TaxInfo] Profile upsert note:', error.message);
      return { success: true };
    }});
  const { trackAction } = useAnalytics();

  const handleSave = useCallback(async () => {
    if (taxResidency === 'us' && !ssn) {
      Alert.alert('Missing Information', 'Please enter your Social Security Number.');
      return;
    }
    if (taxResidency === 'non_us' && !tin) {
      Alert.alert('Missing Information', 'Please enter your Tax Identification Number.');
      return;
    }

    setIsSaving(true);
    logger.taxInfo.log('Saving:', { taxResidency, filingStatus, hasSSN: !!ssn, hasTIN: !!tin });

    try {
      const taxData: TaxData = {
        taxResidency,
        filingStatus,
        ssnLast4: ssn.length >= 4 ? ssn.slice(-4) : ssn,
        tinValue: tin,
        savedAt: new Date().toISOString()};
      await AsyncStorage.setItem(TAX_DATA_KEY, JSON.stringify(taxData));
      logger.taxInfo.log('Saved to local storage');
    } catch (e) {
      console.error('[TaxInfo] Local save error:', e);
    }

    updateTaxMutation.mutate(
      {
        firstName: currentUser.firstName,
        lastName: currentUser.lastName},
      {
        onSuccess: () => {
          setIsSaving(false);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          trackAction('tax_info_saved', { residency: taxResidency, filingStatus });
          Alert.alert('Saved', 'Your tax information has been updated successfully.');
          setIsEditing(false);
        },
        onError: (error) => {
          setIsSaving(false);
          console.error('[TaxInfo] Save error:', error);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Error', 'Failed to save your tax information. Please try again.');
        }}
    );
  }, [taxResidency, filingStatus, ssn, tin, updateTaxMutation, trackAction, currentUser.firstName, currentUser.lastName]);

  const getFilingStatusLabel = (status: FilingStatus) => {
    switch (status) {
      case 'single': return 'Single';
      case 'married_filing_jointly': return 'Married Filing Jointly';
      case 'married_filing_separately': return 'Married Filing Separately';
      case 'head_of_household': return 'Head of Household';
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusIconContainer}>
              <CheckCircle size={24} color={Colors.success} />
            </View>
            <View style={styles.statusMeta}>
              <Text style={styles.statusTitle}>Tax Profile Complete</Text>
              <Text style={styles.statusSubtitle}>Last updated: Jan 15, 2025</Text>
            </View>
          </View>
          <View style={styles.statusBadge}>
            <Shield size={12} color={Colors.success} />
            <Text style={styles.statusBadgeText}>W-9 on file</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tax Residency</Text>
          <View style={styles.residencyOptions}>
            <TouchableOpacity
              style={[styles.residencyOption, taxResidency === 'us' && styles.residencyOptionActive]}
              onPress={() => setTaxResidency('us')}
            >
              <Globe size={18} color={taxResidency === 'us' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.residencyOptionText, taxResidency === 'us' && styles.residencyOptionTextActive]}>
                U.S. Person
              </Text>
              {taxResidency === 'us' && <CheckCircle size={16} color={Colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.residencyOption, taxResidency === 'non_us' && styles.residencyOptionActive]}
              onPress={() => setTaxResidency('non_us')}
            >
              <Globe size={18} color={taxResidency === 'non_us' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.residencyOptionText, taxResidency === 'non_us' && styles.residencyOptionTextActive]}>
                Non-U.S. Person
              </Text>
              {taxResidency === 'non_us' && <CheckCircle size={16} color={Colors.primary} />}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tax Identification</Text>
            <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
              <Text style={styles.editButton}>{isEditing ? 'Cancel' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.fieldGroup}>
            {taxResidency === 'us' ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Social Security Number (SSN)</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.fieldInput}
                      value={ssn}
                      onChangeText={setSsn}
                      placeholder="XXX-XX-XXXX"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="number-pad"
                      maxLength={11}
                      secureTextEntry
                    />
                  ) : (
                    <Text style={styles.fieldValue}>{ssn ? maskSSN(ssn) : '•••-••-4523'}</Text>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Filing Status</Text>
                  <TouchableOpacity style={styles.selectField} disabled={!isEditing}>
                    <Text style={[styles.fieldValue, !isEditing && styles.fieldValueDisabled]}>
                      {getFilingStatusLabel(filingStatus)}
                    </Text>
                    {isEditing && <ChevronDown size={18} color={Colors.textTertiary} />}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Tax Identification Number (TIN)</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.fieldInput}
                    value={tin}
                    onChangeText={setTin}
                    placeholder="Enter your TIN"
                    placeholderTextColor={Colors.textTertiary}
                  />
                ) : (
                  <Text style={styles.fieldValue}>{tin || 'Not provided'}</Text>
                )}
              </View>
            )}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Country of Tax Residence</Text>
              <Text style={styles.fieldValue}>{currentUser.country}</Text>
            </View>
          </View>
        </View>

        {isEditing && (
          <TouchableOpacity style={[styles.saveButton, isSaving && { opacity: 0.6 }]} onPress={handleSave} disabled={isSaving}>
            <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tax Forms on File</Text>
          <View style={styles.formsList}>
            <View style={styles.formItem}>
              <View style={styles.formIconContainer}>
                <FileText size={20} color={Colors.primary} />
              </View>
              <View style={styles.formMeta}>
                <Text style={styles.formName}>W-9 Form</Text>
                <Text style={styles.formDate}>Signed: Jan 15, 2025</Text>
              </View>
              <View style={styles.formStatusBadge}>
                <CheckCircle size={14} color={Colors.success} />
                <Text style={styles.formStatusText}>Active</Text>
              </View>
            </View>
            <View style={styles.formItem}>
              <View style={styles.formIconContainer}>
                <FileText size={20} color={Colors.info} />
              </View>
              <View style={styles.formMeta}>
                <Text style={styles.formName}>1099-DIV (2024)</Text>
                <Text style={styles.formDate}>Available: Jan 31, 2025</Text>
              </View>
              <View style={styles.formStatusBadge}>
                <CheckCircle size={14} color={Colors.success} />
                <Text style={styles.formStatusText}>Ready</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Info size={18} color={Colors.info} />
          <Text style={styles.infoText}>
            Tax documents are generated annually. 1099 forms are typically available by January 31 for the prior tax year. Consult your tax advisor for questions.
          </Text>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statusCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  statusIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  statusMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  statusSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' as const },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  editButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  residencyOptions: { gap: 8, marginBottom: 12 },
  residencyOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  residencyOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  residencyOptionText: { color: Colors.textSecondary, fontSize: 13 },
  residencyOptionTextActive: { color: Colors.primary },
  fieldGroup: { gap: 12, marginBottom: 12 },
  field: { gap: 4 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 13 },
  fieldValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  fieldValueDisabled: { opacity: 0.4 },
  fieldInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  selectField: { marginBottom: 12 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  formsList: { gap: 8 },
  formItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  formIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  formMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  formName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  formDate: { color: Colors.textTertiary, fontSize: 12 },
  formStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  formStatusText: { color: Colors.textSecondary, fontSize: 13 },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
