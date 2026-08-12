import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  RefreshControl,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Keyboard} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  MessageSquare,
  Play,
  Square,
  Send,
  AlertTriangle,
  Clock,
  CheckCircle,
  CheckCheck,
  XCircle,
  Zap,
  BarChart3,
  Phone,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
  Users,
  UserCheck,
  Megaphone,
  Brain,
  Sparkles,
  Radio} from "lucide-react-native";
import Colors from "@/constants/colors";
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type LogType = "all" | "hourly" | "emergency" | "manual" | "daily_summary" | "smart_update";

interface SmartScheduleMessage {
  recipient: string;
  timestamp: string;
  message: string;
}

interface TeamRecipient {
  name: string;
  phone: string;
  role: string;
  active: boolean;
  alertTypes: string[];
}

interface SMSReportStatus {
  id: string;
  status: string;
  running: boolean;
  phone: string;
  total_sent: number;
  total_failed: number;
  total_simulated: number;
  total_delivered?: number | null;
  recipients?: unknown;
  sns_configured: boolean;
  updated_at: string | null;
  last_report_time?: string | null;
  last_report?: string | null;
  mode?: string | null;
  timesPerDay?: number | null;
  scheduledHoursET?: number[] | null;
  recentMessages?: unknown;
}

interface SmartScheduleView {
  running: boolean;
  mode: string;
  timesPerDay: number;
  scheduledHoursET: number[];
  recipients: string[];
  startDate: string | null;
  recentMessages: SmartScheduleMessage[];
}

const SMS_REPORT_STATUS_REFRESH_MS = 60_000;

const DEFAULT_SMS_REPORT_STATUS: SMSReportStatus = {
  id: 'default',
  status: 'stopped',
  running: false,
  phone: '',
  total_sent: 0,
  total_failed: 0,
  total_simulated: 0,
  recipients: [],
  sns_configured: false,
  updated_at: null};

const DEFAULT_SMART_SCHEDULE: SmartScheduleView = {
  running: false,
  mode: 'testing',
  timesPerDay: 3,
  scheduledHoursET: [8, 13, 18],
  recipients: ['Kimberly Perez', 'Sharon'],
  startDate: null,
  recentMessages: []};

const TYPE_COLORS: Record<string, string> = {
  hourly: Colors.accent,
  emergency: Colors.error,
  manual: Colors.primary,
  daily_summary: Colors.success,
  smart_update: "#00C9A7"};

const TYPE_LABELS: Record<string, string> = {
  hourly: "Hourly",
  emergency: "Emergency",
  manual: "Manual",
  daily_summary: "Daily",
  smart_update: "AI Smart"};

