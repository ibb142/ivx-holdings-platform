import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Image as RNImage,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Mail,
  Lock,
  User,
  Phone,
  Globe,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Search,
  Shield,
  Calendar,
  MapPin,
  TrendingUp,
  Camera,
  Image as ImageIcon,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { COUNTRIES, Country } from '@/constants/countries';
import { validateEmail, validatePassword, validatePhone, formatBirthdayInput, parseBirthday } from '@/lib/auth-helpers';
import { supabase } from '@/lib/supabase';
import * as MemberService from '@/lib/member-service';

const STEPS = ['Register', 'Verify', 'Dashboard'] as const;
type Step = (typeof STEPS)[number];

const MARKET_INTEREST_OPTIONS: { id: MemberService.MemberRoleInterest; label: string }[] = [
  { id: 'investor', label: 'Investor' },
  { id: 'buyer', label: 'Buyer' },
  { id: 'jv_deals', label: 'JV Deals' },
  { id: 'tokenized', label: 'Tokenized' },
];

export default function MemberRegisterScreen() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('Register');
  const [isLoading, setIsLoading] = useState(false);
  const [userId, setUserId] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    country: 'United States',
    countryCode: 'US',
    dialCode: '+1',
    zipCode: '',
    acceptTerms: false,
  });
  const [selectedInterest, setSelectedInterest] = useState<MemberService.MemberRoleInterest | null>(null);
  const [pictureUri, setPictureUri] = useState<string | null>(null);
  const [pictureUploading, setPictureUploading] = useState(false);
  const [uploadedPictureUrl, setUploadedPictureUrl] = useState<string | null>(null);

  const selectInterest = (role: MemberService.MemberRoleInterest) => {
    setSelectedInterest((prev) => (prev === role ? null : role));
  };

  const pickMemberPicture = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please allow photo library access to upload a profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const uri = result.assets[0].uri;
      setPictureUri(uri);
      await uploadMemberPicture(uri);
    } catch (err) {
      const message = (err as Error)?.message || 'Failed to pick picture';
      Alert.alert('Picture Error', message);
    }
  };

  const uploadMemberPicture = async (uri: string): Promise<void> => {
    setPictureUploading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
      if (!supabaseUrl || !anonKey) {
        throw new Error('Supabase storage is not configured.');
      }
      const bucket = 'member-pictures';
      const lower = uri.toLowerCase();
      const ext = lower.includes('.png') ? 'png' : 'webp';
      const fileName = `member_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `${fileName}`;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${filePath}`;
      const headers: Record<string, string> = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
      let uploadResult: { success: boolean; error?: string };
      if (Platform.OS === 'web') {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        headers['Content-Type'] = blob.type || 'image/jpeg';
        const response = await fetch(uploadUrl, { method: 'POST', headers, body: blob });
        uploadResult = response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
      } else {
        const localUri = await ensureLocalFile(uri);
        headers['Content-Type'] = 'image/jpeg';
        const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'image/jpeg',
          headers,
        });
        uploadResult = result.status >= 200 && result.status < 300 ? { success: true } : { success: false, error: `HTTP ${result.status}` };
      }
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Upload failed');
      }
      const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
      const publicUrl = publicUrlData?.publicUrl || `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
      setUploadedPictureUrl(publicUrl);
      console.log('[MemberRegister] Picture uploaded:', publicUrl);
    } catch (err) {
      const message = (err as Error)?.message || 'Picture upload failed';
      console.log('[MemberRegister] Picture upload failed:', message);
      setPictureUri(null);
      setUploadedPictureUrl(null);
      Alert.alert('Picture Upload Failed', 'Could not upload the picture. You can try again or skip — picture is optional.');
    } finally {
      setPictureUploading(false);
    }
  };

  const ensureLocalFile = async (uri: string): Promise<string> => {
    if (uri.startsWith('file://')) return uri;
    if (uri.startsWith('data:image/')) {
      const match = uri.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const tempPath = `${FileSystem.cacheDirectory}member_pic_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(tempPath, match[2] || '', { encoding: FileSystem.EncodingType.Base64 });
        return tempPath;
      }
    }
    if (uri.startsWith('content://') || uri.startsWith('ph://')) {
      const tempPath = `${FileSystem.cacheDirectory}member_pic_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: tempPath });
      return tempPath;
    }
    return uri;
  };

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');

  const filteredCountries = COUNTRIES.filter((c) =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const updateForm = (key: keyof typeof formData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const selectCountry = (country: Country) => {
    setFormData((prev) => ({
      ...prev,
      country: country.name,
      countryCode: country.code,
      dialCode: country.dialCode,
    }));
    setShowCountryPicker(false);
    setCountrySearch('');
  };

  const handleRegister = async () => {
    const normalizedEmail = formData.email.trim().toLowerCase();

    if (!formData.firstName || !formData.lastName) {
      Alert.alert('Missing Information', 'Please enter your first and last name.');
      return;
    }
    const dobResult = parseBirthday(formData.dateOfBirth);
    if (dobResult.error || !dobResult.iso) {
      Alert.alert('Date of Birth Required', dobResult.error || 'Please enter your date of birth.');
      return;
    }
    if (!formData.gender) {
      Alert.alert('Gender Required', 'Please select your gender.');
      return;
    }
    if (!validateEmail(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    const pwResult = validatePassword(formData.password);
    if (!pwResult.valid) {
      Alert.alert('Weak Password', pwResult.reason || 'Password does not meet requirements.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (!validatePhone(formData.phone)) {
      Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
      return;
    }
    if (!formData.zipCode.trim()) {
      Alert.alert('Zip Code Required', 'Please enter your zip/postal code.');
      return;
    }
    if (!selectedInterest) {
      Alert.alert('Market Interest Required', 'Please select one market interest.');
      return;
    }
    if (!formData.acceptTerms) {
      Alert.alert('Terms Required', 'Please accept the Terms of Service.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await MemberService.registerMember({
        email: normalizedEmail,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: dobResult.iso,
        gender: formData.gender,
        phone: formData.phone,
        country: formData.country,
        zipCode: formData.zipCode,
        roles: selectedInterest ? [selectedInterest] : [],
        acceptTerms: formData.acceptTerms,
        pictureUrl: uploadedPictureUrl ?? undefined,
      });

      if (result.success && result.userId) {
        // Email is auto-confirmed server-side — skip Verify step, go to Dashboard
        setUserId(result.userId);
        setStep('Dashboard');
      } else {
        Alert.alert('Registration Failed', result.message || 'Could not create account. Please try again.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerificationComplete = useCallback(() => {
    setStep('Dashboard');
  }, []);

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {STEPS.map((label, idx) => {
        const stepIdx = STEPS.indexOf(step);
        const isActive = idx === stepIdx;
        const isDone = idx < stepIdx;
        return (
          <React.Fragment key={label}>
            {idx > 0 && (
              <View style={[styles.stepLine, isDone && styles.stepLineDone]} />
            )}
            <View style={styles.stepDotContainer}>
              <View
                style={[
                  styles.stepDot,
                  isActive && styles.stepDotActive,
                  isDone && styles.stepDotDone,
                ]}
              >
                {isDone ? (
                  <Check size={12} color="#000000" />
                ) : (
                  <Text
                    style={[
                      styles.stepDotText,
                      (isActive || isDone) && styles.stepDotTextActive,
                    ]}
                  >
                    {idx + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  isActive && styles.stepLabelActive,
                  isDone && styles.stepLabelDone,
                ]}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );

  const renderRegisterForm = () => (
    <ScrollView
      style={styles.scrollView}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerSection}>
        <Text style={styles.title}>Create Your Free Account</Text>
        <Text style={styles.subtitle}>
          Join IVX Holding and access premium real estate investment opportunities.
        </Text>
      </View>

      {/* Name Row */}
      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={styles.label}>First Name *</Text>
          <View style={styles.inputContainer}>
            <User size={18} color={Colors.muted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor={Colors.muted}
              value={formData.firstName}
              onChangeText={(v) => updateForm('firstName', v)}
              autoCapitalize="words"
            />
          </View>
        </View>
        <View style={styles.halfField}>
          <Text style={styles.label}>Last Name *</Text>
          <View style={styles.inputContainer}>
            <User size={18} color={Colors.muted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor={Colors.muted}
              value={formData.lastName}
              onChangeText={(v) => updateForm('lastName', v)}
              autoCapitalize="words"
            />
          </View>
        </View>
      </View>

      {/* Date of Birth */}
      <Text style={styles.label}>Date of Birth *</Text>
      <View style={styles.inputContainer}>
        <Calendar size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="MM/DD/YYYY"
          placeholderTextColor={Colors.muted}
          value={formData.dateOfBirth}
          onChangeText={(v) => updateForm('dateOfBirth', formatBirthdayInput(v))}
          keyboardType="number-pad"
          maxLength={10}
        />
      </View>

      {/* Gender */}
      <Text style={styles.label}>Gender *</Text>
      <View style={styles.genderRow}>
        {[
          { id: 'male', label: 'Male' },
          { id: 'female', label: 'Female' },
          { id: 'prefer_not_to_say', label: 'Prefer not to say' },
        ].map((option) => (
          <TouchableOpacity
            key={option.id}
            style={[styles.genderChip, formData.gender === option.id && styles.genderChipActive]}
            onPress={() => updateForm('gender', option.id)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.genderChipText,
                formData.gender === option.id && styles.genderChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Email */}
      <Text style={styles.label}>Email *</Text>
      <View style={styles.inputContainer}>
        <Mail size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="you@email.com"
          placeholderTextColor={Colors.muted}
          value={formData.email}
          onChangeText={(v) => updateForm('email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Password */}
      <Text style={styles.label}>Password</Text>
      <View style={styles.inputContainer}>
        <Lock size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Min 8 chars, 1 uppercase, 1 number"
          placeholderTextColor={Colors.muted}
          value={formData.password}
          onChangeText={(v) => updateForm('password', v)}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity
          onPress={() => setShowPassword(!showPassword)}
          style={styles.eyeButton}
        >
          {showPassword ? (
            <EyeOff size={18} color={Colors.muted} />
          ) : (
            <Eye size={18} color={Colors.muted} />
          )}
        </TouchableOpacity>
      </View>

      {/* Confirm Password */}
      <Text style={styles.label}>Confirm Password</Text>
      <View style={styles.inputContainer}>
        <Lock size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Re-enter password"
          placeholderTextColor={Colors.muted}
          value={formData.confirmPassword}
          onChangeText={(v) => updateForm('confirmPassword', v)}
          secureTextEntry={!showConfirmPassword}
        />
        <TouchableOpacity
          onPress={() => setShowConfirmPassword(!showConfirmPassword)}
          style={styles.eyeButton}
        >
          {showConfirmPassword ? (
            <EyeOff size={18} color={Colors.muted} />
          ) : (
            <Eye size={18} color={Colors.muted} />
          )}
        </TouchableOpacity>
      </View>

      {/* Phone */}
      <Text style={styles.label}>Mobile Phone *</Text>
      <View style={styles.inputContainer}>
        <Phone size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder={formData.dialCode + ' 123 456 7890'}
          placeholderTextColor={Colors.muted}
          value={formData.phone}
          onChangeText={(v) => updateForm('phone', v)}
          keyboardType="phone-pad"
        />
      </View>

      {/* Country */}
      <Text style={styles.label}>Country</Text>
      <TouchableOpacity
        style={styles.inputContainer}
        onPress={() => setShowCountryPicker(true)}
      >
        <Globe size={18} color={Colors.muted} style={styles.inputIcon} />
        <Text style={[styles.input, styles.countryText, !formData.country && styles.placeholderText]}>
          {formData.country || 'Select country'}
        </Text>
        <ChevronDown size={18} color={Colors.muted} />
      </TouchableOpacity>

      {/* Zip Code */}
      <Text style={styles.label}>Zip Code *</Text>
      <View style={styles.inputContainer}>
        <MapPin size={18} color={Colors.muted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="e.g. 33131"
          placeholderTextColor={Colors.muted}
          value={formData.zipCode}
          onChangeText={(v) => updateForm('zipCode', v.replace(/[^0-9-]/g, ''))}
          keyboardType="number-pad"
          maxLength={10}
        />
      </View>

      {/* Member Picture (optional) */}
      <Text style={styles.label}>Member Picture (optional)</Text>
      <View style={styles.pictureRow}>
        <View style={styles.picturePreview}>
          {pictureUri ? (
            <RNImage source={{ uri: pictureUri }} style={styles.pictureImage} />
          ) : (
            <User size={28} color={Colors.muted} />
          )}
          {pictureUploading && (
            <View style={styles.pictureLoadingOverlay}>
              <ActivityIndicator size="small" color={Colors.gold} />
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.pictureButton}
          onPress={pickMemberPicture}
          disabled={pictureUploading}
          testID="pick-member-picture"
        >
          <Camera size={16} color={Colors.gold} />
          <Text style={styles.pictureButtonText}>
            {pictureUri ? 'Change Picture' : 'Upload Picture'}
          </Text>
        </TouchableOpacity>
        {pictureUri && !pictureUploading && (
          <TouchableOpacity
            style={styles.pictureClear}
            onPress={() => {
              setPictureUri(null);
              setUploadedPictureUrl(null);
            }}
            testID="clear-member-picture"
          >
            <X size={14} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Market Interest — single select only */}
      <Text style={styles.label}>Market Interest *</Text>
      <Text style={styles.helperText}>Select one option only.</Text>
      <View style={styles.interestList}>
        {MARKET_INTEREST_OPTIONS.map((opt) => {
          const active = selectedInterest === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.interestRow, active && styles.interestRowActive]}
              onPress={() => selectInterest(opt.id)}
              testID={`interest-${opt.id}`}
            >
              <View style={[styles.radioButton, active && styles.radioButtonActive]}>
                {active && <View style={styles.radioButtonDot} />}
              </View>
              <Text style={[styles.interestRowText, active && styles.interestRowTextActive]}>
                {opt.label}
              </Text>
              {active && <Check size={14} color={Colors.gold} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Terms */}
      <TouchableOpacity
        style={styles.termsRow}
        onPress={() => updateForm('acceptTerms', !formData.acceptTerms)}
      >
        <View style={[styles.checkbox, formData.acceptTerms && styles.checkboxChecked]}>
          {formData.acceptTerms && <Check size={12} color="#000000" />}
        </View>
        <Text style={styles.termsText}>
          I accept the{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </TouchableOpacity>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
        onPress={handleRegister}
        disabled={isLoading}
      >
        <Text style={styles.submitButtonText}>
          {isLoading ? 'Creating Account...' : 'Create Free Account'}
        </Text>
      </TouchableOpacity>

      {/* Sign In Link */}
      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => router.replace('/login' as Href)}
      >
        <Text style={styles.linkText}>
          Already have an account?{' '}
          <Text style={styles.linkHighlight}>Sign In</Text>
        </Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // Country Picker Modal
  const renderCountryPicker = () => (
    <Modal
      visible={showCountryPicker}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Country</Text>
          <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.searchContainer}>
          <Search size={18} color={Colors.muted} style={styles.inputIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search countries..."
            placeholderTextColor={Colors.muted}
            value={countrySearch}
            onChangeText={setCountrySearch}
          />
        </View>
        <FlatList
          data={filteredCountries}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.countryItem}
              onPress={() => selectCountry(item)}
            >
              <Text style={styles.countryItemText}>
                {item.name} ({item.dialCode})
              </Text>
              {formData.countryCode === item.code && (
                <Check size={18} color={Colors.gold} />
              )}
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {renderStepIndicator()}
        {step === 'Register' && renderRegisterForm()}
        {step === 'Verify' && (
          <MemberVerifyContent
            userId={userId}
            email={formData.email}
            phone={formData.phone}
            dialCode={formData.dialCode}
            onComplete={handleVerificationComplete}
            router={router}
          />
        )}
        {step === 'Dashboard' && (
          <MemberDashboardContent userId={userId} router={router} />
        )}
        {renderCountryPicker()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── SCREEN 2: Verify Email + Phone ───────────────────────────────────────

function MemberVerifyContent({
  userId,
  email,
  phone,
  dialCode,
  onComplete,
  router,
}: {
  userId: string;
  email: string;
  phone: string;
  dialCode: string;
  onComplete: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [emailCode, setEmailCode] = useState(['', '', '', '', '', '']);
  const [phoneCode, setPhoneCode] = useState(['', '', '', '', '', '']);
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [activeError, setActiveError] = useState('');

  const emailRefs = useRef<(TextInput | null)[]>([]);
  const phoneRefs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startResendTimer = () => {
    setResendTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCodeInput = (
    type: 'email' | 'phone',
    index: number,
    value: string,
  ) => {
    const setCode = type === 'email' ? setEmailCode : setPhoneCode;
    const refs = type === 'email' ? emailRefs : phoneRefs;
    const code = type === 'email' ? [...emailCode] : [...phoneCode];
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    code[index] = digit;
    setCode(code);
    setActiveError('');

    if (digit && index < 5) {
      refs.current[index + 1]?.focus();
    }

    if (code.every((c) => c !== '')) {
      handleVerify(type, code.join(''));
    }
  };

  const handleCodeKeyPress = (
    type: 'email' | 'phone',
    index: number,
    key: string,
  ) => {
    const refs = type === 'email' ? emailRefs : phoneRefs;
    const code = type === 'email' ? emailCode : phoneCode;
    if (key === 'Backspace' && !code[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (type: 'email' | 'phone', code: string) => {
    if (code.length !== 6) return;

    if (type === 'email') {
      setEmailLoading(true);
      try {
        const result = await MemberService.verifyEmail(userId, code);
        if (result.verified) {
          setEmailVerified(true);
        } else {
          setActiveError(result.message || 'Invalid code');
          setEmailCode(['', '', '', '', '', '']);
        }
      } catch {
        setActiveError('Verification failed. Please try again.');
      } finally {
        setEmailLoading(false);
      }
    } else {
      setPhoneLoading(true);
      try {
        const result = await MemberService.verifyPhone(userId, code);
        if (result.verified) {
          setPhoneVerified(true);
        } else {
          setActiveError(result.message || 'Invalid code');
          setPhoneCode(['', '', '', '', '', '']);
        }
      } catch {
        setActiveError('Verification failed. Please try again.');
      } finally {
        setPhoneLoading(false);
      }
    }
  };

  const handleResend = async (type: 'email' | 'phone') => {
    if (resendTimer > 0) return;

    try {
      if (type === 'email') {
        setEmailLoading(true);
        await MemberService.sendEmailCode(userId);
      } else {
        setPhoneLoading(true);
        await MemberService.sendPhoneCode(userId);
      }
      startResendTimer();
      setActiveError('');
    } catch {
      setActiveError('Failed to resend code. Please try again.');
    } finally {
      setEmailLoading(false);
      setPhoneLoading(false);
    }
  };

  const bothVerified = emailVerified && phoneVerified;

  React.useEffect(() => {
    if (bothVerified) {
      const timeout = setTimeout(onComplete, 1200);
      return () => clearTimeout(timeout);
    }
  }, [bothVerified, onComplete]);

  const renderCodeInputs = (
    type: 'email' | 'phone',
    codeArray: string[],
    refs: React.MutableRefObject<(TextInput | null)[]>,
    isVerified: boolean,
    isLoading: boolean,
  ) => (
    <View style={styles.codeRow}>
      {codeArray.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(el) => { refs.current[idx] = el; }}
          style={[
            styles.codeInput,
            isVerified && styles.codeInputVerified,
            digit !== '' && styles.codeInputFilled,
          ]}
          value={digit}
          onChangeText={(v) => handleCodeInput(type, idx, v)}
          onKeyPress={({ nativeEvent }) => handleCodeKeyPress(type, idx, nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={1}
          editable={!isVerified && !isLoading}
          selectTextOnFocus
        />
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      <View style={styles.headerSection}>
        <Text style={styles.title}>Verify Your Account</Text>
        <Text style={styles.subtitle}>
          We've sent verification codes to your email and phone. Enter both to continue.
        </Text>
      </View>

      {/* Email Verification Card */}
      <View style={styles.verifyCard}>
        <View style={styles.verifyCardHeader}>
          <View style={[styles.verifyIconBox, emailVerified && styles.verifyIconBoxDone]}>
            {emailVerified ? (
              <Check size={20} color="#000000" />
            ) : (
              <Mail size={20} color={Colors.gold} />
            )}
          </View>
          <View style={styles.verifyCardHeaderText}>
            <Text style={styles.verifyCardTitle}>Email Verification</Text>
            <Text style={styles.verifyCardSubtitle}>
              Code sent to {email || 'your email'}
            </Text>
          </View>
          <View style={[styles.verifyBadge, emailVerified ? styles.verifyBadgeDone : styles.verifyBadgePending]}>
            <Text style={[styles.verifyBadgeText, emailVerified && styles.verifyBadgeTextDone]}>
              {emailVerified ? 'Verified' : 'Pending'}
            </Text>
          </View>
        </View>

        {!emailVerified && (
          <>
            {renderCodeInputs('email', emailCode, emailRefs, emailVerified, emailLoading)}
            <TouchableOpacity
              style={[styles.resendButton, resendTimer > 0 && styles.resendButtonDisabled]}
              onPress={() => handleResend('email')}
              disabled={resendTimer > 0 || emailLoading}
            >
              <Text style={styles.resendButtonText}>
                {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend Email Code'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Phone Verification Card */}
      <View style={styles.verifyCard}>
        <View style={styles.verifyCardHeader}>
          <View style={[styles.verifyIconBox, phoneVerified && styles.verifyIconBoxDone]}>
            {phoneVerified ? (
              <Check size={20} color="#000000" />
            ) : (
              <Phone size={20} color={Colors.gold} />
            )}
          </View>
          <View style={styles.verifyCardHeaderText}>
            <Text style={styles.verifyCardTitle}>Phone Verification</Text>
            <Text style={styles.verifyCardSubtitle}>
              Code sent to {dialCode} {phone || 'your phone'}
            </Text>
          </View>
          <View style={[styles.verifyBadge, phoneVerified ? styles.verifyBadgeDone : styles.verifyBadgePending]}>
            <Text style={[styles.verifyBadgeText, phoneVerified && styles.verifyBadgeTextDone]}>
              {phoneVerified ? 'Verified' : 'Pending'}
            </Text>
          </View>
        </View>

        {!phoneVerified && (
          <>
            {renderCodeInputs('phone', phoneCode, phoneRefs, phoneVerified, phoneLoading)}
            <TouchableOpacity
              style={[styles.resendButton, resendTimer > 0 && styles.resendButtonDisabled]}
              onPress={() => handleResend('phone')}
              disabled={resendTimer > 0 || phoneLoading}
            >
              <Text style={styles.resendButtonText}>
                {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend SMS Code'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {activeError !== '' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{activeError}</Text>
        </View>
      )}

      {bothVerified && (
        <TouchableOpacity
          style={styles.submitButton}
          onPress={onComplete}
        >
          <Shield size={20} color="#000000" style={{ marginRight: 8 }} />
          <Text style={styles.submitButtonText}>Continue to Dashboard</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── SCREEN 3: Member Dashboard ───────────────────────────────────────────

function MemberDashboardContent({
  userId,
  router,
}: {
  userId: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      <View style={styles.headerSection}>
        <View style={styles.welcomeBadge}>
          <Check size={16} color="#000000" />
          <Text style={styles.welcomeBadgeText}>Account Verified</Text>
        </View>
        <Text style={styles.title}>Welcome to IVX Holding</Text>
        <Text style={styles.subtitle}>
          Your premium membership is active. Explore investment opportunities below.
        </Text>
      </View>

      {/* Featured Opportunities */}
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>Featured Opportunities</Text>
        <View style={styles.opportunityRow}>
          <View style={styles.opportunityItem}>
            <View style={styles.opportunityIcon}>
              <Text style={styles.opportunityEmoji}>🏠</Text>
            </View>
            <Text style={styles.opportunityName}>Residential Portfolio</Text>
            <Text style={styles.opportunityReturn}>12.5% APY</Text>
          </View>
          <View style={styles.opportunityItem}>
            <View style={styles.opportunityIcon}>
              <Text style={styles.opportunityEmoji}>🏢</Text>
            </View>
            <Text style={styles.opportunityName}>Commercial RE</Text>
            <Text style={styles.opportunityReturn}>9.8% APY</Text>
          </View>
          <View style={styles.opportunityItem}>
            <View style={styles.opportunityIcon}>
              <Text style={styles.opportunityEmoji}>🏗️</Text>
            </View>
            <Text style={styles.opportunityName}>Development</Text>
            <Text style={styles.opportunityReturn}>18.2% APY</Text>
          </View>
        </View>
      </View>

      {/* IVX AI Assistant */}
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>IVX AI Assistant</Text>
        <Text style={styles.cardSubtitle}>
          Your personal investment AI is ready to help you analyze opportunities,
          track your portfolio, and make informed decisions.
        </Text>
        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => router.push('/(tabs)/chat' as Href)}
        >
          <Text style={styles.outlineButtonText}>Open AI Assistant</Text>
          <ChevronRight size={18} color={Colors.gold} />
        </TouchableOpacity>
      </View>

      {/* Profile Completion */}
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>Complete Your Profile</Text>
        <View style={styles.profileSteps}>
          <View style={styles.profileStep}>
            <Check size={16} color={Colors.success} />
            <Text style={styles.profileStepTextDone}>Account Created</Text>
          </View>
          <View style={styles.profileStep}>
            <Check size={16} color={Colors.success} />
            <Text style={styles.profileStepTextDone}>Email Verified</Text>
          </View>
          <View style={styles.profileStep}>
            <Check size={16} color={Colors.success} />
            <Text style={styles.profileStepTextDone}>Phone Verified</Text>
          </View>
          <View style={styles.profileStep}>
            <View style={styles.profileStepPending}>
              <Text style={styles.profileStepPendingText}>4</Text>
            </View>
            <Text style={styles.profileStepText}>KYC (Required to invest)</Text>
          </View>
        </View>
      </View>

      {/* Become an Investor — Phase 2 activation */}
      <View style={styles.investCard}>
        <View style={styles.investorBadgeRow}>
          <TrendingUp size={18} color={Colors.gold} />
          <Text style={styles.investorBadgeText}>REAL INVESTOR ACTIVATION</Text>
        </View>
        <Text style={styles.investCardTitle}>Become an Investor</Text>
        <Text style={styles.investCardSubtitle}>
          Unlock investor-only opportunities: off-market deals, ZIP-code alerts,
          AI matching with buyers, sellers, and JV partners.
        </Text>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={() => router.push(`/become-investor?userId=${userId}` as Href)}
          testID="become-investor-cta"
        >
          <Text style={styles.submitButtonText}>Become an Investor</Text>
        </TouchableOpacity>
      </View>

      {/* Invest Now */}
      <View style={styles.investCard}>
        <Text style={styles.investCardTitle}>Ready to Start Investing?</Text>
        <Text style={styles.investCardSubtitle}>
          Complete your KYC verification to unlock investment opportunities. This step is required to comply with financial regulations.
        </Text>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={() => {
            Alert.alert(
              'Start KYC Verification',
              'KYC verification requires: \n\n• Government-issued ID (passport or driver license)\n• Proof of address (utility bill or bank statement)\n• A short selfie for liveness check\n\nAll documents are encrypted and securely stored.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Start KYC',
                  onPress: () => router.push('/kyc-verification' as Href),
                },
              ]
            );
          }}
        >
          <Text style={styles.submitButtonText}>Invest Now — Start KYC</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => router.replace('/(tabs)/(home)' as Href)}
        >
          <Text style={styles.skipButtonText}>Explore App First</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: { flex: 1 },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // Step Indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  stepDotContainer: {
    alignItems: 'center',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundSecondary,
  },
  stepDotActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.backgroundSecondary,
  },
  stepDotDone: {
    borderColor: Colors.success,
    backgroundColor: Colors.success,
  },
  stepDotText: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  stepDotTextActive: {
    color: Colors.gold,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 4,
    marginBottom: 16,
  },
  stepLineDone: {
    backgroundColor: Colors.success,
  },
  stepLabel: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 4,
    fontWeight: '600' as const,
  },
  stepLabelActive: {
    color: Colors.gold,
  },
  stepLabelDone: {
    color: Colors.success,
  },

  // Header
  headerSection: {
    marginTop: 20,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Form
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 14,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    minHeight: 44,
  },
  genderChipActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderColor: Colors.gold,
  },
  genderChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  genderChipTextActive: {
    color: Colors.gold,
    fontWeight: '600' as const,
  },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    height: '100%' as any,
  },
  countryText: {
    color: Colors.text,
  },
  placeholderText: {
    color: Colors.muted,
  },
  eyeButton: {
    padding: 8,
  },

  // Terms
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  termsLink: {
    color: Colors.gold,
    fontWeight: '600' as const,
  },

  // Market interest (single-select)
  interestList: {
    gap: 10,
    marginTop: 4,
  },
  interestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary,
  },
  interestRowActive: {
    borderColor: Colors.gold,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
  },
  interestRowText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  interestRowTextActive: {
    color: Colors.gold,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonActive: {
    borderColor: Colors.gold,
  },
  radioButtonDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.gold,
  },
  helperText: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: -2,
    marginBottom: 6,
    fontWeight: '500' as const,
  },

  // Member picture upload
  pictureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
  },
  picturePreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pictureImage: {
    width: '100%' as const,
    height: '100%' as const,
    borderRadius: 36,
  },
  pictureLoadingOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
  },
  pictureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  pictureButtonText: {
    fontSize: 14,
    color: Colors.gold,
    fontWeight: '600' as const,
  },
  pictureClear: {
    padding: 8,
  },
  investorBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  investorBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: Colors.gold,
    letterSpacing: 1.2,
  },

  // Buttons
  submitButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  linkRow: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  linkHighlight: {
    color: Colors.gold,
    fontWeight: '600' as const,
  },

  // Verification Cards
  verifyCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 20,
    marginBottom: 16,
  },
  verifyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  verifyIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  verifyIconBoxDone: {
    backgroundColor: Colors.success,
  },
  verifyCardHeaderText: {
    flex: 1,
  },
  verifyCardTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  verifyCardSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  verifyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  verifyBadgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  verifyBadgeDone: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  verifyBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.warning,
  },
  verifyBadgeTextDone: {
    color: Colors.success,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 8,
  },
  codeInput: {
    flex: 1,
    height: 52,
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  codeInputFilled: {
    borderColor: Colors.gold,
  },
  codeInputVerified: {
    borderColor: Colors.success,
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
    color: Colors.success,
  },
  resendButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  resendButtonText: {
    fontSize: 13,
    color: Colors.gold,
    fontWeight: '600' as const,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    textAlign: 'center',
  },

  // Dashboard
  welcomeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.success,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 12,
    gap: 6,
  },
  welcomeBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  dashboardCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  cardSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 8,
  },
  outlineButtonText: {
    color: Colors.gold,
    fontSize: 15,
    fontWeight: '600' as const,
  },

  // Opportunities
  opportunityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  opportunityItem: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  opportunityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  opportunityEmoji: {
    fontSize: 18,
  },
  opportunityName: {
    fontSize: 11,
    color: Colors.text,
    fontWeight: '600' as const,
    textAlign: 'center',
    marginBottom: 4,
  },
  opportunityReturn: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: '700' as const,
  },

  // Profile Steps
  profileSteps: {
    gap: 10,
  },
  profileStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileStepText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  profileStepTextDone: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  profileStepPending: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileStepPendingText: {
    fontSize: 10,
    color: Colors.muted,
    fontWeight: '700' as const,
  },

  // Invest Card
  investCard: {
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.2)',
    padding: 24,
    marginBottom: 16,
  },
  investCardTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.gold,
    marginBottom: 8,
  },
  investCardSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },

  // Country Picker
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    margin: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.surfaceBorder,
  },
  countryItemText: {
    fontSize: 15,
    color: Colors.text,
  },
});
