import React, { useState, useRef, useEffect } from 'react';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  Linking,
  Platform,
  Animated} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Mail,
  Phone,
  Globe,
  Edit2,
  Check,
  X,
  Building2,
  Copy,
  ExternalLink} from 'lucide-react-native';
import Colors from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ipx_company_info';

interface CompanyInfo {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  email: string;
  ceoEmail: string;
  phone: string;
  website: string;
}

const DEFAULT_INFO: CompanyInfo = {
  address: '1001 Brickell Bay Drive, Suite 2700',
  city: 'Miami',
  state: 'FL',
  zipCode: '33131',
  email: 'support@ivxholding.com',
  ceoEmail: 'ceo@ivxholding.com',
  phone: '',
  website: 'www.ivxholding.com'};

export default function CompanyInfoScreen() {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [info, setInfo] = useState<CompanyInfo>(DEFAULT_INFO);
  const [editInfo, setEditInfo] = useState<CompanyInfo>(DEFAULT_INFO);
  const [isSaving, setIsSaving] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true}).start();
    loadInfo();
  }, []);

  const loadInfo = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CompanyInfo;
        setInfo(parsed);
        setEditInfo(parsed);
        logger.companyInfo.log('Loaded company info from storage');
      }
    } catch (e) {
      logger.companyInfo.error('Error loading company info:', e);
    }
  };

  const handleSave = async () => {
    if (!editInfo.address.trim()) {
      Alert.alert('Missing Info', 'Please enter the company address.');
      return;
    }
    if (!editInfo.email.trim()) {
      Alert.alert('Missing Info', 'Please enter the company email.');
      return;
    }
    if (!editInfo.phone.trim()) {
      Alert.alert('Missing Info', 'Please enter the company phone number.');
      return;
    }

    setIsSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(editInfo));
      setInfo(editInfo);
      setIsEditing(false);
      logger.companyInfo.log('Company info saved:', editInfo);
      Alert.alert('Saved', 'Company information has been updated.');
    } catch (e) {
      logger.companyInfo.error('Error saving company info:', e);
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditInfo(info);
    setIsEditing(false);
  };

  const openEmail = async () => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(info.email);
      Alert.alert('Email Copied', `${info.email} has been copied to your clipboard.`);
    } catch {
      Alert.alert('Email Address', info.email);
    }
  };

  const openPhone = () => {
    const phoneUrl = Platform.OS === 'web'
      ? `tel:${info.phone.replace(/[^+\d]/g, '')}`
      : `tel:${info.phone.replace(/[^+\d]/g, '')}`;
    Linking.openURL(phoneUrl).catch(() => {
      Alert.alert('Error', 'Could not open phone dialer.');
    });
  };

  const openMaps = () => {
    const fullAddress = `${info.address}, ${info.city}, ${info.state} ${info.zipCode}`;
    const encoded = encodeURIComponent(fullAddress);
    const url = Platform.select({
      ios: `maps:0,0?q=${encoded}`,
      android: `geo:0,0?q=${encoded}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encoded}`});
    if (url) {
      Linking.openURL(url).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
      });
    }
  };

  const openWebsite = () => {
    const url = info.website.startsWith('http') ? info.website : `https://${info.website}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open website.');
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', `${label} copied to clipboard.`);
    } catch {
      logger.companyInfo.warn('Copy failed');
    }
  };

  const updateField = (key: keyof CompanyInfo, value: string) => {
    setEditInfo(prev => ({ ...prev, [key]: value }));
  };

  const renderQuickAction = (
    icon: React.ReactNode,
    label: string,
    onPress: () => void,
    color: string,
  ) => (
    <TouchableOpacity
      style={[styles.quickAction, { borderColor: color + '30' }]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`action-${label.toLowerCase()}`}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: color + '18' }]}>
        {icon}
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const renderContactCard = (
    icon: React.ReactNode,
    label: string,
    value: string,
    fieldKey: keyof CompanyInfo,
    onAction: () => void,
    actionLabel: string,
    color: string,
    keyboardType?: 'default' | 'email-address' | 'phone-pad',
  ) => (
    <View style={styles.contactCard} testID={`field-${fieldKey}`}>
      <View style={styles.contactCardHeader}>
        <View style={[styles.contactIcon, { backgroundColor: color + '18' }]}>
          {icon}
        </View>
        <Text style={styles.contactLabel}>{label}</Text>
        {!isEditing && (
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => copyToClipboard(value, label)}
          >
            <Copy size={14} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
      {isEditing ? (
        <TextInput
          style={styles.contactInput}
          value={editInfo[fieldKey]}
          onChangeText={(text) => updateField(fieldKey, text)}
          placeholder={label}
          placeholderTextColor={Colors.textTertiary}
          keyboardType={keyboardType || 'default'}
          autoCapitalize="none"
        />
      ) : (
        <TouchableOpacity style={styles.contactValueRow} onPress={onAction}>
          <Text style={styles.contactValue}>{value}</Text>
          <ExternalLink size={14} color={color} />
        </TouchableOpacity>
      )}
      {!isEditing && (
        <TouchableOpacity style={[styles.contactAction, { backgroundColor: color + '15' }]} onPress={onAction}>
          <Text style={[styles.contactActionText, { color }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="back-btn">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>IVX HOLDINGS LLC</Text>
          {isEditing ? (
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <X size={20} color={Colors.error} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={isSaving}
                testID="save-btn"
              >
                <Check size={18} color={Colors.background} />
                <Text style={styles.saveBtnText}>{isSaving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => setIsEditing(true)}
              testID="edit-btn"
            >
              <Edit2 size={16} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <Animated.View style={[styles.brandSection, { opacity: fadeAnim }]}>
            <View style={styles.logoRow}>
              <Image
                source={IVX_LOGO_SOURCE}
                style={styles.logo}
                resizeMode="contain"
              />
              <View style={styles.brandText}>
                <Text style={styles.brandName}>IVX HOLDINGS LLC</Text>
                <Text style={styles.brandTagline}>Real Estate Investment Platform</Text>
              </View>
            </View>
            <View style={styles.brandDivider} />
            <Text style={styles.brandDesc}>
              Premier fractional real estate investment platform. We democratize property investing, making it accessible to everyone worldwide.
            </Text>
          </Animated.View>

          {!isEditing && (
            <View style={styles.quickActions}>
              {renderQuickAction(
                <Phone size={20} color={Colors.success} />,
                'Call',
                openPhone,
                Colors.success,
              )}
              {renderQuickAction(
                <Mail size={20} color={Colors.info} />,
                'Email',
                openEmail,
                Colors.info,
              )}
              {renderQuickAction(
                <MapPin size={20} color={Colors.warning} />,
                'Directions',
                openMaps,
                Colors.warning,
              )}
              {renderQuickAction(
                <Globe size={20} color={Colors.primary} />,
                'Website',
                openWebsite,
                Colors.primary,
              )}
            </View>
          )}

          <View style={styles.sectionHeader}>
            <Building2 size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>
              {isEditing ? 'Edit Contact Details' : 'Contact Details'}
            </Text>
          </View>

          {renderContactCard(
            <Phone size={18} color={Colors.success} />,
            'Phone Number',
            info.phone,
            'phone',
            openPhone,
            'Tap to call',
            Colors.success,
            'phone-pad',
          )}

          {renderContactCard(
            <Mail size={18} color={Colors.info} />,
            'Email Address',
            info.email,
            'email',
            openEmail,
            'Send email',
            Colors.info,
            'email-address',
          )}

          <View style={styles.contactCard} testID="field-address">
            <View style={styles.contactCardHeader}>
              <View style={[styles.contactIcon, { backgroundColor: Colors.warning + '18' }]}>
                <MapPin size={18} color={Colors.warning} />
              </View>
              <Text style={styles.contactLabel}>Office Address</Text>
              {!isEditing && (
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => copyToClipboard(
                    `${info.address}, ${info.city}, ${info.state} ${info.zipCode}`,
                    'Address',
                  )}
                >
                  <Copy size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
            {isEditing ? (
              <View style={styles.addressFields}>
                <TextInput
                  style={styles.contactInput}
                  value={editInfo.address}
                  onChangeText={(text) => updateField('address', text)}
                  placeholder="Street Address"
                  placeholderTextColor={Colors.textTertiary}
                />
                <View style={styles.addressRow}>
                  <TextInput
                    style={[styles.contactInput, { flex: 2 }]}
                    value={editInfo.city}
                    onChangeText={(text) => updateField('city', text)}
                    placeholder="City"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <TextInput
                    style={[styles.contactInput, { flex: 1, marginLeft: 10 }]}
                    value={editInfo.state}
                    onChangeText={(text) => updateField('state', text)}
                    placeholder="State"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>
                <TextInput
                  style={[styles.contactInput, { maxWidth: 140 }]}
                  value={editInfo.zipCode}
                  onChangeText={(text) => updateField('zipCode', text)}
                  placeholder="Zip Code"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                />
              </View>
            ) : (
              <TouchableOpacity style={styles.contactValueRow} onPress={openMaps}>
                <Text style={styles.contactValue}>
                  {info.address}{'\n'}{info.city}, {info.state} {info.zipCode}
                </Text>
                <ExternalLink size={14} color={Colors.warning} />
              </TouchableOpacity>
            )}
            {!isEditing && (
              <TouchableOpacity
                style={[styles.contactAction, { backgroundColor: Colors.warning + '15' }]}
                onPress={openMaps}
              >
                <Text style={[styles.contactActionText, { color: Colors.warning }]}>Open in Maps</Text>
              </TouchableOpacity>
            )}
          </View>

          {renderContactCard(
            <Globe size={18} color={Colors.primary} />,
            'Website',
            info.website,
            'website',
            openWebsite,
            'Visit website',
            Colors.primary,
          )}

          <View style={styles.legalFooter}>
            <Text style={styles.legalText}>
              {'\u00A9'} {new Date().getFullYear()} IVX HOLDINGS LLC. All rights reserved.
            </Text>
            <Text style={styles.legalText}>Licensed and regulated.</Text>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  cancelBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  scrollContent: { padding: 20, paddingBottom: 140 },
  brandSection: { marginBottom: 16 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 48, height: 48, borderRadius: 12 },
  brandText: { flex: 1 },
  brandName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  brandTagline: { gap: 4 },
  brandDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  brandDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickAction: { gap: 4 },
  quickActionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { color: Colors.textSecondary, fontSize: 13 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  contactCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contactCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  contactIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  contactLabel: { color: Colors.textSecondary, fontSize: 13 },
  copyBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  contactValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  contactInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contactAction: { gap: 4 },
  contactActionText: { color: Colors.textSecondary, fontSize: 13 },
  addressFields: { gap: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  legalText: { color: Colors.textSecondary, fontSize: 13 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
