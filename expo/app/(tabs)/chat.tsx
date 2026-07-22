import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Clock, HelpCircle, MessageCircle, Radio, ScanLine, User, X, Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useTranslation } from '@/lib/i18n-context';
import { getResponsiveSize, isExtraSmallScreen } from '@/lib/responsive';
import InvestorSupportChat, { type HumanSupportRequestResult } from '@/components/InvestorSupportChat';
import { getAutoDeployStatus } from '@/lib/auto-deploy';
import { getDeployStatus } from '@/lib/landing-deploy';
import type { ChatMessage } from '@/types';
import {
  type CreateSupportTicketParams,
  type SupportTicketItem,
  type SupportTicketRow,
  type TicketCategory,
  type TicketStatus,
  buildLiveSupportTicketDraft,
  createSupportTicket,
  fetchUserSupportTickets,
  mapSupportTicketRows,
} from '@/lib/support-chat';
import { probeAIBackendHealth } from '@/src/modules/chat/services/aiReplyService';
import { getCurrentChatRoomStatus, subscribeToChatRoomStatus } from '@/src/modules/chat/services/supabaseChatProvider';
import type { ChatRoomStatus, ServiceRuntimeHealth } from '@/src/modules/chat/types/chat';

type ViewMode = 'chat' | 'tickets';

const APP_CHAT_QUICK_REPLIES = [
  'Rank all projects',
  'Which project has the highest ROI?',
  'Compare Casa Rosario and Perez Residence',
  'Would you invest $100k today?',
  'Biggest risks in Casa Rosario?',
  'How do I invest?',
] as const;

const APP_CHAT_WELCOME_MESSAGE = 'Hi — I am IVX Deal Intelligence, connected live to your published projects. Ask me to rank projects, compare deals, check ROI, weigh a $100k allocation, or flag risks — answers come straight from your real deal data.';

function getRoomProofLabel(status: ChatRoomStatus | null): string {
  if (!status) {
    return 'Checking room';
  }

  switch (status.storageMode) {
    case 'primary_supabase_tables':
      return 'Live shared room';
    case 'alternate_room_schema':
      return 'Shared room';
    case 'snapshot_storage':
      return 'Snapshot mode';
    case 'local_device_only':
      return 'Local only';
    default:
      return 'Checking room';
  }
}

function getRoomProofColor(status: ChatRoomStatus | null): string {
  if (!status) {
    return Colors.textTertiary;
  }

  switch (status.storageMode) {
    case 'primary_supabase_tables':
      return Colors.success;
    case 'alternate_room_schema':
    case 'snapshot_storage':
      return Colors.warning;
    case 'local_device_only':
      return '#FF7D7D';
    default:
      return Colors.textTertiary;
  }
}

function getAIProofLabel(health: ServiceRuntimeHealth | undefined): string {
  switch (health) {
    case 'active':
      return 'Replies ready';
    case 'degraded':
      return 'Replies degraded';
    case 'inactive':
    default:
      return 'Replies off';
  }
}

function getAIProofColor(health: ServiceRuntimeHealth | undefined): string {
  switch (health) {
    case 'active':
      return Colors.success;
    case 'degraded':
      return Colors.warning;
    case 'inactive':
    default:
      return '#FF7D7D';
  }
}

function formatLastDeployLabel(value: string | null | undefined): string {
  if (!value) {
    return 'Last deploy: none';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Last deploy: unknown';
  }

  return `Last deploy: ${parsed.toLocaleString()}`;
}

