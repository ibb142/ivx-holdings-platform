import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  ArrowLeft,
  RefreshCw,
  Smartphone,
  Globe,
  Database,
  Shield,
  Radio,
  Cloud,
  HardDrive,
  Lock,
  Zap,
  Bell,
  Mail,
  Layers,
  Activity,
  Eye,
  ArrowRight,
  Bot,
  MessageCircle,
  Radar} from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import {
  runFullHealthCheck,
  type SystemHealthSnapshot,
  type HealthCheck,
  type HealthStatus} from '@/lib/system-health-checker';
import { runAIOpsScan, type AIOpsOverallStatus, type AIOpsSeverity, type AIOpsSnapshot } from '@/lib/ai-ops';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getOwnerAlertFeed,
  getOwnerAlertSettings,
  openOwnerAlertWhatsApp,
  sendOwnerAlertEmail,
  syncAIOpsOwnerAlerts,
  type OwnerAlertDispatchResult,
  type OwnerAlertFeedItem,
  type OwnerAlertSettings} from '@/lib/ai-ops-alerts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NODE_SIZE = 72;
const ICON_SIZE = 28;
const BLUEPRINT_AUTO_REFRESH_INTERVAL_MS = 180_000;

interface BlueprintNode {
  id: string;
  label: string;
  shortLabel: string;
  icon: typeof Activity;
  tier: number;
  col: number;
  category: string;
}

const BLUEPRINT_NODES: BlueprintNode[] = [
  { id: 'app-frontend', label: 'Mobile App (Expo)', shortLabel: 'Mobile App', icon: Smartphone, tier: 0, col: 0, category: 'frontend' },
  { id: 'landing-page', label: 'Landing Page', shortLabel: 'Landing', icon: Globe, tier: 0, col: 1, category: 'frontend' },

  { id: 'expo-router', label: 'Expo Router', shortLabel: 'Router', icon: Layers, tier: 1, col: 0, category: 'frontend' },
  { id: 'react-query', label: 'React Query', shortLabel: 'RQ Cache', icon: Zap, tier: 1, col: 1, category: 'services' },

  { id: 'supabase-auth', label: 'Supabase Auth', shortLabel: 'Auth', icon: Lock, tier: 2, col: 0, category: 'backend' },
  { id: 'supabase-realtime', label: 'Realtime WS', shortLabel: 'Realtime', icon: Radio, tier: 2, col: 1, category: 'realtime' },

  { id: 'supabase-db', label: 'Supabase PostgreSQL', shortLabel: 'Database', icon: Database, tier: 3, col: 0, category: 'database' },
  { id: 'supabase-rls', label: 'Row Level Security', shortLabel: 'RLS', icon: Shield, tier: 3, col: 1, category: 'database' },

  { id: 'aws-infra', label: 'AWS S3 / CloudFront', shortLabel: 'AWS S3', icon: Cloud, tier: 4, col: 0, category: 'infrastructure' },
  { id: 'secure-store', label: 'Secure Store', shortLabel: 'SecureStore', icon: HardDrive, tier: 4, col: 1, category: 'infrastructure' },

  { id: 'email-service', label: 'Email Engine', shortLabel: 'Email', icon: Mail, tier: 5, col: 0, category: 'services' },
  { id: 'push-notifications', label: 'Push Notifications', shortLabel: 'Push', icon: Bell, tier: 5, col: 1, category: 'services' },
];

interface Connection {
  fromId: string;
  toId: string;
  label: string;
}

const CONNECTIONS: Connection[] = [
  { fromId: 'app-frontend', toId: 'expo-router', label: 'Routes' },
  { fromId: 'app-frontend', toId: 'react-query', label: 'State' },
  { fromId: 'expo-router', toId: 'supabase-auth', label: 'JWT' },
  { fromId: 'react-query', toId: 'supabase-db', label: 'Query' },
  { fromId: 'react-query', toId: 'supabase-realtime', label: 'Subscribe' },
  { fromId: 'supabase-auth', toId: 'supabase-db', label: 'Validate' },
  { fromId: 'supabase-auth', toId: 'secure-store', label: 'Token' },
  { fromId: 'supabase-db', toId: 'supabase-rls', label: 'Policies' },
  { fromId: 'supabase-db', toId: 'supabase-realtime', label: 'Pub/Sub' },
  { fromId: 'landing-page', toId: 'supabase-db', label: 'Fetch' },
  { fromId: 'landing-page', toId: 'supabase-realtime', label: 'Live Sync' },
  { fromId: 'app-frontend', toId: 'aws-infra', label: 'Deploy' },
  { fromId: 'supabase-db', toId: 'email-service', label: 'Edge Fn' },
  { fromId: 'app-frontend', toId: 'push-notifications', label: 'Expo Push' },
];

const STATUS_GLOW: Record<HealthStatus, string> = {
  green: '#00E676',
  yellow: '#FFD600',
  red: '#FF1744'};

const STATUS_BG: Record<HealthStatus, string> = {
  green: 'rgba(0, 230, 118, 0.08)',
  yellow: 'rgba(255, 214, 0, 0.08)',
  red: 'rgba(255, 23, 68, 0.12)'};

const STATUS_BORDER: Record<HealthStatus, string> = {
  green: 'rgba(0, 230, 118, 0.35)',
  yellow: 'rgba(255, 214, 0, 0.35)',
  red: 'rgba(255, 23, 68, 0.5)'};

const TIER_LABELS = ['Client Layer', 'Routing & Cache', 'Authentication', 'Data Layer', 'Infrastructure', 'Services'];

function getAIOpsToneColor(tone: AIOpsOverallStatus | AIOpsSeverity): string {
  if (tone === 'critical') {
    return '#FF1744';
  }
  if (tone === 'degraded' || tone === 'warning') {
    return '#FFD600';
  }
  return '#00E676';
}

function getAIOpsToneLabel(tone: AIOpsOverallStatus | AIOpsSeverity): string {
  if (tone === 'critical') {
    return 'Critical';
  }
  if (tone === 'degraded' || tone === 'warning') {
    return 'Degraded';
  }
  return 'Healthy';
}

function formatOwnerAlertTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return 'Not sent yet';
  }

  return new Date(timestamp).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'});
}

