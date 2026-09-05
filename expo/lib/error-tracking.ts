import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { reportAutonomousIncident } from './autonomous-incident-bridge';

const ERROR_LOG_KEY = '@ivx_error_log';
const MAX_ERRORS = 100;
const SUPABASE_SYNC_INTERVAL = 120_000;
const MAX_SYNC_BATCH = 50;

interface ErrorEntry {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  screen?: string;
  platform: string;
  severity: 'error' | 'warning' | 'fatal';
  metadata?: Record<string, string>;
}

class ErrorTracker {
  private buffer: ErrorEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSyncQueue: ErrorEntry[] = [];
  private syncFailures = 0;

  async init() {
    try {
      const stored = await AsyncStorage.getItem(ERROR_LOG_KEY);
      if (stored) {
        this.buffer = JSON.parse(stored);
        console.log('[ErrorTracker] Loaded', this.buffer.length, 'stored errors');
      }
    } catch {
      console.log('[ErrorTracker] Init: no stored errors');
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.captureError(event.error || new Error(event.message), 'error', { source: 'window.onerror' });
      });
      window.addEventListener('unhandledrejection', (event) => {
        const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        this.captureError(err, 'error', { source: 'unhandledrejection' });
      });
    }

    console.log('[ErrorTracker] Initialized for platform:', Platform.OS);
    this.startSupabaseSync();
  }

  private startSupabaseSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      void this.syncToSupabase();
    }, SUPABASE_SYNC_INTERVAL);
  }

  private async syncToSupabase() {
    if (!isSupabaseConfigured() || this.pendingSyncQueue.length === 0) return;

    const batch = this.pendingSyncQueue.splice(0, MAX_SYNC_BATCH);
    try {
      const rows = batch.map(e => ({
        id: e.id,
        message: e.message,
        stack: e.stack?.slice(0, 500),
        platform: e.platform,
        severity: e.severity,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
        screen: e.screen || null,
        created_at: e.timestamp,
      }));

      const { error } = await supabase.from('error_logs').insert(rows);
      if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.log('[ErrorTracker] error_logs table does not exist — errors stored locally only');
          this.pendingSyncQueue.unshift(...batch);
          if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
          return;
        }
        this.syncFailures++;
        if (this.syncFailures <= 3) {
          this.pendingSyncQueue.unshift(...batch);
        }
        console.log('[ErrorTracker] Supabase sync failed:', error.message);
      } else {
        this.syncFailures = 0;
        console.log('[ErrorTracker] Synced', batch.length, 'errors to Supabase');
      }
    } catch (err) {
      this.syncFailures++;
      if (this.syncFailures <= 3) {
        this.pendingSyncQueue.unshift(...batch);
      }
      console.log('[ErrorTracker] Supabase sync error:', (err as Error)?.message);
    }
  }

  captureError(
    error: Error | string,
    severity: 'error' | 'warning' | 'fatal' = 'error',
    metadata?: Record<string, string>
  ) {
    const err = typeof error === 'string' ? new Error(error) : error;

    const entry: ErrorEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      message: err.message,
      stack: err.stack?.slice(0, 500),
      platform: Platform.OS,
      severity,
      metadata,
    };

    this.buffer.push(entry);
    this.pendingSyncQueue.push(entry);
    if (this.buffer.length > MAX_ERRORS) {
      this.buffer = this.buffer.slice(-MAX_ERRORS);
    }
    if (this.pendingSyncQueue.length > MAX_ERRORS * 2) {
      this.pendingSyncQueue = this.pendingSyncQueue.slice(-MAX_ERRORS);
    }

    console.log(`[ErrorTracker] ${severity.toUpperCase()}: ${err.message}`);

    // Critical missing bridge: client errors must enter the backend incident
    // queue that Autonomous actually reads. Fatal errors are classified by the
    // bridge as silent_failure, which activates diagnose -> staging -> replay.
    void reportAutonomousIncident({
      message: err.message,
      stack: err.stack,
      platform: Platform.OS,
      severity,
      metadata,
      buildId: process.env.EXPO_PUBLIC_IVX_BUILD_ID || null,
    });

    this.scheduleFlush();
  }

  captureMessage(message: string, severity: 'error' | 'warning' = 'warning', metadata?: Record<string, string>) {
    this.captureError(new Error(message), severity, metadata);
  }

  setScreen(screenName: string) {
    console.log('[ErrorTracker] Current screen:', screenName);
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
      this.flushTimer = null;
    }, 5000);
  }

  private async flush() {
    try {
      await AsyncStorage.setItem(ERROR_LOG_KEY, JSON.stringify(this.buffer));
    } catch {
      console.log('[ErrorTracker] Flush failed');
    }
  }

  async getErrors(): Promise<ErrorEntry[]> {
    return [...this.buffer];
  }

  async clearErrors() {
    this.buffer = [];
    await AsyncStorage.removeItem(ERROR_LOG_KEY);
    console.log('[ErrorTracker] Errors cleared');
  }

  async getErrorReport(): Promise<string> {
    const errors = await this.getErrors();
    if (errors.length === 0) return 'No errors recorded.';

    const lines = errors.map(e =>
      `[${e.timestamp}] ${e.severity.toUpperCase()} | ${e.message} | ${e.metadata ? JSON.stringify(e.metadata) : ''}`
    );
    return lines.join('\n');
  }
}

export const errorTracker = new ErrorTracker();
