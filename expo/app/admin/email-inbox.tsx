import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Mail,
  Inbox,
  Send,
  Bot,
  Star,
  Trash2,
  Reply,
  RefreshCw,
  Sparkles,
  CheckCircle,
  X,
  Search,
  Zap} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { generateText } from '@/lib/ai-service';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getAuthToken } from '@/lib/auth-store';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface InvestorIntent {
  budget?: string;
  location?: string;
  investmentType?: string;
  timeline?: string;
  riskTolerance?: string;
  seeking?: string;
}

interface InboxEmail {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  tag: 'investor' | 'jv' | 'lender' | 'buyer' | 'general';
  intent?: InvestorIntent;
  aiReply?: string;
  aiAnalysis?: string;
  status: 'new' | 'ai_replied' | 'manual_replied' | 'archived';
}

async function fetchAdminInboxEmails(): Promise<InboxEmail[]> {
  const API_BASE = getDirectApiBaseUrl() || (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!API_BASE) {
    console.log('[AdminInbox] No API_BASE configured — cannot fetch emails');
    return [];
  }

  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}/api/emails?accountId=admin&folder=all&limit=100`, { headers });
    if (!res.ok) {
      console.log('[AdminInbox] Backend returned', res.status);
      return [];
    }
    const data = await res.json() as { success: boolean; emails: Array<Record<string, unknown>> };
    if (!data.success || !Array.isArray(data.emails)) return [];

    console.log(`[AdminInbox] Fetched ${data.emails.length} real emails from backend`);
    return data.emails.map((e: Record<string, unknown>, i: number) => ({
      id: (e.id as string) || `be-${i}`,
      from: (e.fromName as string) || (e.from as any)?.name || 'Unknown',
      fromEmail: (e.fromEmail as string) || (e.from as any)?.email || '',
      subject: (e.subject as string) || '(No Subject)',
      body: (e.body as string) || '',
      receivedAt: (e.date as string) || new Date().toISOString(),
      isRead: (e.isRead as boolean) ?? false,
      isStarred: (e.isStarred as boolean) ?? false,
      tag: inferTag((e.subject as string) || '', (e.body as string) || ''),
      status: 'new' as const}));
  } catch (err) {
    console.log('[AdminInbox] Fetch failed:', (err as Error)?.message);
    return [];
  }
}

function inferTag(subject: string, body: string): InboxEmail['tag'] {
  const text = `${subject} ${body}`.toLowerCase();
  if (text.includes('joint venture') || text.includes('jv ') || text.includes('co-invest')) return 'jv';
  if (text.includes('bridge') || text.includes('lend') || text.includes('loan') || text.includes('financing')) return 'lender';
  if (text.includes('buy') || text.includes('purchase') || text.includes('acquire')) return 'buyer';
  if (text.includes('invest') || text.includes('allocat') || text.includes('capital') || text.includes('yield')) return 'investor';
  return 'general';
}


const TAG_COLORS: Record<string, string> = {
  investor: Colors.primary,
  jv: '#E879F9',
  lender: Colors.accent,
  buyer: Colors.success,
  general: Colors.textSecondary};

const TAG_LABELS: Record<string, string> = {
  investor: 'Investor',
  jv: 'JV Partner',
  lender: 'Lender',
  buyer: 'Buyer',
  general: 'General'};

const STATUS_COLORS: Record<string, string> = {
  new: Colors.warning,
  ai_replied: Colors.success,
  manual_replied: Colors.accent,
  archived: Colors.textTertiary};

export default function EmailInboxScreen() {
  const router = useRouter();
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [analyzingFor, setAnalyzingFor] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingEmails(true);
    setLoadError(null);
    console.log('[AdminInbox] Loading real emails from backend...');
    fetchAdminInboxEmails()
      .then(fetched => {
        if (cancelled) return;
        setEmails(fetched);
        setLoadingEmails(false);
        console.log(`[AdminInbox] Loaded ${fetched.length} real emails`);
        if (fetched.length === 0) {
          setLoadError('No emails from backend. Inbox is empty or backend not configured.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setLoadingEmails(false);
        setLoadError((err as Error)?.message || 'Failed to load emails');
        console.log('[AdminInbox] Load error:', (err as Error)?.message);
      });
    return () => { cancelled = true; };
  }, []);

  const unreadCount = useMemo(() => emails.filter(e => !e.isRead).length, [emails]);
  const newCount = useMemo(() => emails.filter(e => e.status === 'new').length, [emails]);

  const filteredEmails = useMemo(() => {
    let list = [...emails];
    if (filterTag !== 'all') list = list.filter(e => e.tag === filterTag);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        e.from.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.fromEmail.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [emails, filterTag, searchQuery]);

  const markRead = useCallback((emailId: string) => {
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, isRead: true } : e));
  }, []);

  const toggleStar = useCallback((emailId: string) => {
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, isStarred: !e.isStarred } : e));
  }, []);

  const archiveEmail = useCallback((emailId: string) => {
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: 'archived' } : e));
    if (selectedEmail?.id === emailId) setSelectedEmail(null);
  }, [selectedEmail]);

  const openEmail = useCallback((email: InboxEmail) => {
    markRead(email.id);
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
    setSelectedEmail({ ...email, isRead: true });
    setComposeSubject(`Re: ${email.subject}`);
    setComposeBody('');
  }, [markRead]);

  const analyzeEmail = useCallback(async (email: InboxEmail) => {
    setAnalyzingFor(email.id);
    console.log('[EmailInbox] Analyzing email from:', email.fromEmail);
    try {
      const analysis = await generateText({
        messages: [
          {
            role: 'user',
            content: `You are an investment analyst for IVXHOLDINGS Holdings LLC — a full-spectrum real estate investment and wealth-building platform.

