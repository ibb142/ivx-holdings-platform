import React, { useState, useCallback } from 'react';
import logger from '@/lib/logger';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Linking,
  Platform} from "react-native";

import { Stack, useRouter } from 'expo-router';
import {
  Gift,
  Users,
  Copy,
  DollarSign,
  CheckCircle,
  Clock,
  Mail,
  MessageCircle,
  Instagram,
  Twitter,
  Facebook,
  Send,
  Megaphone,
  ChevronRight,
  TrendingUp,
  Briefcase,
  Building2,
  Percent} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import { Referral } from '@/types';
import { supabase } from '@/lib/supabase';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const mockUserReferrals: Referral[] = [
  {
    id: 'ref-1',
    referrerId: 'current-user',
    referrerName: 'You',
    referrerEmail: 'you@email.com',
    referredEmail: 'mike.johnson@email.com',
    referredName: 'Mike Johnson',
    referredId: 'user-045',
    status: 'invested',
    referralCode: 'IVXHOLDINGS-INVITE',
    reward: 25,
    rewardPaid: true,
    signedUpAt: '2025-01-10T14:00:00Z',
    investedAt: '2025-01-15T10:00:00Z',
    investmentAmount: 2500,
    createdAt: '2025-01-08T09:00:00Z'},
  {
    id: 'ref-2',
    referrerId: 'current-user',
    referrerName: 'You',
    referrerEmail: 'you@email.com',
    referredEmail: 'sarah.williams@email.com',
    referredName: 'Sarah Williams',
    referredId: 'user-052',
    status: 'signed_up',
    referralCode: 'IVXHOLDINGS-INVITE',
    reward: 25,
    rewardPaid: false,
    signedUpAt: '2025-01-20T16:00:00Z',
    createdAt: '2025-01-18T11:00:00Z'},
  {
    id: 'ref-3',
    referrerId: 'current-user',
    referrerName: 'You',
    referrerEmail: 'you@email.com',
    referredEmail: 'tom.brown@email.com',
    status: 'pending',
    referralCode: 'IVXHOLDINGS-INVITE',
    reward: 25,
    rewardPaid: false,
    createdAt: '2025-01-24T08:00:00Z'},
];

