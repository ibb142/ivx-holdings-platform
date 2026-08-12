import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { generateText } from '@/lib/ai-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  Animated} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Send,
  Mail,
  MessageSquare,
  Bell,
  Users,
  UserCheck,
  UserX,
  Shield,
  DollarSign,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Clock,
  AlertCircle,
  FileText,
  Search,
  Play,
  Pause,
  RotateCcw,
  Settings,
  User,
  Sparkles,
  Save,
  Trash2,
  Edit3,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import {
  BroadcastChannel,
  RecipientFilter,
  BroadcastTemplate,
  BroadcastRecipient,
  BroadcastMessage} from '@/types';

type TabType = 'compose' | 'drafts' | 'history';

interface Draft {
  id: string;
  subject: string;
  body: string;
  channels: BroadcastChannel[];
  recipientFilter: RecipientFilter;
  createdAt: string;
  updatedAt: string;
}

const DRAFTS_STORAGE_KEY = 'broadcast_drafts';

const BATCH_SIZES = [1, 10, 50, 100, 500, 1000, 10000, 100000, 1000000];

const RECIPIENT_FILTERS: { key: RecipientFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All Members', icon: <Users size={18} color={Colors.primary} /> },
  { key: 'active', label: 'Active Members', icon: <UserCheck size={18} color={Colors.positive} /> },
  { key: 'inactive', label: 'Inactive Members', icon: <UserX size={18} color={Colors.negative} /> },
  { key: 'kyc_pending', label: 'KYC Pending', icon: <Shield size={18} color={Colors.warning} /> },
  { key: 'high_value', label: 'High Value ($50k+)', icon: <DollarSign size={18} color={Colors.primary} /> },
  { key: 'custom', label: 'Custom Selection', icon: <Settings size={18} color={Colors.textSecondary} /> },
];

