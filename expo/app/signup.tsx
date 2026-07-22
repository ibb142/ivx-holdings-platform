import React, { useState, useRef } from 'react';
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
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Href } from 'expo-router';
import {
  Mail,
  Lock,
  User,
  Phone,
  Globe,
  Eye,
  EyeOff,
  CheckCircle,
  ArrowLeft,
  Shield,
  ChevronRight,
  ChevronDown,
  Search,
  X,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { COUNTRIES, Country } from '@/constants/countries';
import { useAuth, resetOwnerLocalSignupState } from '@/lib/auth-context';
import { useAnalytics } from '@/lib/analytics-context';
import { validateEmail, validatePassword, validatePhone, sanitizeEmail } from '@/lib/auth-helpers';
import { findExistingRegisteredMemberByEmail } from '@/lib/member-registry';

type Step = 'register' | 'verify_email' | 'verify_phone' | 'complete';
type SignupAccountType = 'investor' | 'owner';

type SignUpScreenContentProps = {
  forcedAccountType?: SignupAccountType;
};

export function SignUpScreenContent({ forcedAccountType }: SignUpScreenContentProps = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountType?: string; role?: string; email?: string }>();
  const { register: authRegister } = useAuth();
  const { trackScreen, trackConversion } = useAnalytics();

  const [currentStep, setCurrentStep] = useState<Step>('register');
  const ownerRouteRequested = forcedAccountType === 'owner';
  const initialAccountType: SignupAccountType = ownerRouteRequested ? 'owner' : 'investor';
  const [accountType, setAccountType] = useState<SignupAccountType>(initialAccountType);
  const isOwnerSignup = accountType === 'owner';
  const isDedicatedOwnerSignup = forcedAccountType === 'owner';

  React.useEffect(() => {
    trackScreen(isOwnerSignup ? 'Owner Signup' : 'Signup');
  }, [isOwnerSignup, trackScreen]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    phone: '',
    country: 'United States',
    countryCode: 'US',
    dialCode: '+1',
    acceptTerms: false,
  });

  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [existingAccountDetected, setExistingAccountDetected] = useState<boolean>(false);
  const [signupCooldownUntilMs, setSignupCooldownUntilMs] = useState<number>(0);
  const [cooldownNowMs, setCooldownNowMs] = useState<number>(() => Date.now());

  React.useEffect(() => {
    const routeAccountType: SignupAccountType = forcedAccountType === 'owner' ? 'owner' : 'investor';
    setAccountType(routeAccountType);
  }, [forcedAccountType]);

  React.useEffect(() => {
    const routeEmail = typeof params.email === 'string' ? sanitizeEmail(params.email) : '';
    if (routeEmail) {
      updateForm('email', routeEmail);
    }
  }, [params.email]);

  const filteredCountries = COUNTRIES.filter(country =>
    country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    country.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const navigateToLogin = React.useCallback((prefillEmail?: string, justRegistered?: boolean) => {
    const trimmedEmail = prefillEmail?.trim() ?? '';
    const params: Record<string, string> = {};

    if (trimmedEmail) {
      params.email = trimmedEmail;
    }
    if (justRegistered) {
      params.justRegistered = '1';
    }

    router.replace({
      pathname: '/login',
      params,
    } as Href);
  }, [router]);

  const navigateToOwnerLogin = React.useCallback((prefillEmail?: string, justRegistered?: boolean) => {
    const trimmedEmail = prefillEmail?.trim() ?? '';
    const params: Record<string, string> = {};

    if (trimmedEmail) {
      params.email = trimmedEmail;
    }
    if (justRegistered) {
      params.justRegistered = '1';
    }

    router.push({
      pathname: '/login',
      params: {
        ...params,
        ownerMode: '1',
      },
    } as Href);
  }, [router]);

  const navigateToOwnerAccess = React.useCallback((prefillEmail?: string) => {
    const trimmedEmail = prefillEmail?.trim() ?? '';

    router.push({
      pathname: '/owner-access',
      params: {
        source: 'signup',
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      },
    } as Href);
  }, [router]);

  React.useEffect(() => {
    const normalizedEmail = formData.email.trim().toLowerCase();
    if (!normalizedEmail) {
      setExistingAccountDetected(false);
      return;
    }

    let isActive = true;
    const timeout = setTimeout(() => {
      findExistingRegisteredMemberByEmail(normalizedEmail)
        .then((record) => {
          if (isActive) {
            setExistingAccountDetected(!!record);
          }
        })
        .catch(() => {
          if (isActive) {
            setExistingAccountDetected(false);
          }
        });
    }, 180);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [formData.email]);

  React.useEffect(() => {
    if (signupCooldownUntilMs <= Date.now()) {
      return;
    }

    setCooldownNowMs(Date.now());
    const interval = setInterval(() => {
      const now = Date.now();
      setCooldownNowMs(now);
      if (signupCooldownUntilMs <= now) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [signupCooldownUntilMs]);

  const signupCooldownRemainingSeconds = Math.max(0, Math.ceil((signupCooldownUntilMs - cooldownNowMs) / 1000));
  const signupCooldownActive = signupCooldownRemainingSeconds > 0;

  const [emailCode, setEmailCode] = useState(['', '', '', '', '', '']);
  const [phoneCode, setPhoneCode] = useState(['', '', '', '', '', '']);
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const emailCodeRefs = useRef<(TextInput | null)[]>([]);
  const phoneCodeRefs = useRef<(TextInput | null)[]>([]);

  const updateForm = (key: keyof typeof formData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const startSignupCooldown = React.useCallback((seconds: number = 30) => {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 60) : 30;
    const now = Date.now();
    setCooldownNowMs(now);
    setSignupCooldownUntilMs(now + safeSeconds * 1000);
  }, []);

  const handleResetOwnerData = React.useCallback(() => {
    Alert.alert(
      'Restart Owner Registration?',
      'This clears stored owner trusted-device data, the local auth session, and any cached owner identity on this device. Your form is also cleared. Server-side owner accounts in Supabase are not deleted by this action.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear & Start Fresh',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLoading(true);
              const result = await resetOwnerLocalSignupState();
              setFormData({
                email: '',
                password: '',
                confirmPassword: '',
                firstName: '',
                lastName: '',
                phone: '',
                country: 'United States',
                countryCode: 'US',
                dialCode: '+1',
                acceptTerms: false,
              });
              setExistingAccountDetected(false);
              setSignupCooldownUntilMs(0);
              setCooldownNowMs(Date.now());
              setEmailCode(['', '', '', '', '', '']);
              setPhoneCode(['', '', '', '', '', '']);
              setEmailVerified(false);
              setPhoneVerified(false);
              setCurrentStep('register');
              logger.signup.log('Owner local signup reset proof:', result);
              const proofLines = [
                `Owner trusted-device cleared: ${result.clearedOwnerTrustedDevice ? 'yes' : 'no'}`,
                `Local auth store cleared: ${result.clearedAuthStore ? 'yes' : 'no'}`,
                `Supabase session signed out: ${result.signedOutSupabase ? 'yes' : 'no'}`,
                result.errors.length > 0 ? `Notes: ${result.errors.join(', ')}` : 'No errors reported.',
              ];
              Alert.alert('Owner Data Cleared', proofLines.join('\n'));
            } catch (error: any) {
              console.error('[Signup] Reset owner local data exception:', error);
              Alert.alert('Reset Failed', error?.message || 'Could not clear stored owner data. Please try again.');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  }, []);



  const handleRegister = async () => {
    const normalizedEmail = sanitizeEmail(formData.email);
    if (signupCooldownActive) {
      Alert.alert(
        'Signup Cooldown Active',
        `Signup is paused for ${signupCooldownRemainingSeconds}s to prevent Supabase throttling. If this account already exists, sign in instead.`,
        [
          {
            text: isOwnerSignup ? 'Sign in instead' : 'Go to Sign In',
            onPress: () => isOwnerSignup ? navigateToOwnerLogin(normalizedEmail) : navigateToLogin(normalizedEmail),
          },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }
    if (!formData.firstName || !formData.lastName) {
      Alert.alert('Missing Information', 'Please enter your first and last name.');
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
    if (!formData.acceptTerms) {
      Alert.alert('Terms Required', 'Please accept the Terms of Service and Privacy Policy.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await authRegister({
        email: normalizedEmail,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone ? `${formData.dialCode}${formData.phone}` : undefined,
        country: formData.country,
        accountType,
      });

      logger.signup.log('Register result:', result);

      if (result.success) {
        updateForm('email', normalizedEmail);
        trackConversion(isOwnerSignup ? 'owner_signup_submitted' : 'signup_completed', 0, { country: formData.country });

        if (isOwnerSignup) {
          const proof = result.proof ?? {};
          const proofLines = [
            `Auth user saved: ${proof.authUserCreated === false ? 'no' : 'yes'}`,
            `Profile saved: ${proof.profilePersisted === false ? 'pending retry' : 'yes'}`,
            'Role: owner',
            'Status: active',
            'KYC: approved',
            'Review queue: not required',
          ];
          Alert.alert(
            'Owner Account Created',
            `Your owner account was saved separately from regular investor/member accounts and approved for owner access.\n\nProof:\n${proofLines.join('\n')}`,
            [
              {
                text: 'Open Owner Login',
                onPress: () => navigateToOwnerLogin(result.email ?? formData.email, true),
              },
              {
                text: 'Owner Recovery',
                onPress: () => navigateToOwnerAccess(result.email ?? formData.email),
              },
            ]
          );
          return;
        }

        if (result.requiresLogin) {
          Alert.alert(
            'Account Created',
            'Registration is saved. Next time, just sign in with your email and password.',
            [
              {
                text: 'Go to Sign In',
                onPress: () => navigateToLogin(result.email ?? formData.email, true),
              },
            ]
          );
          return;
        }

        // Email is auto-confirmed server-side — skip verification, go straight to complete
        setEmailVerified(true);
        setPhoneVerified(true);
        setCurrentStep('complete');
        // Auto-navigate to login after a brief success display
        setTimeout(() => {
          navigateToLogin(result.email ?? formData.email, true);
        }, 1500);
      } else if (result.alreadyExists) {
        console.warn('[Signup] Existing account routed to sign-in:', result.message);
        setExistingAccountDetected(true);
        Alert.alert(
          'Account Already Exists',
          `${result.message || 'This email is already registered. Please sign in instead.'}\n\nThe app will not call signup again for this owner email. Sign in to run profile/wallet repair after login.`,
          [
            {
              text: isOwnerSignup ? 'Sign in instead' : 'Owner Login',
              onPress: () => navigateToOwnerLogin(result.email ?? formData.email),
            },
            {
              text: 'Regular Sign In',
              onPress: () => navigateToLogin(result.email ?? formData.email),
            },
            {
              text: 'Cancel',
              style: 'cancel',
            },
          ]
        );
      } else if (result.deploymentBlocked) {
        console.warn('[Signup] Owner registration backend deployment blocked:', result.message);
        Alert.alert(
          'Owner Registration Update Not Live Yet',
          result.message || 'The owner-registration backend repair route is not live yet. Your data was not saved through the public signup path. Deploy the current backend and try again.',
          [
            {
              text: 'Owner Login',
              onPress: () => navigateToOwnerLogin(result.email ?? normalizedEmail),
            },
            {
              text: 'OK',
              style: 'cancel',
            },
          ]
        );
      } else if (result.rateLimited) {
        const cooldownSeconds = typeof result.proof?.cooldownSeconds === 'number' ? Math.min(result.proof.cooldownSeconds, 60) : 30;
        startSignupCooldown(cooldownSeconds);
        console.warn('[Signup] Signup throttled; cooldown UI armed:', cooldownSeconds, 'seconds');
        Alert.alert(
          'Please Wait a Moment',
          `${result.message || 'Signups are temporarily throttled. Your data was not saved yet. Please wait a moment and try again.'}\n\nSignup is paused on this device for ${Math.ceil(cooldownSeconds)}s to prevent repeated Supabase throttling.`,
          [
            {
              text: isOwnerSignup ? 'Sign in instead' : 'Go to Sign In',
              onPress: () => isOwnerSignup ? navigateToOwnerLogin(result.email ?? normalizedEmail) : navigateToLogin(result.email ?? normalizedEmail),
            },
            {
              text: 'OK',
              style: 'cancel',
            },
          ]
        );
      } else {
        console.warn('[Signup] Register failed:', result.message);
        Alert.alert('Registration Failed', result.message || 'Could not create account. Please try again.');
      }
    } catch (error: any) {
      console.warn('[Signup] Register exception handled:', error?.message || 'unknown');
      Alert.alert('Error', error?.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
      setResendTimer(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCodeInput = (
    type: 'email' | 'phone',
    index: number,
    value: string
  ) => {
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

    if (code.every(c => c !== '')) {
      verifyCode(type, code.join(''));
    }
  };

  const handleCodeKeyPress = (
    type: 'email' | 'phone',
    index: number,
    key: string
  ) => {
    const refs = type === 'email' ? emailCodeRefs : phoneCodeRefs;
    const code = type === 'email' ? emailCode : phoneCode;
    
    if (key === 'Backspace' && !code[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const verifyCode = (type: 'email' | 'phone', code: string) => {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      Alert.alert('Invalid Code', 'Please enter a valid 6-digit verification code.');
      return;
    }
    setIsLoading(true);
    logger.signup.log(`Verifying ${type} code:`, code);
    
    setTimeout(() => {
      setIsLoading(false);
      if (code.length === 6 && /^\d{6}$/.test(code)) {
        if (type === 'email') {
          setEmailVerified(true);
          Alert.alert('Email Verified', 'Your email has been verified successfully.', [
            {
              text: 'Continue',
              onPress: () => {
                setCurrentStep('verify_phone');
                startResendTimer();
              },
            },
          ]);
        } else {
          setPhoneVerified(true);
          Alert.alert('Phone Verified', 'Your phone number has been verified successfully.', [
            {
              text: 'Continue',
              onPress: () => setCurrentStep('complete'),
            },
          ]);
        }
      } else {
        Alert.alert('Invalid Code', 'The verification code is incorrect. Please try again.');
      }
    }, 1000);
  };

  const resendCode = (type: 'email' | 'phone') => {
    if (resendTimer > 0) return;
    
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      startResendTimer();
      Alert.alert('Code Sent', `A new verification code has been sent to your ${type}.`);
    }, 1000);
  };

  const handleComplete = () => {
    if (isOwnerSignup) {
      Alert.alert(
        'Owner Account Created',
        'Your owner account is active. KYC is not required for owner accounts.',
        [
          {
            text: 'Continue',
            // Land on Home so the owner sees the real app first; Owner Controls is reachable from Profile/Admin.
            onPress: () => router.replace('/(tabs)/(home)/home' as Href),
          },
        ]
      );
      return;
    }
    Alert.alert(
      'Registration Complete',
      'Your account has been created successfully. You can now complete your KYC verification to start investing.',
      [
        {
          text: 'Start KYC',
          onPress: () => router.replace('/kyc-verification' as Href),
        },
        {
          text: 'Later',
          style: 'cancel',
          onPress: () => router.replace('/(tabs)/(home)' as Href),
        },
      ]
    );
  };

  const renderRegisterForm = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.logoContainer}>
        <Image
          source={IVX_LOGO_SOURCE}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>{isOwnerSignup ? 'Create Owner Account' : 'Create Account'}</Text>
        <Text style={styles.subtitle}>
          {isOwnerSignup
            ? 'Separate owner intake for IVX control access. This does not create a regular worker or public investor account.'
            : 'Join IVX HOLDINGS and start investing in premium real estate'}
        </Text>
      </View>

      <View style={[styles.accountTypeCard, isDedicatedOwnerSignup && styles.accountTypeCardOwnerLocked]} testID="signup-account-type-card">
        <Text style={styles.accountTypeEyebrow}>{isDedicatedOwnerSignup ? 'Owner sign-up screen' : 'Choose sign-up type'}</Text>
        {isDedicatedOwnerSignup ? (
          <View style={styles.ownerLockedRow} testID="owner-signup-locked-mode">
            <View style={styles.ownerLockedIconWrap}>
              <Shield size={18} color={Colors.black} />
            </View>
            <View style={styles.ownerLockedContent}>
              <Text style={styles.ownerLockedTitle}>Owner mode is selected</Text>
              <Text style={styles.ownerLockedSubtitle}>This dedicated screen creates an approved owner account directly. It does not create a worker or regular public user account.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.accountTypeSwitch}>
            <TouchableOpacity
              style={[styles.accountTypeOption, !isOwnerSignup && styles.accountTypeOptionActive]}
              activeOpacity={0.84}
              onPress={() => setAccountType('investor')}
              testID="signup-account-type-investor"
            >
              <Text style={[styles.accountTypeOptionTitle, !isOwnerSignup && styles.accountTypeOptionTitleActive]}>Regular user</Text>
              <Text style={styles.accountTypeOptionSubtitle}>Investor/member access</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.accountTypeOption, styles.accountTypeOptionActiveOwner]}
              activeOpacity={0.84}
              onPress={() => navigateToOwnerLogin(formData.email)}
              testID="signup-account-type-owner-login"
            >
              <Text style={[styles.accountTypeOptionTitle, styles.accountTypeOptionTitleActive]}>Owner Login</Text>
              <Text style={styles.accountTypeOptionSubtitle}>Existing owner access</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={styles.accountTypeProofText}>
          {isOwnerSignup
            ? 'Proof: owner sign-up now saves accountType=owner, requestedRole=owner, role=owner, status=active, and kycStatus=approved directly.'
            : 'Proof: regular sign-up saves the normal investor/member path only.'}
        </Text>
        {isDedicatedOwnerSignup ? (
          <View style={styles.ownerLockedActionsRow}>
            <TouchableOpacity style={styles.switchToRegularButton} onPress={() => router.replace('/signup' as Href)} testID="owner-signup-switch-regular">
              <Text style={styles.switchToRegularText}>Need regular user signup instead?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetOwnerButton} onPress={handleResetOwnerData} testID="owner-signup-reset-local">
              <Text style={styles.resetOwnerText}>Start fresh — clear stored owner data</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {!isOwnerSignup ? (
        <View
          style={[styles.ownerShortcutCard, styles.ownerAccessCard]}
          testID="signup-owner-access-chooser"
        >
          <View style={styles.ownerShortcutIconWrap}>
            <Shield size={18} color={Colors.black} />
          </View>
          <View style={styles.ownerShortcutContent}>
            <Text style={styles.ownerShortcutTitle}>Owner access</Text>
            <Text style={styles.ownerShortcutSubtitle}>Owner account already exists. Use Owner Login only; this screen no longer opens owner sign-up.</Text>
            <View style={styles.ownerAccessActions}>
              <TouchableOpacity
                style={styles.ownerAccessLoginButton}
                activeOpacity={0.84}
                onPress={() => navigateToOwnerLogin(formData.email)}
                testID="signup-owner-login-option"
              >
                <Text style={styles.ownerAccessLoginText}>Owner Login</Text>
                <ChevronRight size={15} color={Colors.black} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.ownerShortcutCard, styles.ownerAccessCard]}
          activeOpacity={0.84}
          onPress={() => navigateToOwnerLogin(formData.email)}
          testID="signup-existing-owner-login"
        >
          <View style={styles.ownerShortcutIconWrap}>
            <Shield size={18} color={Colors.black} />
          </View>
          <View style={styles.ownerShortcutContent}>
            <Text style={styles.ownerShortcutTitle}>Returning owner?</Text>
            <Text style={styles.ownerShortcutSubtitle}>Open Owner Login instead. This Owner Sign-Up form is only for creating a brand-new owner account.</Text>
          </View>
          <ChevronRight size={18} color={Colors.primary} />
        </TouchableOpacity>
      )}
      

      <View style={styles.formSection}>
        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>First Name *</Text>
            <View style={styles.inputContainer}>
              <User size={20} color={Colors.textTertiary} />
              <TextInput
                style={styles.input}
                placeholder="John"
                placeholderTextColor={Colors.textTertiary}
                value={formData.firstName}
                onChangeText={(text) => updateForm('firstName', text)}
                autoCapitalize="words"
              />
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.inputLabel}>Last Name *</Text>
            <View style={styles.inputContainer}>
              <User size={20} color={Colors.textTertiary} />
              <TextInput
                style={styles.input}
                placeholder="Doe"
                placeholderTextColor={Colors.textTertiary}
                value={formData.lastName}
                onChangeText={(text) => updateForm('lastName', text)}
                autoCapitalize="words"
              />
            </View>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Email Address *</Text>
          <View style={styles.inputContainer}>
            <Mail size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="john.doe@example.com"
              placeholderTextColor={Colors.textTertiary}
              value={formData.email}
              onChangeText={(text) => updateForm('email', sanitizeEmail(text))}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="signup-email"
            />
          </View>
          {existingAccountDetected && (
            <TouchableOpacity
              style={styles.existingAccountCard}
              onPress={() => isOwnerSignup ? navigateToOwnerLogin(formData.email) : navigateToLogin(formData.email)}
              testID="signup-existing-account"
            >
              <Shield size={16} color={Colors.primary} />
              <View style={styles.existingAccountContent}>
                <Text style={styles.existingAccountTitle}>Account already found</Text>
                <Text style={styles.existingAccountSubtitle}>Use Sign In for returning members. If this is your owner account, open Owner Login instead of creating a duplicate account.</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Phone Number *</Text>
          <View style={styles.inputContainer}>
            <Phone size={20} color={Colors.textTertiary} />
            <Text style={styles.dialCode}>{formData.dialCode}</Text>
            <TextInput
              style={styles.input}
              placeholder="555 123 4567"
              placeholderTextColor={Colors.textTertiary}
              value={formData.phone}
              onChangeText={(text) => updateForm('phone', text)}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Country *</Text>
          <TouchableOpacity
            style={styles.inputContainer}
            onPress={() => setShowCountryPicker(true)}
          >
            <Globe size={20} color={Colors.textTertiary} />
            <Text style={[styles.input, styles.countryText]}>{formData.country}</Text>
            <ChevronDown size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Password *</Text>
          <View style={styles.inputContainer}>
            <Lock size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Minimum 8 characters"
              placeholderTextColor={Colors.textTertiary}
              value={formData.password}
              onChangeText={(text) => updateForm('password', text)}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              {showPassword ? (
                <EyeOff size={20} color={Colors.textTertiary} />
              ) : (
                <Eye size={20} color={Colors.textTertiary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Confirm Password *</Text>
          <View style={styles.inputContainer}>
            <Lock size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Re-enter password"
              placeholderTextColor={Colors.textTertiary}
              value={formData.confirmPassword}
              onChangeText={(text) => updateForm('confirmPassword', text)}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
              {showConfirmPassword ? (
                <EyeOff size={20} color={Colors.textTertiary} />
              ) : (
                <Eye size={20} color={Colors.textTertiary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => updateForm('acceptTerms', !formData.acceptTerms)}
        >
          <View style={[styles.checkbox, formData.acceptTerms && styles.checkboxChecked]}>
            {formData.acceptTerms && <CheckCircle size={16} color={Colors.white} />}
          </View>
          <Text style={styles.termsText}>
            I accept the <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </Text>
        </TouchableOpacity>

        {signupCooldownActive ? (
          <View style={styles.cooldownCard} testID="signup-cooldown-card">
            <Shield size={18} color="#F59E0B" />
            <View style={styles.cooldownContent}>
              <Text style={styles.cooldownTitle}>Signup cooldown active</Text>
              <Text style={styles.cooldownSubtitle}>Paused for {signupCooldownRemainingSeconds}s so the app does not keep hitting Supabase signup throttles. Existing owners should sign in instead.</Text>
            </View>
            <TouchableOpacity
              style={styles.cooldownSignInButton}
              onPress={() => isOwnerSignup ? navigateToOwnerLogin(formData.email) : navigateToLogin(formData.email)}
              testID="signup-cooldown-signin"
            >
              <Text style={styles.cooldownSignInText}>Sign in instead</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, (isLoading || signupCooldownActive) && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isLoading || signupCooldownActive}
          testID="signup-submit"
        >
          <Text style={styles.primaryButtonText}>
            {isLoading ? (isOwnerSignup ? 'Checking Owner Account...' : 'Creating Account...') : signupCooldownActive ? `Try again in ${signupCooldownRemainingSeconds}s` : (isOwnerSignup ? 'Submit Owner Sign-Up' : 'Create Account')}
          </Text>
        </TouchableOpacity>

        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => isOwnerSignup ? navigateToOwnerLogin(formData.email) : navigateToLogin(formData.email)} testID="signup-go-login">
            <Text style={styles.loginLink}>{isOwnerSignup ? 'Owner Login' : 'Sign In'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderVerificationStep = (type: 'email' | 'phone') => {
    const code = type === 'email' ? emailCode : phoneCode;
    const refs = type === 'email' ? emailCodeRefs : phoneCodeRefs;
    const target = type === 'email' ? formData.email : formData.phone;
    const verified = type === 'email' ? emailVerified : phoneVerified;

    return (
      <View style={styles.verificationContainer}>
        <View style={styles.verificationIcon}>
          {type === 'email' ? (
            <Mail size={40} color={Colors.primary} />
          ) : (
            <Phone size={40} color={Colors.primary} />
          )}
        </View>

        <Text style={styles.verificationTitle}>
          Verify Your {type === 'email' ? 'Email' : 'Phone Number'}
        </Text>
        <Text style={styles.verificationSubtitle}>
          We have sent a 6-digit verification code to
        </Text>
        <Text style={styles.verificationTarget}>{target}</Text>

        <View style={styles.codeContainer}>
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                refs.current[index] = ref;
              }}
              style={[styles.codeInput, digit && styles.codeInputFilled]}
              value={digit}
              onChangeText={(value) => handleCodeInput(type, index, value.slice(-1))}
              onKeyPress={({ nativeEvent }) => handleCodeKeyPress(type, index, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.resendButton, resendTimer > 0 && styles.resendButtonDisabled]}
          onPress={() => resendCode(type)}
          disabled={resendTimer > 0}
        >
          <Text style={[styles.resendText, resendTimer > 0 && styles.resendTextDisabled]}>
            {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend Code'}
          </Text>
        </TouchableOpacity>

        {verified && (
          <View style={styles.verifiedBadge}>
            <CheckCircle size={20} color={Colors.success} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
      </View>
    );
  };

  const renderCompleteStep = () => (
    <View style={styles.completeContainer}>
      <View style={styles.completeIcon}>
        <Shield size={60} color={Colors.success} />
      </View>

      <Text style={styles.completeTitle}>Account Created!</Text>
      <Text style={styles.completeSubtitle}>
        Your account has been successfully created. Complete your KYC verification to unlock all features and start investing.
      </Text>

      <View style={styles.verificationStatus}>
        <View style={styles.statusRow}>
          <CheckCircle size={20} color={Colors.success} />
          <Text style={styles.statusText}>Email verified</Text>
        </View>
        <View style={styles.statusRow}>
          <CheckCircle size={20} color={Colors.success} />
          <Text style={styles.statusText}>Phone verified</Text>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.pendingIcon}>
            <Text style={styles.pendingIconText}>!</Text>
          </View>
          <Text style={styles.statusTextPending}>KYC verification pending</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={handleComplete}>
        <Text style={styles.primaryButtonText}>Complete KYC Verification</Text>
        <ChevronRight size={20} color={Colors.background} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.replace('/(tabs)/(home)' as Href)}
      >
        <Text style={styles.secondaryButtonText}>Do This Later</Text>
      </TouchableOpacity>
    </View>
  );

  const selectCountry = (country: Country) => {
    setFormData(prev => ({
      ...prev,
      country: country.name,
      countryCode: country.code,
      dialCode: country.dialCode,
    }));
    setShowCountryPicker(false);
    setCountrySearch('');
  };

  const renderCountryItem = ({ item }: { item: Country }) => (
    <TouchableOpacity
      style={styles.countryItem}
      onPress={() => selectCountry(item)}
    >
      <Text style={styles.countryItemName}>{item.name}</Text>
      <Text style={styles.countryItemDialCode}>{item.dialCode}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                setShowCountryPicker(false);
                setCountrySearch('');
              }}
            >
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchContainer}>
            <Search size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search countries..."
              placeholderTextColor={Colors.textTertiary}
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            renderItem={renderCountryItem}
            showsVerticalScrollIndicator={false}
            style={styles.countryList}
          />
        </SafeAreaView>
      </Modal>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (currentStep === 'register') {
                  router.back();
                } else if (currentStep === 'verify_email') {
                  setCurrentStep('register');
                } else if (currentStep === 'verify_phone') {
                  setCurrentStep('verify_email');
                }
              }}
            >
              <ArrowLeft size={24} color={Colors.text} />
            </TouchableOpacity>

            <View style={styles.progressContainer}>
              {['register', 'verify_email', 'verify_phone', 'complete'].map((step, index) => (
                <View
                  key={step}
                  style={[
                    styles.progressDot,
                    (currentStep === step ||
                      ['register', 'verify_email', 'verify_phone', 'complete'].indexOf(currentStep) > index) &&
                      styles.progressDotActive,
                  ]}
                />
              ))}
            </View>

            <View style={{ width: 40 }} />
          </View>

          {currentStep === 'register' && renderRegisterForm()}
          {currentStep === 'verify_email' && renderVerificationStep('email')}
          {currentStep === 'verify_phone' && renderVerificationStep('phone')}
          {currentStep === 'complete' && renderCompleteStep()}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export default function SignUpScreen() {
  return <SignUpScreenContent />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    padding: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surface,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: Colors.background,
  },
  logoContainer: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 16,
  },
  title: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800' as const,
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  formSection: {
    marginBottom: 16,
  },
  accountTypeCard: {
    marginBottom: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#243242',
    backgroundColor: '#0A121C',
    padding: 14,
    gap: 12,
  },
  accountTypeEyebrow: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  accountTypeSwitch: {
    flexDirection: 'row',
    gap: 10,
  },
  accountTypeCardOwnerLocked: {
    borderColor: '#F59E0B66',
    backgroundColor: '#1A1207',
  },
  ownerLockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerLockedIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F59E0B',
  },
  ownerLockedContent: {
    flex: 1,
  },
  ownerLockedTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '900' as const,
  },
  ownerLockedSubtitle: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  accountTypeOption: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3543',
    backgroundColor: '#0F1722',
    padding: 12,
    minHeight: 82,
    justifyContent: 'center',
  },
  accountTypeOptionActive: {
    borderColor: Colors.primary + '80',
    backgroundColor: Colors.primary + '16',
  },
  accountTypeOptionActiveOwner: {
    borderColor: '#F59E0B88',
    backgroundColor: '#F59E0B18',
  },
  accountTypeOptionTitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '900' as const,
  },
  accountTypeOptionTitleActive: {
    color: Colors.text,
  },
  accountTypeOptionSubtitle: {
    marginTop: 4,
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
  },
  accountTypeProofText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  ownerLockedActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  resetOwnerButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F87171AA',
    backgroundColor: '#7F1D1D22',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resetOwnerText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '800' as const,
  },
  switchToRegularButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  switchToRegularText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  ownerShortcutCard: {
    marginBottom: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#4A90D938',
    backgroundColor: '#07111D',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerShortcutIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  ownerAccessCard: {
    borderColor: '#F59E0B44',
    backgroundColor: '#1A1207',
  },
  ownerShortcutContent: {
    flex: 1,
  },
  ownerShortcutTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  ownerShortcutSubtitle: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  ownerAccessActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  ownerAccessLoginButton: {
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerAccessLoginText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '900' as const,
  },
  ownerAccessSignupButton: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.primary + '66',
    backgroundColor: '#050B12',
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerAccessSignupText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '900' as const,
  },
  inputGroup: {
    marginBottom: 16,
  },
  existingAccountCard: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '28',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  existingAccountContent: {
    flex: 1,
  },
  existingAccountTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  existingAccountSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 18,
  },
  inputRow: {
    flexDirection: 'row',
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    color: Colors.text,
    fontSize: 16,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 20,
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  termsText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  termsLink: {
    color: Colors.primary,
    textDecorationLine: 'underline' as const,
  },
  cooldownCard: {
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F59E0B66',
    backgroundColor: '#1A1207',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cooldownContent: {
    flex: 1,
  },
  cooldownTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '900' as const,
  },
  cooldownSubtitle: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  cooldownSignInButton: {
    borderRadius: 999,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cooldownSignInText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 16,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 16,
  },
  loginText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  loginLink: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  bottomPadding: {
    height: 40,
  },
  verificationContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  verificationIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  verificationTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const,
    marginBottom: 8,
    textAlign: 'center',
  },
  verificationSubtitle: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  verificationTarget: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 28,
    textAlign: 'center',
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
    width: '100%',
  },
  codeInput: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    textAlign: 'center' as const,
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700' as const,
  },
  codeInputFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  resendButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  resendText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  resendTextDisabled: {
    color: Colors.textTertiary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '15',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 16,
  },
  verifiedText: {
    color: Colors.success,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  completeContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  completeIcon: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: Colors.success + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  completeTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800' as const,
    marginBottom: 8,
    textAlign: 'center',
  },
  completeSubtitle: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '500' as const,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  verificationStatus: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  statusTextPending: {
    color: '#FF9800',
    fontSize: 14,
    fontWeight: '500' as const,
  },
  pendingIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF9800' + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingIconText: {
    color: '#FF9800',
    fontSize: 12,
    fontWeight: '800' as const,
  },
  secondaryButton: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    width: '100%',
  },
  secondaryButtonText: {
    color: Colors.text,
    fontWeight: '600' as const,
    fontSize: 16,
  },
  countryText: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    color: Colors.text,
    fontSize: 16,
  },
  dialCode: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '600' as const,
    marginLeft: 4,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
  },
  modalCloseButton: {
    padding: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  countryList: {
    flex: 1,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  countryItemName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500' as const,
  },
  countryItemDialCode: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
