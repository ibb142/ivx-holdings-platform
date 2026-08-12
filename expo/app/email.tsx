import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Animated,
  ScrollView,
  Modal,
  Platform,
  Dimensions,
  RefreshControl} from 'react-native';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  Mail,
  Search,
  Star,
  Paperclip,
  ChevronDown,
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  AlertOctagon,
  Pen,
  Check,
  CheckCheck,
  Menu,
  X,
  CircleAlert} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useEmail } from '@/lib/email-context';
import { EmailFolder, EmailMessage } from '@/types/email';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const FOLDERS: { key: EmailFolder; label: string; icon: React.ReactNode }[] = [
  { key: 'inbox', label: 'Inbox', icon: <Inbox size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'starred', label: 'Starred', icon: <Star size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'sent', label: 'Sent', icon: <Send size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'drafts', label: 'Drafts', icon: <FileText size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'archive', label: 'Archive', icon: <Archive size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'spam', label: 'Spam', icon: <AlertOctagon size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
  { key: 'trash', label: 'Trash', icon: <Trash2 size={18} color={Colors.textSecondary} strokeWidth={1.8} /> },
];

function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return `${mins}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  }
  if (diffHours < 48) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface EmailRowProps {
  email: EmailMessage;
  onPress: () => void;
  onStarToggle: () => void;
}

const EmailRow = React.memo(function EmailRow({ email, onPress, onStarToggle }: EmailRowProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0}).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0}).start();
  }, [scaleAnim]);

  const senderInitial = email.from.name.charAt(0).toUpperCase();
  const isPriority = email.priority === 'high';

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.emailRow, !email.isRead && styles.emailRowUnread]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        testID={`email-row-${email.id}`}
      >
        <View style={styles.emailRowLeft}>
          <View style={[styles.avatarCircle, !email.isRead && styles.avatarCircleUnread]}>
            <Text style={[styles.avatarText, !email.isRead && styles.avatarTextUnread]}>{senderInitial}</Text>
          </View>
        </View>
        <View style={styles.emailRowCenter}>
          <View style={styles.emailRowTop}>
            <Text style={[styles.senderName, !email.isRead && styles.senderNameUnread]} numberOfLines={1}>
              {email.from.name}
            </Text>
            <View style={styles.emailRowMeta}>
              {isPriority && <CircleAlert size={12} color={Colors.error} strokeWidth={2} />}
              {email.hasAttachments && <Paperclip size={12} color={Colors.textTertiary} strokeWidth={2} />}
              <Text style={[styles.emailDate, !email.isRead && styles.emailDateUnread]}>
                {formatEmailDate(email.date)}
              </Text>
            </View>
          </View>
          <Text style={[styles.emailSubject, !email.isRead && styles.emailSubjectUnread]} numberOfLines={1}>
            {email.subject}
          </Text>
          <Text style={styles.emailPreview} numberOfLines={1}>
            {email.body.replace(/\n/g, ' ')}
          </Text>
          {email.labels && email.labels.length > 0 && (
            <View style={styles.labelRow}>
              {email.labels.slice(0, 2).map(label => (
                <View
                  key={label}
                  style={[
                    styles.labelBadge,
                    label === 'urgent' && { backgroundColor: 'rgba(255,77,77,0.15)' },
                    label === 'important' && { backgroundColor: 'rgba(255,184,0,0.15)' },
                    label === 'follow-up' && { backgroundColor: 'rgba(74,144,217,0.15)' },
                    label === 'internal' && { backgroundColor: 'rgba(0,196,140,0.15)' },
                    label === 'external' && { backgroundColor: 'rgba(155,89,182,0.15)' },
                  ]}
                >
                  <Text
                    style={[
                      styles.labelText,
                      label === 'urgent' && { color: Colors.error },
                      label === 'important' && { color: Colors.warning },
                      label === 'follow-up' && { color: Colors.info },
                      label === 'internal' && { color: Colors.success },
                      label === 'external' && { color: '#9B59B6' },
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.starButton}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onStarToggle();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Star
            size={18}
            color={email.isStarred ? Colors.primary : Colors.textTertiary}
            fill={email.isStarred ? Colors.primary : 'none'}
            strokeWidth={1.8}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function EmailScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const {
    accountsWithUnread,
    activeAccount,
    switchAccount,
    emails,
    selectedFolder,
    setSelectedFolder,
    searchQuery,
    setSearchQuery,
    folderCounts,
    toggleStar,
    markAllAsRead,
    sesStatus,
    refreshEmails,
    isLoading,
    inboxStatus,
    lastFetchSource,
    backendError,
    sourceStats: _sourceStats} = useEmail();

  const [showDrawer, setShowDrawer] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const drawerAnim = useRef(new Animated.Value(-SCREEN_WIDTH * 0.82)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const searchBarAnim = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    setShowDrawer(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.spring(drawerAnim, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 2 }),
      Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [drawerAnim, overlayAnim]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.spring(drawerAnim, { toValue: -SCREEN_WIDTH * 0.82, useNativeDriver: true, speed: 18, bounciness: 2 }),
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowDrawer(false));
  }, [drawerAnim, overlayAnim]);

  const toggleSearch = useCallback(() => {
    if (showSearch) {
      setSearchQuery('');
      Animated.timing(searchBarAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => setShowSearch(false));
    } else {
      setShowSearch(true);
      Animated.timing(searchBarAnim, { toValue: 1, duration: 250, useNativeDriver: false }).start();
    }
  }, [showSearch, searchBarAnim, setSearchQuery]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await refreshEmails();
      console.log('[Email] Refresh complete');
    } catch (err) {
      console.log('[Email] Refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [refreshEmails]);

  const handleEmailPress = useCallback((emailId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/email-detail?id=${emailId}` as any);
  }, [router]);

  const handleCompose = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/email-compose' as any);
  }, [router]);

  const handleFolderSelect = useCallback((folder: EmailFolder) => {
    setSelectedFolder(folder);
    closeDrawer();
  }, [setSelectedFolder, closeDrawer]);

  const handleAccountSwitch = useCallback((accountId: string) => {
    switchAccount(accountId);
    setShowAccountPicker(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [switchAccount]);

  const renderEmail = useCallback(({ item }: { item: EmailMessage }) => (
    <EmailRow
      email={item}
      onPress={() => handleEmailPress(item.id)}
      onStarToggle={() => toggleStar(item.id)}
    />
  ), [handleEmailPress, toggleStar]);

  const keyExtractor = useCallback((item: EmailMessage) => item.id, []);

  const searchHeight = searchBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 52]});

  const currentFolderLabel = FOLDERS.find(f => f.key === selectedFolder)?.label ?? 'Inbox';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuButton} onPress={openDrawer} testID="email-menu">
            <Menu size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerCenter} onPress={() => setShowAccountPicker(true)}>
            <View style={[styles.headerAccountDot, { backgroundColor: activeAccount.color }]} />
            <Text style={styles.headerTitle} numberOfLines={1}>{currentFolderLabel}</Text>
            <ChevronDown size={16} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIcon} onPress={toggleSearch}>
              {showSearch ? <X size={20} color={Colors.text} strokeWidth={1.8} /> : <Search size={20} color={Colors.text} strokeWidth={1.8} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} onPress={markAllAsRead}>
              <CheckCheck size={20} color={Colors.text} strokeWidth={1.8} />
            </TouchableOpacity>
          </View>
        </View>

        {showSearch && (
          <Animated.View style={[styles.searchContainer, { height: searchHeight, opacity: searchBarAnim }]}>
            <View style={styles.searchBar}>
              <Search size={16} color={Colors.textTertiary} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search emails..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <X size={16} color={Colors.textTertiary} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        )}

        {sesStatus.configured && (
          <View style={styles.sesStatusBar}>
            <View style={[
              styles.sesStatusDot,
              sesStatus.status === 'active' && styles.sesStatusDotActive,
              sesStatus.status === 'error' && styles.sesStatusDotError,
              sesStatus.status === 'unreachable' && styles.sesStatusDotWarning,
            ]} />
            <Text style={styles.sesStatusText}>
              {sesStatus.status === 'active' ? 'AWS SES Connected' :
               sesStatus.status === 'error' ? 'SES Error' :
               sesStatus.status === 'unreachable' ? 'SES Unreachable' : 'Checking SES...'}
            </Text>
            {sesStatus.status === 'active' && sesStatus.quota && (
              <Text style={styles.sesQuotaText}>
                {Math.round(sesStatus.quota.sentLast24Hours)}/{Math.round(sesStatus.quota.max24Hour)} today
              </Text>
            )}
            {sesStatus.region && (
              <Text style={styles.sesRegionText}>{sesStatus.region}</Text>
            )}
          </View>
        )}

        <View style={styles.accountBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountBarScroll}>
            {accountsWithUnread.map(acc => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.accountChip, acc.id === activeAccount.id && styles.accountChipActive]}
                onPress={() => handleAccountSwitch(acc.id)}
              >
                <View style={[styles.accountChipDot, { backgroundColor: acc.color }]} />
                <Text style={[styles.accountChipText, acc.id === activeAccount.id && styles.accountChipTextActive]} numberOfLines={1}>
                  {acc.displayName}
                </Text>
                {acc.unreadCount > 0 && (
                  <View style={styles.accountChipBadge}>
                    <Text style={styles.accountChipBadgeText}>{acc.unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {lastFetchSource === 'cache' && (
          <View style={styles.sourceWarningBar}>
            <CircleAlert size={13} color="#E67E22" strokeWidth={2} />
            <Text style={styles.sourceWarningText}>Showing cached data — pull to refresh</Text>
          </View>
        )}

        {(inboxStatus === 'error' || inboxStatus === 'no_backend' || inboxStatus === 'no_auth') && (
          <View style={styles.inboxErrorBar}>
            <CircleAlert size={13} color={Colors.error} strokeWidth={2} />
            <Text style={styles.inboxErrorText}>
              {inboxStatus === 'no_auth' ? 'Please log in to access real inbox' :
               inboxStatus === 'no_backend' ? 'Email integration not configured' :
               backendError || 'Inbox unavailable'}
            </Text>
          </View>
        )}

        <FlatList
        onEndReachedThreshold={5}
        onEndReached={() => { /* IVX: pagination hook point */ }}
          data={emails}
          renderItem={renderEmail}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              {isLoading ? (
                <>
                  <Mail size={48} color={Colors.textTertiary} strokeWidth={1.2} />
                  <Text style={styles.emptyTitle}>Loading inbox...</Text>
                  <Text style={styles.emptySubtitle}>Connecting to mail server</Text>
                </>
              ) : inboxStatus === 'no_auth' ? (
                <>
                  <CircleAlert size={48} color={Colors.warning} strokeWidth={1.2} />
                  <Text style={styles.emptyTitle}>Authentication required</Text>
                  <Text style={styles.emptySubtitle}>Please log in to access your inbox</Text>
                </>
              ) : inboxStatus === 'no_backend' ? (
                <>
                  <CircleAlert size={48} color={Colors.textTertiary} strokeWidth={1.2} />
                  <Text style={styles.emptyTitle}>Email not configured</Text>
                  <Text style={styles.emptySubtitle}>Email backend integration is not set up</Text>
                </>
              ) : inboxStatus === 'error' ? (
                <>
                  <CircleAlert size={48} color={Colors.error} strokeWidth={1.2} />
                  <Text style={styles.emptyTitle}>Inbox unavailable</Text>
                  <Text style={styles.emptySubtitle}>{backendError || 'Could not connect to mail server'}</Text>
                </>
              ) : (
                <>
                  <Mail size={48} color={Colors.textTertiary} strokeWidth={1.2} />
                  <Text style={styles.emptyTitle}>
                    {searchQuery ? 'No results found' : 'No emails here'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {searchQuery
                      ? `No emails matching "${searchQuery}"`
                      : `Your ${currentFolderLabel.toLowerCase()} is empty`}
                  </Text>
                </>
              )}
            </View>
          }
        />

        <TouchableOpacity
          style={styles.fab}
          onPress={handleCompose}
          activeOpacity={0.85}
          testID="compose-email"
        >
          <Pen size={22} color={Colors.background} strokeWidth={2} />
        </TouchableOpacity>
      </SafeAreaView>

      {showDrawer && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Animated.View style={[styles.drawerOverlay, { opacity: overlayAnim }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeDrawer} activeOpacity={1} />
          </Animated.View>
          <Animated.View style={[styles.drawer, { transform: [{ translateX: drawerAnim }] }]}>
            <SafeAreaView style={styles.drawerSafe} edges={['top', 'bottom']}>
              <View style={styles.drawerHeader}>
                <View style={[styles.drawerAccountAvatar, { backgroundColor: activeAccount.color }]}>
                  <Text style={styles.drawerAccountAvatarText}>{activeAccount.avatar}</Text>
                </View>
                <Text style={styles.drawerAccountName}>{activeAccount.displayName}</Text>
                <Text style={styles.drawerAccountEmail}>{activeAccount.email}</Text>
              </View>

              <ScrollView style={styles.drawerBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.drawerSectionLabel}>FOLDERS</Text>
                {FOLDERS.map(folder => {
                  const count = folderCounts[folder.key as keyof typeof folderCounts] ?? 0;
                  const unreadCount = folder.key === 'inbox' ? folderCounts.inboxUnread : 0;
                  const isActive = selectedFolder === folder.key;
                  return (
                    <TouchableOpacity
                      key={folder.key}
                      style={[styles.drawerItem, isActive && styles.drawerItemActive]}
                      onPress={() => handleFolderSelect(folder.key)}
                    >
                      {React.cloneElement(folder.icon as React.ReactElement<any>, {
                        color: isActive ? Colors.primary : Colors.textSecondary})}
                      <Text style={[styles.drawerItemText, isActive && styles.drawerItemTextActive]}>
                        {folder.label}
                      </Text>
                      {(folder.key === 'inbox' && unreadCount > 0) ? (
                        <View style={styles.drawerBadge}>
                          <Text style={styles.drawerBadgeText}>{unreadCount}</Text>
                        </View>
                      ) : count > 0 ? (
                        <Text style={styles.drawerCount}>{count}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}

                <View style={styles.drawerDivider} />
                <Text style={styles.drawerSectionLabel}>ACCOUNTS</Text>
                {accountsWithUnread.map(acc => (
                  <TouchableOpacity
                    key={acc.id}
                    style={[styles.drawerItem, acc.id === activeAccount.id && styles.drawerItemActive]}
                    onPress={() => {
                      handleAccountSwitch(acc.id);
                      closeDrawer();
                    }}
                  >
                    <View style={[styles.drawerAccountDot, { backgroundColor: acc.color }]} />
                    <View style={styles.drawerAccountInfo}>
                      <Text style={[styles.drawerItemText, acc.id === activeAccount.id && styles.drawerItemTextActive]} numberOfLines={1}>
                        {acc.displayName}
                      </Text>
                      <Text style={styles.drawerAccountRole} numberOfLines={1}>{acc.email}</Text>
                    </View>
                    {acc.unreadCount > 0 && (
                      <View style={styles.drawerBadge}>
                        <Text style={styles.drawerBadgeText}>{acc.unreadCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}

      <Modal visible={showAccountPicker} transparent animationType="fade" onRequestClose={() => setShowAccountPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowAccountPicker(false)} activeOpacity={1}>
          <View style={styles.accountPickerModal}>
            <Text style={styles.accountPickerTitle}>Switch Account</Text>
            {accountsWithUnread.map(acc => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.accountPickerItem, acc.id === activeAccount.id && styles.accountPickerItemActive]}
                onPress={() => handleAccountSwitch(acc.id)}
              >
                <View style={[styles.accountPickerDot, { backgroundColor: acc.color }]} />
                <View style={styles.accountPickerInfo}>
                  <Text style={styles.accountPickerName}>{acc.displayName}</Text>
                  <Text style={styles.accountPickerEmail}>{acc.email}</Text>
                </View>
                {acc.unreadCount > 0 && (
                  <View style={styles.accountPickerBadge}>
                    <Text style={styles.accountPickerBadgeText}>{acc.unreadCount}</Text>
                  </View>
                )}
                {acc.id === activeAccount.id && <Check size={18} color={Colors.primary} strokeWidth={2.5} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    gap: 6},
  headerAccountDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  headerRight: {
    flexDirection: 'row',
    gap: 4},
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center'},
  searchContainer: {
    paddingHorizontal: 16,
    overflow: 'hidden'},
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
    marginTop: 4,
    marginBottom: 8},
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0},
  accountBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  accountBarScroll: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8},
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent'},
  accountChipActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(255,215,0,0.08)'},
  accountChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  accountChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    maxWidth: 80},
  accountChipTextActive: {
    color: Colors.primary},
  accountChipBadge: {
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4},
  accountChipBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.white},
  listContent: {
    paddingBottom: 100},
  emailRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background},
  emailRowUnread: {
    backgroundColor: 'rgba(255,215,0,0.03)'},
  emailRowLeft: {
    marginRight: 12},
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  avatarCircleUnread: {
    backgroundColor: 'rgba(255,215,0,0.12)'},
  avatarText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  avatarTextUnread: {
    color: Colors.primary},
  emailRowCenter: {
    flex: 1,
    gap: 3},
  emailRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  senderName: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    flex: 1,
    marginRight: 8},
  senderNameUnread: {
    fontWeight: '700' as const,
    color: Colors.text},
  emailRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5},
  emailDate: {
    fontSize: 11,
    color: Colors.textTertiary},
  emailDateUnread: {
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  emailSubject: {
    fontSize: 14,
    color: Colors.textSecondary},
  emailSubjectUnread: {
    fontWeight: '600' as const,
    color: Colors.text},
  emailPreview: {
    fontSize: 13,
    color: Colors.textTertiary,
    lineHeight: 18},
  labelRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 4},
  labelBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4},
  labelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  starButton: {
    paddingLeft: 8,
    paddingTop: 2},
  sesStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: 'rgba(255,215,0,0.04)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  sesStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary},
  sesStatusDotActive: {
    backgroundColor: Colors.success},
  sesStatusDotError: {
    backgroundColor: Colors.error},
  sesStatusDotWarning: {
    backgroundColor: Colors.warning},
  sesStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  sesQuotaText: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginLeft: 'auto' as const},
  sesRegionText: {
    fontSize: 10,
    color: Colors.textTertiary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden' as const},
  fab: {
    position: 'absolute' as const,
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8},
      android: { elevation: 8 },
      default: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8}})},
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    gap: 12},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    paddingHorizontal: 40},
  sourceWarningBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: 'rgba(230,126,34,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(230,126,34,0.2)'},
  sourceWarningText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: '#E67E22'},
  inboxErrorBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: 'rgba(231,76,60,0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(231,76,60,0.15)'},
  inboxErrorText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.error},
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)'},
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SCREEN_WIDTH * 0.82,
    backgroundColor: Colors.background,
    borderRightWidth: 1,
    borderRightColor: Colors.border},
  drawerSafe: {
    flex: 1},
  drawerHeader: {
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  drawerAccountAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12},
  drawerAccountAvatarText: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.white},
  drawerAccountName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text},
  drawerAccountEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2},
  drawerBody: {
    flex: 1,
    paddingTop: 12},
  drawerSectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    paddingHorizontal: 20,
    paddingVertical: 6,
    letterSpacing: 1},
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 11,
    gap: 14,
    marginHorizontal: 8,
    borderRadius: 10},
  drawerItemActive: {
    backgroundColor: 'rgba(255,215,0,0.08)'},
  drawerItemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary},
  drawerItemTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const},
  drawerBadge: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6},
  drawerBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.white},
  drawerCount: {
    fontSize: 12,
    color: Colors.textTertiary},
  drawerDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
    marginHorizontal: 20},
  drawerAccountDot: {
    width: 10,
    height: 10,
    borderRadius: 5},
  drawerAccountInfo: {
    flex: 1,
    gap: 1},
  drawerAccountRole: {
    fontSize: 11,
    color: Colors.textTertiary},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24},
  accountPickerModal: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%'},
  accountPickerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 16},
  accountPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 12,
    marginBottom: 4},
  accountPickerItemActive: {
    backgroundColor: 'rgba(255,215,0,0.08)'},
  accountPickerDot: {
    width: 12,
    height: 12,
    borderRadius: 6},
  accountPickerInfo: {
    flex: 1,
    gap: 2},
  accountPickerName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  accountPickerEmail: {
    fontSize: 12,
    color: Colors.textSecondary},
  accountPickerBadge: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 4},
  accountPickerBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.white}});
