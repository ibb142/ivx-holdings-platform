import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useMutation } from '@tanstack/react-query';
import { FileText, ImageIcon, Mic, Radio, Send, Square, Video } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { transcribeAudioRecording } from '@/src/modules/ivx-owner-ai/services/ivxMultimodalService';
import { useWebKeyboard, scrollInputIntoView } from '@/hooks/useWebKeyboard';
import { guessUploadFileType, uploadService } from '../services/uploadService';
import type { CapabilityState, ChatFileType, UploadableFile } from '../types/chat';

type UploadKind = 'image' | 'video' | 'document';

type ComposerPayload = {
  text?: string;
  fileType?: ChatFileType;
  upload?: UploadableFile;
};

type ComposerStatusIndicator = {
  state: CapabilityState;
  label: string;
  detail: string;
  isLoading: boolean;
  testID: string;
};

type ComposerNote = {
  id: string;
  tone: 'info' | 'warning';
  text: string;
  testID: string;
};

type ComposerProps = {
  onSend: (payload: ComposerPayload) => Promise<void>;
  sending?: boolean;
  onFocus?: () => void;
  onTyping?: () => void;
  bottomInset?: number;
  notes?: ComposerNote[];
  statusIndicator?: ComposerStatusIndicator | null;
};

function normalizeComposerText(value: unknown, fallback: string = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value == null) {
    return fallback;
  }

  try {
    return String(value);
  } catch (error) {
    console.log('[Composer] Failed to normalize text value:', (error as Error)?.message ?? 'Unknown error');
    return fallback;
  }
}

