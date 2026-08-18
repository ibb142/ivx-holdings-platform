/**
 * useRealtimeVoice — WebSocket-based real-time voice conversation hook.
 *
 * Connects to the IVX backend WebSocket endpoint and provides:
 *   - Push-to-talk audio recording + streaming
 *   - Live AI text streaming (token-by-token)
 *   - Progressive TTS audio playback (sentence-by-sentence)
 *   - Interrupt/barge-in support
 *   - Conversation history
 *   - Automatic reconnection
 *
 * This is the closest possible experience to ChatGPT's voice mode within
 * Expo's native capabilities (no WebRTC, but WebSocket streaming with
 * progressive audio playback).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  AudioRecorder,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import type { AVPlaybackStatus } from 'expo-av';

export type RealtimeVoiceState = 'idle' | 'connecting' | 'connected' | 'recording' | 'listening' | 'speaking' | 'error';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type RealtimeVoiceConfig = {
  endpoint?: string;
  voice?: string;
  onTranscript?: (text: string) => void;
  onAIDelta?: (text: string) => void;
  onAIDone?: (fullText: string) => void;
  onError?: (message: string) => void;
};

const DEFAULT_ENDPOINT = 'wss://api.ivxholding.com/api/ivx/realtime-voice';

export function useRealtimeVoice(config: RealtimeVoiceConfig = {}) {
  const [state, setState] = useState<RealtimeVoiceState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const currentSoundRef = useRef<{ stopAsync: () => Promise<AVPlaybackStatus>; unloadAsync: () => Promise<AVPlaybackStatus> } | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiTextBufferRef = useRef<string>('');
  const isRecordingRef = useRef<boolean>(false);

  const endpoint = config.endpoint || DEFAULT_ENDPOINT;

  // ── Audio playback ─────────────────────────────────────────────────────────

  const stopAudioPlayback = useCallback(async () => {
    if (currentSoundRef.current) {
      try {
        await currentSoundRef.current.stopAsync();
        await currentSoundRef.current.unloadAsync();
      } catch {
        // ignore
      }
      currentSoundRef.current = null;
    }
  }, []);

  const playAudioChunk = useCallback(async (base64Data: string, sequence: number) => {
    try {
      const fsCacheDir = (FileSystem as { cacheDirectory?: string | null }).cacheDirectory || '';
      const tempPath = `${fsCacheDir}rt_voice_${sequence}.mp3`;
      await FileSystem.writeAsStringAsync(tempPath, base64Data, {
        encoding: 'base64',
      });

      // Stop current audio if playing
      await stopAudioPlayback();

      // Use expo-av for playback (simpler API than expo-audio for this use case)
      const { Audio } = await import('expo-av');
      const { sound } = await Audio.Sound.createAsync(
        { uri: tempPath },
        { shouldPlay: true, volume: 1.0 },
      );
      currentSoundRef.current = sound as unknown as { stopAsync: () => Promise<AVPlaybackStatus>; unloadAsync: () => Promise<AVPlaybackStatus> };

      sound.setOnPlaybackStatusUpdate(async (status: AVPlaybackStatus & { isLoaded?: boolean; didJustFinish?: boolean }) => {
        if (status.isLoaded && status.didJustFinish) {
          try {
            await sound.unloadAsync();
          } catch {
            // ignore
          }
          if (currentSoundRef.current === sound) {
            currentSoundRef.current = null;
          }
          FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => undefined);
        }
      });
    } catch (err) {
      console.error('[useRealtimeVoice] Audio playback error:', err);
    }
  }, [stopAudioPlayback]);

  // ── WebSocket message handler ────────────────────────────────────────────────

  const handleWSMessage = useCallback((event: MessageEvent) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(message.type || '');

    switch (type) {
      case 'status': {
        setSessionId(String(message.sessionId || null));
        setIsConnected(true);
        setState('connected');
        break;
      }
      case 'session.ready': {
        break;
      }
      case 'transcript': {
        const text = String(message.text || '');
        setTranscript(text);
        config.onTranscript?.(text);
        setConversation((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() },
        ]);
        setState('listening');
        break;
      }
      case 'ai.delta': {
        const delta = String(message.text || '');
        aiTextBufferRef.current += delta;
        setAiResponse(aiTextBufferRef.current);
        config.onAIDelta?.(delta);
        setState('speaking');
        break;
      }
      case 'ai.done': {
        const fullText = String(message.fullText || aiTextBufferRef.current);
        aiTextBufferRef.current = '';
        setConversation((prev) => [
          ...prev,
          { id: `ai-${Date.now()}`, role: 'assistant', content: fullText, timestamp: Date.now() },
        ]);
        config.onAIDone?.(fullText);
        break;
      }
      case 'audio': {
        const data = String(message.data || '');
        const seq = Number(message.sequence ?? 0);
        void playAudioChunk(data, seq);
        break;
      }
      case 'interrupt.ack': {
        void stopAudioPlayback();
        aiTextBufferRef.current = '';
        setAiResponse('');
        setState('idle');
        break;
      }
      case 'error': {
        const msg = String(message.message || 'Unknown error');
        setError(msg);
        config.onError?.(msg);
        setState('error');
        break;
      }
      case 'pong': {
        break;
      }
    }
  }, [config, playAudioChunk, stopAudioPlayback]);

  // ── Connect WebSocket ────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState('connecting');
    setError(null);

    try {
      const ws = new WebSocket(endpoint);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[useRealtimeVoice] WebSocket connected');
        setState('connected');
        setIsConnected(true);
        ws.send(JSON.stringify({ type: 'session.init', voice: config.voice || 'nova' }));
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30_000);
      };

      ws.onmessage = handleWSMessage;

      ws.onerror = () => {
        setError('Connection error');
        setState('error');
      };

      ws.onclose = () => {
        console.log('[useRealtimeVoice] WebSocket closed');
        wsRef.current = null;
        setIsConnected(false);
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (state !== 'idle') {
          reconnectTimerRef.current = setTimeout(() => connect(), 3_000);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setState('error');
    }
  }, [endpoint, config.voice, handleWSMessage, state]);

  // ── Disconnect ───────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    void stopAudioPlayback();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState('idle');
    setIsConnected(false);
  }, [stopAudioPlayback]);

  // ── Start recording (push-to-talk) ───────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to voice server');
      setState('error');
      return;
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone permission denied');
      setState('error');
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });

    await stopAudioPlayback();

    wsRef.current.send(JSON.stringify({ type: 'interrupt' }));

    const fsCacheDir = (FileSystem as { cacheDirectory?: string | null }).cacheDirectory || '';
    const recordingPath = `${fsCacheDir}rt_recording_${Date.now()}.m4a`;
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record({ forDuration: 120 });
    isRecordingRef.current = true;
    setState('recording');
    setTranscript('');
    setAiResponse('');
    aiTextBufferRef.current = '';
  }, [audioRecorder, stopAudioPlayback]);

  // ── Stop recording and send audio ────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;

    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      isRecordingRef.current = false;

      const uri = audioRecorder.uri;
      if (!uri) {
        setError('Recording failed — no audio captured');
        setState('error');
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'audio',
          data: base64,
          fileName: `voice-${Date.now()}.m4a`,
          mimeType: 'audio/m4a',
        }));
        wsRef.current.send(JSON.stringify({ type: 'audio.end' }));
        setState('listening');
      }

      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      setError(msg);
      setState('error');
      isRecordingRef.current = false;
    }
  }, [audioRecorder]);

  // ── Interrupt AI (barge-in) ──────────────────────────────────────────────────

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    void stopAudioPlayback();
    aiTextBufferRef.current = '';
    setAiResponse('');
    setState('idle');
  }, [stopAudioPlayback]);

  // ── Clear conversation ──────────────────────────────────────────────────────

  const clearConversation = useCallback(() => {
    setConversation([]);
    setTranscript('');
    setAiResponse('');
    aiTextBufferRef.current = '';
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    isConnected,
    sessionId,
    transcript,
    aiResponse,
    conversation,
    error,
    isRecording: recorderState.isRecording,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    interrupt,
    clearConversation,
  };
}
