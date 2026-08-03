import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileCheck,
  Filter,
  Hash,
  Lock,
  Mail,
  MessageCircle,
  Brain,
  Building2,
  Plug,
  Printer,
  Share2,
  ShieldCheck,
  Clipboard as ClipboardIcon,
  Zap} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import {
  DEVELOPER_HANDOFF_CATEGORIES,
  generateHandoffHtmlReport,
  generateHandoffTextReport,
  getAllEnvVariables,
  getAllIntegrations,
  getConfiguredEnvCount,
  getDeliverySummary,
  getInProgressCount,
  getReadyCount} from '@/mocks/developer-handoff';
import type { IntegrationOwner, IntegrationPriority, IntegrationStatus } from '@/mocks/developer-handoff';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Database: <Database size={18} color="#4A90D9" />,
  Lock: <Lock size={18} color="#6366F1" />,
  CreditCard: <CreditCard size={18} color="#00C48C" />,
  ShieldCheck: <ShieldCheck size={18} color="#F59E0B" />,
  Bell: <Bell size={18} color="#EC4899" />,
  Brain: <Brain size={18} color="#A855F7" />,
  Building2: <Building2 size={18} color="#F97316" />,
  BarChart3: <BarChart3 size={18} color="#0EA5E9" />,
  FileCheck: <FileCheck size={18} color="#78716C" />,
  Plug: <Plug size={18} color="#00C48C" />};

const PRIORITY_CONFIG: Record<IntegrationPriority, { color: string; label: string }> = {
  critical: { color: '#DC2626', label: 'Critical' },
  high: { color: '#F59E0B', label: 'High' },
  medium: { color: '#4A90D9', label: 'Medium' },
  low: { color: '#6B7280', label: 'Low' }};

const STATUS_CONFIG: Record<IntegrationStatus, { color: string; label: string }> = {
  ready: { color: '#00C48C', label: 'Ready' },
  mock_only: { color: '#F59E0B', label: 'Mock Only' },
  in_progress: { color: '#4A90D9', label: 'In Progress' },
  not_started: { color: '#6B7280', label: 'Not Started' }};

const OWNER_CONFIG: Record<IntegrationOwner, { color: string; label: string; shortLabel: string }> = {
  ivx: { color: '#FFD700', label: 'IVX side', shortLabel: 'IVX' },
  user: { color: '#FF6B9D', label: 'Your side', shortLabel: 'You' },
  shared: { color: '#A78BFA', label: 'Shared', shortLabel: 'Both' }};

function getEffectivePriority(item: { priority: IntegrationPriority; status: IntegrationStatus }): IntegrationPriority {
  if (item.status === 'ready' || item.status === 'mock_only') {
    return item.priority === 'critical' || item.priority === 'high' ? 'low' : item.priority;
  }

  return item.priority;
}

function getPriorityDisplay(item: { priority: IntegrationPriority; status: IntegrationStatus }): { color: string; label: string } {
  if (item.status === 'ready') {
    return { color: '#00C48C', label: 'Resolved' };
  }

  if (item.status === 'mock_only') {
    return { color: '#F59E0B', label: 'Mock Only' };
  }

  if (item.priority === 'critical') {
    return { color: '#F97316', label: 'Needs Audit' };
  }

  return PRIORITY_CONFIG[item.priority];
}

