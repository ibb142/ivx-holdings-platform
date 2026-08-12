import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  Beaker,
  FlaskConical,
  Lightbulb,
  Plus} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createExperiment,
  createHypothesis,
  listExperiments,
  listHypotheses,
  setHypothesisStatus,
  updateExperiment,
  type ExperimentStatus,
  type HypothesisStatus,
  type ResearchExperiment,
  type ResearchHypothesis} from '@/src/modules/ivx-developer/innovationService';

const HYPOTHESIS_FLOW: Record<HypothesisStatus, HypothesisStatus> = {
  open: 'testing',
  testing: 'validated',
  validated: 'invalidated',
  invalidated: 'open'};

const EXPERIMENT_FLOW: Record<ExperimentStatus, ExperimentStatus> = {
  planned: 'running',
  running: 'completed',
  completed: 'abandoned',
  abandoned: 'planned'};

function statusTone(status: HypothesisStatus | ExperimentStatus): string {
  switch (status) {
    case 'validated':
    case 'completed':
      return Colors.success;
    case 'testing':
    case 'running':
      return Colors.info;
    case 'invalidated':
    case 'abandoned':
      return Colors.error;
    default:
      return Colors.warning;
  }
}

function ResearchLabContent() {
  const insets = useSafeAreaInsets();
  const [hypothesisText, setHypothesisText] = useState<string>('');
  const [hypothesisRationale, setHypothesisRationale] = useState<string>('');
  const [experimentTitle, setExperimentTitle] = useState<string>('');
  const [experimentMethod, setExperimentMethod] = useState<string>('');
  const [experimentMetric, setExperimentMetric] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hypothesesQuery = useQuery<ResearchHypothesis[]>({
    queryKey: ['ivx-innovation', 'hypotheses'],
    queryFn: listHypotheses});
  const experimentsQuery = useQuery<ResearchExperiment[]>({
    queryKey: ['ivx-innovation', 'experiments'],
    queryFn: listExperiments});

  const hypotheses = hypothesesQuery.data ?? [];
  const experiments = experimentsQuery.data ?? [];

  const handleAddHypothesis = useCallback(async () => {
    if (!hypothesisText.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await createHypothesis({ statement: hypothesisText.trim(), rationale: hypothesisRationale.trim() });
      setHypothesisText('');
      setHypothesisRationale('');
      await hypothesesQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create the hypothesis.');
    } finally {
      setBusy(false);
    }
  }, [hypothesisText, hypothesisRationale, hypothesesQuery]);

  const handleAddExperiment = useCallback(async () => {
    if (!experimentTitle.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await createExperiment({
        title: experimentTitle.trim(),
        method: experimentMethod.trim(),
        metric: experimentMetric.trim()});
      setExperimentTitle('');
      setExperimentMethod('');
      setExperimentMetric('');
      await experimentsQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create the experiment.');
    } finally {
      setBusy(false);
    }
  }, [experimentTitle, experimentMethod, experimentMetric, experimentsQuery]);

  const cycleHypothesis = useCallback(async (hypothesis: ResearchHypothesis) => {
    setActionError(null);
    try {
      await setHypothesisStatus(hypothesis.id, HYPOTHESIS_FLOW[hypothesis.status]);
      await hypothesesQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the hypothesis.');
    }
  }, [hypothesesQuery]);

  const cycleExperiment = useCallback(async (experiment: ResearchExperiment) => {
    setActionError(null);
    try {
      await updateExperiment(experiment.id, { status: EXPERIMENT_FLOW[experiment.status] });
      await experimentsQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the experiment.');
    }
  }, [experimentsQuery]);

  const refreshing = hypothesesQuery.isFetching || experimentsQuery.isFetching;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          tintColor={Colors.primary}
          refreshing={refreshing}
          onRefresh={() => {
            void hypothesesQuery.refetch();
            void experimentsQuery.refetch();
          }}
        />
      }
      testID="ivx-research-lab-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <FlaskConical size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Research Lab</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          Frame hypotheses, run experiments, and track discoveries. IVX submits its own findings here for your review.
        </Text>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Lightbulb size={15} color={Colors.primary} />
          <Text style={styles.eyebrow}>New hypothesis</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Hypothesis statement (e.g. Adding ROI badges increases deal taps)"
          placeholderTextColor={Colors.inputPlaceholder}
          value={hypothesisText}
          onChangeText={setHypothesisText}
          multiline
          testID="ivx-research-hypothesis-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Rationale (optional)"
          placeholderTextColor={Colors.inputPlaceholder}
          value={hypothesisRationale}
          onChangeText={setHypothesisRationale}
          multiline
        />
        <Pressable
          style={[styles.addButton, busy || !hypothesisText.trim() ? styles.buttonDisabled : null]}
          onPress={() => { void handleAddHypothesis(); }}
          disabled={busy || !hypothesisText.trim()}
          testID="ivx-research-add-hypothesis"
        >
          <Plus size={14} color={Colors.black} />
          <Text style={styles.addButtonText}>Add hypothesis</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Hypotheses ({hypotheses.length})</Text>
        {hypotheses.length === 0 ? (
          <Text style={styles.emptyBody}>No hypotheses yet.</Text>
        ) : (
          hypotheses.map((h) => (
            <Pressable key={h.id} style={styles.itemCard} onPress={() => { void cycleHypothesis(h); }} testID={`ivx-research-hypothesis-${h.id}`}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.itemTitle} numberOfLines={3}>{h.statement}</Text>
                <View style={[styles.statusTag, { borderColor: statusTone(h.status) }]}>
                  <Text style={[styles.statusTagText, { color: statusTone(h.status) }]}>{h.status}</Text>
                </View>
              </View>
              {h.rationale ? <Text style={styles.itemBody}>{h.rationale}</Text> : null}
              <Text style={styles.itemHint}>Tap to advance status</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Beaker size={15} color={Colors.primary} />
          <Text style={styles.eyebrow}>New experiment</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Experiment title"
          placeholderTextColor={Colors.inputPlaceholder}
          value={experimentTitle}
          onChangeText={setExperimentTitle}
          testID="ivx-research-experiment-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Method (how you'll test it)"
          placeholderTextColor={Colors.inputPlaceholder}
          value={experimentMethod}
          onChangeText={setExperimentMethod}
          multiline
        />
        <TextInput
          style={styles.input}
          placeholder="Success metric"
          placeholderTextColor={Colors.inputPlaceholder}
          value={experimentMetric}
          onChangeText={setExperimentMetric}
        />
        <Pressable
          style={[styles.addButton, busy || !experimentTitle.trim() ? styles.buttonDisabled : null]}
          onPress={() => { void handleAddExperiment(); }}
          disabled={busy || !experimentTitle.trim()}
          testID="ivx-research-add-experiment"
        >
          <Plus size={14} color={Colors.black} />
          <Text style={styles.addButtonText}>Add experiment</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Experiments ({experiments.length})</Text>
        {experiments.length === 0 ? (
          <Text style={styles.emptyBody}>No experiments yet.</Text>
        ) : (
          experiments.map((e) => (
            <Pressable key={e.id} style={styles.itemCard} onPress={() => { void cycleExperiment(e); }} testID={`ivx-research-experiment-${e.id}`}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.itemTitle} numberOfLines={2}>{e.title}</Text>
                <View style={[styles.statusTag, { borderColor: statusTone(e.status) }]}>
                  <Text style={[styles.statusTagText, { color: statusTone(e.status) }]}>{e.status}</Text>
                </View>
              </View>
              {e.method ? <Text style={styles.itemBody}>{`Method: ${e.method}`}</Text> : null}
              {e.metric ? <Text style={styles.itemBody}>{`Metric: ${e.metric}`}</Text> : null}
              <Text style={styles.itemHint}>Tap to advance status</Text>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

export default function ResearchLabScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Research Lab' }} />
      <ResearchLabContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 13.5,
    minHeight: 44},
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, paddingVertical: 11, borderRadius: 10 },
  addButtonText: { fontSize: 14, fontWeight: '700' as const, color: Colors.black },
  buttonDisabled: { opacity: 0.5 },
  itemCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 13, gap: 6, borderWidth: 1, borderColor: Colors.border },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  itemTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, flex: 1 },
  itemBody: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  itemHint: { fontSize: 10.5, color: Colors.textTertiary, fontStyle: 'italic' as const },
  statusTag: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  statusTagText: { fontSize: 10.5, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 }});
