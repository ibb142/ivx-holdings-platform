import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Animated,
  Dimensions} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Send,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Phone,
  FileText,
  Zap,
  Building2,
  UserCheck,
  Shield,
  Bell,
  DollarSign,
  Clock} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useMutation } from '@tanstack/react-query';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SMSTemplate {
  id: string;
  name: string;
  category: string;
  icon: React.ReactNode;
  iconColor: string;
  message: string;
  description: string;
}

const SMS_TEMPLATES: SMSTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome Investor',
    category: 'Onboarding',
    icon: <UserCheck size={18} color="#00C48C" strokeWidth={1.8} />,
    iconColor: '#00C48C',
    message: `Welcome to IVX Holdings! Your account is now active. Access your investor portal at https://ivxholding.com to explore premium real estate opportunities.\n\nIVX Holdings Ltd.\ninvestors@ivxholding.com`,
    description: 'New investor welcome message'},
  {
    id: 'kyc_approved',
    name: 'KYC Approved',
    category: 'Compliance',
    icon: <Shield size={18} color="#4A90D9" strokeWidth={1.8} />,
    iconColor: '#4A90D9',
    message: `IVX Holdings: Your KYC verification is complete. You are now approved to invest in our Joint Venture opportunities. Log in to view available deals.\n\nhttps://ivxholding.com\nIVX Holdings Ltd.`,
    description: 'KYC verification approved notification'},
  {
    id: 'kyc_pending',
    name: 'KYC Pending',
    category: 'Compliance',
    icon: <Clock size={18} color="#FFB800" strokeWidth={1.8} />,
    iconColor: '#FFB800',
    message: `IVX Holdings: Your KYC verification is under review. We will notify you once approved. Please ensure all documents are submitted.\n\nQuestions? Contact support@ivxholding.com\nIVX Holdings Ltd.`,
    description: 'KYC verification pending notice'},
  {
    id: 'new_deal',
    name: 'New JV Opportunity',
    category: 'Deals',
    icon: <Building2 size={18} color="#FFD700" strokeWidth={1.8} />,
    iconColor: '#FFD700',
    message: `IVX Holdings: A new Joint Venture opportunity is now available! Limited shares remaining. View details and invest at https://ivxholding.com\n\nIVX Holdings Ltd.\ninvestors@ivxholding.com`,
    description: 'New deal announcement'},
  {
    id: 'investment_confirmed',
    name: 'Investment Confirmed',
    category: 'Transactions',
    icon: <DollarSign size={18} color="#00C48C" strokeWidth={1.8} />,
    iconColor: '#00C48C',
    message: `IVX Holdings: Your investment has been confirmed and processed. You will receive a detailed confirmation via email. Track your portfolio at https://ivxholding.com\n\nIVX Holdings Ltd.`,
    description: 'Investment confirmation notice'},
  {
    id: 'dividend_payout',
    name: 'Dividend Payout',
    category: 'Transactions',
    icon: <DollarSign size={18} color="#2ECC71" strokeWidth={1.8} />,
    iconColor: '#2ECC71',
    message: `IVX Holdings: A dividend payout has been processed to your account. Check your wallet for details at https://ivxholding.com\n\nIVX Holdings Ltd.`,
    description: 'Dividend distribution notification'},
  {
    id: 'security_alert',
    name: 'Security Alert',
    category: 'Security',
    icon: <Shield size={18} color="#FF4D4D" strokeWidth={1.8} />,
    iconColor: '#FF4D4D',
    message: `IVX Holdings Security Alert: A new login was detected on your account. If this wasn't you, please contact support immediately at support@ivxholding.com.\n\nIVX Holdings Ltd.`,
    description: 'Account security notification'},
  {
    id: 'reminder',
    name: 'General Reminder',
    category: 'General',
    icon: <Bell size={18} color="#9B59B6" strokeWidth={1.8} />,
    iconColor: '#9B59B6',
    message: `IVX Holdings Reminder: You have pending actions on your account. Please log in to review at https://ivxholding.com\n\nIVX Holdings Ltd.`,
    description: 'General account reminder'},
];