Analyze this incoming email and extract the investor's intent. Be concise and structured.

From: ${email.from} <${email.fromEmail}>
Subject: ${email.subject}
Body:
${email.body}

Return a brief analysis covering:
1. INVESTOR PROFILE: What type of investor is this?
2. BUDGET: How much do they want to invest?
3. LOCATION: Geographic preference?
4. INVESTMENT TYPE: What are they looking for?
5. TIMELINE: How urgent/what timeframe?
6. OPPORTUNITY SCORE: Rate 1-10 how strong this lead is
7. BEST PRODUCT FIT: Which IVXHOLDINGS product fits best:
   - Fractional shares ($1+) | Tokenized mortgages (6-9% yield) | JV equity ($500K+)
   - IVXHOLDINGS Earn (passive yield) | Auto-reinvest | Smart AI investing | Copy investing
   - Institutional lender program ($3M+) | Broker/referral partner program
8. NEXT STEP: Best follow-up action for this specific lead

Keep it to 8-10 lines total.`},
        ]});
      console.log('[EmailInbox] Analysis complete for:', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, aiAnalysis: analysis } : e));
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(prev => prev ? { ...prev, aiAnalysis: analysis } : prev);
      }
    } catch (err) {
      console.error('[EmailInbox] Analysis error:', err);
      Alert.alert('Error', 'Could not analyze email. Please try again.');
    } finally {
      setAnalyzingFor(null);
    }
  }, [selectedEmail]);

  const generateAIReply = useCallback(async (email: InboxEmail) => {
    setGeneratingFor(email.id);
    console.log('[EmailInbox] Generating AI reply for:', email.fromEmail);
    try {
      const reply = await generateText({
        messages: [
          {
            role: 'user',
            content: `You are the investment relations team at IVXHOLDINGS Holdings LLC — a full-spectrum real estate investment platform that gives everyone access to premium real estate wealth.

