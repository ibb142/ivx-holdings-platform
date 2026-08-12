import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  Animated,
  Linking,
  Alert} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Share2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Smartphone,
  Shield,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Zap,
  MessageCircle,
  Copy,
  Clipboard} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ExpoClipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';
import { safeSetString } from '@/lib/safe-clipboard';

interface TaskItem {
  id: string;
  task: string;
  description: string;
  days: number;
  hours: number;
  priority: 'critical' | 'high' | 'medium' | 'optional';
  type: 'backend' | 'frontend' | 'integration' | 'testing' | 'design';
  depends?: string;
}

interface Phase {
  id: string;
  phase: number;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
  totalDays: number;
  tasks: TaskItem[];
}

const PHASES: Phase[] = [
  {
    id: 'phase1',
    phase: 1,
    title: 'Backend & Infrastructure',
    subtitle: 'Database, APIs, Server setup',
    icon: Database,
    color: '#FF4D4D',
    totalDays: 18,
    tasks: [
      { id: 'b1', task: 'Database Schema & Setup', description: 'PostgreSQL schema design: users, properties, transactions, KYC, wallets, tokens, dividends. Migrations & seed data.', days: 2, hours: 16, priority: 'critical', type: 'backend' },
      { id: 'b2', task: 'Authentication API (JWT + OAuth)', description: 'Email/password auth, JWT tokens, refresh tokens, Google & Apple OAuth flows, session management.', days: 3, hours: 24, priority: 'critical', type: 'backend' },
      { id: 'b3', task: 'KYC Integration (Jumio/Sumsub)', description: 'Connect KYC provider API, webhook handlers, status updates, document storage, face match results.', days: 3, hours: 24, priority: 'critical', type: 'integration' },
      { id: 'b4', task: 'Stripe Payment Integration', description: 'Card processing, Apple Pay, Google Pay, webhooks, refunds, payment intents, customer vault.', days: 3, hours: 24, priority: 'critical', type: 'integration' },
      { id: 'b5', task: 'Plaid Bank Linking', description: 'ACH transfers, account verification, balance checks, Plaid Link flow, transaction sync.', days: 2, hours: 16, priority: 'critical', type: 'integration' },
      { id: 'b6', task: 'Property & Investment APIs', description: 'CRUD for properties, share purchase/sale endpoints, order book, transaction history endpoints.', days: 2, hours: 16, priority: 'critical', type: 'backend' },
      { id: 'b7', task: 'Wallet & Withdrawal System', description: 'Wallet balance, deposit/withdrawal flows, fee engine, wire transfer handling, reconciliation.', days: 2, hours: 16, priority: 'high', type: 'backend' },
      { id: 'b8', task: 'Push Notifications (Firebase)', description: 'FCM/APNS setup, notification templates, scheduled sends, user preferences, in-app delivery.', days: 1, hours: 8, priority: 'high', type: 'integration' },
    ]},
  {
    id: 'phase2',
    phase: 2,
    title: 'Core App Features',
    subtitle: 'Auth, KYC, Marketplace, Portfolio',
    icon: Smartphone,
    color: '#F59E0B',
    totalDays: 14,
    tasks: [
      { id: 'f1', task: 'Sign Up & Login Screens', description: 'Connect registration, email verification, login, forgot password, social login buttons to live backend.', days: 2, hours: 16, priority: 'critical', type: 'frontend' },
      { id: 'f2', task: 'KYC Verification Flow', description: 'Connect document upload, face scan, identity verification form to real KYC provider API. Open to all investors.', days: 2, hours: 16, priority: 'critical', type: 'frontend' },
      { id: 'f3', task: 'Property Marketplace (Live Data)', description: 'Replace mock data with real property listings from database. Filters, search, sorting with API.', days: 2, hours: 16, priority: 'critical', type: 'frontend' },
      { id: 'f4', task: 'Trading Modal (Buy/Sell)', description: 'Connect buy/sell flows to Stripe/Plaid. Real-time price quotes, order confirmation, receipt.', days: 2, hours: 16, priority: 'critical', type: 'frontend' },
      { id: 'f5', task: 'Portfolio Dashboard (Live)', description: 'Real holdings, P&L calculations, performance charts with live data. Dividend tracking.', days: 2, hours: 16, priority: 'high', type: 'frontend' },
      { id: 'f6', task: 'Wallet Screen (Live)', description: 'Real balance, deposit/withdraw flows, bank link, transaction history from live API.', days: 2, hours: 16, priority: 'high', type: 'frontend' },
      { id: 'f7', task: 'User Profile & Settings', description: 'Save profile changes, password update, notification prefs, 2FA enable/disable to backend.', days: 1, hours: 8, priority: 'high', type: 'frontend' },
      { id: 'f8', task: 'Notifications Center (Live)', description: 'Real push notifications, in-app notification list, read/unread state, deep linking.', days: 1, hours: 8, priority: 'high', type: 'frontend' },
    ]},
  {
    id: 'phase3',
    phase: 3,
    title: 'Advanced Features',
    subtitle: 'AI, Tokens, Referrals, Admin',
    icon: Brain,
    color: '#8B5CF6',
    totalDays: 12,
    tasks: [
      { id: 'a1', task: 'AI Chat Assistant (IVX AI Gateway)', description: 'Wire the provider-backed AI assistant into the chat screen for investment analysis, portfolio insights, and property Q&A.', days: 2, hours: 16, priority: 'high', type: 'integration' },
      { id: 'a2', task: 'IVXHOLDINGS Token System (Blockchain)', description: 'Deploy smart contract, connect wallet, real token balance, buy/sell/stake/governance voting.', days: 3, hours: 24, priority: 'medium', type: 'backend' },
      { id: 'a3', task: 'Referral & Rewards System', description: 'Referral code tracking, commission calculation, leaderboard, reward distribution engine.', days: 2, hours: 16, priority: 'medium', type: 'backend' },
      { id: 'a4', task: 'Admin Panel (Live Data)', description: 'Connect all admin screens to live database. KYC approvals, user management, transactions.', days: 2, hours: 16, priority: 'high', type: 'frontend' },
      { id: 'a5', task: 'Auto-Reinvest & DRIP Engine', description: 'Scheduled dividend reinvestment, DRIP configuration per user, cron job setup.', days: 1, hours: 8, priority: 'medium', type: 'backend' },
      { id: 'a6', task: 'Tax Documents & Statements', description: 'Generate real PDF statements, 1099 forms, transaction exports from live data.', days: 1, hours: 8, priority: 'medium', type: 'backend' },
      { id: 'a7', task: 'Dividend Distribution Engine', description: 'Monthly dividend calculation per share, batch distribution, history tracking per investor.', days: 1, hours: 8, priority: 'high', type: 'backend' },
    ]},
  {
    id: 'phase4',
    phase: 4,
    title: 'Security & Compliance',
    subtitle: 'SEC, GDPR, Encryption, Audit',
    icon: Shield,
    color: '#00C48C',
    totalDays: 8,
    tasks: [
      { id: 's1', task: 'SEC Regulation A+/CF Compliance', description: 'Open-access investment structure, offering documents, SEC filing integration. No accreditation requirements.', days: 3, hours: 24, priority: 'critical', type: 'backend' },
      { id: 's2', task: 'AML / Sanctions Screening', description: 'OFAC sanctions list check, PEP screening, transaction monitoring, suspicious activity reports.', days: 2, hours: 16, priority: 'critical', type: 'integration' },
      { id: 's3', task: 'GDPR & Data Privacy', description: 'Data deletion requests, export data, consent management, cookie policy, privacy controls.', days: 1, hours: 8, priority: 'high', type: 'backend' },
      { id: 's4', task: 'Security Audit & Pen Testing', description: 'API security audit, auth flow review, SQL injection checks, rate limiting, DDoS protection.', days: 2, hours: 16, priority: 'critical', type: 'testing' },
    ]},
  {
    id: 'phase5',
    phase: 5,
    title: 'Testing & App Store',
    subtitle: 'QA, Performance, Submission',
    icon: CheckCircle2,
    color: '#06B6D4',
    totalDays: 10,
    tasks: [
      { id: 't1', task: 'End-to-End Testing (Full Flows)', description: 'Test every user journey: signup → KYC → invest → sell → withdraw. iOS and Android.', days: 3, hours: 24, priority: 'critical', type: 'testing' },
      { id: 't2', task: 'Payment Flow Testing', description: 'Stripe test cards, Plaid sandbox, Apple Pay sandbox, PayPal sandbox, edge cases.', days: 2, hours: 16, priority: 'critical', type: 'testing' },
      { id: 't3', task: 'Performance & Load Testing', description: 'API load tests, database query optimization, image caching, bundle size optimization.', days: 2, hours: 16, priority: 'high', type: 'testing' },
      { id: 't4', task: 'iOS App Store Submission', description: 'Build config, certificates, screenshots, App Store description, review guidelines compliance.', days: 1, hours: 8, priority: 'critical', type: 'testing' },
      { id: 't5', task: 'Google Play Submission', description: 'Release build, Play Store listing, screenshots, content rating, policy compliance review.', days: 1, hours: 8, priority: 'critical', type: 'testing' },
      { id: 't6', task: 'Server Deployment (Production)', description: 'Production server setup, SSL, CDN, monitoring (Sentry), CI/CD pipeline, backup strategy.', days: 1, hours: 8, priority: 'critical', type: 'backend' },
    ]},
];

