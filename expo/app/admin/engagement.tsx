import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  Switch} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Sparkles,
  Send,
  Users,
  AlertTriangle,
  Clock,
  TrendingDown,
  Mail,
  RefreshCw,
  ChevronRight,
  X,
  User,
  Zap,
  Activity,
  Bot,
  Bell,
  Play,
  CheckCircle,
  MessageSquare,
  FileText,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { MemberEngagementStats, MemberActivity } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';
import { generateText } from '@/lib/ai-service';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';

const formatCurrency = (amount: number) => _fmtCurr(amount);

type TabType = 'overview' | 'inactive' | 'messages' | 'drafts' | 'activity' | 'automation';

type AutomationSettings = {
  enabled: boolean;
  inactiveDaysThreshold: number;
  autoSendMessages: boolean;
  dailyMessageLimit: number;
  messagesSentToday: number;
  lastRunTime: string | null;
};

type QueuedMessage = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  scheduledAt: string;
};

type DraftMessage = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  memberAvatar?: string;
  subject: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

export default function EngagementScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const engagementQuery = useQuery({
    queryKey: ['admin-engagement-data'],
    queryFn: async () => {
      console.log('[Engagement] Fetching canonical member registry');
      const registry = await fetchAdminMemberRegistry();
      const members = registry.map((r) => ({
        id: r.id || r.email,
        first_name: r.firstName,
        last_name: r.lastName,
        email: r.email,
        avatar: undefined,
        status: r.status || 'active',
        total_invested: r.totalInvested,
        created_at: r.createdAt,
        updated_at: r.updatedAt || r.lastSeenAt}));
      const now = new Date();
      const inactive: MemberEngagementStats[] = members.map((m: any) => {
        const lastActivity = new Date(m.updated_at || m.created_at || now);
        const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
        let riskLevel: MemberEngagementStats['riskLevel'] = 'active';
        if (daysSince >= 7) riskLevel = 'churned';
        else if (daysSince >= 4) riskLevel = 'inactive';
        else if (daysSince >= 2) riskLevel = 'at_risk';
        return {
          memberId: m.id,
          memberName: `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown',
          memberEmail: m.email || '',
          memberAvatar: m.avatar,
          lastActivityDate: m.updated_at || m.created_at || now.toISOString(),
          daysSinceLastActivity: daysSince,
          totalInvested: Number(m.total_invested) || 0,
          engagementScore: Math.max(0, 100 - (daysSince * 10)),
          riskLevel,
          suggestedAction: riskLevel === 'at_risk' ? 'Send re-engagement message' : riskLevel === 'inactive' ? 'Personal outreach recommended' : riskLevel === 'churned' ? 'Win-back campaign' : undefined};
      }).filter((m: MemberEngagementStats) => m.daysSinceLastActivity >= 2).sort((a: MemberEngagementStats, b: MemberEngagementStats) => b.daysSinceLastActivity - a.daysSinceLastActivity);
      return {
        members: inactive,
        stats: {
          totalMembers: members.length,
          activeMembers: members.filter((m: any) => m.status === 'active').length,
          atRiskMembers: inactive.filter(m => m.riskLevel === 'at_risk').length,
          inactiveMembers: inactive.filter(m => m.riskLevel === 'inactive').length,
          churnedMembers: inactive.filter(m => m.riskLevel === 'churned').length,
          messagesSent: 0,
          messagesOpened: 0}};
    },
    staleTime: 30000});

  const [inactiveMembers, setInactiveMembers] = useState<MemberEngagementStats[]>([]);
  const [activities, setActivities] = useState<MemberActivity[]>([]);
  const [stats, setStats] = useState({ totalMembers: 0, activeMembers: 0, atRiskMembers: 0, inactiveMembers: 0, churnedMembers: 0, messagesSent: 0, messagesOpened: 0 });

  React.useEffect(() => {
    if (engagementQuery.data) {
      setInactiveMembers(engagementQuery.data.members);
      setStats(engagementQuery.data.stats);
    }
  }, [engagementQuery.data]);
  const [selectedMember, setSelectedMember] = useState<MemberEngagementStats | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    enabled: true,
    inactiveDaysThreshold: 2,
    autoSendMessages: false,
    dailyMessageLimit: 50,
    messagesSentToday: 12,
    lastRunTime: '2025-01-25T08:00:00Z'});
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [isRunningAutomation, setIsRunningAutomation] = useState(false);
  const [bulkGenerationProgress, setBulkGenerationProgress] = useState(0);
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [editingDraft, setEditingDraft] = useState<DraftMessage | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  

  const getRiskColor = (risk: MemberEngagementStats['riskLevel']) => {
    switch (risk) {
      case 'active': return Colors.positive;
      case 'at_risk': return Colors.warning;
      case 'inactive': return Colors.accent;
      case 'churned': return Colors.negative;
    }
  };

  const getRiskIcon = (risk: MemberEngagementStats['riskLevel']) => {
    switch (risk) {
      case 'active': return <Activity size={14} color={Colors.positive} />;
      case 'at_risk': return <AlertTriangle size={14} color={Colors.warning} />;
      case 'inactive': return <Clock size={14} color={Colors.accent} />;
      case 'churned': return <TrendingDown size={14} color={Colors.negative} />;
    }
  };

  const getActivityIcon = (type: MemberActivity['type']) => {
    switch (type) {
      case 'login': return <User size={14} color={Colors.primary} />;
      case 'investment': return <TrendingDown size={14} color={Colors.positive} style={{ transform: [{ rotate: '180deg' }] }} />;
      case 'withdrawal': return <TrendingDown size={14} color={Colors.negative} />;
      case 'view_property': return <Activity size={14} color={Colors.accent} />;
      default: return <Activity size={14} color={Colors.textSecondary} />;
    }
  };



  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const generateAIMessage = useCallback(async (member: MemberEngagementStats) => {
    setIsGenerating(true);
    setSelectedMember(member);
    setShowMessageModal(true);

    try {
      const prompt = `Generate a personalized re-engagement email for an investor named ${member.memberName}. 
      They haven't been active for ${member.daysSinceLastActivity} days. 
      Their total investment is ${formatCurrency(member.totalInvested)}. 
      Their engagement risk level is: ${member.riskLevel}.
      
      The email should be:
      - Professional but warm
      - From IVX HOLDINGS LLC, a real estate investment platform
      - Mention exciting new investment opportunities
      - Encourage them to return to the platform
      - Keep it concise (2-3 paragraphs max)
      - Include a call to action
      
      Only output the email body, no subject line or greeting format.`;

      const response = await generateText(prompt);
      setGeneratedMessage(response);
      console.log('AI generated message for:', member.memberName);
    } catch (error) {
      console.error('Error generating message:', error);
      setGeneratedMessage(`Dear ${member.memberName},\n\nWe noticed it's been a while since your last visit to IVX HOLDINGS. We wanted to reach out and let you know about some exciting new investment opportunities that might interest you.\n\nOur team has curated a selection of premium real estate properties with attractive yields. We'd love to help you explore these options and continue building your investment portfolio.\n\nPlease don't hesitate to reach out if you have any questions. We're here to help!\n\nBest regards,\nIVX HOLDINGS Team`);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if (!selectedMember || !generatedMessage) return;

    setIsSending(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      Alert.alert(
        'Message Sent',
        `Re-engagement message sent to ${selectedMember.memberName} (${selectedMember.memberEmail})`,
        [{ text: 'OK' }]
      );
      
      setShowMessageModal(false);
      setGeneratedMessage('');
      setSelectedMember(null);
      console.log('Message sent to:', selectedMember.memberEmail);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  }, [selectedMember, generatedMessage]);

  const saveAsDraft = useCallback(() => {
    if (!selectedMember || !generatedMessage) return;

    const newDraft: DraftMessage = {
      id: `draft-${Date.now()}`,
      memberId: selectedMember.memberId,
      memberName: selectedMember.memberName,
      memberEmail: selectedMember.memberEmail,
      memberAvatar: selectedMember.memberAvatar,
      subject: `Re-engagement: ${selectedMember.memberName}`,
      message: generatedMessage,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()};

    setDrafts(prev => [newDraft, ...prev]);
    setShowMessageModal(false);
    setGeneratedMessage('');
    setSelectedMember(null);
    
    Alert.alert('Draft Saved', 'Message saved to drafts. You can edit and send it later.');
    console.log('Draft saved for:', selectedMember.memberEmail);
  }, [selectedMember, generatedMessage]);

  const openDraftForEdit = useCallback((draft: DraftMessage) => {
    setEditingDraft(draft);
    setDraftSubject(draft.subject);
    setDraftMessage(draft.message);
    setShowDraftModal(true);
  }, []);

  const updateDraft = useCallback(() => {
    if (!editingDraft) return;

    setDrafts(prev => prev.map(d => 
      d.id === editingDraft.id 
        ? { ...d, subject: draftSubject, message: draftMessage, updatedAt: new Date().toISOString() }
        : d
    ));
    setShowDraftModal(false);
    setEditingDraft(null);
    setDraftSubject('');
    setDraftMessage('');
    
    Alert.alert('Draft Updated', 'Your changes have been saved.');
    console.log('Draft updated:', editingDraft.id);
  }, [editingDraft, draftSubject, draftMessage]);

  const deleteDraft = useCallback((draftId: string) => {
    Alert.alert(
      'Delete Draft',
      'Are you sure you want to delete this draft?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDrafts(prev => prev.filter(d => d.id !== draftId));
            console.log('Draft deleted:', draftId);
          }},
      ]
    );
  }, []);

  const sendDraft = useCallback(async (draft: DraftMessage) => {
    Alert.alert(
      'Send Draft',
      `Send this message to ${draft.memberName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            await new Promise(resolve => setTimeout(resolve, 1500));
            setDrafts(prev => prev.filter(d => d.id !== draft.id));
            Alert.alert('Message Sent', `Message sent to ${draft.memberName}`);
            console.log('Draft sent to:', draft.memberEmail);
          }},
      ]
    );
  }, []);

  const generateBulkMessages = useCallback(async (targetMembers: MemberEngagementStats[]) => {
    setIsRunningAutomation(true);
    setBulkGenerationProgress(0);
    const newQueue: QueuedMessage[] = [];

    for (let i = 0; i < targetMembers.length; i++) {
      const member = targetMembers[i];
      setBulkGenerationProgress(Math.round(((i + 1) / targetMembers.length) * 100));

      try {
        const prompt = `Generate a personalized re-engagement email for ${member.memberName}. 
          They haven't been active for ${member.daysSinceLastActivity} days. 
          Their total investment is ${formatCurrency(member.totalInvested)}. 
          Risk level: ${member.riskLevel}.
          
          Write a professional but warm email from IVX HOLDINGS LLC encouraging them to return.
          Keep it to 2-3 paragraphs. Include a call to action. Only output the email body.`;

        const response = await generateText(prompt);
        
        newQueue.push({
          id: `queue-${Date.now()}-${i}`,
          memberId: member.memberId,
          memberName: member.memberName,
          memberEmail: member.memberEmail,
          message: response,
          status: 'pending',
          scheduledAt: new Date().toISOString()});
        console.log('Generated message for:', member.memberName);
      } catch (error) {
        console.error('Error generating message for:', member.memberName, error);
        newQueue.push({
          id: `queue-${Date.now()}-${i}`,
          memberId: member.memberId,
          memberName: member.memberName,
          memberEmail: member.memberEmail,
          message: `Dear ${member.memberName},\n\nWe noticed it's been a while since your last visit to IVX HOLDINGS. We wanted to reach out and let you know about some exciting new investment opportunities.\n\nOur team has curated premium real estate properties with attractive yields. We'd love to help you explore these options.\n\nBest regards,\nIVX HOLDINGS Team`,
          status: 'pending',
          scheduledAt: new Date().toISOString()});
      }
    }

    setMessageQueue(newQueue);
    setIsRunningAutomation(false);
    setBulkGenerationProgress(0);

    const newActivity: MemberActivity = {
      id: `act-bulk-${Date.now()}`,
      memberId: 'system',
      memberName: 'AI System',
      type: 'system' as MemberActivity['type'],
      description: `Generated ${newQueue.length} AI re-engagement messages`,
      createdAt: new Date().toISOString()};
    setActivities(prev => [newActivity, ...prev]);

    Alert.alert('Success', `Generated ${newQueue.length} personalized messages. Ready to send!`);
  }, []);

  const sendBulkMessages = useCallback(async () => {
    const atRiskMembers = inactiveMembers.filter(m => m.riskLevel === 'at_risk' || m.riskLevel === 'inactive');
    
    Alert.alert(
      'Send Bulk Messages',
      `This will send AI-generated re-engagement messages to ${atRiskMembers.length} inactive members. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send All',
          onPress: async () => {
            await generateBulkMessages(atRiskMembers);
          }},
      ]
    );
  }, [inactiveMembers, generateBulkMessages]);

  const sendQueuedMessages = useCallback(async () => {
    const pendingMessages = messageQueue.filter(m => m.status === 'pending');
    if (pendingMessages.length === 0) {
      Alert.alert('No Messages', 'No pending messages to send.');
      return;
    }

    Alert.alert(
      'Send All Queued Messages',
      `Send ${pendingMessages.length} messages now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send All',
          onPress: async () => {
            setMessageQueue(prev => prev.map(m => ({ ...m, status: 'sending' as const })));
            await new Promise(resolve => setTimeout(resolve, 2000));
            setMessageQueue(prev => prev.map(m => ({ ...m, status: 'sent' as const })));
            
            setAutomationSettings(prev => ({
              ...prev,
              messagesSentToday: prev.messagesSentToday + pendingMessages.length}));

            const newActivity: MemberActivity = {
              id: `act-sent-${Date.now()}`,
              memberId: 'system',
              memberName: 'AI System',
              type: 'system' as MemberActivity['type'],
              description: `Sent ${pendingMessages.length} re-engagement messages`,
              createdAt: new Date().toISOString()};
            setActivities(prev => [newActivity, ...prev]);

            Alert.alert('Success', `${pendingMessages.length} messages sent successfully!`);
            console.log('Messages sent to:', pendingMessages.map(m => m.memberEmail));
          }},
      ]
    );
  }, [messageQueue]);

  const runAutomation = useCallback(async () => {
    if (!automationSettings.enabled) {
      Alert.alert('Automation Disabled', 'Enable automation in settings first.');
      return;
    }

    const remaining = automationSettings.dailyMessageLimit - automationSettings.messagesSentToday;
    if (remaining <= 0) {
      Alert.alert('Daily Limit Reached', 'You have reached your daily message limit.');
      return;
    }

    const targetMembers = inactiveMembers
      .filter(m => m.daysSinceLastActivity >= automationSettings.inactiveDaysThreshold)
      .slice(0, remaining);

    if (targetMembers.length === 0) {
      Alert.alert('No Targets', 'No members match the current criteria.');
      return;
    }

    Alert.alert(
      'Run AI Engagement',
      `This will generate and ${automationSettings.autoSendMessages ? 'send' : 'queue'} messages for ${targetMembers.length} inactive members.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run',
          onPress: async () => {
            await generateBulkMessages(targetMembers);
            setAutomationSettings(prev => ({
              ...prev,
              lastRunTime: new Date().toISOString()}));
          }},
      ]
    );
  }, [automationSettings, inactiveMembers, generateBulkMessages]);

  

  const renderOverview = () => (
    <View style={styles.overviewContainer}>
      <View style={styles.automationBanner}>
        <View style={styles.automationBannerLeft}>
          <View style={[styles.automationStatus, automationSettings.enabled && styles.automationStatusActive]}>
            <Bot size={16} color={automationSettings.enabled ? Colors.positive : Colors.textSecondary} />
          </View>
          <View>
            <Text style={styles.automationBannerTitle}>AI Auto-Engagement</Text>
            <Text style={styles.automationBannerSubtitle}>
              {automationSettings.enabled ? `Active • ${automationSettings.messagesSentToday}/${automationSettings.dailyMessageLimit} today` : 'Disabled'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.runButton} onPress={runAutomation} disabled={isRunningAutomation}>
          {isRunningAutomation ? (
            <ShimmerIndicator size="small" color="#fff" />
          ) : (
            <>
              <Play size={14} color="#fff" />
              <Text style={styles.runButtonText}>Run Now</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {isRunningAutomation && (
        <View style={styles.progressBanner}>
          <Text style={styles.progressText}>Generating messages... {bulkGenerationProgress}%</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${bulkGenerationProgress}%` }]} />
          </View>
        </View>
      )}

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, styles.statCardPrimary]}>
          <Users size={24} color="#fff" />
          <Text style={styles.statValueLight}>{stats.totalMembers}</Text>
          <Text style={styles.statLabelLight}>Total Members</Text>
        </View>
        <View style={styles.statCard}>
          <Activity size={22} color={Colors.positive} />
          <Text style={styles.statValue}>{stats.activeMembers}</Text>
          <Text style={styles.statLabel}>Active (48h)</Text>
        </View>
        <View style={styles.statCard}>
          <AlertTriangle size={22} color={Colors.warning} />
          <Text style={styles.statValue}>{stats.atRiskMembers}</Text>
          <Text style={styles.statLabel}>At Risk</Text>
        </View>
        <View style={styles.statCard}>
          <TrendingDown size={22} color={Colors.negative} />
          <Text style={styles.statValue}>{stats.churnedMembers}</Text>
          <Text style={styles.statLabel}>Churned</Text>
        </View>
      </View>

      {messageQueue.length > 0 && (
        <View style={styles.queueSection}>
          <View style={styles.queueHeader}>
            <MessageSquare size={18} color={Colors.primary} />
            <Text style={styles.queueTitle}>Message Queue</Text>
            <View style={styles.queueBadge}>
              <Text style={styles.queueBadgeText}>{messageQueue.filter(m => m.status === 'pending').length}</Text>
            </View>
          </View>
          <View style={styles.queueActions}>
            <TouchableOpacity style={styles.sendQueueButton} onPress={sendQueuedMessages}>
              <Send size={14} color="#fff" />
              <Text style={styles.sendQueueText}>Send All Pending</Text>
            </TouchableOpacity>
          </View>
          {messageQueue.slice(0, 3).map(msg => (
            <View key={msg.id} style={styles.queueItem}>
              <View style={styles.queueItemInfo}>
                <Text style={styles.queueItemName}>{msg.memberName}</Text>
                <Text style={styles.queueItemEmail}>{msg.memberEmail}</Text>
              </View>
              <View style={[styles.queueItemStatus, { backgroundColor: msg.status === 'sent' ? Colors.positive + '20' : msg.status === 'sending' ? Colors.warning + '20' : Colors.primary + '20' }]}>
                {msg.status === 'sent' && <CheckCircle size={12} color={Colors.positive} />}
                {msg.status === 'sending' && <ShimmerIndicator size={10} color={Colors.warning} />}
                <Text style={[styles.queueItemStatusText, { color: msg.status === 'sent' ? Colors.positive : msg.status === 'sending' ? Colors.warning : Colors.primary }]}>
                  {msg.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.aiSection}>
        <View style={styles.aiHeader}>
          <Sparkles size={20} color={Colors.primary} />
          <Text style={styles.aiTitle}>AI Engagement Assistant</Text>
        </View>
        <Text style={styles.aiDescription}>
          Automatically generate and send personalized re-engagement messages to members inactive for 2+ days.
        </Text>
        <TouchableOpacity style={styles.aiButton} onPress={sendBulkMessages}>
          <Zap size={18} color="#fff" />
          <Text style={styles.aiButtonText}>Generate AI Messages for Inactive Members</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity onPress={() => setActiveTab('activity')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {activities.slice(0, 4).map((activity) => (
          <View key={activity.id} style={styles.activityCard}>
            <View style={styles.activityIcon}>{getActivityIcon(activity.type)}</View>
            <View style={styles.activityInfo}>
              <Text style={styles.activityName}>{activity.memberName}</Text>
              <Text style={styles.activityDesc}>{activity.description}</Text>
              <Text style={styles.activityTime}>{formatDate(activity.createdAt)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderInactiveMembers = () => (
    <View style={styles.listContainer}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Members Inactive 2+ Days</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={() => { void engagementQuery.refetch(); }}>
          <RefreshCw size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      {inactiveMembers.map((member) => (
        <TouchableOpacity
          key={member.memberId}
          style={styles.memberCard}
          onPress={() => router.push(`/admin/member/${member.memberId}` as any)}
        >
          <View style={styles.memberHeader}>
            {member.memberAvatar ? (
              <Image source={{ uri: member.memberAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={20} color={Colors.textSecondary} />
              </View>
            )}
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{member.memberName}</Text>
              <Text style={styles.memberEmail}>{member.memberEmail}</Text>
            </View>
            <View style={[styles.riskBadge, { backgroundColor: getRiskColor(member.riskLevel) + '20' }]}>
              {getRiskIcon(member.riskLevel)}
              <Text style={[styles.riskText, { color: getRiskColor(member.riskLevel) }]}>
                {member.riskLevel.replace('_', ' ')}
              </Text>
            </View>
          </View>

          <View style={styles.memberStats}>
            <View style={styles.memberStat}>
              <Text style={styles.memberStatLabel}>Last Active</Text>
              <Text style={styles.memberStatValue}>{member.daysSinceLastActivity}d ago</Text>
            </View>
            <View style={styles.memberStat}>
              <Text style={styles.memberStatLabel}>Invested</Text>
              <Text style={styles.memberStatValue}>{formatCurrency(member.totalInvested)}</Text>
            </View>
            <View style={styles.memberStat}>
              <Text style={styles.memberStatLabel}>Score</Text>
              <Text style={[styles.memberStatValue, { color: member.engagementScore > 50 ? Colors.positive : Colors.negative }]}>
                {member.engagementScore}%
              </Text>
            </View>
          </View>

          {member.suggestedAction && (
            <View style={styles.actionRow}>
              <Text style={styles.suggestedAction}>{member.suggestedAction}</Text>
              <TouchableOpacity
                style={styles.sendMessageBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  void generateAIMessage(member);
                }}
              >
                <Sparkles size={14} color="#fff" />
                <Text style={styles.sendMessageText}>AI Message</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderMessages = () => (
    <View style={styles.listContainer}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Sent Messages</Text>
        <View style={styles.messageBadge}>
          <Mail size={14} color={Colors.primary} />
          <Text style={styles.messageBadgeText}>0</Text>
        </View>
      </View>
      {([] as any[]).map((msg: any) => (
        <View key={msg.id} style={styles.messageCard}>
          <View style={styles.messageHeader}>
            <View style={styles.messageRecipient}>
              <Text style={styles.messageName}>{msg.memberName}</Text>
              <Text style={styles.messageEmail}>{msg.memberEmail}</Text>
            </View>
            <View style={[styles.messageStatus, { backgroundColor: msg.status === 'opened' ? Colors.positive + '20' : Colors.primary + '20' }]}>
              <Text style={[styles.messageStatusText, { color: msg.status === 'opened' ? Colors.positive : Colors.primary }]}>
                {msg.status}
              </Text>
            </View>
          </View>
          <Text style={styles.messageSubject}>{msg.subject}</Text>
          <Text style={styles.messagePreview} numberOfLines={2}>{msg.message}</Text>
          <View style={styles.messageFooter}>
            {msg.aiGenerated && (
              <View style={styles.aiBadge}>
                <Sparkles size={12} color={Colors.primary} />
                <Text style={styles.aiBadgeText}>AI Generated</Text>
              </View>
            )}
            <Text style={styles.messageDate}>{formatDate(msg.createdAt)}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderDrafts = () => (
    <View style={styles.listContainer}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Saved Drafts</Text>
        <View style={styles.messageBadge}>
          <FileText size={14} color={Colors.primary} />
          <Text style={styles.messageBadgeText}>{drafts.length}</Text>
        </View>
      </View>

      {drafts.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No Drafts</Text>
          <Text style={styles.emptyDescription}>
            Generated messages saved as drafts will appear here.
          </Text>
        </View>
      ) : (
        drafts.map((draft) => (
          <View key={draft.id} style={styles.draftCard}>
            <View style={styles.draftHeader}>
              <View style={styles.draftRecipient}>
                {draft.memberAvatar ? (
                  <Image source={{ uri: draft.memberAvatar }} style={styles.draftAvatar} />
                ) : (
                  <View style={styles.draftAvatarPlaceholder}>
                    <User size={16} color={Colors.textSecondary} />
                  </View>
                )}
                <View>
                  <Text style={styles.draftName}>{draft.memberName}</Text>
                  <Text style={styles.draftEmail}>{draft.memberEmail}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.deleteDraftBtn}
                onPress={() => deleteDraft(draft.id)}
              >
                <X size={16} color={Colors.negative} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.draftSubject}>{draft.subject}</Text>
            <Text style={styles.draftPreview} numberOfLines={3}>{draft.message}</Text>
            
            <View style={styles.draftFooter}>
              <Text style={styles.draftDate}>Updated {formatDate(draft.updatedAt)}</Text>
              <View style={styles.draftActions}>
                <TouchableOpacity
                  style={styles.editDraftBtn}
                  onPress={() => openDraftForEdit(draft)}
                >
                  <FileText size={14} color={Colors.primary} />
                  <Text style={styles.editDraftText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sendDraftBtn}
                  onPress={() => sendDraft(draft)}
                >
                  <Send size={14} color="#fff" />
                  <Text style={styles.sendDraftText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );

  const renderActivity = () => (
    <View style={styles.listContainer}>
      <Text style={styles.listTitle}>All Member Activity</Text>
      {activities.map((activity) => (
        <View key={activity.id} style={styles.activityCardFull}>
          <View style={styles.activityIconLarge}>{getActivityIcon(activity.type)}</View>
          <View style={styles.activityInfoFull}>
            <Text style={styles.activityNameFull}>{activity.memberName}</Text>
            <Text style={styles.activityDescFull}>{activity.description}</Text>
            <View style={styles.activityMeta}>
              <Text style={styles.activityType}>{activity.type.replace('_', ' ')}</Text>
              <Text style={styles.activityTimeFull}>{formatDate(activity.createdAt)}</Text>
            </View>
          </View>
          {activity.memberId !== 'system' && (
            <TouchableOpacity onPress={() => router.push(`/admin/member/${activity.memberId}` as any)}>
              <ChevronRight size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );

  const renderAutomation = () => (
    <View style={styles.listContainer}>
      <View style={styles.automationHeader}>
        <Bot size={24} color={Colors.primary} />
        <Text style={styles.automationTitle}>AI Automation Settings</Text>
      </View>

      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Enable AI Engagement</Text>
            <Text style={styles.settingDesc}>Automatically identify and engage inactive members</Text>
          </View>
          <Switch
            value={automationSettings.enabled}
            onValueChange={(value) => setAutomationSettings(prev => ({ ...prev, enabled: value }))}
            trackColor={{ false: Colors.border, true: Colors.primary + '50' }}
            thumbColor={automationSettings.enabled ? Colors.primary : Colors.textTertiary}
          />
        </View>

        <View style={styles.settingDivider} />

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto-Send Messages</Text>
            <Text style={styles.settingDesc}>Send messages automatically without review</Text>
          </View>
          <Switch
            value={automationSettings.autoSendMessages}
            onValueChange={(value) => setAutomationSettings(prev => ({ ...prev, autoSendMessages: value }))}
            trackColor={{ false: Colors.border, true: Colors.primary + '50' }}
            thumbColor={automationSettings.autoSendMessages ? Colors.primary : Colors.textTertiary}
          />
        </View>

        <View style={styles.settingDivider} />

        <View style={styles.settingRowVertical}>
          <Text style={styles.settingLabel}>Inactive Days Threshold</Text>
          <Text style={styles.settingDesc}>Target members inactive for X+ days</Text>
          <View style={styles.thresholdSelector}>
            {[1, 2, 3, 5, 7].map(days => (
              <TouchableOpacity
                key={days}
                style={[
                  styles.thresholdOption,
                  automationSettings.inactiveDaysThreshold === days && styles.thresholdOptionActive
                ]}
                onPress={() => setAutomationSettings(prev => ({ ...prev, inactiveDaysThreshold: days }))}
              >
                <Text style={[
                  styles.thresholdText,
                  automationSettings.inactiveDaysThreshold === days && styles.thresholdTextActive
                ]}>{days}d</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.settingDivider} />

        <View style={styles.settingRowVertical}>
          <Text style={styles.settingLabel}>Daily Message Limit</Text>
          <Text style={styles.settingDesc}>{automationSettings.messagesSentToday} of {automationSettings.dailyMessageLimit} sent today</Text>
          <View style={styles.limitBar}>
            <View style={[styles.limitFill, { width: `${(automationSettings.messagesSentToday / automationSettings.dailyMessageLimit) * 100}%` }]} />
          </View>
        </View>
      </View>

      <View style={styles.statsSection}>
        <Text style={styles.statsSectionTitle}>Engagement Performance</Text>
        <View style={styles.performanceGrid}>
          <View style={styles.performanceCard}>
            <Text style={styles.performanceValue}>{stats.messagesSent}</Text>
            <Text style={styles.performanceLabel}>Messages Sent</Text>
          </View>
          <View style={styles.performanceCard}>
            <Text style={styles.performanceValue}>{stats.messagesOpened}</Text>
            <Text style={styles.performanceLabel}>Opened</Text>
          </View>
          <View style={styles.performanceCard}>
            <Text style={[styles.performanceValue, { color: Colors.positive }]}>
              {stats.messagesSent > 0 ? Math.round((stats.messagesOpened / stats.messagesSent) * 100) : 0}%
            </Text>
            <Text style={styles.performanceLabel}>Open Rate</Text>
          </View>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Bell size={18} color={Colors.warning} />
        <Text style={styles.infoText}>
          AI will automatically send personalized re-engagement messages to members who have not returned in {automationSettings.inactiveDaysThreshold}+ days.
        </Text>
      </View>

      {automationSettings.lastRunTime && (
        <View style={styles.lastRunInfo}>
          <Clock size={14} color={Colors.textTertiary} />
          <Text style={styles.lastRunText}>Last run: {formatDate(automationSettings.lastRunTime)}</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Engagement</Text>
          <Text style={styles.subtitle}>AI-powered member engagement</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScrollWrapper} contentContainerStyle={styles.tabContainer} alwaysBounceVertical={false}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'inactive', label: 'Inactive' },
          { key: 'messages', label: 'Messages' },
          { key: 'drafts', label: `Drafts${drafts.length > 0 ? ` (${drafts.length})` : ''}` },
          { key: 'activity', label: 'Activity' },
          { key: 'automation', label: 'AI Settings' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as TabType)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'inactive' && renderInactiveMembers()}
        {activeTab === 'messages' && renderMessages()}
        {activeTab === 'drafts' && renderDrafts()}
        {activeTab === 'activity' && renderActivity()}
        {activeTab === 'automation' && renderAutomation()}
        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showMessageModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMessageModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowMessageModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>AI Generated Message</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedMember && (
            <View style={styles.modalRecipient}>
              <Text style={styles.modalRecipientLabel}>To:</Text>
              <Text style={styles.modalRecipientName}>{selectedMember.memberName}</Text>
              <Text style={styles.modalRecipientEmail}>{selectedMember.memberEmail}</Text>
            </View>
          )}

          <ScrollView style={styles.modalContent}>
            {isGenerating ? (
              <View style={styles.loadingContainer}>
                <ShimmerIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Generating personalized message...</Text>
              </View>
            ) : (
              <TextInput
                style={styles.messageInput}
                value={generatedMessage}
                onChangeText={setGeneratedMessage}
                multiline
                placeholder="Message will appear here..."
                placeholderTextColor={Colors.textTertiary}
              />
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.draftButton, (isGenerating || !generatedMessage) && styles.draftButtonDisabled]}
                onPress={saveAsDraft}
                disabled={isGenerating || !generatedMessage}
              >
                <FileText size={18} color={Colors.primary} />
                <Text style={styles.draftButtonText}>Save Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendButton, styles.sendButtonFlex, (isGenerating || isSending || !generatedMessage) && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={isGenerating || isSending || !generatedMessage}
              >
                {isSending ? (
                  <ShimmerIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Send size={18} color="#fff" />
                    <Text style={styles.sendButtonText}>Send</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showDraftModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDraftModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDraftModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Draft</Text>
            <TouchableOpacity onPress={updateDraft}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>

          {editingDraft && (
            <View style={styles.modalRecipient}>
              <Text style={styles.modalRecipientLabel}>To:</Text>
              <Text style={styles.modalRecipientName}>{editingDraft.memberName}</Text>
              <Text style={styles.modalRecipientEmail}>{editingDraft.memberEmail}</Text>
            </View>
          )}

          <ScrollView style={styles.modalContent}>
            <Text style={styles.inputLabel}>Subject</Text>
            <TextInput
              style={styles.subjectInput}
              value={draftSubject}
              onChangeText={setDraftSubject}
              placeholder="Enter subject..."
              placeholderTextColor={Colors.textTertiary}
            />
            
            <Text style={styles.inputLabel}>Message</Text>
            <TextInput
              style={styles.messageInput}
              value={draftMessage}
              onChangeText={setDraftMessage}
              multiline
              placeholder="Enter message..."
              placeholderTextColor={Colors.textTertiary}
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.sendButton, !draftMessage && styles.sendButtonDisabled]}
              onPress={() => editingDraft && sendDraft(editingDraft)}
              disabled={!draftMessage}
            >
              <Send size={18} color="#fff" />
              <Text style={styles.sendButtonText}>Send Message</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  tabScrollWrapper: { flexGrow: 0, flexShrink: 0, marginHorizontal: 16, marginBottom: 12 },
  tabContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, gap: 4 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', borderRadius: 10, justifyContent: 'center' },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: '#000' },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 140 },
  overviewContainer: { gap: 16 },
  automationBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  automationBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  automationStatus: { gap: 4 },
  automationStatusActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  automationBannerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  automationBannerSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  runButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  runButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  progressBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  progressText: { color: Colors.textTertiary, fontSize: 12 },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  queueSection: { marginBottom: 16 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  queueTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  queueBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  queueBadgeText: { fontSize: 11, fontWeight: '700' as const },
  queueActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  sendQueueButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendQueueText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  queueItemInfo: { flex: 1 },
  queueItemName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  queueItemEmail: { color: Colors.textSecondary, fontSize: 13 },
  queueItemStatus: { gap: 4 },
  queueItemStatusText: { color: Colors.textSecondary, fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statCardPrimary: { backgroundColor: Colors.primary },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statValueLight: { color: Colors.black },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statLabelLight: { color: Colors.black, opacity: 0.7 },
  aiSection: { marginBottom: 16 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  aiTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  aiDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  aiButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  aiButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  seeAll: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  activityCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  activityIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  activityInfo: { flex: 1 },
  activityName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  activityDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  activityTime: { color: Colors.textTertiary, fontSize: 12 },
  listContainer: { gap: 10 },
  listHeader: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  refreshButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  memberCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  memberInfo: { flex: 1 },
  memberName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  memberEmail: { color: Colors.textSecondary, fontSize: 13 },
  riskBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  riskText: { color: Colors.textSecondary, fontSize: 13 },
  memberStats: { gap: 4 },
  memberStat: { gap: 4 },
  memberStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  memberStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestedAction: { gap: 4 },
  sendMessageBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendMessageText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  messageBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  messageBadgeText: { fontSize: 11, fontWeight: '700' as const },
  messageCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  messageRecipient: { gap: 4 },
  messageName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  messageEmail: { color: Colors.textSecondary, fontSize: 13 },
  messageStatus: { gap: 4 },
  messageStatusText: { color: Colors.textSecondary, fontSize: 13 },
  messageSubject: { gap: 4 },
  messagePreview: { gap: 8 },
  messageFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  aiBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  aiBadgeText: { fontSize: 11, fontWeight: '700' as const },
  messageDate: { color: Colors.textTertiary, fontSize: 12 },
  activityCardFull: { flex: 1 },
  activityIconLarge: { gap: 4 },
  activityInfoFull: { flex: 1 },
  activityNameFull: { flex: 1 },
  activityDescFull: { flex: 1 },
  activityMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activityType: { gap: 4 },
  activityTimeFull: { flex: 1 },
  bottomPadding: { height: 120 },
  automationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  automationTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  settingsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingRowVertical: { gap: 4 },
  settingInfo: { flex: 1 },
  settingLabel: { color: Colors.textSecondary, fontSize: 13 },
  settingDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  settingDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  thresholdSelector: { gap: 4 },
  thresholdOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  thresholdOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  thresholdText: { color: Colors.textSecondary, fontSize: 13 },
  thresholdTextActive: { color: '#000' },
  limitBar: { gap: 4 },
  limitFill: { gap: 4 },
  statsSection: { marginBottom: 16 },
  statsSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  performanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  performanceCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  performanceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  performanceLabel: { color: Colors.textSecondary, fontSize: 13 },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  lastRunInfo: { flex: 1 },
  lastRunText: { color: Colors.textSecondary, fontSize: 13 },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalRecipient: { gap: 4 },
  modalRecipientLabel: { color: Colors.textSecondary, fontSize: 13 },
  modalRecipientName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  modalRecipientEmail: { color: Colors.textSecondary, fontSize: 13 },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  loadingContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 13 },
  messageInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  modalFooter: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  sendButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  draftButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  draftButtonDisabled: { opacity: 0.4 },
  draftButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  sendButtonFlex: { gap: 4 },
  saveText: { color: Colors.textSecondary, fontSize: 13 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  subjectInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptyDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  draftCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  draftRecipient: { gap: 4 },
  draftAvatar: { width: 36, height: 36, borderRadius: 18 },
  draftAvatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  draftName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  draftEmail: { color: Colors.textSecondary, fontSize: 13 },
  deleteDraftBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  draftSubject: { gap: 4 },
  draftPreview: { gap: 8 },
  draftFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  draftDate: { color: Colors.textTertiary, fontSize: 12 },
  draftActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  editDraftBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  editDraftText: { color: Colors.textSecondary, fontSize: 13 },
  sendDraftBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendDraftText: { color: '#000000', fontSize: 13, fontWeight: '600' as const }});
