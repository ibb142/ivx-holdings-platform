import React, { useCallback, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cloud, FileText, Film, ImageIcon, Sparkles, UploadCloud } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  analyzeFile,
  importGoogleDriveFile,
  summarizeFile,
  uploadAndIngestFile,
  type IVXMultimodalAnalysis,
  type IVXMultimodalKind,
  type IVXMultimodalSummary,
  type IVXMultimodalUpload} from '@/src/modules/ivx-owner-ai/services/ivxMultimodalService';

type StoredItem = {
  id: string;
  kind: IVXMultimodalKind | 'other';
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string;
  readUrl: string | null;
  source: 'upload' | 'drive';
};

function inferKindFromMime(mime: string | null | undefined): IVXMultimodalKind | 'other' {
  const lower = (mime ?? '').toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower === 'application/pdf' || lower === 'application/x-pdf') return 'pdf';
  if (lower.startsWith('video/')) return 'video';
  return 'other';
}

async function readUriAsBlob(uri: string): Promise<{ blob: Blob; sizeBytes: number | null }> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const sizeBytes = typeof (blob as Blob).size === 'number' ? (blob as Blob).size : null;
  return { blob, sizeBytes };
}

function KindIcon({ kind, size = 18 }: { kind: StoredItem['kind']; size?: number }) {
  if (kind === 'image') return <ImageIcon size={size} color={Colors.text} />;
  if (kind === 'pdf') return <FileText size={size} color={Colors.text} />;
  if (kind === 'video') return <Film size={size} color={Colors.text} />;
  return <FileText size={size} color={Colors.text} />;
}

