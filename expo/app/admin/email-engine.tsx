import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  Alert,
  Modal} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Mail,
  Server,
  Shield,
  Zap,
  Send,
  Play,
  Pause,
  X,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Activity,
  Users,
  Eye,
  MousePointer,
  MessageSquare,
  BarChart3,
  Settings,
  Plus,
  Trash2,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Gauge,
  ShieldCheck,
  ShieldAlert,
  Globe,
  Timer,
  Flame,
  Layers,
  FileText,
  Target,
  CircleDot} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';
import {
  SMTPConfig,
  EmailCampaign,
  DomainHealth,
  getWarmupLimit,
  getOptimalSendingHours,
  ANTI_BLACKLIST_RULES} from '@/lib/email-engine';
import {
  smtpConfigs as mockSmtpConfigs,
  domainHealth as mockDomainHealth,
  emailCampaigns as mockCampaigns,
  emailRecipients,
  getEngineStats} from '@/mocks/email-engine';
import {
  emailLogs as initialEmailLogs,
  getEmailLogStats,
  type EmailLog,
  type EmailLogType,
  type EmailLogStatus} from '@/mocks/email-logs';

type TabType = 'dashboard' | 'campaigns' | 'smtp' | 'protection' | 'sent_log';
type LogFilter = 'all' | 'automatic' | 'manual';
type StatusFilter = 'all' | EmailLogStatus;

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'intro',
    name: 'Introduction',
    subject: 'Intro — IVX HOLDINGS tokenized mortgage opportunity',
    body: `Dear {{name}},\n\nI'm reaching out from IVX HOLDINGS LLC to introduce an exclusive investment opportunity that I believe aligns with {{company}}'s portfolio strategy.\n\nWe specialize in tokenized first-lien mortgage investments offering:\n\n• 6-9% annual yields\n• Blockchain-verified ownership\n• Institutional-grade due diligence\n• 24/7 secondary market liquidity\n\nWould you have 15 minutes this week for a brief overview?\n\nBest regards,\nIVX HOLDINGS LLC`},
  {
    id: 'followup',
    name: 'Follow-Up',
    subject: 'Following up — {{company}} + IVX HOLDINGS',
    body: `Hi {{name}},\n\nI wanted to follow up on my previous email regarding our tokenized real estate investment opportunities.\n\nI understand you're busy, so I'll keep this brief — we currently have 3 properties yielding 6-9% with full transparency and blockchain-verified ownership.\n\nWould a quick 10-minute call work for you this week?\n\nBest,\nIVX HOLDINGS Investment Team`},
  {
    id: 'property',
    name: 'Property Alert',
    subject: 'New Listing Alert — High-Yield Tokenized Property',
    body: `Dear {{name}},\n\nA premium new property has just been listed on IVX HOLDINGS that matches {{company}}'s investment criteria.\n\nKey highlights:\n• Location: Miami, FL\n• Projected Yield: 8.2%\n• Type: Mixed-Use (Residential + Commercial)\n• Structure: First-lien secured tokenized mortgage\n\nEarly access is available for a limited time.\n\nBest regards,\nIVX HOLDINGS LLC`},
  {
    id: 'partnership',
    name: 'Partnership',
    subject: 'Partnership proposal — tokenized RE for {{company}}',
    body: `Dear {{name}},\n\nI'm writing to explore a potential partnership between {{company}} and IVX HOLDINGS LLC.\n\nOur platform offers:\n• White-label tokenized investment products\n• Institutional co-investment opportunities\n• Revenue sharing on referrals\n• Full regulatory compliance (SEC/FinCEN)\n\nI'd love to discuss how we can create value together.\n\nBest regards,\nIVX HOLDINGS LLC`},
  {
    id: 'blank',
    name: 'Blank',
    subject: '',
    body: ''},
];

const LOG_STATUS_COLORS: Record<EmailLogStatus, string> = {
  delivered: Colors.accent,
  opened: Colors.primary,
  clicked: '#E879F9',
  replied: Colors.success,
  bounced: Colors.error,
  failed: '#6B7280',
  pending: Colors.warning,
  sending: '#6366F1'};

const LOG_STATUS_LABELS: Record<EmailLogStatus, string> = {
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  replied: 'Replied',
  bounced: 'Bounced',
  failed: 'Failed',
  pending: 'Pending',
  sending: 'Sending'};

const STATUS_COLORS: Record<string, string> = {
  draft: Colors.textTertiary,
  scheduled: Colors.warning,
  warming: '#F59E0B',
  sending: Colors.accent,
  paused: Colors.warning,
  completed: Colors.success,
  failed: Colors.error};

