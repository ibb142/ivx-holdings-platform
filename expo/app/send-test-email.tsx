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
  Mail,
  Building2,
  Globe,
  MapPin,
  Shield} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useEmail } from '@/lib/email-context';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const TEST_RECIPIENT = 'osconstructors@gmail.com';

const BRANDED_EMAIL_BODY = `Dear Valued Partner,

Welcome to IVX Holdings — your trusted gateway to premium global real estate investment opportunities.

This is an official test communication from IVX Holdings Ltd., confirming that our enterprise email system is fully operational and securely connected via AWS SES.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ABOUT IVX HOLDINGS

IVX Holdings Ltd. is a premier global real estate investment platform, specializing in high-yield Joint Venture (JV) development projects across international markets.

Our platform empowers all investors, institutional partners, and development firms to participate in carefully vetted real estate opportunities — from luxury residential developments to commercial mixed-use projects. No accreditation required — investing is open to everyone.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUR SERVICES

• Joint Venture (JV) Investment Opportunities
• Global Real Estate Portfolio Management
• Investor Relations & KYC Compliance
• AI-Powered Market Intelligence & Analytics
• Secure Digital Contract Generation
• Real-Time Investment Tracking & Reporting
• Fractional Share Ownership Programs
• Enterprise-Grade Security & Authentication

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENTERPRISE DETAILS

Company: IVX Holdings Ltd.
Industry: Global Real Estate Investment & Development
Headquarters: 1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131
Website: https://ivxholding.com
Email: support@ivxholding.com
CEO Office: ceo@ivxholding.com

Registration: Licensed & Regulated Entity
Platform: Proprietary Investment Technology Stack
Security: Bank-Grade AES-256 Encryption, 2FA, SOC 2 Compliant

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This email confirms successful delivery from the IVX Holdings enterprise email infrastructure. Our system is powered by Amazon Web Services (AWS SES) with full DKIM, SPF, and DMARC authentication for maximum deliverability and security.

If you have any questions or require further assistance, please do not hesitate to contact our team.

Best regards,

Ivan Perez
Chief Executive Officer
IVX Holdings Ltd.

1001 Brickell Bay Drive, Suite 2700
Miami, FL 33131, United States
https://ivxholding.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIDENTIALITY NOTICE: This email and any attachments are confidential and intended solely for the use of the individual or entity to whom they are addressed. If you have received this email in error, please notify the sender immediately and delete this message.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

type SendStatus = 'idle' | 'sending' | 'success' | 'error';

export default function SendTestEmailScreen() {
  const router = useRouter();
  const { sendEmail, activeAccount, sesStatus } = useEmail();
  const [status, setStatus] = useState<SendStatus>('idle');
  const [resultMessage, setResultMessage] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true}).start();
  }, [fadeAnim]);

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

  const handleSend = useCallback(async () => {
    if (status === 'sending') return;

    setStatus('sending');
    setResultMessage('');
    setDeliveryStatus('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[TestEmail] Sending branded test email to:', TEST_RECIPIENT);
    console.log('[TestEmail] From account:', activeAccount.email, activeAccount.displayName);
    console.log('[TestEmail] SES status:', sesStatus.status, 'configured:', sesStatus.configured);

    try {
      const result = await sendEmail({
        to: TEST_RECIPIENT,
        subject: 'IVX Holdings — Enterprise Email System Test & Brand Verification',
        body: BRANDED_EMAIL_BODY});

      console.log('[TestEmail] Send result:', JSON.stringify(result));

      if (result.success && result.deliveryStatus === 'sent') {
        setStatus('success');
        setDeliveryStatus('Delivered via AWS SES');
        setResultMessage(`Email delivered successfully!\nMessage ID: ${result.messageId || 'N/A'}`);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (result.success && result.deliveryStatus === 'queued_locally') {
        setStatus('error');
        setDeliveryStatus('Queued Locally');
        setResultMessage(result.error || 'Email saved locally. Backend delivery pending — check SES configuration.');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        setStatus('error');
        setDeliveryStatus('Failed');
        setResultMessage(result.error || 'Unknown error occurred.');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: unknown) {
      setStatus('error');
      setDeliveryStatus('Exception');
      setResultMessage((err as Error)?.message || 'Failed to send email.');
      console.error('[TestEmail] Exception:', err);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [status, activeAccount, sesStatus, sendEmail]);

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
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Send Test Email</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
          <Animated.View style={[styles.brandCard, { opacity: fadeAnim }]}>
            <View style={styles.brandHeader}>
              <View style={styles.logoContainer}>
                <Text style={styles.logoIvx}>IVX</Text>
                <Text style={styles.logoHoldings}> HOLDINGS</Text>
              </View>
              <Text style={styles.brandSubtitle}>Enterprise Email System</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailSection}>
              <View style={styles.detailRow}>
                <Mail size={16} color={Colors.primary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>Recipient</Text>
                  <Text style={styles.detailValue}>{TEST_RECIPIENT}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Send size={16} color={Colors.accent} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>From Account</Text>
                  <Text style={styles.detailValue}>{activeAccount.displayName} ({activeAccount.email})</Text>
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
                <Shield size={16} color={Colors.textSecondary} strokeWidth={1.8} />
                <View style={styles.detailInfo}>
                  <Text style={styles.detailLabel}>SES Status</Text>
                  <View style={styles.sesRow}>
                    <View style={[
                      styles.sesDot,
                      sesStatus.status === 'active' && styles.sesDotActive,
                      sesStatus.status === 'error' && styles.sesDotError,
                      sesStatus.status === 'unreachable' && styles.sesDotWarning,
                    ]} />
                    <Text style={styles.detailValue}>
                      {sesStatus.configured ? `${sesStatus.status} (${sesStatus.region || 'N/A'})` : 'Not configured'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>

          <View style={styles.emailPreviewCard}>
            <Text style={styles.previewTitle}>Email Preview</Text>
            <Text style={styles.previewSubject}>Subject: IVX Holdings — Enterprise Email System Test & Brand Verification</Text>
            <View style={styles.previewDivider} />
            <Text style={styles.previewBody} numberOfLines={12}>
              {BRANDED_EMAIL_BODY.substring(0, 600)}...
            </Text>
            <Text style={styles.previewNote}>Full email includes company details, services list, enterprise info, CEO signature, and confidentiality notice.</Text>
          </View>

          {(status === 'success' || status === 'error') && (
            <View style={[styles.resultCard, status === 'success' ? styles.resultSuccess : styles.resultError]}>
              {statusIcon}
              <Text style={styles.resultTitle}>
                {status === 'success' ? 'Email Sent Successfully' : 'Delivery Issue'}
              </Text>
              <Text style={styles.resultDelivery}>{deliveryStatus}</Text>
              <Text style={styles.resultMessage}>{resultMessage}</Text>
            </View>
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.sendButton, status === 'sending' && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={status === 'sending'}
            activeOpacity={0.85}
          >
            {status === 'sending' ? (
              <Animated.View style={[styles.sendButtonInner, { opacity: pulseAnim }]}>
                <ShimmerIndicator size="small" color={Colors.background} />
                <Text style={styles.sendButtonText}>Sending via AWS SES...</Text>
              </Animated.View>
            ) : (
              <View style={styles.sendButtonInner}>
                <Send size={20} color={Colors.background} strokeWidth={2} />
                <Text style={styles.sendButtonText}>
                  {status === 'success' || status === 'error' ? 'Send Again' : 'Send Test Email'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const},
  headerSpacer: {
    width: 40},
  body: {
    flex: 1},
  bodyContent: {
    padding: 16,
    gap: 16},
  brandCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden'},
  brandHeader: {
    backgroundColor: Colors.backgroundSecondary,
    padding: 24,
    alignItems: 'center',
    gap: 6},
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'baseline'},
  logoIvx: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: 2},
  logoHoldings: {
    fontSize: 28,
    fontWeight: '300' as const,
    color: Colors.text,
    letterSpacing: 2},
  brandSubtitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase' as const},
  divider: {
    height: 1,
    backgroundColor: Colors.border},
  detailSection: {
    padding: 20,
    gap: 16},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 2},
  detailInfo: {
    flex: 1,
    gap: 2},
  detailLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  detailValue: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20},
  sesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  sesDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary},
  sesDotActive: {
    backgroundColor: Colors.success},
  sesDotError: {
    backgroundColor: Colors.error},
  sesDotWarning: {
    backgroundColor: Colors.warning},
  emailPreviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 10},
  previewTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  previewSubject: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    lineHeight: 18},
  previewDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4},
  previewBody: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18},
  previewNote: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontStyle: 'italic' as const,
    marginTop: 4},
  resultCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10},
  resultSuccess: {
    backgroundColor: 'rgba(0,196,140,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,196,140,0.2)'},
  resultError: {
    backgroundColor: 'rgba(255,184,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.2)'},
  resultTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  resultDelivery: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  resultMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20},
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  sendButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center'},
  sendButtonDisabled: {
    backgroundColor: Colors.primaryDark},
  sendButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  sendButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.background},
  bottomPadding: {
    height: 20}});
