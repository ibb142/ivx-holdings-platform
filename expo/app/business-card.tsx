import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  Instagram,
  Linkedin,
  Zap,
  ScanLine,
  ChevronRight,
  Share2,
  Mail,
  MapPin,
  Globe,
  QrCode,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import IVXBrandLogo from '@/components/IVXBrandLogo';
import QRCodeView from '@/components/QRCodeView';

const IVX_BUSINESS_CARD_URL = 'https://r2-pub.rork.com/projects/j2l8t44588ix9ns7b57mu/assets/13a98cc9-5275-4104-8380-38ee2d5b1fca.png';

const GOLD = '#FFD700';
const GOLD_DIM = '#C9A800';
const SURFACE = '#111';

const SOCIAL_LINKS = [
  { id: 'website', label: 'ivxholding.com', url: 'https://ivxholding.com', icon: Globe, color: '#FFD700', bg: '#FFD70015' },
  { id: 'instagram', label: '@IVXHolding', url: 'https://www.instagram.com/ivxholding?igsh=MXYzZWtxMGxxOGRucg==', icon: Instagram, color: '#E1306C', bg: '#E1306C15' },
  { id: 'tiktok', label: '@IVXInvesting', url: 'https://www.tiktok.com/@IVXInvesting', icon: Zap, color: '#00F2EA', bg: '#00F2EA15' },
  { id: 'linkedin', label: 'IVX Holdings', url: 'https://www.linkedin.com/company/ivxholdings', icon: Linkedin, color: '#0A66C2', bg: '#0A66C215' },
];

const CONTACT_INFO = [
  { id: 'website', label: 'ivxholding.com', icon: Globe, color: GOLD },
  { id: 'email', label: 'ceo@ivxholding.com', icon: Mail, color: '#4A90D9' },
  { id: 'address', label: '1001 Brickell Bay Dr, Suite 2700, Miami FL 33131', icon: MapPin, color: '#FF6B6B' },
];