export default function EmailEngineScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [smtpConfigs, setSmtpConfigs] = useState<SMTPConfig[]>(mockSmtpConfigs);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>(mockCampaigns);
  const [domains] = useState<DomainHealth[]>(mockDomainHealth);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedSmtp, setExpandedSmtp] = useState<string | null>(null);
  const [showAddSmtp, setShowAddSmtp] = useState(false);
  const [newSmtpName, setNewSmtpName] = useState('');
  const [newSmtpHost, setNewSmtpHost] = useState('');
  const [newSmtpEmail, setNewSmtpEmail] = useState('');
  const [newSmtpLimit, setNewSmtpLimit] = useState('5000');
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [simulatingSend, setSimulatingSend] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [logStatusFilter, setLogStatusFilter] = useState<StatusFilter>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [allLogs, setAllLogs] = useState<EmailLog[]>(initialEmailLogs);
  const [showCompose, setShowCompose] = useState(false);
  const [composeRecipientName, setComposeRecipientName] = useState('');
  const [composeRecipientEmail, setComposeRecipientEmail] = useState('');
  const [composeRecipientCompany, setComposeRecipientCompany] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeSmtp, setComposeSmtp] = useState('smtp-1');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [composeStep, setComposeStep] = useState<'recipient' | 'compose'>('recipient');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const stats = useMemo(() => getEngineStats(), []);
  const sendingHours = useMemo(() => getOptimalSendingHours(), []);
  const logStats = useMemo(() => getEmailLogStats(), []);

  const filteredLogs = useMemo(() => {
    let logs = [...allLogs];
    if (logFilter !== 'all') {
      logs = logs.filter(l => l.type === logFilter);
    }
    if (logStatusFilter !== 'all') {
      logs = logs.filter(l => l.status === logStatusFilter);
    }
    return logs.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }, [logFilter, logStatusFilter, allLogs]);

  const composeLogStats = useMemo(() => {
    const total = allLogs.length;
    const automatic = allLogs.filter(l => l.type === 'automatic').length;
    const manual = allLogs.filter(l => l.type === 'manual').length;
    const replied = allLogs.filter(l => l.status === 'replied').length;
    return { total, automatic, manual, replied };
  }, [allLogs]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const activeSendingCampaign = useMemo(() => {
    return campaigns.find(c => c.status === 'sending');
  }, [campaigns]);

  useEffect(() => {
    if (activeSendingCampaign) {
      const progress = (activeSendingCampaign.sentCount / activeSendingCampaign.totalRecipients) * 100;
      Animated.timing(progressAnim, {
        toValue: progress,
        duration: 600,
        useNativeDriver: false}).start();
    }
  }, [activeSendingCampaign, progressAnim]);

  const toggleSmtpActive = useCallback((smtpId: string) => {
    setSmtpConfigs(prev => prev.map(s =>
      s.id === smtpId ? { ...s, isActive: !s.isActive } : s
    ));
  }, []);

  const addSmtpConfig = useCallback(() => {
    if (!newSmtpName.trim() || !newSmtpHost.trim() || !newSmtpEmail.trim()) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    const domain = newSmtpEmail.split('@')[1] || 'unknown.com';
    const newConfig: SMTPConfig = {
      id: `smtp-${Date.now()}`,
      name: newSmtpName,
      host: newSmtpHost,
      port: 587,
      username: newSmtpEmail,
      fromEmail: newSmtpEmail,
      fromName: newSmtpName.replace(/smtp|mail|server/gi, '').trim() || 'IVX HOLDINGS',
      dailyLimit: parseInt(newSmtpLimit) || 5000,
      sentToday: 0,
      isActive: false,
      warmupPhase: 'new',
      warmupDay: 0,
      reputationScore: 50,
      lastUsed: null,
      domain};
    setSmtpConfigs(prev => [...prev, newConfig]);
    setShowAddSmtp(false);
    setNewSmtpName('');
    setNewSmtpHost('');
    setNewSmtpEmail('');
    setNewSmtpLimit('5000');
    Alert.alert('Added', 'SMTP server added. Start warm-up before sending at full volume.');
  }, [newSmtpName, newSmtpHost, newSmtpEmail, newSmtpLimit]);

  const removeSmtp = useCallback((smtpId: string) => {
    Alert.alert('Remove SMTP', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setSmtpConfigs(prev => prev.filter(s => s.id !== smtpId))},
    ]);
  }, []);

  const handleCampaignAction = useCallback((campaignId: string, action: 'start' | 'pause' | 'resume' | 'cancel') => {
    const statusMap: Record<string, EmailCampaign['status']> = {
      start: 'sending',
      pause: 'paused',
      resume: 'sending',
      cancel: 'draft'};
    setCampaigns(prev => prev.map(c =>
      c.id === campaignId ? { ...c, status: statusMap[action] } : c
    ));
  }, []);

  const applyTemplate = useCallback((templateId: string) => {
    const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    setSelectedTemplate(templateId);
    let subject = template.subject;
    let body = template.body;
    if (composeRecipientName) {
      subject = subject.replace(/\{\{name\}\}/g, composeRecipientName);
      body = body.replace(/\{\{name\}\}/g, composeRecipientName);
    }
    if (composeRecipientCompany) {
      subject = subject.replace(/\{\{company\}\}/g, composeRecipientCompany);
      body = body.replace(/\{\{company\}\}/g, composeRecipientCompany);
    }
    setComposeSubject(subject);
    setComposeBody(body);
  }, [composeRecipientName, composeRecipientCompany]);

  const resetCompose = useCallback(() => {
    setComposeRecipientName('');
    setComposeRecipientEmail('');
    setComposeRecipientCompany('');
    setComposeSubject('');
    setComposeBody('');
    setComposeSmtp('smtp-1');
    setSelectedTemplate(null);
    setComposeStep('recipient');
    setShowCompose(false);
  }, []);

  const handleSendEmail = useCallback(() => {
    if (!composeRecipientName.trim() || !composeRecipientEmail.trim() || !composeSubject.trim()) {
      Alert.alert('Missing Fields', 'Please fill in recipient name, email, and subject.');
      return;
    }
    setIsSending(true);
    const smtpConfig = smtpConfigs.find(s => s.id === composeSmtp);
    setTimeout(() => {
      const newLog: EmailLog = {
        id: `log-${Date.now()}`,
        recipientName: composeRecipientName.trim(),
        recipientEmail: composeRecipientEmail.trim(),
        recipientCompany: composeRecipientCompany.trim() || 'N/A',
        subject: composeSubject.trim(),
        type: 'manual',
        status: 'sending',
        campaignName: null,
        smtpServer: smtpConfig?.host || 'mail.ipxholding.com',
        sentAt: new Date().toISOString(),
        openedAt: null,
        clickedAt: null,
        repliedAt: null,
        bouncedAt: null};
      setAllLogs(prev => [newLog, ...prev]);
      setIsSending(false);
      resetCompose();
      setActiveTab('sent_log');
      setLogFilter('manual');
      Alert.alert('Email Sent', `Manual email to ${newLog.recipientName} is being delivered.`);
    }, 1500);
  }, [composeRecipientName, composeRecipientEmail, composeRecipientCompany, composeSubject, composeSmtp, smtpConfigs, resetCompose]);

  const navigateToLogWithFilter = useCallback((status: StatusFilter) => {
    setActiveTab('sent_log');
    setLogStatusFilter(status);
    setLogFilter('all');
  }, []);

  const deleteBouncedEmail = useCallback((logId: string) => {
    Alert.alert(
      'Remove Bounced Email',
      'This will permanently remove this email from your records. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAllLogs(prev => prev.filter(l => l.id !== logId));
          }},
      ]
    );
  }, []);

  const deleteAllBounced = useCallback(() => {
    const bouncedCount = allLogs.filter(l => l.status === 'bounced').length;
    if (bouncedCount === 0) {
      Alert.alert('No Bounced Emails', 'There are no bounced emails to remove.');
      return;
    }
    Alert.alert(
      'Remove All Bounced',
      `Delete ${bouncedCount} bounced email${bouncedCount > 1 ? 's' : ''} from records? This helps keep your list clean.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${bouncedCount}`,
          style: 'destructive',
          onPress: () => {
            setAllLogs(prev => prev.filter(l => l.status !== 'bounced'));
            Alert.alert('Cleaned', `${bouncedCount} bounced email${bouncedCount > 1 ? 's' : ''} removed.`);
          }},
      ]
    );
  }, [allLogs]);

  const simulateCampaignSend = useCallback((campaignId: string) => {
    setSimulatingSend(campaignId);
    setCampaigns(prev => prev.map(c =>
      c.id === campaignId ? { ...c, status: 'sending', startedAt: new Date().toISOString() } : c
    ));

    let sent = 0;
    const campaign = campaigns.find(c => c.id === campaignId);
    const total = campaign?.totalRecipients || emailRecipients.length;

    const interval = setInterval(() => {
      sent += Math.floor(Math.random() * 80 + 30);
      if (sent >= total) {
        sent = total;
        clearInterval(interval);
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId ? {
            ...c,
            status: 'completed',
            sentCount: total,
            deliveredCount: Math.round(total * 0.97),
            completedAt: new Date().toISOString()} : c
        ));
        setSimulatingSend(null);
        Alert.alert('Campaign Complete', `${total} emails delivered successfully`);
      } else {
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId ? { ...c, sentCount: sent } : c
        ));
      }
    }, 300);
  }, [campaigns]);

  const formatNumber = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const renderDashboard = () => (
    <View>
      {activeSendingCampaign && (
        <Animated.View style={[styles.liveCard, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.liveCardHeader}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTitle}>LIVE — Sending Now</Text>
          </View>
          <Text style={styles.liveCampaignName}>{activeSendingCampaign.name}</Text>
          <View style={styles.liveProgressOuter}>
            <Animated.View style={[styles.liveProgressInner, {
              width: progressAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%']})}]} />
          </View>
          <View style={styles.liveStatsRow}>
            <Text style={styles.liveStat}>
              {formatNumber(activeSendingCampaign.sentCount)} / {formatNumber(activeSendingCampaign.totalRecipients)} sent
            </Text>
            <Text style={styles.liveStat}>
              {formatNumber(activeSendingCampaign.deliveredCount)} delivered
            </Text>
          </View>
          <View style={styles.liveActions}>
            <TouchableOpacity
              style={styles.livePauseBtn}
              onPress={() => handleCampaignAction(activeSendingCampaign.id, 'pause')}
            >
              <Pause size={14} color={Colors.warning} />
              <Text style={styles.livePauseText}>Pause</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      <View style={styles.costBanner}>
        <View style={styles.costBannerLeft}>
          <DollarSign size={20} color={Colors.success} />
          <View>
            <Text style={styles.costBannerTitle}>Today's Cost</Text>
            <Text style={styles.costBannerValue}>${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(stats.estimatedDailyCost)}</Text>
          </View>
        </View>
        <View style={styles.costBannerRight}>
          <Text style={styles.costBannerLabel}>Monthly Est.</Text>
          <Text style={styles.costBannerMonthly}>${new Intl.NumberFormat('en-US').format(Math.round(stats.monthlyProjection))}/mo</Text>
        </View>
        <View style={styles.costBannerRight}>
          <Text style={styles.costBannerLabel}>Per Email</Text>
          <Text style={styles.costBannerPerEmail}>${stats.estimatedCostPerEmail}</Text>
        </View>
      </View>

      <View style={styles.metricsGrid}>
        <View style={[styles.metricCard, styles.metricCardWide]}>
          <View style={styles.metricCardHeader}>
            <Send size={16} color={Colors.accent} />
            <Text style={styles.metricLabel}>Sent Today</Text>
          </View>
          <Text style={styles.metricValue}>{formatNumber(stats.totalSentToday)}</Text>
          <View style={styles.dailyCapBar}>
            <View style={[styles.dailyCapFill, {
              width: `${Math.min(100, (stats.totalSentToday / stats.dailyLimit) * 100)}%`
            }]} />
          </View>
          <Text style={styles.dailyCapText}>
            {Math.round((stats.totalSentToday / stats.dailyLimit) * 100)}% of {formatNumber(stats.dailyLimit)} daily cap
          </Text>
        </View>

        <TouchableOpacity style={styles.metricCard} onPress={() => navigateToLogWithFilter('delivered')} activeOpacity={0.7}>
          <Gauge size={16} color={Colors.success} />
          <Text style={styles.metricValue}>{stats.deliveryRate}%</Text>
          <Text style={styles.metricLabel}>Delivered</Text>
          <ChevronRight size={10} color={Colors.textTertiary} style={styles.metricArrow} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.metricCard} onPress={() => navigateToLogWithFilter('opened')} activeOpacity={0.7}>
          <Eye size={16} color={Colors.primary} />
          <Text style={styles.metricValue}>{stats.openRate}%</Text>
          <Text style={styles.metricLabel}>Open Rate</Text>
          <ChevronRight size={10} color={Colors.textTertiary} style={styles.metricArrow} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.metricCard, styles.metricCardBounce]} onPress={() => navigateToLogWithFilter('bounced')} activeOpacity={0.7}>
          <AlertTriangle size={16} color={stats.bounceRate > 5 ? Colors.error : Colors.warning} />
          <Text style={styles.metricValue}>{stats.bounceRate}%</Text>
          <Text style={styles.metricLabel}>Bounce</Text>
          <ChevronRight size={10} color={Colors.textTertiary} style={styles.metricArrow} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.metricCard} onPress={() => navigateToLogWithFilter('failed')} activeOpacity={0.7}>
          <ShieldCheck size={16} color={stats.spamRate < 0.1 ? Colors.success : Colors.error} />
          <Text style={styles.metricValue}>{stats.spamRate}%</Text>
          <Text style={styles.metricLabel}>Spam</Text>
          <ChevronRight size={10} color={Colors.textTertiary} style={styles.metricArrow} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SMTP Servers</Text>
        <View style={styles.smtpSummary}>
          <View style={styles.smtpSummaryItem}>
            <Server size={14} color={Colors.success} />
            <Text style={styles.smtpSummaryText}>{stats.activeSmtpServers} Active</Text>
          </View>
          <View style={styles.smtpSummaryItem}>
            <Flame size={14} color={Colors.warning} />
            <Text style={styles.smtpSummaryText}>{stats.warmingSmtpServers} Warming</Text>
          </View>
          <View style={styles.smtpSummaryItem}>
            <Users size={14} color={Colors.accent} />
            <Text style={styles.smtpSummaryText}>{stats.cleanRecipients} Recipients</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Send Schedule (Today)</Text>
        <Text style={styles.sectionSubtitle}>Smart distribution across business hours</Text>
        <View style={styles.scheduleGrid}>
          {sendingHours.map((slot) => {
            const isNow = new Date().getHours() === slot.hour;
            return (
              <View key={slot.hour} style={[styles.scheduleSlot, isNow && styles.scheduleSlotNow]}>
                <Text style={[styles.scheduleHour, isNow && styles.scheduleHourNow]}>
                  {slot.hour > 12 ? slot.hour - 12 : slot.hour}{slot.hour >= 12 ? 'pm' : 'am'}
                </Text>
                <View style={styles.scheduleBar}>
                  <View style={[styles.scheduleBarFill, {
                    height: `${(slot.maxEmails / 1800) * 100}%`,
                    backgroundColor: slot.priority === 'high' ? Colors.success :
                      slot.priority === 'medium' ? Colors.primary : Colors.textTertiary}]} />
                </View>
                <Text style={styles.scheduleCount}>{formatNumber(slot.maxEmails)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Domain Health</Text>
        {domains.map((domain) => (
          <View key={domain.domain} style={styles.domainCard}>
            <View style={styles.domainHeader}>
              <Globe size={14} color={Colors.accent} />
              <Text style={styles.domainName}>{domain.domain}</Text>
              <View style={[styles.domainScoreBadge, {
                backgroundColor: domain.reputationScore >= 90 ? 'rgba(0,196,140,0.15)' :
                  domain.reputationScore >= 80 ? 'rgba(255,184,0,0.15)' : 'rgba(255,77,77,0.15)'}]}>
                <Text style={[styles.domainScoreText, {
                  color: domain.reputationScore >= 90 ? Colors.success :
                    domain.reputationScore >= 80 ? Colors.warning : Colors.error}]}>{domain.reputationScore}</Text>
              </View>
            </View>
            <View style={styles.domainChecks}>
              <View style={styles.domainCheck}>
                {domain.spfConfigured ? <CheckCircle size={12} color={Colors.success} /> : <AlertTriangle size={12} color={Colors.error} />}
                <Text style={styles.domainCheckText}>SPF</Text>
              </View>
              <View style={styles.domainCheck}>
                {domain.dkimConfigured ? <CheckCircle size={12} color={Colors.success} /> : <AlertTriangle size={12} color={Colors.error} />}
                <Text style={styles.domainCheckText}>DKIM</Text>
              </View>
              <View style={styles.domainCheck}>
                {domain.dmarcConfigured ? <CheckCircle size={12} color={Colors.success} /> : <AlertTriangle size={12} color={Colors.error} />}
                <Text style={styles.domainCheckText}>DMARC</Text>
              </View>
              <View style={styles.domainCheck}>
                {!domain.blacklisted ? <ShieldCheck size={12} color={Colors.success} /> : <ShieldAlert size={12} color={Colors.error} />}
                <Text style={styles.domainCheckText}>{domain.blacklisted ? 'Blacklisted' : 'Clean'}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderCampaigns = () => (
    <View>
      <View style={styles.campaignActions}>
        <TouchableOpacity
          style={styles.newCampaignBtn}
          onPress={() => router.push('/admin/ai-outreach' as any)}
        >
          <Plus size={16} color={Colors.background} />
          <Text style={styles.newCampaignBtnText}>New Campaign</Text>
        </TouchableOpacity>
      </View>

      {campaigns.map((campaign) => {
        const isExpanded = expandedCampaign === campaign.id;
        const isSending = campaign.status === 'sending';
        const progress = campaign.totalRecipients > 0
          ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100)
          : 0;

        return (
          <TouchableOpacity
            key={campaign.id}
            style={styles.campaignCard}
            onPress={() => setExpandedCampaign(isExpanded ? null : campaign.id)}
            activeOpacity={0.7}
          >
            <View style={styles.campaignHeader}>
              <View style={[styles.campaignStatusDot, { backgroundColor: STATUS_COLORS[campaign.status] }]} />
              <View style={styles.campaignHeaderInfo}>
                <Text style={styles.campaignName} numberOfLines={1}>{campaign.name}</Text>
                <Text style={styles.campaignSubject} numberOfLines={1}>{campaign.subject}</Text>
              </View>
              <View style={[styles.campaignStatusBadge, {
                backgroundColor: `${STATUS_COLORS[campaign.status]}20`}]}>
                <Text style={[styles.campaignStatusText, { color: STATUS_COLORS[campaign.status] }]}>
                  {campaign.status}
                </Text>
              </View>
            </View>

            {(isSending || campaign.status === 'completed') && (
              <View style={styles.campaignProgress}>
                <View style={styles.campaignProgressBarOuter}>
                  <View style={[styles.campaignProgressBarInner, {
                    width: `${progress}%`,
                    backgroundColor: campaign.status === 'completed' ? Colors.success : Colors.accent}]} />
                </View>
                <Text style={styles.campaignProgressText}>{progress}%</Text>
              </View>
            )}

            <View style={styles.campaignMetrics}>
              <View style={styles.campaignMetric}>
                <Send size={11} color={Colors.textTertiary} />
                <Text style={styles.campaignMetricText}>{formatNumber(campaign.sentCount)}</Text>
              </View>
              <View style={styles.campaignMetric}>
                <CheckCircle size={11} color={Colors.success} />
                <Text style={styles.campaignMetricText}>{formatNumber(campaign.deliveredCount)}</Text>
              </View>
              <View style={styles.campaignMetric}>
                <Eye size={11} color={Colors.primary} />
                <Text style={styles.campaignMetricText}>{formatNumber(campaign.openedCount)}</Text>
              </View>
              <View style={styles.campaignMetric}>
                <MousePointer size={11} color="#E879F9" />
                <Text style={styles.campaignMetricText}>{formatNumber(campaign.clickedCount)}</Text>
              </View>
              <View style={styles.campaignMetric}>
                <MessageSquare size={11} color={Colors.success} />
                <Text style={styles.campaignMetricText}>{formatNumber(campaign.repliedCount)}</Text>
              </View>
            </View>

            {isExpanded && (
              <View style={styles.campaignExpanded}>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Total Recipients</Text>
                  <Text style={styles.campaignDetailValue}>{formatNumber(campaign.totalRecipients)}</Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Bounced</Text>
                  <Text style={[styles.campaignDetailValue, { color: campaign.bouncedCount > 0 ? Colors.error : Colors.success }]}>
                    {campaign.bouncedCount}
                  </Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Spam Reports</Text>
                  <Text style={[styles.campaignDetailValue, { color: campaign.spamReportCount > 0 ? Colors.error : Colors.success }]}>
                    {campaign.spamReportCount}
                  </Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Unsubscribed</Text>
                  <Text style={styles.campaignDetailValue}>{campaign.unsubscribedCount}</Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Batch Size</Text>
                  <Text style={styles.campaignDetailValue}>{campaign.batchSize} per batch</Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>Delay Between Batches</Text>
                  <Text style={styles.campaignDetailValue}>{campaign.delayBetweenBatches / 1000}s</Text>
                </View>
                <View style={styles.campaignDetailRow}>
                  <Text style={styles.campaignDetailLabel}>SMTP Rotation</Text>
                  <Text style={styles.campaignDetailValue}>{campaign.smtpRotation.length} servers</Text>
                </View>
                <View style={styles.campaignFeatures}>
                  {campaign.trackOpens && <View style={styles.featureTag}><Eye size={10} color={Colors.primary} /><Text style={styles.featureTagText}>Track Opens</Text></View>}
                  {campaign.trackClicks && <View style={styles.featureTag}><MousePointer size={10} color="#E879F9" /><Text style={styles.featureTagText}>Track Clicks</Text></View>}
                  {campaign.includeUnsubscribe && <View style={styles.featureTag}><ShieldCheck size={10} color={Colors.success} /><Text style={styles.featureTagText}>Unsubscribe</Text></View>}
                  {campaign.sendTimeOptimization && <View style={styles.featureTag}><Timer size={10} color={Colors.accent} /><Text style={styles.featureTagText}>Time Optimized</Text></View>}
                </View>

                <View style={styles.campaignActionRow}>
                  {campaign.status === 'draft' && (
                    <TouchableOpacity
                      style={styles.campaignStartBtn}
                      onPress={() => simulateCampaignSend(campaign.id)}
                      disabled={simulatingSend !== null}
                    >
                      {simulatingSend === campaign.id ? (
                        <ShimmerIndicator color={Colors.background} size="small" />
                      ) : (
                        <>
                          <Play size={14} color={Colors.background} />
                          <Text style={styles.campaignStartBtnText}>Start Sending</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  {campaign.status === 'sending' && (
                    <TouchableOpacity
                      style={styles.campaignPauseBtn}
                      onPress={() => handleCampaignAction(campaign.id, 'pause')}
                    >
                      <Pause size={14} color={Colors.warning} />
                      <Text style={styles.campaignPauseBtnText}>Pause</Text>
                    </TouchableOpacity>
                  )}
                  {campaign.status === 'paused' && (
                    <TouchableOpacity
                      style={styles.campaignResumeBtn}
                      onPress={() => handleCampaignAction(campaign.id, 'resume')}
                    >
                      <Play size={14} color="#fff" />
                      <Text style={styles.campaignResumeBtnText}>Resume</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderSmtp = () => (
    <View>
      <View style={styles.smtpHeader}>
        <View>
          <Text style={styles.sectionTitle}>SMTP Servers</Text>
          <Text style={styles.sectionSubtitle}>Rotate between servers to distribute load</Text>
        </View>
        <TouchableOpacity style={styles.addSmtpBtn} onPress={() => setShowAddSmtp(true)}>
          <Plus size={16} color={Colors.background} />
          <Text style={styles.addSmtpBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {smtpConfigs.map((smtp) => {
        const isExpanded = expandedSmtp === smtp.id;
        const usagePercent = smtp.dailyLimit > 0
          ? Math.round((smtp.sentToday / smtp.dailyLimit) * 100)
          : 0;

        return (
          <TouchableOpacity
            key={smtp.id}
            style={styles.smtpCard}
            onPress={() => setExpandedSmtp(isExpanded ? null : smtp.id)}
            activeOpacity={0.7}
          >
            <View style={styles.smtpCardHeader}>
              <View style={[styles.smtpStatusIndicator, {
                backgroundColor: smtp.isActive ? Colors.success : Colors.textTertiary}]} />
              <View style={styles.smtpCardInfo}>
                <Text style={styles.smtpCardName} numberOfLines={1}>{smtp.name}</Text>
                <Text style={styles.smtpCardEmail}>{smtp.fromEmail}</Text>
              </View>
              <View style={styles.smtpCardRight}>
                {smtp.warmupPhase === 'warming' && (
                  <View style={styles.warmupBadge}>
                    <Flame size={10} color="#F59E0B" />
                    <Text style={styles.warmupBadgeText}>Day {smtp.warmupDay}</Text>
                  </View>
                )}
                <View style={[styles.smtpRepBadge, {
                  backgroundColor: smtp.reputationScore >= 90 ? 'rgba(0,196,140,0.15)' :
                    smtp.reputationScore >= 80 ? 'rgba(255,184,0,0.15)' : 'rgba(255,77,77,0.15)'}]}>
                  <Text style={[styles.smtpRepText, {
                    color: smtp.reputationScore >= 90 ? Colors.success :
                      smtp.reputationScore >= 80 ? Colors.warning : Colors.error}]}>{smtp.reputationScore}</Text>
                </View>
              </View>
            </View>

            <View style={styles.smtpUsage}>
              <View style={styles.smtpUsageBarOuter}>
                <View style={[styles.smtpUsageBarInner, {
                  width: `${usagePercent}%`,
                  backgroundColor: usagePercent > 90 ? Colors.error :
                    usagePercent > 70 ? Colors.warning : Colors.accent}]} />
              </View>
              <Text style={styles.smtpUsageText}>
                {formatNumber(smtp.sentToday)} / {formatNumber(smtp.dailyLimit)} ({usagePercent}%)
              </Text>
            </View>

            {isExpanded && (
              <View style={styles.smtpExpanded}>
                <View style={styles.smtpDetailRow}>
                  <Text style={styles.smtpDetailLabel}>Host</Text>
                  <Text style={styles.smtpDetailValue}>{smtp.host}:{smtp.port}</Text>
                </View>
                <View style={styles.smtpDetailRow}>
                  <Text style={styles.smtpDetailLabel}>Domain</Text>
                  <Text style={styles.smtpDetailValue}>{smtp.domain}</Text>
                </View>
                <View style={styles.smtpDetailRow}>
                  <Text style={styles.smtpDetailLabel}>Warm-up Phase</Text>
                  <Text style={[styles.smtpDetailValue, {
                    color: smtp.warmupPhase === 'ready' ? Colors.success :
                      smtp.warmupPhase === 'warming' ? Colors.warning : Colors.textTertiary}]}>{smtp.warmupPhase}</Text>
                </View>
                {smtp.warmupPhase === 'warming' && (
                  <View style={styles.smtpDetailRow}>
                    <Text style={styles.smtpDetailLabel}>Warmup Limit Today</Text>
                    <Text style={styles.smtpDetailValue}>{getWarmupLimit(smtp.warmupDay)}</Text>
                  </View>
                )}
                <View style={styles.smtpActionRow}>
                  <TouchableOpacity
                    style={[styles.smtpToggleBtn, smtp.isActive && styles.smtpToggleBtnActive]}
                    onPress={() => toggleSmtpActive(smtp.id)}
                  >
                    {smtp.isActive ? <Pause size={14} color={Colors.warning} /> : <Play size={14} color={Colors.success} />}
                    <Text style={[styles.smtpToggleBtnText, smtp.isActive && styles.smtpToggleBtnTextActive]}>
                      {smtp.isActive ? 'Disable' : 'Enable'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smtpRemoveBtn} onPress={() => removeSmtp(smtp.id)}>
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Warm-up Schedule</Text>
        <Text style={styles.sectionSubtitle}>Gradually increase volume to build reputation</Text>
        <View style={styles.warmupTimeline}>
          {[1, 3, 7, 10, 14, 18, 21, 24].map((day) => (
            <View key={day} style={styles.warmupStep}>
              <View style={styles.warmupStepDot}>
                <Text style={styles.warmupStepDotText}>{day}</Text>
              </View>
              <Text style={styles.warmupStepLimit}>{formatNumber(getWarmupLimit(day))}</Text>
              <Text style={styles.warmupStepLabel}>emails</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  const renderProtection = () => (
    <View>
      <View style={styles.protectionHeader}>
        <Shield size={22} color={Colors.success} />
        <View>
          <Text style={styles.protectionTitle}>Anti-Blacklist Protection</Text>
          <Text style={styles.protectionSubtitle}>
            {ANTI_BLACKLIST_RULES.filter(r => r.critical).length} critical rules active
          </Text>
        </View>
      </View>

      {ANTI_BLACKLIST_RULES.map((rule) => {
        const isExpanded = expandedRule === rule.id;
        return (
          <TouchableOpacity
            key={rule.id}
            style={styles.ruleCard}
            onPress={() => setExpandedRule(isExpanded ? null : rule.id)}
            activeOpacity={0.7}
          >
            <View style={styles.ruleHeader}>
              <View style={[styles.ruleIcon, {
                backgroundColor: rule.critical ? 'rgba(0,196,140,0.12)' : 'rgba(74,144,217,0.12)'}]}>
                {rule.critical ? (
                  <ShieldCheck size={16} color={Colors.success} />
                ) : (
                  <Shield size={16} color={Colors.accent} />
                )}
              </View>
              <View style={styles.ruleInfo}>
                <View style={styles.ruleTitleRow}>
                  <Text style={styles.ruleName}>{rule.name}</Text>
                  {rule.critical && (
                    <View style={styles.criticalBadge}>
                      <Text style={styles.criticalBadgeText}>CRITICAL</Text>
                    </View>
                  )}
                </View>
                {isExpanded && (
                  <Text style={styles.ruleDescription}>{rule.description}</Text>
                )}
              </View>
              <CheckCircle size={18} color={Colors.success} />
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cost Comparison</Text>
        <Text style={styles.sectionSubtitle}>Your custom engine vs. paid services</Text>

        <View style={styles.comparisonCard}>
          <View style={styles.comparisonHeader}>
            <Zap size={16} color={Colors.primary} />
            <Text style={styles.comparisonTitle}>Your IVXHOLDINGS Email Engine</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>20K emails/day</Text>
            <Text style={[styles.comparisonValue, { color: Colors.success }]}>$2/day</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>Monthly (600K emails)</Text>
            <Text style={[styles.comparisonValue, { color: Colors.success }]}>~$60/mo</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>Per email cost</Text>
            <Text style={[styles.comparisonValue, { color: Colors.success }]}>$0.0001</Text>
          </View>
        </View>

        <View style={[styles.comparisonCard, styles.comparisonCardDim]}>
          <View style={styles.comparisonHeader}>
            <Mail size={16} color={Colors.textSecondary} />
            <Text style={[styles.comparisonTitle, { color: Colors.textSecondary }]}>Mailchimp / SendGrid</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>20K emails/day</Text>
            <Text style={[styles.comparisonValue, { color: Colors.error }]}>$300-800/mo</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>Monthly (600K emails)</Text>
            <Text style={[styles.comparisonValue, { color: Colors.error }]}>$500-1,200/mo</Text>
          </View>
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>Per email cost</Text>
            <Text style={[styles.comparisonValue, { color: Colors.error }]}>$0.001-0.002</Text>
          </View>
        </View>

        <View style={styles.savingsCard}>
          <TrendingUp size={18} color={Colors.primary} />
          <View>
            <Text style={styles.savingsTitle}>You Save ~$500-1,100/month</Text>
            <Text style={styles.savingsSubtitle}>Using your own SMTP infrastructure with SES pricing</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const formatLogTime = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, []);

  const renderSentLog = () => (
    <View>
      <View style={styles.logStatsRow}>
        <View style={[styles.logStatCard, { borderLeftColor: Colors.accent }]}>
          <Text style={styles.logStatValue}>{composeLogStats.total}</Text>
          <Text style={styles.logStatLabel}>Total</Text>
        </View>
        <View style={[styles.logStatCard, { borderLeftColor: '#6366F1' }]}>
          <Text style={styles.logStatValue}>{composeLogStats.automatic}</Text>
          <Text style={styles.logStatLabel}>Auto</Text>
        </View>
        <View style={[styles.logStatCard, { borderLeftColor: '#E879F9' }]}>
          <Text style={styles.logStatValue}>{composeLogStats.manual}</Text>
          <Text style={styles.logStatLabel}>Manual</Text>
        </View>
        <View style={[styles.logStatCard, { borderLeftColor: Colors.success }]}>
          <Text style={styles.logStatValue}>{composeLogStats.replied}</Text>
          <Text style={styles.logStatLabel}>Replied</Text>
        </View>
      </View>

      <View style={styles.logFiltersSection}>
        <Text style={styles.logFilterLabel}>Type</Text>
        <View style={styles.logFilterRow}>
          {(['all', 'automatic', 'manual'] as LogFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.logFilterChip,
                logFilter === f && styles.logFilterChipActive,
                logFilter === f && f === 'automatic' && { backgroundColor: '#6366F1' },
                logFilter === f && f === 'manual' && { backgroundColor: '#E879F9' },
              ]}
              onPress={() => setLogFilter(f)}
            >
              {f === 'automatic' && <Zap size={12} color={logFilter === f ? Colors.background : '#6366F1'} />}
              {f === 'manual' && <FileText size={12} color={logFilter === f ? Colors.background : '#E879F9'} />}
              <Text style={[
                styles.logFilterChipText,
                logFilter === f && styles.logFilterChipTextActive,
              ]}>
                {f === 'all' ? `All (${composeLogStats.total})` : f === 'automatic' ? `Auto (${composeLogStats.automatic})` : `Manual (${composeLogStats.manual})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.logFilterLabel, { marginTop: 10 }]}>Status</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.logStatusFilterScroll}>
          <View style={styles.logFilterRow}>
            <TouchableOpacity
              style={[styles.logFilterChip, logStatusFilter === 'all' && styles.logFilterChipActive]}
              onPress={() => setLogStatusFilter('all')}
            >
              <Text style={[styles.logFilterChipText, logStatusFilter === 'all' && styles.logFilterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {(['delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'sending', 'pending'] as EmailLogStatus[]).map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.logFilterChip,
                  logStatusFilter === s && { backgroundColor: LOG_STATUS_COLORS[s], borderColor: LOG_STATUS_COLORS[s] },
                ]}
                onPress={() => setLogStatusFilter(s)}
              >
                <View style={[styles.logStatusDotSmall, { backgroundColor: LOG_STATUS_COLORS[s] }]} />
                <Text style={[
                  styles.logFilterChipText,
                  logStatusFilter === s && styles.logFilterChipTextActive,
                ]}>{LOG_STATUS_LABELS[s]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.logResultHeader}>
        <Text style={styles.logResultCount}>{filteredLogs.length} emails</Text>
        {logStatusFilter === 'bounced' && filteredLogs.length > 0 && (
          <TouchableOpacity style={styles.deleteAllBouncedBtn} onPress={deleteAllBounced}>
            <Trash2 size={12} color={Colors.error} />
            <Text style={styles.deleteAllBouncedText}>Remove All Bounced</Text>
          </TouchableOpacity>
        )}
      </View>

      {filteredLogs.map((log) => {
        const isExpanded = expandedLog === log.id;
        return (
          <TouchableOpacity
            key={log.id}
            style={styles.logCard}
            onPress={() => setExpandedLog(isExpanded ? null : log.id)}
            activeOpacity={0.7}
          >
            <View style={styles.logCardHeader}>
              <View style={[styles.logTypeBadge, {
                backgroundColor: log.type === 'automatic' ? 'rgba(99,102,241,0.12)' : 'rgba(232,121,249,0.12)'}]}>
                {log.type === 'automatic' ? (
                  <Zap size={11} color="#6366F1" />
                ) : (
                  <FileText size={11} color="#E879F9" />
                )}
                <Text style={[styles.logTypeBadgeText, {
                  color: log.type === 'automatic' ? '#6366F1' : '#E879F9'}]}>{log.type === 'automatic' ? 'AUTO' : 'MANUAL'}</Text>
              </View>
              <View style={[styles.logStatusBadge, {
                backgroundColor: `${LOG_STATUS_COLORS[log.status]}18`}]}>
                <View style={[styles.logStatusDotSmall, { backgroundColor: LOG_STATUS_COLORS[log.status] }]} />
                <Text style={[styles.logStatusBadgeText, { color: LOG_STATUS_COLORS[log.status] }]}>
                  {LOG_STATUS_LABELS[log.status]}
                </Text>
              </View>
              <Text style={styles.logTime}>{formatLogTime(log.sentAt)}</Text>
            </View>

            <View style={styles.logRecipient}>
              <Text style={styles.logRecipientName} numberOfLines={1}>{log.recipientName}</Text>
              <Text style={styles.logRecipientCompany} numberOfLines={1}>{log.recipientCompany}</Text>
            </View>
            <Text style={styles.logSubject} numberOfLines={isExpanded ? 3 : 1}>{log.subject}</Text>

            {log.campaignName && (
              <View style={styles.logCampaignTag}>
                <Target size={10} color={Colors.accent} />
                <Text style={styles.logCampaignTagText} numberOfLines={1}>{log.campaignName}</Text>
              </View>
            )}

            {isExpanded && (
              <View style={styles.logExpanded}>
                <View style={styles.logDetailRow}>
                  <Text style={styles.logDetailLabel}>Email</Text>
                  <Text style={styles.logDetailValue}>{log.recipientEmail}</Text>
                </View>
                <View style={styles.logDetailRow}>
                  <Text style={styles.logDetailLabel}>SMTP Server</Text>
                  <Text style={styles.logDetailValue}>{log.smtpServer}</Text>
                </View>
                <View style={styles.logDetailRow}>
                  <Text style={styles.logDetailLabel}>Sent At</Text>
                  <Text style={styles.logDetailValue}>
                    {new Date(log.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                {log.openedAt && (
                  <View style={styles.logDetailRow}>
                    <Text style={styles.logDetailLabel}>Opened At</Text>
                    <Text style={[styles.logDetailValue, { color: Colors.primary }]}>
                      {new Date(log.openedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                )}
                {log.clickedAt && (
                  <View style={styles.logDetailRow}>
                    <Text style={styles.logDetailLabel}>Clicked At</Text>
                    <Text style={[styles.logDetailValue, { color: '#E879F9' }]}>
                      {new Date(log.clickedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                )}
                {log.repliedAt && (
                  <View style={styles.logDetailRow}>
                    <Text style={styles.logDetailLabel}>Replied At</Text>
                    <Text style={[styles.logDetailValue, { color: Colors.success }]}>
                      {new Date(log.repliedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                )}
                {log.bouncedAt && (
                  <View style={styles.logDetailRow}>
                    <Text style={styles.logDetailLabel}>Bounced At</Text>
                    <Text style={[styles.logDetailValue, { color: Colors.error }]}>
                      {new Date(log.bouncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                )}

                {(log.status === 'bounced' || log.status === 'failed') && (
                  <TouchableOpacity
                    style={styles.deleteLogBtn}
                    onPress={() => deleteBouncedEmail(log.id)}
                  >
                    <Trash2 size={14} color={Colors.error} />
                    <Text style={styles.deleteLogBtnText}>Remove from List</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.logTimeline}>
                  <View style={[styles.logTimelineDot, { backgroundColor: Colors.accent }]} />
                  <View style={[styles.logTimelineConnector, { backgroundColor: log.openedAt ? Colors.primary : Colors.backgroundTertiary }]} />
                  <View style={[styles.logTimelineDot, { backgroundColor: log.openedAt ? Colors.primary : Colors.backgroundTertiary }]} />
                  <View style={[styles.logTimelineConnector, { backgroundColor: log.clickedAt ? '#E879F9' : Colors.backgroundTertiary }]} />
                  <View style={[styles.logTimelineDot, { backgroundColor: log.clickedAt ? '#E879F9' : Colors.backgroundTertiary }]} />
                  <View style={[styles.logTimelineConnector, { backgroundColor: log.repliedAt ? Colors.success : Colors.backgroundTertiary }]} />
                  <View style={[styles.logTimelineDot, { backgroundColor: log.repliedAt ? Colors.success : Colors.backgroundTertiary }]} />
                </View>
                <View style={styles.logTimelineLabels}>
                  <Text style={[styles.logTimelineLabel, { color: Colors.accent }]}>Sent</Text>
                  <Text style={[styles.logTimelineLabel, { color: log.openedAt ? Colors.primary : Colors.textTertiary }]}>Open</Text>
                  <Text style={[styles.logTimelineLabel, { color: log.clickedAt ? '#E879F9' : Colors.textTertiary }]}>Click</Text>
                  <Text style={[styles.logTimelineLabel, { color: log.repliedAt ? Colors.success : Colors.textTertiary }]}>Reply</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      {filteredLogs.length === 0 && (
        <View style={styles.logEmptyState}>
          <Mail size={32} color={Colors.textTertiary} />
          <Text style={styles.logEmptyText}>No emails match your filters</Text>
        </View>
      )}
    </View>
  );

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Engine', icon: <Activity size={14} color={activeTab === 'dashboard' ? Colors.background : Colors.textSecondary} /> },
    { key: 'sent_log', label: 'Sent Log', icon: <Mail size={14} color={activeTab === 'sent_log' ? Colors.background : Colors.textSecondary} /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Send size={14} color={activeTab === 'campaigns' ? Colors.background : Colors.textSecondary} /> },
    { key: 'smtp', label: 'SMTP', icon: <Server size={14} color={activeTab === 'smtp' ? Colors.background : Colors.textSecondary} /> },
    { key: 'protection', label: 'Protection', icon: <Shield size={14} color={activeTab === 'protection' ? Colors.background : Colors.textSecondary} /> },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Email Engine</Text>
          <View style={styles.headerBadge}>
            <Zap size={10} color={Colors.success} />
            <Text style={styles.headerBadgeText}>20K/day · $0.0001/email</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => router.push('/admin/outreach-analytics' as any)}
        >
          <BarChart3 size={18} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'sent_log' && renderSentLog()}
          {activeTab === 'campaigns' && renderCampaigns()}
          {activeTab === 'smtp' && renderSmtp()}
          {activeTab === 'protection' && renderProtection()}
        </View>
        <View style={{ height: 120 }} />
      </ScrollView>

      {activeTab === 'sent_log' && (
        <TouchableOpacity
          style={styles.composeFab}
          onPress={() => setShowCompose(true)}
          activeOpacity={0.8}
        >
          <Plus size={24} color={Colors.background} />
        </TouchableOpacity>
      )}

      <Modal visible={showCompose} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Compose Email</Text>
                <Text style={styles.composeStepLabel}>
                  {composeStep === 'recipient' ? 'Step 1 — Recipient' : 'Step 2 — Message'}
                </Text>
              </View>
              <TouchableOpacity onPress={resetCompose}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {composeStep === 'recipient' ? (
                <>
                  <Text style={styles.inputLabel}>Recipient Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={composeRecipientName}
                    onChangeText={setComposeRecipientName}
                    placeholder="e.g., James Whitfield"
                    placeholderTextColor={Colors.inputPlaceholder}
                  />

                  <Text style={styles.inputLabel}>Email Address *</Text>
                  <TextInput
                    style={styles.input}
                    value={composeRecipientEmail}
                    onChangeText={setComposeRecipientEmail}
                    placeholder="e.g., james@company.com"
                    placeholderTextColor={Colors.inputPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <Text style={styles.inputLabel}>Company</Text>
                  <TextInput
                    style={styles.input}
                    value={composeRecipientCompany}
                    onChangeText={setComposeRecipientCompany}
                    placeholder="e.g., Bridgewater Capital Partners"
                    placeholderTextColor={Colors.inputPlaceholder}
                  />

                  <Text style={styles.inputLabel}>Send From (SMTP)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    <View style={styles.smtpChipRow}>
                      {smtpConfigs.filter(s => s.isActive).map((smtp) => (
                        <TouchableOpacity
                          key={smtp.id}
                          style={[
                            styles.smtpChip,
                            composeSmtp === smtp.id && styles.smtpChipActive,
                          ]}
                          onPress={() => setComposeSmtp(smtp.id)}
                        >
                          <View style={[styles.smtpChipDot, {
                            backgroundColor: smtp.reputationScore >= 90 ? Colors.success : Colors.warning}]} />
                          <Text style={[
                            styles.smtpChipText,
                            composeSmtp === smtp.id && styles.smtpChipTextActive,
                          ]} numberOfLines={1}>{smtp.fromEmail}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>

                  <TouchableOpacity
                    style={[
                      styles.composeNextBtn,
                      (!composeRecipientName.trim() || !composeRecipientEmail.trim()) && styles.composeNextBtnDisabled,
                    ]}
                    onPress={() => setComposeStep('compose')}
                    disabled={!composeRecipientName.trim() || !composeRecipientEmail.trim()}
                  >
                    <Text style={styles.composeNextBtnText}>Next — Write Message</Text>
                    <ChevronRight size={16} color={Colors.background} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.composeRecipientPreview}>
                    <View style={styles.composeRecipientDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.composeRecipientPreviewName}>{composeRecipientName}</Text>
                      <Text style={styles.composeRecipientPreviewEmail}>{composeRecipientEmail}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setComposeStep('recipient')}>
                      <Text style={styles.composeEditBtn}>Edit</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>Template</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    <View style={styles.templateChipRow}>
                      {EMAIL_TEMPLATES.map((tpl) => (
                        <TouchableOpacity
                          key={tpl.id}
                          style={[
                            styles.templateChip,
                            selectedTemplate === tpl.id && styles.templateChipActive,
                          ]}
                          onPress={() => applyTemplate(tpl.id)}
                        >
                          <Text style={[
                            styles.templateChipText,
                            selectedTemplate === tpl.id && styles.templateChipTextActive,
                          ]}>{tpl.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>

                  <Text style={styles.inputLabel}>Subject *</Text>
                  <TextInput
                    style={styles.input}
                    value={composeSubject}
                    onChangeText={setComposeSubject}
                    placeholder="Email subject line"
                    placeholderTextColor={Colors.inputPlaceholder}
                  />

                  <Text style={styles.inputLabel}>Body</Text>
                  <TextInput
                    style={[styles.input, styles.composeBodyInput]}
                    value={composeBody}
                    onChangeText={setComposeBody}
                    placeholder="Write your email..."
                    placeholderTextColor={Colors.inputPlaceholder}
                    multiline
                    textAlignVertical="top"
                  />

                  <View style={styles.composeBtnRow}>
                    <TouchableOpacity
                      style={styles.composeBackBtn}
                      onPress={() => setComposeStep('recipient')}
                    >
                      <ArrowLeft size={14} color={Colors.textSecondary} />
                      <Text style={styles.composeBackBtnText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.composeSendBtn,
                        (!composeSubject.trim() || isSending) && styles.composeSendBtnDisabled,
                      ]}
                      onPress={handleSendEmail}
                      disabled={!composeSubject.trim() || isSending}
                    >
                      {isSending ? (
                        <ShimmerIndicator color={Colors.background} size="small" />
                      ) : (
                        <>
                          <Send size={14} color={Colors.background} />
                          <Text style={styles.composeSendBtnText}>Send Email</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddSmtp} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add SMTP Server</Text>
              <TouchableOpacity onPress={() => setShowAddSmtp(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Server Name</Text>
              <TextInput
                style={styles.input}
                value={newSmtpName}
                onChangeText={setNewSmtpName}
                placeholder="e.g., Primary Outreach Server"
                placeholderTextColor={Colors.inputPlaceholder}
              />

              <Text style={styles.inputLabel}>SMTP Host</Text>
              <TextInput
                style={styles.input}
                value={newSmtpHost}
                onChangeText={setNewSmtpHost}
                placeholder="e.g., smtp.yourdomain.com"
                placeholderTextColor={Colors.inputPlaceholder}
                autoCapitalize="none"
              />

              <Text style={styles.inputLabel}>From Email</Text>
              <TextInput
                style={styles.input}
                value={newSmtpEmail}
                onChangeText={setNewSmtpEmail}
                placeholder="e.g., outreach@yourdomain.com"
                placeholderTextColor={Colors.inputPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.inputLabel}>Daily Limit</Text>
              <TextInput
                style={styles.input}
                value={newSmtpLimit}
                onChangeText={setNewSmtpLimit}
                placeholder="5000"
                placeholderTextColor={Colors.inputPlaceholder}
                keyboardType="number-pad"
              />

              <View style={styles.modalNote}>
                <AlertTriangle size={14} color={Colors.warning} />
                <Text style={styles.modalNoteText}>
                  New servers start in warm-up mode. Volume increases gradually over 24 days to protect your reputation.
                </Text>
              </View>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={addSmtpConfig}>
                <Plus size={16} color={Colors.background} />
                <Text style={styles.modalSaveBtnText}>Add Server</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  headerBadgeText: { color: Colors.black, fontSize: 11, fontWeight: '700' as const },
  headerActionBtn: { padding: 8 },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  tabBarContent: { flexDirection: 'row', gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: 20 },
  liveCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  liveCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  liveCampaignName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  liveProgressOuter: { height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden', marginVertical: 8 },
  liveProgressInner: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  liveStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveStat: { flex: 1, alignItems: 'center', gap: 2 },
  liveActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  livePauseBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  livePauseText: { color: Colors.textSecondary, fontSize: 13 },
  costBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  costBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  costBannerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  costBannerValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  costBannerRight: { alignItems: 'flex-end' },
  costBannerLabel: { color: Colors.textSecondary, fontSize: 13 },
  costBannerMonthly: { alignItems: 'flex-end', gap: 2 },
  costBannerPerEmail: { color: Colors.textSecondary, fontSize: 13 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  metricCardBounce: { backgroundColor: Colors.negative + '10', borderRadius: 12, padding: 10, gap: 4 },
  metricArrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricCardWide: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 8 },
  metricCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  dailyCapBar: { height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden', marginVertical: 6 },
  dailyCapFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  dailyCapText: { color: Colors.textSecondary, fontSize: 13 },
  section: { marginBottom: 20 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionSubtitle: { color: Colors.textTertiary, fontSize: 13, marginTop: 4 },
  smtpSummary: { gap: 8, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12 },
  smtpSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  smtpSummaryText: { color: Colors.textSecondary, fontSize: 13 },
  scheduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scheduleSlot: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8 },
  scheduleSlotNow: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, backgroundColor: Colors.primary + '15', borderRadius: 8 },
  scheduleHour: { fontSize: 10, color: Colors.textTertiary },
  scheduleHourNow: { fontSize: 10, color: Colors.primary, fontWeight: '700' as const },
  scheduleBar: { width: '100%', height: 40, backgroundColor: Colors.surfaceBorder, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  scheduleBarFill: { width: '100%', borderRadius: 4, backgroundColor: Colors.primary },
  scheduleCount: { fontSize: 10, color: Colors.textTertiary },
  domainCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  domainHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  domainName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  domainScoreBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  domainScoreText: { color: Colors.textSecondary, fontSize: 13 },
  domainChecks: { gap: 4 },
  domainCheck: { gap: 4 },
  domainCheckText: { color: Colors.textSecondary, fontSize: 13 },
  campaignActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  newCampaignBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  newCampaignBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  campaignCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  campaignStatusDot: { width: 8, height: 8, borderRadius: 4 },
  campaignHeaderInfo: { flex: 1 },
  campaignName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  campaignSubject: { gap: 4 },
  campaignStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  campaignStatusText: { color: Colors.textSecondary, fontSize: 13 },
  campaignProgress: { gap: 4 },
  campaignProgressBarOuter: { gap: 4 },
  campaignProgressBarInner: { gap: 4 },
  campaignProgressText: { color: Colors.textSecondary, fontSize: 13 },
  campaignMetrics: { gap: 4 },
  campaignMetric: { gap: 4 },
  campaignMetricText: { color: Colors.textSecondary, fontSize: 13 },
  campaignExpanded: { paddingTop: 12, gap: 8 },
  campaignDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campaignDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  campaignFeatures: { gap: 4 },
  featureTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  featureTagText: { color: Colors.textSecondary, fontSize: 13 },
  campaignActionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campaignStartBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  campaignStartBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  campaignPauseBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  campaignPauseBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  campaignResumeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  campaignResumeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  smtpHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  addSmtpBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  addSmtpBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  smtpCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  smtpCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  smtpStatusIndicator: { width: 4, borderRadius: 2 },
  smtpCardInfo: { flex: 1 },
  smtpCardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  smtpCardEmail: { color: Colors.textSecondary, fontSize: 13 },
  smtpCardRight: { alignItems: 'flex-end' },
  warmupBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  warmupBadgeText: { fontSize: 11, fontWeight: '700' as const },
  smtpRepBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  smtpRepText: { color: Colors.textSecondary, fontSize: 13 },
  smtpUsage: { gap: 4 },
  smtpUsageBarOuter: { gap: 4 },
  smtpUsageBarInner: { gap: 4 },
  smtpUsageText: { color: Colors.textSecondary, fontSize: 13 },
  smtpExpanded: { paddingTop: 12, gap: 8 },
  smtpDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smtpDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  smtpDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  smtpActionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smtpToggleBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  smtpToggleBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  smtpToggleBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  smtpToggleBtnTextActive: { color: '#000' },
  smtpRemoveBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  warmupTimeline: { gap: 4 },
  warmupStep: { gap: 4 },
  warmupStepDot: { width: 8, height: 8, borderRadius: 4 },
  warmupStepDotText: { color: Colors.textSecondary, fontSize: 13 },
  warmupStepLimit: { gap: 4 },
  warmupStepLabel: { color: Colors.textSecondary, fontSize: 13 },
  protectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  protectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  protectionSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  ruleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  ruleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ruleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  ruleInfo: { flex: 1 },
  ruleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  criticalBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  criticalBadgeText: { fontSize: 11, fontWeight: '700' as const },
  ruleDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  comparisonCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  comparisonCardDim: { gap: 4 },
  comparisonHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  comparisonTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparisonLabel: { color: Colors.textSecondary, fontSize: 13 },
  comparisonValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  savingsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  savingsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  savingsSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalBody: { gap: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  modalNote: { gap: 4 },
  modalNoteText: { color: Colors.textSecondary, fontSize: 13 },
  modalSaveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalSaveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  logStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logStatCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  logStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  logStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  logFiltersSection: { marginBottom: 16 },
  logFilterLabel: { color: Colors.textSecondary, fontSize: 13 },
  logFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logFilterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  logFilterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  logFilterChipText: { color: Colors.textSecondary, fontSize: 13 },
  logFilterChipTextActive: { color: Colors.black },
  logStatusFilterScroll: { gap: 8 },
  logStatusDotSmall: { gap: 4 },
  logResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  logResultCount: { gap: 8 },
  deleteAllBouncedBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  deleteAllBouncedText: { color: Colors.textSecondary, fontSize: 13 },
  logCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  logCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  logTypeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  logTypeBadgeText: { fontSize: 11, fontWeight: '700' as const },
  logStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  logStatusBadgeText: { fontSize: 11, fontWeight: '700' as const },
  logTime: { color: Colors.textTertiary, fontSize: 12 },
  logRecipient: { gap: 4 },
  logRecipientName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  logRecipientCompany: { gap: 4 },
  logSubject: { gap: 4 },
  logCampaignTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  logCampaignTagText: { color: Colors.textSecondary, fontSize: 13 },
  deleteLogBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  deleteLogBtnText: { color: Colors.error, fontWeight: '700' as const, fontSize: 15 },
  logExpanded: { paddingTop: 12, gap: 8 },
  logDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  logDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  logTimeline: { gap: 4 },
  logTimelineDot: { width: 8, height: 8, borderRadius: 4 },
  logTimelineConnector: { gap: 4 },
  logTimelineLabels: { gap: 4 },
  logTimelineLabel: { color: Colors.textSecondary, fontSize: 13 },
  logEmptyState: { gap: 4 },
  logEmptyText: { color: Colors.textSecondary, fontSize: 13 },
  composeFab: { gap: 4 },
  composeStepLabel: { color: Colors.textSecondary, fontSize: 13 },
  smtpChipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smtpChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  smtpChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  smtpChipDot: { width: 8, height: 8, borderRadius: 4 },
  smtpChipText: { color: Colors.textSecondary, fontSize: 13 },
  smtpChipTextActive: { color: Colors.black },
  composeNextBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  composeNextBtnDisabled: { opacity: 0.4 },
  composeNextBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  composeRecipientPreview: { gap: 8 },
  composeRecipientDot: { width: 8, height: 8, borderRadius: 4 },
  composeRecipientPreviewName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  composeRecipientPreviewEmail: { color: Colors.textSecondary, fontSize: 13 },
  composeEditBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  templateChipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  templateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  templateChipText: { color: Colors.textSecondary, fontSize: 13 },
  templateChipTextActive: { color: Colors.black },
  composeBodyInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  composeBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composeBackBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  composeBackBtnText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  composeSendBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  composeSendBtnDisabled: { opacity: 0.4 },
  composeSendBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