const TEMPLATE_CATEGORIES = ['All', 'Onboarding', 'Compliance', 'Deals', 'Transactions', 'Security', 'General'];

type SendStatus = 'idle' | 'sending' | 'success' | 'error';

export default function SMSComposeScreen() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [senderId, setSenderId] = useState('IVXHolding');
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [resultMessage, setResultMessage] = useState('');
  const [charCount, setCharCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const templateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true}).start();
  }, [fadeAnim]);

  useEffect(() => {
    Animated.timing(templateAnim, {
      toValue: showTemplates ? 1 : 0,
      duration: 300,
      useNativeDriver: false}).start();
  }, [showTemplates, templateAnim]);

  useEffect(() => {
    if (sendStatus === 'sending') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [sendStatus, pulseAnim]);

  const handleMessageChange = useCallback((text: string) => {
    if (text.length <= 1600) {
      setMessage(text);
      setCharCount(text.length);
    }
  }, []);

  const phoneValidation = useMemo(() => {
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    if (!cleaned) return { valid: false, error: '', formatted: '' };
    let formatted = cleaned;
    if (!formatted.startsWith('+')) {
      formatted = '+1' + formatted;
    }
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(formatted)) {
      return { valid: false, error: 'Use E.164 format (e.g., +15551234567)', formatted };
    }
    return { valid: true, error: '', formatted };
  }, [phoneNumber]);

  const canSend = useMemo(() => {
    return phoneValidation.valid && message.trim().length > 0 && message.length <= 1600;
  }, [phoneValidation.valid, message]);

  const smsSegments = useMemo(() => {
    if (!message) return 0;
    const len = message.length;
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }, [message]);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === 'All') return SMS_TEMPLATES;
    return SMS_TEMPLATES.filter(t => t.category === selectedCategory);
  }, [selectedCategory]);

  const sendSmsMutation = useMutation({
    mutationFn: async (payload: { phoneNumber: string; message: string; senderId: string }) => {
      const apiBase = getDirectApiBaseUrl() || (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
      if (!apiBase) {
        throw new Error('API base URL not configured.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      console.log('[SMSCompose] Sending to:', payload.phoneNumber, '| Length:', payload.message.length, '| SenderID:', payload.senderId);

      const res = await fetch(`${apiBase}/api/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})},
        body: JSON.stringify(payload)});

      const data = await res.json();
      console.log('[SMSCompose] Response:', JSON.stringify(data));

      if (!data.success) {
        const errorMsg = data.error || 'Unknown error';
        const fixSteps = data.fix ? '\n\n' + (Array.isArray(data.fix) ? data.fix.join('\n') : data.fix) : '';
        throw new Error(errorMsg + fixSteps);
      }

      return data;
    },
    onSuccess: (data) => {
      setSendStatus('success');
      setResultMessage(`Delivered via AWS SNS\nMessage ID: ${data.messageId || 'N/A'}\nRegion: ${data.region || 'N/A'}`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error: Error) => {
      setSendStatus('error');
      setResultMessage(error.message);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }});

  const handleSend = useCallback(() => {
    if (!canSend || sendSmsMutation.isPending) return;

    setSendStatus('sending');
    setResultMessage('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    sendSmsMutation.mutate({
      phoneNumber: phoneValidation.formatted,
      message,
      senderId});
  }, [canSend, sendSmsMutation, phoneValidation.formatted, message, senderId]);

  const handleSelectTemplate = useCallback((template: SMSTemplate) => {
    setMessage(template.message);
    setCharCount(template.message.length);
    setShowTemplates(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleReset = useCallback(() => {
    setSendStatus('idle');
    setResultMessage('');
    setPhoneNumber('');
    setMessage('');
    setCharCount(0);
  }, []);

  const templateHeight = templateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 340]});

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="compose-back">
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <MessageSquare size={18} color={Colors.success} strokeWidth={1.8} />
            <Text style={styles.headerTitle}>Compose SMS</Text>
          </View>
          <TouchableOpacity
            style={[styles.templateToggle, showTemplates && styles.templateToggleActive]}
            onPress={() => {
              setShowTemplates(!showTemplates);
              if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            testID="toggle-templates"
          >
            <FileText size={18} color={showTemplates ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={{ opacity: fadeAnim }}>
              <Animated.View style={[styles.templatesContainer, { maxHeight: templateHeight, overflow: 'hidden' as const }]}>
                {showTemplates && (
                  <View style={styles.templatesInner}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.categoryScroll}
                    >
                      {TEMPLATE_CATEGORIES.map(cat => (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
                          onPress={() => setSelectedCategory(cat)}
                        >
                          <Text style={[styles.categoryText, selectedCategory === cat && styles.categoryTextActive]}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.templateCards}
                    >
                      {filteredTemplates.map(template => (
                        <TouchableOpacity
                          key={template.id}
                          style={styles.templateCard}
                          onPress={() => handleSelectTemplate(template)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.templateIconBox, { backgroundColor: template.iconColor + '15' }]}>
                            {template.icon}
                          </View>
                          <Text style={styles.templateName} numberOfLines={1}>{template.name}</Text>
                          <Text style={styles.templateDesc} numberOfLines={2}>{template.description}</Text>
                          <Text style={styles.templateCategory}>{template.category}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </Animated.View>

              <View style={styles.fieldCard}>
                <View style={styles.fieldRow}>
                  <Phone size={16} color={Colors.success} strokeWidth={1.8} />
                  <Text style={styles.fieldLabel}>To</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="+1 (555) 123-4567"
                    placeholderTextColor={Colors.inputPlaceholder}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    testID="sms-phone"
                  />
                </View>
                {phoneValidation.error ? (
                  <Text style={styles.fieldError}>{phoneValidation.error}</Text>
                ) : phoneValidation.valid ? (
                  <Text style={styles.fieldSuccess}>{phoneValidation.formatted}</Text>
                ) : null}

                <View style={styles.divider} />

                <View style={styles.fieldRow}>
                  <Zap size={16} color={Colors.primary} strokeWidth={1.8} />
                  <Text style={styles.fieldLabel}>Sender ID</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={senderId}
                    onChangeText={(t) => setSenderId(t.substring(0, 11))}
                    placeholder="IVXHolding"
                    placeholderTextColor={Colors.inputPlaceholder}
                    autoCorrect={false}
                    maxLength={11}
                    testID="sms-sender"
                  />
                </View>
                <Text style={styles.senderNote}>Max 11 alphanumeric characters</Text>
              </View>

              <View style={styles.messageCard}>
                <View style={styles.messageHeader}>
                  <MessageSquare size={14} color={Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={styles.messageLabel}>Message</Text>
                  <View style={styles.messageStats}>
                    <Text style={[
                      styles.charCounter,
                      charCount > 1500 && { color: Colors.warning },
                      charCount > 1590 && { color: Colors.error },
                    ]}>
                      {charCount}/1600
                    </Text>
                    <View style={styles.segmentBadge}>
                      <Text style={styles.segmentText}>
                        {smsSegments} {smsSegments === 1 ? 'segment' : 'segments'}
                      </Text>
                    </View>
                  </View>
                </View>
                <TextInput
                  style={styles.messageInput}
                  value={message}
                  onChangeText={handleMessageChange}
                  placeholder="Type your message or select a template..."
                  placeholderTextColor={Colors.inputPlaceholder}
                  multiline
                  textAlignVertical="top"
                  testID="sms-message"
                />
              </View>

              {sendStatus !== 'idle' && sendStatus !== 'sending' && (
                <View style={[
                  styles.resultCard,
                  sendStatus === 'success' ? styles.resultSuccess : styles.resultError,
                ]}>
                  {sendStatus === 'success' ? (
                    <CheckCircle size={36} color={Colors.success} strokeWidth={1.5} />
                  ) : (
                    <AlertTriangle size={36} color={Colors.warning} strokeWidth={1.5} />
                  )}
                  <Text style={styles.resultTitle}>
                    {sendStatus === 'success' ? 'SMS Delivered' : 'Delivery Issue'}
                  </Text>
                  <Text style={styles.resultMessage}>{resultMessage}</Text>
                  {sendStatus === 'success' && (
                    <TouchableOpacity style={styles.newMessageBtn} onPress={handleReset}>
                      <Text style={styles.newMessageText}>New Message</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerInfo}>
              <Text style={styles.footerProvider}>AWS SNS</Text>
              <View style={styles.footerDot} />
              <Text style={styles.footerEncryption}>SigV4 Signed</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.sendBtn,
                !canSend && styles.sendBtnDisabled,
                sendSmsMutation.isPending && styles.sendBtnSending,
              ]}
              onPress={handleSend}
              disabled={!canSend || sendSmsMutation.isPending}
              activeOpacity={0.8}
              testID="send-sms"
            >
              <Animated.View style={[styles.sendBtnInner, { opacity: sendSmsMutation.isPending ? pulseAnim : 1 }]}>
                {sendSmsMutation.isPending ? (
                  <ShimmerIndicator size="small" color={Colors.background} />
                ) : (
                  <Send size={18} color={canSend ? Colors.background : Colors.textTertiary} strokeWidth={2} />
                )}
                <Text style={[styles.sendBtnText, !canSend && styles.sendBtnTextDisabled]}>
                  {sendSmsMutation.isPending ? 'Sending...' : sendStatus === 'success' || sendStatus === 'error' ? 'Send Again' : 'Send SMS'}
                </Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  headerCenter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: 0.3},
  templateToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'transparent'},
  templateToggleActive: {
    borderColor: Colors.primary + '60',
    backgroundColor: Colors.primary + '10'},
  body: {
    flex: 1},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 20},
  templatesContainer: {},
  templatesInner: {
    marginBottom: 16},
  categoryScroll: {
    gap: 6,
    paddingBottom: 10},
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  categoryChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary + '50'},
  categoryText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary},
  categoryTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const},
  templateCards: {
    gap: 10,
    paddingBottom: 4},
  templateCard: {
    width: SCREEN_WIDTH * 0.38,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 6},
  templateIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 2},
  templateName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  templateDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 15},
  templateCategory: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginTop: 2},
  fieldCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 12},
  fieldRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10},
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textTertiary,
    width: 70},
  fieldInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 4},
  fieldError: {
    fontSize: 11,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 26},
  fieldSuccess: {
    fontSize: 11,
    color: Colors.success,
    marginTop: 4,
    marginLeft: 26},
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12},
  senderNote: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    marginLeft: 26},
  messageCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 12},
  messageHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8},
  messageLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    flex: 1},
  messageStats: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  charCounter: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontVariant: ['tabular-nums'] as any},
  segmentBadge: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2},
  segmentText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  messageInput: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingBottom: 16,
    minHeight: 160},
  resultCard: {
    borderRadius: 14,
    padding: 24,
    alignItems: 'center' as const,
    gap: 10,
    borderWidth: 1,
    marginBottom: 12},
  resultSuccess: {
    backgroundColor: 'rgba(0, 196, 140, 0.08)',
    borderColor: 'rgba(0, 196, 140, 0.2)'},
  resultError: {
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderColor: 'rgba(255, 184, 0, 0.2)'},
  resultTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text},
  resultMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20},
  newMessageBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  newMessageText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary},
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10},
  footerInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8},
  footerProvider: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    letterSpacing: 0.5},
  footerDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.textTertiary},
  footerEncryption: {
    fontSize: 10,
    color: Colors.textTertiary,
    letterSpacing: 0.5},
  sendBtn: {
    backgroundColor: Colors.success,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  sendBtnDisabled: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  sendBtnSending: {
    backgroundColor: Colors.success,
    opacity: 0.9},
  sendBtnInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10},
  sendBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.background},
  sendBtnTextDisabled: {
    color: Colors.textTertiary}});