const TOTAL_DAYS = PHASES.reduce((s, p) => s + p.totalDays, 0);
const TOTAL_HOURS = PHASES.reduce((s, p) => s + p.tasks.reduce((ts, t) => ts + t.hours, 0), 0);
const TOTAL_TASKS = PHASES.reduce((s, p) => s + p.tasks.length, 0);

const TYPE_COLORS: Record<string, string> = {
  backend: '#6366F1',
  frontend: '#F59E0B',
  integration: '#EC4899',
  testing: '#00C48C',
  design: '#8B5CF6'};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#FF4D4D',
  high: '#F97316',
  medium: '#EAB308',
  optional: '#6B7280'};

function generateReport(): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let r = '';
  r += '════════════════════════════════════════════\n';
  r += '   IVXHOLDINGS PLATFORM — DEVELOPER TASK BREAKDOWN\n';
  r += '════════════════════════════════════════════\n';
  r += `   Generated: ${date}\n`;
  r += `   Total: ${TOTAL_TASKS} tasks | ${TOTAL_DAYS} days | ${TOTAL_HOURS} hours\n`;
  r += '════════════════════════════════════════════\n\n';

  PHASES.forEach((phase) => {
    r += `──────────────────────────────────────────\n`;
    r += `PHASE ${phase.phase}: ${phase.title.toUpperCase()}\n`;
    r += `${phase.subtitle} | ~${phase.totalDays} days\n`;
    r += `──────────────────────────────────────────\n`;
    phase.tasks.forEach((task, i) => {
      r += `\n${i + 1}. ${task.task} [${task.priority.toUpperCase()}]\n`;
      r += `   ⏱  ${task.days} day${task.days > 1 ? 's' : ''} (${task.hours}h) | Type: ${task.type}\n`;
      r += `   📋 ${task.description}\n`;
    });
    r += '\n';
  });

  r += '──────────────────────────────────────────\n';
  r += 'TIMELINE SUMMARY\n';
  r += '──────────────────────────────────────────\n';
  PHASES.forEach((phase) => {
    r += `Phase ${phase.phase}: ${phase.title} → ${phase.totalDays} days\n`;
  });
  r += `\n✅ TOTAL ESTIMATED TIME: ${TOTAL_DAYS} WORKING DAYS\n`;
  r += `   (~${Math.ceil(TOTAL_DAYS / 5)} weeks with 1 developer)\n`;
  r += `   (~${Math.ceil(TOTAL_DAYS / 10)} weeks with 2 developers)\n\n`;

  r += '──────────────────────────────────────────\n';
  r += 'CRITICAL PRIORITY ITEMS (Do First)\n';
  r += '──────────────────────────────────────────\n';
  PHASES.forEach((phase) => {
    phase.tasks.filter(t => t.priority === 'critical').forEach(t => {
      r += `• [Phase ${phase.phase}] ${t.task} — ${t.days}d\n`;
    });
  });

  r += '\n════════════════════════════════════════════\n';
  r += '   IVXHOLDINGS Real Estate Investment Platform\n';
  r += `   Contact for questions about this breakdown\n`;
  r += '════════════════════════════════════════════\n';

  return r;
}

