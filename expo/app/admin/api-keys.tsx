import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronLeft,
  Shield,
  Cloud,
  Database,
  Cpu,
  Globe,
  AlertTriangle,
  Server,
  RefreshCw} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

interface ApiKeyItem {
  id: string;
  label: string;
  value: string;
  description: string;
  category: string;
  isSensitive: boolean;
  status: 'configured' | 'missing' | 'system' | 'server';
}

const mask = (val: string) => {
  if (!val) return '— not set —';
  if (val.length <= 8) return '••••••••';
  return val.slice(0, 4) + '••••••••••••' + val.slice(-4);
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Amazon Web Services': <Cloud size={18} color="#FF9900" />,
  'Database': <Database size={18} color={Colors.accent} />,
  'Backend API': <Server size={18} color={Colors.positive} />,
  'AI & Services': <Cpu size={18} color="#A855F7" />,
  'Platform': <Globe size={18} color={Colors.primary} />};

const CATEGORY_COLORS: Record<string, string> = {
  'Amazon Web Services': '#FF9900',
  'Database': Colors.accent,
  'Backend API': Colors.positive,
  'AI & Services': '#A855F7',
  'Platform': Colors.primary};

function buildKeys(): ApiKeyItem[] {
  return [
    {
      id: 'aws_key_id',
      label: 'AWS Access Key ID',
      value: '••• server-side only •••',
      description: 'Amazon Web Services — S3, SES, and infrastructure access',
      category: 'Amazon Web Services',
      isSensitive: true,
      status: 'server'},
    {
      id: 'aws_secret',
      label: 'AWS Secret Access Key',
      value: '••• server-side only •••',
      description: 'Secret credential paired with the Access Key ID',
      category: 'Amazon Web Services',
      isSensitive: true,
      status: 'server'},
    {
      id: 'aws_region',
      label: 'AWS Region',
      value: '••• server-side only •••',
      description: 'AWS data center region (e.g. us-east-1)',
      category: 'Amazon Web Services',
      isSensitive: true,
      status: 'server'},
    {
      id: 'api_base_url',
      label: 'API Base URL',
      value: process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ivxholding.com',
      description: 'Supabase API base URL',
      category: 'Backend API',
      isSensitive: false,
      status: 'configured'},
    {
      id: 'project_id',
      label: 'Project ID',
      value: 'ivx-holdings',
      description: 'IVX platform project identifier',
      category: 'Platform',
      isSensitive: false,
      status: 'system'},
    {
      id: 'team_id',
      label: 'Team ID',
      value: 'ivx-owner',
      description: 'IVX platform team identifier',
      category: 'Platform',
      isSensitive: false,
      status: 'system'},
  ];
}