export function Composer({
  onSend,
  sending = false,
  onFocus,
  onTyping,
  bottomInset = 16,
}: ComposerProps) {
  const router = useRouter();
  const [text, setText] = useState<string>('');
  const textRef = useRef<string>('');
  const inputRef = useRef<TextInput | null>(null);
  const { keyboardHeight: webKeyboardHeight } = useWebKeyboard();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const pickAttachmentMutation = useMutation<UploadableFile | null, Error, UploadKind>({
    mutationFn: async (kind) => {
      console.log('[Composer] Attachment pick requested:', kind);
      if (kind === 'image') {
        return uploadService.pickImage();
      }

      if (kind === 'video') {
        return uploadService.pickVideo();
      }

      return uploadService.pickDocument();
    },
  });

  const transcribeVoiceMutation = useMutation<string, Error, string>({
    mutationFn: async (uri) => {
      const result = await transcribeAudioRecording({
        uri,
        fileName: Platform.OS === 'web' ? 'voice.webm' : 'voice.m4a',
        mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
      });
      return result.text;
    },
    onSuccess: (transcript) => {
      const normalizedTranscript = normalizeComposerText(transcript).trim();
      if (!normalizedTranscript) {
        Alert.alert('Voice not transcribed', 'No speech was detected in that recording.');
        return;
      }

      const currentText = normalizeComposerText(textRef.current).trim();
      const nextText = currentText ? `${currentText}\n${normalizedTranscript}` : normalizedTranscript;
      textRef.current = nextText;
      setText(nextText);
      onTyping?.();
      inputRef.current?.focus();
    },
    onError: (error) => {
      console.log('[Composer] Voice transcription error:', error.message);
      Alert.alert('Voice transcription unavailable', error.message || 'We could not transcribe that recording. Please try again.');
    },
  });

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const isRecording = recorderState.isRecording;
  const isTranscribing = transcribeVoiceMutation.isPending;
  const isBusy = sending || pickAttachmentMutation.isPending || isTranscribing;
  const normalizedText = useMemo(() => normalizeComposerText(text), [text]);
  const canSendText = useMemo(() => normalizedText.trim().length > 0 && !isBusy && !isRecording, [isBusy, isRecording, normalizedText]);
  const containerPaddingBottom = useMemo(() => Math.max(bottomInset, 8), [bottomInset]);

  const handleSend = useCallback(async (overrideText?: unknown) => {
    const capturedValue = normalizeComposerText(overrideText, textRef.current);
    const value = capturedValue.trim();
    if (!value || isBusy) {
      console.log('[Composer] Skipping send:', {
        isBusy,
        normalizedType: typeof capturedValue,
        normalizedLength: capturedValue.length,
      });
      return;
    }

    try {
      console.log('[Composer] Sending text payload length:', value.length);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await onSend({ text: capturedValue });
      textRef.current = '';
      setText('');
      inputRef.current?.clear();
    } catch (error) {
      console.log('[Composer] Send error:', (error as Error)?.message ?? 'Unknown error');
    }
  }, [isBusy, onSend]);

  const handleAttachment = useCallback(async (kind: UploadKind) => {
    if (isBusy || isRecording) {
      return;
    }

    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const attachment = await pickAttachmentMutation.mutateAsync(kind);
      if (!attachment) {
        return;
      }

      const capturedText = normalizeComposerText(textRef.current);
      const trimmedText = capturedText.trim();
      const fileType = guessUploadFileType(attachment.type ?? null);
      await onSend({
        text: trimmedText.length > 0 ? capturedText : undefined,
        fileType,
        upload: attachment,
      });
      textRef.current = '';
      setText('');
      inputRef.current?.clear();
    } catch (error) {
      console.log('[Composer] Attachment send error:', (error as Error)?.message ?? 'Unknown error');
      Alert.alert('Attachment not sent', 'We could not send that attachment. Please try again.');
    }
  }, [isBusy, isRecording, onSend, pickAttachmentMutation]);

  const stopVoiceRecording = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = audioRecorder.uri;
      if (!uri) {
        Alert.alert('Voice not saved', 'No recording file was created. Please try again.');
        return;
      }
      await transcribeVoiceMutation.mutateAsync(uri);
    } catch (error) {
      console.log('[Composer] Stop voice recording error:', (error as Error)?.message ?? 'Unknown error');
      Alert.alert('Voice not transcribed', 'We could not stop or transcribe that recording. Please try again.');
    }
  }, [audioRecorder, transcribeVoiceMutation]);

  const startVoiceRecording = useCallback(async () => {
    if (isBusy || isRecording) {
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone permission required', 'Please allow microphone access to use voice input.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record({ forDuration: 120 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.log('[Composer] Start voice recording error:', (error as Error)?.message ?? 'Unknown error');
      Alert.alert('Voice recording unavailable', 'We could not start recording. Please try again.');
    }
  }, [audioRecorder, isBusy, isRecording]);

  const handleVoicePress = useCallback(async () => {
    if (isRecording) {
      await stopVoiceRecording();
      return;
    }
    await startVoiceRecording();
  }, [isRecording, startVoiceRecording, stopVoiceRecording]);

  const handleRealtimeVoice = useCallback(() => {
    if (isBusy || isRecording) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/ivx/realtime-voice' as never);
  }, [isBusy, isRecording, router]);

  return (
    <View style={[styles.container, { paddingBottom: Platform.OS === 'web' ? Math.max(containerPaddingBottom, webKeyboardHeight) : containerPaddingBottom }]} testID="chat-composer">
      <View style={styles.inputShell}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(value) => {
            const nextValue = normalizeComposerText(value);
            textRef.current = nextValue;
            setText(nextValue);
            if (nextValue.trim().length > 0) {
              onTyping?.();
            }
          }}
          onFocus={() => {
            onFocus?.();
            if (Platform.OS === 'web') {
              const el = (inputRef.current as unknown as { _inputRef?: { current?: HTMLElement } } | null)?._inputRef?.current ?? null;
              scrollInputIntoView(el);
            }
          }}
          placeholder="Write a message"
          placeholderTextColor="#B8C0CC"
          style={styles.input}
          multiline
          maxLength={1200}
          editable={!isBusy}
          textAlignVertical="top"
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={(event) => {
            const submittedText = normalizeComposerText(event?.nativeEvent?.text, textRef.current);
            void handleSend(submittedText);
          }}
          selectionColor={Colors.primary}
          testID="chat-composer-input"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            canSendText ? styles.sendButtonActive : styles.sendButtonDisabled,
            pressed && canSendText ? styles.pressed : null,
          ]}
          onPress={() => {
            void handleSend();
          }}
          disabled={!canSendText}
          testID="chat-composer-send"
        >
          <Send size={16} color={canSendText ? Colors.black : Colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            isRecording ? styles.recordingButton : null,
            pressed ? styles.pressed : null,
          ]}
          onPress={() => {
            void handleVoicePress();
          }}
          disabled={isTranscribing || sending || pickAttachmentMutation.isPending}
          testID="chat-composer-voice"
        >
          {isRecording ? <Square size={16} color={Colors.error} /> : <Mic size={16} color={Colors.primary} />}
          <Text style={styles.actionText}>{isRecording ? 'Stop' : isTranscribing ? 'Transcribing…' : 'Voice'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.liveVoiceButton, pressed ? styles.pressed : null]}
          onPress={handleRealtimeVoice}
          disabled={isBusy || isRecording}
          testID="chat-composer-live-voice"
          accessibilityRole="button"
          accessibilityLabel="Open IVX realtime voice conversation"
        >
          <Radio size={16} color={Colors.success} />
          <Text style={styles.actionText}>Live Voice</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}
          onPress={() => {
            void handleAttachment('image');
          }}
          disabled={isBusy || isRecording}
          testID="chat-composer-image"
        >
          <ImageIcon size={16} color={Colors.primary} />
          <Text style={styles.actionText}>{pickAttachmentMutation.isPending ? 'Preparing…' : 'Image'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}
          onPress={() => {
            void handleAttachment('video');
          }}
          disabled={isBusy || isRecording}
          testID="chat-composer-video"
        >
          <Video size={16} color={Colors.primary} />
          <Text style={styles.actionText}>{pickAttachmentMutation.isPending ? 'Preparing…' : 'Video'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}
          onPress={() => {
            void handleAttachment('document');
          }}
          disabled={isBusy || isRecording}
          testID="chat-composer-document"
        >
          <FileText size={16} color={Colors.primary} />
          <Text style={styles.actionText}>{pickAttachmentMutation.isPending ? 'Preparing…' : 'PDF / File'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingTop: 4,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 34,
  },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 74,
    backgroundColor: '#12161C',
    borderWidth: 1,
    borderColor: '#46505E',
    borderRadius: 12,
    color: '#F8FAFC',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    fontSize: 14,
    lineHeight: 18,
    ...(Platform.OS === 'web'
      ? ({
          // @ts-ignore: web-only CSS properties for Samsung keyboard fix
          touchAction: 'manipulation',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          outlineStyle: 'none',
        } as any)
      : {}),
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  sendButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primaryDark,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.surface,
    borderColor: Colors.surfaceBorder,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveVoiceButton: {
    borderColor: 'rgba(34,197,94,0.55)',
  },
  recordingButton: {
    borderColor: Colors.error,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  actionText: {
    color: '#E2E8F0',
    fontSize: 8,
    fontWeight: '600' as const,
  },
  pressed: {
    opacity: 0.82,
  },
});
