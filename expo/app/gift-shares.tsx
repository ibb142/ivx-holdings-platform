import React, { useState, useRef, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  Gift,
  ChevronRight,
  Send,
  Heart,
  Cake,
  Star,
  PartyPopper,
  Check,
  Building2,
  ChevronDown,
  Mail,
  MessageSquare} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useHoldings } from '@/lib/data-hooks';
import { formatCurrencyWithDecimals } from '@/lib/formatters';

type DeliveryMethod = 'email' | 'sms';

type GiftOccasion = 'birthday' | 'holiday' | 'celebration' | 'just_because' | 'valentines';

interface GiftOccasionOption {
  id: GiftOccasion;
  label: string;
  icon: React.ComponentType<any>;
  emoji: string;
  color: string;
}

const GIFT_OCCASIONS: GiftOccasionOption[] = [
  { id: 'birthday', label: 'Birthday', icon: Cake, emoji: '🎂', color: '#FF6B9D' },
  { id: 'holiday', label: 'Holiday', icon: Star, emoji: '⭐', color: '#FFD700' },
  { id: 'valentines', label: "Valentine's", icon: Heart, emoji: '💕', color: '#E91E63' },
  { id: 'celebration', label: 'Celebration', icon: PartyPopper, emoji: '🎉', color: '#4ECDC4' },
  { id: 'just_because', label: 'Just Because', icon: Heart, emoji: '💝', color: '#FF4757' },
];

const OCCASION_MESSAGES: Record<GiftOccasion, string[]> = {
  birthday: [
    "Happy Birthday! 🎂 Here's a gift that grows — real estate shares just for you. Wishing you wealth & joy!",
    "It's your special day! 🎉 Enjoy this slice of real estate as a birthday gift. May your investments flourish!",
    "Happy Birthday! 🥳 Instead of something ordinary, here's a piece of property to start building your future.",
  ],
  holiday: [
    "Happy Holidays! ✨ This season, I'm gifting you something that lasts — real estate shares. Cheers to a prosperous New Year!",
    "Season's Greetings! 🎄 Unwrap something truly valuable this holiday — your very own property shares.",
    "Warm wishes this holiday season! 🌟 Here's a gift of real estate to brighten your portfolio and your future.",
  ],
  valentines: [
    "Happy Valentine's Day! 💕 Roses fade, but real estate grows. Here's a gift of love and smart investing.",
    "To my favorite person 💝 This Valentine's, I'm giving you something that appreciates as much as I appreciate you.",
    "Love is in the air — and so is smart investing! 💖 Happy Valentine's Day with a gift that keeps on growing.",
  ],
  celebration: [
    "Congratulations! 🎉 You deserve to celebrate — and what better way than with real estate shares? Here's to your success!",
    "Time to celebrate! 🥂 Marking this milestone with a gift that grows. Enjoy your new property shares!",
    "What an achievement! 🏆 Celebrate this moment with a gift that builds toward your future. Cheers!",
  ],
  just_because: [
    "No special occasion needed — just wanted to share something amazing with you! 💝 Enjoy your new property shares.",
    "Thinking of you! 😊 Here's a little something to brighten your day and boost your portfolio.",
    "Because you're awesome! 🌟 No reason needed to gift you real estate shares. Enjoy building wealth together!",
  ]};