export default function BroadcastScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('compose');
  const [channels, setChannels] = useState<BroadcastChannel[]>(['email']);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [batchSize, setBatchSize] = useState(100);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const [showBatchPicker, setShowBatchPicker] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<BroadcastRecipient[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  
  const progressAnim = useRef(new Animated.Value(0)).current;
  const sendingRef = useRef(false);

  useEffect(() => {
    void loadDrafts();
  }, []);

  const loadDrafts = async () => {
    try {
      const stored = await AsyncStorage.getItem(DRAFTS_STORAGE_KEY);
      if (stored) {
        setDrafts(JSON.parse(stored));
      }
    } catch (error) {
      console.log('Error loading drafts:', error);
    }
  };

  const saveDrafts = async (newDrafts: Draft[]) => {
    try {
      await AsyncStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(newDrafts));
      setDrafts(newDrafts);
    } catch (error) {
      console.log('Error saving drafts:', error);
    }
  };

  const profilesQuery = useQuery({
    queryKey: ['admin-broadcast-profiles'],
    queryFn: async () => {
      console.log('[Broadcast] Fetching profiles from Supabase');
      const { data, error } = await supabase.from('profiles').select('*').limit(500);
      if (error) { console.log('[Broadcast] error:', error.message); return []; }
      return (data ?? []).map((p: any): BroadcastRecipient => ({
        id: p.id,
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
        email: p.email || '',
        phone: p.phone || '',
        avatar: p.avatar,
        selected: false}));
    },
    staleTime: 30000});

  const broadcastTemplates: BroadcastTemplate[] = [
    { id: 'tpl-1', name: 'Welcome New Member', subject: 'Welcome to IVX HOLDINGS', body: 'Dear {{name}},\n\nWelcome to IVX HOLDINGS!', category: 'welcome' },
    { id: 'tpl-2', name: 'Re-engagement', subject: 'We Miss You!', body: 'Hi {{name}},\n\nIt\'s been a while...', category: 'reengagement' },
    { id: 'tpl-3', name: 'New Property Alert', subject: 'New Investment Opportunity', body: 'Dear {{name}},\n\nNew property available!', category: 'promotion' },
    { id: 'tpl-4', name: 'Dividend Distribution', subject: 'Your Dividend Has Been Processed', body: 'Dear {{name}},\n\nYour dividend has been processed.', category: 'update' },
    { id: 'tpl-5', name: 'KYC Reminder', subject: 'Complete Your KYC', body: 'Hi {{name}},\n\nPlease complete your KYC.', category: 'reminder' },
  ];

  const broadcastStats: { totalSent: number; totalDelivered: number; totalFailed: number; totalOpened: number; deliveryRate: number; openRate: number } = { totalSent: 0, totalDelivered: 0, totalFailed: 0, totalOpened: 0, deliveryRate: 0, openRate: 0 };

  const allProfiles = profilesQuery.data ?? [];

  const stableProfiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);

  const recipients = useMemo(() => {
    if (recipientFilter === 'custom') return selectedRecipients;
    return stableProfiles;
  }, [recipientFilter, selectedRecipients, stableProfiles]);

  const filteredMembers = useMemo(() => {
    const allRecipients: BroadcastRecipient[] = stableProfiles;
    if (!searchQuery) return allRecipients;
    const query = searchQuery.toLowerCase();
    return allRecipients.filter(
      r => r.name.toLowerCase().includes(query) || r.email.toLowerCase().includes(query)
    );
  }, [searchQuery, stableProfiles]);

  const toggleChannel = useCallback((channel: BroadcastChannel) => {
    setChannels(prev => {
      if (prev.includes(channel)) {
        if (prev.length === 1) return prev;
        return prev.filter(c => c !== channel);
      }
      return [...prev, channel];
    });
  }, []);

  const applyTemplate = useCallback((template: BroadcastTemplate) => {
    setSubject(template.subject);
    setBody(template.body);
    setShowTemplates(false);
  }, []);

  const toggleRecipient = useCallback((recipient: BroadcastRecipient) => {
    setSelectedRecipients(prev => {
      const exists = prev.find(r => r.id === recipient.id);
      if (exists) {
        return prev.filter(r => r.id !== recipient.id);
      }
      return [...prev, { ...recipient, selected: true }];
    });
  }, []);

  const selectAllRecipients = useCallback(() => {
    setSelectedRecipients(filteredMembers.map(r => ({ ...r, selected: true })));
  }, [filteredMembers]);

  const deselectAllRecipients = useCallback(() => {
    setSelectedRecipients([]);
  }, []);

  const simulateSending = useCallback(() => {
    if (!sendingRef.current || isPaused) return;
    
    const recipientCount = recipients.length;
    const batchCount = Math.ceil(recipientCount / batchSize);
    const delayPerBatch = 500;
    
    let currentBatch = Math.floor(sentCount / batchSize);
    
    if (currentBatch >= batchCount) {
      setIsSending(false);
      sendingRef.current = false;
      Alert.alert('Success', `Successfully sent ${recipientCount} messages!`);
      return;
    }
    
    const nextSentCount = Math.min((currentBatch + 1) * batchSize, recipientCount);
    const progress = (nextSentCount / recipientCount) * 100;
    
    setSentCount(nextSentCount);
    
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false}).start();
    
    setTimeout(() => {
      simulateSending();
    }, delayPerBatch);
  }, [batchSize, recipients.length, sentCount, isPaused, progressAnim]);

  useEffect(() => {
    if (isSending && !isPaused) {
      sendingRef.current = true;
      simulateSending();
    }
  }, [isSending, isPaused, simulateSending]);

  const startSending = useCallback(() => {
    if (!subject.trim() || !body.trim()) {
      Alert.alert('Error', 'Please enter a subject and message body');
      return;
    }
    if (recipients.length === 0) {
      Alert.alert('Error', 'No recipients selected');
      return;
    }
    
    Alert.alert(
      'Confirm Send',
      `Send ${channels.join(', ')} to ${recipients.length} recipients in batches of ${batchSize}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            setIsSending(true);
            setIsPaused(false);
            setSentCount(0);
            progressAnim.setValue(0);
          }},
      ]
    );
  }, [subject, body, recipients.length, channels, batchSize, progressAnim]);

  const pauseSending = useCallback(() => {
    setIsPaused(true);
    sendingRef.current = false;
  }, []);

  const resumeSending = useCallback(() => {
    setIsPaused(false);
  }, []);

  const cancelSending = useCallback(() => {
    Alert.alert(
      'Cancel Sending',
      `${sentCount} of ${recipients.length} messages have been sent. Are you sure you want to cancel?`,
      [
        { text: 'Continue Sending', style: 'cancel', onPress: resumeSending },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => {
            setIsSending(false);
            sendingRef.current = false;
            setIsPaused(false);
            setSentCount(0);
            progressAnim.setValue(0);
          }},
      ]
    );
  }, [sentCount, recipients.length, resumeSending, progressAnim]);

  const resetForm = useCallback(() => {
    setSubject('');
    setBody('');
    setChannels(['email']);
    setRecipientFilter('all');
    setSelectedRecipients([]);
    setBatchSize(100);
    setIsSending(false);
    setSentCount(0);
    setEditingDraftId(null);
    progressAnim.setValue(0);
  }, [progressAnim]);

  const generateAiContent = useCallback(async () => {
    if (!aiPrompt.trim()) {
      Alert.alert('Error', 'Please enter a prompt for AI generation');
      return;
    }
    
    setIsGenerating(true);
    try {
      const prompt = `Generate a professional broadcast message for the following request. Provide a subject line and body separately.

Request: ${aiPrompt}

Format your response as:
SUBJECT: [subject line here]
BODY: [message body here]

Use {{name}} for personalization where appropriate.`;
      
      const result = await generateText({ messages: [{ role: 'user', content: prompt }] });
      
      const subjectMatch = result.match(/SUBJECT:\s*(.+?)(?=\nBODY:|$)/s);
      const bodyMatch = result.match(/BODY:\s*(.+)/s);
      
      if (subjectMatch) {
        setSubject(subjectMatch[1].trim());
      }
      if (bodyMatch) {
        setBody(bodyMatch[1].trim());
      }
      
      setShowAiGenerator(false);
      setAiPrompt('');
    } catch (error) {
      console.log('AI generation error:', error);
      Alert.alert('Error', 'Failed to generate content. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [aiPrompt]);

  const saveToDraft = useCallback(() => {
    if (!subject.trim() && !body.trim()) {
      Alert.alert('Error', 'Please enter a subject or message body to save as draft');
      return;
    }
    
    const now = new Date().toISOString();
    
    if (editingDraftId) {
      const updated = drafts.map(d => 
        d.id === editingDraftId 
          ? { ...d, subject, body, channels, recipientFilter, updatedAt: now }
          : d
      );
      void saveDrafts(updated);
      Alert.alert('Success', 'Draft updated successfully');
    } else {
      const newDraft: Draft = {
        id: Date.now().toString(),
        subject,
        body,
        channels,
        recipientFilter,
        createdAt: now,
        updatedAt: now};
      void saveDrafts([newDraft, ...drafts]);
      Alert.alert('Success', 'Saved to drafts');
    }
    
    setEditingDraftId(null);
  }, [subject, body, channels, recipientFilter, drafts, editingDraftId]);

  const loadDraft = useCallback((draft: Draft) => {
    setSubject(draft.subject);
    setBody(draft.body);
    setChannels(draft.channels);
    setRecipientFilter(draft.recipientFilter);
    setEditingDraftId(draft.id);
    setActiveTab('compose');
  }, []);

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
            const updated = drafts.filter(d => d.id !== draftId);
            void saveDrafts(updated);
            if (editingDraftId === draftId) {
              setEditingDraftId(null);
            }
          }},
      ]
    );
  }, [drafts, editingDraftId]);

  const sendDraft = useCallback((draft: Draft) => {
    setSubject(draft.subject);
    setBody(draft.body);
    setChannels(draft.channels);
    setRecipientFilter(draft.recipientFilter);
    setEditingDraftId(draft.id);
    setActiveTab('compose');
    
    setTimeout(() => {
      startSending();
    }, 100);
  }, [startSending]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const getStatusColor = (status: BroadcastMessage['status']) => {
    switch (status) {
      case 'completed': return Colors.positive;
      case 'sending': return Colors.primary;
      case 'failed': return Colors.negative;
      case 'paused': return Colors.warning;
      default: return Colors.textSecondary;
    }
  };

  const renderComposeTab = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatNumber(broadcastStats.totalSent)}</Text>
          <Text style={styles.statLabel}>Total Sent</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.positive }]}>{broadcastStats.deliveryRate}%</Text>
          <Text style={styles.statLabel}>Delivered</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.primary }]}>{broadcastStats.openRate}%</Text>
          <Text style={styles.statLabel}>Open Rate</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Channels</Text>
        <View style={styles.channelRow}>
          <TouchableOpacity
            style={[styles.channelBtn, channels.includes('email') && styles.channelBtnActive]}
            onPress={() => toggleChannel('email')}
          >
            <Mail size={20} color={channels.includes('email') ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.channelText, channels.includes('email') && styles.channelTextActive]}>
              Email
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.channelBtn, channels.includes('sms') && styles.channelBtnActive]}
            onPress={() => toggleChannel('sms')}
          >
            <MessageSquare size={20} color={channels.includes('sms') ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.channelText, channels.includes('sms') && styles.channelTextActive]}>
              SMS
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.channelBtn, channels.includes('push') && styles.channelBtnActive]}
            onPress={() => toggleChannel('push')}
          >
            <Bell size={20} color={channels.includes('push') ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.channelText, channels.includes('push') && styles.channelTextActive]}>
              Push
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recipients</Text>
          <TouchableOpacity onPress={() => setShowRecipients(true)}>
            <Text style={styles.linkText}>Select</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.recipientPicker}
          onPress={() => setShowRecipients(true)}
        >
          <View style={styles.recipientInfo}>
            {RECIPIENT_FILTERS.find(f => f.key === recipientFilter)?.icon}
            <Text style={styles.recipientText}>
              {RECIPIENT_FILTERS.find(f => f.key === recipientFilter)?.label}
            </Text>
          </View>
          <View style={styles.recipientCount}>
            <Text style={styles.recipientCountText}>{recipients.length}</Text>
            <ChevronRight size={18} color={Colors.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Batch Size</Text>
          <Text style={styles.sectionSubtitle}>Messages per batch</Text>
        </View>
        <TouchableOpacity
          style={styles.batchPicker}
          onPress={() => setShowBatchPicker(true)}
        >
          <Text style={styles.batchValue}>{formatNumber(batchSize)}</Text>
          <ChevronDown size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.batchHint}>
          {recipients.length > 0 
            ? `${Math.ceil(recipients.length / batchSize)} batches to send ${recipients.length} messages`
            : 'Select recipients to see batch estimate'}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Message</Text>
          <View style={styles.messageActions}>
            <TouchableOpacity onPress={() => setShowAiGenerator(true)} style={styles.aiBtn}>
              <Sparkles size={14} color="#8B5CF6" />
              <Text style={[styles.linkText, { color: '#8B5CF6' }]}>AI Generate</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTemplates(true)}>
              <View style={styles.templateBtn}>
                <FileText size={14} color={Colors.primary} />
                <Text style={styles.linkText}>Templates</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
        <TextInput
          style={styles.subjectInput}
          placeholder="Subject"
          placeholderTextColor={Colors.textTertiary}
          value={subject}
          onChangeText={setSubject}
        />
        <TextInput
          style={styles.bodyInput}
          placeholder="Write your message here...&#10;&#10;Use {{name}} for personalization"
          placeholderTextColor={Colors.textTertiary}
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
        />
      </View>

      {editingDraftId && (
        <View style={styles.editingBanner}>
          <Edit3 size={14} color={Colors.primary} />
          <Text style={styles.editingText}>Editing draft</Text>
          <TouchableOpacity onPress={() => setEditingDraftId(null)}>
            <X size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {isSending ? (
        <View style={styles.sendingContainer}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>
              {isPaused ? 'Paused' : 'Sending...'}
            </Text>
            <Text style={styles.progressCount}>
              {sentCount} / {recipients.length}
            </Text>
          </View>
          <View style={styles.progressBar}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%']})},
              ]}
            />
          </View>
          <View style={styles.sendingActions}>
            {isPaused ? (
              <TouchableOpacity style={styles.resumeBtn} onPress={resumeSending}>
                <Play size={18} color="#fff" />
                <Text style={styles.resumeBtnText}>Resume</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.pauseBtn} onPress={pauseSending}>
                <Pause size={18} color={Colors.warning} />
                <Text style={styles.pauseBtnText}>Pause</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelSending}>
              <X size={18} color={Colors.negative} />
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.resetBtn} onPress={resetForm}>
            <RotateCcw size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveDraftBtn} onPress={saveToDraft}>
            <Save size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sendBtn} onPress={startSending}>
            <Send size={18} color="#fff" />
            <Text style={styles.sendBtnText}>Send Broadcast</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderDraftsTab = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      {drafts.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No Drafts</Text>
          <Text style={styles.emptySubtitle}>Your saved drafts will appear here</Text>
        </View>
      ) : (
        drafts.map((draft) => (
          <View key={draft.id} style={styles.draftCard}>
            <View style={styles.draftHeader}>
              <View style={styles.draftChannels}>
                {draft.channels.includes('email') && (
                  <Mail size={14} color={Colors.textSecondary} />
                )}
                {draft.channels.includes('sms') && (
                  <MessageSquare size={14} color={Colors.textSecondary} />
                )}
                {draft.channels.includes('push') && (
                  <Bell size={14} color={Colors.textSecondary} />
                )}
              </View>
              <Text style={styles.draftDate}>
                {formatDate(draft.updatedAt)}
              </Text>
            </View>
            <Text style={styles.draftSubject}>{draft.subject || '(No subject)'}</Text>
            <Text style={styles.draftBody} numberOfLines={2}>{draft.body || '(No content)'}</Text>
            <View style={styles.draftActions}>
              <TouchableOpacity style={styles.draftEditBtn} onPress={() => loadDraft(draft)}>
                <Edit3 size={16} color={Colors.primary} />
                <Text style={styles.draftEditText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.draftSendBtn} onPress={() => sendDraft(draft)}>
                <Send size={16} color="#fff" />
                <Text style={styles.draftSendText}>Send</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.draftDeleteBtn} onPress={() => deleteDraft(draft.id)}>
                <Trash2 size={16} color={Colors.negative} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderHistoryTab = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      {([] as BroadcastMessage[]).map((broadcast) => (
        <View key={broadcast.id} style={styles.historyCard}>
          <View style={styles.historyHeader}>
            <View style={styles.historyChannels}>
              {broadcast.channels.includes('email') && (
                <Mail size={14} color={Colors.textSecondary} />
              )}
              {broadcast.channels.includes('sms') && (
                <MessageSquare size={14} color={Colors.textSecondary} />
              )}
              {broadcast.channels.includes('push') && (
                <Bell size={14} color={Colors.textSecondary} />
              )}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(broadcast.status) + '20' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(broadcast.status) }]}>
                {broadcast.status}
              </Text>
            </View>
          </View>
          <Text style={styles.historySubject}>{broadcast.subject}</Text>
          <Text style={styles.historyBody} numberOfLines={2}>{broadcast.body}</Text>
          <View style={styles.historyFooter}>
            <View style={styles.historyStats}>
              <Users size={14} color={Colors.textTertiary} />
              <Text style={styles.historyStatText}>{broadcast.sentCount} sent</Text>
              {broadcast.failedCount > 0 && (
                <>
                  <AlertCircle size={14} color={Colors.negative} />
                  <Text style={[styles.historyStatText, { color: Colors.negative }]}>
                    {broadcast.failedCount} failed
                  </Text>
                </>
              )}
            </View>
            <Text style={styles.historyDate}>
              {broadcast.completedAt ? formatDate(broadcast.completedAt) : formatDate(broadcast.createdAt)}
            </Text>
          </View>
        </View>
      ))}
      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Broadcast</Text>
          <Text style={styles.subtitle}>Send messages to members</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'compose' && styles.tabActive]}
          onPress={() => setActiveTab('compose')}
        >
          <Send size={18} color={activeTab === 'compose' ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'compose' && styles.tabTextActive]}>
            Compose
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'drafts' && styles.tabActive]}
          onPress={() => setActiveTab('drafts')}
        >
          <FileText size={18} color={activeTab === 'drafts' ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'drafts' && styles.tabTextActive]}>
            Drafts {drafts.length > 0 && `(${drafts.length})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
        >
          <Clock size={18} color={activeTab === 'history' ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'compose' && renderComposeTab()}
      {activeTab === 'drafts' && renderDraftsTab()}
      {activeTab === 'history' && renderHistoryTab()}

      <Modal visible={showTemplates} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Message Templates</Text>
              <TouchableOpacity onPress={() => setShowTemplates(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              {broadcastTemplates.map((template) => (
                <TouchableOpacity
                  key={template.id}
                  style={styles.templateCard}
                  onPress={() => applyTemplate(template)}
                >
                  <View style={styles.templateHeader}>
                    <Text style={styles.templateName}>{template.name}</Text>
                    <View style={[styles.categoryBadge, { backgroundColor: Colors.primary + '20' }]}>
                      <Text style={styles.categoryText}>{template.category}</Text>
                    </View>
                  </View>
                  <Text style={styles.templateSubject}>{template.subject}</Text>
                  <Text style={styles.templatePreview} numberOfLines={3}>
                    {template.body}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showRecipients} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Recipients</Text>
              <TouchableOpacity onPress={() => setShowRecipients(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.filterGrid}>
              {RECIPIENT_FILTERS.map((filter) => (
                <TouchableOpacity
                  key={filter.key}
                  style={[
                    styles.filterCard,
                    recipientFilter === filter.key && styles.filterCardActive,
                  ]}
                  onPress={() => {
                    setRecipientFilter(filter.key);
                    if (filter.key !== 'custom') {
                      setShowRecipients(false);
                    }
                  }}
                >
                  {filter.icon}
                  <Text style={[
                    styles.filterLabel,
                    recipientFilter === filter.key && styles.filterLabelActive,
                  ]}>
                    {filter.label}
                  </Text>
                  <Text style={styles.filterCount}>
                    {allProfiles.length}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {recipientFilter === 'custom' && (
              <>
                <View style={styles.searchBox}>
                  <Search size={18} color={Colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search members..."
                    placeholderTextColor={Colors.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>
                
                <View style={styles.selectionActions}>
                  <TouchableOpacity onPress={selectAllRecipients}>
                    <Text style={styles.linkText}>Select All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={deselectAllRecipients}>
                    <Text style={styles.linkText}>Deselect All</Text>
                  </TouchableOpacity>
                  <Text style={styles.selectedCount}>
                    {selectedRecipients.length} selected
                  </Text>
                </View>

                <ScrollView style={styles.recipientList}>
                  {filteredMembers.map((member) => {
                    const isSelected = selectedRecipients.some(r => r.id === member.id);
                    return (
                      <TouchableOpacity
                        key={member.id}
                        style={styles.recipientItem}
                        onPress={() => toggleRecipient(member)}
                      >
                        <View style={[
                          styles.checkbox,
                          isSelected && styles.checkboxChecked,
                        ]}>
                          {isSelected && <Check size={14} color="#fff" />}
                        </View>
                        {member.avatar ? (
                          <Image source={{ uri: member.avatar }} style={styles.recipientAvatar} />
                        ) : (
                          <View style={styles.avatarPlaceholder}>
                            <User size={16} color={Colors.textSecondary} />
                          </View>
                        )}
                        <View style={styles.recipientDetails}>
                          <Text style={styles.recipientName}>{member.name}</Text>
                          <Text style={styles.recipientEmail}>{member.email}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => setShowRecipients(false)}
            >
              <Text style={styles.applyBtnText}>
                Apply ({recipientFilter === 'custom' ? selectedRecipients.length : allProfiles.length} recipients)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showBatchPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowBatchPicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Batch Size</Text>
            {BATCH_SIZES.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.pickerItem, batchSize === size && styles.pickerItemActive]}
                onPress={() => {
                  setBatchSize(size);
                  setShowBatchPicker(false);
                }}
              >
                <Text style={[
                  styles.pickerItemText,
                  batchSize === size && styles.pickerItemTextActive,
                ]}>
                  {formatNumber(size)} {size === 1 ? '(One by one)' : size >= 1000000 ? '(Millions)' : ''}
                </Text>
                {batchSize === size && <Check size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAiGenerator} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.aiModalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.aiTitleRow}>
                <Sparkles size={20} color="#8B5CF6" />
                <Text style={styles.modalTitle}>AI Content Generator</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAiGenerator(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.aiContent}>
              <Text style={styles.aiLabel}>Describe what you want to communicate:</Text>
              <TextInput
                style={styles.aiInput}
                placeholder="e.g., Announce a new property listing in Miami with 8% returns, targeting high-value investors..."
                placeholderTextColor={Colors.textTertiary}
                value={aiPrompt}
                onChangeText={setAiPrompt}
                multiline
                textAlignVertical="top"
              />
              
              <View style={styles.aiHints}>
                <Text style={styles.aiHintTitle}>Tips:</Text>
                <Text style={styles.aiHint}>• Be specific about the topic and tone</Text>
                <Text style={styles.aiHint}>• Mention target audience if relevant</Text>
                <Text style={styles.aiHint}>• Include key details to highlight</Text>
              </View>
              
              <TouchableOpacity
                style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
                onPress={generateAiContent}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Text style={styles.generateBtnText}>Generating...</Text>
                ) : (
                  <>
                    <Sparkles size={18} color="#fff" />
                    <Text style={styles.generateBtnText}>Generate Content</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  tabContent: { flex: 1 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionSubtitle: { color: Colors.textTertiary, fontSize: 13, marginTop: 4 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  channelBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  channelText: { color: Colors.textSecondary, fontSize: 13 },
  channelTextActive: { color: '#000' },
  recipientPicker: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A' },
  recipientInfo: { flex: 1 },
  recipientText: { color: Colors.textSecondary, fontSize: 13 },
  recipientCount: { gap: 4 },
  recipientCountText: { color: Colors.textSecondary, fontSize: 13 },
  batchPicker: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A' },
  batchValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  batchHint: { gap: 4 },
  linkText: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  templateBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  subjectInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  bodyInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sendingContainer: { gap: 8 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  progressCount: { gap: 4 },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  sendingActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pauseBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  pauseBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  resumeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  resumeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  cancelBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  cancelBtnText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resetBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  sendBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  historyCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  historyChannels: { gap: 4 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  historySubject: { gap: 4 },
  historyBody: { gap: 8 },
  historyFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  historyStats: { gap: 4 },
  historyStatText: { color: Colors.textSecondary, fontSize: 13 },
  historyDate: { color: Colors.textTertiary, fontSize: 12 },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalScroll: { maxHeight: 400 },
  templateCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  templateHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  templateName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  categoryBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  categoryText: { color: Colors.textSecondary, fontSize: 13 },
  templateSubject: { gap: 4 },
  templatePreview: { gap: 8 },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterCardActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  filterLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 8 },
  filterLabelActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  filterCount: { gap: 4 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  selectionActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  selectedCount: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  recipientList: { gap: 8 },
  recipientItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: Colors.success, borderColor: Colors.success },
  recipientAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  recipientDetails: { flex: 1, gap: 2 },
  recipientName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  recipientEmail: { color: Colors.textSecondary, fontSize: 13 },
  applyBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  applyBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  pickerOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  pickerContent: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const, marginBottom: 16, textAlign: 'center' },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  pickerItemActive: { backgroundColor: Colors.primary + '10' },
  pickerItemText: { color: Colors.text, fontSize: 16 },
  pickerItemTextActive: { color: Colors.primary, fontWeight: '600' as const },
  messageActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  aiBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  editingBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  editingText: { color: Colors.textSecondary, fontSize: 13 },
  saveDraftBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptySubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  draftCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  draftChannels: { gap: 4 },
  draftDate: { color: Colors.textTertiary, fontSize: 12 },
  draftSubject: { gap: 4 },
  draftBody: { gap: 8 },
  draftActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  draftEditBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  draftEditText: { color: Colors.textSecondary, fontSize: 13 },
  draftSendBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  draftSendText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  draftDeleteBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  aiModalContent: { gap: 4 },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiContent: { flex: 1, gap: 4 },
  aiLabel: { color: Colors.textSecondary, fontSize: 13 },
  aiInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  aiHints: { gap: 4 },
  aiHintTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  aiHint: { gap: 4 },
  generateBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