function getNodePosition(node: BlueprintNode, containerWidth: number) {
  const padding = 24;
  const usableWidth = containerWidth - padding * 2;
  const colWidth = usableWidth / 2;
  const tierHeight = 130;
  const topOffset = 20;

  const x = padding + node.col * colWidth + colWidth / 2;
  const y = topOffset + node.tier * tierHeight + NODE_SIZE / 2;
  return { x, y };
}

function PulseRing({ status, size }: { status: HealthStatus; size: number }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: status === 'red' ? 800 : 2000, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulseAnim, { toValue: 0, duration: status === 'red' ? 800 : 2000, useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulseAnim]);

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, status === 'red' ? 1.6 : 1.3]});

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [status === 'red' ? 0.5 : 0.3, 0]});

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: STATUS_GLOW[status],
          transform: [{ scale }],
          opacity},
      ]}
    />
  );
}

function DataFlowDot({ status }: { status: HealthStatus }) {
  const flowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === 'red') return;
    const loop = Animated.loop(
      Animated.timing(flowAnim, {
        toValue: 1,
        duration: 2500,
        useNativeDriver: Platform.OS !== 'web'})
    );
    loop.start();
    return () => loop.stop();
  }, [status, flowAnim]);

  const translateY = flowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 20]});

  const dotOpacity = flowAnim.interpolate({
    inputRange: [0, 0.3, 0.7, 1],
    outputRange: [0, 1, 1, 0]});

  if (status === 'red') return null;

  return (
    <Animated.View
      style={[
        styles.flowDot,
        {
          backgroundColor: STATUS_GLOW[status],
          transform: [{ translateY }],
          opacity: dotOpacity},
      ]}
    />
  );
}

function BlueprintNodeView({
  node,
  healthCheck,
  onPress,
  containerWidth}: {
  node: BlueprintNode;
  healthCheck?: HealthCheck;
  onPress: () => void;
  containerWidth: number;
}) {
  const status: HealthStatus = healthCheck?.status || 'yellow';
  const pos = getNodePosition(node, containerWidth);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === 'red') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      Animated.timing(glowAnim, { toValue: 0.6, duration: 500, useNativeDriver: Platform.OS !== 'web' }).start();
    }
  }, [status, glowAnim]);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.92, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [scaleAnim]);

  const IconComponent = node.icon;
  const latencyText = healthCheck?.latency ? `${healthCheck.latency}ms` : '';

  return (
    <Animated.View
      style={[
        styles.nodeWrapper,
        {
          left: pos.x - NODE_SIZE / 2,
          top: pos.y - NODE_SIZE / 2,
          transform: [{ scale: scaleAnim }]},
      ]}
    >
      <PulseRing status={status} size={NODE_SIZE + 20} />
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
        style={[
          styles.nodeContainer,
          {
            backgroundColor: STATUS_BG[status],
            borderColor: STATUS_BORDER[status]},
        ]}
      >
        <View style={[styles.nodeIconBg, { backgroundColor: `${STATUS_GLOW[status]}20` }]}>
          <IconComponent size={ICON_SIZE} color={STATUS_GLOW[status]} />
        </View>
        <View style={[styles.statusDotSmall, { backgroundColor: STATUS_GLOW[status] }]} />
      </TouchableOpacity>
      <Text style={styles.nodeLabel} numberOfLines={1}>{node.shortLabel}</Text>
      {latencyText ? (
        <Text style={[styles.nodeLatency, { color: STATUS_GLOW[status] }]}>{latencyText}</Text>
      ) : null}
    </Animated.View>
  );
}

function ConnectionLine({
  fromNode,
  toNode,
  connection,
  healthMap,
  containerWidth}: {
  fromNode: BlueprintNode;
  toNode: BlueprintNode;
  connection: Connection;
  healthMap: Map<string, HealthCheck>;
  containerWidth: number;
}) {
  const fromPos = getNodePosition(fromNode, containerWidth);
  const toPos = getNodePosition(toNode, containerWidth);

  const fromCheck = healthMap.get(connection.fromId);
  const toCheck = healthMap.get(connection.toId);
  const lineStatus: HealthStatus =
    fromCheck?.status === 'red' || toCheck?.status === 'red'
      ? 'red'
      : fromCheck?.status === 'yellow' || toCheck?.status === 'yellow'
      ? 'yellow'
      : 'green';

  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const midX = (fromPos.x + toPos.x) / 2;
  const midY = (fromPos.y + toPos.y) / 2;

  return (
    <View style={styles.connectionContainer}>
      <View
        style={[
          styles.connectionLine,
          {
            left: fromPos.x,
            top: fromPos.y,
            width: length,
            backgroundColor: lineStatus === 'red' ? 'rgba(255, 23, 68, 0.4)' : lineStatus === 'yellow' ? 'rgba(255, 214, 0, 0.2)' : 'rgba(0, 230, 118, 0.15)',
            transform: [{ rotate: `${angle}deg` }]},
        ]}
      >
        {lineStatus !== 'red' && <DataFlowDot status={lineStatus} />}
      </View>
      {lineStatus === 'red' && (
        <View
          style={[
            styles.connectionLine,
            styles.connectionLineDashed,
            {
              left: fromPos.x,
              top: fromPos.y,
              width: length,
              borderColor: 'rgba(255, 23, 68, 0.6)',
              transform: [{ rotate: `${angle}deg` }]},
          ]}
        />
      )}
      <View
        style={[
          styles.connectionLabelContainer,
          {
            left: midX - 30,
            top: midY - 8},
        ]}
      >
        <Text style={[styles.connectionLabelText, { color: STATUS_GLOW[lineStatus] }]} numberOfLines={1}>
          {connection.label}
        </Text>
      </View>
    </View>
  );
}