export default function GiftSharesScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const { holdings } = useHoldings();

  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [shareCount, setShareCount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('email');
  const [selectedOccasion, setSelectedOccasion] = useState<GiftOccasion | null>(null);
  const [personalMessage, setPersonalMessage] = useState('');
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
  const [giftSent, setGiftSent] = useState(false);

  const availableProperties = holdings.map((h: { propertyId: string; property: { name: string; pricePerShare: number; images: string[] }; shares: number }) => ({
    id: h.propertyId,
    name: h.property?.name || 'Property',
    shares: h.shares,
    pricePerShare: h.property?.pricePerShare || 0,
    image: h.property?.images?.[0] || ''}));

  const selectedProp = availableProperties.find(p => p.id === selectedProperty);
  const totalValue = selectedProp ? Number(shareCount || 0) * selectedProp.pricePerShare : 0;

  const handleSendGift = useCallback(() => {
    const recipientContact = deliveryMethod === 'email' ? recipientEmail : recipientPhone;
    if (!selectedProperty || !shareCount || !recipientName || !recipientContact || !selectedOccasion) {
      Alert.alert('Missing Information', 'Please fill in all required fields.');
      return;
    }

    if (deliveryMethod === 'sms' && recipientPhone.replace(/\D/g, '').length < 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
      return;
    }

    const shares = Number(shareCount);
    if (isNaN(shares) || shares <= 0) {
      Alert.alert('Invalid Shares', 'Please enter a valid number of shares.');
      return;
    }

    if (selectedProp && shares > selectedProp.shares) {
      Alert.alert('Insufficient Shares', `You only have ${selectedProp.shares} shares of this property.`);
      return;
    }

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true}),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true}),
    ]).start();

    Alert.alert(
      'Send Gift',
      `Send ${shares} shares of ${selectedProp?.name} (${formatCurrencyWithDecimals(totalValue)}) to ${recipientName} via ${deliveryMethod === 'sms' ? 'SMS' : 'email'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Gift',
          onPress: () => {
            logger.giftShares.log('Gift sent:', {
              property: selectedProp?.name,
              shares,
              deliveryMethod,
              recipient: deliveryMethod === 'email' ? recipientEmail : recipientPhone,
              occasion: selectedOccasion});
            setGiftSent(true);
            Animated.timing(successAnim, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true}).start();
          }},
      ]
    );
  }, [selectedProperty, shareCount, recipientName, recipientEmail, recipientPhone, deliveryMethod, selectedOccasion, selectedProp, totalValue, scaleAnim, successAnim]);

  if (giftSent) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <Animated.View style={[styles.successContainer, { opacity: successAnim }]}>
            <View style={styles.successIcon}>
              <Gift size={48} color={Colors.primary} />
            </View>
            <Text style={styles.successTitle}>Gift Sent!</Text>
            <Text style={styles.successSubtext}>
              {recipientName} will receive {deliveryMethod === 'sms' ? 'an SMS' : 'an email'} with instructions to claim their{' '}
              {shareCount} shares of {selectedProp?.name}.
            </Text>
            <View style={styles.successCard}>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Property</Text>
                <Text style={styles.successValue}>{selectedProp?.name}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Shares</Text>
                <Text style={styles.successValue}>{shareCount}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Value</Text>
                <Text style={[styles.successValue, { color: Colors.success }]}>
                  {formatCurrencyWithDecimals(totalValue)}
                </Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Recipient</Text>
                <Text style={styles.successValue}>{recipientName}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Sent via</Text>
                <Text style={styles.successValue}>{deliveryMethod === 'sms' ? 'SMS' : 'Email'}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => router.back()}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sendAnotherButton}
              onPress={() => {
                setGiftSent(false);
                setSelectedProperty(null);
                setShareCount('');
                setRecipientName('');
                setRecipientEmail('');
                setRecipientPhone('');
                setDeliveryMethod('email');
                setSelectedOccasion(null);
                setPersonalMessage('');
                successAnim.setValue(0);
              }}
            >
              <Text style={styles.sendAnotherText}>Send Another Gift</Text>
            </TouchableOpacity>
          </Animated.View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronRight size={24} color={Colors.text} style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Gift Shares</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.scrollView}>
            <View style={styles.heroSection}>
              <View style={styles.giftIconBg}>
                <Gift size={32} color={Colors.primary} />
              </View>
              <Text style={styles.heroTitle}>Give the Gift of Real Estate</Text>
              <Text style={styles.heroSubtext}>
                Send property shares to friends & family. They'll get an account to manage their investment.
              </Text>
            </View>

            <Text style={styles.label}>Select Property</Text>
            <TouchableOpacity
              style={styles.propertySelector}
              onPress={() => setShowPropertyPicker(!showPropertyPicker)}
            >
              {selectedProp ? (
                <View style={styles.selectedPropRow}>
                  <Building2 size={18} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedPropName}>{selectedProp.name}</Text>
                    <Text style={styles.selectedPropShares}>
                      {selectedProp.shares} shares available · {formatCurrencyWithDecimals(selectedProp.pricePerShare)}/share
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.placeholderText}>Choose a property from your holdings</Text>
              )}
              <ChevronDown size={18} color={Colors.textTertiary} />
            </TouchableOpacity>

            {showPropertyPicker && (
              <View style={styles.propertyList}>
                {availableProperties.map(prop => (
                  <TouchableOpacity
                    key={prop.id}
                    style={[
                      styles.propertyOption,
                      selectedProperty === prop.id && styles.propertyOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedProperty(prop.id);
                      setShowPropertyPicker(false);
                    }}
                  >
                    <Building2 size={16} color={selectedProperty === prop.id ? Colors.primary : Colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.propertyOptionName}>{prop.name}</Text>
                      <Text style={styles.propertyOptionDetail}>
                        {prop.shares} shares · {formatCurrencyWithDecimals(prop.pricePerShare)}/share
                      </Text>
                    </View>
                    {selectedProperty === prop.id && <Check size={16} color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.label}>Number of Shares</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={shareCount}
                onChangeText={setShareCount}
                placeholder="e.g. 10"
                placeholderTextColor={Colors.inputPlaceholder}
                keyboardType="number-pad"
              />
              {totalValue > 0 && (
                <View style={styles.valueTag}>
                  <Text style={styles.valueTagText}>{formatCurrencyWithDecimals(totalValue)}</Text>
                </View>
              )}
            </View>

            <Text style={styles.label}>Occasion</Text>
            <View style={styles.occasionGrid}>
              {GIFT_OCCASIONS.map(occasion => (
                <TouchableOpacity
                  key={occasion.id}
                  style={[
                    styles.occasionCard,
                    selectedOccasion === occasion.id && { borderColor: occasion.color, backgroundColor: occasion.color + '10' },
                  ]}
                  onPress={() => {
                    setSelectedOccasion(occasion.id);
                    const messages = OCCASION_MESSAGES[occasion.id];
                    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
                    setPersonalMessage(randomMsg);
                  }}
                >
                  <Text style={styles.occasionEmoji}>{occasion.emoji}</Text>
                  <Text style={[
                    styles.occasionLabel,
                    selectedOccasion === occasion.id && { color: occasion.color },
                  ]}>
                    {occasion.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Recipient Name</Text>
            <TextInput
              style={styles.input}
              value={recipientName}
              onChangeText={setRecipientName}
              placeholder="John Doe"
              placeholderTextColor={Colors.inputPlaceholder}
            />

            <Text style={styles.label}>Delivery Method</Text>
            <View style={styles.deliveryToggle}>
              <TouchableOpacity
                style={[
                  styles.deliveryOption,
                  deliveryMethod === 'email' && styles.deliveryOptionActive,
                ]}
                onPress={() => setDeliveryMethod('email')}
              >
                <Mail size={16} color={deliveryMethod === 'email' ? Colors.primary : Colors.textTertiary} />
                <Text style={[
                  styles.deliveryOptionText,
                  deliveryMethod === 'email' && styles.deliveryOptionTextActive,
                ]}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deliveryOption,
                  deliveryMethod === 'sms' && styles.deliveryOptionActive,
                ]}
                onPress={() => setDeliveryMethod('sms')}
              >
                <MessageSquare size={16} color={deliveryMethod === 'sms' ? Colors.primary : Colors.textTertiary} />
                <Text style={[
                  styles.deliveryOptionText,
                  deliveryMethod === 'sms' && styles.deliveryOptionTextActive,
                ]}>SMS</Text>
              </TouchableOpacity>
            </View>

            {deliveryMethod === 'email' ? (
              <>
                <Text style={styles.label}>Recipient Email</Text>
                <TextInput
                  style={styles.input}
                  value={recipientEmail}
                  onChangeText={setRecipientEmail}
                  placeholder="john@example.com"
                  placeholderTextColor={Colors.inputPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Recipient Phone Number</Text>
                <TextInput
                  style={styles.input}
                  value={recipientPhone}
                  onChangeText={setRecipientPhone}
                  placeholder="+1 (555) 123-4567"
                  placeholderTextColor={Colors.inputPlaceholder}
                  keyboardType="phone-pad"
                />
              </>
            )}

            <Text style={styles.label}>Personal Message (optional)</Text>
            <TextInput
              style={[styles.input, styles.messageInput]}
              value={personalMessage}
              onChangeText={setPersonalMessage}
              placeholder="Happy birthday! Here's to building wealth together."
              placeholderTextColor={Colors.inputPlaceholder}
              multiline
              numberOfLines={3}
            />

            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!selectedProperty || !shareCount || !recipientName || !(deliveryMethod === 'email' ? recipientEmail : recipientPhone) || !selectedOccasion)
                    && styles.sendButtonDisabled,
                ]}
                onPress={handleSendGift}
                disabled={!selectedProperty || !shareCount || !recipientName || !(deliveryMethod === 'email' ? recipientEmail : recipientPhone) || !selectedOccasion}
              >
                <Send size={18} color={Colors.black} />
                <Text style={styles.sendButtonText}>
                  Send Gift{totalValue > 0 ? ` (${formatCurrencyWithDecimals(totalValue)})` : ''}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            <Text style={styles.disclaimer}>
              Gift shares are transferred instantly. The recipient will receive {deliveryMethod === 'sms' ? 'an SMS' : 'an email'} to create their IVXHOLDINGS account and claim the shares. Standard trading fees apply.
            </Text>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  heroSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  giftIconBg: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtext: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  label: { color: Colors.textSecondary, fontSize: 13 },
  propertySelector: { marginBottom: 12 },
  selectedPropRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  selectedPropName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flexShrink: 1 },
  selectedPropShares: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  placeholderText: { color: Colors.textSecondary, fontSize: 13 },
  propertyList: { gap: 8 },
  propertyOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  propertyOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  propertyOptionName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  propertyOptionDetail: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  inputRow: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  messageInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  valueTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  valueTagText: { color: Colors.textSecondary, fontSize: 13 },
  occasionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  occasionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  occasionEmoji: { fontSize: 24, marginBottom: 6 },
  occasionLabel: { color: Colors.textSecondary, fontSize: 13 },
  deliveryToggle: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  deliveryOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  deliveryOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  deliveryOptionText: { color: Colors.textTertiary, fontSize: 14, fontWeight: '600' as const },
  deliveryOptionTextActive: { color: Colors.primary },
  sendButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  disclaimer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: Colors.surface, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  successContainer: { gap: 8 },
  successIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  successSubtext: { color: Colors.textSecondary, fontSize: 13 },
  successCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  successLabel: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  successValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, flexShrink: 1 },
  doneButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  sendAnotherButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendAnotherText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  scrollView: { backgroundColor: Colors.background }});
