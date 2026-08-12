import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  Alert,
  Platform,
  Keyboard,
  Dimensions,
  KeyboardAvoidingView} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoClipboard from 'expo-clipboard';
let CameraView: any = null;
let useCameraPermissions: any = () => [null, () => {}];
if (Platform.OS !== 'web') {
  try {
    const cam = require('expo-camera');
    CameraView = cam.CameraView;
    useCameraPermissions = cam.useCameraPermissions;
  } catch {
    console.log('[Authenticator] expo-camera not available');
  }
}
import {
  Shield,
  Plus,
  ChevronLeft,
  Clock,
  Lock,
  ScanLine,
  Camera,
  Keyboard as KeyboardIcon,
  Check,
  ArrowLeft} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';
import { generateTOTP, getTimeRemaining, parseOtpAuthUri } from '@/lib/totp';

const STORAGE_KEY = 'authenticator_accounts';

interface AuthAccount {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  createdAt: number;
}

function CodeCard({
  account,
  onTapCopy,
  onDelete}: {
  account: AuthAccount;
  onTapCopy: (code: string, issuer: string) => void;
  onDelete: (id: string) => void;
}) {
  const [code, setCode] = useState<string>('');
  const [remaining, setRemaining] = useState<number>(30);
  const [copied, setCopied] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const copyFlash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const update = () => {
      const newCode = generateTOTP(account.secret);
      const newRemaining = getTimeRemaining();
      setCode(newCode);
      setRemaining(newRemaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [account.secret]);

  useEffect(() => {
    if (remaining === 30) {
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 120, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    }
  }, [remaining, pulseAnim]);

  const formattedCode = code ? `${code.slice(0, 3)} ${code.slice(3)}` : '--- ---';
  const progress = remaining / 30;
  const isLow = remaining <= 5;

  const handleTap = useCallback(() => {
    onTapCopy(code, account.issuer);
    setCopied(true);
    Animated.sequence([
      Animated.timing(copyFlash, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(copyFlash, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start(() => setCopied(false));
  }, [code, account.issuer, onTapCopy, copyFlash]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Remove Account',
      `Remove ${account.issuer}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onDelete(account.id) },
      ]
    );
  }, [account, onDelete]);

  const issuerColors = useMemo(() => {
    const hues = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
    return hues[account.issuer.length % hues.length];
  }, [account.issuer]);

  const initial = (account.issuer || '?')[0].toUpperCase();

  return (
    <Animated.View style={[cardStyles.container, { transform: [{ scale: pulseAnim }] }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handleTap}
        onLongPress={handleDelete}
        testID={`code-card-${account.id}`}
      >
        <View style={cardStyles.topRow}>
          <View style={cardStyles.issuerRow}>
            <View style={[cardStyles.avatar, { backgroundColor: issuerColors + '20' }]}>
              <Text style={[cardStyles.avatarText, { color: issuerColors }]}>{initial}</Text>
            </View>
            <View style={cardStyles.issuerInfo}>
              <Text style={cardStyles.issuer} numberOfLines={1}>{account.issuer}</Text>
              <Text style={cardStyles.account} numberOfLines={1}>{account.account}</Text>
            </View>
          </View>
          <View style={cardStyles.timerWrap}>
            <View style={cardStyles.timerTrack}>
              <View style={[
                cardStyles.timerFill,
                {
                  width: `${progress * 100}%` as any,
                  backgroundColor: isLow ? Colors.error : Colors.primary},
              ]} />
            </View>
            <Text style={[cardStyles.timerText, isLow && { color: Colors.error }]}>{remaining}s</Text>
          </View>
        </View>

        <View style={cardStyles.codeRow}>
          <Text style={[cardStyles.code, isLow && { color: Colors.error }]}>
            {formattedCode}
          </Text>
          {copied ? (
            <Animated.View style={[cardStyles.copiedBadge, { opacity: copyFlash }]}>
              <Check size={12} color={Colors.background} />
              <Text style={cardStyles.copiedText}>Copied</Text>
            </Animated.View>
          ) : (
            <Text style={cardStyles.tapHint}>Tap to copy</Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14},
  issuerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12},
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  avatarText: {
    fontSize: 15,
    fontWeight: '700' as const},
  issuerInfo: {
    marginLeft: 10,
    flex: 1},
  issuer: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const},
  account: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 1},
  timerWrap: {
    alignItems: 'flex-end',
    gap: 4},
  timerTrack: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  timerFill: {
    height: 4,
    borderRadius: 2},
  timerText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    fontVariant: ['tabular-nums'] as any},
  codeRow: {
    alignItems: 'center',
    paddingVertical: 4},
  code: {
    fontSize: 38,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 6,
    fontVariant: ['tabular-nums'] as any},
  tapHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 6},
  copiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6},
  copiedText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.background}});

function AddAccountScreen({
  onAdd,
  onClose}: {
  onAdd: (account: AuthAccount) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'scan' | 'manual' | 'paste'>(
    Platform.OS === 'web' ? 'paste' : 'scan'
  );
  const [pasteUri, setPasteUri] = useState('');
  const [issuer, setIssuer] = useState('');
  const [accountName, setAccountName] = useState('');
  const [secret, setSecret] = useState('');
  const [scannedOnce, setScannedOnce] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const accountRef = useRef<TextInput>(null);
  const secretRef = useRef<TextInput>(null);
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').width)).current;
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11}).start();
  }, [slideAnim]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const onShow = () => {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 150);
    };
    const sub1 = Keyboard.addListener(showEvent, onShow);
    return () => {
      sub1.remove();
    };
  }, []);

  const animateOut = useCallback((cb: () => void) => {
    Keyboard.dismiss();
    Animated.timing(slideAnim, {
      toValue: Dimensions.get('window').width,
      duration: 250,
      useNativeDriver: true}).start(cb);
  }, [slideAnim]);

  const handleClose = useCallback(() => {
    animateOut(onClose);
  }, [animateOut, onClose]);

  const handleBarcodeScanned = useCallback((result: { data: string; type?: string }) => {
    if (scannedOnce) return;
    setScannedOnce(true);

    const raw = result.data || '';
    console.log('[Authenticator] Scanned raw data:', JSON.stringify(raw));

    const parsed = parseOtpAuthUri(raw);
    if (parsed) {
      onAdd({
        id: Date.now().toString(),
        issuer: parsed.issuer,
        account: parsed.account,
        secret: parsed.secret,
        createdAt: Date.now()});
    } else {
      Alert.alert(
        'Invalid QR',
        `Could not parse QR code.\n\nScanned: ${raw.substring(0, 80)}${raw.length > 80 ? '...' : ''}`,
        [
          { text: 'Retry', onPress: () => setScannedOnce(false) },
          { text: 'Enter Manually', onPress: () => { setMode('manual'); setScannedOnce(false); } },
        ]
      );
    }
  }, [scannedOnce, onAdd]);

  const handleManualAdd = useCallback(() => {
    Keyboard.dismiss();
    const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
    if (!cleanSecret || cleanSecret.length < 16) {
      Alert.alert('Invalid Secret', 'Enter a valid Base32 secret key (16+ characters).');
      return;
    }
    if (!accountName.trim()) {
      Alert.alert('Missing Account', 'Enter an account name or email.');
      return;
    }
    onAdd({
      id: Date.now().toString(),
      issuer: issuer.trim() || 'Unknown',
      account: accountName.trim(),
      secret: cleanSecret,
      createdAt: Date.now()});
  }, [secret, accountName, issuer, onAdd]);

  const handlePasteUri = useCallback(() => {
    Keyboard.dismiss();
    const trimmed = pasteUri.trim();
    if (!trimmed) {
      Alert.alert('Empty', 'Please paste an otpauth:// URI.');
      return;
    }
    const parsed = parseOtpAuthUri(trimmed);
    if (parsed) {
      onAdd({
        id: Date.now().toString(),
        issuer: parsed.issuer,
        account: parsed.account,
        secret: parsed.secret,
        createdAt: Date.now()});
    } else {
      Alert.alert('Invalid URI', 'Not a valid otpauth:// URI. Make sure you copied the full link.');
    }
  }, [pasteUri, onAdd]);

  const handleInputFocus = useCallback((e?: any) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 500);
    if (Platform.OS === 'web' && e?.target) {
      setTimeout(() => {
        try { e.target.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch {}
      }, 300);
    }
  }, []);

  return (
    <Animated.View
      style={[
        styles.addScreen,
        { transform: [{ translateX: slideAnim }] },
      ]}
    >
      <View style={[styles.addHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.addBackBtn}
          onPress={handleClose}
          activeOpacity={0.7}
          testID="add-back"
        >
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.addHeaderTitle}>Add Account</Text>
        <TouchableOpacity
          style={styles.addBackBtn}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.modeRow}>
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'scan' && styles.modeBtnActive]}
            onPress={() => { setMode('scan'); setScannedOnce(false); Keyboard.dismiss(); }}
            activeOpacity={0.7}
          >
            <ScanLine size={15} color={mode === 'scan' ? Colors.background : Colors.textSecondary} />
            <Text style={[styles.modeBtnText, mode === 'scan' && styles.modeBtnTextActive]}>Scan QR</Text>
          </TouchableOpacity>
        )}
        {Platform.OS === 'web' && (
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'paste' && styles.modeBtnActive]}
            onPress={() => setMode('paste')}
            activeOpacity={0.7}
          >
            <ScanLine size={15} color={mode === 'paste' ? Colors.background : Colors.textSecondary} />
            <Text style={[styles.modeBtnText, mode === 'paste' && styles.modeBtnTextActive]}>Paste URI</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'manual' && styles.modeBtnActive]}
          onPress={() => setMode('manual')}
          activeOpacity={0.7}
        >
          <KeyboardIcon size={15} color={mode === 'manual' ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.modeBtnText, mode === 'manual' && styles.modeBtnTextActive]}>Enter Key</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.addBody}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 120 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.addBodyContent,
            { paddingBottom: insets.bottom + 160 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {mode === 'paste' ? (
            <>
              <Text style={styles.formLabel}>Paste the otpauth:// URI from your 2FA setup:</Text>
              <TextInput
                style={[styles.input, styles.pasteInput]}
                placeholder="otpauth://totp/Service:user@email.com?secret=..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={pasteUri}
                onChangeText={setPasteUri}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                onFocus={(e) => handleInputFocus(e)}
                testID="input-paste-uri"
              />
              <Text style={styles.formHint}>
                You can find this URI in your service's 2FA setup page. Some services show it as "Can't scan the QR code?" link.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handlePasteUri}
                activeOpacity={0.8}
                testID="confirm-paste"
              >
                <Text style={styles.primaryBtnText}>Add Account</Text>
              </TouchableOpacity>
            </>
          ) : mode === 'scan' && Platform.OS !== 'web' ? (
            <>
              {!permission?.granted ? (
                <View style={styles.camPrompt}>
                  <Camera size={40} color={Colors.primary} />
                  <Text style={styles.camPromptTitle}>Allow Camera</Text>
                  <Text style={styles.camPromptDesc}>Needed to scan QR codes</Text>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => requestPermission()}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryBtnText}>Allow Camera</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.scanWrap}>
                  <View style={styles.cameraBox}>
                    <CameraView
                      style={styles.camera}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={scannedOnce ? undefined : handleBarcodeScanned}
                    />
                    <View style={styles.scanFrame}>
                      <View style={[styles.corner, styles.cornerTL]} />
                      <View style={[styles.corner, styles.cornerTR]} />
                      <View style={[styles.corner, styles.cornerBL]} />
                      <View style={[styles.corner, styles.cornerBR]} />
                    </View>
                  </View>
                  <Text style={styles.scanHint}>
                    Point at the QR code from your 2FA setup
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.formLabel}>Enter details from your 2FA setup</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Service Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Amazon, Google, GitHub"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={issuer}
                  onChangeText={setIssuer}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onFocus={(e) => handleInputFocus(e)}
                  onSubmitEditing={() => accountRef.current?.focus()}
                  testID="input-issuer"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Account / Email</Text>
                <TextInput
                  ref={accountRef}
                  style={styles.input}
                  placeholder="user@example.com"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={accountName}
                  onChangeText={setAccountName}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onFocus={(e) => handleInputFocus(e)}
                  onSubmitEditing={() => secretRef.current?.focus()}
                  testID="input-account"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Secret Key (Base32)</Text>
                <TextInput
                  ref={secretRef}
                  style={styles.input}
                  placeholder="JBSWY3DPEHPK3PXP"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={secret}
                  onChangeText={setSecret}
                  autoCapitalize="characters"
                  returnKeyType="done"
                  onFocus={(e) => handleInputFocus(e)}
                  onSubmitEditing={handleManualAdd}
                  testID="input-secret"
                />
              </View>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleManualAdd}
                activeOpacity={0.8}
                testID="confirm-add"
              >
                <Text style={styles.primaryBtnText}>Add Account</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

export default function AuthenticatorScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void loadAccounts();
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const loadAccounts = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setAccounts(JSON.parse(stored));
        console.log('[Authenticator] Loaded accounts:', JSON.parse(stored).length);
      }
    } catch (e) {
      console.error('[Authenticator] Load error:', e);
    }
  };

  const handleAddAccount = useCallback((newAcc: AuthAccount) => {
    setAccounts((prev) => {
      const updated = [newAcc, ...prev];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).then(() => {
        console.log('[Authenticator] Saved accounts:', updated.length);
      }).catch((e) => {
        console.error('[Authenticator] Save error:', e);
      });
      return updated;
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowAdd(false);
  }, []);

  const handleDeleteAccount = useCallback((id: string) => {
    setAccounts((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).then(() => {
        console.log('[Authenticator] Saved accounts after delete:', updated.length);
      }).catch((e) => {
        console.error('[Authenticator] Save error:', e);
      });
      return updated;
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const handleCopyCode = useCallback(async (code: string, _issuer: string) => {
    try {
      await ExpoClipboard.setStringAsync(code);
    } catch {}
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            testID="auth-back"
          >
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Shield size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>Authenticator</Text>
          </View>
          <TouchableOpacity
            style={styles.addHeaderBtn}
            onPress={() => setShowAdd(true)}
            activeOpacity={0.7}
            testID="add-account"
          >
            <Plus size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {accounts.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Lock size={44} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>No Accounts</Text>
              <Text style={styles.emptyDesc}>
                Scan a QR code or enter a key to add your 2FA accounts.
              </Text>
              <TouchableOpacity
                style={styles.emptyAddBtn}
                onPress={() => setShowAdd(true)}
                activeOpacity={0.8}
              >
                <Plus size={18} color={Colors.background} />
                <Text style={styles.emptyAddText}>Add Account</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              <View style={styles.countRow}>
                <Clock size={13} color={Colors.textTertiary} />
                <Text style={styles.countText}>
                  {accounts.length} account{accounts.length !== 1 ? 's' : ''} · tap code to copy
                </Text>
              </View>
              {accounts.map((acc) => (
                <CodeCard
                  key={acc.id}
                  account={acc}
                  onTapCopy={handleCopyCode}
                  onDelete={handleDeleteAccount}
                />
              ))}
              <Text style={styles.longPressHint}>Long press a card to remove it</Text>
            </ScrollView>
          )}
        </Animated.View>
      </SafeAreaView>

      {showAdd && (
        <AddAccountScreen
          onAdd={handleAddAccount}
          onClose={() => setShowAdd(false)}
        />
      )}
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  addHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  content: {
    flex: 1},
  list: {
    padding: 16,
    paddingBottom: 40},
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14},
  countText: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  longPressHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 8},
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40},
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20},
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8},
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28},
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14},
  emptyAddText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.background},
  addScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
    zIndex: 200},
  addHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  addBackBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'},
  addHeaderTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  modeRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    padding: 3,
    marginTop: 16,
    marginBottom: 8},
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10},
  modeBtnActive: {
    backgroundColor: Colors.primary},
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  modeBtnTextActive: {
    color: Colors.background},
  addBody: {
    flex: 1},
  addBodyContent: {
    paddingHorizontal: 20,
    paddingTop: 20},
  formLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 16},
  inputGroup: {
    marginBottom: 16},
  inputLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 6},
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: Colors.text},
  pasteInput: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
    marginBottom: 12},
  formHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17,
    marginBottom: 16},
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8},
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.background},
  scanWrap: {
    alignItems: 'center',
    paddingVertical: 8},
  cameraBox: {
    width: 260,
    height: 260,
    borderRadius: 20,
    overflow: 'hidden'},
  camera: {
    flex: 1},
  scanFrame: {
    ...StyleSheet.absoluteFillObject},
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE},
  cornerTL: {
    top: 24,
    left: 24,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: Colors.primary,
    borderTopLeftRadius: 4},
  cornerTR: {
    top: 24,
    right: 24,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: Colors.primary,
    borderTopRightRadius: 4},
  cornerBL: {
    bottom: 24,
    left: 24,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: Colors.primary,
    borderBottomLeftRadius: 4},
  cornerBR: {
    bottom: 24,
    right: 24,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: Colors.primary,
    borderBottomRightRadius: 4},
  scanHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 16},
  camPrompt: {
    alignItems: 'center',
    paddingVertical: 32},
  camPromptTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 12,
    marginBottom: 4},
  camPromptDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 20},
  closeText: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontWeight: '500' as const}});