export default function ReferralsScreen() {
  const router = useRouter();

  const referralsQuery = useQuery({
    queryKey: ['referrals'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { referrals: [], stats: null, code: null };
      const { data: refs } = await supabase.from('referrals').select('*').eq('referrer_id', user.id).order('created_at', { ascending: false }).limit(20);
      const { data: profile } = await supabase.from('profiles').select('referral_code').eq('id', user.id).single();
      return { referrals: refs || [], stats: null, code: profile?.referral_code || null };
    },
    retry: 1,
    staleTime: 1000 * 60 * 2});

  const sendInviteMutation = useMutation({
    mutationFn: async (input: { email: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('referral_invites').insert({ referrer_id: user.id, email: input.email, created_at: new Date().toISOString() });
      if (error) console.log('[Referrals] Invite insert note:', error.message);
      return { success: true };
    }});

  const referrals = (referralsQuery.data?.referrals as Referral[] | undefined) ?? mockUserReferrals;
  const [inviteEmail, setInviteEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  const referralCode = referralsQuery.data?.code ?? 'IVXHOLDINGS-INVITE';
  const referralLink = `https://ivxholding.com/join?ref=${referralCode}`;
  
  const appLinks = {
    appStore: 'https://apps.apple.com/app/ipx-holding',
    playStore: 'https://play.google.com/store/apps/details?id=com.ipxholding.app',
    website: 'https://ivxholding.com'};

  const totalEarned = referrals.filter(r => r.rewardPaid).reduce((sum, r) => sum + r.reward, 0);
  const pendingRewards = referrals.filter(r => r.status === 'invested' && !r.rewardPaid).reduce((sum, r) => sum + r.reward, 0);

  const formatCurrency = (amount: number) => _fmtCurr(amount);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'});
  };

  const shareMessage = `🏠 I'm investing in real estate with IVX HOLDINGS and you should too! Start with just $100 and earn passive income from premium properties.\n\n🎁 Sign up with my code and we BOTH get $25 in FREE project shares!\n\nUse my code ${referralCode} to get started: ${referralLink}\n\n📲 Download IVXHOLDINGS App:\n🍎 iOS: ${appLinks.appStore}\n🤖 Android: ${appLinks.playStore}\n🌐 Web: ${appLinks.website}`;

  const shareViaWhatsApp = useCallback(async () => {
    const encodedMessage = encodeURIComponent(shareMessage);
    const whatsappUrl = Platform.OS === 'web' 
      ? `https://wa.me/?text=${encodedMessage}`
      : `whatsapp://send?text=${encodedMessage}`;
    
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Linking.openURL(`https://wa.me/?text=${encodedMessage}`);
      }
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
      Alert.alert('Error', 'Could not open WhatsApp. Please make sure it is installed.');
    }
  }, [shareMessage]);

  const shareViaInstagram = useCallback(async () => {
    try {
      const instagramUrl = 'instagram://app';
      const canOpen = await Linking.canOpenURL(instagramUrl);
      
      if (canOpen && Platform.OS !== 'web') {
        await Linking.openURL(instagramUrl);
        Alert.alert('Share on Instagram', 'Copy your referral link and paste it in your Instagram story or DM!\n\nLink copied to clipboard.');
      } else {
        await Linking.openURL('https://www.instagram.com/');
      }
    } catch (error) {
      console.error('Error opening Instagram:', error);
      await Linking.openURL('https://www.instagram.com/');
    }
  }, []);

  const shareViaTwitter = useCallback(async () => {
    const encodedMessage = encodeURIComponent(shareMessage);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedMessage}`;
    
    try {
      await Linking.openURL(twitterUrl);
    } catch (error) {
      console.error('Error opening Twitter:', error);
      Alert.alert('Error', 'Could not open Twitter.');
    }
  }, [shareMessage]);

  const shareViaFacebook = useCallback(async () => {
    const encodedLink = encodeURIComponent(referralLink);
    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}&quote=${encodeURIComponent(shareMessage)}`;
    
    try {
      await Linking.openURL(facebookUrl);
    } catch (error) {
      console.error('Error opening Facebook:', error);
      Alert.alert('Error', 'Could not open Facebook.');
    }
  }, [shareMessage, referralLink]);

  const copyCode = useCallback(async () => {
    await Clipboard.setStringAsync(referralCode);
    Alert.alert('Copied!', `Referral code "${referralCode}" copied to clipboard`);
  }, [referralCode]);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(referralLink);
    Alert.alert('Copied!', 'Referral link copied to clipboard');
  }, [referralLink]);

  const sendEmailInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }

    setIsSending(true);
    sendInviteMutation.mutate(
      { email: inviteEmail.trim() },
      {
        onSuccess: (data) => {
          logger.referrals.log('Invite sent:', data);
          Alert.alert('Invitation Sent!', `An invitation has been sent to ${inviteEmail}`);
          setInviteEmail('');
          void referralsQuery.refetch();
        },
        onError: (error) => {
          console.error('[Referrals] Invite error:', error);
          Alert.alert('Error', 'Failed to send invitation. Please try again.');
        },
        onSettled: () => {
          setIsSending(false);
        }}
    );
  }, [inviteEmail, sendInviteMutation, referralsQuery]);

  const getStatusColor = (status: Referral['status']) => {
    switch (status) {
      case 'pending': return Colors.warning;
      case 'signed_up': return Colors.primary;
      case 'invested': return Colors.positive;
      case 'rewarded': return Colors.accent;
    }
  };

  const getStatusIcon = (status: Referral['status']) => {
    switch (status) {
      case 'pending': return <Clock size={14} color={Colors.warning} />;
      case 'signed_up': return <Users size={14} color={Colors.primary} />;
      case 'invested': return <CheckCircle size={14} color={Colors.positive} />;
      case 'rewarded': return <Gift size={14} color={Colors.accent} />;
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen 
        options={{ 
          title: 'Refer & Earn',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}} 
      />
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <View style={styles.heroIconContainer}>
            <Gift size={32} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Invite Friends, Earn Shares</Text>
          <Text style={styles.heroSubtitle}>
            Share IVX HOLDINGS with friends and earn $25 in shares on any of our projects for each friend who invests
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <DollarSign size={20} color={Colors.positive} />
            <Text style={styles.statValue}>{formatCurrency(totalEarned)}</Text>
            <Text style={styles.statLabel}>Shares Earned</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Clock size={20} color={Colors.warning} />
            <Text style={styles.statValue}>{formatCurrency(pendingRewards)}</Text>
            <Text style={styles.statLabel}>Pending Shares</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Users size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{referrals.length}</Text>
            <Text style={styles.statLabel}>Referrals</Text>
          </View>
        </View>

        <View style={styles.codeSection}>
          <Text style={styles.sectionTitle}>Your Referral Code</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeText}>{referralCode}</Text>
            <TouchableOpacity style={styles.copyButton} onPress={copyCode}>
              <Copy size={18} color={Colors.primary} />
              <Text style={styles.copyText}>Copy</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.linkCard}>
            <Text style={styles.linkLabel}>Or share your link</Text>
            <View style={styles.linkRow}>
              <Text style={styles.linkText} numberOfLines={1}>{referralLink}</Text>
              <TouchableOpacity onPress={copyLink}>
                <Copy size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.shareSection}>
          <Text style={styles.sectionTitle}>Share via</Text>
          <View style={styles.shareButtons}>
            <TouchableOpacity style={styles.shareButton} onPress={shareViaWhatsApp}>
              <View style={[styles.shareIcon, { backgroundColor: '#25D366' }]}>
                <MessageCircle size={20} color="#fff" />
              </View>
              <Text style={styles.shareLabel}>WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={shareViaInstagram}>
              <View style={[styles.shareIcon, { backgroundColor: '#E4405F' }]}>
                <Instagram size={20} color="#fff" />
              </View>
              <Text style={styles.shareLabel}>Instagram</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={shareViaTwitter}>
              <View style={[styles.shareIcon, { backgroundColor: '#1DA1F2' }]}>
                <Twitter size={20} color="#fff" />
              </View>
              <Text style={styles.shareLabel}>Twitter</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={shareViaFacebook}>
              <View style={[styles.shareIcon, { backgroundColor: '#1877F2' }]}>
                <Facebook size={20} color="#fff" />
              </View>
              <Text style={styles.shareLabel}>Facebook</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inviteSection}>
          <Text style={styles.sectionTitle}>Invite by Email</Text>
          <View style={styles.inviteCard}>
            <View style={styles.inviteInputRow}>
              <Mail size={20} color={Colors.textSecondary} />
              <TextInput
                style={styles.inviteInput}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="friend@email.com"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <TouchableOpacity 
              style={[styles.sendButton, (!inviteEmail.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={sendEmailInvite}
              disabled={!inviteEmail.trim() || isSending}
            >
              {isSending ? (
                <ShimmerIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Send size={16} color="#fff" />
                  <Text style={styles.sendButtonText}>Send Invite</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.howItWorks}>
          <Text style={styles.sectionTitle}>How It Works</Text>
          <View style={styles.stepCard}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Share Your Code</Text>
              <Text style={styles.stepDescription}>Send your unique referral code to friends</Text>
            </View>
          </View>
          <View style={styles.stepCard}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Friend Signs Up</Text>
              <Text style={styles.stepDescription}>They create an account using your code</Text>
            </View>
          </View>
          <View style={styles.stepCard}>
            <View style={[styles.stepNumber, { backgroundColor: Colors.positive }]}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Both Earn Shares</Text>
              <Text style={styles.stepDescription}>You both receive $25 in shares on any IVX project when they make their first investment</Text>
            </View>
          </View>
        </View>

        {referrals.length > 0 && (
          <View style={styles.referralsSection}>
            <Text style={styles.sectionTitle}>Your Referrals</Text>
            {referrals.map((referral) => (
              <View key={referral.id} style={styles.referralCard}>
                <View style={styles.referralInfo}>
                  <Text style={styles.referralName}>
                    {referral.referredName || referral.referredEmail}
                  </Text>
                  <Text style={styles.referralDate}>{formatDate(referral.createdAt)}</Text>
                </View>
                <View style={styles.referralStatus}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(referral.status) + '20' }]}>
                    {getStatusIcon(referral.status)}
                    <Text style={[styles.statusText, { color: getStatusColor(referral.status) }]}>
                      {referral.status.replace('_', ' ')}
                    </Text>
                  </View>
                  {referral.rewardPaid && (
                    <Text style={styles.rewardEarned}>+{formatCurrency(referral.reward)} shares</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.agentSection}>
          <View style={styles.agentCard}>
            <View style={styles.agentHeader}>
              <View style={styles.agentIconContainer}>
                <Briefcase size={24} color={Colors.primary} />
              </View>
              <View style={styles.agentBadge}>
                <Text style={styles.agentBadgeText}>WORK WITH US</Text>
              </View>
            </View>
            <Text style={styles.agentTitle}>Become a Real Estate Agent</Text>
            <Text style={styles.agentDesc}>
              Source properties for IVXHOLDINGS and earn 2% commission on every listing. Bring property owners to the platform and get paid.
            </Text>
            <View style={styles.agentStats}>
              <View style={styles.agentStatItem}>
                <Percent size={14} color={Colors.primary} />
                <Text style={styles.agentStatText}>2% per property</Text>
              </View>
              <View style={styles.agentStatItem}>
                <Building2 size={14} color={Colors.positive} />
                <Text style={styles.agentStatText}>All property types</Text>
              </View>
              <View style={styles.agentStatItem}>
                <DollarSign size={14} color={Colors.warning} />
                <Text style={styles.agentStatText}>Monthly payouts</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.agentCta}
              onPress={() => router.push('/agent-apply' as any)}
            >
              <Text style={styles.agentCtaText}>Apply as Agent</Text>
              <ChevronRight size={18} color={Colors.black} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.brokerSection}>
          <View style={styles.brokerCard}>
            <View style={styles.brokerHeader}>
              <View style={styles.brokerIconContainer}>
                <DollarSign size={24} color={Colors.primary} />
              </View>
              <View style={styles.brokerBadge}>
                <Text style={styles.brokerBadgeText}>BRING INVESTORS</Text>
              </View>
            </View>
            <Text style={styles.brokerTitle}>Become an Investor Broker</Text>
            <Text style={styles.brokerDesc}>
              Connect private lenders and individual investors with IVXHOLDINGS. Earn 2% commission on every share purchase your referrals make — recurring on all future investments.
            </Text>
            <View style={styles.brokerStats}>
              <View style={styles.brokerStatItem}>
                <Percent size={14} color={Colors.primary} />
                <Text style={styles.brokerStatText}>2% per investment</Text>
              </View>
              <View style={styles.brokerStatItem}>
                <TrendingUp size={14} color={Colors.positive} />
                <Text style={styles.brokerStatText}>Recurring earnings</Text>
              </View>
              <View style={styles.brokerStatItem}>
                <DollarSign size={14} color={Colors.warning} />
                <Text style={styles.brokerStatText}>Monthly payouts</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.brokerCta}
              onPress={() => router.push('/broker-apply' as any)}
            >
              <Text style={styles.brokerCtaText}>Apply as Broker</Text>
              <ChevronRight size={18} color={Colors.black} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.influencerSection}>
          <View style={styles.influencerCard}>
            <View style={styles.influencerHeader}>
              <View style={styles.influencerIconContainer}>
                <Megaphone size={24} color={Colors.primary} />
              </View>
              <View style={styles.influencerBadge}>
                <Text style={styles.influencerBadgeText}>EARN MORE</Text>
              </View>
            </View>
            <Text style={styles.influencerTitle}>Become an Influencer</Text>
            <Text style={styles.influencerDesc}>
              Upgrade your referral game. Earn higher commissions on every investment your audience makes.
            </Text>
            <View style={styles.influencerStats}>
              <View style={styles.influencerStatItem}>
                <TrendingUp size={14} color={Colors.success} />
                <Text style={styles.influencerStatText}>5% commission</Text>
              </View>
              <View style={styles.influencerStatItem}>
                <DollarSign size={14} color={Colors.primary} />
                <Text style={styles.influencerStatText}>Monthly payouts</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.influencerCta}
              onPress={() => router.push('/influencer-apply' as any)}
            >
              <Text style={styles.influencerCtaText}>Apply Now</Text>
              <ChevronRight size={18} color={Colors.black} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: 20, backgroundColor: Colors.background },
  heroSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  heroIconContainer: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' as const, textAlign: 'center', marginBottom: 8, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 10, textAlign: 'center' as const },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },
  codeSection: { marginBottom: 16 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  codeCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  codeText: { color: Colors.textSecondary, fontSize: 13 },
  copyButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  copyText: { color: Colors.textSecondary, fontSize: 13 },
  linkCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  linkLabel: { color: Colors.textSecondary, fontSize: 13 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { color: Colors.primary, fontSize: 13, fontWeight: '600' as const, flex: 1 },
  shareSection: { marginBottom: 16 },
  shareButtons: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' as const },
  shareButton: { padding: 8 },
  shareIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  shareLabel: { color: Colors.textSecondary, fontSize: 13 },
  inviteSection: { marginBottom: 16 },
  inviteCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  inviteInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sendButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  howItWorks: { gap: 16 },
  stepCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFD700', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumberText: { color: '#000000', fontSize: 13, fontWeight: '700' as const },
  stepContent: { flex: 1, gap: 4 },
  stepTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  stepDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  referralsSection: { marginBottom: 16 },
  referralCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 10 },
  referralInfo: { flex: 1, minWidth: 0 },
  referralName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  referralDate: { color: Colors.textTertiary, fontSize: 12 },
  referralStatus: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 12 },
  rewardEarned: { color: '#4CAF50', fontSize: 14, fontWeight: '700' as const },
  bottomPadding: { height: 120 },
  brokerSection: { marginBottom: 16 },
  brokerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  brokerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  brokerIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  brokerBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  brokerBadgeText: { fontSize: 11, fontWeight: '700' as const },
  brokerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  brokerDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  brokerStats: { gap: 8, marginBottom: 12 },
  brokerStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  brokerStatText: { color: Colors.textSecondary, fontSize: 13 },
  brokerCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12 },
  brokerCtaText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  agentSection: { marginBottom: 16 },
  agentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  agentIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  agentBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  agentBadgeText: { fontSize: 11, fontWeight: '700' as const },
  agentTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  agentDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  agentStats: { gap: 8, marginBottom: 12 },
  agentStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  agentStatText: { color: Colors.textSecondary, fontSize: 13 },
  agentCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12 },
  agentCtaText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  influencerSection: { marginBottom: 16 },
  influencerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  influencerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  influencerIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  influencerBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  influencerBadgeText: { fontSize: 11, fontWeight: '700' as const },
  influencerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  influencerDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  influencerStats: { gap: 8, marginBottom: 12 },
  influencerStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  influencerStatText: { color: Colors.textSecondary, fontSize: 13 },
  influencerCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12 },
  influencerCtaText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  scrollViewBg: { backgroundColor: Colors.background }});
