import React, { useState } from 'react';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Camera,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Globe,
  Check,
  Edit2} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { EmptyState } from '@/components/ivx';

import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAnalytics } from '@/lib/analytics-context';

export default function PersonalInfoScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { profileData, refetchProfile } = useAuth();
  const { trackAction } = useAnalytics();
  const updateProfileMutation = useMutation({
    mutationFn: async (input: { firstName: string; lastName: string; phone: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: metaError } = await supabase.auth.updateUser({
        data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone }});
      if (metaError) console.log('[PersonalInfo] Meta update note:', metaError.message);

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          updated_at: new Date().toISOString()});
      if (error) console.log('[PersonalInfo] Profile upsert note:', error.message);

      return { success: true };
    }});
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const currentUser = profileData ? {
    firstName: profileData.firstName || '',
    lastName: profileData.lastName || '',
    email: profileData.email || '',
    phone: profileData.phone || '',
    country: profileData.country || '',
    avatar: profileData.avatar || '',
    kycStatus: 'pending' as const} : {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: '',
    avatar: '',
    kycStatus: 'pending' as const};

  const [formData, setFormData] = useState({
    firstName: currentUser.firstName,
    lastName: currentUser.lastName,
    email: currentUser.email,
    phone: currentUser.phone || '',
    country: currentUser.country,
    dateOfBirth: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    avatar: currentUser.avatar || ''});

  const updateForm = (key: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant photo library permissions to change your profile photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8});

    if (!result.canceled && result.assets[0]) {
      updateForm('avatar', result.assets[0].uri);
    }
  };

  const handleSave = () => {
    if (!formData.firstName || !formData.lastName) {
      Alert.alert('Missing Information', 'Please enter your full name.');
      return;
    }
    if (!formData.email) {
      Alert.alert('Missing Information', 'Please enter your email address.');
      return;
    }

    setIsSaving(true);
    logger.personalInfo.log('Saving:', formData);

    updateProfileMutation.mutate(
      {
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone},
      {
        onSuccess: () => {
          setIsSaving(false);
          setIsEditing(false);
          trackAction('profile_updated', { fields: ['firstName', 'lastName', 'phone', 'country'] });
          void refetchProfile();
          Alert.alert('Success', 'Your personal information has been updated.');
        },
        onError: (error) => {
          setIsSaving(false);
          console.error('[PersonalInfo] Save error:', error);
          Alert.alert('Error', 'Failed to update your information. Please try again.');
        }}
    );
  };

  const renderField = (
    label: string,
    value: string,
    key: keyof typeof formData,
    icon: React.ReactNode,
    options?: {
      keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
      editable?: boolean;
      placeholder?: string;
    }
  ) => {
    const editable = options?.editable !== false;

    return (
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
          <View style={styles.fieldIcon}>{icon}</View>
          {isEditing && editable ? (
            <TextInput
              style={styles.fieldInput}
              value={value}
              onChangeText={(text) => updateForm(key, text)}
              placeholder={options?.placeholder || label}
              placeholderTextColor={Colors.textTertiary}
              keyboardType={options?.keyboardType || 'default'}
            />
          ) : (
            <Text style={[styles.fieldValue, !editable && styles.fieldValueDisabled]}>
              {value || 'Not set'}
            </Text>
          )}
        </View>
        {!editable && isEditing && (
          <Text style={styles.fieldHint}>Cannot be changed. Contact support if needed.</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Personal Information</Text>
          {isEditing ? (
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={isSaving}
            >
              <Check size={24} color={Colors.success} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
            >
              <Edit2 size={20} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarContainer}
              onPress={isEditing ? pickAvatar : undefined}
              disabled={!isEditing}
            >
              {formData.avatar ? (
                <Image source={{ uri: formData.avatar }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <User size={40} color={Colors.textSecondary} />
                </View>
              )}
              {isEditing && (
                <View style={styles.avatarEditBadge}>
                  <Camera size={16} color={Colors.white} />
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.avatarName}>
              {formData.firstName} {formData.lastName}
            </Text>
            <Text style={styles.avatarEmail}>{formData.email}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>
            <View style={styles.sectionContent}>
              <View style={styles.nameRow}>
                <View style={[styles.fieldContainer, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>First Name</Text>
                  <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
                    <View style={styles.fieldIcon}>
                      <User size={18} color={Colors.textTertiary} />
                    </View>
                    {isEditing ? (
                      <TextInput
                        style={styles.fieldInput}
                        value={formData.firstName}
                        onChangeText={(text) => updateForm('firstName', text)}
                        placeholder="First name"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Text style={styles.fieldValue}>{formData.firstName}</Text>
                    )}
                  </View>
                </View>
                <View style={[styles.fieldContainer, { flex: 1, marginLeft: 12 }]}>
                  <Text style={styles.fieldLabel}>Last Name</Text>
                  <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
                    <View style={styles.fieldIcon}>
                      <User size={18} color={Colors.textTertiary} />
                    </View>
                    {isEditing ? (
                      <TextInput
                        style={styles.fieldInput}
                        value={formData.lastName}
                        onChangeText={(text) => updateForm('lastName', text)}
                        placeholder="Last name"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Text style={styles.fieldValue}>{formData.lastName}</Text>
                    )}
                  </View>
                </View>
              </View>

              {renderField(
                'Email Address',
                formData.email,
                'email',
                <Mail size={18} color={Colors.textTertiary} />,
                { keyboardType: 'email-address', editable: false }
              )}

              {renderField(
                'Phone Number',
                formData.phone,
                'phone',
                <Phone size={18} color={Colors.textTertiary} />,
                { keyboardType: 'phone-pad', placeholder: '+1 (555) 123-4567' }
              )}

              {renderField(
                'Date of Birth',
                formData.dateOfBirth,
                'dateOfBirth',
                <Calendar size={18} color={Colors.textTertiary} />,
                { placeholder: 'YYYY-MM-DD' }
              )}

              {renderField(
                'Country',
                formData.country,
                'country',
                <Globe size={18} color={Colors.textTertiary} />
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Address</Text>
            <View style={styles.sectionContent}>
              {renderField(
                'Street Address',
                formData.address,
                'address',
                <MapPin size={18} color={Colors.textTertiary} />,
                { placeholder: '123 Main Street' }
              )}

              <View style={styles.nameRow}>
                <View style={[styles.fieldContainer, { flex: 2 }]}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
                    {isEditing ? (
                      <TextInput
                        style={[styles.fieldInput, { paddingLeft: 14 }]}
                        value={formData.city}
                        onChangeText={(text) => updateForm('city', text)}
                        placeholder="City"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Text style={[styles.fieldValue, { paddingLeft: 14 }]}>{formData.city}</Text>
                    )}
                  </View>
                </View>
                <View style={[styles.fieldContainer, { flex: 1, marginLeft: 12 }]}>
                  <Text style={styles.fieldLabel}>State</Text>
                  <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
                    {isEditing ? (
                      <TextInput
                        style={[styles.fieldInput, { paddingLeft: 14 }]}
                        value={formData.state}
                        onChangeText={(text) => updateForm('state', text)}
                        placeholder="State"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Text style={[styles.fieldValue, { paddingLeft: 14 }]}>{formData.state}</Text>
                    )}
                  </View>
                </View>
              </View>

              <View style={[styles.fieldContainer, { maxWidth: 150 }]}>
                <Text style={styles.fieldLabel}>Zip Code</Text>
                <View style={[styles.fieldContent, !isEditing && styles.fieldContentReadOnly]}>
                  {isEditing ? (
                    <TextInput
                      style={[styles.fieldInput, { paddingLeft: 14 }]}
                      value={formData.zipCode}
                      onChangeText={(text) => updateForm('zipCode', text)}
                      placeholder="Zip"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="number-pad"
                    />
                  ) : (
                    <Text style={[styles.fieldValue, { paddingLeft: 14 }]}>{formData.zipCode}</Text>
                  )}
                </View>
              </View>
            </View>
          </View>

          {isEditing && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setFormData({
                  firstName: currentUser.firstName,
                  lastName: currentUser.lastName,
                  email: currentUser.email,
                  phone: currentUser.phone || '',
                  country: currentUser.country,
                  dateOfBirth: '',
                  address: '',
                  city: '',
                  state: '',
                  zipCode: '',
                  avatar: currentUser.avatar || ''});
                setIsEditing(false);
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel Changes</Text>
            </TouchableOpacity>
          )}

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
  editButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  saveButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  avatarSection: { marginBottom: 16 },
  avatarContainer: { gap: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  avatarEditBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  avatarName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  avatarEmail: { color: Colors.textSecondary, fontSize: 13 },
  section: { marginBottom: 20 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionContent: { gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldContainer: { gap: 8 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 13 },
  fieldContent: { flex: 1, gap: 4 },
  fieldContentReadOnly: { paddingVertical: 8 },
  fieldIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  fieldInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  fieldValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  fieldValueDisabled: { opacity: 0.4 },
  fieldHint: { color: Colors.textTertiary, fontSize: 11, marginTop: 4 },
  cancelButton: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  cancelButtonText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  bottomPadding: { height: 120 }});
