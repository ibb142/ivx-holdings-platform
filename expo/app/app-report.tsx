import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  Animated,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  FileText,
  Share2,
  ChevronDown,
  ChevronRight,
  Shield,
  Lock,
  Users,
  Building2,
  TrendingUp,
  BarChart3,
  Wallet,
  Gift,
    Bell,
  Brain,
  MessageSquare,
  Handshake,
  Settings,
  ShieldCheck,
  Palette,
  LineChart,
  FileCheck,
  Plug,
  Key,
  CheckCircle,
  AlertCircle,
  Circle,
  Clipboard as ClipboardIcon,
  ClipboardCopy,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import * as Haptics from 'expo-haptics';
import * as ExpoClipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import {
  FUNCTIONALITY_REGISTRY,
  getTotalFeatures,
  getTotalModules,
  getActiveFeatures,
} from '@/mocks/functionality-registry';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Lock,
  Shield,
  Users,
  Building2,
  TrendingUp,
  BarChart3,
  Wallet,
  Gift,
    Bell,
  Brain,
  MessageSquare,
  Handshake,
  Settings,
  ShieldCheck,
  Palette,
  LineChart,
  FileCheck,
  Plug,
};

interface IntegrationItem {
  id: string;
  service: string;
  description: string;
  keys: { name: string; envVar: string; example: string; isPublic: boolean }[];
  priority: 'critical' | 'high' | 'medium' | 'optional';
  status: 'mock' | 'ready' | 'partial';
  notes: string;
}

