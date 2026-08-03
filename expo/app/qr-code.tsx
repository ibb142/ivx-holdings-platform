import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Share,
  Platform} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import {
  Share2,
  Globe,
  Instagram,
  Copy,
  Check,
  QrCode,
  Smartphone,
  ExternalLink} from 'lucide-react-native';
import QRCodeView from '@/components/QRCodeView';

const GOLD = '#FFD700';
const GOLD_DIM = '#C9A800';
const SURFACE = '#111';
const IVX_URL = 'https://ivxholding.com';
const IVX_APP_URL = 'https://ivxholding.com/app';
const IVX_INSTAGRAM = 'https://www.instagram.com/ivxholding?igsh=MXYzZWtxMGxxOGRucg==';

type QRTarget = 'website' | 'app' | 'instagram';

interface QROption {
  id: QRTarget;
  label: string;
  url: string;
  icon: typeof Globe;
  color: string;
  description: string;
}

const QR_OPTIONS: QROption[] = [
  { id: 'website', label: 'Website', url: IVX_URL, icon: Globe, color: GOLD, description: 'ivxholding.com' },
  { id: 'app', label: 'App', url: IVX_APP_URL, icon: Smartphone, color: '#4A90D9', description: 'Download IVX App' },
  { id: 'instagram', label: 'Instagram', url: IVX_INSTAGRAM, icon: Instagram, color: '#E1306C', description: '@IVXHolding' },
];

