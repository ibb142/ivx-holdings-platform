/**
 * IVX Enterprise Registration Screen — Three-Step Flow
 *
 * STEP 1 — Account:     First name, last name, email, phone, password, DOB, terms
 * STEP 2 — Role:        Primary role selection (maps to registration_type = enterprise)
 * STEP 3 — Enterprise:  Company details (legal name, type, industry, address, etc.)
 * REVIEW:               Review all fields before submission
 * SUBMIT:               Calls real production API (individual + enterprise registration)
 * CONFIRMATION:         Shows real enterprise ID, member ID, trace ID
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Building2,
  User,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  Globe,
  MapPin,
  Briefcase,
  Users,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Shield,
  ChevronRight,
  FileText,
  Calendar,
  AlertCircle} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { COUNTRIES, Country } from '@/constants/countries';
import {
  STEPS,
  VISIBLE_STEPS,
  Step,
  ROLE_OPTIONS,
  COMPANY_TYPES,
  COMPANY_TYPE_LABELS,
  INDUSTRIES,
  BUSINESS_CATEGORIES,
  EnterpriseRegistrationFormValues,
  EnterpriseRegistrationState,
  ValidationErrorMap,
  EnterprisePrimaryRole,
  CompanyType,
  createInitialState,
  createEmptyFormValues,
  validateStep,
  isStepValid,
  validateEmail,
  validatePhone,
  validatePassword,
  validateWebsite,
  validateZip,
  getUserFriendlyError,
  executeFullEnterpriseRegistration,
  generateIdempotencyKey,
  DRAFT_STORAGE_KEY,
  DraftStorageAdapter,
  saveDraft,
  loadDraft,
  clearDraft,
  draftToFormValues,
  EnterpriseRegistrationDraft} from '@/lib/enterprise-registration-shared';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// ---------------------------------------------------------------------------
// SecureStore-backed draft adapter (passwords never persisted)
// ---------------------------------------------------------------------------

const secureDraftAdapter: DraftStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  }};

// ---------------------------------------------------------------------------
// Progress indicator
// ---------------------------------------------------------------------------

function ProgressBar({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <View style={styles.progressContainer}>
      {VISIBLE_STEPS.map((step, index) => {
        const isComplete = currentStepIndex > index;
        const isCurrent = currentStepIndex === index;
        const stepLabels = ['Account', 'Role', 'Enterprise'];
        return (
          <React.Fragment key={step}>
            <View style={styles.progressStep}>
              <View
                style={[
                  styles.progressCircle,
                  isComplete && styles.progressCircleComplete,
                  isCurrent && styles.progressCircleCurrent,
                ]}
                accessibilityLabel={`Step ${index + 1}: ${stepLabels[index]} ${isComplete ? 'complete' : isCurrent ? 'current' : 'pending'}`}
              >
                {isComplete ? (
                  <CheckCircle size={18} color={Colors.primaryBlack} />
                ) : (
                  <Text
                    style={[
                      styles.progressNumber,
                      isCurrent ? styles.progressNumberCurrent : styles.progressNumberPending,
                    ]}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.progressLabel,
                  isCurrent ? styles.progressLabelCurrent : styles.progressLabelPending,
                ]}
              >
                {stepLabels[index]}
              </Text>
            </View>
            {index < VISIBLE_STEPS.length - 1 && (
              <View
                style={[
                  styles.progressLine,
                  isComplete && styles.progressLineComplete,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  icon?: React.ReactNode;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  accessibilityLabel?: string;
  multiline?: boolean;
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  icon,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  accessibilityLabel,
  multiline}: FieldProps) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrapper, error && styles.inputWrapperError]}>
        {icon && <View style={styles.inputIcon}>{icon}</View>}
        <TextInput
          style={[styles.textInput, multiline && styles.textInputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.inputPlaceholder}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          accessibilityLabel={accessibilityLabel || label}
          accessibilityHint={error ? `Error: ${error}` : undefined}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
        />
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Country picker (simplified dropdown)
// ---------------------------------------------------------------------------

interface CountryPickerProps {
  label: string;
  value: string;
  onSelect: (country: Country) => void;
  error?: string;
}

function CountryPicker({ label, value, onSelect, error }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = COUNTRIES.find(c => c.name === value || c.code === value);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.inputWrapper, error && styles.inputWrapperError]}
        onPress={() => setOpen(!open)}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <View style={styles.inputIcon}>
          <Globe size={20} color={Colors.mutedGray} />
        </View>
        <Text style={[styles.textInput, !value && styles.placeholderText]}>
          {selected ? `${selected.name} (${selected.dialCode})` : 'Select country'}
        </Text>
        <ChevronRight size={18} color={Colors.mutedGray} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </TouchableOpacity>
      {open && (
        <View style={styles.countryDropdown}>
          <TextInput
            style={styles.countrySearch}
            value={search}
            onChangeText={setSearch}
            placeholder="Search countries..."
            placeholderTextColor={Colors.inputPlaceholder}
            autoCapitalize="none"
          />
          <ScrollView style={styles.countryList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {filtered.slice(0, 50).map(country => (
              <TouchableOpacity
                key={country.code}
                style={styles.countryItem}
                onPress={() => {
                  onSelect(country);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <Text style={styles.countryItemText}>
                  {country.name} ({country.dialCode})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {error ? (
        <View style={styles.errorRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Role card
// ---------------------------------------------------------------------------

interface RoleCardProps {
  role: { id: EnterprisePrimaryRole; label: string; description: string };
  selected: boolean;
  onSelect: () => void;
}

function RoleCard({ role, selected, onSelect }: RoleCardProps) {
  return (
    <TouchableOpacity
      style={[styles.roleCard, selected && styles.roleCardSelected]}
      onPress={onSelect}
      accessibilityLabel={`Select role: ${role.label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={styles.roleCardHeader}>
        <View style={[styles.roleCardRadio, selected && styles.roleCardRadioSelected]}>
          {selected && <CheckCircle size={16} color={Colors.primaryBlack} />}
        </View>
        <Text style={[styles.roleCardLabel, selected && styles.roleCardLabelSelected]}>
          {role.label}
        </Text>
      </View>
      <Text style={styles.roleCardDescription}>{role.description}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Select dropdown (company type, industry, etc.)
// ---------------------------------------------------------------------------

interface SelectFieldProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  error?: string;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
}

function SelectField({ label, value, options, onSelect, error, icon, accessibilityLabel }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find(o => o.value === value);

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.inputWrapper, error && styles.inputWrapperError]}
        onPress={() => setOpen(!open)}
        accessibilityLabel={accessibilityLabel || label}
        accessibilityRole="button"
      >
        {icon && <View style={styles.inputIcon}>{icon}</View>}
        <Text style={[styles.textInput, !value && styles.placeholderText]}>
          {selectedOption ? selectedOption.label : 'Select...'}
        </Text>
        <ChevronRight size={18} color={Colors.mutedGray} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </TouchableOpacity>
      {open && (
        <View style={styles.selectDropdown}>
          <ScrollView style={styles.selectList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={styles.selectItem}
                onPress={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <Text style={styles.selectItemText}>{opt.label}</Text>
                {opt.value === value && <CheckCircle size={16} color={Colors.officialGold} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {error ? (
        <View style={styles.errorRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function EnterpriseRegisterScreen() {
  const router = useRouter();
  const [state, setState] = useState<EnterpriseRegistrationState>(createInitialState);
  const [showPassword, setShowPassword] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const isSubmittingRef = useRef(false);

  // Load draft on mount
  useEffect(() => {
    (async () => {
      const draft = await loadDraft(secureDraftAdapter);
      if (draft) {
        const restoredValues = draftToFormValues(draft);
        setState(prev => ({
          ...prev,
          formValues: { ...prev.formValues, ...restoredValues },
          currentStep: draft.currentStep === 'confirmation' ? 'account' : draft.currentStep,
          idempotencyKey: draft.idempotencyKey || prev.idempotencyKey,
          draftUpdatedAt: draft.draftUpdatedAt}));
      }
      setDraftLoaded(true);
    })();
  }, []);

  // Save draft on form values change (debounced via ref flag)
  useEffect(() => {
    if (!draftLoaded) return;
    if (state.currentStep === 'confirmation') return;
    const timer = setTimeout(() => {
      saveDraft(secureDraftAdapter, state.formValues, state.currentStep, state.idempotencyKey);
    }, 500);
    return () => clearTimeout(timer);
  }, [state.formValues, state.currentStep, draftLoaded]);

  const updateForm = useCallback((field: keyof EnterpriseRegistrationFormValues, value: string | boolean) => {
    setState(prev => ({
      ...prev,
      formValues: { ...prev.formValues, [field]: value },
      validationErrors: { ...prev.validationErrors, [field]: undefined },
      serverError: '',
      serverErrorCode: ''}));
  }, []);

  const currentStepIndex = VISIBLE_STEPS.indexOf(state.currentStep as typeof VISIBLE_STEPS[number]);

  const goNext = useCallback(() => {
    const errors = validateStep(state.currentStep as Step, state.formValues);
    if (Object.keys(errors).length > 0) {
      setState(prev => ({ ...prev, validationErrors: errors }));
      return;
    }
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < VISIBLE_STEPS.length) {
      setState(prev => ({ ...prev, currentStep: VISIBLE_STEPS[nextIndex], validationErrors: {} }));
    }
  }, [state.currentStep, state.formValues, currentStepIndex]);

  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setState(prev => ({ ...prev, currentStep: VISIBLE_STEPS[currentStepIndex - 1], validationErrors: {} }));
    } else {
      router.back();
    }
  }, [currentStepIndex, router]);

  const goToReview = useCallback(() => {
    const errors = validateStep('enterprise', state.formValues);
    if (Object.keys(errors).length > 0) {
      setState(prev => ({ ...prev, validationErrors: errors }));
      return;
    }
    setState(prev => ({ ...prev, currentStep: 'review', validationErrors: {} }));
  }, [state.formValues]);

  const handleSubmit = useCallback(async () => {
    // Double-submit protection
    if (isSubmittingRef.current) return;
    if (state.submissionStatus === 'submitting') return;

    isSubmittingRef.current = true;
    setState(prev => ({ ...prev, submissionStatus: 'submitting', serverError: '', serverErrorCode: '' }));

    try {
      const result = await executeFullEnterpriseRegistration({
        formValues: state.formValues,
        idempotencyKey: state.idempotencyKey});

      if (result.ok && result.enterpriseId) {
        // Clear draft on success
        await clearDraft(secureDraftAdapter);
        setState(prev => ({
          ...prev,
          submissionStatus: 'success',
          currentStep: 'confirmation',
          enterpriseId: result.enterpriseId || '',
          authUserId: result.authUserId || '',
          traceId: result.traceId || ''}));
      } else {
        // Preserve user-entered values on failure
        setState(prev => ({
          ...prev,
          submissionStatus: 'error',
          serverError: result.error || 'Registration failed. Please try again.',
          serverErrorCode: result.errorCode || 'UNKNOWN_ERROR'}));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error. Please check your connection and try again.';
      setState(prev => ({
        ...prev,
        submissionStatus: 'error',
        serverError: getUserFriendlyError('', message),
        serverErrorCode: 'NETWORK_ERROR'}));
    } finally {
      isSubmittingRef.current = false;
    }
  }, [state.formValues, state.idempotencyKey, state.submissionStatus]);

  const v = state.formValues;
  const errors = state.validationErrors;

  // ── STEP 1: Account ──────────────────────────────────────────────────
  const renderStep1 = () => (
    <View>
      <Text style={styles.stepTitle}>Create Your Account</Text>
      <Text style={styles.stepSubtitle}>
        Step 1 of 3 — Enter your personal details to create your IVX account.
      </Text>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FormField
            label="First Name"
            value={v.firstName}
            onChangeText={(text) => updateForm('firstName', text)}
            placeholder="John"
            error={errors.firstName as string}
            icon={<User size={20} color={Colors.mutedGray} />}
            autoCapitalize="words"
            accessibilityLabel="First name input"
          />
        </View>
        <View style={styles.fieldHalf}>
          <FormField
            label="Last Name"
            value={v.lastName}
            onChangeText={(text) => updateForm('lastName', text)}
            placeholder="Smith"
            error={errors.lastName as string}
            icon={<User size={20} color={Colors.mutedGray} />}
            autoCapitalize="words"
            accessibilityLabel="Last name input"
          />
        </View>
      </View>

      <FormField
        label="Email"
        value={v.email}
        onChangeText={(text) => updateForm('email', text)}
        placeholder="john@company.com"
        error={errors.email as string}
        icon={<Mail size={20} color={Colors.mutedGray} />}
        keyboardType="email-address"
        autoCapitalize="none"
        accessibilityLabel="Email input"
      />

      <FormField
        label="Phone"
        value={v.phone}
        onChangeText={(text) => updateForm('phone', text)}
        placeholder="+1 555 123 4567"
        error={errors.phone as string}
        icon={<Phone size={20} color={Colors.mutedGray} />}
        keyboardType="phone-pad"
        autoCapitalize="none"
        accessibilityLabel="Phone number input"
      />

      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>Password</Text>
        <View style={[styles.inputWrapper, errors.password && styles.inputWrapperError]}>
          <View style={styles.inputIcon}><Lock size={20} color={Colors.mutedGray} /></View>
          <TextInput
            style={styles.textInput}
            value={v.password}
            onChangeText={(text) => updateForm('password', text)}
            placeholder="Minimum 12 characters, 1 uppercase, 1 number"
            placeholderTextColor={Colors.inputPlaceholder}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            accessibilityLabel="Password input"
            accessibilityHint="Minimum 12 characters with at least 1 uppercase letter and 1 number"
          />
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
            style={styles.passwordToggle}
          >
            {showPassword ? <EyeOff size={20} color={Colors.mutedGray} /> : <Eye size={20} color={Colors.mutedGray} />}
          </TouchableOpacity>
        </View>
        {errors.password ? (
          <View style={styles.errorRow}>
            <AlertCircle size={14} color={Colors.error} />
            <Text style={styles.errorText}>{errors.password}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FormField
            label="Date of Birth (MM/DD/YYYY)"
            value={v.dateOfBirth}
            onChangeText={(text) => updateForm('dateOfBirth', text)}
            placeholder="01/15/1990"
            error={errors.dateOfBirth as string}
            icon={<Calendar size={20} color={Colors.mutedGray} />}
            keyboardType="numeric"
            accessibilityLabel="Date of birth input"
          />
        </View>
        <View style={styles.fieldHalf}>
          <SelectField
            label="Gender"
            value={v.gender}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'prefer_not_to_say', label: 'Prefer not to say' },
            ]}
            onSelect={(val) => updateForm('gender', val)}
            error={errors.gender as string}
            accessibilityLabel="Gender selector"
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <CountryPicker
            label="Country"
            value={v.country}
            onSelect={(country) => {
              updateForm('country', country.name);
              updateForm('countryCode', country.code);
              updateForm('dialCode', country.dialCode);
            }}
            error={undefined}
          />
        </View>
        <View style={styles.fieldHalf}>
          <FormField
            label="ZIP / Postal Code"
            value={v.zipCode}
            onChangeText={(text) => updateForm('zipCode', text)}
            placeholder="10001"
            error={errors.zipCode as string}
            icon={<MapPin size={20} color={Colors.mutedGray} />}
            keyboardType="default"
            autoCapitalize="none"
            accessibilityLabel="ZIP postal code input"
          />
        </View>
      </View>

      <View style={styles.consentContainer}>
        <View style={styles.consentRow}>
          <Switch
            value={v.acceptTerms}
            onValueChange={(val) => updateForm('acceptTerms', val)}
            accessibilityLabel="Accept Terms of Service"
            trackColor={{ false: Colors.surfaceBorder, true: Colors.officialGold }}
          />
          <Text style={styles.consentText}>
            I accept the <Text style={styles.consentLink}>Terms of Service</Text>
          </Text>
        </View>
        {errors.acceptTerms ? (
          <Text style={styles.errorText}>{errors.acceptTerms}</Text>
        ) : null}

        <View style={styles.consentRow}>
          <Switch
            value={v.acceptPrivacy}
            onValueChange={(val) => updateForm('acceptPrivacy', val)}
            accessibilityLabel="Accept Privacy Policy"
            trackColor={{ false: Colors.surfaceBorder, true: Colors.officialGold }}
          />
          <Text style={styles.consentText}>
            I accept the <Text style={styles.consentLink}>Privacy Policy</Text>
          </Text>
        </View>
        {errors.acceptPrivacy ? (
          <Text style={styles.errorText}>{errors.acceptPrivacy}</Text>
        ) : null}
      </View>
    </View>
  );

  // ── STEP 2: Role ─────────────────────────────────────────────────────
  const renderStep2 = () => (
    <View>
      <Text style={styles.stepTitle}>Select Your Primary Role</Text>
      <Text style={styles.stepSubtitle}>
        Step 2 of 3 — Choose how your enterprise will participate on IVX Holdings.
      </Text>

      <View style={styles.roleGrid}>
        {ROLE_OPTIONS.map(role => (
          <RoleCard
            key={role.id}
            role={role}
            selected={v.primaryRole === role.id}
            onSelect={() => updateForm('primaryRole', role.id)}
          />
        ))}
      </View>

      {errors.primaryRole ? (
        <View style={styles.errorRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.errorText}>{errors.primaryRole}</Text>
        </View>
      ) : null}

      <View style={styles.roleInfoBox}>
        <Shield size={20} color={Colors.officialGold} />
        <Text style={styles.roleInfoText}>
          Enterprise registration creates a company entity with you as the owner.
          KYC and AML verification will be required after registration.
        </Text>
      </View>
    </View>
  );

  // ── STEP 3: Enterprise Details ───────────────────────────────────────
  const renderStep3 = () => (
    <View>
      <Text style={styles.stepTitle}>Enterprise Details</Text>
      <Text style={styles.stepSubtitle}>
        Step 3 of 3 — Enter your company information.
      </Text>

      <FormField
        label="Legal Company Name"
        value={v.legalName}
        onChangeText={(text) => updateForm('legalName', text)}
        placeholder="Acme Holdings LLC"
        error={errors.legalName as string}
        icon={<Building2 size={20} color={Colors.mutedGray} />}
        accessibilityLabel="Legal company name input"
      />

      <FormField
        label="Display Company Name"
        value={v.displayName}
        onChangeText={(text) => updateForm('displayName', text)}
        placeholder="Acme Holdings"
        error={errors.displayName as string}
        icon={<Building2 size={20} color={Colors.mutedGray} />}
        accessibilityLabel="Display company name input"
      />

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SelectField
            label="Company Type"
            value={v.companyType}
            options={COMPANY_TYPES.map(t => ({ value: t, label: COMPANY_TYPE_LABELS[t] }))}
            onSelect={(val) => updateForm('companyType', val as CompanyType)}
            error={errors.companyType as string}
            icon={<Briefcase size={20} color={Colors.mutedGray} />}
            accessibilityLabel="Company type selector"
          />
        </View>
        <View style={styles.fieldHalf}>
          <SelectField
            label="Industry"
            value={v.industry}
            options={INDUSTRIES.map(i => ({ value: i, label: i }))}
            onSelect={(val) => updateForm('industry', val)}
            error={errors.industry as string}
            accessibilityLabel="Industry selector"
          />
        </View>
      </View>

      <FormField
        label="Website (optional)"
        value={v.website}
        onChangeText={(text) => updateForm('website', text)}
        placeholder="https://acme.com"
        error={errors.website as string}
        icon={<Globe size={20} color={Colors.mutedGray} />}
        keyboardType="default"
        autoCapitalize="none"
        accessibilityLabel="Website input"
      />

      <FormField
        label="Business Address"
        value={v.address}
        onChangeText={(text) => updateForm('address', text)}
        placeholder="123 Main Street"
        error={errors.address as string}
        icon={<MapPin size={20} color={Colors.mutedGray} />}
        accessibilityLabel="Business address input"
      />

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FormField
            label="City"
            value={v.city}
            onChangeText={(text) => updateForm('city', text)}
            placeholder="New York"
            error={errors.city as string}
            accessibilityLabel="City input"
          />
        </View>
        <View style={styles.fieldHalf}>
          <FormField
            label="State / Province"
            value={v.state}
            onChangeText={(text) => updateForm('state', text)}
            placeholder="NY"
            error={errors.state as string}
            accessibilityLabel="State province input"
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FormField
            label="ZIP / Postal Code"
            value={v.postalCode}
            onChangeText={(text) => updateForm('postalCode', text)}
            placeholder="10001"
            error={errors.postalCode as string}
            icon={<MapPin size={20} color={Colors.mutedGray} />}
            autoCapitalize="none"
            accessibilityLabel="Enterprise ZIP postal code input"
          />
        </View>
        <View style={styles.fieldHalf}>
          <FormField
            label="Team Size"
            value={v.teamSize}
            onChangeText={(text) => updateForm('teamSize', text)}
            placeholder="10"
            error={errors.teamSize as string}
            icon={<Users size={20} color={Colors.mutedGray} />}
            keyboardType="numeric"
            accessibilityLabel="Team size input"
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FormField
            label="Authorized Representative"
            value={v.authorizedRepresentative}
            onChangeText={(text) => updateForm('authorizedRepresentative', text)}
            placeholder="John Smith"
            error={errors.authorizedRepresentative as string}
            icon={<User size={20} color={Colors.mutedGray} />}
            autoCapitalize="words"
            accessibilityLabel="Authorized representative input"
          />
        </View>
        <View style={styles.fieldHalf}>
          <FormField
            label="Representative Title"
            value={v.representativeTitle}
            onChangeText={(text) => updateForm('representativeTitle', text)}
            placeholder="CEO"
            error={errors.representativeTitle as string}
            autoCapitalize="words"
            accessibilityLabel="Representative title input"
          />
        </View>
      </View>

      <SelectField
        label="Business Category"
        value={v.businessCategory}
        options={BUSINESS_CATEGORIES.map(c => ({ value: c, label: c }))}
        onSelect={(val) => updateForm('businessCategory', val)}
        error={errors.businessCategory as string}
        icon={<Briefcase size={20} color={Colors.mutedGray} />}
        accessibilityLabel="Business category selector"
      />

      <View style={styles.documentInfoBox}>
        <FileText size={18} color={Colors.mutedGray} />
        <Text style={styles.documentInfoText}>
          Supporting documents (optional) can be uploaded after registration in your enterprise dashboard.
        </Text>
      </View>
    </View>
  );

  // ── REVIEW ───────────────────────────────────────────────────────────
  const renderReview = () => {
    const selectedRole = ROLE_OPTIONS.find(r => r.id === v.primaryRole);
    const ReviewRow = ({ label, val }: { label: string; val: string }) => (
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{val || '—'}</Text>
      </View>
    );

    return (
      <View>
        <Text style={styles.stepTitle}>Review Your Registration</Text>
        <Text style={styles.stepSubtitle}>
          Please verify all information before submitting.
        </Text>

        <View style={styles.reviewSection}>
          <Text style={styles.reviewSectionTitle}>Account</Text>
          <ReviewRow label="Name" val={`${v.firstName} ${v.lastName}`} />
          <ReviewRow label="Email" val={v.email} />
          <ReviewRow label="Phone" val={v.phone} />
          <ReviewRow label="Country" val={v.country} />
        </View>

        <View style={styles.reviewSection}>
          <Text style={styles.reviewSectionTitle}>Role</Text>
          <ReviewRow label="Primary Role" val={selectedRole?.label || v.primaryRole} />
        </View>

        <View style={styles.reviewSection}>
          <Text style={styles.reviewSectionTitle}>Enterprise</Text>
          <ReviewRow label="Legal Name" val={v.legalName} />
          <ReviewRow label="Display Name" val={v.displayName} />
          <ReviewRow label="Company Type" val={v.companyType ? COMPANY_TYPE_LABELS[v.companyType as CompanyType] : ''} />
          <ReviewRow label="Industry" val={v.industry} />
          <ReviewRow label="Website" val={v.website} />
          <ReviewRow label="Address" val={`${v.address}, ${v.city}, ${v.state} ${v.postalCode}`} />
          <ReviewRow label="Representative" val={`${v.authorizedRepresentative} (${v.representativeTitle})`} />
          <ReviewRow label="Team Size" val={v.teamSize} />
          <ReviewRow label="Business Category" val={v.businessCategory} />
        </View>

        {state.serverError ? (
          <View style={styles.serverErrorBox}>
            <AlertCircle size={20} color={Colors.error} />
            <Text style={styles.serverErrorText}>{state.serverError}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  // ── CONFIRMATION ─────────────────────────────────────────────────────
  const renderConfirmation = () => (
    <View style={styles.confirmationContainer}>
      <View style={styles.confirmationIconWrapper}>
        <CheckCircle size={64} color={Colors.success} />
      </View>
      <Text style={styles.confirmationTitle}>Registration Received</Text>
      <Text style={styles.confirmationSubtitle}>
        Your enterprise registration has been submitted successfully.
      </Text>

      <View style={styles.confirmationCard}>
        <Text style={styles.confirmationCardTitle}>Enterprise Details</Text>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Enterprise Name</Text>
          <Text style={styles.confirmationValue}>{v.legalName}</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Member Name</Text>
          <Text style={styles.confirmationValue}>{v.firstName} {v.lastName}</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Registration Status</Text>
          <Text style={styles.confirmationValue}>Pending Verification</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Email Verification</Text>
          <Text style={styles.confirmationValue}>Not Verified</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Phone Verification</Text>
          <Text style={styles.confirmationValue}>Not Verified</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Enterprise Review</Text>
          <Text style={styles.confirmationValue}>Not Started</Text>
        </View>
        <View style={styles.confirmationDivider} />
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Enterprise ID</Text>
          <Text style={styles.confirmationMono}>{state.enterpriseId}</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Auth User ID</Text>
          <Text style={styles.confirmationMono}>{state.authUserId}</Text>
        </View>
        <View style={styles.confirmationRow}>
          <Text style={styles.confirmationLabel}>Trace ID</Text>
          <Text style={styles.confirmationMono}>{state.traceId}</Text>
        </View>
      </View>

      <View style={styles.nextStepsBox}>
        <Text style={styles.nextStepsTitle}>Next Steps</Text>
        <Text style={styles.nextStepsText}>
          1. Verify your email address{'\n'}
          2. Verify your phone number{'\n'}
          3. Complete KYC and AML verification{'\n'}
          4. Await enterprise review by IVX Holdings
        </Text>
      </View>

      <TouchableOpacity
        style={styles.doneButton}
        onPress={() => router.replace('/login' as Href)}
        accessibilityLabel="Continue to login"
        accessibilityRole="button"
      >
        <Text style={styles.doneButtonText}>Continue to Login</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Render current step ──────────────────────────────────────────────
  const renderCurrentStep = () => {
    switch (state.currentStep) {
      case 'account': return renderStep1();
      case 'role': return renderStep2();
      case 'enterprise': return renderStep3();
      case 'review': return renderReview();
      case 'confirmation': return renderConfirmation();
      default: return renderStep1();
    }
  };

  const isConfirmation = state.currentStep === 'confirmation';
  const isReview = state.currentStep === 'review';
  const isLoading = state.submissionStatus === 'submitting';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goBack}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            style={styles.backButton}
          >
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Enterprise Registration</Text>
          <View style={styles.headerSpacer} />
        </View>

        {!isConfirmation && <ProgressBar currentStepIndex={isReview ? VISIBLE_STEPS.length : currentStepIndex} />}

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderCurrentStep()}
        </ScrollView>

        {/* Footer buttons */}
        {!isConfirmation && (
          <View style={styles.footer}>
            {state.serverError && !isReview ? (
              <View style={styles.serverErrorBox}>
                <AlertCircle size={20} color={Colors.error} />
                <Text style={styles.serverErrorText}>{state.serverError}</Text>
              </View>
            ) : null}

            <View style={styles.footerButtons}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={goBack}
                accessibilityLabel="Back button"
                accessibilityRole="button"
              >
                <Text style={styles.backBtnText}>{currentStepIndex === 0 ? 'Cancel' : 'Back'}</Text>
              </TouchableOpacity>

              {isReview ? (
                <TouchableOpacity
                  style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={isLoading}
                  accessibilityLabel="Submit enterprise registration"
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ShimmerIndicator size="small" color={Colors.primaryBlack} />
                  ) : (
                    <Text style={styles.submitBtnText}>Submit Registration</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.nextBtn}
                  onPress={isReview ? handleSubmit : (state.currentStep === 'enterprise' ? goToReview : goNext)}
                  accessibilityLabel="Continue to next step"
                  accessibilityRole="button"
                >
                  <Text style={styles.nextBtnText}>
                    {state.currentStep === 'enterprise' ? 'Review' : 'Continue'}
                  </Text>
                  <ArrowRight size={20} color={Colors.primaryBlack} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backButton: {
    padding: 8,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  headerSpacer: {
    width: 40},
  // Progress
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16},
  progressStep: {
    alignItems: 'center',
    width: 70},
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4},
  progressCircleComplete: {
    backgroundColor: Colors.officialGold,
    borderColor: Colors.officialGold},
  progressCircleCurrent: {
    borderColor: Colors.officialGold},
  progressNumber: {
    fontSize: 14,
    fontWeight: '700' as const},
  progressNumberCurrent: {
    color: Colors.officialGold},
  progressNumberPending: {
    color: Colors.mutedGray},
  progressLabel: {
    fontSize: 11,
    fontWeight: '600' as const},
  progressLabelCurrent: {
    color: Colors.text},
  progressLabelPending: {
    color: Colors.mutedGray},
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.surfaceBorder,
    marginBottom: 20},
  progressLineComplete: {
    backgroundColor: Colors.officialGold},
  // ScrollView
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 120},
  // Step
  stepTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  stepSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24},
  // Fields
  fieldContainer: {
    marginBottom: 16},
  fieldRow: {
    flexDirection: 'row',
    gap: 12},
  fieldHalf: {
    flex: 1},
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6},
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 50},
  inputWrapperError: {
    borderColor: Colors.error},
  inputIcon: {
    marginRight: 10},
  textInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    paddingVertical: 14},
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top'},
  placeholderText: {
    color: Colors.inputPlaceholder},
  passwordToggle: {
    padding: 8},
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6},
  errorText: {
    fontSize: 13,
    color: Colors.error,
    flex: 1},
  // Consent
  consentContainer: {
    marginTop: 16,
    gap: 12},
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  consentText: {
    fontSize: 14,
    color: Colors.text,
    flex: 1},
  consentLink: {
    color: Colors.officialGold,
    fontWeight: '600' as const},
  // Country picker
  countryDropdown: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 10,
    marginTop: 4,
    maxHeight: 250,
    zIndex: 100},
  countrySearch: {
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  countryList: {
    maxHeight: 200},
  countryItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  countryItemText: {
    fontSize: 14,
    color: Colors.text},
  // Role
  roleGrid: {
    gap: 12},
  roleCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    borderRadius: 12,
    padding: 16},
  roleCardSelected: {
    borderColor: Colors.officialGold,
    backgroundColor: 'rgba(230,194,0,0.08)'},
  roleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6},
  roleCardRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    justifyContent: 'center',
    alignItems: 'center'},
  roleCardRadioSelected: {
    borderColor: Colors.officialGold,
    backgroundColor: Colors.officialGold},
  roleCardLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  roleCardLabelSelected: {
    color: Colors.officialGold},
  roleCardDescription: {
    fontSize: 13,
    color: Colors.textSecondary},
  roleInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(230,194,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(230,194,0,0.2)',
    borderRadius: 10,
    padding: 14,
    marginTop: 16},
  roleInfoText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1},
  // Select
  selectDropdown: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 10,
    marginTop: 4,
    maxHeight: 200,
    zIndex: 100},
  selectList: {
    maxHeight: 200},
  selectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  selectItemText: {
    fontSize: 14,
    color: Colors.text},
  // Document info
  documentInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 10,
    padding: 14,
    marginTop: 8},
  documentInfoText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1},
  // Review
  reviewSection: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16},
  reviewSectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.officialGold,
    marginBottom: 12,
    textTransform: 'uppercase' as const},
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  reviewLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    flex: 1},
  reviewValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600' as const,
    flex: 1,
    textAlign: 'right' as const},
  // Server error
  serverErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.2)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12},
  serverErrorText: {
    fontSize: 14,
    color: Colors.error,
    flex: 1},
  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  footerButtons: {
    flexDirection: 'row',
    gap: 12},
  backBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center'},
  backBtnText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text},
  nextBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.officialGold,
    minHeight: 48},
  nextBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primaryBlack},
  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.officialGold,
    minHeight: 48},
  submitBtnDisabled: {
    opacity: 0.6},
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primaryBlack},
  // Confirmation
  confirmationContainer: {
    alignItems: 'center',
    paddingTop: 20},
  confirmationIconWrapper: {
    marginBottom: 16},
  confirmationTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: 8},
  confirmationSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 24},
  confirmationCard: {
    width: '100%' as const,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16},
  confirmationCardTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.officialGold,
    marginBottom: 16,
    textTransform: 'uppercase' as const},
  confirmationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8},
  confirmationLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1},
  confirmationValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const,
    flex: 1,
    textAlign: 'right' as const},
  confirmationMono: {
    fontSize: 11,
    color: Colors.officialGold,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
    textAlign: 'right' as const},
  confirmationDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 12},
  nextStepsBox: {
    width: '100%' as const,
    backgroundColor: 'rgba(230,194,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(230,194,0,0.2)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 24},
  nextStepsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.officialGold,
    marginBottom: 8},
  nextStepsText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20},
  doneButton: {
    width: '100%' as const,
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: Colors.officialGold,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center'},
  doneButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primaryBlack}});
