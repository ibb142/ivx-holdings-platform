import React, { useState, useCallback, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Send,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Building2,
  Globe,
  MapPin,
  Shield,
  Smartphone,
  Zap} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const TEST_PHONE = '';
const TEST_PHONE_DISPLAY = 'No test phone configured';

const BRANDED_SMS_MESSAGE = `IVX Holdings Ltd. — Enterprise SMS System Test

This is an official test message from IVX Holdings, confirming our AWS SNS messaging infrastructure is fully operational.

IVX Holdings Ltd.
Global Real Estate Investment Platform
1001 Brickell Bay Drive, Suite 2700
Miami, FL 33131
https://ivxholding.com
investors@ivxholding.com

Powered by AWS SNS | Enterprise-Grade Delivery`;

type SendStatus = 'idle' | 'sending' | 'success' | 'error';

export default function SendTestSMSScreen() {
  const router = useRouter();

  const [status, setStatus] = useState<SendStatus>('idle');
  const [resultMessage, setResultMessage] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [snsStatus, setSnsStatus] = useState<{ configured: boolean; region?: string; status?: string } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true}),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true}),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (status === 'sending') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  useEffect(() => {
    const checkSNS = async () => {
      try {
        const apiBase = getDirectApiBaseUrl() || (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
        if (!apiBase) {
          console.log('[TestSMS] No API base URL configured');
          return;
        }
        const res = await fetch(`${apiBase}/api/sns-status`, {
          headers: { 'Content-Type': 'application/json' }});
        if (res.ok) {
          const data = await res.json();
          setSnsStatus(data);
          console.log('[TestSMS] SNS status:', JSON.stringify(data));
        }
      } catch (err) {
        console.log('[TestSMS] SNS status check failed:', (err as Error)?.message);
      }
    };
    void checkSNS();
  }, []);

  const handleSend = useCallback(async () => {
    if (status === 'sending') return;

    setStatus('sending');
    setResultMessage('');
    setDeliveryStatus('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[TestSMS] Test SMS send requested');

    if (!TEST_PHONE) {
      setStatus('error');
      setDeliveryStatus('No recipient configured');
      setResultMessage('Test SMS recipient phone has been removed. Configure a new recipient before sending.');
      return;
    }

    try {
      const apiBase = getDirectApiBaseUrl() || (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
      if (!apiBase) {
        throw new Error('API base URL not configured. Set EXPO_PUBLIC_API_BASE_URL.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      console.log('[TestSMS] API base:', apiBase, '| Has token:', !!token);

      const res = await fetch(`${apiBase}/api/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})},
        body: JSON.stringify({
          phoneNumber: TEST_PHONE,
          message: BRANDED_SMS_MESSAGE,
          senderId: 'IVXHolding'})});

      const data = await res.json();
      console.log('[TestSMS] Response:', JSON.stringify(data));

      if (data.success) {
        setStatus('success');
        setDeliveryStatus('Delivered via AWS SNS');
        setResultMessage(`SMS sent successfully!\nMessage ID: ${data.messageId || 'N/A'}\nProvider: ${data.provider || 'AWS SNS'}\nRegion: ${data.region || 'N/A'}`);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus('error');
        setDeliveryStatus('Failed');
        const errorMsg = data.error || 'Unknown error';
        const fixSteps = data.fix ? '\n\n' + (Array.isArray(data.fix) ? data.fix.join('\n') : data.fix) : '';
        setResultMessage(errorMsg + fixSteps);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: unknown) {
      setStatus('error');
      setDeliveryStatus('Exception');
      setResultMessage((err as Error)?.message || 'Failed to send SMS.');
      console.error('[TestSMS] Exception:', err);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [status]);

  const statusIcon = status === 'success'
    ? <CheckCircle size={48} color={Colors.success} strokeWidth={1.5} />
    : status === 'error'
    ? <AlertTriangle size={48} color={Colors.warning} strokeWidth={1.5} />
    : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="back-button">
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Send Test SMS</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
          <Animated.View style={[styles.brandCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.brandHeader}>
              <View style={styles.logoContainer}>
                <Text style={styles.logoIvx}>IVX</Text>
                <Text style={styles.logoHoldings}> HOLDINGS</Text>
              </View>
              <Text style={styles.brandSubtitle}>Enterprise SMS System</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailSection}>
              <View style={styles.detailRow}>
                <Smartphone size={16} color={Colors.success} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Recipient</Text>
                  <Text style={styles.detailValue}>{TEST_PHONE_DISPLAY}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <MessageSquare size={16} color={Colors.accent} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Message Type</Text>
                  <Text style={styles.detailValue}>Branded Enterprise Test</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Zap size={16} color={Colors.primary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Provider</Text>
                  <Text style={styles.detailValue}>Amazon Web Services (SNS)</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Building2 size={16} color={Colors.textSecondary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Company</Text>
                  <Text style={styles.detailValue}>IVX Holdings Ltd.</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <MapPin size={16} color={Colors.textSecondary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Headquarters</Text>
                  <Text style={styles.detailValue}>1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Globe size={16} color={Colors.textSecondary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Website</Text>
                  <Text style={styles.detailValue}>https://ivxholding.com</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Shield size={16} color={Colors.success} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Security</Text>
                  <Text style={styles.detailValue}>AWS SigV4 Signed, Transactional Priority</Text>
                </View>
              </View>
            </View>

            {snsStatus && (
              <>
                <View style={styles.divider} />
                <View style={styles.snsStatusRow}>
                  <View style={[styles.snsIndicator, { backgroundColor: snsStatus.configured ? Colors.success : Colors.error }]} />
                  <Text style={styles.snsStatusText}>
                    SNS {snsStatus.configured ? 'Connected' : 'Not Configured'}{snsStatus.region ? ` (${snsStatus.region})` : ''}
                  </Text>
                </View>
              </>
            )}
          </Animated.View>

          <Animated.View style={[styles.messagePreview, { opacity: fadeAnim }]}>
            <Text style={styles.previewLabel}>MESSAGE PREVIEW</Text>
            <View style={styles.messageBubble}>
              <Text style={styles.messageText}>{BRANDED_SMS_MESSAGE}</Text>
            </View>
          </Animated.View>

          {status !== 'idle' && status !== 'sending' && (
            <View style={[styles.resultCard, status === 'success' ? styles.resultSuccess : styles.resultError]}>
              <View style={styles.resultIconRow}>
                {statusIcon}
              </View>
              <Text style={styles.resultTitle}>
                {status === 'success' ? 'SMS Delivered' : 'Delivery Issue'}
              </Text>
              {deliveryStatus ? (
                <Text style={styles.resultDelivery}>{deliveryStatus}</Text>
              ) : null}
              <Text style={styles.resultMessage}>{resultMessage}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.sendButton,
              status === 'sending' && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={status === 'sending'}
            activeOpacity={0.7}
            testID="send-sms-button"
          >
            <Animated.View style={[styles.sendButtonInner, { opacity: status === 'sending' ? pulseAnim : 1 }]}>
              {status === 'sending' ? (
                <ShimmerIndicator color="#000" size="small" />
              ) : (
                <Send size={20} color="#000" strokeWidth={2} />
              )}
              <Text style={styles.sendButtonText}>
                {status === 'sending' ? 'Sending via AWS SNS...' : status === 'success' ? 'Send Again' : 'Send Test SMS'}
              </Text>
            </Animated.View>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Messages are sent via Amazon SNS with SigV4 authentication.
              Standard SMS rates may apply.
            </Text>
          </View>
        </ScrollView>
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: 0.3},
  headerSpacer: {
    width: 40},
  body: {
    flex: 1},
  bodyContent: {
    padding: 20,
    paddingBottom: 40},
  brandCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  brandHeader: {
    alignItems: 'center' as const,
    marginBottom: 16},
  logoContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 6},
  logoIvx: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: 2},
  logoHoldings: {
    fontSize: 26,
    fontWeight: '300' as const,
    color: Colors.text,
    letterSpacing: 2},
  brandSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const},
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16},
  detailSection: {
    gap: 14},
  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12},
  detailInfo: {
    flex: 1},
  detailLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 2},
  detailValue: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20},
  snsStatusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  snsIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4},
  snsStatusText: {
    fontSize: 13,
    color: Colors.textSecondary},
  messagePreview: {
    marginTop: 20},
  previewLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 10},
  messageBubble: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  messageText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20},
  resultCard: {
    marginTop: 20,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center' as const,
    borderWidth: 1},
  resultSuccess: {
    backgroundColor: 'rgba(0, 196, 140, 0.08)',
    borderColor: 'rgba(0, 196, 140, 0.2)'},
  resultError: {
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderColor: 'rgba(255, 184, 0, 0.2)'},
  resultIconRow: {
    marginBottom: 12},
  resultTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  resultDelivery: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10},
  resultMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20},
  sendButton: {
    marginTop: 24,
    borderRadius: 14,
    overflow: 'hidden' as const,
    backgroundColor: Colors.primary},
  sendButtonDisabled: {
    opacity: 0.8},
  sendButtonInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 16,
    gap: 10},
  sendButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#000'},
  footer: {
    marginTop: 20,
    alignItems: 'center' as const},
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    lineHeight: 16}});