export default function QRCodeScreen() {
  const [selectedTarget, setSelectedTarget] = useState<QRTarget>('website');
  const [copied, setCopied] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const qrFade = useRef(new Animated.Value(1)).current;

  const selectedOption = QR_OPTIONS.find(o => o.id === selectedTarget) ?? QR_OPTIONS[0];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const handleSelectTarget = useCallback((target: QRTarget) => {
    console.log('[QR] Selected target:', target);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.sequence([
      Animated.timing(qrFade, { toValue: 0.3, duration: 100, useNativeDriver: true }),
      Animated.timing(qrFade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    setSelectedTarget(target);
    setCopied(false);
  }, [qrFade]);

  const handleShare = useCallback(async () => {
    console.log('[QR] Sharing QR link:', selectedOption.url);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        title: 'IVX Holdings',
        message: `Scan to access IVX Holdings — ${selectedOption.label}\n\n${selectedOption.url}`,
        url: selectedOption.url});
    } catch (e) {
      console.log('[QR] Share failed:', e);
    }
  }, [selectedOption]);

  const handleCopyLink = useCallback(async () => {
    console.log('[QR] Copying link:', selectedOption.url);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(selectedOption.url);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(selectedOption.url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.log('[QR] Copy failed:', e);
    }
  }, [selectedOption]);

  const handleOpenLink = useCallback(() => {
    console.log('[QR] Opening link:', selectedOption.url);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Linking.openURL(selectedOption.url);
  }, [selectedOption]);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: 'QR Code',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: GOLD,
          headerTitleStyle: { fontWeight: '700' as const, color: '#fff' }}}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        <Animated.View style={[styles.qrSection, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.qrHeader}>
            <QrCode size={20} color={GOLD} />
            <Text style={styles.qrTitle}>SCAN TO ACCESS IVX</Text>
          </View>

          <Animated.View style={[styles.qrCard, { opacity: qrFade }]}>
            <LinearGradient
              colors={['#1A1500', '#0A0A00', '#000']}
              style={styles.qrCardGrad}
            >
              <View style={styles.qrBorder}>
                <QRCodeView
                  value={selectedOption.url}
                  size={220}
                  color={GOLD}
                  backgroundColor="#000"
                  quietZone={2}
                />
              </View>

              <Text style={styles.qrLabel}>{selectedOption.label}</Text>
              <Text style={styles.qrUrl}>{selectedOption.description}</Text>
            </LinearGradient>
          </Animated.View>

          <View style={styles.targetSelector}>
            {QR_OPTIONS.map((option) => {
              const isSelected = option.id === selectedTarget;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.targetBtn, isSelected && styles.targetBtnActive]}
                  onPress={() => handleSelectTarget(option.id)}
                  activeOpacity={0.7}
                  testID={`qr-target-${option.id}`}
                >
                  <option.icon size={18} color={isSelected ? '#000' : option.color} />
                  <Text style={[styles.targetBtnText, isSelected && styles.targetBtnTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        <Animated.View style={[styles.actionsSection, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={handleShare}
            activeOpacity={0.8}
            testID="qr-share-btn"
          >
            <LinearGradient
              colors={[GOLD, GOLD_DIM]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryActionGrad}
            >
              <Share2 size={18} color="#000" />
              <Text style={styles.primaryActionText}>Share QR Link</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.secondaryActions}>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleCopyLink}
              activeOpacity={0.8}
              testID="qr-copy-btn"
            >
              {copied ? <Check size={18} color="#25D366" /> : <Copy size={18} color={GOLD} />}
              <Text style={[styles.secondaryActionText, copied && { color: '#25D366' }]}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleOpenLink}
              activeOpacity={0.8}
              testID="qr-open-btn"
            >
              <ExternalLink size={18} color={GOLD} />
              <Text style={styles.secondaryActionText}>Open Link</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Animated.View style={[styles.infoSection, { opacity: fadeAnim }]}>
          <Text style={styles.infoTitle}>HOW TO USE</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoStep}>
                <Text style={styles.infoStepNum}>1</Text>
              </View>
              <Text style={styles.infoText}>Select which IVX link you want to share</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoStep}>
                <Text style={styles.infoStepNum}>2</Text>
              </View>
              <Text style={styles.infoText}>Show the QR code to anyone with a phone camera</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoStep}>
                <Text style={styles.infoStepNum}>3</Text>
              </View>
              <Text style={styles.infoText}>They scan it and instantly access IVX Holdings</Text>
            </View>
          </View>
        </Animated.View>

        <View style={styles.branding}>
          <Text style={styles.brandName}>IVX HOLDINGS</Text>
          <Text style={styles.brandTagline}>Smart Investing Platform</Text>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000'},
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16},
  qrSection: {
    marginBottom: 24},
  qrHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginBottom: 20},
  qrTitle: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 3},
  qrCard: {
    borderRadius: 24,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: GOLD + '25',
    marginBottom: 20},
  qrCardGrad: {
    alignItems: 'center' as const,
    paddingVertical: 32,
    paddingHorizontal: 24},
  qrBorder: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: GOLD + '30',
    backgroundColor: '#000',
    marginBottom: 20},
  qrLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: 1,
    marginBottom: 4},
  qrUrl: {
    color: GOLD + 'AA',
    fontSize: 13,
    fontWeight: '500' as const},
  targetSelector: {
    flexDirection: 'row' as const,
    gap: 8},
  targetBtn: {
    flex: 1,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#1A1A1A'},
  targetBtnActive: {
    backgroundColor: GOLD,
    borderColor: GOLD},
  targetBtnText: {
    color: '#999',
    fontSize: 11,
    fontWeight: '700' as const},
  targetBtnTextActive: {
    color: '#000'},
  actionsSection: {
    marginBottom: 28,
    gap: 10},
  primaryAction: {
    borderRadius: 16,
    overflow: 'hidden' as const},
  primaryActionGrad: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16},
  primaryActionText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800' as const},
  secondaryActions: {
    flexDirection: 'row' as const,
    gap: 10},
  secondaryAction: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#1A1A1A'},
  secondaryActionText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '700' as const},
  infoSection: {
    marginBottom: 28},
  infoTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 2,
    marginBottom: 12},
  infoCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 16,
    gap: 14},
  infoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14},
  infoStep: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  infoStepNum: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '800' as const},
  infoText: {
    flex: 1,
    color: '#999',
    fontSize: 13,
    lineHeight: 18},
  branding: {
    alignItems: 'center' as const,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A'},
  brandName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 2,
    marginBottom: 4},
  brandTagline: {
    color: GOLD + '80',
    fontSize: 11,
    fontWeight: '600' as const},
  bottomPad: {
    height: 40}});