export default function SMSReportsScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [logFilter, setLogFilter] = useState<LogType>("all");
  const [logPage, setLogPage] = useState(1);
  const [customMessage, setCustomMessage] = useState("");
  const [emergencySubject, setEmergencySubject] = useState("");
  const [emergencyDetails, setEmergencyDetails] = useState("");
  const [showEmergencyForm, setShowEmergencyForm] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [sentMessages, setSentMessages] = useState<Array<{ id: string; message: string; time: Date; serverSentAt?: string; status: 'sending' | 'sent' | 'failed'; deliveredTo?: string[] }>>([]);
  const chatScrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingMsgIdRef = useRef<string | null>(null);
  const sendAnim = useRef(new Animated.Value(1)).current;
  const isMountedRef = useRef(true);

  const statusQuery = useQuery<SMSReportStatus>({
    queryKey: ['smsReports.getStatus'],
    queryFn: async () => {
      console.log('[Supabase] Fetching SMS report status');
      try {
        const { data, error } = await supabase.from('sms_reports').select('*').eq('id', 'default').single();
        if (error) {
          console.log('[Supabase] sms_reports error:', error.message);
          if (error.message.includes('schema cache') || error.code === 'PGRST204') {
            console.log('[Supabase] sms_reports table needs migration — returning defaults');
          }
          return DEFAULT_SMS_REPORT_STATUS;
        }
        return {
          ...DEFAULT_SMS_REPORT_STATUS,
          ...((data ?? {}) as Partial<SMSReportStatus>)};
      } catch (e: any) {
        console.log('[Supabase] sms_reports fetch failed:', e?.message);
        return DEFAULT_SMS_REPORT_STATUS;
      }
    },
    placeholderData: DEFAULT_SMS_REPORT_STATUS,
    refetchInterval: SMS_REPORT_STATUS_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false});

  const logQuery = useQuery<any>({
    queryKey: ['smsReports.getLog', { page: logPage, limit: 15, type: logFilter }],
    queryFn: async () => {
      console.log('[Supabase] Fetching SMS log');
      let query = supabase.from('sms_messages').select('*', { count: 'exact' }).order('created_at', { ascending: false });
      if (logFilter !== 'all') {
        query = query.eq('type', logFilter);
      }
      const pageSize = 15;
      const from = (logPage - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);
      const { data, error, count } = await query;
      if (error) { console.log('[Supabase] sms_messages error:', error.message); return null; }
      const total = count ?? 0;
      return { items: data ?? [], total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
    refetchOnMount: true});

  const startMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Starting SMS reporting');
      try {
        const { data, error } = await supabase.from('sms_reports').upsert({ id: 'default', status: 'active', running: true, updated_at: new Date().toISOString() }).select().single();
        if (error) {
          console.log('[Supabase] start upsert error:', error.message);
          if (error.message.includes('schema cache')) {
            const { data: d2, error: e2 } = await supabase.from('sms_reports').upsert({ id: 'default', updated_at: new Date().toISOString() }).select().single();
            if (e2) throw new Error('Table needs migration. Run supabase-sms-migration.sql in Supabase SQL Editor.');
            return { success: true, ...d2 };
          }
          throw new Error(error.message);
        }
        return { success: true, ...data };
      } catch (e: any) {
        throw new Error(e?.message || 'Failed to start reporting');
      }
    },
    onSuccess: () => {
      console.log('[SMS] Reporting started');
      Alert.alert('Success', 'SMS reporting started successfully');
      void statusQuery.refetch();
      void logQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Start reporting failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to start reporting');
    }});

  const stopMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Stopping SMS reporting');
      try {
        const { data, error } = await supabase.from('sms_reports').upsert({ id: 'default', status: 'stopped', running: false, updated_at: new Date().toISOString() }).select().single();
        if (error) {
          console.log('[Supabase] stop upsert error:', error.message);
          if (error.message.includes('schema cache')) {
            const { data: d2, error: e2 } = await supabase.from('sms_reports').upsert({ id: 'default', updated_at: new Date().toISOString() }).select().single();
            if (e2) throw new Error('Table needs migration. Run supabase-sms-migration.sql in Supabase SQL Editor.');
            return { success: true, ...d2 };
          }
          throw new Error(error.message);
        }
        return { success: true, ...data };
      } catch (e: any) {
        throw new Error(e?.message || 'Failed to stop reporting');
      }
    },
    onSuccess: () => {
      console.log('[SMS] Reporting stopped');
      void statusQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Stop reporting failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to stop reporting');
    }});

  const sendNowMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Sending hourly report now');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sms_messages').insert({ type: 'hourly', status: 'sent', message: 'Hourly report snapshot', sent_at: now, created_at: now }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[SMS] Hourly report sent');
      Alert.alert('Sent', 'Hourly report sent successfully');
      void logQuery.refetch();
      void statusQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Send now failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to send report');
    }});

  const sendDailyMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Sending daily summary');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sms_messages').insert({ type: 'daily_summary', status: 'sent', message: 'Daily summary report', sent_at: now, created_at: now }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[SMS] Daily summary sent');
      Alert.alert('Sent', 'Daily summary sent successfully');
      void logQuery.refetch();
      void statusQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Daily summary failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to send daily summary');
    }});

  const sendEmergencyMutation = useMutation({
    mutationFn: async (input: { subject: string; details: string }) => {
      console.log('[Supabase] Sending emergency alert');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sms_messages').insert({ type: 'emergency', subject: input.subject, details: input.details, message: `EMERGENCY: ${input.subject} — ${input.details}`, status: 'sent', sent_at: now, created_at: now }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[SMS] Emergency alert sent');
      Alert.alert('Sent', 'Emergency alert sent successfully');
      setEmergencySubject("");
      setEmergencyDetails("");
      setShowEmergencyForm(false);
      void logQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Emergency alert failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to send emergency alert');
    }});

  const sendCustomMutation = useMutation({
    mutationFn: async (input: { message: string }) => {
      console.log('[Supabase] Sending custom SMS');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sms_messages').insert({ type: 'manual', message: input.message, content: input.message, status: 'sent', sent_at: now, created_at: now }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, simulated: true, sentAt: now, deliveredTo: [], warning: 'Supabase mode — configure SMS provider for real delivery', ...data };
    },
    onSuccess: (data: any) => {
      const msgId = pendingMsgIdRef.current;
      const wasSimulated = data.simulated === true;
      const warning = data.warning as string | undefined;
      console.log(`[SMS] Custom message ${wasSimulated ? 'SIMULATED' : 'DELIVERED'}, msgId:`, msgId, 'deliveredTo:', data.deliveredTo);
      if (!isMountedRef.current) return;
      setSentMessages(prev => prev.map(m => {
        if (m.id === msgId || m.status === 'sending') {
          return {
            ...m,
            status: 'sent' as const,
            serverSentAt: data.sentAt,
            deliveredTo: data.deliveredTo};
        }
        return m;
      }));
      pendingMsgIdRef.current = null;
      if (wasSimulated) {
        Alert.alert(
          'SMS Simulated',
          warning || 'SMS provider is not configured. Messages were logged but NOT actually delivered to phones.',
          [{ text: 'OK' }]
        );
      }
      void logQuery.refetch();
      void statusQuery.refetch();
      scrollToBottom();
    },
    onError: (error: Error) => {
      const msgId = pendingMsgIdRef.current;
      console.error('[SMS] Custom message failed:', error.message, 'msgId:', msgId);
      if (!isMountedRef.current) return;
      Alert.alert('SMS Failed', error.message || 'Failed to send custom message. Please try again.');
      setSentMessages(prev => prev.map(m => 
        (m.id === msgId || m.status === 'sending') ? { ...m, status: 'failed' as const } : m
      ));
      pendingMsgIdRef.current = null;
    }});

  const teamRecipients = useMemo<TeamRecipient[]>(() => {
    const rawRecipients = statusQuery.data?.recipients;
    if (!Array.isArray(rawRecipients)) {
      return [];
    }

    return rawRecipients.flatMap((item): TeamRecipient[] => {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) {
          return [];
        }

        return [{
          name: trimmed,
          phone: '',
          role: 'team_member',
          active: true,
          alertTypes: []}];
      }

      if (!item || typeof item !== 'object') {
        return [];
      }

      const candidate = item as {
        name?: unknown;
        phone?: unknown;
        role?: unknown;
        active?: unknown;
        alertTypes?: unknown;
      };
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
      if (!name) {
        return [];
      }

      const alertTypes = Array.isArray(candidate.alertTypes)
        ? candidate.alertTypes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];

      return [{
        name,
        phone: typeof candidate.phone === 'string' ? candidate.phone : '',
        role: typeof candidate.role === 'string' ? candidate.role : 'team_member',
        active: candidate.active !== false,
        alertTypes}];
    });
  }, [statusQuery.data?.recipients]);

  const smartSchedule = useMemo<SmartScheduleView>(() => {
    const statusData = statusQuery.data ?? DEFAULT_SMS_REPORT_STATUS;
    const scheduledHoursET = Array.isArray(statusData.scheduledHoursET)
      ? statusData.scheduledHoursET.filter((hour): hour is number => typeof hour === 'number' && Number.isFinite(hour))
      : DEFAULT_SMART_SCHEDULE.scheduledHoursET;
    const recipients = teamRecipients.length > 0
      ? teamRecipients.map((recipient) => recipient.name)
      : DEFAULT_SMART_SCHEDULE.recipients;
    const rawRecentMessages = statusData.recentMessages;
    const recentMessages = Array.isArray(rawRecentMessages)
      ? rawRecentMessages.filter(
          (item): item is SmartScheduleMessage =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as SmartScheduleMessage).recipient === 'string' &&
            typeof (item as SmartScheduleMessage).timestamp === 'string' &&
            typeof (item as SmartScheduleMessage).message === 'string'
        )
      : DEFAULT_SMART_SCHEDULE.recentMessages;

    return {
      running: statusData.status === 'smart_active',
      mode: typeof statusData.mode === 'string' && statusData.mode.trim().length > 0 ? statusData.mode : DEFAULT_SMART_SCHEDULE.mode,
      timesPerDay: typeof statusData.timesPerDay === 'number' && Number.isFinite(statusData.timesPerDay) ? statusData.timesPerDay : DEFAULT_SMART_SCHEDULE.timesPerDay,
      scheduledHoursET,
      recipients,
      startDate: statusData.updated_at ? statusData.updated_at.split('T')[0] : DEFAULT_SMART_SCHEDULE.startDate,
      recentMessages};
  }, [statusQuery.data, teamRecipients]);

  const activeTeamRecipientCount = useMemo<number>(() => teamRecipients.filter((recipient) => recipient.active).length, [teamRecipients]);

  const startSmartMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Starting smart schedule');
      const now = new Date().toISOString();
      try {
        const { data, error } = await supabase.from('sms_reports').upsert({
          id: 'default',
          status: 'smart_active',
          updated_at: now}).select().single();
        if (error) {
          if (error.message.includes('schema cache')) {
            const { data: d2, error: e2 } = await supabase.from('sms_reports').upsert({ id: 'default', updated_at: now }).select().single();
            if (e2) throw new Error('Table needs migration. Run supabase-sms-migration.sql in Supabase SQL Editor.');
            return { success: true, ...d2 };
          }
          throw new Error(error.message);
        }
        return { success: true, ...data };
      } catch (e: any) {
        throw new Error(e?.message || 'Failed to start smart schedule');
      }
    },
    onSuccess: () => {
      console.log('[SMS] Smart schedule started');
      Alert.alert('Success', 'AI Smart Schedule activated');
      void statusQuery.refetch();
      void logQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Start smart schedule failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to start smart schedule');
    }});

  const stopSmartMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Stopping smart schedule');
      try {
        const { data, error } = await supabase.from('sms_reports').upsert({ id: 'default', status: 'inactive', updated_at: new Date().toISOString() }).select().single();
        if (error) {
          if (error.message.includes('schema cache')) {
            const { data: d2, error: e2 } = await supabase.from('sms_reports').upsert({ id: 'default', updated_at: new Date().toISOString() }).select().single();
            if (e2) throw new Error('Table needs migration. Run supabase-sms-migration.sql in Supabase SQL Editor.');
            return { success: true, ...d2 };
          }
          throw new Error(error.message);
        }
        return { success: true, ...data };
      } catch (e: any) {
        throw new Error(e?.message || 'Failed to stop smart schedule');
      }
    },
    onSuccess: () => {
      console.log('[SMS] Smart schedule stopped');
      void statusQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Stop smart schedule failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to stop smart schedule');
    }});

  const sendSmartNowMutation = useMutation({
    mutationFn: async () => {
      console.log('[Supabase] Sending smart update now');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sms_messages').insert({ type: 'smart_update', status: 'sent', message: 'AI Smart Update', sent_at: now, created_at: now }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[SMS] Smart update sent now');
      Alert.alert('Sent', 'AI Smart Update sent successfully');
      void logQuery.refetch();
      void statusQuery.refetch();
    },
    onError: (error: Error) => {
      console.error('[SMS] Smart send now failed:', error.message);
      Alert.alert('Error', error.message || 'Failed to send smart update');
    }});

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const shouldPulse = Boolean(statusQuery.data?.running || smartSchedule.running);
    if (shouldPulse) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [pulseAnim, smartSchedule.running, statusQuery.data?.running]);

  const scrollToBottom = useCallback(() => {
    const doScroll = () => {
      chatScrollRef.current?.scrollToEnd({ animated: true });
      scrollViewRef.current?.scrollToEnd({ animated: true });
    };
    doScroll();
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 400);
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => scrollToBottom()
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToBottom]);

  const onRefresh = useCallback(() => {
    void statusQuery.refetch();
    void logQuery.refetch();
  }, [statusQuery, logQuery]);

  const handleToggleReporting = useCallback(() => {
    if (statusQuery.data?.running) {
      Alert.alert("Stop Reports", "Stop hourly SMS reports?", [
        { text: "Cancel", style: "cancel" },
        { text: "Stop", style: "destructive", onPress: () => stopMutation.mutate() },
      ]);
    } else {
      startMutation.mutate();
    }
  }, [statusQuery.data?.running, startMutation, stopMutation]);

  const handleSendEmergency = useCallback(() => {
    if (!emergencySubject.trim() || !emergencyDetails.trim()) return;
    sendEmergencyMutation.mutate({
      subject: emergencySubject.trim(),
      details: emergencyDetails.trim()});
  }, [emergencySubject, emergencyDetails, sendEmergencyMutation]);

  const handleSendCustom = useCallback(() => {
    if (!customMessage.trim() || sendCustomMutation.isPending) return;
    const msgText = customMessage.trim();
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    console.log('[SMS] Sending custom message:', msgText.substring(0, 50), 'id:', msgId);
    
    const newMsg = {
      id: msgId,
      message: msgText,
      time: new Date(),
      status: 'sending' as const};
    
    pendingMsgIdRef.current = msgId;
    setSentMessages(prev => [...prev, newMsg]);
    setCustomMessage("");
    
    Animated.sequence([
      Animated.timing(sendAnim, { toValue: 0.6, duration: 100, useNativeDriver: true }),
      Animated.timing(sendAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    
    sendCustomMutation.mutate({ message: msgText });
    
    scrollToBottom();
  }, [customMessage, sendCustomMutation, sendAnim, scrollToBottom]);

  const status = statusQuery.data;
  const logs = logQuery.data;
  const isRunning = status?.running ?? (status?.status === 'active');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="sms-back">
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <MessageSquare size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>SMS Command Center</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn} testID="sms-refresh">
          <RefreshCw size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 56 : 0}
      >
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isRefetching || logQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.smartCard}>
          <View style={styles.smartHeader}>
            <View style={styles.smartHeaderLeft}>
              <Brain size={20} color="#00C9A7" />
              <Text style={styles.smartTitle}>AI Smart Messaging</Text>
            </View>
            <View style={[
              styles.smartModeBadge,
              {
                backgroundColor: smartSchedule.running ? "#00C9A720" : Colors.surface,
                borderColor: smartSchedule.running ? "#00C9A760" : Colors.surfaceBorder},
            ]}>
              <Animated.View style={[
                styles.smartModeDot,
                {
                  backgroundColor: smartSchedule.running ? "#00C9A7" : Colors.textTertiary,
                  opacity: smartSchedule.running ? pulseAnim : 1},
              ]} />
              <Text style={[
                styles.smartModeText,
                { color: smartSchedule.running ? "#00C9A7" : Colors.textTertiary },
              ]}>
                {smartSchedule.running ? smartSchedule.mode === "testing" ? "TESTING" : "LIVE 24/7" : "OFF"}
              </Text>
            </View>
          </View>

          <Text style={styles.smartDesc}>
            AI sends personalized, professional updates to Kimberly & Sharon — addressed by name, concise, and context-aware.
          </Text>

          <View style={styles.smartScheduleInfo}>
            <View style={styles.smartInfoRow}>
              <Clock size={13} color={Colors.textSecondary} />
              <Text style={styles.smartInfoText}>
                {smartSchedule.timesPerDay || 3}x/day at{" "}
                {(smartSchedule.scheduledHoursET || [8, 13, 18]).map((h: number) => `${h}:00`).join(", ")} ET
              </Text>
            </View>
            <View style={styles.smartInfoRow}>
              <Users size={13} color={Colors.textSecondary} />
              <Text style={styles.smartInfoText}>
                {(smartSchedule.recipients || ["Kimberly Perez", "Sharon"]).join(", ")}
              </Text>
            </View>
            {smartSchedule.startDate && (
              <View style={styles.smartInfoRow}>
                <Sparkles size={13} color={Colors.textSecondary} />
                <Text style={styles.smartInfoText}>
                  Start: {smartSchedule.startDate}
                </Text>
              </View>
            )}
          </View>

          {smartSchedule.recentMessages.length > 0 && (
            <View style={styles.smartRecentSection}>
              <Text style={styles.smartRecentTitle}>Recent AI Messages</Text>
              {smartSchedule.recentMessages.slice(-3).map((msg: SmartScheduleMessage, idx: number) => (
                <View key={idx} style={styles.smartRecentItem}>
                  <View style={styles.smartRecentHeader}>
                    <Text style={styles.smartRecentRecipient}>{msg.recipient}</Text>
                    <Text style={styles.smartRecentTime}>
                      {new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={styles.smartRecentMsg} numberOfLines={2}>{msg.message}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.smartActions}>
            {!smartSchedule.running ? (
              <TouchableOpacity
                style={styles.smartStartBtn}
                onPress={() => startSmartMutation.mutate()}
                disabled={startSmartMutation.isPending}
                testID="smart-start"
              >
                {startSmartMutation.isPending ? (
                  <ShimmerIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Brain size={16} color="#FFF" />
                    <Text style={styles.smartStartText}>Activate AI Schedule</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.smartRunningActions}>
                <TouchableOpacity
                  style={styles.smartSendNowBtn}
                  onPress={() => sendSmartNowMutation.mutate()}
                  disabled={sendSmartNowMutation.isPending}
                  testID="smart-send-now"
                >
                  {sendSmartNowMutation.isPending ? (
                    <ShimmerIndicator size="small" color="#00C9A7" />
                  ) : (
                    <>
                      <Radio size={14} color="#00C9A7" />
                      <Text style={styles.smartSendNowText}>Send AI Update Now</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smartStopBtn}
                  onPress={() => {
                    Alert.alert("Stop AI Schedule", "Stop automated AI messaging to the team?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Stop", style: "destructive", onPress: () => stopSmartMutation.mutate() },
                    ]);
                  }}
                  disabled={stopSmartMutation.isPending}
                  testID="smart-stop"
                >
                  <Square size={14} color={Colors.error} />
                  <Text style={styles.smartStopText}>Stop</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <View style={styles.teamCard}>
          <View style={styles.teamHeader}>
            <Users size={18} color={Colors.accent} />
            <Text style={styles.teamTitle}>Advertising Team</Text>
            <View style={styles.teamBadge}>
              <Text style={styles.teamBadgeText}>
                {activeTeamRecipientCount} Active
              </Text>
            </View>
          </View>
          {teamRecipients.map((r: TeamRecipient, idx: number) => {
            const isManager = r.role === "advertising_manager";
            const isOwner = r.role === "owner";
            const roleColor = isOwner ? Colors.primary : isManager ? Colors.accent : Colors.success;
            const roleLabel = isOwner ? "CEO / Owner" : isManager ? "Ad Manager" : "Ad Partner";
            const roleIcon = isOwner ? Zap : isManager ? Megaphone : UserCheck;
            const RoleIcon = roleIcon;
            return (
              <View key={idx} style={styles.teamMember}>
                <View style={[styles.teamAvatar, { borderColor: roleColor + "60" }]}>
                  <RoleIcon size={16} color={roleColor} />
                </View>
                <View style={styles.teamInfo}>
                  <View style={styles.teamNameRow}>
                    <Text style={styles.teamName}>{r.name}</Text>
                    <View style={[styles.teamRoleBadge, { backgroundColor: roleColor + "18", borderColor: roleColor + "40" }]}>
                      <Text style={[styles.teamRoleText, { color: roleColor }]}>{roleLabel}</Text>
                    </View>
                  </View>
                  <View style={styles.teamPhoneRow}>
                    <Phone size={11} color={Colors.textTertiary} />
                    <Text style={styles.teamPhone}>{r.phone}</Text>
                  </View>
                  <View style={styles.teamAlertRow}>
                    {r.alertTypes.map((t: string) => (
                      <View key={t} style={[styles.alertTypeDot, { backgroundColor: (TYPE_COLORS[t] || Colors.textTertiary) + "30" }]}>
                        <Text style={[styles.alertTypeDotText, { color: TYPE_COLORS[t] || Colors.textTertiary }]}>
                          {TYPE_LABELS[t] || t}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={[styles.teamStatusDot, { backgroundColor: r.active ? Colors.success : Colors.textTertiary }]} />
              </View>
            );
          })}
          <View style={styles.teamFooter}>
            <Text style={styles.teamFooterText}>All team members receive alerts 24/7 for potential investors, owners, JV partners, brokers & influencers</Text>
          </View>
        </View>

        {!!status && !status.sns_configured && (
          <View style={styles.snsWarningCard}>
            <View style={styles.snsWarningRow}>
              <AlertTriangle size={16} color="#FFB800" />
              <Text style={styles.snsWarningTitle}>AWS SNS Not Configured</Text>
            </View>
            <Text style={styles.snsWarningText}>
              SMS messages are being simulated — NOT actually delivered to phones. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables to enable real SMS delivery via AWS SNS.
            </Text>
            {(status?.total_simulated ?? 0) > 0 && (
              <Text style={styles.snsWarningCount}>
                {status?.total_simulated ?? 0} message(s) simulated so far
              </Text>
            )}
          </View>
        )}

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusLeft}>
              <Animated.View style={[styles.statusDot, { backgroundColor: isRunning ? Colors.success : Colors.textTertiary, opacity: isRunning ? pulseAnim : 1 }]} />
              <View>
                <Text style={styles.statusLabel}>{isRunning ? "LIVE REPORTING" : "INACTIVE"}</Text>
                <Text style={styles.statusPhone}>
                  <Phone size={12} color={Colors.textSecondary} /> {status?.phone || "No phone configured"}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.toggleBtn, isRunning ? styles.toggleBtnStop : styles.toggleBtnStart]}
              onPress={handleToggleReporting}
              testID="sms-toggle"
            >
              {isRunning ? (
                <>
                  <Square size={14} color={Colors.error} />
                  <Text style={[styles.toggleText, { color: Colors.error }]}>Stop</Text>
                </>
              ) : (
                <>
                  <Play size={14} color={Colors.success} />
                  <Text style={[styles.toggleText, { color: Colors.success }]}>Start</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{status?.total_sent ?? 0}</Text>
              <Text style={styles.statLabel}>Delivered</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: (status?.total_simulated ?? 0) > 0 ? '#FFB800' : Colors.text }]}>{status?.total_simulated ?? 0}</Text>
              <Text style={styles.statLabel}>Simulated</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: status?.total_failed ? Colors.error : Colors.text }]}>{status?.total_failed ?? 0}</Text>
              <Text style={styles.statLabel}>Failed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {status?.last_report_time
                  ? new Date(status.last_report_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </Text>
              <Text style={styles.statLabel}>Last Sent</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={[styles.actionCard, { borderColor: Colors.accent + "40" }]}
            onPress={() => sendNowMutation.mutate()}
            disabled={sendNowMutation.isPending}
            testID="sms-send-now"
          >
            {sendNowMutation.isPending ? (
              <ShimmerIndicator size="small" color={Colors.accent} />
            ) : (
              <BarChart3 size={22} color={Colors.accent} />
            )}
            <Text style={styles.actionLabel}>Send Report Now</Text>
            <Text style={styles.actionDesc}>Hourly snapshot</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { borderColor: Colors.success + "40" }]}
            onPress={() => sendDailyMutation.mutate()}
            disabled={sendDailyMutation.isPending}
            testID="sms-send-daily"
          >
            {sendDailyMutation.isPending ? (
              <ShimmerIndicator size="small" color={Colors.success} />
            ) : (
              <FileText size={22} color={Colors.success} />
            )}
            <Text style={styles.actionLabel}>Daily Summary</Text>
            <Text style={styles.actionDesc}>Full day recap</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { borderColor: Colors.error + "40" }]}
            onPress={() => setShowEmergencyForm(!showEmergencyForm)}
            testID="sms-emergency"
          >
            <AlertTriangle size={22} color={Colors.error} />
            <Text style={styles.actionLabel}>Emergency</Text>
            <Text style={styles.actionDesc}>Priority alert</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { borderColor: Colors.primary + "40" }]}
            onPress={() => setShowCustomForm(!showCustomForm)}
            testID="sms-custom"
          >
            <Send size={22} color={Colors.primary} />
            <Text style={styles.actionLabel}>Custom SMS</Text>
            <Text style={styles.actionDesc}>Free text</Text>
          </TouchableOpacity>
        </View>

        {showEmergencyForm && (
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <AlertTriangle size={16} color={Colors.error} />
              <Text style={[styles.formTitle, { color: Colors.error }]}>Emergency Alert</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Subject (e.g., Server Down)"
              placeholderTextColor={Colors.inputPlaceholder}
              value={emergencySubject}
              onChangeText={setEmergencySubject}
              maxLength={100}
              testID="emergency-subject"
              onFocus={() => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300)}
            />
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Details..."
              placeholderTextColor={Colors.inputPlaceholder}
              value={emergencyDetails}
              onChangeText={setEmergencyDetails}
              multiline
              maxLength={500}
              testID="emergency-details"
              onFocus={() => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300)}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: Colors.error }]}
              onPress={handleSendEmergency}
              disabled={sendEmergencyMutation.isPending || !emergencySubject.trim() || !emergencyDetails.trim()}
            >
              {sendEmergencyMutation.isPending ? (
                <ShimmerIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Zap size={16} color="#FFF" />
                  <Text style={styles.sendBtnText}>Send Emergency Alert</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {showCustomForm && (
          <View style={styles.chatCard}>
            <View style={styles.chatHeader}>
              <Send size={16} color={Colors.primary} />
              <Text style={[styles.formTitle, { color: Colors.primary }]}>Custom Message</Text>
              <TouchableOpacity onPress={() => { setShowCustomForm(false); }} style={styles.chatCloseBtn}>
                <Text style={styles.chatCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatMessages}
              contentContainerStyle={styles.chatMessagesContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {sentMessages.length === 0 && (
                <View style={styles.chatEmpty}>
                  <Send size={24} color={Colors.textTertiary} />
                  <Text style={styles.chatEmptyText}>Type a message below to send SMS</Text>
                  <Text style={styles.chatEmptySubtext}>Messages go to all active team members</Text>
                </View>
              )}
              {sentMessages.map((msg) => {
                const displayTime = msg.serverSentAt
                  ? new Date(msg.serverSentAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  : msg.time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
                return (
                <View key={msg.id} style={styles.chatBubbleRow}>
                  <View style={[
                    styles.chatBubble,
                    msg.status === 'failed' && styles.chatBubbleFailed,
                  ]}>
                    <Text style={styles.chatBubbleText}>{msg.message}</Text>
                    <View style={styles.chatBubbleMeta}>
                      <Text style={styles.chatBubbleTime}>
                        {displayTime}
                      </Text>
                      {msg.status === 'sending' && (
                        <ShimmerIndicator size={10} color={Colors.textTertiary} />
                      )}
                      {msg.status === 'sent' && (
                        <View style={styles.readReceiptRow}>
                          <CheckCheck size={14} color={Colors.success} />
                          <Text style={[styles.readLabel, { color: Colors.success }]}>Sent</Text>
                        </View>
                      )}
                      {msg.status === 'failed' && (
                        <View style={styles.readReceiptRow}>
                          <XCircle size={12} color={Colors.error} />
                          <Text style={[styles.readLabel, { color: Colors.error }]}>Failed</Text>
                        </View>
                      )}
                    </View>
                    {msg.status === 'sent' && msg.deliveredTo && msg.deliveredTo.length > 0 && (
                      <View style={styles.deliveredToRow}>
                        <UserCheck size={10} color={Colors.success} />
                        <Text style={styles.deliveredToText}>
                          Sent to: {msg.deliveredTo.join(", ")}
                        </Text>
                      </View>
                    )}
                  </View>
                  {msg.status === 'failed' && (
                    <TouchableOpacity
                      style={styles.chatRetryBtn}
                      onPress={() => {
                        const retryId = msg.id;
                        pendingMsgIdRef.current = retryId;
                        setSentMessages(prev => prev.map(m => m.id === retryId ? { ...m, status: 'sending' as const } : m));
                        sendCustomMutation.mutate({ message: msg.message });
                      }}
                    >
                      <Text style={styles.chatRetryText}>Tap to Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
                );
              })}
            </ScrollView>

            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Type your message..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={customMessage}
                onChangeText={setCustomMessage}
                multiline
                maxLength={1600}
                testID="custom-message"
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                    chatScrollRef.current?.scrollToEnd({ animated: true });
                  }, 100);
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 400);
                }}
                returnKeyType="default"
              />
              <Animated.View style={{ transform: [{ scale: sendAnim }] }}>
                <TouchableOpacity
                  style={[
                    styles.chatSendBtn,
                    (!customMessage.trim() || sendCustomMutation.isPending) && styles.chatSendBtnDisabled,
                  ]}
                  onPress={handleSendCustom}
                  disabled={sendCustomMutation.isPending || !customMessage.trim()}
                  testID="custom-send"
                  activeOpacity={0.6}
                >
                  {sendCustomMutation.isPending ? (
                    <ShimmerIndicator size={16} color={Colors.black} />
                  ) : (
                    <Send size={18} color={customMessage.trim() ? Colors.black : Colors.textTertiary} />
                  )}
                </TouchableOpacity>
              </Animated.View>
            </View>
            <Text style={styles.chatCharCount}>{customMessage.length}/1600</Text>
          </View>
        )}

        {status?.last_report ? (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Last Report Preview</Text>
            <View style={styles.previewBox}>
              <Text style={styles.previewText}>{status.last_report}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.logSection}>
          <Text style={styles.sectionTitle}>Message History</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(["all", "hourly", "emergency", "manual", "daily_summary", "smart_update"] as LogType[]).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.filterChip, logFilter === type && styles.filterChipActive]}
                onPress={() => { setLogFilter(type); setLogPage(1); }}
              >
                <Text style={[styles.filterText, logFilter === type && styles.filterTextActive]}>
                  {type === "all" ? "All" : TYPE_LABELS[type] || type}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {logQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />
          ) : logs?.items.length === 0 ? (
            <View style={styles.emptyLog}>
              <MessageSquare size={32} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Start reporting to see SMS history</Text>
            </View>
          ) : (
            <>
              {logs?.items.map((entry: any) => {
                const isExpanded = expandedLog === entry.id;
                const typeColor = TYPE_COLORS[entry.type] || Colors.textSecondary;
                return (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.logItem}
                    onPress={() => setExpandedLog(isExpanded ? null : entry.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.logItemHeader}>
                      <View style={[styles.logTypeBadge, { backgroundColor: typeColor + "20", borderColor: typeColor + "40" }]}>
                        <Text style={[styles.logTypeText, { color: typeColor }]}>
                          {TYPE_LABELS[entry.type] || entry.type}
                        </Text>
                      </View>
                      <View style={styles.logStatusRow}>
                        {entry.status === "sent" ? (
                          <CheckCircle size={14} color={Colors.success} />
                        ) : entry.status === "simulated" ? (
                          <Clock size={14} color={Colors.warning} />
                        ) : entry.status === "pending" ? (
                          <Clock size={14} color={Colors.accent} />
                        ) : (
                          <XCircle size={14} color={Colors.error} />
                        )}
                        <Text style={styles.logTime}>
                          {new Date(entry.sent_at || entry.created_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"})}
                        </Text>
                        {isExpanded ? (
                          <ChevronUp size={14} color={Colors.textTertiary} />
                        ) : (
                          <ChevronDown size={14} color={Colors.textTertiary} />
                        )}
                      </View>
                    </View>
                    {entry.recipient && (
                      <View style={styles.logRecipientRow}>
                        <UserCheck size={11} color={Colors.textTertiary} />
                        <Text style={styles.logRecipientText}>
                          To: {entry.recipient}{entry.recipient_phone ? ` (${entry.recipient_phone})` : ""}
                        </Text>
                      </View>
                    )}
                    {isExpanded && entry.delivered_at && (
                      <View style={styles.logRecipientRow}>
                        <CheckCheck size={11} color={Colors.success} />
                        <Text style={[styles.logRecipientText, { color: Colors.success }]}>
                          Delivered: {new Date(entry.delivered_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"})}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.logPreview} numberOfLines={isExpanded ? undefined : 2}>
                      {entry.message || entry.content || '(no message)'}
                    </Text>
                    {entry.error && (
                      <Text style={styles.logError}>{entry.error}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {logs && logs.totalPages > 1 && (
                <View style={styles.pagination}>
                  <TouchableOpacity
                    style={[styles.pageBtn, logPage <= 1 && styles.pageBtnDisabled]}
                    onPress={() => setLogPage(p => Math.max(1, p - 1))}
                    disabled={logPage <= 1}
                  >
                    <Text style={styles.pageBtnText}>Prev</Text>
                  </TouchableOpacity>
                  <Text style={styles.pageInfo}>{logPage} / {logs.totalPages}</Text>
                  <TouchableOpacity
                    style={[styles.pageBtn, logPage >= logs.totalPages && styles.pageBtnDisabled]}
                    onPress={() => setLogPage(p => Math.min(logs.totalPages, p + 1))}
                    disabled={logPage >= logs.totalPages}
                  >
                    <Text style={styles.pageBtnText}>Next</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>How It Works</Text>
          <View style={styles.infoRow}>
            <Clock size={14} color={Colors.accent} />
            <Text style={styles.infoText}>Hourly reports with traffic, transactions, and KPIs</Text>
          </View>
          <View style={styles.infoRow}>
            <AlertTriangle size={14} color={Colors.error} />
            <Text style={styles.infoText}>Emergency alerts for errors, memory spikes, and outages</Text>
          </View>
          <View style={styles.infoRow}>
            <FileText size={14} color={Colors.success} />
            <Text style={styles.infoText}>Daily summaries at midnight ET with full recap</Text>
          </View>
          <View style={styles.infoRow}>
            <Zap size={14} color={Colors.primary} />
            <Text style={styles.infoText}>Powered by AWS SNS — works while you sleep</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center" as const,
    justifyContent: "center" as const},
  headerCenter: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8},
  headerTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: Colors.text,
    letterSpacing: -0.3},
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center" as const,
    justifyContent: "center" as const},
  keyboardAvoid: {
    flex: 1},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    gap: 16},
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 16},
  statusLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12},
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6},
  statusLabel: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.text,
    letterSpacing: 1},
  statusPhone: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  toggleBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1},
  toggleBtnStart: {
    borderColor: Colors.success + "60",
    backgroundColor: Colors.success + "15"},
  toggleBtnStop: {
    borderColor: Colors.error + "60",
    backgroundColor: Colors.error + "15"},
  toggleText: {
    fontSize: 13,
    fontWeight: "600" as const},
  statsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-around" as const,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  statItem: {
    alignItems: "center" as const},
  statValue: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.text},
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5},
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder},
  actionsGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10},
  actionCard: {
    width: "48%" as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 8,
    flexGrow: 1,
    flexBasis: "45%" as any},
  actionLabel: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.text},
  actionDesc: {
    fontSize: 11,
    color: Colors.textTertiary},
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  formHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 4},
  formTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    flex: 1},
  chatCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    overflow: "hidden" as const},
  chatHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  chatCloseBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.backgroundTertiary},
  chatCloseText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "500" as const},
  chatMessages: {
    maxHeight: 280,
    minHeight: 120},
  chatMessagesContent: {
    padding: 12,
    gap: 8},
  chatEmpty: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 30,
    gap: 8},
  chatEmptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "500" as const},
  chatEmptySubtext: {
    fontSize: 11,
    color: Colors.textTertiary},
  chatBubbleRow: {
    alignItems: "flex-end" as const},
  chatBubble: {
    maxWidth: "80%" as any,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10},
  chatBubbleFailed: {
    backgroundColor: Colors.error + "30",
    borderColor: Colors.error + "60",
    borderWidth: 1},
  chatBubbleText: {
    fontSize: 14,
    color: Colors.black,
    lineHeight: 20},
  chatBubbleMeta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 4,
    marginTop: 4},
  chatBubbleTime: {
    fontSize: 10,
    color: Colors.black + "80"},
  readReceiptRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2},
  readLabel: {
    fontSize: 9,
    color: "#34B7F1",
    fontWeight: "600" as const},
  deliveredToRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.black + "15"},
  deliveredToText: {
    fontSize: 10,
    color: Colors.black + "70",
    flex: 1},
  chatRetryBtn: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.error + "20"},
  chatRetryText: {
    fontSize: 11,
    color: Colors.error,
    fontWeight: "600" as const},
  logRecipientRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4},
  logRecipientText: {
    fontSize: 11,
    color: Colors.textTertiary},
  chatInputRow: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  chatInput: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    maxHeight: 100,
    minHeight: 40},
  chatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: "center" as const,
    justifyContent: "center" as const},
  chatSendBtnDisabled: {
    backgroundColor: Colors.backgroundTertiary},
  chatCharCount: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: "right" as const,
    paddingHorizontal: 16,
    paddingBottom: 8},
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.text},
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top" as const},
  charCount: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: "right" as const},
  sendBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10},
  sendBtnText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#FFF"},
  previewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  previewTitle: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5},
  previewBox: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 14},
  previewText: {
    fontSize: 12,
    color: Colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18},
  logSection: {
    gap: 12},
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.text},
  filterRow: {
    flexDirection: "row" as const,
    marginBottom: 4},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary + "20",
    borderColor: Colors.primary + "60"},
  filterText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "500" as const},
  filterTextActive: {
    color: Colors.primary,
    fontWeight: "600" as const},
  emptyLog: {
    alignItems: "center" as const,
    paddingVertical: 32,
    gap: 8},
  emptyText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.textSecondary},
  emptySubtext: {
    fontSize: 12,
    color: Colors.textTertiary},
  logItem: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  logItemHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const},
  logTypeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1},
  logTypeText: {
    fontSize: 11,
    fontWeight: "600" as const},
  logStatusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6},
  logTime: {
    fontSize: 11,
    color: Colors.textSecondary},
  logPreview: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace"},
  logError: {
    fontSize: 11,
    color: Colors.error,
    fontStyle: "italic" as const},
  pagination: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 16,
    paddingVertical: 8},
  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  pageBtnDisabled: {
    opacity: 0.4},
  pageBtnText: {
    fontSize: 12,
    color: Colors.text,
    fontWeight: "500" as const},
  pageInfo: {
    fontSize: 12,
    color: Colors.textSecondary},
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  infoTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.text,
    marginBottom: 4},
  infoRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10},
  infoText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 17},
  teamCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.accent + "30",
    gap: 14},
  teamHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8},
  teamTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.text,
    flex: 1},
  teamBadge: {
    backgroundColor: Colors.success + "18",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.success + "40"},
  teamBadgeText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.success},
  teamMember: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    padding: 12},
  teamAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 2},
  teamInfo: {
    flex: 1,
    gap: 3},
  teamNameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8},
  teamName: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.text},
  teamRoleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1},
  teamRoleText: {
    fontSize: 10,
    fontWeight: "600" as const},
  teamPhoneRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4},
  teamPhone: {
    fontSize: 12,
    color: Colors.textTertiary},
  teamAlertRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 4,
    marginTop: 2},
  alertTypeDot: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6},
  alertTypeDotText: {
    fontSize: 9,
    fontWeight: "600" as const},
  teamStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  teamFooter: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  teamFooterText: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16,
    textAlign: "center" as const},
  smartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#00C9A730",
    gap: 14},
  smartHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const},
  smartHeaderLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8},
  smartTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.text},
  smartModeBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1},
  smartModeDot: {
    width: 7,
    height: 7,
    borderRadius: 4},
  smartModeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.5},
  smartDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17},
  smartScheduleInfo: {
    gap: 6,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 12},
  smartInfoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8},
  smartInfoText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1},
  smartRecentSection: {
    gap: 8},
  smartRecentTitle: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5},
  smartRecentItem: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 10,
    gap: 4},
  smartRecentHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const},
  smartRecentRecipient: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#00C9A7"},
  smartRecentTime: {
    fontSize: 10,
    color: Colors.textTertiary},
  smartRecentMsg: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16},
  smartActions: {
    gap: 8},
  smartStartBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: "#00C9A7",
    paddingVertical: 12,
    borderRadius: 12},
  smartStartText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#FFF"},
  smartRunningActions: {
    flexDirection: "row" as const,
    gap: 8},
  smartSendNowBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#00C9A760",
    backgroundColor: "#00C9A715"},
  smartSendNowText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#00C9A7"},
  smartStopBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.error + "60",
    backgroundColor: Colors.error + "15"},
  smartStopText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.error},
  snsWarningCard: {
    backgroundColor: "#FFB80008",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FFB80030",
    marginBottom: 12},
  snsWarningRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 8},
  snsWarningTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#FFB800"},
  snsWarningText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18},
  snsWarningCount: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#FFB800",
    marginTop: 8}});
