import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  Image,
  Switch} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Plus,
  Edit3,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  Save,
  X,
  Image as ImageIcon,
  Type,
  List,
  Palette,
  GripVertical,
  Sparkles,
  Home,
  Building2,
  TrendingUp,
  Briefcase,
  User,
  Zap,
  Check,
  Copy,
  RotateCcw,
  Play,
  ArrowLeft} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { EmptyState } from '@/components/ivx';
import { useIntro, OnboardingStep, OnboardingFeature } from '@/lib/intro-context';

const ICON_OPTIONS = [
  { id: 'sparkles', name: 'Sparkles', icon: Sparkles },
  { id: 'home', name: 'Home', icon: Home },
  { id: 'building', name: 'Building', icon: Building2 },
  { id: 'trending', name: 'Trending', icon: TrendingUp },
  { id: 'briefcase', name: 'Briefcase', icon: Briefcase },
  { id: 'user', name: 'User', icon: User },
  { id: 'zap', name: 'Zap', icon: Zap },
];

const COLOR_PRESETS = [
  { name: 'Primary', color: Colors.primary },
  { name: 'Success', color: Colors.positive },
  { name: 'Info', color: Colors.info },
  { name: 'Warning', color: Colors.warning },
  { name: 'Accent', color: Colors.accent },
  { name: 'Secondary', color: Colors.textSecondary },
];

