import React from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Shield, Wallet, BarChart3, Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import InvestorIntakeForm from '@/components/InvestorIntakeForm';

const MEMBER_READY_ITEMS = [
  {
    id: 'onboarding',
    title: 'Real member onboarding',
    description: 'Capture verified contact data, two ID references, tax responsibility acknowledgement, and agreement signature before activation.',
    icon: Shield,
    accent: Colors.primary},
  {
    id: 'wallet',
    title: 'Wallet activation',
    description: 'Approved members move into wallet setup and funding review before live allocations open.',
    icon: Wallet,
    accent: Colors.info},
  {
    id: 'records',
    title: 'Transaction records',
    description: 'Investor statements, transaction history, and timeline records stay tied to the member account.',
    icon: BarChart3,
    accent: Colors.success},
] as const;

export default function WaitlistScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.75}
            testID="waitlist-back"
          >
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Sparkles size={28} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Investor Waitlist</Text>
          <Text style={styles.heroSubtitle}>
            Reserve your spot with real investor details now. This flow syncs verified contact data, two ID references, tax-responsibility acknowledgements, optional entity onboarding details, and proof-of-funds metadata.
          </Text>
        </View>

        <View style={styles.readinessSection}>
          {MEMBER_READY_ITEMS.map((item) => (
            <View key={item.id} style={styles.readinessCard}>
              <View style={[styles.readinessIconWrap, { backgroundColor: item.accent + '18' }]}> 
                <item.icon size={18} color={item.accent} />
              </View>
              <View style={styles.readinessCopy}>
                <Text style={styles.readinessTitle}>{item.title}</Text>
                <Text style={styles.readinessDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <InvestorIntakeForm
          variant="screen"
          source="app_waitlist"
          pagePath="/waitlist"
          testIdPrefix="waitlist-investor"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10},
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32},
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginTop: 8,
    marginBottom: 18},
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '28',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  heroTitle: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: '900' as const,
    letterSpacing: -0.6,
    marginBottom: 10},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22},
  readinessSection: {
    gap: 10,
    marginBottom: 20},
  readinessCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16},
  readinessIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  readinessCopy: {
    flex: 1},
  readinessTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    marginBottom: 4},
  readinessDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20}});
