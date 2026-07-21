/**
 * IVXAuthCard — Premium glass-card authentication component.
 *
 * Unified Sign Up / Login experience with:
 * - Animated tab switcher with sliding gold indicator
 * - Glass morphism card (BlurView on native, backdrop-filter on web)
 * - IVX logo + "Invest. Build. Grow." branding
 * - Registration: First Name, Last Name, Email, Phone, Password, Confirm Password,
 *   Role selector (7 roles), optional profile picture
 * - Login: Email, Password, Remember Me, Forgot Password
 * - Password strength indicator with animated bar
 * - Inline field validation with clear error messages
 * - Email verification + Phone OTP flow after signup
 * - Secure badges (256-bit encryption, Privacy Protected)
 * - Fully responsive: mobile scroll, desktop centered card
 * - Preserves all existing Supabase, RBAC, and owner access logic
 */

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Mail,
  Lock,
  User,
  Phone,
  Eye,
  EyeOff,
  Check,
  CheckCircle,
  Calendar,
  Shield,
  ShieldCheck,
  ArrowRight,
  Camera,
  ChevronDown,
  AlertCircle,
  KeyRound,
  TrendingUp,
  Building2,
  Home,
  Briefcase,
  Megaphone,
  Handshake,
  Coins,
} from 'lucide-react-native';
import { useRouter, Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import Colors from '@/constants/colors';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import { useAuth } from '@/lib/auth-context';
import {
  validateEmail,
  validatePassword,
  validatePhone,
  sanitizeEmail,
  formatBirthdayInput,
  parseBirthday,
} from '@/lib/auth-helpers';
import { getPasswordResetRedirectUrl } from '@/lib/auth-password-recovery';
import * as MemberService from '@/lib/member-service';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type AuthMode = 'login' | 'signup';
type Step = 'form' | 'verify_email' | 'verify_phone' | 'complete';

interface RoleOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  memberRole: MemberService.MemberRoleInterest;
}

const ROLE_OPTIONS: RoleOption[] = [
  { id: 'investor', label: 'Investor', icon: <TrendingUp size={18} color={Colors.gold} />, memberRole: 'investor' },
  { id: 'buyer', label: 'Buyer', icon: <Home size={18} color={Colors.gold} />, memberRole: 'buyer' },
  { id: 'realtor', label: 'Realtor', icon: <Building2 size={18} color={Colors.gold} />, memberRole: 'agent' },
  { id: 'broker', label: 'Broker', icon: <Briefcase size={18} color={Colors.gold} />, memberRole: 'broker' },
  { id: 'influencer', label: 'Influencer', icon: <Megaphone size={18} color={Colors.gold} />, memberRole: 'agent' },
  { id: 'jv_partner', label: 'JV Partner', icon: <Handshake size={18} color={Colors.gold} />, memberRole: 'jv_partner' },
  { id: 'tokenized', label: 'Tokenized Investor', icon: <Coins size={18} color={Colors.gold} />, memberRole: 'tokenized' },
];

const GENDER_OPTIONS: { id: string; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const PASSWORD_STRENGTH_LEVELS = [
  { label: 'Too weak', color: '#FF4D4D', width: '20%' },
  { label: 'Weak', color: '#FF8C42', width: '40%' },
  { label: 'Fair', color: '#F5C518', width: '60%' },
  { label: 'Good', color: '#00C48C', width: '80%' },
  { label: 'Strong', color: '#00C48C', width: '100%' },
];

// ---------------------------------------------------------------------------
// Password Strength Hook
// ---------------------------------------------------------------------------

function calculatePasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 5);
}

// ---------------------------------------------------------------------------
// Inline Error Component
// ---------------------------------------------------------------------------

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorRow}>
      <AlertCircle size={13} color={Colors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Secure Badge
// ---------------------------------------------------------------------------

function SecureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.secureBadge}>
      {icon}
      <Text style={styles.secureBadgeText}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Glass Background
// ---------------------------------------------------------------------------

let glassCssInjected = false;
function injectGlassCss() {
  if (glassCssInjected || Platform.OS !== 'web') return;
  glassCssInjected = true;
  try {
    const css = `
      .ivx-glass-card {
        background: rgba(20, 20, 20, 0.75) !important;
        backdrop-filter: blur(24px) saturate(150%);
        -webkit-backdrop-filter: blur(24px) saturate(150%);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 215, 0, 0.08);
      }
      .ivx-glow-orb {
        filter: blur(60px);
      }
    `;
    const style = document.createElement('style');
    style.setAttribute('data-ivx-glass', 'true');
    style.textContent = css;
    document.head.appendChild(style);
  } catch {}
}