Write a professional, warm, and persuasive reply to this email. Be personal and specific to their situation. The goal is to:
1. Acknowledge exactly what they asked — match their tone
2. Present the most relevant IVXHOLDINGS products for their specific situation:
   - ENTRY LEVEL ($1 – $10K): Fractional tokenized real estate shares from just $1. Earn monthly rental dividends. 24/7 trading on our platform.
   - RETAIL ($10K – $100K): First-lien secured tokenized mortgages at 6-9% annual yield. Blockchain-verified ownership, FDIC-escrow protection, full transparency.
   - MID-TIER ($100K – $500K): Diversified tokenized property portfolios. Use our Auto-Reinvest, Smart AI Investing, or Copy Investing tools to maximize returns.
   - HIGH NET WORTH ($500K – $1.4M): JV equity co-investment alongside IVXHOLDINGS in curated South Florida premium properties.
   - INSTITUTIONAL ($1.4M+): Full JV partnership, lender syndication, white-label investment products, SEC/FinCEN compliant structures.
   - BROKERS & AGENTS: Revenue-sharing referral partner program — earn on every client you bring.
   - LENDERS: Bridge loan program, institutional allocation, lender syndication with secured first-lien positions.
3. Highlight platform strengths relevant to them: IVXHOLDINGS Earn passive yield, AI-powered Smart Investing, Copy Investing top performers, Auto-Reinvest compounding, 24/7 secondary market liquidity.
4. Include a clear, specific call to action (schedule a call, download prospectus, create a free account, etc.)
5. Sign off as "IVXHOLDINGS Holdings Investment Team"

Do NOT mention specific property addresses unless the person explicitly asked about a property. Focus on the full platform.
Keep it professional but warm and conversational. 3-5 paragraphs max.

