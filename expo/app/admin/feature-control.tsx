import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  Animated,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Power,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Shield,
  ShieldCheck,
  Lock,
  Users,
  Building2,
  TrendingUp,
  Wallet,
  Gift,
    Bell,
  Brain,
  Settings,
  Palette,
  BarChart3,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  Filter,
  Layers,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FUNCTIONALITY_REGISTRY, type Module } from '@/mocks/functionality-registry';

const STORAGE_KEY = 'admin_feature_control_v1';

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Lock,
  Shield,
  Users,
  Building2,
  TrendingUp,
  Wallet,
  Gift,
    Bell,
  Brain,
  Settings,
  ShieldCheck,
  Palette,
  BarChart3,
};

type FilterType = 'all' | 'live' | 'off' | 'partial';

interface ModuleState {
  enabled: boolean;
  features: Record<string, boolean>;
}

type ControlState = Record<string, ModuleState>;

function getDefaultState(): ControlState {
  const state: ControlState = {};
  FUNCTIONALITY_REGISTRY.forEach((mod) => {
    const features: Record<string, boolean> = {};
    mod.features.forEach((f) => {
      features[f.id] = true;
    });
    state[mod.id] = { enabled: true, features };
  });
  return state;
}

export default function FeatureControlScreen() {
  const router = useRouter();
  const [controlState, setControlState] = useState<ControlState>(getDefaultState);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<string>('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const loadState = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { state: ControlState; savedAt: string };
        const merged = getDefaultState();
        Object.keys(parsed.state).forEach((modId) => {
          if (merged[modId]) {
            merged[modId]!.enabled = parsed.state[modId]!.enabled;
            Object.keys(parsed.state[modId]!.features).forEach((fId) => {
              if (merged[modId]!.features[fId] !== undefined) {
                merged[modId]!.features[fId] = parsed.state[modId]!.features[fId]!;
              }
            });
          }
        });
        setControlState(merged);
        setLastSaved(parsed.savedAt || '');
        console.log('[FeatureControl] Loaded saved state');
      }
    } catch (err) {
      console.log('[FeatureControl] Error loading state:', err);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const saveState = useCallback(async (state: ControlState) => {
    try {
      const now = new Date().toISOString();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ state, savedAt: now }));
      setLastSaved(now);
      console.log('[FeatureControl] State saved');
    } catch (err) {
      console.log('[FeatureControl] Error saving state:', err);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (isLoaded) {
      void saveState(controlState);
    }
  }, [controlState, isLoaded, saveState]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const toggleModule = useCallback((modId: string) => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setControlState((prev) => {
      const current = prev[modId];
      if (!current) return prev;
      const newEnabled = !current.enabled;
      const newFeatures: Record<string, boolean> = {};
      Object.keys(current.features).forEach((fId) => {
        newFeatures[fId] = newEnabled;
      });
      return { ...prev, [modId]: { enabled: newEnabled, features: newFeatures } };
    });
  }, []);

  const toggleFeature = useCallback((modId: string, featureId: string) => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setControlState((prev) => {
      const current = prev[modId];
      if (!current) return prev;
      const newFeatures = { ...current.features, [featureId]: !current.features[featureId] };
      const anyOn = Object.values(newFeatures).some(Boolean);
      return { ...prev, [modId]: { enabled: anyOn, features: newFeatures } };
    });
  }, []);

  const toggleExpanded = useCallback((modId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) {
        next.delete(modId);
      } else {
        next.add(modId);
      }
      return next;
    });
  }, []);

  const enableAll = useCallback(() => {
    Alert.alert('Enable All', 'Turn ON all modules and features?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Enable All',
        onPress: () => {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setControlState(getDefaultState());
        },
      },
    ]);
  }, []);

  const disableAll = useCallback(() => {
    Alert.alert('Disable All', 'Turn OFF all modules and features? This will hide everything from users.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable All',
        style: 'destructive',
        onPress: () => {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          const state: ControlState = {};
          FUNCTIONALITY_REGISTRY.forEach((mod) => {
            const features: Record<string, boolean> = {};
            mod.features.forEach((f) => {
              features[f.id] = false;
            });
            state[mod.id] = { enabled: false, features };
          });
          setControlState(state);
        },
      },
    ]);
  }, []);

  const getModuleStatus = useCallback(
    (modId: string): 'live' | 'off' | 'partial' => {
      const mod = controlState[modId];
      if (!mod) return 'off';
      const values = Object.values(mod.features);
      const allOn = values.every(Boolean);
      const allOff = values.every((v) => !v);
      if (allOn) return 'live';
      if (allOff) return 'off';
      return 'partial';
    },
    [controlState]
  );

  const stats = useMemo(() => {
    let totalFeatures = 0;
    let liveFeatures = 0;
    let liveModules = 0;
    let partialModules = 0;
    let offModules = 0;

    FUNCTIONALITY_REGISTRY.forEach((mod) => {
      const status = getModuleStatus(mod.id);
      if (status === 'live') liveModules++;
      else if (status === 'partial') partialModules++;
      else offModules++;

      mod.features.forEach((f) => {
        totalFeatures++;
        if (controlState[mod.id]?.features[f.id]) liveFeatures++;
      });
    });

    return { totalFeatures, liveFeatures, liveModules, partialModules, offModules, totalModules: FUNCTIONALITY_REGISTRY.length };
  }, [controlState, getModuleStatus]);

  const filteredModules = useMemo(() => {
    let modules = FUNCTIONALITY_REGISTRY;

    if (filter !== 'all') {
      modules = modules.filter((mod) => getModuleStatus(mod.id) === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      modules = modules.filter(
        (mod) =>
          mod.title.toLowerCase().includes(q) ||
          mod.description.toLowerCase().includes(q) ||
          mod.features.some((f) => f.name.toLowerCase().includes(q))
      );
    }

    return modules;
  }, [filter, searchQuery, getModuleStatus]);

  const getIcon = useCallback((iconName: string) => {
    return ICON_MAP[iconName] || Settings;
  }, []);

  const formatTime = useCallback((iso: string) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }, []);

  const renderModuleCard = useCallback(
    (mod: Module) => {
      const status = getModuleStatus(mod.id);
      const modState = controlState[mod.id];
      const isExpanded = expandedModules.has(mod.id);
      const Icon = getIcon(mod.icon);
      const enabledCount = modState
        ? Object.values(modState.features).filter(Boolean).length
        : 0;
      const totalCount = mod.features.length;

      const statusColor =
        status === 'live' ? Colors.positive : status === 'partial' ? Colors.warning : '#FF5252';
      const statusLabel =
        status === 'live' ? 'LIVE' : status === 'partial' ? 'PARTIAL' : 'OFF';

      return (
        <View
          key={mod.id}
          style={[
            styles.moduleCard,
            status === 'off' && styles.moduleCardOff,
            status === 'live' && styles.moduleCardLive,
          ]}
        >
          <TouchableOpacity
            style={styles.moduleHeader}
            onPress={() => toggleExpanded(mod.id)}
            activeOpacity={0.7}
            testID={`module-toggle-${mod.id}`}
          >
            <View style={styles.moduleHeaderLeft}>
              <View style={[styles.moduleIconWrap, { backgroundColor: mod.color + '20' }]}>
                <Icon size={20} color={mod.color} />
              </View>
              <View style={styles.moduleInfo}>
                <View style={styles.moduleTitleRow}>
                  <Text style={[styles.moduleTitle, status === 'off' && styles.moduleTitleOff]}>
                    {mod.title}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Animated.View
                      style={[
                        styles.statusDot,
                        { backgroundColor: statusColor },
                        status === 'live' && { opacity: pulseAnim },
                      ]}
                    />
                    <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </View>
                <Text style={styles.moduleDesc} numberOfLines={1}>
                  {enabledCount}/{totalCount} features active
                </Text>
              </View>
            </View>
            <View style={styles.moduleHeaderRight}>
              <Switch
                value={modState?.enabled ?? false}
                onValueChange={() => toggleModule(mod.id)}
                trackColor={{ false: '#333', true: Colors.positive + '50' }}
                thumbColor={modState?.enabled ? Colors.positive : '#666'}
                ios_backgroundColor="#333"
              />
              {isExpanded ? (
                <ChevronUp size={16} color={Colors.textSecondary} />
              ) : (
                <ChevronDown size={16} color={Colors.textSecondary} />
              )}
            </View>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.featuresContainer}>
              <View style={styles.featuresDivider} />
              {mod.features.map((feature) => {
                const featureOn = modState?.features[feature.id] ?? false;
                return (
                  <TouchableOpacity
                    key={feature.id}
                    style={styles.featureRow}
                    onPress={() => toggleFeature(mod.id, feature.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.featureLeft}>
                      <View
                        style={[
                          styles.featureIndicator,
                          { backgroundColor: featureOn ? Colors.positive : '#FF5252' },
                        ]}
                      />
                      <Text
                        style={[styles.featureName, !featureOn && styles.featureNameOff]}
                        numberOfLines={2}
                      >
                        {feature.name}
                      </Text>
                    </View>
                    <View style={styles.featureRight}>
                      <Text style={[styles.featureStatus, { color: featureOn ? Colors.positive : '#FF5252' }]}>
                        {featureOn ? 'ON' : 'OFF'}
                      </Text>
                      <Switch
                        value={featureOn}
                        onValueChange={() => toggleFeature(mod.id, feature.id)}
                        trackColor={{ false: '#2A2A2A', true: Colors.positive + '40' }}
                        thumbColor={featureOn ? Colors.positive : '#555'}
                        ios_backgroundColor="#2A2A2A"
                        style={styles.featureSwitch}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      );
    },
    [controlState, expandedModules, getModuleStatus, toggleModule, toggleFeature, toggleExpanded, getIcon, pulseAnim]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Power size={16} color={Colors.positive} />
          <Text style={styles.headerTitle}>Feature Control</Text>
        </View>
        <View style={styles.headerRight}>
          <Animated.View style={[styles.liveIndicator, { opacity: pulseAnim }]}>
            <View style={styles.liveDot} />
          </Animated.View>
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={loadState}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.statsRow}>
          <View style={[styles.statBox, styles.statBoxLive]}>
            <Text style={styles.statNumber}>{stats.liveModules}</Text>
            <Text style={styles.statLabel}>Live</Text>
            <View style={[styles.statDot, { backgroundColor: Colors.positive }]} />
          </View>
          <View style={[styles.statBox, styles.statBoxPartial]}>
            <Text style={styles.statNumber}>{stats.partialModules}</Text>
            <Text style={styles.statLabel}>Partial</Text>
            <View style={[styles.statDot, { backgroundColor: Colors.warning }]} />
          </View>
          <View style={[styles.statBox, styles.statBoxOff]}>
            <Text style={styles.statNumber}>{stats.offModules}</Text>
            <Text style={styles.statLabel}>Off</Text>
            <View style={[styles.statDot, { backgroundColor: '#FF5252' }]} />
          </View>
          <View style={[styles.statBox, styles.statBoxFeatures]}>
            <Text style={styles.statNumber}>
              {stats.liveFeatures}/{stats.totalFeatures}
            </Text>
            <Text style={styles.statLabel}>Features</Text>
            <View style={[styles.statDot, { backgroundColor: Colors.primary }]} />
          </View>
        </View>

        <View style={styles.progressBarWrap}>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${stats.totalFeatures > 0 ? (stats.liveFeatures / stats.totalFeatures) * 100 : 0}%` as any,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {Math.round(stats.totalFeatures > 0 ? (stats.liveFeatures / stats.totalFeatures) * 100 : 0)}% active
          </Text>
        </View>

        <View style={styles.bulkActions}>
          <TouchableOpacity style={styles.bulkBtnEnable} onPress={enableAll}>
            <ToggleRight size={14} color={Colors.positive} />
            <Text style={styles.bulkBtnEnableText}>Enable All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bulkBtnDisable} onPress={disableAll}>
            <ToggleLeft size={14} color="#FF5252" />
            <Text style={styles.bulkBtnDisableText}>Disable All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bulkBtnExpand}
            onPress={() => {
              if (expandedModules.size === FUNCTIONALITY_REGISTRY.length) {
                setExpandedModules(new Set());
              } else {
                setExpandedModules(new Set(FUNCTIONALITY_REGISTRY.map((m) => m.id)));
              }
            }}
          >
            <Layers size={14} color={Colors.primary} />
            <Text style={styles.bulkBtnExpandText}>
              {expandedModules.size === FUNCTIONALITY_REGISTRY.length ? 'Collapse' : 'Expand'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Search size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search modules or features..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={14} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {(['all', 'live', 'partial', 'off'] as FilterType[]).map((f) => {
            const isActive = filter === f;
            const labelMap: Record<FilterType, string> = {
              all: `All (${stats.totalModules})`,
              live: `Live (${stats.liveModules})`,
              partial: `Partial (${stats.partialModules})`,
              off: `Off (${stats.offModules})`,
            };
            const colorMap: Record<FilterType, string> = {
              all: Colors.primary,
              live: Colors.positive,
              partial: Colors.warning,
              off: '#FF5252',
            };
            return (
              <TouchableOpacity
                key={f}
                style={[
                  styles.filterChip,
                  isActive && { backgroundColor: colorMap[f] + '20', borderColor: colorMap[f] },
                ]}
                onPress={() => setFilter(f)}
              >
                <View style={[styles.filterDot, { backgroundColor: colorMap[f] }]} />
                <Text style={[styles.filterText, isActive && { color: colorMap[f] }]}>
                  {labelMap[f]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.modulesList}>
          {filteredModules.map(renderModuleCard)}
          {filteredModules.length === 0 && (
            <View style={styles.emptyState}>
              <Filter size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No modules found</Text>
              <Text style={styles.emptySub}>Try adjusting your search or filter</Text>
            </View>
          )}
        </View>

        {lastSaved ? (
          <View style={styles.savedRow}>
            <CheckCircle size={12} color={Colors.positive} />
            <Text style={styles.savedText}>Auto-saved at {formatTime(lastSaved)}</Text>
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.positive + '15',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.positive,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.positive,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statBoxLive: {
    borderColor: Colors.positive + '30',
  },
  statBoxPartial: {
    borderColor: Colors.warning + '30',
  },
  statBoxOff: {
    borderColor: '#FF525230',
  },
  statBoxFeatures: {
    borderColor: Colors.primary + '30',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  progressBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 10,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    backgroundColor: Colors.positive,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    minWidth: 55,
    textAlign: 'right',
  },
  bulkActions: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    marginTop: 12,
    gap: 8,
  },
  bulkBtnEnable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.positive + '12',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.positive + '25',
  },
  bulkBtnEnableText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.positive,
  },
  bulkBtnDisable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#FF525212',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF525225',
  },
  bulkBtnDisableText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FF5252',
  },
  bulkBtnExpand: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.primary + '12',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  bulkBtnExpandText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  searchRow: {
    paddingHorizontal: 14,
    marginTop: 12,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  filterRow: {
    marginTop: 10,
    maxHeight: 42,
  },
  filterContent: {
    paddingHorizontal: 14,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  modulesList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 10,
  },
  moduleCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  moduleCardOff: {
    borderColor: '#FF525225',
    opacity: 0.75,
  },
  moduleCardLive: {
    borderColor: Colors.positive + '25',
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  moduleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  moduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moduleInfo: {
    flex: 1,
  },
  moduleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  moduleTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  moduleTitleOff: {
    color: Colors.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  moduleDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  moduleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  featuresContainer: {
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  featuresDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border + '50',
  },
  featureLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 10,
  },
  featureIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  featureName: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500' as const,
    flex: 1,
  },
  featureNameOff: {
    color: Colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  featureRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  featureStatus: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  featureSwitch: {
    transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
  },
  savedText: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
});