const INTEGRATIONS: IntegrationItem[] = [
  {
    id: 'stripe',
    service: 'Stripe (Payments)',
    description: 'Credit/debit card processing, Apple Pay, Google Pay',
    keys: [
      { name: 'Publishable Key', envVar: 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', example: 'pk_live_...', isPublic: true },
      { name: 'Secret Key', envVar: 'STRIPE_SECRET_KEY', example: 'sk_live_...', isPublic: false },
      { name: 'Webhook Secret', envVar: 'STRIPE_WEBHOOK_SECRET', example: 'whsec_...', isPublic: false },
      { name: 'Merchant ID', envVar: 'STRIPE_MERCHANT_ID', example: 'acct_...', isPublic: false },
    ],
    priority: 'critical',
    status: 'mock',
    notes: 'Sign up at stripe.com. Use test keys first, then switch to live.',
  },
  {
    id: 'plaid',
    service: 'Plaid (Bank Linking)',
    description: 'ACH bank transfers, account verification, balance checks',
    keys: [
      { name: 'Client ID', envVar: 'PLAID_CLIENT_ID', example: 'client_id_...', isPublic: false },
      { name: 'Secret', envVar: 'PLAID_SECRET', example: 'secret_...', isPublic: false },
      { name: 'Environment', envVar: 'PLAID_ENV', example: 'sandbox | development | production', isPublic: false },
      { name: 'Webhook URL', envVar: 'PLAID_WEBHOOK_URL', example: 'https://your-api.com/webhooks/plaid', isPublic: false },
    ],
    priority: 'critical',
    status: 'mock',
    notes: 'Sign up at plaid.com/dashboard. Start with sandbox for testing.',
  },
  {
    id: 'paypal',
    service: 'PayPal (Payments)',
    description: 'PayPal payment processing',
    keys: [
      { name: 'Client ID', envVar: 'PAYPAL_CLIENT_ID', example: 'AW...', isPublic: false },
      { name: 'Client Secret', envVar: 'PAYPAL_CLIENT_SECRET', example: 'EL...', isPublic: false },
      { name: 'Environment', envVar: 'PAYPAL_ENV', example: 'sandbox | live', isPublic: false },
    ],
    priority: 'high',
    status: 'mock',
    notes: 'Sign up at developer.paypal.com. Create REST API app.',
  },
  {
    id: 'apple_pay',
    service: 'Apple Pay',
    description: 'Native Apple Pay payments (iOS only)',
    keys: [
      { name: 'Merchant ID', envVar: 'APPLE_PAY_MERCHANT_ID', example: 'merchant.com.yourapp', isPublic: false },
      { name: 'Merchant Name', envVar: 'APPLE_PAY_MERCHANT_NAME', example: 'IVX HOLDINGS', isPublic: false },
    ],
    priority: 'medium',
    status: 'mock',
    notes: 'Requires Apple Developer Account. Configure in Xcode & Stripe dashboard.',
  },
  {
    id: 'google_pay',
    service: 'Google Pay',
    description: 'Native Google Pay payments (Android only)',
    keys: [
      { name: 'Merchant ID', envVar: 'GOOGLE_PAY_MERCHANT_ID', example: 'BCR2DN...', isPublic: false },
      { name: 'Merchant Name', envVar: 'GOOGLE_PAY_MERCHANT_NAME', example: 'IVX HOLDINGS', isPublic: false },
      { name: 'Environment', envVar: 'GOOGLE_PAY_ENV', example: 'TEST | PRODUCTION', isPublic: false },
    ],
    priority: 'medium',
    status: 'mock',
    notes: 'Register at pay.google.com/business/console.',
  },
  {
    id: 'firebase',
    service: 'Firebase (Auth + Push Notifications)',
    description: 'Social login (Google/Apple), push notifications, analytics',
    keys: [
      { name: 'API Key', envVar: 'EXPO_PUBLIC_FIREBASE_API_KEY', example: 'AIza...', isPublic: true },
      { name: 'Auth Domain', envVar: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', example: 'yourapp.firebaseapp.com', isPublic: true },
      { name: 'Project ID', envVar: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', example: 'your-project-id', isPublic: true },
      { name: 'Server Key', envVar: 'FIREBASE_SERVER_KEY', example: 'AAAA...', isPublic: false },
    ],
    priority: 'high',
    status: 'mock',
    notes: 'Create project at console.firebase.google.com.',
  },
  {
    id: 'kyc_provider',
    service: 'KYC Provider (Jumio / Onfido / Sumsub)',
    description: 'Identity verification, document scanning, face matching, sanctions screening',
    keys: [
      { name: 'API Key', envVar: 'KYC_API_KEY', example: 'api_key_...', isPublic: false },
      { name: 'API Secret', envVar: 'KYC_API_SECRET', example: 'api_secret_...', isPublic: false },
      { name: 'Webhook Secret', envVar: 'KYC_WEBHOOK_SECRET', example: 'whsec_...', isPublic: false },
    ],
    priority: 'critical',
    status: 'mock',
    notes: 'Choose Jumio, Onfido, or Sumsub. All three are supported. Currently using simulated verification.',
  },
  {
    id: 'smtp',
    service: 'SMTP / Email Service (SendGrid / SES)',
    description: 'Email campaigns, transactional emails, lender outreach',
    keys: [
      { name: 'SMTP Host', envVar: 'SMTP_HOST', example: 'smtp.sendgrid.net', isPublic: false },
      { name: 'SMTP Port', envVar: 'SMTP_PORT', example: '587', isPublic: false },
      { name: 'SMTP Username', envVar: 'SMTP_USERNAME', example: 'apikey', isPublic: false },
      { name: 'SMTP Password / API Key', envVar: 'SMTP_PASSWORD', example: 'SG.xxxx...', isPublic: false },
      { name: 'From Email', envVar: 'SMTP_FROM_EMAIL', example: 'noreply@ipxholding.com', isPublic: false },
    ],
    priority: 'high',
    status: 'mock',
    notes: 'SendGrid, AWS SES, or Mailgun. Email engine supports SMTP rotation.',
  },
  {
    id: 'sms',
    service: 'Twilio (SMS / Phone Verification)',
    description: 'Phone number verification, 2FA codes, SMS notifications',
    keys: [
      { name: 'Account SID', envVar: 'TWILIO_ACCOUNT_SID', example: 'AC...', isPublic: false },
      { name: 'Auth Token', envVar: 'TWILIO_AUTH_TOKEN', example: 'auth_token_...', isPublic: false },
      { name: 'Phone Number', envVar: 'TWILIO_PHONE_NUMBER', example: '+1234567890', isPublic: false },
      { name: 'Verify Service SID', envVar: 'TWILIO_VERIFY_SID', example: 'VA...', isPublic: false },
    ],
    priority: 'high',
    status: 'mock',
    notes: 'Sign up at twilio.com. Create Verify service for OTP.',
  },
  {
    id: 'analytics_ext',
    service: 'Analytics (Mixpanel / Amplitude)',
    description: 'User behavior tracking, funnel analysis, retention metrics',
    keys: [
      { name: 'Project Token', envVar: 'EXPO_PUBLIC_ANALYTICS_TOKEN', example: 'token_...', isPublic: true },
    ],
    priority: 'optional',
    status: 'partial',
    notes: 'Built-in analytics is functional. External service optional for advanced insights.',
  },
  {
    id: 'ivx_gateway',
    service: 'IVX AI Gateway (AI Assistant)',
    description: 'Workspace assistant, content generation, and structured AI workflows',
    keys: [
      { name: 'Toolkit URL', envVar: 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL', example: 'https://ai.ivxholding.com', isPublic: true },
      { name: 'Project ID', envVar: 'EXPO_PUBLIC_PROJECT_ID', example: 'jh1qrutuhy6vu1bkysoln', isPublic: true },
      { name: 'Team ID', envVar: 'EXPO_PUBLIC_TEAM_ID', example: 'team_123', isPublic: true },
    ],
    priority: 'medium',
    status: 'ready',
    notes: 'Already configured. Used for AI chat, admin content generation, and structured AI flows.',
  },
  {
    id: 'blockchain',
    service: 'Blockchain / Token Provider',
    description: 'IVXHOLDINGS token minting, transfers, staking, governance',
    keys: [
      { name: 'RPC URL', envVar: 'BLOCKCHAIN_RPC_URL', example: 'https://mainnet.infura.io/v3/...', isPublic: false },
      { name: 'Contract Address', envVar: 'IPX_TOKEN_CONTRACT', example: '0x...', isPublic: true },
      { name: 'Private Key (Server)', envVar: 'BLOCKCHAIN_PRIVATE_KEY', example: '0x...', isPublic: false },
    ],
    priority: 'medium',
    status: 'mock',
    notes: 'Deploy smart contract on Ethereum/Polygon. Use Infura or Alchemy for RPC.',
  },
  {
    id: 'sec_edgar',
    service: 'SEC EDGAR (Public API)',
    description: 'Lender discovery from SEC filings - free public API',
    keys: [],
    priority: 'optional',
    status: 'ready',
    notes: 'Already integrated. Uses free SEC EDGAR public API. No keys needed.',
  },
];

type TabType = 'features' | 'integrations';

export default function AppReportScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('features');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedIntegrations, setExpandedIntegrations] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pastedFromClipboard, setPastedFromClipboard] = useState<boolean>(false);
  const [clipboardPreview, setClipboardPreview] = useState<string>('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const toggleModule = useCallback((moduleId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const toggleIntegration = useCallback((integrationId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedIntegrations(prev => {
      const next = new Set(prev);
      if (next.has(integrationId)) next.delete(integrationId);
      else next.add(integrationId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (activeTab === 'features') {
      setExpandedModules(new Set(FUNCTIONALITY_REGISTRY.map(m => m.id)));
    } else {
      setExpandedIntegrations(new Set(INTEGRATIONS.map(i => i.id)));
    }
  }, [activeTab]);

  const collapseAll = useCallback(() => {
    if (activeTab === 'features') setExpandedModules(new Set());
    else setExpandedIntegrations(new Set());
  }, [activeTab]);

  const handleShareReport = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const report = generateFullReport();
    try {
      await Share.share({
        title: 'IVXHOLDINGS App - Full Functionality & Integration Report',
        message: report,
      });
    } catch (err) {
      console.log('Share error:', err);
    }
  }, []);

  const handleCopyReport = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      const report = generateFullReport();
      console.log('[AppReport] Copying full report to clipboard');
      await ExpoClipboard.setStringAsync(report);
      setCopiedId('full');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.log('[AppReport] Copy report failed:', error);
      Alert.alert('Copy failed', 'Unable to copy the report right now.');
    }
  }, []);

  const handlePasteReport = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      console.log('[AppReport] Reading clipboard preview');
      const content = await ExpoClipboard.getStringAsync();
      const trimmed = content.trim();
      if (!trimmed) {
        Alert.alert('Clipboard empty', 'Copy text first, then tap paste.');
        return;
      }
      setClipboardPreview(trimmed);
      setPastedFromClipboard(true);
      setTimeout(() => setPastedFromClipboard(false), 2000);
    } catch (error) {
      console.log('[AppReport] Paste report failed:', error);
      Alert.alert('Paste failed', 'Unable to read the clipboard right now.');
    }
  }, []);

  const totalFeatures = getTotalFeatures();
  const totalModules = getTotalModules();
  const activeFeatures = getActiveFeatures();
  const totalIntegrations = INTEGRATIONS.length;
  const criticalIntegrations = INTEGRATIONS.filter(i => i.priority === 'critical').length;

  let globalFeatureIndex = 0;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>App Report</Text>
              <Text style={styles.headerSubtitle}>{totalFeatures} Features | {totalIntegrations} Integrations</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleShareReport} style={styles.shareBtn} testID="share-button">
                <Share2 size={20} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handlePasteReport}
                style={[styles.shareBtn, pastedFromClipboard && styles.headerActionActive]}
                testID="paste-button"
              >
                {pastedFromClipboard ? <CheckCircle size={20} color={Colors.primary} /> : <ClipboardIcon size={20} color={Colors.primary} />}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCopyReport}
                style={[styles.shareBtn, copiedId === 'full' && styles.headerActionActive]}
                testID="copy-button"
              >
                {copiedId === 'full' ? <CheckCircle size={20} color={Colors.primary} /> : <ClipboardCopy size={20} color={Colors.primary} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'features' && styles.tabActive]}
              onPress={() => setActiveTab('features')}
            >
              <FileText size={16} color={activeTab === 'features' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.tabText, activeTab === 'features' && styles.tabTextActive]}>
                All Features ({totalFeatures})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'integrations' && styles.tabActive]}
              onPress={() => setActiveTab('integrations')}
            >
              <Key size={16} color={activeTab === 'integrations' ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.tabText, activeTab === 'integrations' && styles.tabTextActive]}>
                API Keys ({totalIntegrations})
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity onPress={expandAll} style={styles.actionBtn} testID="expand-all-button">
              <Text style={styles.actionText}>Expand All</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={collapseAll} style={styles.actionBtn} testID="collapse-all-button">
              <Text style={styles.actionText}>Collapse All</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCopyReport} style={styles.copyBtn} testID="copy-report-button">
              {copiedId === 'full' ? <CheckCircle size={14} color={Colors.primary} /> : <ClipboardCopy size={14} color={Colors.primary} />}
              <Text style={styles.copyText}>{copiedId === 'full' ? 'Copied!' : 'Copy Report'}</Text>
            </TouchableOpacity>
          </View>

          {clipboardPreview ? (
            <View style={styles.clipboardCard}>
              <View style={styles.clipboardCardHeader}>
                <Text style={styles.clipboardCardTitle}>Clipboard preview</Text>
                <Text style={styles.clipboardCardMeta}>{clipboardPreview.length} chars</Text>
              </View>
              <Text style={styles.clipboardCardText} numberOfLines={8}>
                {clipboardPreview}
              </Text>
            </View>
          ) : null}

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {activeTab === 'features' && (
              <View style={styles.section}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>FUNCTIONALITY SUMMARY</Text>
                  <View style={styles.summaryGrid}>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryNumber}>{totalModules}</Text>
                      <Text style={styles.summaryLabel}>Modules</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryNumber}>{totalFeatures}</Text>
                      <Text style={styles.summaryLabel}>Total Features</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                      <Text style={[styles.summaryNumber, { color: Colors.success }]}>{activeFeatures}</Text>
                      <Text style={styles.summaryLabel}>Active</Text>
                    </View>
                  </View>
                </View>

                {FUNCTIONALITY_REGISTRY.map((module, moduleIdx) => {
                  const isExpanded = expandedModules.has(module.id);
                  const IconComponent = ICON_MAP[module.icon] || FileText;
                  const moduleStartIndex = globalFeatureIndex;

                  return (
                    <View key={module.id} style={styles.moduleCard}>
                      <TouchableOpacity
                        style={styles.moduleHeader}
                        onPress={() => toggleModule(module.id)}
                        testID={`module-${module.id}`}
                      >
                        <View style={[styles.moduleIcon, { backgroundColor: module.color + '20' }]}>
                          <IconComponent size={18} color={module.color} />
                        </View>
                        <View style={styles.moduleInfo}>
                          <Text style={styles.moduleTitle}>
                            {moduleIdx + 1}. {module.title}
                          </Text>
                          <Text style={styles.moduleCount}>{module.features.length} features</Text>
                        </View>
                        {isExpanded ? (
                          <ChevronDown size={18} color={Colors.textTertiary} />
                        ) : (
                          <ChevronRight size={18} color={Colors.textTertiary} />
                        )}
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.featureList}>
                          <Text style={styles.moduleDesc}>{module.description}</Text>
                          {module.features.map((feature, fIdx) => {
                            const globalIdx = moduleStartIndex + fIdx + 1;
                            return (
                              <View key={feature.id} style={styles.featureRow}>
                                <Text style={styles.featureNum}>{globalIdx}.</Text>
                                <View style={styles.featureStatusDot}>
                                  {feature.status === 'active' ? (
                                    <CheckCircle size={12} color={Colors.success} />
                                  ) : feature.status === 'beta' ? (
                                    <AlertCircle size={12} color={Colors.warning} />
                                  ) : (
                                    <Circle size={12} color={Colors.textTertiary} />
                                  )}
                                </View>
                                <Text style={styles.featureName}>{feature.name}</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {(() => { globalFeatureIndex += module.features.length; return null; })()}
                    </View>
                  );
                })}
              </View>
            )}

            {activeTab === 'integrations' && (
              <View style={styles.section}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>INTEGRATION REQUIREMENTS</Text>
                  <Text style={styles.integrationIntro}>
                    Below are all third-party services needed. Provide me the API keys and I can integrate them for you.
                  </Text>
                  <View style={styles.summaryGrid}>
                    <View style={styles.summaryItem}>
                      <Text style={[styles.summaryNumber, { color: '#FF4D4D' }]}>{criticalIntegrations}</Text>
                      <Text style={styles.summaryLabel}>Critical</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                      <Text style={[styles.summaryNumber, { color: Colors.warning }]}>
                        {INTEGRATIONS.filter(i => i.priority === 'high').length}
                      </Text>
                      <Text style={styles.summaryLabel}>High</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                      <Text style={[styles.summaryNumber, { color: Colors.info }]}>
                        {INTEGRATIONS.filter(i => i.priority === 'medium' || i.priority === 'optional').length}
                      </Text>
                      <Text style={styles.summaryLabel}>Medium/Optional</Text>
                    </View>
                  </View>
                </View>

                {INTEGRATIONS.map((integration, idx) => {
                  const isExpanded = expandedIntegrations.has(integration.id);
                  const priorityColor = integration.priority === 'critical' ? '#FF4D4D' :
                    integration.priority === 'high' ? Colors.warning :
                    integration.priority === 'medium' ? Colors.info : Colors.textTertiary;
                  const statusColor = integration.status === 'ready' ? Colors.success :
                    integration.status === 'partial' ? Colors.warning : Colors.textTertiary;

                  return (
                    <View key={integration.id} style={styles.moduleCard}>
                      <TouchableOpacity
                        style={styles.moduleHeader}
                        onPress={() => toggleIntegration(integration.id)}
                        testID={`integration-${integration.id}`}
                      >
                        <View style={[styles.integrationNum, { borderColor: priorityColor }]}>
                          <Text style={[styles.integrationNumText, { color: priorityColor }]}>{idx + 1}</Text>
                        </View>
                        <View style={styles.moduleInfo}>
                          <Text style={styles.moduleTitle}>{integration.service}</Text>
                          <View style={styles.tagRow}>
                            <View style={[styles.priorityTag, { backgroundColor: priorityColor + '20' }]}>
                              <Text style={[styles.priorityText, { color: priorityColor }]}>
                                {integration.priority.toUpperCase()}
                              </Text>
                            </View>
                            <View style={[styles.statusTag, { backgroundColor: statusColor + '20' }]}>
                              <Text style={[styles.statusText, { color: statusColor }]}>
                                {integration.status === 'mock' ? 'Needs Keys' : integration.status === 'partial' ? 'Partial' : 'Ready'}
                              </Text>
                            </View>
                          </View>
                        </View>
                        {isExpanded ? (
                          <ChevronDown size={18} color={Colors.textTertiary} />
                        ) : (
                          <ChevronRight size={18} color={Colors.textTertiary} />
                        )}
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.featureList}>
                          <Text style={styles.moduleDesc}>{integration.description}</Text>

                          {integration.keys.length > 0 ? (
                            <>
                              <Text style={styles.keysTitle}>Required Keys:</Text>
                              {integration.keys.map((key) => (
                                <View key={key.envVar} style={styles.keyRow}>
                                  <View style={styles.keyDot} />
                                  <View style={styles.keyInfo}>
                                    <Text style={styles.keyName}>{key.name}</Text>
                                    <Text style={styles.keyEnv}>{key.envVar}</Text>
                                    <Text style={styles.keyExample}>Example: {key.example}</Text>
                                  </View>
                                </View>
                              ))}
                            </>
                          ) : (
                            <View style={styles.noKeysRow}>
                              <CheckCircle size={14} color={Colors.success} />
                              <Text style={styles.noKeysText}>No API keys needed - already working</Text>
                            </View>
                          )}

                          <View style={styles.noteBox}>
                            <Text style={styles.noteText}>{integration.notes}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}

                <View style={styles.instructionCard}>
                  <Text style={styles.instructionTitle}>HOW TO PROVIDE KEYS</Text>
                  <Text style={styles.instructionStep}>1. Sign up for each service listed above</Text>
                  <Text style={styles.instructionStep}>2. Get the API keys from each service dashboard</Text>
                  <Text style={styles.instructionStep}>3. Share the keys with me and I will integrate them</Text>
                  <Text style={styles.instructionStep}>4. I will configure everything and test the integration</Text>
                  <Text style={styles.instructionNote}>
                    Start with CRITICAL priority services first (Stripe, Plaid, KYC Provider). These are essential for the app to process real transactions.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                IVXHOLDINGS Real Estate Investment Platform v1.0.0
              </Text>
              <Text style={styles.footerDate}>
                Report generated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
            </View>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function generateFullReport(): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let report = '';

  report += '================================================================\n';
  report += '   IVXHOLDINGS REAL ESTATE INVESTMENT PLATFORM\n';
  report += '   COMPLETE APP REPORT\n';
  report += '================================================================\n\n';
  report += `Generated: ${date}\n`;
  report += `Version: 1.0.0\n\n`;

  report += '────────────────────────────────────────\n';
  report += 'PART 1: ALL FUNCTIONALITIES\n';
  report += '────────────────────────────────────────\n\n';
  report += `Total Modules: ${getTotalModules()}\n`;
  report += `Total Features: ${getTotalFeatures()}\n`;
  report += `Active Features: ${getActiveFeatures()}\n\n`;

  let globalIdx = 0;
  FUNCTIONALITY_REGISTRY.forEach((module, mIdx) => {
    report += `\n--- MODULE ${mIdx + 1}: ${module.title.toUpperCase()} (${module.features.length} features) ---\n`;
    report += `${module.description}\n\n`;
    module.features.forEach((f) => {
      globalIdx++;
      const status = f.status === 'active' ? '[ACTIVE]' : f.status === 'beta' ? '[BETA]' : '[COMING]';
      report += `  ${globalIdx}. ${status} ${f.name}\n`;
    });
    report += '\n';
  });

  report += '\n────────────────────────────────────────\n';
  report += 'PART 2: API INTEGRATIONS NEEDED\n';
  report += '────────────────────────────────────────\n\n';
  report += 'Below is every third-party service that needs API keys.\n';
  report += 'Provide these keys and I will do the full integration.\n\n';

  INTEGRATIONS.forEach((integration, idx) => {
    report += `${idx + 1}. ${integration.service}\n`;
    report += `   Priority: ${integration.priority.toUpperCase()}\n`;
    report += `   Status: ${integration.status === 'mock' ? 'NEEDS KEYS' : integration.status === 'partial' ? 'PARTIAL' : 'READY'}\n`;
    report += `   Description: ${integration.description}\n`;
    if (integration.keys.length > 0) {
      report += `   Required Keys:\n`;
      integration.keys.forEach(k => {
        report += `     - ${k.name}: ${k.envVar} (e.g. ${k.example})\n`;
      });
    } else {
      report += `   No keys needed - already working\n`;
    }
    report += `   Notes: ${integration.notes}\n\n`;
  });

  report += '────────────────────────────────────────\n';
  report += 'PART 3: PRIORITY ORDER FOR INTEGRATION\n';
  report += '────────────────────────────────────────\n\n';
  report += 'STEP 1 - CRITICAL (Do first):\n';
  INTEGRATIONS.filter(i => i.priority === 'critical').forEach(i => {
    report += `  - ${i.service}\n`;
  });
  report += '\nSTEP 2 - HIGH PRIORITY:\n';
  INTEGRATIONS.filter(i => i.priority === 'high').forEach(i => {
    report += `  - ${i.service}\n`;
  });
  report += '\nSTEP 3 - MEDIUM PRIORITY:\n';
  INTEGRATIONS.filter(i => i.priority === 'medium').forEach(i => {
    report += `  - ${i.service}\n`;
  });
  report += '\nSTEP 4 - OPTIONAL:\n';
  INTEGRATIONS.filter(i => i.priority === 'optional').forEach(i => {
    report += `  - ${i.service}\n`;
  });

  report += '\n================================================================\n';
  report += `   IVXHOLDINGS Real Estate Investment Platform - ${new Date().getFullYear()}\n`;
  report += '================================================================\n';

  return report;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  shareBtn: { padding: 8, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerActionActive: { backgroundColor: Colors.primary + '14', borderColor: Colors.primary + '50' },
  tabRow: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  copyBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', flexDirection: 'row', gap: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  copyText: { color: Colors.textSecondary, fontSize: 13 },
  clipboardCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, marginTop: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  clipboardCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  clipboardCardTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  clipboardCardMeta: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  clipboardCardText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20 },
  scroll: { flex: 1, backgroundColor: Colors.background },
  section: { marginBottom: 20 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  integrationIntro: { gap: 4 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  summaryNumber: { gap: 4 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  moduleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  moduleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  moduleInfo: { flex: 1 },
  moduleTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  moduleCount: { gap: 4 },
  moduleDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  featureList: { gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureNum: { gap: 4 },
  featureStatusDot: { width: 8, height: 8, borderRadius: 4 },
  featureName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  integrationNum: { gap: 4 },
  integrationNumText: { color: Colors.textSecondary, fontSize: 13 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { color: Colors.textSecondary, fontSize: 13 },
  statusTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  keysTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyDot: { width: 8, height: 8, borderRadius: 4 },
  keyInfo: { flex: 1 },
  keyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  keyEnv: { gap: 4 },
  keyExample: { gap: 4 },
  noKeysRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noKeysText: { color: Colors.textSecondary, fontSize: 13 },
  noteBox: { backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginTop: 8 },
  noteText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  instructionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  instructionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  instructionStep: { gap: 4 },
  instructionNote: { gap: 4 },
  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  footerText: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center' },
  footerDate: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 4 },
});