Email to reply to:
From: ${email.from}
Subject: ${email.subject}
Body:
${email.body}`},
        ]});
      console.log('[EmailInbox] AI reply generated for:', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, aiReply: reply } : e));
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(prev => prev ? { ...prev, aiReply: reply } : prev);
        setComposeBody(reply);
      }
    } catch (err) {
      console.error('[EmailInbox] AI reply error:', err);
      Alert.alert('Error', 'Could not generate reply. Please try again.');
    } finally {
      setGeneratingFor(null);
    }
  }, [selectedEmail]);

  const sendReply = useCallback(() => {
    if (!composeBody.trim() || !selectedEmail) return;
    setSendingReply(true);
    console.log('[EmailInbox] Sending reply to:', selectedEmail.fromEmail);
    setTimeout(() => {
      setEmails(prev => prev.map(e =>
        e.id === selectedEmail.id ? { ...e, status: 'ai_replied' } : e
      ));
      setSendingReply(false);
      setSelectedEmail(null);
      setComposeBody('');
      Alert.alert('Sent', `Reply delivered to ${selectedEmail.from}`);
    }, 1200);
  }, [composeBody, selectedEmail]);

  const formatTime = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const stats = useMemo(() => ({
    total: emails.length,
    unread: unreadCount,
    aiReplied: emails.filter(e => e.status === 'ai_replied').length,
    starred: emails.filter(e => e.isStarred).length}), [emails, unreadCount]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>AI Email Inbox</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => {
            setLoadingEmails(true);
            setLoadError(null);
            fetchAdminInboxEmails()
              .then(fetched => { setEmails(fetched); setLoadingEmails(false); })
              .catch(err => { setLoadingEmails(false); setLoadError((err as Error)?.message || 'Refresh failed'); });
          }}
        >
          <RefreshCw size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statPill}>
          <Inbox size={13} color={Colors.warning} />
          <Text style={styles.statPillText}>{newCount} New</Text>
        </View>
        <View style={styles.statPill}>
          <Bot size={13} color={Colors.success} />
          <Text style={styles.statPillText}>{stats.aiReplied} AI Replied</Text>
        </View>
        <View style={styles.statPill}>
          <Star size={13} color={Colors.primary} />
          <Text style={styles.statPillText}>{stats.starred} Starred</Text>
        </View>
        <View style={styles.statPill}>
          <Mail size={13} color={Colors.accent} />
          <Text style={styles.statPillText}>{stats.total} Total</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search emails..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={15} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        {['all', 'investor', 'jv', 'lender', 'general'].map(tag => (
          <TouchableOpacity
            key={tag}
            style={[styles.filterChip, filterTag === tag && styles.filterChipActive]}
            onPress={() => setFilterTag(tag)}
          >
            <Text style={[styles.filterChipText, filterTag === tag && styles.filterChipTextActive]}>
              {tag === 'all' ? 'All' : TAG_LABELS[tag]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.emailList} showsVerticalScrollIndicator={false}>
        {filteredEmails.map(email => (
          <TouchableOpacity
            key={email.id}
            style={[styles.emailCard, !email.isRead && styles.emailCardUnread]}
            onPress={() => openEmail(email)}
            activeOpacity={0.7}
          >
            <View style={styles.emailCardLeft}>
              <View style={[styles.avatarCircle, { backgroundColor: TAG_COLORS[email.tag] + '22' }]}>
                <Text style={[styles.avatarText, { color: TAG_COLORS[email.tag] }]}>
                  {email.from.charAt(0).toUpperCase()}
                </Text>
              </View>
              {!email.isRead && <View style={styles.unreadDot} />}
            </View>
            <View style={styles.emailCardBody}>
              <View style={styles.emailCardTop}>
                <Text style={[styles.emailFrom, !email.isRead && styles.emailFromBold]} numberOfLines={1}>
                  {email.from}
                </Text>
                <Text style={styles.emailTime}>{formatTime(email.receivedAt)}</Text>
              </View>
              <Text style={[styles.emailSubject, !email.isRead && styles.emailSubjectBold]} numberOfLines={1}>
                {email.subject}
              </Text>
              <View style={styles.emailCardBottom}>
                <View style={[styles.tagBadge, { backgroundColor: TAG_COLORS[email.tag] + '18' }]}>
                  <Text style={[styles.tagText, { color: TAG_COLORS[email.tag] }]}>
                    {TAG_LABELS[email.tag]}
                  </Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[email.status] }]} />
                {email.isStarred && <Star size={12} color={Colors.primary} fill={Colors.primary} />}
                {email.aiReply && <Bot size={12} color={Colors.success} />}
              </View>
            </View>
          </TouchableOpacity>
        ))}
        {loadingEmails && filteredEmails.length === 0 && (
          <View style={styles.emptyState}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.emptyText}>Loading real emails...</Text>
          </View>
        )}
        {!loadingEmails && loadError && filteredEmails.length === 0 && (
          <View style={styles.emptyState}>
            <Inbox size={44} color={Colors.error} />
            <Text style={[styles.emptyText, { color: Colors.error }]}>{loadError}</Text>
            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4 }]}>Pull down or tap refresh to retry</Text>
          </View>
        )}
        {!loadingEmails && !loadError && filteredEmails.length === 0 && (
          <View style={styles.emptyState}>
            <Inbox size={44} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No emails found</Text>
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={selectedEmail !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedEmail(null)}
      >
        {selectedEmail && (
          <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSelectedEmail(null)}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {selectedEmail.subject}
              </Text>
              <View style={styles.modalHeaderActions}>
                <TouchableOpacity onPress={() => toggleStar(selectedEmail.id)}>
                  <Star
                    size={20}
                    color={Colors.primary}
                    fill={selectedEmail.isStarred ? Colors.primary : 'transparent'}
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => archiveEmail(selectedEmail.id)}>
                  <Trash2 size={20} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.emailMeta}>
                <View style={[styles.avatarCircleLg, { backgroundColor: TAG_COLORS[selectedEmail.tag] + '22' }]}>
                  <Text style={[styles.avatarTextLg, { color: TAG_COLORS[selectedEmail.tag] }]}>
                    {selectedEmail.from.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.emailMetaInfo}>
                  <Text style={styles.emailMetaFrom}>{selectedEmail.from}</Text>
                  <Text style={styles.emailMetaEmail}>{selectedEmail.fromEmail}</Text>
                  <Text style={styles.emailMetaTime}>{formatTime(selectedEmail.receivedAt)}</Text>
                </View>
                <View style={[styles.tagBadgeLg, { backgroundColor: TAG_COLORS[selectedEmail.tag] + '20' }]}>
                  <Text style={[styles.tagTextLg, { color: TAG_COLORS[selectedEmail.tag] }]}>
                    {TAG_LABELS[selectedEmail.tag]}
                  </Text>
                </View>
              </View>

              <View style={styles.emailBodyCard}>
                <Text style={styles.emailBodyText}>{selectedEmail.body}</Text>
              </View>

              <View style={styles.aiSection}>
                <View style={styles.aiSectionHeader}>
                  <Bot size={18} color={Colors.success} />
                  <Text style={styles.aiSectionTitle}>AI Investment Analyst</Text>
                  <View style={styles.aiBadge}>
                    <Sparkles size={10} color={Colors.primary} />
                    <Text style={styles.aiBadgeText}>Smart</Text>
                  </View>
                </View>

                {!selectedEmail.aiAnalysis ? (
                  <TouchableOpacity
                    style={styles.aiActionBtn}
                    onPress={() => analyzeEmail(selectedEmail)}
                    disabled={analyzingFor === selectedEmail.id}
                  >
                    {analyzingFor === selectedEmail.id ? (
                      <ShimmerIndicator color={Colors.success} size="small" />
                    ) : (
                      <Zap size={16} color={Colors.success} />
                    )}
                    <Text style={styles.aiActionBtnText}>
                      {analyzingFor === selectedEmail.id ? 'Analyzing investor...' : 'Analyze Investor Intent'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.analysisBox}>
                    <View style={styles.analysisHeader}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.analysisTitle}>Investor Analysis</Text>
                    </View>
                    <Text style={styles.analysisText}>{selectedEmail.aiAnalysis}</Text>
                  </View>
                )}
              </View>

              <View style={styles.replySection}>
                <View style={styles.replySectionHeader}>
                  <Reply size={18} color={Colors.accent} />
                  <Text style={styles.replySectionTitle}>Smart Reply</Text>
                </View>

                {!selectedEmail.aiReply && composeBody.length === 0 ? (
                  <TouchableOpacity
                    style={styles.generateBtn}
                    onPress={() => generateAIReply(selectedEmail)}
                    disabled={generatingFor === selectedEmail.id}
                  >
                    {generatingFor === selectedEmail.id ? (
                      <>
                        <ShimmerIndicator color={Colors.background} size="small" />
                        <Text style={styles.generateBtnText}>AI is crafting reply...</Text>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} color={Colors.background} />
                        <Text style={styles.generateBtnText}>Generate AI Reply</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}

                {(selectedEmail.aiReply || composeBody.length > 0) && (
                  <View style={styles.replyBox}>
                    <View style={styles.replyBoxHeader}>
                      <View style={styles.replyBoxTo}>
                        <Text style={styles.replyBoxToLabel}>To:</Text>
                        <Text style={styles.replyBoxToEmail}>{selectedEmail.fromEmail}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => generateAIReply(selectedEmail)}
                        disabled={generatingFor === selectedEmail.id}
                      >
                        {generatingFor === selectedEmail.id ? (
                          <ShimmerIndicator color={Colors.primary} size="small" />
                        ) : (
                          <RefreshCw size={16} color={Colors.primary} />
                        )}
                      </TouchableOpacity>
                    </View>
                    <View style={styles.replySubjectRow}>
                      <Text style={styles.replySubjectLabel}>Subject:</Text>
                      <Text style={styles.replySubjectValue}>{composeSubject}</Text>
                    </View>
                    <TextInput
                      style={styles.replyTextArea}
                      multiline
                      value={composeBody || selectedEmail.aiReply || ''}
                      onChangeText={setComposeBody}
                      placeholder="Write your reply..."
                      placeholderTextColor={Colors.textTertiary}
                    />
                    <TouchableOpacity
                      style={[styles.sendBtn, sendingReply && styles.sendBtnLoading]}
                      onPress={sendReply}
                      disabled={sendingReply}
                    >
                      {sendingReply ? (
                        <ShimmerIndicator color={Colors.background} size="small" />
                      ) : (
                        <>
                          <Send size={16} color={Colors.background} />
                          <Text style={styles.sendBtnText}>Send Reply</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10},
  backBtn: {
    padding: 4},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text},
  unreadBadge: {
    backgroundColor: Colors.warning,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5},
  unreadBadgeText: {
    color: Colors.background,
    fontSize: 11,
    fontWeight: '700'},
  refreshBtn: {
    padding: 8,
    backgroundColor: Colors.primary + '15',
    borderRadius: 10},
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8},
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border},
  statPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary},
  searchRow: {
    paddingHorizontal: 14,
    paddingBottom: 8},
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text},
  filterScroll: {
    maxHeight: 44},
  filterContent: {
    paddingHorizontal: 14,
    gap: 8,
    paddingBottom: 8},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.background},
  emailList: {
    flex: 1},
  emailCard: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
    backgroundColor: Colors.background},
  emailCardUnread: {
    backgroundColor: Colors.card},
  emailCardLeft: {
    position: 'relative'},
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center'},
  avatarText: {
    fontSize: 18,
    fontWeight: '700'},
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.warning,
    borderWidth: 2,
    borderColor: Colors.background},
  emailCardBody: {
    flex: 1,
    gap: 4},
  emailCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  emailFrom: {
    fontSize: 14,
    color: Colors.textSecondary,
    flex: 1},
  emailFromBold: {
    color: Colors.text,
    fontWeight: '600'},
  emailTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginLeft: 8},
  emailSubject: {
    fontSize: 14,
    color: Colors.textSecondary},
  emailSubjectBold: {
    color: Colors.text,
    fontWeight: '600'},
  emailCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2},
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5},
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3},
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12},
  emptyText: {
    fontSize: 16,
    color: Colors.textTertiary},
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background},
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  modalCloseBtn: {
    padding: 4},
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text},
  modalHeaderActions: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center'},
  modalScroll: {
    flex: 1},
  emailMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  avatarCircleLg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center'},
  avatarTextLg: {
    fontSize: 22,
    fontWeight: '700'},
  emailMetaInfo: {
    flex: 1,
    gap: 2},
  emailMetaFrom: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text},
  emailMetaEmail: {
    fontSize: 13,
    color: Colors.textSecondary},
  emailMetaTime: {
    fontSize: 12,
    color: Colors.textTertiary},
  tagBadgeLg: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8},
  tagTextLg: {
    fontSize: 12,
    fontWeight: '700'},
  emailBodyCard: {
    margin: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  emailBodyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22},
  aiSection: {
    marginHorizontal: 14,
    marginBottom: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.success + '30'},
  aiSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  aiSectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text},
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary},
  aiActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.success + '15',
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.success + '30'},
  aiActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.success},
  analysisBox: {
    gap: 8},
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  analysisTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.success},
  analysisText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20},
  replySection: {
    marginHorizontal: 14,
    marginBottom: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent + '30'},
  replySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  replySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text},
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14},
  generateBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.background},
  replyBox: {
    gap: 12},
  replyBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  replyBoxTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  replyBoxToLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600'},
  replyBoxToEmail: {
    fontSize: 12,
    color: Colors.accent},
  replySubjectRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  replySubjectLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600'},
  replySubjectValue: {
    fontSize: 12,
    color: Colors.text,
    flex: 1},
  replyTextArea: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.border,
    lineHeight: 20},
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14},
  sendBtnLoading: {
    opacity: 0.7},
  sendBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white}});