export default function ChatScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [roomStatus, setRoomStatus] = useState<ChatRoomStatus | null>(() => getCurrentChatRoomStatus());

  // "Welcome to IVX" auto-dismissing banner — visible for 5–10s, then fades out.
  const [showWelcomeBanner, setShowWelcomeBanner] = useState<boolean>(true);
  const welcomeFadeAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const welcomeSlideAnim = useRef<Animated.Value>(new Animated.Value(0)).current;
  const welcomeDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeHasDismissedRef = useRef<boolean>(false);

  const screenSize = getResponsiveSize(width);
  const isXs = isExtraSmallScreen(screenSize);
  const chatBottomInset = useMemo(() => {
    return Math.max(tabBarHeight - insets.bottom, 0) + 12;
  }, [insets.bottom, tabBarHeight]);

  const ticketsQuery = useQuery<SupportTicketRow[]>({
    queryKey: ['support-tickets'],
    queryFn: fetchUserSupportTickets,
  });

  const deployProofQuery = useQuery({
    queryKey: ['chat-room-proof', 'deploy'],
    queryFn: async () => {
      return {
        deploy: getDeployStatus(),
        autoDeploy: await getAutoDeployStatus(),
      };
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const aiHealthQuery = useQuery<ServiceRuntimeHealth>({
    queryKey: ['chat-room-proof', 'ai-health'],
    queryFn: async () => {
      const probe = await probeAIBackendHealth();
      return probe.health;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const createTicketMutation = useMutation<SupportTicketRow, Error, CreateSupportTicketParams>({
    mutationFn: createSupportTicket,
  });

  const supportTickets = useMemo<SupportTicketItem[]>(() => {
    return mapSupportTicketRows(ticketsQuery.data ?? []);
  }, [ticketsQuery.data]);
  const roomProofLabel = useMemo(() => getRoomProofLabel(roomStatus), [roomStatus]);
  const roomProofColor = useMemo(() => getRoomProofColor(roomStatus), [roomStatus]);
  const aiProofLabel = useMemo(() => getAIProofLabel(aiHealthQuery.data), [aiHealthQuery.data]);
  const aiProofColor = useMemo(() => getAIProofColor(aiHealthQuery.data), [aiHealthQuery.data]);
  const deployProofLabel = useMemo(() => {
    if (deployProofQuery.data?.deploy.publicDeployConfigured) {
      return 'Public pipeline ready';
    }

    return deployProofQuery.data?.deploy.pipelineLabel ?? 'Checking deploy';
  }, [deployProofQuery.data?.deploy.pipelineLabel, deployProofQuery.data?.deploy.publicDeployConfigured]);
  const deployProofColor = useMemo(() => {
    if (deployProofQuery.data?.deploy.publicDeployConfigured) {
      return Colors.success;
    }

    if (deployProofQuery.data?.deploy.canDeploy) {
      return Colors.warning;
    }

    return Colors.textTertiary;
  }, [deployProofQuery.data?.deploy.canDeploy, deployProofQuery.data?.deploy.publicDeployConfigured]);
  const githubProofLabel = useMemo(() => {
    return deployProofQuery.data?.deploy.githubActionsConfigured ? 'GitHub ready' : 'GitHub missing';
  }, [deployProofQuery.data?.deploy.githubActionsConfigured]);
  const githubProofColor = useMemo(() => {
    return deployProofQuery.data?.deploy.githubActionsConfigured ? Colors.success : '#FF7D7D';
  }, [deployProofQuery.data?.deploy.githubActionsConfigured]);
  const lastDeployLabel = useMemo(() => {
    return formatLastDeployLabel(deployProofQuery.data?.autoDeploy.lastDeploy?.timestamp ?? null);
  }, [deployProofQuery.data?.autoDeploy.lastDeploy?.timestamp]);

  useEffect(() => {
    const unsubscribe = subscribeToChatRoomStatus((nextStatus) => {
      setRoomStatus(nextStatus);
    });

    return unsubscribe;
  }, []);

  // "Welcome to IVX" banner — auto-dismiss after 7s (5s visible + 2s fade).
  const dismissWelcomeBanner = useCallback(() => {
    if (welcomeHasDismissedRef.current) return;
    welcomeHasDismissedRef.current = true;
    if (welcomeDismissTimerRef.current) {
      clearTimeout(welcomeDismissTimerRef.current);
      welcomeDismissTimerRef.current = null;
    }
    Animated.parallel([
      Animated.timing(welcomeFadeAnim, {
        toValue: 0,
        duration: 1800,
        useNativeDriver: true,
      }),
      Animated.timing(welcomeSlideAnim, {
        toValue: -40,
        duration: 1800,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowWelcomeBanner(false);
    });
  }, [welcomeFadeAnim, welcomeSlideAnim]);

  useEffect(() => {
    welcomeDismissTimerRef.current = setTimeout(dismissWelcomeBanner, 5000);
    return () => {
      if (welcomeDismissTimerRef.current) {
        clearTimeout(welcomeDismissTimerRef.current);
        welcomeDismissTimerRef.current = null;
      }
    };
  }, [dismissWelcomeBanner]);

  const getTicketStatusColor = useCallback((status: TicketStatus) => {
    switch (status) {
      case 'open':
        return Colors.warning;
      case 'in_progress':
        return Colors.info;
      case 'resolved':
        return Colors.success;
      default:
        return Colors.textTertiary;
    }
  }, []);

  const getTicketStatusIcon = useCallback((status: TicketStatus) => {
    switch (status) {
      case 'open':
        return <Clock size={16} color={Colors.warning} />;
      case 'in_progress':
        return <MessageCircle size={16} color={Colors.info} />;
      case 'resolved':
        return <User size={16} color={Colors.success} />;
      default:
        return <HelpCircle size={16} color={Colors.textTertiary} />;
    }
  }, []);

  const submitTicket = useCallback(
    async (subject: string, category: TicketCategory, message: string) => {
      try {
        const data = await createTicketMutation.mutateAsync({
          subject,
          category,
          message,
        });
        await ticketsQuery.refetch();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Ticket Created', `Your ${subject} ticket has been submitted. We'll respond within 24 hours.`);
      } catch (error) {
        console.error('[ChatScreen] Create ticket error:', error);
        Alert.alert('Error', 'Could not create ticket. Please try again.');
      }
    },
    [createTicketMutation, ticketsQuery]
  );

  const handleRequestHumanSupport = useCallback(
    async (messages: ChatMessage[]): Promise<HumanSupportRequestResult> => {
      const openTickets = supportTickets.filter(
        (ticket) => ticket.status === 'open' || ticket.status === 'in_progress'
      );

      if (openTickets.length >= 3) {
        return {
          ok: false,
          message: `You already have ${openTickets.length} open tickets. Please wait for an existing ticket to be updated before starting another live support request.`,
        };
      }

      const draft = buildLiveSupportTicketDraft(messages);

      try {
        const data = await createTicketMutation.mutateAsync({
          subject: draft.subject,
          category: draft.category,
          message: draft.message,
          priority: draft.priority,
        });
        await ticketsQuery.refetch();
        const waitTime = openTickets.length === 0 ? '5-10' : `${10 + openTickets.length * 5}-${15 + openTickets.length * 5}`;
        setViewMode('tickets');

        return {
          ok: true,
          message: `Your live chat request has been submitted (Ticket #${data.id.slice(-6)}). Estimated wait time: ${waitTime} minutes. A support agent will review your ticket shortly.`,
        };
      } catch (error) {
        console.error('[ChatScreen] Live support request failed:', error);
        return {
          ok: false,
          message: 'Sorry, we could not create your support ticket right now. Please try again later or email investors@ivxholding.com.',
        };
      }
    },
    [createTicketMutation, supportTickets, ticketsQuery]
  );

  return (
    <View style={styles.container}>
      <ModuleErrorBoundary moduleName="Chat">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: isXs ? 16 : 20 }]}> 
          <View style={styles.headerTop}>
            <Text style={[styles.headerTitle, { fontSize: isXs ? 26 : 32 }]}>{t('liveSupport')}</Text>
            <View style={[styles.headerBadge, { paddingHorizontal: isXs ? 8 : 10, paddingVertical: isXs ? 4 : 5 }]}> 
              <User size={isXs ? 12 : 14} color={Colors.black} />
              <Text style={[styles.headerBadgeText, { fontSize: isXs ? 10 : 12 }]}>24/7</Text>
            </View>
          </View>
          <Text style={[styles.headerSubtitle, { fontSize: isXs ? 12 : 14 }]}>{t('customerCare')}</Text>
        </View>

        {showWelcomeBanner ? (
          <Animated.View
            style={[
              styles.welcomeBanner,
              {
                marginHorizontal: isXs ? 16 : 20,
                opacity: welcomeFadeAnim,
                transform: [{ translateY: welcomeSlideAnim }],
              },
            ]}
            testID="ivx-welcome-banner"
          >
            <View style={styles.welcomeIcon}>
              <Sparkles size={isXs ? 18 : 20} color={Colors.black} />
            </View>
            <View style={styles.welcomeTextCol}>
              <Text style={[styles.welcomeTitle, { fontSize: isXs ? 15 : 17 }]}>Welcome to IVX</Text>
              <Text style={[styles.welcomeSubtitle, { fontSize: isXs ? 11 : 13 }]}>Owner AI room is live. Ask anything about your deals.</Text>
            </View>
            <TouchableOpacity
              style={styles.welcomeClose}
              onPress={dismissWelcomeBanner}
              accessibilityLabel="Dismiss welcome banner"
              accessibilityRole="button"
              testID="ivx-welcome-banner-close"
            >
              <X size={isXs ? 14 : 16} color={Colors.textSecondary} />
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        <View style={[styles.moduleCard, { marginHorizontal: isXs ? 16 : 20, padding: isXs ? 14 : 16 }]}>
          <View style={styles.moduleCardHeader}>
            <View style={styles.moduleBadge}>
              <Text style={styles.moduleBadgeText}>OWNER</Text>
            </View>
            <View style={styles.moduleActions}>
              <TouchableOpacity
                style={styles.moduleButton}
                onPress={() => router.push('/ivx/chat' as any)}
                testID="chat-open-message-room"
              >
                <Text style={styles.moduleButtonText}>Open room</Text>
                <ArrowUpRight size={14} color={Colors.black} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.moduleTitle, { fontSize: isXs ? 16 : 18 }]}>IVX Owner AI room</Text>
          <Text style={[styles.moduleText, { fontSize: isXs ? 12 : 13 }]}>Open the shared owner room for live sync, AI reply checks, and owner-side backend proof without replacing live support.</Text>
          <View style={styles.proofGrid}>
            <View style={styles.proofCard}>
              <View style={styles.proofTopRow}>
                <Radio size={14} color={roomProofColor} />
                <Text style={styles.proofLabel}>Room sync</Text>
              </View>
              <Text style={[styles.proofValue, { color: roomProofColor }]}>{roomProofLabel}</Text>
            </View>
            <View style={styles.proofCard}>
              <View style={styles.proofTopRow}>
                <MessageCircle size={14} color={aiProofColor} />
                <Text style={styles.proofLabel}>AI replies</Text>
              </View>
              <Text style={[styles.proofValue, { color: aiProofColor }]}>{aiProofLabel}</Text>
            </View>
            <View style={styles.proofCard}>
              <View style={styles.proofTopRow}>
                <ScanLine size={14} color={deployProofColor} />
                <Text style={styles.proofLabel}>Deploy</Text>
              </View>
              <Text style={[styles.proofValue, { color: deployProofColor }]}>{deployProofLabel}</Text>
            </View>
            <View style={styles.proofCard}>
              <View style={styles.proofTopRow}>
                <ArrowUpRight size={14} color={githubProofColor} />
                <Text style={styles.proofLabel}>GitHub</Text>
              </View>
              <Text style={[styles.proofValue, { color: githubProofColor }]}>{githubProofLabel}</Text>
              <Text style={styles.proofMeta}>{lastDeployLabel}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.tabsContainer, { marginHorizontal: isXs ? 16 : 20 }]}> 
          <TouchableOpacity
            style={[styles.tab, viewMode === 'chat' && styles.tabActive]}
            onPress={() => setViewMode('chat')}
            testID="chat-tab-live-chat"
          >
            <MessageCircle size={isXs ? 16 : 18} color={viewMode === 'chat' ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.tabText, { fontSize: isXs ? 12 : 14 }, viewMode === 'chat' && styles.tabTextActive]}>
              {t('liveChat')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, viewMode === 'tickets' && styles.tabActive]}
            onPress={() => setViewMode('tickets')}
            testID="chat-tab-tickets"
          >
            <HelpCircle size={isXs ? 16 : 18} color={viewMode === 'tickets' ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.tabText, { fontSize: isXs ? 12 : 14 }, viewMode === 'tickets' && styles.tabTextActive]}>
              {t('tickets')} ({supportTickets.length})
            </Text>
          </TouchableOpacity>
        </View>

        {viewMode === 'chat' ? (
          <View style={styles.chatPanel}>
            <InvestorSupportChat
              variant="screen"
              source="chat"
              testIdPrefix="chat-screen"
              keyboardVerticalOffset={0}
              extraBottomInset={chatBottomInset}
              welcomeMessage={APP_CHAT_WELCOME_MESSAGE}
              quickReplies={APP_CHAT_QUICK_REPLIES}
              onRequestHumanSupport={handleRequestHumanSupport}
            />
          </View>
        ) : (
          <ScrollView
            style={[styles.ticketsContainer, { paddingHorizontal: isXs ? 16 : 20 }]}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.ticketsContent}
            testID="chat-tickets-scroll"
          >
            <TouchableOpacity
              style={[styles.newTicketButton, { paddingVertical: isXs ? 12 : 14 }]}
              onPress={() => {
                Alert.alert('New Support Ticket', 'What do you need help with?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Account Issue',
                    onPress: () => {
                      void submitTicket('Account Issue', 'general', 'I need help with my account.');
                    },
                  },
                  {
                    text: 'Investment Help',
                    onPress: () => {
                      void submitTicket('Investment Help', 'trading', 'I need help with my investments.');
                    },
                  },
                  {
                    text: 'Technical Issue',
                    onPress: () => {
                      void submitTicket('Technical Issue', 'technical', 'I need help with a technical problem, bug, or integration.');
                    },
                  },
                  {
                    text: 'General Support',
                    onPress: () => {
                      void submitTicket('General Support', 'general', 'I need general assistance.');
                    },
                  },
                ]);
              }}
              testID="chat-create-ticket"
            >
              <HelpCircle size={isXs ? 18 : 20} color={Colors.black} />
              <Text style={[styles.newTicketText, { fontSize: isXs ? 14 : 15 }]}>Create New Ticket</Text>
            </TouchableOpacity>

            {supportTickets.length === 0 ? (
              <View style={styles.emptyState}>
                <HelpCircle size={22} color={Colors.textTertiary} />
                <Text style={styles.emptyStateTitle}>No support tickets yet</Text>
                <Text style={styles.emptyStateText}>Start a live chat or create a ticket if you need help from the IVX team.</Text>
              </View>
            ) : null}

            {supportTickets.map((ticket) => (
              <TouchableOpacity key={ticket.id} style={[styles.ticketCard, { padding: isXs ? 12 : 16 }]} activeOpacity={0.85} testID={`ticket-${ticket.id}`}>
                <View style={styles.ticketHeader}>
                  <View style={styles.ticketStatus}>
                    {getTicketStatusIcon(ticket.status)}
                    <Text style={[styles.ticketStatusText, { color: getTicketStatusColor(ticket.status) }]}>
                      {ticket.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.ticketDate}>{new Date(ticket.createdAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.ticketSubject}>{ticket.subject}</Text>
                <View style={styles.ticketFooter}>
                  <View style={styles.ticketCategory}>
                    <Text style={styles.ticketCategoryText}>{ticket.category}</Text>
                  </View>
                  <Text style={styles.ticketMessages}>{ticket.messages.length} messages</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
      </ModuleErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingVertical: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    color: Colors.textSecondary,
    marginTop: 4,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 12,
  },
  headerBadgeText: {
    color: Colors.black,
    fontWeight: '700' as const,
  },
  moduleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 12,
  },
  moduleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  moduleBadge: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  moduleBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  moduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  moduleGhostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  moduleGhostButtonText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  moduleButtonText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  moduleTitle: {
    color: Colors.text,
    fontWeight: '800' as const,
  },
  moduleText: {
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 6,
  },
  proofGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  proofCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 78,
    borderRadius: 14,
    padding: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8,
  },
  proofTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proofLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  proofValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
    lineHeight: 18,
  },
  proofMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  tabTextActive: {
    color: Colors.black,
  },
  chatPanel: {
    flex: 1,
  },
  ticketsContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  ticketsContent: {
    paddingBottom: 120,
  },
  newTicketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    marginBottom: 16,
  },
  newTicketText: {
    fontWeight: '700' as const,
    color: Colors.black,
  },
  ticketCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  ticketStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketStatusText: {
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
  },
  ticketDate: {
    color: Colors.textTertiary,
    fontSize: 12,
  },
  ticketSubject: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const,
    marginBottom: 10,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketCategory: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ticketCategoryText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase',
  },
  ticketMessages: {
    color: Colors.textTertiary,
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    gap: 8,
    marginBottom: 12,
  },
  emptyStateTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  emptyStateText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  welcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    marginBottom: 12,
  },
  welcomeIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTextCol: {
    flex: 1,
    gap: 2,
  },
  welcomeTitle: {
    color: Colors.text,
    fontWeight: '800' as const,
  },
  welcomeSubtitle: {
    color: Colors.textSecondary,
  },
  welcomeClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