function NodeDetailPanel({ check, onClose }: { check: HealthCheck; onClose: () => void }) {
  const slideAnim = useRef(new Animated.Value(200)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: Platform.OS !== 'web', damping: 20 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, [slideAnim, opacityAnim]);

  const statusLabel = check.status === 'green' ? 'OPERATIONAL' : check.status === 'yellow' ? 'DEGRADED' : 'CRITICAL';

  return (
    <Animated.View style={[styles.detailPanel, { transform: [{ translateY: slideAnim }], opacity: opacityAnim }]}>
      <View style={styles.detailHeader}>
        <View style={[styles.detailStatusBadge, { backgroundColor: `${STATUS_GLOW[check.status]}20`, borderColor: STATUS_GLOW[check.status] }]}>
          <View style={[styles.detailStatusDot, { backgroundColor: STATUS_GLOW[check.status] }]} />
          <Text style={[styles.detailStatusText, { color: STATUS_GLOW[check.status] }]}>{statusLabel}</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.detailClose}>
          <Text style={styles.detailCloseText}>×</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.detailName}>{check.name}</Text>
      <Text style={styles.detailMessage}>{check.message}</Text>

      <View style={styles.detailGrid}>
        <View style={styles.detailGridItem}>
          <Text style={styles.detailGridLabel}>Latency</Text>
          <Text style={[styles.detailGridValue, { color: STATUS_GLOW[check.status] }]}>
            {check.latency ? `${check.latency}ms` : '—'}
          </Text>
        </View>
        <View style={styles.detailGridItem}>
          <Text style={styles.detailGridLabel}>Category</Text>
          <Text style={styles.detailGridValue}>{check.category}</Text>
        </View>
        {check.port ? (
          <View style={styles.detailGridItem}>
            <Text style={styles.detailGridLabel}>Port</Text>
            <Text style={styles.detailGridValue}>{check.port}</Text>
          </View>
        ) : null}
        {check.endpoint ? (
          <View style={[styles.detailGridItem, { flex: 2 }]}>
            <Text style={styles.detailGridLabel}>Endpoint</Text>
            <Text style={styles.detailGridValue} numberOfLines={1}>{check.endpoint}</Text>
          </View>
        ) : null}
      </View>

      {check.details ? (
        <View style={styles.detailExtra}>
          <Text style={styles.detailExtraText}>{check.details}</Text>
        </View>
      ) : null}

      <Text style={styles.detailTimestamp}>
        Last checked: {check.lastChecked.toLocaleTimeString()}
      </Text>
    </Animated.View>
  );
}

function OverallStatusBar({ snapshot }: { snapshot: SystemHealthSnapshot | null }) {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!snapshot || snapshot.overallStatus === 'green') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [snapshot, pulseAnim]);

  if (!snapshot) return null;

  const overallColor = STATUS_GLOW[snapshot.overallStatus];
  const overallLabel = snapshot.overallStatus === 'green' ? 'ALL SYSTEMS OPERATIONAL' : snapshot.overallStatus === 'yellow' ? 'PARTIAL DEGRADATION' : 'CRITICAL ISSUES DETECTED';

  return (
    <Animated.View style={[styles.overallBar, { borderColor: overallColor, opacity: snapshot.overallStatus === 'green' ? 1 : pulseAnim }]}>
      <View style={styles.overallBarInner}>
        <View style={[styles.overallDot, { backgroundColor: overallColor }]} />
        <Text style={[styles.overallLabel, { color: overallColor }]}>{overallLabel}</Text>
      </View>
      <View style={styles.overallStats}>
        <View style={styles.overallStatItem}>
          <View style={[styles.miniDot, { backgroundColor: '#00E676' }]} />
          <Text style={styles.overallStatText}>{snapshot.totalGreen}</Text>
        </View>
        <View style={styles.overallStatItem}>
          <View style={[styles.miniDot, { backgroundColor: '#FFD600' }]} />
          <Text style={styles.overallStatText}>{snapshot.totalYellow}</Text>
        </View>
        <View style={styles.overallStatItem}>
          <View style={[styles.miniDot, { backgroundColor: '#FF1744' }]} />
          <Text style={styles.overallStatText}>{snapshot.totalRed}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

function OwnerAlertHub({
  settings,
  snapshot,
  lastDispatch,
  emailPending,
  whatsappPending,
  onSendEmail,
  onOpenWhatsApp,
  onOpenAutoRepair}: {
  settings: OwnerAlertSettings | null;
  snapshot: AIOpsSnapshot | null;
  lastDispatch: OwnerAlertDispatchResult | null;
  emailPending: boolean;
  whatsappPending: boolean;
  onSendEmail: () => void;
  onOpenWhatsApp: () => void;
  onOpenAutoRepair: () => void;
}) {
  if (!settings || !snapshot) {
    return null;
  }

  const toneColor = getAIOpsToneColor(snapshot.overallStatus);
  const incidentCount = snapshot.incidents.length;
  const hasActiveIssues = incidentCount > 0;
  const lastDispatchTone = lastDispatch ? getAIOpsToneColor(lastDispatch.status === 'sent' || lastDispatch.status === 'opened' ? 'healthy' : 'warning') : toneColor;

  return (
    <View style={styles.ownerAlertsCard} testID="owner-alert-hub">
      <View style={styles.ownerAlertsHeader}>
        <View style={[styles.ownerAlertsBadge, { backgroundColor: `${toneColor}18`, borderColor: `${toneColor}33` }]}>
          <Bot size={16} color={toneColor} />
          <Text style={[styles.ownerAlertsBadgeText, { color: toneColor }]}>{getAIOpsToneLabel(snapshot.overallStatus)}</Text>
        </View>
        <Text style={[styles.ownerAlertsCount, { color: toneColor }]}>{incidentCount} alert{incidentCount === 1 ? '' : 's'}</Text>
      </View>

      <Text style={styles.ownerAlertsTitle}>Owner alert routing</Text>
      <Text style={styles.ownerAlertsBody}>
        {hasActiveIssues
          ? 'AI Ops is ready to notify the owner immediately with the current incident summary and the next safe action.'
          : 'No active AI Ops incidents right now. Email and WhatsApp routing is armed for the next failure.'}
      </Text>

      <View style={styles.ownerContactRow}>
        <Mail size={15} color={Colors.primary} />
        <Text style={styles.ownerContactText}>{settings.ownerEmail}</Text>
      </View>
      <View style={styles.ownerContactRow}>
        <MessageCircle size={15} color="#25D366" />
        <Text style={styles.ownerContactText}>{settings.ownerPhone}</Text>
      </View>

      <View style={styles.ownerChipRow}>
        <View style={[styles.ownerChip, { backgroundColor: settings.enableEmail ? 'rgba(0, 230, 118, 0.12)' : 'rgba(255,255,255,0.06)' }]}>
          <Text style={[styles.ownerChipText, { color: settings.enableEmail ? '#00E676' : Colors.textSecondary }]}>Email {settings.enableEmail ? 'ON' : 'OFF'}</Text>
        </View>
        <View style={[styles.ownerChip, { backgroundColor: settings.enableWhatsApp ? 'rgba(37, 211, 102, 0.12)' : 'rgba(255,255,255,0.06)' }]}>
          <Text style={[styles.ownerChipText, { color: settings.enableWhatsApp ? '#25D366' : Colors.textSecondary }]}>WhatsApp {settings.enableWhatsApp ? 'ON' : 'OFF'}</Text>
        </View>
        <View style={styles.ownerChip}>
          <Text style={styles.ownerChipText}>Cooldown {settings.cooldownMinutes}m</Text>
        </View>
      </View>

      <View style={styles.ownerActionRow}>
        <TouchableOpacity
          style={[styles.ownerPrimaryAction, (!hasActiveIssues || emailPending) && styles.ownerDisabledAction]}
          onPress={onSendEmail}
          disabled={!hasActiveIssues || emailPending}
          activeOpacity={0.85}
          testID="owner-alert-send-email"
        >
          {emailPending ? <ShimmerIndicator size="small" color={Colors.black} /> : <Mail size={16} color={Colors.black} />}
          <Text style={styles.ownerPrimaryActionText}>{emailPending ? 'Sending...' : 'Send email'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ownerSecondaryAction, (!hasActiveIssues || whatsappPending) && styles.ownerDisabledAction]}
          onPress={onOpenWhatsApp}
          disabled={!hasActiveIssues || whatsappPending}
          activeOpacity={0.85}
          testID="owner-alert-open-whatsapp"
        >
          {whatsappPending ? <ShimmerIndicator size="small" color={Colors.text} /> : <MessageCircle size={16} color="#25D366" />}
          <Text style={styles.ownerSecondaryActionText}>{whatsappPending ? 'Opening...' : 'WhatsApp'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ownerSecondaryAction}
          onPress={onOpenAutoRepair}
          activeOpacity={0.85}
          testID="owner-alert-open-auto-repair"
        >
          <Zap size={16} color={Colors.text} />
          <Text style={styles.ownerSecondaryActionText}>Auto Repair</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.ownerDispatchRow, { borderColor: `${lastDispatchTone}22` }]}>
        <Bell size={14} color={lastDispatchTone} />
        <Text style={styles.ownerDispatchText}>
          {lastDispatch
            ? `${lastDispatch.channel === 'email' ? 'Email' : 'WhatsApp'} ${lastDispatch.status} · ${lastDispatch.detail}`
            : 'No owner alert has been manually triggered in this session.'}
        </Text>
      </View>
    </View>
  );
}