function GlassBackground({ children, style }: { children: React.ReactNode; style?: any }) {
  if (Platform.OS === 'web') {
    injectGlassCss();
    return (
      <View style={[styles.glassCardWeb, style]} {...({ className: 'ivx-glass-card' } as any)}>
        {children}
      </View>
    );
  }
  return (
    <BlurView
      intensity={40}
      tint="dark"
      style={[styles.glassCardNative, style]}
    >
      {children}
    </BlurView>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface IVXAuthCardProps {
  initialMode?: AuthMode;
  ownerMode?: boolean;
  testIdPrefix?: string;
}

export function IVXAuthCard({
  initialMode = 'login',
  ownerMode = false,
  testIdPrefix = 'ivx-auth',
}: IVXAuthCardProps) {
  const router = useRouter();
  const { login, register, loginLoading, registerLoading, isAuthenticated } = useAuth();

  // --- Mode & Step ---
  const [mode, setMode] = useState<AuthMode>(ownerMode ? 'login' : initialMode);
  const [step, setStep] = useState<Step>('form');

  // --- Tab Animation ---
  const tabAnim = useRef(new Animated.Value(initialMode === 'login' ? 0 : 1)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  // --- Tab Layout ---
  const [tabLayouts, setTabLayouts] = useState<{ login: number; signup: number }>({ login: 0, signup: 0 });
  const [containerWidth, setContainerWidth] = useState(0);

  // --- Login State ---
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [forgotPasswordSending, setForgotPasswordSending] = useState(false);
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);

  // --- Signup State ---
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [gender, setGender] = useState<string>('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('investor');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pictureUri, setPictureUri] = useState<string | null>(null);
  const [pictureUploading, setPictureUploading] = useState(false);
  const [uploadedPictureUrl, setUploadedPictureUrl] = useState<string | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  // --- Inline Validation ---
  const [firstNameError, setFirstNameError] = useState<string | null>(null);
  const [lastNameError, setLastNameError] = useState<string | null>(null);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);
  const [signupEmailError, setSignupEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [signupPasswordError, setSignupPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);

  // --- Verification State ---
  const [memberUserId, setMemberUserId] = useState('');
  const [emailCode, setEmailCode] = useState(['', '', '', '', '', '']);
  const [phoneCode, setPhoneCode] = useState(['', '', '', '', '', '']);
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const emailCodeRefs = useRef<(TextInput | null)[]>([]);
  const phoneCodeRefs = useRef<(TextInput | null)[]>([]);

  // --- Derived ---
  const isLoading = mode === 'login' ? loginLoading : registerLoading;
  const passwordStrength = useMemo(() => calculatePasswordStrength(signupPassword), [signupPassword]);
  const strengthInfo = PASSWORD_STRENGTH_LEVELS[Math.max(0, passwordStrength - 1)];

  // --- Redirect if already authenticated ---
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)/(home)/home' as Href);
    }
  }, [isAuthenticated, router]);

  // --- Entrance Animation ---
  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(cardSlide, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 75, friction: 9, useNativeDriver: true }),
    ]).start();
  }, [cardFade, cardSlide, logoScale]);

  // --- Load Remember Me ---
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync('ivx_remember_me');
        if (!cancelled && stored === 'true') {
          setRememberMe(true);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Resend Timer ---
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  // --- Tab Switch ---
  const switchTab = useCallback((newMode: AuthMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setStep('form');
    // Clear errors
    setLoginError(null);
    setEmailError(null);
    setPasswordError(null);
    setSignupError(null);
    setFirstNameError(null);
    setLastNameError(null);
    setBirthdayError(null);
    setGenderError(null);
    setSignupEmailError(null);
    setPhoneError(null);
    setSignupPasswordError(null);
    setConfirmPasswordError(null);
    setRoleError(null);
    setTermsError(null);
    setForgotPasswordSent(false);

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Animated.spring(tabAnim, {
      toValue: newMode === 'login' ? 0 : 1,
      tension: 80,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [mode, tabAnim]);

  // --- Tab Indicator Layout ---
  const onTabLayout = useCallback((tab: AuthMode) => (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    setTabLayouts((prev) => ({ ...prev, [tab]: width }));
  }, []);

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const indicatorTranslateX = tabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabLayouts.login || 0],
  });

  const indicatorWidth = useMemo(() => {
    return mode === 'login' ? tabLayouts.login : tabLayouts.signup;
  }, [mode, tabLayouts]);

  // --- Profile Picture ---
  const pickPicture = useCallback(async () => {
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
      await uploadPicture(uri);
    } catch (err) {
      const message = (err as Error)?.message || 'Failed to pick picture';
      Alert.alert('Picture Error', message);
    }
  }, []);

  const uploadPicture = useCallback(async (uri: string): Promise<void> => {
    setPictureUploading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
      if (!supabaseUrl || !anonKey) {
        throw new Error('Supabase storage is not configured.');
      }
      const bucket = 'member-pictures';
      const ext = uri.toLowerCase().includes('.png') ? 'png' : 'webp';
      const fileName = `member_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = fileName;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${filePath}`;
      const headers: Record<string, string> = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

      let uploadOk = false;
      if (Platform.OS === 'web') {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        headers['Content-Type'] = blob.type || 'image/jpeg';
        const response = await fetch(uploadUrl, { method: 'POST', headers, body: blob });
        uploadOk = response.ok;
      } else {
        const localUri = uri.startsWith('file://') ? uri : uri;
        headers['Content-Type'] = 'image/jpeg';
        const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'image/jpeg',
          headers,
        });
        uploadOk = result.status >= 200 && result.status < 300;
      }
      if (!uploadOk) throw new Error('Upload failed');
      const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
      const publicUrl = publicUrlData?.publicUrl || `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
      setUploadedPictureUrl(publicUrl);
    } catch (err) {
      const message = (err as Error)?.message || 'Picture upload failed';
      console.log('[IVXAuthCard] Picture upload failed:', message);
      setPictureUri(null);
      setUploadedPictureUrl(null);
      Alert.alert('Picture Upload Failed', 'Could not upload the picture. You can try again or skip — picture is optional.');
    } finally {
      setPictureUploading(false);
    }
  }, []);

  // --- Login Handler ---
  const handleLogin = useCallback(async () => {
    setLoginError(null);
    setEmailError(null);
    setPasswordError(null);

    const normalizedEmail = sanitizeEmail(loginEmail);
    let hasError = false;

    if (!normalizedEmail) {
      setEmailError('Email is required.');
      hasError = true;
    } else if (!validateEmail(normalizedEmail)) {
      setEmailError('Please enter a valid email address.');
      hasError = true;
    }

    if (!loginPassword) {
      setPasswordError('Password is required.');
      hasError = true;
    }

    if (hasError) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    // Save remember me preference
    try {
      await SecureStore.setItemAsync('ivx_remember_me', rememberMe ? 'true' : 'false');
    } catch {}

    try {
      const result = await login(normalizedEmail, loginPassword);
      if (!result.success) {
        setLoginError(result.message || 'Sign-in failed. Please check your credentials.');
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } else {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // Navigation is handled by auth context / redirect effect
      }
    } catch (err: any) {
      setLoginError(err?.message || 'An unexpected error occurred. Please try again.');
    }
  }, [loginEmail, loginPassword, rememberMe, login]);

  // --- Forgot Password ---
  const handleForgotPassword = useCallback(async () => {
    const normalizedEmail = sanitizeEmail(loginEmail);
    if (!normalizedEmail || !validateEmail(normalizedEmail)) {
      setEmailError('Enter your email above first, then tap forgot password.');
      return;
    }
    setForgotPasswordSending(true);
    try {
      const redirectTo = getPasswordResetRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) {
        const raw = error.message || 'Could not send reset email. Please try again.';
        const isRateLimit = (error as any)?.status === 429 || raw.toLowerCase().includes('rate limit');
        setLoginError(
          isRateLimit
            ? 'Too many reset attempts. Please wait 60 seconds and try again.'
            : raw,
        );
      } else {
        setForgotPasswordSent(true);
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (err: any) {
      const raw = err?.message || 'Could not send reset email.';
      const isRateLimit = raw.toLowerCase().includes('rate limit');
      setLoginError(isRateLimit ? 'Too many reset attempts. Please wait 60 seconds and try again.' : raw);
    } finally {
      setForgotPasswordSending(false);
    }
  }, [loginEmail]);

  // --- Signup Handler ---
  const handleSignup = useCallback(async () => {
    setSignupError(null);
    setFirstNameError(null);
    setLastNameError(null);
    setBirthdayError(null);
    setGenderError(null);
    setSignupEmailError(null);
    setPhoneError(null);
    setSignupPasswordError(null);
    setConfirmPasswordError(null);
    setRoleError(null);
    setTermsError(null);

    const normalizedEmail = sanitizeEmail(signupEmail);
    let hasError = false;

    if (!firstName.trim()) {
      setFirstNameError('First name is required.');
      hasError = true;
    }
    if (!lastName.trim()) {
      setLastNameError('Last name is required.');
      hasError = true;
    }
    const birthdayResult = parseBirthday(birthday);
    if (birthdayResult.error || !birthdayResult.iso) {
      setBirthdayError(birthdayResult.error || 'Date of birth is required.');
      hasError = true;
    }
    if (!gender) {
      setGenderError('Please select your gender.');
      hasError = true;
    }
    if (!normalizedEmail) {
      setSignupEmailError('Email is required.');
      hasError = true;
    } else if (!validateEmail(normalizedEmail)) {
      setSignupEmailError('Please enter a valid email address.');
      hasError = true;
    }
    if (!validatePhone(signupPhone)) {
      setPhoneError('Please enter a valid phone number (10+ digits).');
      hasError = true;
    }
    const pwResult = validatePassword(signupPassword);
    if (!pwResult.valid) {
      setSignupPasswordError(pwResult.reason || 'Password does not meet requirements.');
      hasError = true;
    }
    if (signupPassword !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
      hasError = true;
    }
    if (!selectedRole) {
      setRoleError('Please select a role.');
      hasError = true;
    }
    if (!acceptTerms) {
      setTermsError('You must accept the Terms of Service and Privacy Policy.');
      hasError = true;
    }

    if (hasError) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    try {
      const roleOption = ROLE_OPTIONS.find((r) => r.id === selectedRole);
      const memberRole = roleOption?.memberRole || 'investor';

      const result = await MemberService.registerMember({
        email: normalizedEmail,
        password: signupPassword,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: birthdayResult.iso ?? '',
        gender,
        phone: signupPhone,
        country: 'United States',
        zipCode: '',
        roles: [memberRole],
        acceptTerms,
        pictureUrl: uploadedPictureUrl ?? undefined,
      });

      if (result.success && result.userId) {
        setMemberUserId(result.userId);
        setStep('verify_email');
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // Auto-send email verification code
        try {
          await MemberService.sendEmailCode(result.userId);
        } catch {}
        setResendTimer(60);
      } else {
        // Fallback to auth context register
        const authResult = await register({
          email: normalizedEmail,
          password: signupPassword,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: signupPhone,
          country: 'United States',
          accountType: 'investor',
        });

        if (authResult.success) {
          if (authResult.requiresLogin) {
            Alert.alert(
              'Account Created',
              'Your registration is saved. Please sign in to continue.',
              [{ text: 'Go to Sign In', onPress: () => switchTab('login') }]
            );
          } else {
            setStep('complete');
          }
        } else if (authResult.alreadyExists) {
          setSignupError('This email is already registered. Please sign in instead.');
          switchTab('login');
        } else {
          setSignupError(authResult.message || 'Registration failed. Please try again.');
        }
      }
    } catch (err: any) {
      setSignupError(err?.message || 'Registration failed. Please try again.');
    }
  }, [firstName, lastName, birthday, gender, signupEmail, signupPhone, signupPassword, confirmPassword, selectedRole, acceptTerms, uploadedPictureUrl, register]);

  // --- Verification Code Input ---
  const handleCodeInput = useCallback((type: 'email' | 'phone', index: number, value: string) => {
    const code = type === 'email' ? [...emailCode] : [...phoneCode];
    const refs = type === 'email' ? emailCodeRefs : phoneCodeRefs;
    code[index] = value;
    if (type === 'email') {
      setEmailCode(code);
    } else {
      setPhoneCode(code);
    }
    if (value && index < 5) {
      refs.current[index + 1]?.focus();
    }
    if (code.every((c) => c !== '')) {
      void verifyCode(type, code.join(''));
    }
  }, [emailCode, phoneCode]);

  const handleCodeKeyPress = useCallback((type: 'email' | 'phone', index: number, key: string) => {
    void type; void index; void key;
    const refs = type === 'email' ? emailCodeRefs : phoneCodeRefs;
    const code = type === 'email' ? emailCode : phoneCode;
    if (key === 'Backspace' && !code[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }, [emailCode, phoneCode]);

  const verifyCode = useCallback(async (type: 'email' | 'phone', code: string) => {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return;
    setVerifying(true);
    try {
      if (type === 'email') {
        const result = await MemberService.verifyEmail(memberUserId, code);
        if (result.success) {
          setEmailVerified(true);
          setStep('verify_phone');
          setResendTimer(60);
          try {
            await MemberService.sendPhoneCode(memberUserId);
          } catch {}
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } else {
          Alert.alert('Verification Failed', result.message || 'Incorrect code. Please try again.');
          setEmailCode(['', '', '', '', '', '']);
          emailCodeRefs.current[0]?.focus();
        }
      } else {
        const result = await MemberService.verifyPhone(memberUserId, code);
        if (result.success) {
          setPhoneVerified(true);
          setStep('complete');
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } else {
          Alert.alert('Verification Failed', result.message || 'Incorrect code. Please try again.');
          setPhoneCode(['', '', '', '', '', '']);
          phoneCodeRefs.current[0]?.focus();
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  }, [memberUserId]);

  const resendCode = useCallback(async (type: 'email' | 'phone') => {
    if (resendTimer > 0) return;
    try {
      if (type === 'email') {
        await MemberService.sendEmailCode(memberUserId);
      } else {
        await MemberService.sendPhoneCode(memberUserId);
      }
      setResendTimer(60);
      Alert.alert('Code Sent', `A new verification code has been sent to your ${type}.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not resend code.');
    }
  }, [memberUserId, resendTimer]);

  // --- Complete Handler ---
  const handleComplete = useCallback(() => {
    router.replace('/(tabs)/(home)/home' as Href);
  }, [router]);

  // --- Navigate to other auth screens ---
  const goToLogin = useCallback(() => {
    router.push('/login' as Href);
  }, [router]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  // --- Verification Step ---
  if (step === 'verify_email' || step === 'verify_phone') {
    const type = step === 'verify_email' ? 'email' : 'phone';
    const code = type === 'email' ? emailCode : phoneCode;
    const refs = type === 'email' ? emailCodeRefs : phoneCodeRefs;
    const target = type === 'email' ? signupEmail : signupPhone;

    return (
      <View style={styles.outerContainer}>
        <LinearGradient
          colors={['#000000', '#0a0a0a', '#000000']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowOrb1} />
        <View style={styles.glowOrb2} />
        <Animated.View
          style={[
            styles.cardWrapper,
            { opacity: cardFade, transform: [{ translateY: cardSlide }] },
          ]}
        >
          <GlassBackground style={styles.glassCardVerify}>
            <View style={styles.verifyIconWrap}>
              {type === 'email' ? (
                <Mail size={36} color={Colors.gold} />
              ) : (
                <Phone size={36} color={Colors.gold} />
              )}
            </View>
            <Text style={styles.verifyTitle}>
              Verify Your {type === 'email' ? 'Email' : 'Phone'}
            </Text>
            <Text style={styles.verifySubtitle}>
              We sent a 6-digit code to
            </Text>
            <Text style={styles.verifyTarget}>{target}</Text>

            <View style={styles.codeRow}>
              {code.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={(ref) => { refs.current[index] = ref; }}
                  style={[styles.codeInput, digit ? styles.codeInputFilled : null]}
                  value={digit}
                  onChangeText={(value) => handleCodeInput(type, index, value.replace(/[^0-9]/g, ''))}
                  onKeyPress={(e) => handleCodeKeyPress(type, index, (e as any).key || '')}
                  keyboardType="number-pad"
                  maxLength={1}
                  autoFocus={index === 0}
                />
              ))}
            </View>

            {verifying && (
              <ActivityIndicator size="small" color={Colors.gold} style={styles.verifySpinner} />
            )}

            <View style={styles.resendRow}>
              <Text style={styles.resendText}>Didn't receive it? </Text>
              <TouchableOpacity
                onPress={() => resendCode(type)}
                disabled={resendTimer > 0}
              >
                <Text style={[styles.resendLink, resendTimer > 0 && styles.resendLinkDisabled]}>
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => { setStep('form'); }}
            >
              <Text style={styles.secondaryButtonText}>Back to form</Text>
            </TouchableOpacity>
          </GlassBackground>
        </Animated.View>
      </View>
    );
  }

  // --- Complete Step ---
  if (step === 'complete') {
    return (
      <View style={styles.outerContainer}>
        <LinearGradient
          colors={['#000000', '#0a0a0a', '#000000']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowOrb1} />
        <View style={styles.glowOrb2} />
        <Animated.View
          style={[
            styles.cardWrapper,
            { opacity: cardFade, transform: [{ translateY: cardSlide }] },
          ]}
        >
          <GlassBackground style={styles.glassCardVerify}>
            <View style={styles.completeIconWrap}>
              <CheckCircle size={48} color={Colors.green} />
            </View>
            <Text style={styles.verifyTitle}>Registration Complete!</Text>
            <Text style={styles.verifySubtitle}>
              Your IVX HOLDINGS account is verified and ready.
            </Text>
            <Text style={styles.verifyTarget}>You can now start investing.</Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleComplete}
            >
              <Text style={styles.primaryButtonText}>Go to Dashboard</Text>
              <ArrowRight size={18} color={Colors.black} />
            </TouchableOpacity>
          </GlassBackground>
        </Animated.View>
      </View>
    );
  }

  // --- Main Auth Form ---
  return (
    <View style={styles.outerContainer} onLayout={onContainerLayout}>
      <LinearGradient
        colors={['#000000', '#0a0a0a', '#000000']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glowOrb1} />
      <View style={styles.glowOrb2} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={Platform.OS === 'web' ? false : true}
        >
          <Animated.View
            style={[
              styles.cardWrapper,
              {
                opacity: cardFade,
                transform: [{ translateY: cardSlide }],
              },
            ]}
          >
            <GlassBackground style={styles.glassCard}>
              {/* Logo & Branding */}
              <View style={styles.logoSection}>
                <Animated.Image
                  source={IVX_LOGO_SOURCE}
                  style={[styles.logo, { transform: [{ scale: logoScale }] }]}
                  resizeMode="contain"
                />
                <Text style={styles.tagline}>Invest. Build. Grow.</Text>
              </View>

              {/* Tab Switcher */}
              {!ownerMode && (
                <View style={styles.tabContainer}>
                  <Animated.View
                    style={[
                      styles.tabIndicator,
                      {
                        width: indicatorWidth || 100,
                        transform: [{ translateX: indicatorTranslateX }],
                      },
                    ]}
                  />
                  <TouchableOpacity
                    style={styles.tab}
                    onLayout={onTabLayout('login')}
                    onPress={() => switchTab('login')}
                    activeOpacity={0.7}
                    testID={`${testIdPrefix}-tab-login`}
                  >
                    <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>
                      Sign In
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.tab}
                    onLayout={onTabLayout('signup')}
                    onPress={() => switchTab('signup')}
                    activeOpacity={0.7}
                    testID={`${testIdPrefix}-tab-signup`}
                  >
                    <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>
                      Sign Up
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {ownerMode && (
                <View style={styles.ownerModeBanner}>
                  <Shield size={16} color={Colors.gold} />
                  <Text style={styles.ownerModeText}>Owner Sign-In</Text>
                </View>
              )}

              {/* Login Form */}
              {mode === 'login' && (
                <View style={styles.formSection}>
                  {forgotPasswordSent ? (
                    <View style={styles.forgotSentCard}>
                      <CheckCircle size={20} color={Colors.green} />
                      <Text style={styles.forgotSentTitle}>Reset link sent</Text>
                      <Text style={styles.forgotSentText}>
                        Check your inbox (and spam folder) for a password reset link from Supabase.
                        Set a new password, then come back and sign in.
                      </Text>
                      <TouchableOpacity
                        onPress={() => setForgotPasswordSent(false)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {/* Email */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Email Address</Text>
                        <View style={[styles.inputWrap, emailError && styles.inputWrapError]}>
                          <Mail size={18} color={Colors.textTertiary} />
                          <TextInput
                            style={styles.input}
                            placeholder="you@example.com"
                            placeholderTextColor={Colors.inputPlaceholder}
                            value={loginEmail}
                            onChangeText={(text) => { setLoginEmail(text); setEmailError(null); setLoginError(null); }}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            autoComplete="email"
                            returnKeyType="next"
                            testID={`${testIdPrefix}-login-email`}
                          />
                        </View>
                        <FieldError message={emailError} />
                      </View>

                      {/* Password */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Password</Text>
                        <View style={[styles.inputWrap, passwordError && styles.inputWrapError]}>
                          <Lock size={18} color={Colors.textTertiary} />
                          <TextInput
                            style={styles.input}
                            placeholder="Enter your password"
                            placeholderTextColor={Colors.inputPlaceholder}
                            value={loginPassword}
                            onChangeText={(text) => { setLoginPassword(text); setPasswordError(null); setLoginError(null); }}
                            secureTextEntry={!showLoginPassword}
                            autoCapitalize="none"
                            autoComplete="password"
                            returnKeyType="go"
                            onSubmitEditing={handleLogin}
                            testID={`${testIdPrefix}-login-password`}
                          />
                          <TouchableOpacity
                            onPress={() => setShowLoginPassword(!showLoginPassword)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            {showLoginPassword ? (
                              <EyeOff size={18} color={Colors.textTertiary} />
                            ) : (
                              <Eye size={18} color={Colors.textTertiary} />
                            )}
                          </TouchableOpacity>
                        </View>
                        <FieldError message={passwordError} />
                      </View>

                      {/* Remember Me + Forgot Password */}
                      <View style={styles.loginOptionsRow}>
                        <TouchableOpacity
                          style={styles.checkboxRow}
                          onPress={() => setRememberMe(!rememberMe)}
                        >
                          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                            {rememberMe && <Check size={14} color={Colors.white} />}
                          </View>
                          <Text style={styles.checkboxLabel}>Remember me</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleForgotPassword}
                          disabled={forgotPasswordSending}
                        >
                          {forgotPasswordSending ? (
                            <ActivityIndicator size="small" color={Colors.gold} />
                          ) : (
                            <Text style={styles.forgotLink}>Forgot password?</Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      {/* Login Error */}
                      {loginError && (
                        <View style={styles.errorCard}>
                          <AlertCircle size={15} color={Colors.error} />
                          <Text style={styles.errorCardText}>{loginError}</Text>
                        </View>
                      )}

                      {/* Sign In Button */}
                      <TouchableOpacity
                        style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        testID={`${testIdPrefix}-login-submit`}
                      >
                        {isLoading ? (
                          <ActivityIndicator size="small" color={Colors.black} />
                        ) : (
                          <>
                            <Text style={styles.primaryButtonText}>Sign In</Text>
                            <ArrowRight size={18} color={Colors.black} />
                          </>
                        )}
                      </TouchableOpacity>

                      {/* Switch to signup */}
                      {!ownerMode && (
                        <View style={styles.switchModeRow}>
                          <Text style={styles.switchModeText}>New to IVX? </Text>
                          <TouchableOpacity onPress={() => switchTab('signup')}>
                            <Text style={styles.switchModeLink}>Create an account</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}

              {/* Signup Form */}
              {mode === 'signup' && (
                <View style={styles.formSection}>
                  {/* Profile Picture */}
                  <View style={styles.pictureSection}>
                    <TouchableOpacity
                      onPress={pickPicture}
                      style={styles.picturePicker}
                      testID={`${testIdPrefix}-picture-picker`}
                    >
                      {pictureUri ? (
                        <Image source={{ uri: pictureUri }} style={styles.picturePreview} />
                      ) : (
                        <View style={styles.picturePlaceholder}>
                          {pictureUploading ? (
                            <ActivityIndicator size="small" color={Colors.gold} />
                          ) : (
                            <>
                              <Camera size={24} color={Colors.textTertiary} />
                              <Text style={styles.pictureText}>Add Photo</Text>
                              <Text style={styles.pictureOptionalText}>Optional</Text>
                            </>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* First Name & Last Name */}
                  <View style={styles.nameRow}>
                    <View style={[styles.fieldGroup, { flex: 1 }]}>
                      <Text style={styles.fieldLabel}>First Name</Text>
                      <View style={[styles.inputWrap, firstNameError && styles.inputWrapError]}>
                        <User size={18} color={Colors.textTertiary} />
                        <TextInput
                          style={styles.input}
                          placeholder="John"
                          placeholderTextColor={Colors.inputPlaceholder}
                          value={firstName}
                          onChangeText={(text) => { setFirstName(text); setFirstNameError(null); }}
                          autoCapitalize="words"
                          returnKeyType="next"
                          testID={`${testIdPrefix}-signup-firstname`}
                        />
                      </View>
                      <FieldError message={firstNameError} />
                    </View>
                    <View style={{ width: 10 }} />
                    <View style={[styles.fieldGroup, { flex: 1 }]}>
                      <Text style={styles.fieldLabel}>Last Name</Text>
                      <View style={[styles.inputWrap, lastNameError && styles.inputWrapError]}>
                        <User size={18} color={Colors.textTertiary} />
                        <TextInput
                          style={styles.input}
                          placeholder="Doe"
                          placeholderTextColor={Colors.inputPlaceholder}
                          value={lastName}
                          onChangeText={(text) => { setLastName(text); setLastNameError(null); }}
                          autoCapitalize="words"
                          returnKeyType="next"
                          testID={`${testIdPrefix}-signup-lastname`}
                        />
                      </View>
                      <FieldError message={lastNameError} />
                    </View>
                  </View>

                  {/* Date of Birth (required) */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Date of Birth</Text>
                    <View style={[styles.inputWrap, birthdayError && styles.inputWrapError]}>
                      <Calendar size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="MM/DD/YYYY"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={birthday}
                        onChangeText={(text) => { setBirthday(formatBirthdayInput(text)); setBirthdayError(null); }}
                        keyboardType="number-pad"
                        maxLength={10}
                        returnKeyType="next"
                        testID={`${testIdPrefix}-signup-birthday`}
                      />
                    </View>
                    <FieldError message={birthdayError} />
                  </View>

                  {/* Gender (required) */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Gender</Text>
                    <View style={styles.genderRow}>
                      {GENDER_OPTIONS.map((option) => (
                        <TouchableOpacity
                          key={option.id}
                          style={[
                            styles.genderChip,
                            gender === option.id && styles.genderChipActive,
                            genderError && !gender ? styles.genderChipError : null,
                          ]}
                          onPress={() => {
                            setGender(option.id);
                            setGenderError(null);
                            if (Platform.OS !== 'web') {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }
                          }}
                          activeOpacity={0.8}
                          testID={`${testIdPrefix}-signup-gender-${option.id}`}
                        >
                          <Text
                            style={[
                              styles.genderChipText,
                              gender === option.id && styles.genderChipTextActive,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <FieldError message={genderError} />
                  </View>

                  {/* Email */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Email Address</Text>
                    <View style={[styles.inputWrap, signupEmailError && styles.inputWrapError]}>
                      <Mail size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="john.doe@example.com"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={signupEmail}
                        onChangeText={(text) => { setSignupEmail(text); setSignupEmailError(null); }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        returnKeyType="next"
                        testID={`${testIdPrefix}-signup-email`}
                      />
                    </View>
                    <FieldError message={signupEmailError} />
                  </View>

                  {/* Phone */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Phone Number</Text>
                    <View style={[styles.inputWrap, phoneError && styles.inputWrapError]}>
                      <Phone size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="+1 555 123 4567"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={signupPhone}
                        onChangeText={(text) => { setSignupPhone(text); setPhoneError(null); }}
                        keyboardType="phone-pad"
                        returnKeyType="next"
                        testID={`${testIdPrefix}-signup-phone`}
                      />
                    </View>
                    <FieldError message={phoneError} />
                  </View>

                  {/* Password */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View style={[styles.inputWrap, signupPasswordError && styles.inputWrapError]}>
                      <Lock size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="Min 8 chars, 1 uppercase, 1 number"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={signupPassword}
                        onChangeText={(text) => { setSignupPassword(text); setSignupPasswordError(null); }}
                        secureTextEntry={!showSignupPassword}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        returnKeyType="next"
                        testID={`${testIdPrefix}-signup-password`}
                      />
                      <TouchableOpacity
                        onPress={() => setShowSignupPassword(!showSignupPassword)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {showSignupPassword ? (
                          <EyeOff size={18} color={Colors.textTertiary} />
                        ) : (
                          <Eye size={18} color={Colors.textTertiary} />
                        )}
                      </TouchableOpacity>
                    </View>
                    <FieldError message={signupPasswordError} />
                    {/* Password Strength Indicator */}
                    {signupPassword.length > 0 && (
                      <View style={styles.strengthContainer}>
                        <View style={styles.strengthBar}>
                          <Animated.View
                            style={[
                              styles.strengthFill,
                              {
                                width: strengthInfo.width,
                                backgroundColor: strengthInfo.color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.strengthLabel, { color: strengthInfo.color }]}>
                          {strengthInfo.label}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Confirm Password */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Confirm Password</Text>
                    <View style={[styles.inputWrap, confirmPasswordError && styles.inputWrapError]}>
                      <Lock size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="Re-enter your password"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={confirmPassword}
                        onChangeText={(text) => { setConfirmPassword(text); setConfirmPasswordError(null); }}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        returnKeyType="next"
                        testID={`${testIdPrefix}-signup-confirm-password`}
                      />
                      <TouchableOpacity
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {showConfirmPassword ? (
                          <EyeOff size={18} color={Colors.textTertiary} />
                        ) : (
                          <Eye size={18} color={Colors.textTertiary} />
                        )}
                      </TouchableOpacity>
                    </View>
                    {confirmPassword.length > 0 && confirmPassword === signupPassword && (
                      <View style={styles.matchRow}>
                        <Check size={13} color={Colors.green} />
                        <Text style={styles.matchText}>Passwords match</Text>
                      </View>
                    )}
                    <FieldError message={confirmPasswordError} />
                  </View>

                  {/* Role Selector */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>I am a...</Text>
                    <View style={styles.roleGrid}>
                      {ROLE_OPTIONS.map((role) => (
                        <TouchableOpacity
                          key={role.id}
                          style={[
                            styles.roleChip,
                            selectedRole === role.id && styles.roleChipActive,
                          ]}
                          onPress={() => { setSelectedRole(role.id); setRoleError(null); }}
                          activeOpacity={0.7}
                          testID={`${testIdPrefix}-role-${role.id}`}
                        >
                          {role.icon}
                          <Text
                            style={[
                              styles.roleChipText,
                              selectedRole === role.id && styles.roleChipTextActive,
                            ]}
                          >
                            {role.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <FieldError message={roleError} />
                  </View>

                  {/* Terms */}
                  <TouchableOpacity
                    style={styles.termsRow}
                    onPress={() => { setAcceptTerms(!acceptTerms); setTermsError(null); }}
                  >
                    <View style={[styles.checkbox, acceptTerms && styles.checkboxChecked]}>
                      {acceptTerms && <Check size={14} color={Colors.white} />}
                    </View>
                    <Text style={styles.termsText}>
                      I accept the{' '}
                      <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
                      <Text style={styles.termsLink}>Privacy Policy</Text>
                    </Text>
                  </TouchableOpacity>
                  <FieldError message={termsError} />

                  {/* Signup Error */}
                  {signupError && (
                    <View style={styles.errorCard}>
                      <AlertCircle size={15} color={Colors.error} />
                      <Text style={styles.errorCardText}>{signupError}</Text>
                    </View>
                  )}

                  {/* Create Account Button */}
                  <TouchableOpacity
                    style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                    onPress={handleSignup}
                    disabled={isLoading}
                    testID={`${testIdPrefix}-signup-submit`}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color={Colors.black} />
                    ) : (
                      <>
                        <Text style={styles.primaryButtonText}>Create Account</Text>
                        <ArrowRight size={18} color={Colors.black} />
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Switch to login */}
                  <View style={styles.switchModeRow}>
                    <Text style={styles.switchModeText}>Already have an account? </Text>
                    <TouchableOpacity onPress={() => switchTab('login')}>
                      <Text style={styles.switchModeLink}>Sign In</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Secure Badges */}
              <View style={styles.secureBadgesRow}>
                <SecureBadge
                  icon={<ShieldCheck size={12} color={Colors.green} />}
                  label="256-bit Encryption"
                />
                <SecureBadge
                  icon={<Lock size={12} color={Colors.blue} />}
                  label="Privacy Protected"
                />
              </View>
            </GlassBackground>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const screenWidth = Dimensions.get('window').width;
const isTablet = screenWidth >= 768;
const cardMaxWidth = isTablet ? 480 : screenWidth - 32;

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    minHeight: 800,
  },
  glowOrb1: {
    position: 'absolute',
    top: -100,
    left: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
  },
  glowOrb2: {
    position: 'absolute',
    bottom: -120,
    right: -100,
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
    minHeight: 800,
  },
  cardWrapper: {
    width: '100%' as any,
    maxWidth: cardMaxWidth,
  },
  glassCard: {
    borderRadius: 24,
    overflow: 'hidden',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  glassCardWeb: {
    backgroundColor: 'rgba(20, 20, 20, 0.75)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 28,
    paddingVertical: 32,
  } as any,
  glassCardNative: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.15)',
    overflow: 'hidden',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  glassCardVerify: {
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 36,
    alignItems: 'center',
  } as any,

  // Logo
  logoSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 12,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.gold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    zIndex: 0,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    zIndex: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.black,
  },

  // Owner Mode
  ownerModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 24,
  },
  ownerModeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.gold,
  },

  // Form
  formSection: {
    gap: 14,
  } as any,

  // Profile Picture
  pictureSection: {
    alignItems: 'center',
    marginBottom: 10,
  },
  picturePicker: {
    width: 80,
    height: 80,
    borderRadius: 40,
  } as any,
  picturePreview: {
    width: 80,
    height: 80,
    borderRadius: 40,
  } as any,
  picturePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 215, 0, 0.2)',
    borderStyle: 'dashed' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pictureText: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  pictureOptionalText: {
    fontSize: 8,
    color: Colors.textTertiary,
    opacity: 0.7,
  },

  // Fields
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 50,
  },
  inputWrapError: {
    borderColor: Colors.error,
    borderWidth: 1.5,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0,
  },

  // Name Row
  nameRow: {
    flexDirection: 'row',
  },

  // Error
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  errorText: {
    fontSize: 12,
    color: Colors.error,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 77, 77, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorCardText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
  },

  // Password Strength
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%' as any,
    borderRadius: 2,
  } as any,
  strengthLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
  },

  // Match indicator
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  matchText: {
    fontSize: 12,
    color: Colors.green,
  },

  // Role Grid
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as any,
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    minHeight: 44,
  },
  roleChipActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderColor: Colors.gold,
  },
  roleChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  roleChipTextActive: {
    color: Colors.gold,
  },

  // Gender chips
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as any,
  genderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    minHeight: 44,
  },
  genderChipActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderColor: Colors.gold,
  },
  genderChipError: {
    borderColor: Colors.red,
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

  // Checkbox / Terms
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  checkboxLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  termsLink: {
    color: Colors.gold,
    fontWeight: '600' as const,
  },

  // Login Options
  loginOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  forgotLink: {
    fontSize: 13,
    color: Colors.gold,
    fontWeight: '500' as const,
  },

  // Buttons
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.black,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },

  // Switch Mode
  switchModeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  switchModeText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  switchModeLink: {
    fontSize: 14,
    color: Colors.gold,
    fontWeight: '600' as const,
  },

  // Secure Badges
  secureBadgesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secureBadgeText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },

  // Forgot Password Sent
  forgotSentCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  forgotSentTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.green,
  },
  forgotSentText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Verification
  verifyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  verifyTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  verifySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  verifyTarget: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.gold,
    marginBottom: 24,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  codeInput: {
    width: 44,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  codeInputFilled: {
    borderColor: Colors.gold,
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  verifySpinner: {
    marginBottom: 10,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  resendText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  resendLink: {
    fontSize: 13,
    color: Colors.gold,
    fontWeight: '600' as const,
  },
  resendLinkDisabled: {
    color: Colors.textTertiary,
  },

  // Complete
  completeIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 196, 140, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
});

export default IVXAuthCard;