export default function DeveloperHandoffScreen() {
  const router = useRouter();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(DEVELOPER_HANDOFF_CATEGORIES.map((category) => category.id)));
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<boolean>(false);
  const [pasted, setPasted] = useState<boolean>(false);
  const [clipboardPreview, setClipboardPreview] = useState<string>('');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState<boolean>(false);
  const [filterPriority, setFilterPriority] = useState<'all' | IntegrationPriority>('all');
  const [showEnvVars, setShowEnvVars] = useState<boolean>(false);

  const allItems = useMemo(() => getAllIntegrations(), []);
  const allEnvVars = useMemo(() => getAllEnvVariables(), []);
  const openCriticalCount = useMemo(() => {
    return allItems.filter((item) => item.priority === 'critical' && item.status !== 'ready').length;
  }, [allItems]);
  const readyCount = useMemo(() => getReadyCount(), []);
  const inProgressCount = useMemo(() => getInProgressCount(), []);
  const configuredEnvCount = useMemo(() => getConfiguredEnvCount(), []);
  const deliverySummary = useMemo(() => getDeliverySummary(), []);

  const totalRemainingItems = useMemo(() => {
    return deliverySummary.ivx.remainingItems + deliverySummary.user.remainingItems + deliverySummary.shared.remainingItems;
  }, [deliverySummary]);

  const totalRemainingHours = useMemo(() => {
    return deliverySummary.ivx.remainingHours + deliverySummary.user.remainingHours + deliverySummary.shared.remainingHours;
  }, [deliverySummary]);

  const filteredCategories = useMemo(() => {
    if (filterPriority === 'all') {
      return DEVELOPER_HANDOFF_CATEGORIES;
    }

    return DEVELOPER_HANDOFF_CATEGORIES.map((category) => ({
      ...category,
      items: category.items.filter((item) => getEffectivePriority(item) === filterPriority)})).filter((category) => category.items.length > 0);
  }, [filterPriority]);

  const visibleItemCount = useMemo(() => {
    return filteredCategories.reduce((sum, category) => sum + category.items.length, 0);
  }, [filteredCategories]);

  const expandAllCategories = useCallback(() => {
    console.log('[DeveloperHandoff] Expanding all categories');
    setExpandedCategories(new Set(filteredCategories.map((category) => category.id)));
  }, [filteredCategories]);

  const collapseAllCategories = useCallback(() => {
    console.log('[DeveloperHandoff] Collapsing all categories');
    setExpandedCategories(new Set());
    setExpandedItems(new Set());
  }, []);

  const toggleCategory = useCallback((id: string) => {
    setExpandedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleItem = useCallback((id: string) => {
    setExpandedItems((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    try {
      console.log('[DeveloperHandoff] Copying refreshed report');
      const content = generateHandoffTextReport();
      await Clipboard.setStringAsync(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      Alert.alert('Copied', 'Developer workplan copied.');
    } catch (error) {
      console.log('[DeveloperHandoff] Copy failed', error);
      Alert.alert('Error', 'Failed to copy the developer workplan.');
    }
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      console.log('[DeveloperHandoff] Reading clipboard');
      const content = await Clipboard.getStringAsync();
      const trimmed = content.trim();
      if (!trimmed) {
        Alert.alert('Clipboard empty', 'Copy text first, then tap paste.');
        return;
      }
      setClipboardPreview(trimmed);
      setPasted(true);
      setTimeout(() => setPasted(false), 2000);
      Alert.alert('Pasted', 'Clipboard text loaded below.');
    } catch (error) {
      console.log('[DeveloperHandoff] Paste failed', error);
      Alert.alert('Error', 'Failed to read the clipboard.');
    }
  }, []);

  const handleGeneratePDF = useCallback(async () => {
    setIsGeneratingPDF(true);
    try {
      console.log('[DeveloperHandoff] Generating PDF');
      const html = generateHandoffHtmlReport();
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          setTimeout(() => printWindow.print(), 400);
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Developer Workplan',
            UTI: 'com.adobe.pdf'});
        } else {
          Alert.alert('PDF ready', uri);
        }
      }
    } catch (error) {
      console.log('[DeveloperHandoff] PDF generation failed', error);
      Alert.alert('Error', 'Failed to generate PDF.');
    } finally {
      setIsGeneratingPDF(false);
    }
  }, []);

  const handleShareWhatsApp = useCallback(async () => {
    const content = generateHandoffTextReport();
    const summary = `Developer module refreshed\nRemaining items: ${totalRemainingItems}\nRemaining hours: ${totalRemainingHours}h\nIVX: ${deliverySummary.ivx.remainingItems}\nYou: ${deliverySummary.user.remainingItems}\nShared: ${deliverySummary.shared.remainingItems}\n\n`;

    try {
      console.log('[DeveloperHandoff] Sharing to WhatsApp');
      if (Platform.OS === 'web') {
        const message = encodeURIComponent(summary + content);
        window.open(`https://wa.me/?text=${message}`, '_blank');
        return;
      }

      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(summary + content)}`;
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Share.share({ message: summary + content });
      }
    } catch (error) {
      console.log('[DeveloperHandoff] WhatsApp share failed', error);
      await Share.share({ message: summary + content });
    }
  }, [deliverySummary, totalRemainingHours, totalRemainingItems]);

  const handleShareEmail = useCallback(async () => {
    const content = generateHandoffTextReport();
    const subject = 'IVXHOLDINGS Developer Workplan';

    try {
      console.log('[DeveloperHandoff] Sharing by email');
      const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`;
      if (Platform.OS === 'web') {
        window.open(mailtoUrl, '_blank');
        return;
      }

      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        await Share.share({ title: subject, message: content });
      }
    } catch (error) {
      console.log('[DeveloperHandoff] Email share failed', error);
      await Share.share({ title: subject, message: content });
    }
  }, []);

  const handleShareGeneral = useCallback(async () => {
    try {
      console.log('[DeveloperHandoff] Opening general share sheet');
      const content = generateHandoffTextReport();
      await Share.share({
        title: 'Developer Workplan',
        message: content});
    } catch (error) {
      console.log('[DeveloperHandoff] General share failed', error);
    }
  }, []);

  const handleDownloadText = useCallback(() => {
    const content = generateHandoffTextReport();

    try {
      console.log('[DeveloperHandoff] Downloading text report');
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `developer-workplan-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        return;
      }

      void Share.share({ title: 'Developer Workplan', message: content });
    } catch (error) {
      console.log('[DeveloperHandoff] Text download failed', error);
      Alert.alert('Error', 'Failed to export the text file.');
    }
  }, []);

  const handleOpenDocs = useCallback((url: string) => {
    if (!url) {
      return;
    }

    console.log('[DeveloperHandoff] Opening docs', url);
    void Linking.openURL(url);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.back()}
            style={styles.backButton}
            testID="developer-module-back-btn"
          >
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>

          <View style={styles.topBarCenter}>
            <Text style={styles.topBarTitle}>Developer Module</Text>
            <Text style={styles.topBarSubtitle}>Refreshed</Text>
          </View>

          <View style={styles.topBarSpacer} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Code2 size={28} color={Colors.background} />
          </View>
          <Text style={styles.heroTitle}>Developer Workplan</Text>
          <Text style={styles.heroSubtitle}>
            Old generic items were cleared from this module. This screen now shows the current project split, the items I can finish, the items you need to handle, and the estimated time.
          </Text>
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{allItems.length} total items</Text>
            </View>
            <View style={styles.heroBadgeSecondary}>
              <Text style={styles.heroBadgeSecondaryText}>{totalRemainingItems} remaining</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{readyCount}</Text>
            <Text style={styles.statLabel}>Ready now</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#4A90D9' }]}>{inProgressCount}</Text>
            <Text style={styles.statLabel}>In progress</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#F97316' }]}>{openCriticalCount}</Text>
            <Text style={styles.statLabel}>Needs audit</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.primary }]}>{configuredEnvCount}/{allEnvVars.length}</Text>
            <Text style={styles.statLabel}>Configured envs</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Work split</Text>
            <Text style={styles.sectionMeta}>{totalRemainingHours}h remaining</Text>
          </View>

          <View style={styles.splitGrid}>
            {(['ivx', 'user', 'shared'] as const).map((owner) => {
              const ownerConfig = OWNER_CONFIG[owner];
              const bucket = deliverySummary[owner];
              return (
                <View key={owner} style={styles.splitCard}>
                  <View style={[styles.splitPill, { backgroundColor: ownerConfig.color }]}>
                    <Text style={styles.splitPillText}>{ownerConfig.shortLabel}</Text>
                  </View>
                  <Text style={styles.splitTitle}>{ownerConfig.label}</Text>
                  <Text style={styles.splitValue}>{bucket.remainingItems} items</Text>
                  <Text style={styles.splitSub}>{bucket.remainingHours}h estimated</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.timeBanner}>
          <Clock size={16} color={Colors.primary} />
          <Text style={styles.timeBannerText}>
            {'This screen is a delivery workplan, not a live production outage board. I can finish '}
            <Text style={styles.timeBannerBold}>{`${deliverySummary.ivx.remainingItems} items`}</Text>
            {' on my side. You still have '}
            <Text style={styles.timeBannerBold}>{`${deliverySummary.user.remainingItems} items`}</Text>
            {' on your side, plus '}
            <Text style={styles.timeBannerBold}>{`${deliverySummary.shared.remainingItems} shared items.`}</Text>
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Export</Text>
          <View style={styles.actionGrid}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={isGeneratingPDF}
              onPress={handleGeneratePDF}
              style={[styles.actionButton, { backgroundColor: '#DC2626' }]}
              testID="developer-module-pdf-btn"
            >
              {isGeneratingPDF ? <ShimmerIndicator color="#FFFFFF" size="small" /> : <Printer size={16} color="#FFFFFF" />}
              <Text style={styles.actionButtonText}>{isGeneratingPDF ? 'Creating' : 'PDF'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleShareWhatsApp}
              style={[styles.actionButton, { backgroundColor: '#25D366' }]}
              testID="developer-module-whatsapp-btn"
            >
              <MessageCircle size={16} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleShareEmail}
              style={[styles.actionButton, { backgroundColor: '#EA4335' }]}
              testID="developer-module-email-btn"
            >
              <Mail size={16} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Email</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleCopyToClipboard}
              style={[styles.actionButton, { backgroundColor: Colors.primary }]}
              testID="developer-module-copy-btn"
            >
              {copied ? <CheckCircle size={16} color={Colors.background} /> : <Copy size={16} color={Colors.background} />}
              <Text style={[styles.actionButtonText, { color: Colors.background }]}>{copied ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handlePasteFromClipboard}
              style={[styles.actionButton, { backgroundColor: pasted ? '#10B981' : '#0F766E' }]}
              testID="developer-module-paste-btn"
            >
              {pasted ? <CheckCircle size={16} color="#FFFFFF" /> : <ClipboardIcon size={16} color="#FFFFFF" />}
              <Text style={styles.actionButtonText}>{pasted ? 'Pasted' : 'Paste'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleDownloadText}
              style={[styles.actionButton, { backgroundColor: '#4A90D9' }]}
              testID="developer-module-download-btn"
            >
              <Download size={16} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Text</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleShareGeneral}
              style={[styles.actionButton, { backgroundColor: '#8B5CF6' }]}
              testID="developer-module-share-btn"
            >
              <Share2 size={16} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Share</Text>
            </TouchableOpacity>
          </View>

          {clipboardPreview ? (
            <View style={styles.clipboardPreviewCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Clipboard preview</Text>
                <Text style={styles.sectionMeta}>{clipboardPreview.length} chars</Text>
              </View>
              <Text style={styles.clipboardPreviewText} numberOfLines={8}>
                {clipboardPreview}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Filter size={14} color={Colors.textSecondary} />
              <Text style={styles.sectionTitle}>Priority filter</Text>
            </View>
            <Text style={styles.sectionMeta}>{visibleItemCount} shown</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {(['all', 'critical', 'high', 'medium', 'low'] as const).map((priority) => {
                const selected = filterPriority === priority;
                const chipLabel = priority === 'all'
                  ? `All (${allItems.length})`
                  : `${PRIORITY_CONFIG[priority].label} (${allItems.filter((item) => getEffectivePriority(item) === priority).length})`;

                return (
                  <TouchableOpacity
                    key={priority}
                    activeOpacity={0.8}
                    onPress={() => setFilterPriority(priority)}
                    style={[
                      styles.filterChip,
                      selected && styles.filterChipActive,
                      selected && priority !== 'all' && { backgroundColor: PRIORITY_CONFIG[priority].color, borderColor: PRIORITY_CONFIG[priority].color },
                    ]}
                    testID={`developer-module-filter-${priority}`}
                  >
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{chipLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Items</Text>
            <View style={styles.expandActions}>
              <TouchableOpacity activeOpacity={0.8} onPress={expandAllCategories} style={styles.secondaryButton} testID="developer-module-expand-btn">
                <Text style={styles.secondaryButtonText}>Expand</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.8} onPress={collapseAllCategories} style={styles.secondaryButton} testID="developer-module-collapse-btn">
                <Text style={styles.secondaryButtonText}>Collapse</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.categoryList}>
            {filteredCategories.map((category) => {
              const expanded = expandedCategories.has(category.id);
              const categoryHours = category.items.reduce((sum, item) => sum + item.estimatedHours, 0);

              return (
                <View key={category.id} style={styles.categoryCard}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => toggleCategory(category.id)}
                    style={styles.categoryHeader}
                    testID={`developer-module-category-${category.id}`}
                  >
                    <View style={styles.categoryHeaderLeft}>
                      <View style={[styles.categoryIconWrap, { backgroundColor: `${category.color}18` }]}>
                        {CATEGORY_ICONS[category.icon] ?? <Code2 size={18} color={category.color} />}
                      </View>
                      <View style={styles.categoryHeaderText}>
                        <Text style={styles.categoryTitle}>{category.title}</Text>
                        <Text style={styles.categoryMeta}>{category.items.length} items · {categoryHours}h</Text>
                      </View>
                    </View>
                    {expanded ? <ChevronDown size={18} color={Colors.textSecondary} /> : <ChevronRight size={18} color={Colors.textSecondary} />}
                  </TouchableOpacity>

                  {expanded && (
                    <View style={styles.itemList}>
                      {category.items.map((item) => {
                        const itemExpanded = expandedItems.has(item.id);
                        const priorityConfig = getPriorityDisplay(item);
                        const statusConfig = STATUS_CONFIG[item.status];
                        const ownerConfig = OWNER_CONFIG[item.owner];

                        return (
                          <View key={item.id} style={styles.itemCard}>
                            <TouchableOpacity
                              activeOpacity={0.8}
                              onPress={() => toggleItem(item.id)}
                              style={styles.itemHeader}
                              testID={`developer-module-item-${item.id}`}
                            >
                              <View style={styles.itemHeaderText}>
                                <Text style={styles.itemName}>{item.name}</Text>
                                <Text style={styles.itemProvider}>{item.provider}</Text>
                              </View>
                              <View style={styles.itemBadges}>
                                <View style={[styles.tag, { backgroundColor: `${ownerConfig.color}22` }]}>
                                  <Text style={[styles.tagText, { color: ownerConfig.color }]}>{ownerConfig.shortLabel}</Text>
                                </View>
                                <View style={[styles.tag, { backgroundColor: `${priorityConfig.color}22` }]}>
                                  <Text style={[styles.tagText, { color: priorityConfig.color }]}>{priorityConfig.label}</Text>
                                </View>
                                <View style={[styles.tag, { backgroundColor: `${statusConfig.color}22` }]}>
                                  <Text style={[styles.tagText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
                                </View>
                              </View>
                            </TouchableOpacity>

                            {itemExpanded && (
                              <View style={styles.itemBody}>
                                <Text style={styles.itemDescription}>{item.description}</Text>

                                <View style={styles.inlineMetaRow}>
                                  <Clock size={13} color={Colors.textSecondary} />
                                  <Text style={styles.inlineMetaText}>{item.estimatedHours}h estimate</Text>
                                </View>

                                {item.envVariables.length > 0 && (
                                  <View style={styles.detailBlock}>
                                    <Text style={styles.detailTitle}>Environment variables</Text>
                                    {item.envVariables.map((variable) => (
                                      <View key={variable.name} style={styles.envCard}>
                                        <View style={styles.envCardHeader}>
                                          <Text style={styles.envName}>{variable.name}</Text>
                                          <View style={styles.envCardBadges}>
                                            {variable.required ? (
                                              <View style={[styles.tag, { backgroundColor: '#DC262622' }]}>
                                                <Text style={[styles.tagText, { color: '#DC2626' }]}>Required</Text>
                                              </View>
                                            ) : null}
                                            <View style={[styles.tag, { backgroundColor: variable.configured ? '#00C48C22' : '#6B728022' }]}>
                                              <Text style={[styles.tagText, { color: variable.configured ? '#00C48C' : '#9CA3AF' }]}>
                                                {variable.configured ? 'Configured' : 'Missing'}
                                              </Text>
                                            </View>
                                          </View>
                                        </View>
                                        <Text style={styles.envDescription}>{variable.description}</Text>
                                        <Text style={styles.envExample}>{variable.example}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}

                                {item.endpoints.length > 0 && (
                                  <View style={styles.detailBlock}>
                                    <Text style={styles.detailTitle}>Linked screens</Text>
                                    {item.endpoints.map((endpoint) => (
                                      <Text key={endpoint} style={styles.endpointText}>• {endpoint}</Text>
                                    ))}
                                  </View>
                                )}

                                {item.notes ? (
                                  <View style={styles.noteRow}>
                                    <AlertTriangle size={14} color="#F59E0B" />
                                    <Text style={styles.noteText}>{item.notes}</Text>
                                  </View>
                                ) : null}

                                {item.docsUrl ? (
                                  <TouchableOpacity
                                    activeOpacity={0.8}
                                    onPress={() => handleOpenDocs(item.docsUrl)}
                                    style={styles.docsButton}
                                    testID={`developer-module-docs-${item.id}`}
                                  >
                                    <ExternalLink size={14} color={Colors.primary} />
                                    <Text style={styles.docsButtonText}>Open docs</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setShowEnvVars((previous) => !previous)}
          style={styles.sectionCard}
          testID="developer-module-env-toggle"
        >
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Hash size={15} color={Colors.primary} />
              <Text style={styles.sectionTitle}>All environment variables</Text>
            </View>
            <View style={styles.envSummaryRight}>
              <Text style={styles.sectionMeta}>{configuredEnvCount}/{allEnvVars.length}</Text>
              {showEnvVars ? <ChevronDown size={18} color={Colors.textSecondary} /> : <ChevronRight size={18} color={Colors.textSecondary} />}
            </View>
          </View>

          {showEnvVars ? (
            <View style={styles.allEnvList}>
              {allEnvVars.map((variable) => (
                <View key={variable.name} style={styles.allEnvCard}>
                  <View style={styles.envCardHeader}>
                    <Text style={styles.envName}>{variable.name}</Text>
                    <View style={styles.envCardBadges}>
                      <View style={[styles.tag, { backgroundColor: variable.configured ? '#00C48C22' : '#6B728022' }]}>
                        <Text style={[styles.tagText, { color: variable.configured ? '#00C48C' : '#9CA3AF' }]}>
                          {variable.configured ? 'Configured' : 'Missing'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.envDescription}>{variable.description}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </TouchableOpacity>

        <View style={styles.infoCard}>
          <Zap size={18} color={Colors.primary} />
          <View style={styles.infoCardTextWrap}>
            <Text style={styles.infoCardTitle}>Completion estimate</Text>
            <Text style={styles.infoCardText}>
              Fast finish: about 2-4 working days for my side if we keep scope tight. Full closeout including your items and shared approvals: about 1-2 weeks depending on your account access, confirmations, and production decisions.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background},
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 16},
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8},
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  topBarCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2},
  topBarTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700'},
  topBarSubtitle: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600'},
  topBarSpacer: {
    width: 40,
    height: 40},
  heroCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 24,
    padding: 22,
    gap: 14},
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center'},
  heroTitle: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: '800'},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21},
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  heroBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8},
  heroBadgeText: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '700'},
  heroBadgeSecondary: {
    backgroundColor: '#1F2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8},
  heroBadgeSecondaryText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700'},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12},
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    gap: 6},
  statValue: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800'},
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 18,
    gap: 14},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12},
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1},
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700'},
  sectionMeta: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600'},
  splitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12},
  splitCard: {
    flexGrow: 1,
    flexBasis: '31%',
    minWidth: 92,
    backgroundColor: '#0F0F10',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 18,
    padding: 14,
    gap: 8},
  splitPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5},
  splitPillText: {
    color: Colors.background,
    fontSize: 11,
    fontWeight: '800'},
  splitTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700'},
  splitValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800'},
  splitSub: {
    color: Colors.textSecondary,
    fontSize: 12},
  timeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.18)',
    padding: 14},
  timeBannerText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  timeBannerBold: {
    color: Colors.text,
    fontWeight: '700'},
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  actionButton: {
    minWidth: 98,
    flexGrow: 1,
    flexBasis: '31%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  actionButtonText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '700'},
  clipboardPreviewCard: {
    marginTop: 4,
    backgroundColor: '#0F0F10',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 10},
  clipboardPreviewText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  filterRow: {
    flexDirection: 'row',
    gap: 10},
  filterChip: {
    backgroundColor: '#101010',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    paddingVertical: 9},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'},
  filterChipTextActive: {
    color: Colors.background},
  expandActions: {
    flexDirection: 'row',
    gap: 8},
  secondaryButton: {
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8},
  secondaryButtonText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700'},
  categoryList: {
    gap: 12},
  categoryCard: {
    backgroundColor: '#0F0F10',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16},
  categoryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1},
  categoryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'},
  categoryHeaderText: {
    flex: 1,
    gap: 3},
  categoryTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700'},
  categoryMeta: {
    color: Colors.textSecondary,
    fontSize: 12},
  itemList: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12},
  itemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 10},
  itemHeader: {
    gap: 10},
  itemHeaderText: {
    gap: 4},
  itemName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700'},
  itemProvider: {
    color: Colors.textSecondary,
    fontSize: 12},
  itemBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5},
  tagText: {
    fontSize: 11,
    fontWeight: '700'},
  itemBody: {
    gap: 12},
  itemDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  inlineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  inlineMetaText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600'},
  detailBlock: {
    gap: 10},
  detailTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700'},
  envCard: {
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 14,
    padding: 12,
    gap: 8},
  envCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12},
  envCardBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8},
  envName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800',
    flex: 1},
  envDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  envExample: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600'},
  endpointText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 12,
    padding: 10},
  noteText: {
    flex: 1,
    color: '#FCD34D',
    fontSize: 12,
    lineHeight: 18},
  docsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4},
  docsButtonText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700'},
  envSummaryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  allEnvList: {
    gap: 10},
  allEnvCard: {
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 14,
    padding: 12,
    gap: 8},
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 18,
    padding: 16},
  infoCardTextWrap: {
    flex: 1,
    gap: 6},
  infoCardTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700'},
  infoCardText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19}});