function OwnerAlertFeedCard({ feed }: { feed: OwnerAlertFeedItem[] }) {
  if (feed.length === 0) {
    return null;
  }

  return (
    <View style={styles.ownerFeedSection} testID="owner-alert-feed">
      <View style={styles.ownerFeedHeader}>
        <Bell size={15} color={Colors.primary} />
        <Text style={styles.ownerFeedTitle}>Owner alert feed</Text>
      </View>
      {feed.slice(0, 4).map((item) => {
        const toneColor = getAIOpsToneColor(item.severity);
        return (
          <View key={item.id} style={[styles.ownerFeedItem, { borderColor: `${toneColor}20` }]}>
            <View style={styles.ownerFeedTopRow}>
              <View style={[styles.ownerFeedDot, { backgroundColor: toneColor }]} />
              <Text style={styles.ownerFeedItemTitle}>{item.title}</Text>
              <Text style={[styles.ownerFeedItemStatus, { color: toneColor }]}>{getAIOpsToneLabel(item.severity)}</Text>
            </View>
            <Text style={styles.ownerFeedItemSummary}>{item.summary}</Text>
            <Text style={styles.ownerFeedItemMeta}>
              {item.lastChannel ? `${item.lastChannel} · ${item.lastDeliveryStatus ?? 'pending'}` : 'Awaiting owner delivery'} · {formatOwnerAlertTimestamp(item.lastNotifiedAt)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function OwnerEscalationLanes({
  settings,
  snapshot,
  lastDispatch}: {
  settings: OwnerAlertSettings | null;
  snapshot: AIOpsSnapshot | null;
  lastDispatch: OwnerAlertDispatchResult | null;
}) {
  if (!settings || !snapshot) {
    return null;
  }

  const hasActiveIssues = snapshot.incidents.length > 0;
  const autoRepairCount = snapshot.incidents.filter((incident) => incident.autoRepairEligible).length;

  const lanes: {
    id: string;
    title: string;
    description: string;
    target: string;
    statusLabel: string;
    toneColor: string;
    Icon: typeof Mail;
  }[] = [
    {
      id: 'email',
      title: 'Auto email dispatch',
      description:
        lastDispatch?.channel === 'email'
          ? lastDispatch.detail
          : hasActiveIssues
            ? 'The owner email lane can send the active AI Ops incident summary right now.'
            : 'Email dispatch is armed and will attach the next incident summary automatically.',
      target: settings.ownerEmail,
      statusLabel: !settings.enableEmail ? 'Disabled' : lastDispatch?.channel === 'email' ? lastDispatch.status : hasActiveIssues ? 'Ready' : 'Armed',
      toneColor: !settings.enableEmail
        ? Colors.textTertiary
        : lastDispatch?.channel === 'email'
          ? getAIOpsToneColor(lastDispatch.status === 'sent' || lastDispatch.status === 'opened' ? 'healthy' : 'warning')
          : hasActiveIssues
            ? Colors.primary
            : '#00E676',
      Icon: Mail},
    {
      id: 'whatsapp',
      title: 'WhatsApp escalation',
      description:
        lastDispatch?.channel === 'whatsapp'
          ? lastDispatch.detail
          : hasActiveIssues
            ? 'Open a prefilled owner WhatsApp handoff with the same incident summary and next safe actions.'
            : 'WhatsApp escalation stays on standby until a live incident needs owner attention.',
      target: settings.ownerPhone,
      statusLabel: !settings.enableWhatsApp ? 'Disabled' : lastDispatch?.channel === 'whatsapp' ? lastDispatch.status : hasActiveIssues ? 'Standby' : 'Armed',
      toneColor: !settings.enableWhatsApp
        ? Colors.textTertiary
        : lastDispatch?.channel === 'whatsapp'
          ? '#25D366'
          : hasActiveIssues
            ? '#25D366'
            : 'rgba(37, 211, 102, 0.9)',
      Icon: MessageCircle},
    {
      id: 'repair',
      title: 'Repair console handoff',
      description:
        autoRepairCount > 0
          ? `${autoRepairCount} incident${autoRepairCount === 1 ? '' : 's'} can go straight into safe repair actions from this screen.`
          : 'No auto-repair-safe incident is open right now. The console stays ready for the next scan.',
      target: 'Auto Repair control room',
      statusLabel: autoRepairCount > 0 ? `${autoRepairCount} safe path${autoRepairCount === 1 ? '' : 's'}` : 'Standby',
      toneColor: autoRepairCount > 0 ? Colors.primary : Colors.textSecondary,
      Icon: Zap},
  ];

  return (
    <View style={styles.ownerLaneSection} testID="owner-alert-lanes">
      <View style={styles.ownerLaneHeader}>
        <Bot size={15} color={Colors.primary} />
        <Text style={styles.ownerLaneTitle}>Escalation lanes</Text>
      </View>
      <Text style={styles.ownerLaneSubtitle}>Live routing from AI Ops scan → owner notification → repair handoff.</Text>

      {lanes.map((lane) => {
        const LaneIcon = lane.Icon;
        return (
          <View key={lane.id} style={[styles.ownerLaneCard, { borderColor: `${lane.toneColor}22` }]}>
            <View style={[styles.ownerLaneIconWrap, { backgroundColor: `${lane.toneColor}18` }]}>
              <LaneIcon size={16} color={lane.toneColor} />
            </View>
            <View style={styles.ownerLaneContent}>
              <View style={styles.ownerLaneTopRow}>
                <Text style={styles.ownerLaneCardTitle}>{lane.title}</Text>
                <View style={[styles.ownerLaneStatusPill, { backgroundColor: `${lane.toneColor}18` }]}>
                  <Text style={[styles.ownerLaneStatusText, { color: lane.toneColor }]}>{lane.statusLabel}</Text>
                </View>
              </View>
              <Text style={styles.ownerLaneTarget}>{lane.target}</Text>
              <Text style={styles.ownerLaneDescription}>{lane.description}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function SystemBlueprintScreen() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState<HealthCheck | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const scanInFlightRef = useRef(false);
  const containerWidth = Math.min(SCREEN_WIDTH, 500);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [aiOpsSnapshot, setAIOpsSnapshot] = useState<AIOpsSnapshot | null>(null);
  const [ownerAlertSettings, setOwnerAlertSettings] = useState<OwnerAlertSettings | null>(null);
  const [ownerAlertFeed, setOwnerAlertFeed] = useState<OwnerAlertFeedItem[]>([]);
  const [lastOwnerDispatch, setLastOwnerDispatch] = useState<OwnerAlertDispatchResult | null>(null);
  const isScreenFocused = useScreenFocusState(true);

  const healthMap = useMemo(() => {
    const map = new Map<string, HealthCheck>();
    if (snapshot) {
      snapshot.checks.forEach((c) => map.set(c.id, c));
    }
    return map;
  }, [snapshot]);

  const loadOwnerAlertState = useCallback(async () => {
    try {
      const [settings, feed] = await Promise.all([
        getOwnerAlertSettings(),
        getOwnerAlertFeed(),
      ]);
      setOwnerAlertSettings(settings);
      setOwnerAlertFeed(feed);
    } catch (error) {
      console.log('[Blueprint] Owner alert state load error:', (error as Error)?.message ?? 'unknown');
    }
  }, []);

  const emailAlertMutation = useMutation({
    mutationFn: async () => {
      if (!aiOpsSnapshot || aiOpsSnapshot.incidents.length === 0) {
        throw new Error('No active AI Ops incidents are available for email alerts.');
      }
      return sendOwnerAlertEmail(aiOpsSnapshot);
    },
    onSuccess: async (result) => {
      setLastOwnerDispatch(result);
      await loadOwnerAlertState();
      Alert.alert('Owner email alert', result.detail);
    },
    onError: (error: Error) => {
      Alert.alert('Owner email alert failed', error.message);
    }});

  const whatsappAlertMutation = useMutation({
    mutationFn: async () => {
      if (!aiOpsSnapshot || aiOpsSnapshot.incidents.length === 0) {
        throw new Error('No active AI Ops incidents are available for WhatsApp alerts.');
      }
      return openOwnerAlertWhatsApp(aiOpsSnapshot);
    },
    onSuccess: async (result) => {
      setLastOwnerDispatch(result);
      await loadOwnerAlertState();
      Alert.alert('Owner WhatsApp alert', result.detail);
    },
    onError: (error: Error) => {
      Alert.alert('Owner WhatsApp alert failed', error.message);
    }});

  const runScan = useCallback(async (force: boolean = false) => {
    if (scanInFlightRef.current) {
      console.log('[Blueprint] Scan skipped because another scan is still running');
      return;
    }

    scanInFlightRef.current = true;
    setLoading(true);
    spinLoopRef.current?.stop();
    spinAnim.setValue(0);
    spinLoopRef.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1000, useNativeDriver: Platform.OS !== 'web' })
    );
    spinLoopRef.current.start();

    try {
      console.log('[Blueprint] Running system and AI Ops scan...', force ? '(forced)' : '(cached mode)');
      const systemSnapshot = await runFullHealthCheck({ force });
      const aiOpsResult = await runAIOpsScan({ force, fullHealthSnapshot: systemSnapshot });
      const alertSyncResult = await syncAIOpsOwnerAlerts(aiOpsResult);
      setSnapshot(systemSnapshot);
      setAIOpsSnapshot(aiOpsResult);
      setOwnerAlertSettings(alertSyncResult.settings);
      setOwnerAlertFeed(alertSyncResult.feed);
      if (alertSyncResult.dispatched) {
        setLastOwnerDispatch(alertSyncResult.dispatched);
      }
      setLastRefresh(new Date());
      console.log('[Blueprint] Scan complete:', systemSnapshot.overallStatus, '| AI Ops:', aiOpsResult.overallStatus, '| incidents:', aiOpsResult.incidents.length);
    } catch (err) {
      console.log('[Blueprint] Scan error:', (err as Error)?.message);
      await loadOwnerAlertState();
    } finally {
      scanInFlightRef.current = false;
      spinLoopRef.current?.stop();
      spinLoopRef.current = null;
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      setLoading(false);
    }
  }, [loadOwnerAlertState, spinAnim]);

  useEffect(() => {
    if (!isScreenFocused) {
      console.log('[Blueprint] Screen blurred — pausing scan bootstrap');
      return;
    }

    void loadOwnerAlertState();
    void runScan();
  }, [isScreenFocused, loadOwnerAlertState, runScan]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (autoRefresh && isScreenFocused) {
      intervalRef.current = setInterval(() => {
        void runScan();
      }, BLUEPRINT_AUTO_REFRESH_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      spinLoopRef.current?.stop();
      spinLoopRef.current = null;
    };
  }, [autoRefresh, isScreenFocused, runScan]);

  const spinRotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']});

  const diagramHeight = BLUEPRINT_NODES.reduce((max, n) => Math.max(max, n.tier), 0) * 130 + 160;

  const nodeMap = useMemo(() => {
    const m = new Map<string, BlueprintNode>();
    BLUEPRINT_NODES.forEach((n) => m.set(n.id, n));
    return m;
  }, []);

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Activity size={18} color="#00E676" />
            <Text style={styles.headerTitle}>System Blueprint</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => setAutoRefresh(!autoRefresh)}
              style={[styles.autoRefreshBtn, autoRefresh && styles.autoRefreshActive]}
            >
              <Eye size={14} color={autoRefresh ? '#00E676' : Colors.textSecondary} />
              <Text style={[styles.autoRefreshText, autoRefresh && { color: '#00E676' }]}>LIVE</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void runScan(true)} disabled={loading} style={styles.refreshBtn}>
              <Animated.View style={{ transform: [{ rotate: loading ? spinRotation : '0deg' }] }}>
                <RefreshCw size={18} color={loading ? '#FFD600' : Colors.text} />
              </Animated.View>
            </TouchableOpacity>
          </View>
        </View>

        <OverallStatusBar snapshot={snapshot} />

        <TouchableOpacity
          style={styles.trafficLaunchCard}
          onPress={() => router.push({ pathname: '/admin/control-tower', params: { tab: 'traffic' } })}
          activeOpacity={0.86}
          testID="blueprint-open-traffic"
        >
          <View style={styles.trafficLaunchIconWrap}>
            <Radar size={18} color="#4FC3F7" />
          </View>
          <View style={styles.trafficLaunchContent}>
            <Text style={styles.trafficLaunchEyebrow}>LIVE TRAFFIC INTEL</Text>
            <Text style={styles.trafficLaunchTitle}>Open Control Tower Traffic</Text>
            <Text style={styles.trafficLaunchBody}>This screen is the architecture map. The new world-origin traffic view lives in Nerve Center.</Text>
          </View>
          <ArrowRight size={16} color="#4FC3F7" />
        </TouchableOpacity>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <OwnerAlertHub
            settings={ownerAlertSettings}
            snapshot={aiOpsSnapshot}
            lastDispatch={lastOwnerDispatch}
            emailPending={emailAlertMutation.isPending}
            whatsappPending={whatsappAlertMutation.isPending}
            onSendEmail={() => emailAlertMutation.mutate()}
            onOpenWhatsApp={() => whatsappAlertMutation.mutate()}
            onOpenAutoRepair={() => router.push('/auto-repair' as any)}
          />

          <OwnerAlertFeedCard feed={ownerAlertFeed} />
          <OwnerEscalationLanes
            settings={ownerAlertSettings}
            snapshot={aiOpsSnapshot}
            lastDispatch={lastOwnerDispatch}
          />

          <View style={styles.diagramTitle}>
            <Text style={styles.diagramTitleText}>3D Architecture Map</Text>
            <Text style={styles.diagramSubtitle}>
              {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Scanning...'}
            </Text>
          </View>

          <View
            style={[
              styles.diagramContainer,
              {
                width: containerWidth,
                height: diagramHeight,
                transform: [
                  { perspective: 1200 },
                  { rotateX: '8deg' },
                ]},
            ]}
          >
            <View style={styles.gridOverlay}>
              {Array.from({ length: 20 }).map((_, i) => (
                <View
                  key={`hline-${i}`}
                  style={[
                    styles.gridLine,
                    styles.gridLineH,
                    { top: i * (diagramHeight / 20) },
                  ]}
                />
              ))}
              {Array.from({ length: 10 }).map((_, i) => (
                <View
                  key={`vline-${i}`}
                  style={[
                    styles.gridLine,
                    styles.gridLineV,
                    { left: i * (containerWidth / 10) },
                  ]}
                />
              ))}
            </View>

            {TIER_LABELS.map((label, idx) => (
              <View key={`tier-${idx}`} style={[styles.tierLabel, { top: 20 + idx * 130 - 14 }]}>
                <View style={styles.tierLabelLine} />
                <Text style={styles.tierLabelText}>{label}</Text>
              </View>
            ))}

            {CONNECTIONS.map((conn, idx) => {
              const fromNode = nodeMap.get(conn.fromId);
              const toNode = nodeMap.get(conn.toId);
              if (!fromNode || !toNode) return null;
              return (
                <ConnectionLine
                  key={`conn-${idx}`}
                  fromNode={fromNode}
                  toNode={toNode}
                  connection={conn}
                  healthMap={healthMap}
                  containerWidth={containerWidth}
                />
              );
            })}

            {BLUEPRINT_NODES.map((node) => (
              <BlueprintNodeView
                key={node.id}
                node={node}
                healthCheck={healthMap.get(node.id)}
                containerWidth={containerWidth}
                onPress={() => {
                  const check = healthMap.get(node.id);
                  if (check) setSelectedCheck(check);
                }}
              />
            ))}
          </View>

          <View style={styles.systemMapSection}>
            <View style={styles.sysMapHeader}>
              <View style={styles.sysMapHeaderDot} />
              <Text style={styles.sysMapHeaderTitle}>SYSTEM MAP</Text>
            </View>
            <Text style={styles.sysMapSubtitle}>High-level infrastructure overview</Text>

            {[
              {
                id: 'mobile',
                icon: Smartphone,
                title: 'Mobile App',
                subtitle: 'Expo',
                detail: 'Supabase (database, auth, realtime)',
                color: '#00E676',
                arrows: ['Supabase DB', 'Supabase Auth', 'Realtime WS']},
              {
                id: 'landing',
                icon: Globe,
                title: 'Landing Page',
                subtitle: 'ivxholding.com',
                detail: 'Supabase (realtime subscription, reads deals)',
                color: '#4FC3F7',
                arrows: ['Supabase Realtime', 'Reads jv_deals']},

              {
                id: 'aws',
                icon: Cloud,
                title: 'AWS S3',
                subtitle: 'Static hosting',
                detail: 'Static file hosting only (landing page HTML)',
                color: '#FFB74D',
                arrows: ['No direct Supabase']},
              {
                id: 'supabase',
                icon: Database,
                title: 'Supabase',
                subtitle: 'Central hub',
                detail: 'PostgreSQL + Auth + Realtime + RLS + Edge Functions',
                color: '#69F0AE',
                arrows: []},
            ].map((item, idx) => {
              const IconComp = item.icon;
              return (
                <View key={item.id} style={styles.sysMapCard}>
                  <View style={styles.sysMapCardLeft}>
                    <View style={[styles.sysMapIconWrap, { backgroundColor: `${item.color}15`, borderColor: `${item.color}40` }]}>
                      <IconComp size={20} color={item.color} />
                    </View>
                    <View style={styles.sysMapCardInfo}>
                      <View style={styles.sysMapCardTitleRow}>
                        <Text style={styles.sysMapCardTitle}>{item.title}</Text>
                        <View style={[styles.sysMapBadge, { backgroundColor: `${item.color}20` }]}>
                          <Text style={[styles.sysMapBadgeText, { color: item.color }]}>{item.subtitle}</Text>
                        </View>
                      </View>
                      <Text style={styles.sysMapCardDetail}>{item.detail}</Text>
                    </View>
                  </View>
                  {item.arrows.length > 0 && (
                    <View style={styles.sysMapArrows}>
                      {item.arrows.map((arrow, i) => (
                        <View key={i} style={styles.sysMapArrowRow}>
                          <ArrowRight size={10} color={item.color} />
                          <Text style={[styles.sysMapArrowText, { color: item.color }]}>{arrow}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {idx < 4 && <View style={styles.sysMapConnectorLine} />}
                </View>
              );
            })}

            <View style={styles.sysMapKeyPoints}>
              <Text style={styles.sysMapKeyPointsTitle}>KEY POINTS</Text>
              {[
                'Supabase is the central hub — everything connects to it for data',
                'AWS S3 is just a file host for your landing page — it doesn\'t run backend logic',
                'Landing page and app both talk to the same Supabase database, so they stay in sync via realtime subscriptions',
                'App pushes HTML to S3 on publish for permanent landing page updates',
              ].map((point, i) => (
                <View key={i} style={styles.sysMapKeyPointRow}>
                  <View style={styles.sysMapKeyPointBullet} />
                  <Text style={styles.sysMapKeyPointText}>{point}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.legendSection}>
            <Text style={styles.legendTitle}>STATUS LEGEND</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#00E676' }]} />
                <Text style={styles.legendText}>Operational</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#FFD600' }]} />
                <Text style={styles.legendText}>Degraded</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#FF1744' }]} />
                <Text style={styles.legendText}>Critical</Text>
              </View>
            </View>
          </View>

          {snapshot && snapshot.totalRed > 0 && (
            <View style={styles.alertSection}>
              <View style={styles.alertHeader}>
                <Activity size={16} color="#FF1744" />
                <Text style={styles.alertTitle}>CRITICAL ALERTS</Text>
              </View>
              {snapshot.checks
                .filter((c) => c.status === 'red')
                .map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.alertItem}
                    onPress={() => setSelectedCheck(c)}
                  >
                    <View style={styles.alertDot} />
                    <View style={styles.alertContent}>
                      <Text style={styles.alertName}>{c.name}</Text>
                      <Text style={styles.alertMsg}>{c.message}</Text>
                    </View>
                    <Text style={styles.alertLatency}>{c.latency ? `${c.latency}ms` : ''}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          {snapshot && snapshot.totalYellow > 0 && (
            <View style={styles.warningSection}>
              <View style={styles.alertHeader}>
                <Activity size={16} color="#FFD600" />
                <Text style={[styles.alertTitle, { color: '#FFD600' }]}>WARNINGS</Text>
              </View>
              {snapshot.checks
                .filter((c) => c.status === 'yellow')
                .map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.warningItem}
                    onPress={() => setSelectedCheck(c)}
                  >
                    <View style={[styles.alertDot, { backgroundColor: '#FFD600' }]} />
                    <View style={styles.alertContent}>
                      <Text style={styles.alertName}>{c.name}</Text>
                      <Text style={styles.alertMsg}>{c.message}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

        {selectedCheck && (
          <NodeDetailPanel check={selectedCheck} onClose={() => setSelectedCheck(null)} />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#050510'},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  backBtn: {
    padding: 8,
    marginRight: 8},
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.5},
  headerRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  autoRefreshBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'},
  autoRefreshActive: {
    borderColor: 'rgba(0, 230, 118, 0.4)',
    backgroundColor: 'rgba(0, 230, 118, 0.08)'},
  autoRefreshText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 1},
  refreshBtn: {
    padding: 8},
  overallBar: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const},
  overallBarInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  overallDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  overallLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.2},
  overallStats: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12},
  overallStatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4},
  miniDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  overallStatText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  trafficLaunchCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.28)',
    backgroundColor: 'rgba(79, 195, 247, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12},
  trafficLaunchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(79, 195, 247, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.22)'},
  trafficLaunchContent: {
    flex: 1,
    gap: 3},
  trafficLaunchEyebrow: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.3,
    color: '#4FC3F7'},
  trafficLaunchTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  trafficLaunchBody: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textSecondary},
  scrollView: {
    flex: 1},
  scrollContent: {
    alignItems: 'center' as const,
    paddingTop: 16},
  diagramTitle: {
    alignItems: 'center' as const,
    marginBottom: 16},
  diagramTitleText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase' as const},
  diagramSubtitle: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 4},
  diagramContainer: {
    position: 'relative' as const,
    overflow: 'hidden' as const,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(10, 10, 30, 0.8)'},
  gridOverlay: {
    ...StyleSheet.absoluteFillObject},
  gridLine: {
    position: 'absolute' as const,
    backgroundColor: 'rgba(255,255,255,0.02)'},
  gridLineH: {
    left: 0,
    right: 0,
    height: 1},
  gridLineV: {
    top: 0,
    bottom: 0,
    width: 1},
  tierLabel: {
    position: 'absolute' as const,
    left: 4,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    zIndex: 1},
  tierLabelLine: {
    width: 2,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1},
  tierLabelText: {
    fontSize: 8,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 1,
    textTransform: 'uppercase' as const},
  nodeWrapper: {
    position: 'absolute' as const,
    width: NODE_SIZE,
    alignItems: 'center' as const,
    zIndex: 10},
  pulseRing: {
    position: 'absolute' as const,
    borderWidth: 2,
    top: -(20 / 2),
    left: -(20 / 2)},
  nodeContainer: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  nodeIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  statusDotSmall: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#050510'},
  nodeLabel: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center' as const,
    width: 80},
  nodeLatency: {
    fontSize: 9,
    fontWeight: '700' as const,
    marginTop: 1},
  connectionContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5},
  connectionLine: {
    position: 'absolute' as const,
    height: 2,
    transformOrigin: 'left center',
    borderRadius: 1},
  connectionLineDashed: {
    backgroundColor: 'transparent',
    borderTopWidth: 2,
    borderStyle: 'dashed' as const,
    height: 0},
  connectionLabelContainer: {
    position: 'absolute' as const,
    zIndex: 6,
    backgroundColor: 'rgba(10, 10, 30, 0.85)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4},
  connectionLabelText: {
    fontSize: 7,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    textAlign: 'center' as const},
  flowDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute' as const,
    left: '50%' as any,
    top: -1},
  legendSection: {
    marginTop: 24,
    paddingHorizontal: 24,
    width: '100%'},
  legendTitle: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 2,
    marginBottom: 10},
  legendRow: {
    flexDirection: 'row' as const,
    gap: 20},
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6},
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary},
  alertSection: {
    marginTop: 20,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255, 23, 68, 0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 23, 68, 0.2)',
    padding: 16},
  warningSection: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255, 214, 0, 0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 0, 0.15)',
    padding: 16},
  alertHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12},
  alertTitle: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FF1744',
    letterSpacing: 1.5},
  alertItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 23, 68, 0.1)'},
  warningItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 214, 0, 0.08)'},
  alertDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF1744',
    marginRight: 10},
  alertContent: {
    flex: 1},
  alertName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  alertMsg: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2},
  alertLatency: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FF1744'},
  ownerAlertsCard: {
    alignSelf: 'stretch' as const,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginHorizontal: 16,
    backgroundColor: 'rgba(7, 12, 24, 0.94)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  ownerAlertsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12},
  ownerAlertsBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1},
  ownerAlertsBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const},
  ownerAlertsCount: {
    fontSize: 12,
    fontWeight: '700' as const},
  ownerAlertsTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6},
  ownerAlertsBody: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 14},
  ownerContactRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8},
  ownerContactText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const},
  ownerChipRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 6,
    marginBottom: 14},
  ownerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)'},
  ownerChipText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  ownerActionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10},
  ownerPrimaryAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    minWidth: 132},
  ownerPrimaryActionText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.black},
  ownerSecondaryAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minWidth: 118},
  ownerSecondaryActionText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text},
  ownerDisabledAction: {
    opacity: 0.5},
  ownerDispatchRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8},
  ownerDispatchText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary},
  ownerFeedSection: {
    alignSelf: 'stretch' as const,
    marginTop: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  ownerFeedHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12},
  ownerFeedTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: 0.6},
  ownerFeedItem: {
    paddingVertical: 12,
    borderTopWidth: 1},
  ownerFeedTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  ownerFeedDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  ownerFeedItemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text},
  ownerFeedItemStatus: {
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const},
  ownerFeedItemSummary: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
    marginTop: 6},
  ownerFeedItemMeta: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 6},
  ownerLaneSection: {
    alignSelf: 'stretch' as const,
    marginTop: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(10, 16, 28, 0.88)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  ownerLaneHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  ownerLaneTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: 0.6},
  ownerLaneSubtitle: {
    marginTop: 8,
    marginBottom: 14,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary},
  ownerLaneCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1},
  ownerLaneIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  ownerLaneContent: {
    flex: 1},
  ownerLaneTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 10},
  ownerLaneCardTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text},
  ownerLaneStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999},
  ownerLaneStatusText: {
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6},
  ownerLaneTarget: {
    marginTop: 5,
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  ownerLaneDescription: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary},
  detailPanel: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0D0D1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    paddingBottom: 40,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20},
  detailHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12},
  detailStatusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1},
  detailStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  detailStatusText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1},
  detailClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  detailCloseText: {
    fontSize: 20,
    color: Colors.textSecondary,
    lineHeight: 22},
  detailName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  detailMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16},
  detailGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
    marginBottom: 12},
  detailGridItem: {
    flex: 1,
    minWidth: 80,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 10},
  detailGridLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 4},
  detailGridValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  detailExtra: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8},
  detailExtraText: {
    fontSize: 12,
    color: Colors.textSecondary},
  detailTimestamp: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4},
  systemMapSection: {
    marginTop: 28,
    marginHorizontal: 16,
    backgroundColor: 'rgba(10, 15, 30, 0.9)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    overflow: 'hidden' as const},
  sysMapHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 4},
  sysMapHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676'},
  sysMapHeaderTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#00E676',
    letterSpacing: 2},
  sysMapSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 18},
  sysMapCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
    marginBottom: 10,
    position: 'relative' as const},
  sysMapCardLeft: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12},
  sysMapIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1},
  sysMapCardInfo: {
    flex: 1},
  sysMapCardTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 4},
  sysMapCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#EAEAEA'},
  sysMapBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6},
  sysMapBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.5},
  sysMapCardDetail: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 16},
  sysMapArrows: {
    marginTop: 10,
    marginLeft: 54,
    gap: 4},
  sysMapArrowRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6},
  sysMapArrowText: {
    fontSize: 10,
    fontWeight: '600' as const},
  sysMapConnectorLine: {
    position: 'absolute' as const,
    bottom: -10,
    left: 34,
    width: 2,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.08)'},
  sysMapKeyPoints: {
    marginTop: 14,
    backgroundColor: 'rgba(0, 230, 118, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.12)',
    padding: 14},
  sysMapKeyPointsTitle: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.5,
    marginBottom: 10},
  sysMapKeyPointRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    marginBottom: 8},
  sysMapKeyPointBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#00E676',
    marginTop: 5},
  sysMapKeyPointText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
    flex: 1}});