export default function IVXFilesScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<StoredItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState<string>('');
  const [analyses, setAnalyses] = useState<Record<string, IVXMultimodalAnalysis | IVXMultimodalSummary>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handlePickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.92,
        allowsMultipleSelection: false});
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setBusy('Uploading image…');
      const { blob, sizeBytes } = await readUriAsBlob(asset.uri);
      const upload = await uploadAndIngestFile({
        kind: 'image',
        fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? blob.type ?? 'image/jpeg',
        sizeBytes: sizeBytes ?? null,
        body: blob});
      pushItem(upload, 'upload');
    } catch (error) {
      Alert.alert('Image upload failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }, []);

  const handlePickDocument = useCallback(async (kind: 'pdf' | 'video') => {
    try {
      const types = kind === 'pdf' ? ['application/pdf'] : ['video/*'];
      const result = await DocumentPicker.getDocumentAsync({ type: types, multiple: false, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? (kind === 'pdf' ? 'application/pdf' : 'video/mp4');
      setBusy(`Uploading ${kind}…`);
      const { blob, sizeBytes } = await readUriAsBlob(asset.uri);
      const upload = await uploadAndIngestFile({
        kind,
        fileName: asset.name ?? `${kind}-${Date.now()}`,
        mimeType,
        sizeBytes: asset.size ?? sizeBytes ?? null,
        body: blob});
      pushItem(upload, 'upload');
    } catch (error) {
      Alert.alert(`${kind.toUpperCase()} upload failed`, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }, []);

  const handleImportDrive = useCallback(async () => {
    if (!driveUrl.trim()) {
      Alert.alert('Drive URL required', 'Paste a Google Drive shared file link.');
      return;
    }
    try {
      setBusy('Importing from Google Drive…');
      const file = await importGoogleDriveFile(driveUrl.trim());
      setDriveUrl('');
      setItems((prev) => [{
        id: `${file.path}-${Date.now()}`,
        kind: inferKindFromMime(file.mimeType),
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath: file.path,
        readUrl: file.readUrl,
        source: 'drive'}, ...prev]);
    } catch (error) {
      Alert.alert('Drive import failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }, [driveUrl]);

  function pushItem(upload: IVXMultimodalUpload, source: StoredItem['source']) {
    setItems((prev) => [{
      id: `${upload.path}-${Date.now()}`,
      kind: (upload.kind as StoredItem['kind']) ?? inferKindFromMime(upload.mimeType),
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      storagePath: upload.path,
      readUrl: upload.readUrl,
      source}, ...prev]);
  }

  const runAnalyze = useCallback(async (item: StoredItem, mode: 'analyze' | 'summary') => {
    try {
      setAnalysisError(null);
      setBusy(`${mode === 'analyze' ? 'Analyzing' : 'Summarizing'} ${item.fileName}…`);
      const result = mode === 'analyze'
        ? await analyzeFile({ storagePath: item.storagePath })
        : await summarizeFile({ storagePath: item.storagePath });
      setAnalyses((prev) => ({ ...prev, [item.id]: result }));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }, []);

  const renderAnalysis = (item: StoredItem) => {
    const result = analyses[item.id];
    if (!result) return null;
    const block = 'analysis' in result ? result.analysis : result.summary;
    return (
      <View style={styles.analysisBox}>
        <View style={styles.analysisHeader}>
          <Sparkles size={14} color={Colors.text} />
          <Text style={styles.analysisHeaderText}>
            {('analysis' in result ? 'Analysis' : 'Summary')} · {block.kind} · {block.model ?? 'no-model'}
          </Text>
        </View>
        <Text style={styles.analysisAnswer}>{block.answer}</Text>
        {typeof block.pageCount === 'number' && (
          <Text style={styles.analysisMeta}>Pages: {block.pageCount}</Text>
        )}
        {typeof block.charsAnalyzed === 'number' && (
          <Text style={styles.analysisMeta}>Chars analyzed: {block.charsAnalyzed}</Text>
        )}
      </View>
    );
  };

  return (
    <ErrorBoundary>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 96 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Files & Multimodal</Text>
          <Text style={styles.subtitle}>
            Owner-only uploads. Files are stored in your private Supabase bucket and analyzed via the IVX AI Gateway.
          </Text>

          <View style={styles.actionRow}>
            <Pressable style={styles.actionTile} onPress={handlePickImage} testID="upload-image">
              <ImageIcon size={20} color={Colors.text} />
              <Text style={styles.actionLabel}>Image</Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => handlePickDocument('pdf')} testID="upload-pdf">
              <FileText size={20} color={Colors.text} />
              <Text style={styles.actionLabel}>PDF</Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => handlePickDocument('video')} testID="upload-video">
              <Film size={20} color={Colors.text} />
              <Text style={styles.actionLabel}>Video</Text>
            </Pressable>
          </View>

          <View style={styles.driveBox}>
            <View style={styles.driveHeader}>
              <Cloud size={16} color={Colors.text} />
              <Text style={styles.driveTitle}>Google Drive import</Text>
            </View>
            <Text style={styles.driveHint}>
              Paste a shared Drive link (anyone with the link). Owner-OAuth Drive ingestion is not enabled in this pass.
            </Text>
            <TextInput
              value={driveUrl}
              onChangeText={setDriveUrl}
              placeholder="https://drive.google.com/file/d/..."
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.driveInput}
              testID="drive-url-input"
            />
            <Pressable style={styles.driveButton} onPress={handleImportDrive} testID="drive-import-button">
              <UploadCloud size={16} color={Colors.background} />
              <Text style={styles.driveButtonText}>Import to IVX</Text>
            </Pressable>
          </View>

          {busy && (
            <View style={styles.busyRow}>
              <ShimmerIndicator size="small" color={Colors.text} />
              <Text style={styles.busyText}>{busy}</Text>
            </View>
          )}

          {analysisError && (
            <Text style={styles.errorText}>{analysisError}</Text>
          )}

          <Text style={styles.sectionHeader}>Stored files ({items.length})</Text>

          {items.length === 0 && (
            <Text style={styles.empty}>No files yet. Upload an image, PDF, or video to start.</Text>
          )}

          {items.map((item) => (
            <View key={item.id} style={styles.fileCard} testID={`file-card-${item.kind}`}>
              <View style={styles.fileHeader}>
                <KindIcon kind={item.kind} />
                <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
              </View>
              <Text style={styles.fileMeta}>
                {item.kind} · {item.mimeType ?? 'unknown'} · {item.sizeBytes ? `${Math.round(item.sizeBytes / 1024)} KB` : 'size unknown'} · {item.source}
              </Text>
              {item.kind === 'image' && item.readUrl && (
                <Image source={{ uri: item.readUrl }} style={styles.previewImage} resizeMode="cover" />
              )}
              <View style={styles.fileActions}>
                <Pressable style={styles.fileActionBtn} onPress={() => runAnalyze(item, 'analyze')}>
                  <Text style={styles.fileActionText}>Analyze</Text>
                </Pressable>
                <Pressable style={styles.fileActionBtn} onPress={() => runAnalyze(item, 'summary')}>
                  <Text style={styles.fileActionText}>Summary</Text>
                </Pressable>
              </View>
              {renderAnalysis(item)}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionTile: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: Colors.card,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border},
  actionLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  driveBox: {
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  driveHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  driveTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  driveHint: { fontSize: 12, color: Colors.muted },
  driveInput: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 13},
  driveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.text,
    paddingVertical: 12,
    borderRadius: 10},
  driveButtonText: { color: Colors.background, fontWeight: '700' as const, fontSize: 13 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  busyText: { color: Colors.muted, fontSize: 12 },
  errorText: { color: Colors.danger, fontSize: 12, marginTop: 6 },
  sectionHeader: { marginTop: 16, fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  empty: { color: Colors.muted, fontSize: 13, fontStyle: 'italic' },
  fileCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileName: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  fileMeta: { fontSize: 11, color: Colors.muted },
  previewImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: Colors.background },
  fileActions: { flexDirection: 'row', gap: 8 },
  fileActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border},
  fileActionText: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  analysisBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6},
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  analysisHeaderText: { fontSize: 11, fontWeight: '700' as const, color: Colors.text },
  analysisAnswer: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  analysisMeta: { fontSize: 11, color: Colors.muted }});

void FileSystem;