export default function BusinessCardScreen() {
  const router = useRouter();
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const socialFade = useRef(new Animated.Value(0)).current;
  const socialSlide = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(cardScale, { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(socialFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(socialSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
    ]).start();
  }, [cardScale, cardOpacity, socialFade, socialSlide]);

  const handleOpenLink = useCallback((url: string) => {
    console.log('[BusinessCard] Opening link:', url);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      void Linking.openURL(url);
    } catch (e) {
      console.log('[BusinessCard] Failed to open:', url, e);
    }
  }, []);

  const handleShare = useCallback(async () => {
    console.log('[BusinessCard] Sharing business card');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        title: 'IVX Holdings - Smart Investing Platform',
        message: 'Check out IVX Holdings - Smart Investing Platform\n\nInvest in real estate from $50\n\nInstagram: @IVXInvesting\nWebsite: ivxholding.com\nEmail: investors@ivxholding.com\nLinkedIn: linkedin.com/company/ivxholdings',
        url: 'https://ivxholding.com',
      });
    } catch (e) {
      console.log('[BusinessCard] Share failed:', e);
    }
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        <Animated.View style={[styles.cardContainer, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
          <View style={styles.cardWrapper}>
            <Image
              source={{ uri: IVX_BUSINESS_CARD_URL }}
              style={styles.cardImage}
              resizeMode="contain"
            />
            <View style={styles.scanBadge}>
              <ScanLine size={12} color={GOLD} />
              <Text style={styles.scanBadgeText}>QR ENABLED</Text>
            </View>
          </View>

          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShare}
              activeOpacity={0.8}
              testID="business-card-share"
            >
              <LinearGradient
                colors={[GOLD, GOLD_DIM]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.shareBtnGrad}
              >
                <Share2 size={16} color="#000" />
                <Text style={styles.shareBtnText}>Share Card</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.openAppBtn}
              onPress={() => router.push('/qr-code' as any)}
              activeOpacity={0.8}
              testID="business-card-qr"
            >
              <QrCode size={16} color={GOLD} />
              <Text style={styles.openAppBtnText}>QR Code</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Animated.View style={[styles.socialSection, { opacity: socialFade, transform: [{ translateY: socialSlide }] }]}>
          <Text style={styles.sectionLabel}>CONNECT WITH US</Text>
          <View style={styles.socialGrid}>
            {SOCIAL_LINKS.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.socialCard}
                onPress={() => handleOpenLink(link.url)}
                activeOpacity={0.75}
                testID={`bcard-social-${link.id}`}
              >
                <View style={[styles.socialIconWrap, { backgroundColor: link.bg }]}>
                  <link.icon size={20} color={link.color} />
                </View>
                <View style={styles.socialInfo}>
                  <Text style={styles.socialPlatform}>{link.id.charAt(0).toUpperCase() + link.id.slice(1)}</Text>
                  <Text style={styles.socialHandle} numberOfLines={1}>{link.label}</Text>
                </View>
                <ChevronRight size={16} color="#444" />
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        <Animated.View style={[styles.contactSection, { opacity: socialFade }]}>
          <Text style={styles.sectionLabel}>CONTACT DETAILS</Text>
          <View style={styles.contactList}>
            {CONTACT_INFO.map((item) => (
              <View key={item.id} style={styles.contactRow}>
                <View style={[styles.contactIconWrap, { backgroundColor: item.color + '15' }]}>
                  <item.icon size={16} color={item.color} />
                </View>
                <Text style={styles.contactText} numberOfLines={2}>{item.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View style={[styles.qrPreviewSection, { opacity: socialFade }]}>
          <Text style={styles.sectionLabel}>QUICK QR CODE</Text>
          <TouchableOpacity
            style={styles.qrPreviewCard}
            onPress={() => router.push('/qr-code' as any)}
            activeOpacity={0.8}
            testID="business-card-qr-preview"
          >
            <View style={styles.qrPreviewLeft}>
              <QRCodeView
                value="https://ivxholding.com"
                size={100}
                color={GOLD}
                backgroundColor="#000"
                quietZone={2}
              />
            </View>
            <View style={styles.qrPreviewRight}>
              <Text style={styles.qrPreviewTitle}>Scan to Access IVX</Text>
              <Text style={styles.qrPreviewDesc}>Share this QR with investors to give them instant access to the platform</Text>
              <View style={styles.qrPreviewAction}>
                <Text style={styles.qrPreviewActionText}>Open Full QR</Text>
                <ChevronRight size={14} color={GOLD} />
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[styles.companyBranding, { opacity: socialFade }]}>
          <IVXBrandLogo
            variant="symbol"
            size="md"
            theme="dark"
            containerStyle={styles.companyLogo}
            accessibilityLabel="IVX Holdings LLC logo"
          />
          <Text style={styles.companyName}>IVX HOLDINGS LLC</Text>
          <Text style={styles.companyTagline}>Smart Investing Platform</Text>
          <Text style={styles.companyLegal}>
            © {new Date().getFullYear()} IVX Holdings LLC. All rights reserved.
          </Text>
        </Animated.View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  cardContainer: {
    marginBottom: 28,
  },
  cardWrapper: {
    position: 'relative' as const,
    borderRadius: 20,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: GOLD + '20',
    backgroundColor: '#050505',
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1.78,
    backgroundColor: '#000',
  },
  scanBadge: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GOLD + '30',
  },
  scanBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  cardActions: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 16,
  },
  shareBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden' as const,
  },
  shareBtnGrad: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  shareBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  openAppBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: GOLD + '25',
  },
  openAppBtnText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  socialSection: {
    marginBottom: 28,
  },
  sectionLabel: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 2,
    marginBottom: 14,
  },
  socialGrid: {
    gap: 8,
  },
  socialCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: SURFACE,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    gap: 12,
  },
  socialIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  socialInfo: {
    flex: 1,
  },
  socialPlatform: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600' as const,
    marginBottom: 2,
  },
  socialHandle: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '600' as const,
  },
  contactSection: {
    marginBottom: 28,
  },
  contactList: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    overflow: 'hidden' as const,
  },
  contactRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  contactIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  contactText: {
    flex: 1,
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
  },
  companyBranding: {
    alignItems: 'center' as const,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  companyLogo: {
    marginBottom: 10,
  },
  companyName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: 2,
    marginBottom: 4,
  },
  companyTagline: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 8,
  },
  companyLegal: {
    color: '#444',
    fontSize: 10,
  },
  qrPreviewSection: {
    marginBottom: 28,
  },
  qrPreviewCard: {
    flexDirection: 'row' as const,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GOLD + '20',
    padding: 16,
    gap: 16,
    alignItems: 'center' as const,
  },
  qrPreviewLeft: {
    borderRadius: 12,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: GOLD + '25',
  },
  qrPreviewRight: {
    flex: 1,
  },
  qrPreviewTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  qrPreviewDesc: {
    color: '#888',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  qrPreviewAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  qrPreviewActionText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  bottomPad: {
    height: 40,
  },
});