export default function ApiKeysScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const allKeys = buildKeys();

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const copyKey = useCallback(
    async (item: ApiKeyItem) => {
      if (!item.value) {
        Alert.alert('Not Set', `${item.label} is not configured yet.`);
        return;
      }
      await Clipboard.setStringAsync(item.value);
      setCopied((prev) => ({ ...prev, [item.id]: true }));
      setTimeout(() => {
        setCopied((prev) => ({ ...prev, [item.id]: false }));
      }, 2000);
    },
    []
  );

  console.log('[ApiKeys] Loaded', allKeys.length, 'keys, refreshKey:', refreshKey);

  const grouped = allKeys.reduce<Record<string, ApiKeyItem[]>>((acc, key) => {
    if (!acc[key.category]) acc[key.category] = [];
    acc[key.category].push(key);
    return acc;
  }, {});

  const configuredCount = allKeys.filter((k) => k.status !== 'missing').length;
  const missingCount = allKeys.filter((k) => k.status === 'missing').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>API Keys Vault</Text>
          <Text style={styles.headerSub}>
            {`${configuredCount}/${allKeys.length} configured`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.shieldWrap}
          onPress={() => setRefreshKey(k => k + 1)}
        >
          <RefreshCw size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {
        <>
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { borderColor: Colors.positive + '40' }]}>
              <Text style={[styles.summaryNum, { color: Colors.positive }]}>{configuredCount}</Text>
              <Text style={styles.summaryLabel}>Configured</Text>
            </View>
            <View style={[styles.summaryCard, { borderColor: missingCount > 0 ? Colors.negative + '40' : Colors.border }]}>
              <Text style={[styles.summaryNum, { color: missingCount > 0 ? Colors.negative : Colors.textSecondary }]}>
                {missingCount}
              </Text>
              <Text style={styles.summaryLabel}>Missing</Text>
            </View>
            <View style={[styles.summaryCard, { borderColor: Colors.primary + '40' }]}>
              <Text style={[styles.summaryNum, { color: Colors.primary }]}>{allKeys.length}</Text>
              <Text style={styles.summaryLabel}>Total Keys</Text>
            </View>
          </View>

          {missingCount > 0 && (
            <View style={styles.warningBanner}>
              <AlertTriangle size={16} color={Colors.warning} />
              <Text style={styles.warningText}>
                {missingCount} key{missingCount > 1 ? 's are' : ' is'} not yet configured. Add them in your environment settings.
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {Object.entries(grouped).map(([category, keys]) => (
              <View key={category} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.categoryIconWrap, { backgroundColor: (CATEGORY_COLORS[category] ?? Colors.primary) + '20' }]}>
                    {CATEGORY_ICONS[category] ?? <Key size={18} color={Colors.primary} />}
                  </View>
                  <Text style={styles.sectionTitle}>{category}</Text>
                  <Text style={styles.sectionCount}>{keys.length} key{keys.length > 1 ? 's' : ''}</Text>
                </View>

                {keys.map((item, idx) => {
                  const isRevealed = revealed[item.id];
                  const isCopied = copied[item.id];
                  const displayValue = item.isSensitive && !isRevealed
                    ? mask(item.value)
                    : item.value || '— not set —';

                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.keyCard,
                        idx === keys.length - 1 && styles.keyCardLast,
                        item.status === 'missing' && styles.keyCardMissing,
                      ]}
                      testID={`api-key-${item.id}`}
                    >
                      <View style={styles.keyTopRow}>
                        <View style={styles.keyLabelRow}>
                          <Text style={styles.keyLabel}>{item.label}</Text>
                          <View style={[
                            styles.statusBadge,
                            item.status === 'configured' && styles.statusConfigured,
                            item.status === 'missing' && styles.statusMissing,
                            item.status === 'system' && styles.statusSystem,
                          ]}>
                            <Text style={[
                              styles.statusText,
                              item.status === 'configured' && { color: Colors.positive },
                              item.status === 'missing' && { color: Colors.negative },
                              item.status === 'system' && { color: Colors.primary },
                            ]}>
                              {item.status === 'configured' ? '● Active' : item.status === 'missing' ? '● Missing' : '● System'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.keyActions}>
                          {item.isSensitive && item.value && (
                            <TouchableOpacity
                              style={styles.actionBtn}
                              onPress={() => toggleReveal(item.id)}
                              testID={`reveal-${item.id}`}
                            >
                              {isRevealed
                                ? <EyeOff size={16} color={Colors.textSecondary} />
                                : <Eye size={16} color={Colors.textSecondary} />
                              }
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[styles.actionBtn, isCopied && styles.actionBtnCopied]}
                            onPress={() => copyKey(item)}
                            testID={`copy-${item.id}`}
                          >
                            {isCopied
                              ? <Check size={16} color={Colors.positive} />
                              : <Copy size={16} color={Colors.textSecondary} />
                            }
                          </TouchableOpacity>
                        </View>
                      </View>

                      <Text
                        style={[
                          styles.keyValue,
                          item.status === 'missing' && styles.keyValueMissing,
                          item.isSensitive && !isRevealed && item.value && styles.keyValueMasked,
                        ]}
                        numberOfLines={2}
                        ellipsizeMode="middle"
                      >
                        {displayValue}
                      </Text>

                      <Text style={styles.keyDesc}>{item.description}</Text>
                    </View>
                  );
                })}
              </View>
            ))}

            <View style={styles.securityNote}>
              <Shield size={20} color={Colors.textTertiary} />
              <Text style={styles.securityNoteText}>
                Keys are loaded from the server and never stored in the app bundle. Sensitive values are masked by default — tap the eye icon to reveal.
              </Text>
            </View>

            <View style={styles.bottomPad} />
          </ScrollView>
        </>
      }
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center'},
  headerCenter: {
    flex: 1},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text},
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  shieldWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center'},
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16},
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary},
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 32},
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 8},
  errorSub: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center'},
  retryBtn: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12},
  retryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14},
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14},
  summaryCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center'},
  summaryNum: {
    fontSize: 22,
    fontWeight: '800'},
  summaryLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '500'},
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.warning + '15',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '30'},
  warningText: {
    flex: 1,
    fontSize: 12,
    color: Colors.warning,
    lineHeight: 17},
  scroll: {
    flex: 1},
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8},
  section: {
    marginBottom: 24},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12},
  categoryIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center'},
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text},
  sectionCount: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500'},
  keyCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  keyCardLast: {
    marginBottom: 0},
  keyCardMissing: {
    borderColor: Colors.negative + '30',
    backgroundColor: Colors.negative + '08'},
  keyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8},
  keyLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1},
  keyLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text},
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5},
  statusConfigured: {
    backgroundColor: Colors.positive + '15'},
  statusMissing: {
    backgroundColor: Colors.negative + '15'},
  statusSystem: {
    backgroundColor: Colors.primary + '15'},
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2},
  keyActions: {
    flexDirection: 'row',
    gap: 6},
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center'},
  actionBtnCopied: {
    borderColor: Colors.positive + '50',
    backgroundColor: Colors.positive + '10'},
  keyValue: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Colors.accent,
    backgroundColor: Colors.background,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  keyValueMissing: {
    color: Colors.textTertiary,
    fontStyle: 'italic'},
  keyValueMasked: {
    letterSpacing: 2,
    color: Colors.textSecondary},
  keyDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 15},
  securityNote: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.border},
  securityNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17},
  bottomPad: {
    height: 60}});