export default function DeveloperBreakdownScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['phase1']));
  const [copied, setCopied] = useState<boolean>(false);
  const [pastedFromClipboard, setPastedFromClipboard] = useState<boolean>(false);
  const [clipboardPreview, setClipboardPreview] = useState<string>('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true}).start();
  }, [fadeAnim]);

  const togglePhase = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedPhases(new Set(PHASES.map(p => p.id)));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPhases(new Set());
  }, []);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const report = generateReport();
    try {
      await Share.share({
        title: 'IVXHOLDINGS Developer Task Breakdown',
        message: report});
    } catch (err) {
      console.log('Share error:', err);
    }
  }, []);

  const handleWhatsApp = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const report = generateReport();
    const encoded = encodeURIComponent(report);
    const url = `whatsapp://send?text=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Share.share({ title: 'IVXHOLDINGS Developer Task Breakdown', message: report });
      }
    } catch (err) {
      console.log('WhatsApp error:', err);
      await Share.share({ title: 'IVXHOLDINGS Developer Task Breakdown', message: report });
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const report = generateReport();
    console.log('[DeveloperBreakdown] Copying report to clipboard');
    const ok = await safeSetString(report);
    if (!ok) {
      Alert.alert('Copy failed', 'Unable to copy the report right now.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      console.log('[DeveloperBreakdown] Reading clipboard preview');
      const content = await ExpoClipboard.getStringAsync();
      const trimmed = content.trim();
      if (!trimmed) {
        Alert.alert('Clipboard empty', 'Copy the report first, then tap Paste Preview.');
        return;
      }
      setClipboardPreview(trimmed);
      setPastedFromClipboard(true);
      setTimeout(() => setPastedFromClipboard(false), 2500);
    } catch (error) {
      console.log('[DeveloperBreakdown] Paste failed:', error);
      Alert.alert('Paste failed', 'Unable to read the clipboard right now.');
    }
  }, []);

  const criticalCount = PHASES.reduce((s, p) => s + p.tasks.filter(t => t.priority === 'critical').length, 0);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.View style={[styles.wrapper, { opacity: fadeAnim }]}>

          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Developer Breakdown</Text>
              <Text style={styles.headerSub}>IVXHOLDINGS Platform — Full Task List</Text>
            </View>
            <TouchableOpacity onPress={handleShare} style={styles.shareBtn} testID="share-button">
              <Share2 size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroBanner}>
            <View style={styles.heroStat}>
              <Text style={styles.heroNum}>{TOTAL_TASKS}</Text>
              <Text style={styles.heroLabel}>Tasks</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroNum}>{TOTAL_DAYS}</Text>
              <Text style={styles.heroLabel}>Days</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroNum}>{TOTAL_HOURS}h</Text>
              <Text style={styles.heroLabel}>Hours</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroNum, { color: '#FF4D4D' }]}>{criticalCount}</Text>
              <Text style={styles.heroLabel}>Critical</Text>
            </View>
          </View>

          <View style={styles.shareRow}>
            <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsApp} testID="whatsapp-button">
              <MessageCircle size={16} color="#25D366" />
              <Text style={styles.whatsappText}>Share via WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pdfBtn} onPress={handleCopy} testID="copy-button">
              {copied ? <CheckCircle2 size={16} color={Colors.primary} /> : <Copy size={16} color={Colors.primary} />}
              <Text style={styles.pdfText}>{copied ? 'Copied!' : 'Copy Report'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.clipboardRow}>
            <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste} testID="paste-button">
              {pastedFromClipboard ? <CheckCircle2 size={16} color={Colors.text} /> : <Clipboard size={16} color={Colors.text} />}
              <Text style={styles.pasteText}>{pastedFromClipboard ? 'Preview Ready' : 'Paste Preview'}</Text>
            </TouchableOpacity>
            <Text style={styles.clipboardHint}>The copy button is under the stats card. Tap Copy Report, then Paste Preview to verify it.</Text>
          </View>

          {clipboardPreview ? (
            <View style={styles.clipboardPreviewCard}>
              <View style={styles.clipboardPreviewHeader}>
                <Text style={styles.clipboardPreviewTitle}>Clipboard preview</Text>
                <Text style={styles.clipboardPreviewMeta}>{clipboardPreview.length} chars</Text>
              </View>
              <Text style={styles.clipboardPreviewText} numberOfLines={5}>{clipboardPreview}</Text>
            </View>
          ) : null}

          <View style={styles.controlRow}>
            <TouchableOpacity onPress={expandAll} style={styles.controlBtn}>
              <Text style={styles.controlText}>Expand All</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={collapseAll} style={styles.controlBtn}>
              <Text style={styles.controlText}>Collapse All</Text>
            </TouchableOpacity>
            <View style={styles.timelineHint}>
              <Clock size={12} color={Colors.textTertiary} />
              <Text style={styles.timelineHintText}>~{Math.ceil(TOTAL_DAYS / 5)}w (1 dev)</Text>
            </View>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

            {PHASES.map((phase) => {
              const isExpanded = expandedPhases.has(phase.id);
              const IconComp = phase.icon;

              return (
                <View key={phase.id} style={styles.phaseCard}>
                  <TouchableOpacity
                    style={styles.phaseHeader}
                    onPress={() => togglePhase(phase.id)}
                    testID={`phase-${phase.id}`}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.phaseIconWrap, { backgroundColor: phase.color + '22' }]}>
                      <IconComp size={20} color={phase.color} />
                    </View>
                    <View style={styles.phaseInfo}>
                      <View style={styles.phaseTitleRow}>
                        <View style={[styles.phaseBadge, { backgroundColor: phase.color }]}>
                          <Text style={styles.phaseBadgeText}>Phase {phase.phase}</Text>
                        </View>
                        <Text style={styles.phaseDays}>{phase.totalDays} days</Text>
                      </View>
                      <Text style={styles.phaseTitle}>{phase.title}</Text>
                      <Text style={styles.phaseSub}>{phase.subtitle}</Text>
                    </View>
                    {isExpanded
                      ? <ChevronDown size={18} color={Colors.textTertiary} />
                      : <ChevronRight size={18} color={Colors.textTertiary} />
                    }
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.taskList}>
                      {phase.tasks.map((task, idx) => {
                        const prColor = PRIORITY_COLORS[task.priority] ?? '#888';
                        const typeColor = TYPE_COLORS[task.type] ?? '#888';

                        return (
                          <View key={task.id} style={styles.taskItem}>
                            <View style={styles.taskLeft}>
                              <View style={[styles.taskIndex, { borderColor: phase.color + '60' }]}>
                                <Text style={[styles.taskIndexText, { color: phase.color }]}>{idx + 1}</Text>
                              </View>
                            </View>
                            <View style={styles.taskBody}>
                              <View style={styles.taskTitleRow}>
                                <Text style={styles.taskTitle}>{task.task}</Text>
                              </View>
                              <Text style={styles.taskDesc}>{task.description}</Text>
                              <View style={styles.taskMeta}>
                                <View style={styles.taskMetaChip}>
                                  <Clock size={11} color={Colors.textTertiary} />
                                  <Text style={styles.taskMetaText}>{task.days}d / {task.hours}h</Text>
                                </View>
                                <View style={[styles.taskPriorityChip, { backgroundColor: prColor + '20' }]}>
                                  <Text style={[styles.taskPriorityText, { color: prColor }]}>
                                    {task.priority.toUpperCase()}
                                  </Text>
                                </View>
                                <View style={[styles.taskTypeChip, { backgroundColor: typeColor + '18' }]}>
                                  <Text style={[styles.taskTypeText, { color: typeColor }]}>
                                    {task.type}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>TIMELINE ESTIMATE</Text>
              {PHASES.map((phase) => (
                <View key={phase.id} style={styles.summaryRow}>
                  <View style={[styles.summaryDot, { backgroundColor: phase.color }]} />
                  <Text style={styles.summaryPhase}>Phase {phase.phase}: {phase.title}</Text>
                  <Text style={[styles.summaryDaysBadge, { color: phase.color }]}>{phase.totalDays}d</Text>
                </View>
              ))}
              <View style={styles.summaryDividerLine} />
              <View style={styles.summaryTotalRow}>
                <Zap size={14} color={Colors.primary} />
                <Text style={styles.summaryTotalLabel}>Total Estimated Time</Text>
                <Text style={styles.summaryTotalVal}>{TOTAL_DAYS} days</Text>
              </View>
              <Text style={styles.summaryNote}>≈ {Math.ceil(TOTAL_DAYS / 5)} weeks solo  •  ≈ {Math.ceil(TOTAL_DAYS / 10)} weeks with 2 devs</Text>
            </View>

            <View style={styles.legendCard}>
              <Text style={styles.legendTitle}>TYPE LEGEND</Text>
              <View style={styles.legendGrid}>
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <View key={type} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: color }]} />
                    <Text style={styles.legendLabel}>{type}</Text>
                  </View>
                ))}
                {Object.entries(PRIORITY_COLORS).map(([pr, color]) => (
                  <View key={pr} style={styles.legendItem}>
                    <AlertTriangle size={10} color={color} />
                    <Text style={[styles.legendLabel, { color }]}>{pr}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.shareFooterRow}>
              <TouchableOpacity style={styles.footerShareBtn} onPress={handleWhatsApp}>
                <MessageCircle size={18} color="#25D366" />
                <Text style={styles.footerShareText}>Send to Developer via WhatsApp</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>IVXHOLDINGS Real Estate Investment Platform</Text>
              <Text style={styles.footerDate}>
                Breakdown generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>
          </ScrollView>

        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  wrapper: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  shareBtn: { padding: 8 },

  heroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginHorizontal: 16,
    marginVertical: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  heroStat: { alignItems: 'center', flex: 1 },
  heroNum: { color: Colors.primary, fontSize: 22, fontWeight: '800' as const },
  heroLabel: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  heroDivider: { width: 1, height: 32, backgroundColor: Colors.surfaceBorder },

  shareRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10},
  clipboardRow: {
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8},
  whatsappBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D36618',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#25D36640'},
  whatsappText: { color: '#25D366', fontSize: 13, fontWeight: '700' as const },
  pdfBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '18',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  pdfText: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  pasteText: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  clipboardHint: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16 },
  clipboardPreviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  clipboardPreviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clipboardPreviewTitle: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  clipboardPreviewMeta: { color: Colors.textTertiary, fontSize: 11 },
  clipboardPreviewText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },

  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12},
  controlBtn: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  controlText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  timelineHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto'},
  timelineHintText: { color: Colors.textTertiary, fontSize: 11 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 140 },

  phaseCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14},
  phaseIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  phaseInfo: { flex: 1 },
  phaseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  phaseBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  phaseBadgeText: { color: '#000', fontSize: 10, fontWeight: '800' as const },
  phaseDays: { color: Colors.textTertiary, fontSize: 11 },
  phaseTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  phaseSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 1 },

  taskList: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingVertical: 8},
  taskItem: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder + '60'},
  taskLeft: { marginRight: 12, alignItems: 'center', paddingTop: 2 },
  taskIndex: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  taskIndexText: { fontSize: 12, fontWeight: '700' as const },
  taskBody: { flex: 1 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  taskTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  taskDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  taskMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  taskMetaText: { color: Colors.textTertiary, fontSize: 11 },
  taskPriorityChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  taskPriorityText: { fontSize: 10, fontWeight: '700' as const },
  taskTypeChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  taskTypeText: { fontSize: 10, fontWeight: '600' as const },

  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  summaryTitle: { color: Colors.text, fontSize: 13, fontWeight: '800' as const, letterSpacing: 1, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  summaryDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  summaryPhase: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  summaryDaysBadge: { fontSize: 13, fontWeight: '700' as const },
  summaryDividerLine: { height: 1, backgroundColor: Colors.surfaceBorder, marginVertical: 12 },
  summaryTotalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTotalLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  summaryTotalVal: { color: Colors.primary, fontSize: 18, fontWeight: '800' as const },
  summaryNote: { color: Colors.textTertiary, fontSize: 12, marginTop: 6 },

  legendCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  legendTitle: { color: Colors.text, fontSize: 13, fontWeight: '800' as const, letterSpacing: 1, marginBottom: 12 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '44%' },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: Colors.textSecondary, fontSize: 12, textTransform: 'capitalize' as const },

  shareFooterRow: { marginBottom: 16 },
  footerShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#25D36615',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#25D36635'},
  footerShareText: { color: '#25D366', fontSize: 15, fontWeight: '700' as const },

  footer: { alignItems: 'center', paddingVertical: 16 },
  footerText: { color: Colors.textTertiary, fontSize: 12 },
  footerDate: { color: Colors.textTertiary, fontSize: 11, marginTop: 3 }});
