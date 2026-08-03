import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import {
  Bot,
  Boxes,
  Briefcase,
  Check,
  Globe,
  Inbox,
  Layers3,
  MessageSquareMore,
  ShieldCheck,
  Smartphone,
  Upload,
  Users,
  WandSparkles} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  IVX_OWNER_AI_BRIEF_DEFAULTS,
  IVX_OWNER_AI_FEATURE_LABELS,
  IVX_OWNER_AI_PROFILE,
  type IVXOwnerAIFeatureId} from '@/constants/ivx-owner-ai';

type BriefPlatform = 'web_only' | 'web_and_mobile';
type BriefAudience = 'owner_only' | 'team' | 'public';
type BriefFeatureId = IVXOwnerAIFeatureId;

type BriefFeature = {
  id: BriefFeatureId;
  title: string;
  description: string;
  icon: typeof Bot;
  accent: string;
};

const PLATFORM_OPTIONS: Array<{ id: BriefPlatform; title: string; subtitle: string; icon: typeof Globe }> = [
  {
    id: 'web_only',
    title: 'Web only',
    subtitle: 'Lean browser-first launch with the shortest path to validation.',
    icon: Globe},
  {
    id: 'web_and_mobile',
    title: 'Web + mobile',
    subtitle: 'One V1 scope that ships cleanly across browser and Expo clients.',
    icon: Smartphone},
];

const AUDIENCE_OPTIONS: Array<{ id: BriefAudience; title: string; subtitle: string; icon: typeof Users }> = [
  {
    id: 'owner_only',
    title: 'Owner only',
    subtitle: 'Private ops, direct testing, and founder-controlled rollout.',
    icon: ShieldCheck},
  {
    id: 'team',
    title: 'Team',
    subtitle: 'Internal collaborators, shared rooms, and guided feedback loops.',
    icon: Briefcase},
  {
    id: 'public',
    title: 'Public',
    subtitle: 'Broader launch with onboarding, support, and trust-facing UX.',
    icon: Users},
];

const STACK_ITEMS = IVX_OWNER_AI_BRIEF_DEFAULTS.stack;

const FEATURE_OPTIONS: BriefFeature[] = [
  {
    id: 'ai_chat',
    title: IVX_OWNER_AI_FEATURE_LABELS.ai_chat,
    description: 'A named owner assistant for chat, triage, and guided responses across web and mobile.',
    icon: Bot,
    accent: '#14B8A6'},
  {
    id: 'inbox',
    title: IVX_OWNER_AI_FEATURE_LABELS.inbox,
    description: 'A compact conversation inbox for owner-first review, unread counts, and fast follow-up.',
    icon: Inbox,
    accent: '#F59E0B'},
  {
    id: 'shared_room',
    title: IVX_OWNER_AI_FEATURE_LABELS.shared_room,
    description: 'A shared owner room with stable slug routing, history, and realtime delivery.',
    icon: MessageSquareMore,
    accent: '#4A90D9'},
  {
    id: 'file_upload',
    title: IVX_OWNER_AI_FEATURE_LABELS.file_upload,
    description: 'Web-safe and mobile-safe attachment delivery for images, docs, and supporting files.',
    icon: Upload,
    accent: '#8B5CF6'},
  {
    id: 'knowledge_base',
    title: IVX_OWNER_AI_FEATURE_LABELS.knowledge_base,
    description: 'A structured knowledge surface the assistant can use for owner-facing answers and summaries.',
    icon: Layers3,
    accent: '#10B981'},
  {
    id: 'owner_commands',
    title: IVX_OWNER_AI_FEATURE_LABELS.owner_commands,
    description: 'Operator-style commands for quick owner actions, routing, and operational control.',
    icon: Boxes,
    accent: '#FF4D4D'},
];