export default function IntroManagement() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const {
    steps,
    activeSteps,
    addStep,
    updateStep,
    deleteStep,
    moveStep,
    toggleStepActive,
    duplicateStep,
    resetToDefaults,
    resetOnboarding} = useIntro();

  const [refreshing, setRefreshing] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep | null>(null);
  const [editedStep, setEditedStep] = useState<OnboardingStep | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'features' | 'design'>('content');
  const [newFeatureText, setNewFeatureText] = useState('');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const getIconComponent = useCallback((iconType: string, size: number = 24, color: string = Colors.primary) => {
    const IconOption = ICON_OPTIONS.find(opt => opt.id === iconType);
    if (IconOption) {
      const IconComp = IconOption.icon;
      return <IconComp size={size} color={color} />;
    }
    return <Sparkles size={size} color={color} />;
  }, []);

  const handleEditStep = useCallback((step: OnboardingStep) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentStep(step);
    setEditedStep({ ...step, features: [...step.features] });
    setActiveTab('content');
    setEditModalVisible(true);
  }, []);

  const handlePreviewStep = useCallback((step: OnboardingStep) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentStep(step);
    setPreviewModalVisible(true);
  }, []);

  const handleSaveStep = useCallback(() => {
    if (!editedStep) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateStep(editedStep.id, editedStep);
    setEditModalVisible(false);
    setEditedStep(null);
    setCurrentStep(null);
  }, [editedStep, updateStep]);

  const handleDeleteStep = useCallback((stepId: string) => {
    Alert.alert(
      'Delete Step',
      'Are you sure you want to delete this intro step?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            deleteStep(stepId);
          }},
      ]
    );
  }, [deleteStep]);

  const handleToggleActive = useCallback((stepId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleStepActive(stepId);
  }, [toggleStepActive]);

  const handleMoveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    moveStep(stepId, direction);
  }, [moveStep]);

  const handleAddStep = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newStep: OnboardingStep = {
      id: Date.now().toString(),
      title: 'New Step',
      description: 'Add your description here',
      iconType: 'sparkles',
      features: [
        { id: '1', text: 'Feature 1' },
        { id: '2', text: 'Feature 2' },
      ],
      imageUrl: '',
      gradientStart: Colors.primary,
      gradientEnd: Colors.accent,
      isActive: true,
      order: steps.length};
    addStep(newStep);
    handleEditStep(newStep);
  }, [steps.length, addStep, handleEditStep]);

  const handleAddFeature = useCallback(() => {
    if (!editedStep || !newFeatureText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newFeature: OnboardingFeature = {
      id: Date.now().toString(),
      text: newFeatureText.trim()};
    setEditedStep({
      ...editedStep,
      features: [...editedStep.features, newFeature]});
    setNewFeatureText('');
  }, [editedStep, newFeatureText]);

  const handleDeleteFeature = useCallback((featureId: string) => {
    if (!editedStep) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditedStep({
      ...editedStep,
      features: editedStep.features.filter(f => f.id !== featureId)});
  }, [editedStep]);

  const handleUpdateFeature = useCallback((featureId: string, text: string) => {
    if (!editedStep) return;
    setEditedStep({
      ...editedStep,
      features: editedStep.features.map(f => 
        f.id === featureId ? { ...f, text } : f
      )});
  }, [editedStep]);

  const handleDuplicateStep = useCallback((step: OnboardingStep) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    duplicateStep(step.id);
  }, [duplicateStep]);

  const handleResetToDefaults = useCallback(() => {
    Alert.alert(
      'Reset to Defaults',
      'This will reset all intro steps to the original defaults. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            resetToDefaults();
          }},
      ]
    );
  }, [resetToDefaults]);

  const handleTestOnboarding = useCallback(() => {
    Alert.alert(
      'Test Onboarding',
      'This will reset the onboarding status so you can see the intro again when you restart the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset & Test',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            resetOnboarding();
            Alert.alert('Success', 'Onboarding reset! Restart the app to see the intro.');
          }},
      ]
    );
  }, [resetOnboarding]);

  const activeStepsCount = activeSteps.length;

  const renderStepCard = useCallback((step: OnboardingStep, index: number) => (
    <View key={step.id} style={[styles.stepCard, !step.isActive && styles.stepCardInactive]}>
      <View style={styles.stepHeader}>
        <View style={styles.stepOrderBadge}>
          <GripVertical size={14} color={Colors.textSecondary} />
          <Text style={styles.stepOrderText}>{index + 1}</Text>
        </View>
        <View style={[styles.stepIconBg, { backgroundColor: step.gradientStart + '20' }]}>
          {getIconComponent(step.iconType, 20, step.gradientStart)}
        </View>
        <View style={styles.stepInfo}>
          <Text style={styles.stepTitle} numberOfLines={1}>{step.title}</Text>
          <Text style={styles.stepDesc} numberOfLines={1}>{step.description}</Text>
        </View>
        <Switch
          value={step.isActive}
          onValueChange={() => handleToggleActive(step.id)}
          trackColor={{ false: Colors.border, true: Colors.primary + '50' }}
          thumbColor={step.isActive ? Colors.primary : Colors.textTertiary}
        />
      </View>

      {step.imageUrl ? (
        <Image source={{ uri: step.imageUrl }} style={styles.stepPreviewImage} />
      ) : (
        <View style={styles.noImagePlaceholder}>
          <ImageIcon size={20} color={Colors.textTertiary} />
          <Text style={styles.noImageText}>No image</Text>
        </View>
      )}

      <View style={styles.stepFeatures}>
        <Text style={styles.featuresLabel}>{step.features.length} features</Text>
        <View style={styles.gradientPreview}>
          <View style={[styles.gradientDot, { backgroundColor: step.gradientStart }]} />
          <View style={[styles.gradientDot, { backgroundColor: step.gradientEnd }]} />
        </View>
      </View>

      <View style={styles.stepActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleMoveStep(step.id, 'up')}
          disabled={index === 0}
        >
          <ChevronUp size={18} color={index === 0 ? Colors.textTertiary : Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleMoveStep(step.id, 'down')}
          disabled={index === steps.length - 1}
        >
          <ChevronDown size={18} color={index === steps.length - 1 ? Colors.textTertiary : Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handlePreviewStep(step)}
        >
          <Eye size={18} color={Colors.info} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleDuplicateStep(step)}
        >
          <Copy size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleEditStep(step)}
        >
          <Edit3 size={18} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleDeleteStep(step.id)}
        >
          <Trash2 size={18} color={Colors.negative} />
        </TouchableOpacity>
      </View>
    </View>
  ), [steps.length, getIconComponent, handleToggleActive, handleMoveStep, handlePreviewStep, handleDuplicateStep, handleEditStep, handleDeleteStep]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Intro Management</Text>
          <Text style={styles.headerSubtitle}>{activeStepsCount} of {steps.length} steps active</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={handleAddStep}>
          <Plus size={20} color={Colors.black} />
          <Text style={styles.addButtonText}>Add Step</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{steps.length}</Text>
            <Text style={styles.statLabel}>Total Steps</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: Colors.positive }]}>{activeStepsCount}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: Colors.textTertiary }]}>{steps.length - activeStepsCount}</Text>
            <Text style={styles.statLabel}>Hidden</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleTestOnboarding}>
            <Play size={16} color={Colors.primary} />
            <Text style={styles.secondaryBtnText}>Test Intro</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleResetToDefaults}>
            <RotateCcw size={16} color={Colors.warning} />
            <Text style={[styles.secondaryBtnText, { color: Colors.warning }]}>Reset Defaults</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.stepsContainer}>
          {steps.map((step, index) => renderStepCard(step, index))}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setEditModalVisible(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Step</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveStep}>
              <Save size={18} color={Colors.black} />
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'content' && styles.tabActive]}
              onPress={() => setActiveTab('content')}
            >
              <Type size={16} color={activeTab === 'content' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'content' && styles.tabTextActive]}>Content</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'features' && styles.tabActive]}
              onPress={() => setActiveTab('features')}
            >
              <List size={16} color={activeTab === 'features' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'features' && styles.tabTextActive]}>Features</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'design' && styles.tabActive]}
              onPress={() => setActiveTab('design')}
            >
              <Palette size={16} color={activeTab === 'design' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'design' && styles.tabTextActive]}>Design</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            {activeTab === 'content' && editedStep && (
              <View style={styles.formSection}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Title</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editedStep.title}
                    onChangeText={(text) => setEditedStep({ ...editedStep, title: text })}
                    placeholder="Enter step title"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Description</Text>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    value={editedStep.description}
                    onChangeText={(text) => setEditedStep({ ...editedStep, description: text })}
                    placeholder="Enter step description"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    numberOfLines={4}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Image URL</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editedStep.imageUrl}
                    onChangeText={(text) => setEditedStep({ ...editedStep, imageUrl: text })}
                    placeholder="https://example.com/image.jpg"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                  />
                  {editedStep.imageUrl ? (
                    <Image source={{ uri: editedStep.imageUrl }} style={styles.imagePreview} />
                  ) : null}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Icon</Text>
                  <View style={styles.iconGrid}>
                    {ICON_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.id}
                        style={[
                          styles.iconOption,
                          editedStep.iconType === opt.id && styles.iconOptionSelected,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setEditedStep({ ...editedStep, iconType: opt.id });
                        }}
                      >
                        <opt.icon
                          size={24}
                          color={editedStep.iconType === opt.id ? Colors.primary : Colors.textSecondary}
                        />
                        <Text style={[
                          styles.iconOptionText,
                          editedStep.iconType === opt.id && styles.iconOptionTextSelected,
                        ]}>{opt.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'features' && editedStep && (
              <View style={styles.formSection}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Features ({editedStep.features.length})</Text>
                  {editedStep.features.map((feature, index) => (
                    <View key={feature.id} style={styles.featureItem}>
                      <Text style={styles.featureIndex}>{index + 1}</Text>
                      <TextInput
                        style={styles.featureInput}
                        value={feature.text}
                        onChangeText={(text) => handleUpdateFeature(feature.id, text)}
                        placeholder="Feature text"
                        placeholderTextColor={Colors.textTertiary}
                      />
                      <TouchableOpacity
                        style={styles.deleteFeatureBtn}
                        onPress={() => handleDeleteFeature(feature.id)}
                      >
                        <Trash2 size={16} color={Colors.negative} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                <View style={styles.addFeatureRow}>
                  <TextInput
                    style={styles.addFeatureInput}
                    value={newFeatureText}
                    onChangeText={setNewFeatureText}
                    placeholder="Add new feature..."
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <TouchableOpacity
                    style={[styles.addFeatureBtn, !newFeatureText.trim() && styles.addFeatureBtnDisabled]}
                    onPress={handleAddFeature}
                    disabled={!newFeatureText.trim()}
                  >
                    <Plus size={20} color={newFeatureText.trim() ? Colors.black : Colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {activeTab === 'design' && editedStep && (
              <View style={styles.formSection}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Gradient Start Color</Text>
                  <View style={styles.colorPresets}>
                    {COLOR_PRESETS.map((preset) => (
                      <TouchableOpacity
                        key={preset.name}
                        style={[
                          styles.colorPreset,
                          { backgroundColor: preset.color },
                          editedStep.gradientStart === preset.color && styles.colorPresetSelected,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setEditedStep({ ...editedStep, gradientStart: preset.color });
                        }}
                      >
                        {editedStep.gradientStart === preset.color && (
                          <Check size={16} color={Colors.white} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.textInput}
                    value={editedStep.gradientStart}
                    onChangeText={(text) => setEditedStep({ ...editedStep, gradientStart: text })}
                    placeholder="#000000"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Gradient End Color</Text>
                  <View style={styles.colorPresets}>
                    {COLOR_PRESETS.map((preset) => (
                      <TouchableOpacity
                        key={preset.name}
                        style={[
                          styles.colorPreset,
                          { backgroundColor: preset.color },
                          editedStep.gradientEnd === preset.color && styles.colorPresetSelected,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setEditedStep({ ...editedStep, gradientEnd: preset.color });
                        }}
                      >
                        {editedStep.gradientEnd === preset.color && (
                          <Check size={16} color={Colors.white} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.textInput}
                    value={editedStep.gradientEnd}
                    onChangeText={(text) => setEditedStep({ ...editedStep, gradientEnd: text })}
                    placeholder="#000000"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.gradientPreviewLarge}>
                  <View style={[styles.gradientDotLarge, { backgroundColor: editedStep.gradientStart }]} />
                  <View style={styles.gradientLine} />
                  <View style={[styles.gradientDotLarge, { backgroundColor: editedStep.gradientEnd }]} />
                </View>
              </View>
            )}

            <View style={styles.modalBottomPadding} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={previewModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <View style={styles.previewOverlay}>
          <View style={styles.previewContainer}>
            <TouchableOpacity
              style={styles.previewClose}
              onPress={() => setPreviewModalVisible(false)}
            >
              <X size={24} color={Colors.text} />
            </TouchableOpacity>

            {currentStep && (
              <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.previewContent}>
                  <View style={[styles.previewIconBg, { backgroundColor: currentStep.gradientStart + '20' }]}>
                    {getIconComponent(currentStep.iconType, 48, currentStep.gradientStart)}
                  </View>

                  <Text style={styles.previewTitle}>{currentStep.title}</Text>
                  <Text style={styles.previewDesc}>{currentStep.description}</Text>

                  {currentStep.imageUrl ? (
                    <Image source={{ uri: currentStep.imageUrl }} style={styles.previewImage} />
                  ) : null}

                  <View style={styles.previewFeatures}>
                    {currentStep.features.map((feature) => (
                      <View key={feature.id} style={styles.previewFeatureRow}>
                        <View style={[styles.previewFeatureDot, { backgroundColor: currentStep.gradientStart }]} />
                        <Text style={styles.previewFeatureText}>{feature.text}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>
            )}
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
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  addButton: { backgroundColor: Colors.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', flexDirection: 'row', gap: 6 },
  addButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  content: { flex: 1, paddingHorizontal: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryBtn: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  secondaryBtnText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  stepsContainer: { gap: 8 },
  stepCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  stepCardInactive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepOrderBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  stepOrderText: { color: Colors.textSecondary, fontSize: 13 },
  stepIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepInfo: { flex: 1 },
  stepTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  stepDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  stepPreviewImage: { width: '100%', height: 180, borderRadius: 12 },
  noImagePlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  noImageText: { color: Colors.textSecondary, fontSize: 13 },
  stepFeatures: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  featuresLabel: { color: Colors.textSecondary, fontSize: 13 },
  gradientPreview: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gradientDot: { width: 8, height: 8, borderRadius: 4 },
  stepActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actionBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  bottomPadding: { height: 120 },
  modalContainer: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', flexDirection: 'row', gap: 6 },
  saveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  tabsContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  formSection: { marginBottom: 16 },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  textInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  textArea: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, minHeight: 100, textAlignVertical: 'top' },
  imagePreview: { gap: 8 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  iconOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  iconOptionText: { color: Colors.textSecondary, fontSize: 13 },
  iconOptionTextSelected: { color: Colors.primary },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  featureIndex: { width: 24, height: 24, borderRadius: 6, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
  featureInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  deleteFeatureBtn: { width: 40, height: 40, backgroundColor: Colors.error + '15', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addFeatureInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  addFeatureBtn: { width: 44, height: 44, backgroundColor: Colors.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addFeatureBtnDisabled: { opacity: 0.4 },
  colorPresets: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  colorPreset: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorPresetSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  gradientPreviewLarge: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  gradientDotLarge: { width: 32, height: 32, borderRadius: 16 },
  gradientLine: { flex: 1, height: 2, backgroundColor: Colors.border },
  modalBottomPadding: { height: 40 },
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  previewContainer: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, maxHeight: '80%' },
  previewClose: { alignSelf: 'flex-end', width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  previewScroll: { flexGrow: 0 },
  previewContent: { alignItems: 'center', paddingBottom: 20 },
  previewIconBg: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  previewTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  previewDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  previewImage: { width: '100%', height: 180, borderRadius: 12 },
  previewFeatures: { gap: 8 },
  previewFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewFeatureDot: { width: 8, height: 8, borderRadius: 4 },
  previewFeatureText: { color: Colors.textSecondary, fontSize: 13 }});