const INITIAL_FEATURES: BriefFeatureId[] = [...IVX_OWNER_AI_BRIEF_DEFAULTS.selectedFeatures];
const HERO_GRADIENT = ['#0F0F10', '#19130A', '#0B1620'] as const;
const HERO_RING = 'rgba(255, 215, 0, 0.16)';
const MAX_FEATURE_TEXT_LENGTH = 320;
const MAX_AI_NAME_LENGTH = 32;
const CODE_ACCESS_LABEL = IVX_OWNER_AI_BRIEF_DEFAULTS.codeAccess === 'yes' ? 'Yes' : 'No';

function formatPlatformLabel(platform: BriefPlatform): string {
  if (platform === 'web_only') {
    return 'Web only';
  }

  return 'Web + mobile';
}

function formatAudienceLabel(audience: BriefAudience): string {
  if (audience === 'owner_only') {
    return 'Owner only';
  }

  if (audience === 'team') {
    return 'Team';
  }

  return 'Public';
}

function formatAudienceBriefLabel(audience: BriefAudience): string {
  if (audience === 'owner_only') {
    return 'Owner only first';
  }

  if (audience === 'team') {
    return 'Team';
  }

  return 'Public';
}

function parseCustomFeatures(rawValue: string): string[] {
  const parts = rawValue
    .split(/\n|,|•|;/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const deduped = Array.from(new Set(parts));
  return deduped.slice(0, 8);
}

export default function V1BriefScreen() {
  const [platform, setPlatform] = useState<BriefPlatform>(IVX_OWNER_AI_BRIEF_DEFAULTS.platform);
  const [audience, setAudience] = useState<BriefAudience>(IVX_OWNER_AI_BRIEF_DEFAULTS.audience);
  const [aiName, setAiName] = useState<string>(IVX_OWNER_AI_BRIEF_DEFAULTS.aiName);
  const [customFeatures, setCustomFeatures] = useState<string>(IVX_OWNER_AI_BRIEF_DEFAULTS.customFeatures);
  const [selectedFeatures, setSelectedFeatures] = useState<BriefFeatureId[]>(INITIAL_FEATURES);

  const selectedFeatureCards = useMemo(() => {
    return FEATURE_OPTIONS.filter((feature) => selectedFeatures.includes(feature.id));
  }, [selectedFeatures]);

  const customFeatureList = useMemo(() => {
    return parseCustomFeatures(customFeatures);
  }, [customFeatures]);

  const allFeatureLabels = useMemo(() => {
    const presetLabels = selectedFeatureCards.map((feature) => feature.title);
    return Array.from(new Set([...presetLabels, ...customFeatureList]));
  }, [customFeatureList, selectedFeatureCards]);

  const completionScore = useMemo(() => {
    let completedSections = 0;

    completedSections += 1;
    completedSections += 1;
    completedSections += 1;
    completedSections += 1;

    if (allFeatureLabels.length > 0) {
      completedSections += 1;
    }

    if (aiName.trim().length > 0) {
      completedSections += 1;
    }

    return Math.round((completedSections / 6) * 100);
  }, [aiName, allFeatureLabels.length]);

  const readinessCopy = useMemo(() => {
    const namedAssistant = aiName.trim().length > 0;
    const multiPlatform = platform === 'web_and_mobile';
    const broadAudience = audience === 'public';
    const denseFeatureSet = allFeatureLabels.length >= 5;

    if (multiPlatform && broadAudience && namedAssistant && denseFeatureSet) {
      return 'This brief is shaped for a broader public launch with enough surface area to feel complete on day one.';
    }

    if (audience === 'owner_only') {
      return `${aiName.trim() || IVX_OWNER_AI_PROFILE.name} is tuned for an owner-first launch with direct control, fast signal, a clean private loop first, and live code-aware support.`;
    }

    if (audience === 'team' && denseFeatureSet) {
      return 'This scope is strong for a collaborative internal release with shared chat, support, and product feedback built in.';
    }

    if (!namedAssistant) {
      return 'The product shape is clear. Naming the AI next will make the chat, support copy, and onboarding feel finished.';
    }

    return 'This is a clean V1 starting point. Tighten feature priorities next if you want a smaller, faster first ship.';
  }, [aiName, allFeatureLabels.length, audience, platform]);

  const deliverySignal = useMemo(() => {
    if (platform === 'web_only' && audience === 'owner_only') {
      return 'Fastest validation path';
    }

    if (platform === 'web_and_mobile' && audience === 'public') {
      return 'Highest launch surface';
    }

    if (audience === 'team') {
      return 'Best for shared testing';
    }

    return 'Balanced V1 setup';
  }, [audience, platform]);

  const scopeWarning = useMemo(() => {
    if (allFeatureLabels.length === 0) {
      return 'Add at least one V1 feature so the build scope is concrete.';
    }

    if (audience === 'public' && allFeatureLabels.length < 3) {
      return 'Public launch usually needs at least onboarding, support, and trust-facing product flow.';
    }

    if (aiName.trim().length === 0) {
      return 'The AI name is still open. Give it one so the assistant feels intentional in product and support UI.';
    }

    return 'The brief is consistent and ready to hand off.';
  }, [aiName, allFeatureLabels.length, audience]);

  const summaryLine = useMemo(() => {
    const assistantLabel = aiName.trim() || 'AI name pending';
    return `${formatPlatformLabel(platform)} • ${formatAudienceLabel(audience)} • ${assistantLabel} • Code access: ${CODE_ACCESS_LABEL}`;
  }, [aiName, audience, platform]);

  const stackLine = useMemo(() => {
    return STACK_ITEMS.join(' / ');
  }, []);

  const generatedBrief = useMemo(() => {
    const featureLine = allFeatureLabels.length > 0 ? allFeatureLabels.join(', ') : 'Add the first V1 feature';
    const aiLine = aiName.trim() || 'Pending';

    return [
      `Platform: ${formatPlatformLabel(platform)}`,
      `Stack: ${stackLine}`,
      `V1 users: ${formatAudienceBriefLabel(audience)}`,
      `V1 features: ${featureLine}`,
      `AI name: ${aiLine}`,
      `Current code access: ${IVX_OWNER_AI_BRIEF_DEFAULTS.codeAccess}`,
    ].join('\n');
  }, [aiName, allFeatureLabels, audience, platform, stackLine]);

  useEffect(() => {
    console.log('[V1Brief] Updated product brief state:', {
      platform,
      audience,
      aiName,
      selectedFeatures,
      customFeatureList,
      allFeatureLabels,
      completionScore,
      generatedBrief,
      codeAccess: IVX_OWNER_AI_BRIEF_DEFAULTS.codeAccess,
      stack: STACK_ITEMS});
  }, [aiName, allFeatureLabels, audience, completionScore, customFeatureList, generatedBrief, platform, selectedFeatures]);

  const toggleFeature = useCallback((featureId: BriefFeatureId) => {
    setSelectedFeatures((current) => {
      const exists = current.includes(featureId);
      const next = exists ? current.filter((item) => item !== featureId) : [...current, featureId];

      console.log('[V1Brief] Feature toggle:', featureId, '| selected:', !exists, '| next:', next);
      return next;
    });
  }, []);

  const progressWidth: `${number}%` = `${completionScore}%`;

  return (
    <>
      <Stack.Screen options={{ title: 'V1 Brief' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="v1-brief-screen"
      >
        <LinearGradient colors={HERO_GRADIENT} style={styles.heroCard}>
          <View style={styles.heroOrbPrimary} />
          <View style={styles.heroOrbSecondary} />
          <View style={styles.heroRing} />
          <View style={styles.heroBadge}>
            <Bot size={16} color={Colors.primary} />
            <Text style={styles.heroBadgeText}>{IVX_OWNER_AI_PROFILE.name} V1</Text>
          </View>
          <Text style={styles.heroTitle}>Define the owner-first V1 before the build gets noisy.</Text>
          <Text style={styles.heroDescription}>
            Turn platform, stack, owner scope, V1 features, and the AI identity into one clean handoff for {IVX_OWNER_AI_PROFILE.name}.
          </Text>
          <View style={styles.heroSummaryRow}>
            <View style={styles.heroSummaryChip}>
              <Globe size={14} color={Colors.primary} />
              <Text style={styles.heroSummaryText}>{formatPlatformLabel(platform)}</Text>
            </View>
            <View style={styles.heroSummaryChip}>
              <Users size={14} color={Colors.primary} />
              <Text style={styles.heroSummaryText}>{formatAudienceLabel(audience)}</Text>
            </View>
            <View style={styles.heroSummaryChip}>
              <Layers3 size={14} color={Colors.primary} />
              <Text style={styles.heroSummaryText}>{allFeatureLabels.length} features</Text>
            </View>
            <View style={styles.heroSummaryChip}>
              <ShieldCheck size={14} color={Colors.primary} />
              <Text style={styles.heroSummaryText}>Code access: {CODE_ACCESS_LABEL}</Text>
            </View>
            <View style={styles.heroSummaryChip}>
              <WandSparkles size={14} color={Colors.primary} />
              <Text style={styles.heroSummaryText}>{completionScore}% ready</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.signalCard} testID="v1-brief-signal-card">
          <View style={styles.signalHeader}>
            <View style={styles.signalCopy}>
              <Text style={styles.signalTitle}>{deliverySignal}</Text>
              <Text style={styles.signalSubtitle}>{summaryLine}</Text>
            </View>
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreBadgeValue}>{completionScore}%</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.signalDescription}>{readinessCopy}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Platform</Text>
          {PLATFORM_OPTIONS.map((option) => {
            const selected = option.id === platform;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.optionCard, selected ? styles.optionCardSelected : null]}
                activeOpacity={0.85}
                onPress={() => {
                  console.log('[V1Brief] Platform changed:', option.id);
                  setPlatform(option.id);
                }}
                testID={`v1-brief-platform-${option.id}`}
              >
                <View style={[styles.optionIconWrap, selected ? styles.optionIconWrapSelected : null]}>
                  <option.icon size={18} color={selected ? Colors.background : Colors.primary} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
                </View>
                {selected ? <Check size={18} color={Colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Stack</Text>
          <View style={styles.stackWrap}>
            {STACK_ITEMS.map((item) => (
              <View key={item} style={styles.stackBadge}>
                <Text style={styles.stackBadgeText}>{item}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.stackHint}>
            Next.js handles reach, Expo handles client delivery, and Supabase covers auth, storage, realtime sync, and the owner-first shared-room backend.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Current code access</Text>
          <View style={styles.codeAccessCard} testID="v1-brief-code-access-card">
            <View style={styles.codeAccessHeader}>
              <View style={styles.codeAccessIconWrap}>
                <ShieldCheck size={18} color={Colors.primary} />
              </View>
              <View style={styles.codeAccessCopy}>
                <Text style={styles.codeAccessTitle}>Yes — current code access is available</Text>
                <Text style={styles.codeAccessSubtitle}>
                  The assistant can inspect the live Next.js, Expo, and Supabase workspace before changing owner chat, inbox, shared-room, upload, and knowledge flows.
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>V1 users</Text>
          <View style={styles.audienceGrid}>
            {AUDIENCE_OPTIONS.map((option) => {
              const selected = option.id === audience;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.audienceCard, selected ? styles.audienceCardSelected : null]}
                  activeOpacity={0.85}
                  onPress={() => {
                    console.log('[V1Brief] Audience changed:', option.id);
                    setAudience(option.id);
                  }}
                  testID={`v1-brief-audience-${option.id}`}
                >
                  <option.icon size={18} color={selected ? Colors.primary : Colors.textSecondary} />
                  <Text style={styles.audienceTitle}>{option.title}</Text>
                  <Text style={styles.audienceSubtitle}>{option.subtitle}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>V1 features</Text>
          {FEATURE_OPTIONS.map((feature) => {
            const selected = selectedFeatures.includes(feature.id);
            return (
              <TouchableOpacity
                key={feature.id}
                style={[styles.featureCard, selected ? styles.featureCardSelected : null]}
                activeOpacity={0.85}
                onPress={() => toggleFeature(feature.id)}
                testID={`v1-brief-feature-${feature.id}`}
              >
                <View
                  style={[
                    styles.featureIconWrap,
                    { backgroundColor: `${feature.accent}22`, borderColor: `${feature.accent}44` },
                  ]}
                >
                  <feature.icon size={18} color={feature.accent} />
                </View>
                <View style={styles.featureCopy}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDescription}>{feature.description}</Text>
                </View>
                <View style={[styles.featureCheck, selected ? styles.featureCheckSelected : null]}>
                  {selected ? <Check size={14} color={Colors.background} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={styles.customFeatureCard}>
            <Text style={styles.customFeatureTitle}>Custom feature scope</Text>
            <Text style={styles.customFeatureSubtitle}>
              Add extra V1 items with commas or new lines so the generated brief reads exactly how you want it.
            </Text>
            <TextInput
              value={customFeatures}
              onChangeText={(value) => {
                const nextValue = value.slice(0, MAX_FEATURE_TEXT_LENGTH);
                console.log('[V1Brief] Custom features changed:', nextValue);
                setCustomFeatures(nextValue);
              }}
              placeholder="Examples: RAG search, owner notes, document tagging"
              placeholderTextColor={Colors.inputPlaceholder}
              style={styles.customFeatureInput}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect={false}
              maxLength={MAX_FEATURE_TEXT_LENGTH}
              testID="v1-brief-features-input"
            />
            <View style={styles.customFeatureFooter}>
              <Text style={styles.customFeatureMeta}>{customFeatureList.length} custom items</Text>
              <Text style={styles.customFeatureMeta}>{customFeatures.length}/{MAX_FEATURE_TEXT_LENGTH}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AI name</Text>
          <View style={styles.aiCard}>
            <View style={styles.aiHeader}>
              <View style={styles.aiIconWrap}>
                <Bot size={18} color={Colors.primary} />
              </View>
              <View style={styles.aiCopy}>
                <Text style={styles.aiTitle}>Name the assistant</Text>
                <Text style={styles.aiSubtitle}>Pick the label owners will see in chat, inbox, shared-room, and automation touchpoints.</Text>
              </View>
            </View>
            <TextInput
              value={aiName}
              onChangeText={(value) => {
                const nextValue = value.slice(0, MAX_AI_NAME_LENGTH);
                console.log('[V1Brief] AI name changed:', nextValue);
                setAiName(nextValue);
              }}
              placeholder="Type the AI name"
              placeholderTextColor={Colors.inputPlaceholder}
              style={styles.aiInput}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={MAX_AI_NAME_LENGTH}
              testID="v1-brief-ai-name-input"
            />
          </View>
        </View>

        <View style={styles.validationCard} testID="v1-brief-validation-card">
          <Text style={styles.validationTitle}>Scope signal</Text>
          <Text style={styles.validationBody}>{scopeWarning}</Text>
        </View>

        <View style={styles.summaryCard} testID="v1-brief-summary-card">
          <View style={styles.summaryHeader}>
            <View style={styles.summaryIconWrap}>
              <WandSparkles size={18} color={Colors.primary} />
            </View>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>Current brief</Text>
              <Text style={styles.summarySubtitle}>{summaryLine}</Text>
            </View>
          </View>
          <Text style={styles.readinessCopy}>{readinessCopy}</Text>
          <View style={styles.summaryMetaWrap}>
            <View style={styles.summaryMetaCard}>
              <Text style={styles.summaryMetaLabel}>Selected features</Text>
              <Text style={styles.summaryMetaValue}>{allFeatureLabels.length}</Text>
            </View>
            <View style={styles.summaryMetaCard}>
              <Text style={styles.summaryMetaLabel}>Stack</Text>
              <Text style={styles.summaryMetaValue}>3 layers</Text>
            </View>
            <View style={styles.summaryMetaCard}>
              <Text style={styles.summaryMetaLabel}>Code access</Text>
              <Text style={styles.summaryMetaValue}>{CODE_ACCESS_LABEL}</Text>
            </View>
          </View>
          <View style={styles.selectedFeatureWrap}>
            {allFeatureLabels.length > 0 ? (
              allFeatureLabels.map((feature) => (
                <View key={feature} style={styles.selectedFeatureChip}>
                  <Text style={styles.selectedFeatureChipText}>{feature}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyFeatureText}>Select the first V1 feature to complete the brief.</Text>
            )}
          </View>
          <View style={styles.generatedBriefCard} testID="v1-brief-generated-brief">
            <Text style={styles.generatedBriefLabel}>Copy-ready brief</Text>
            <Text selectable style={styles.generatedBriefText}>
              {generatedBrief}
            </Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background},
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 16},
  heroCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingVertical: 22,
    overflow: 'hidden',
    backgroundColor: '#111111'},
  heroOrbPrimary: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    top: -40,
    right: -10},
  heroOrbSecondary: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    bottom: -18,
    left: -18},
  heroRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: HERO_RING,
    top: 28,
    right: 24},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.28)',
    marginBottom: 16},
  heroBadgeText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.2},
  heroTitle: {
    color: Colors.text,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900' as const,
    letterSpacing: -0.8,
    maxWidth: '86%'},
  heroDescription: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: '92%'},
  heroSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18},
  heroSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  heroSummaryText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  signalCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12},
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  signalCopy: {
    flex: 1,
    gap: 4},
  signalTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  signalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  scoreBadge: {
    minWidth: 70,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)'},
  scoreBadgeValue: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '900' as const},
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden'},
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: Colors.primary},
  signalDescription: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 21},
  section: {
    gap: 10},
  sectionLabel: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const,
    letterSpacing: -0.2},
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16},
  optionCardSelected: {
    borderColor: 'rgba(255, 215, 0, 0.55)',
    backgroundColor: '#19150B'},
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.12)'},
  optionIconWrapSelected: {
    backgroundColor: Colors.primary},
  optionCopy: {
    flex: 1,
    gap: 4},
  optionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  optionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  stackWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  stackBadge: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111111'},
  stackBadgeText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  stackHint: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  codeAccessCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.22)',
    backgroundColor: '#12100A',
    paddingHorizontal: 16,
    paddingVertical: 16},
  codeAccessHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12},
  codeAccessIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  codeAccessCopy: {
    flex: 1,
    gap: 4},
  codeAccessTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  codeAccessSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  audienceGrid: {
    gap: 10},
  audienceCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10},
  audienceCardSelected: {
    borderColor: 'rgba(255, 215, 0, 0.55)',
    backgroundColor: '#17130B'},
  audienceTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  audienceSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16},
  featureCardSelected: {
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#121212'},
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  featureCopy: {
    flex: 1,
    gap: 4},
  featureTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  featureDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  featureCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center'},
  featureCheckSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary},
  customFeatureCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: '#101010',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10},
  customFeatureTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  customFeatureSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  customFeatureInput: {
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.inputBackground,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 14},
  customFeatureFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8},
  customFeatureMeta: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  aiCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14},
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  aiIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  aiCopy: {
    flex: 1,
    gap: 4},
  aiTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  aiSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  aiInput: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.inputBackground,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 14},
  validationCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.24)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6},
  validationTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const},
  validationBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  summaryCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.26)',
    backgroundColor: '#15110A',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    marginTop: 4},
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  summaryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  summaryCopy: {
    flex: 1,
    gap: 3},
  summaryTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  summarySubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  readinessCopy: {
    color: Colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as const},
  summaryMetaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  summaryMetaCard: {
    flex: 1,
    minWidth: 96,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4},
  summaryMetaLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4},
  summaryMetaValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const},
  selectedFeatureWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  selectedFeatureChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  selectedFeatureChipText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  emptyFeatureText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  generatedBriefCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10},
  generatedBriefLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  generatedBriefText: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 22}});
