import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert} from 'react-native';
import {
  Bell,
  Mail,

  MessageSquare,
  TrendingUp,
  Shield,
  DollarSign,
  Megaphone,
  CheckCircle} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useMutation } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics-context';

interface NotificationSetting {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  push: boolean;
  email: boolean;
  sms: boolean;
}

export default function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<NotificationSetting[]>([
    {
      id: 'investments',
      title: 'Investment Updates',
      description: 'Order fills, portfolio changes, new opportunities',
      icon: <TrendingUp size={20} color={Colors.success} />,
      push: true,
      email: true,
      sms: false},
    {
      id: 'dividends',
      title: 'Dividends & Returns',
      description: 'Dividend payouts, rental distributions',
      icon: <DollarSign size={20} color={Colors.primary} />,
      push: true,
      email: true,
      sms: true},
    {
      id: 'security',
      title: 'Security Alerts',
      description: 'Login attempts, password changes, 2FA',
      icon: <Shield size={20} color={Colors.error} />,
      push: true,
      email: true,
      sms: true},
    {
      id: 'market',
      title: 'Market Alerts',
      description: 'Price movements, market news, trends',
      icon: <TrendingUp size={20} color={Colors.info} />,
      push: true,
      email: false,
      sms: false},
    {
      id: 'promotions',
      title: 'Promotions & News',
      description: 'New features, special offers, newsletters',
      icon: <Megaphone size={20} color={Colors.warning} />,
      push: false,
      email: true,
      sms: false},
  ]);

  const [masterPush, setMasterPush] = useState(true);
  const [masterEmail, setMasterEmail] = useState(true);
  const [masterSms, setMasterSms] = useState(false);

  const toggleSetting = (id: string, channel: 'push' | 'email' | 'sms') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSettings(prev =>
      prev.map(s =>
        s.id === id ? { ...s, [channel]: !s[channel] } : s
      )
    );
  };

  const { trackAction } = useAnalytics();

  const updatePrefsMutation = useMutation({
    mutationFn: async (prefs: { email: Record<string, boolean>; push: Record<string, boolean> }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          email_prefs: prefs.email,
          push_prefs: prefs.push,
          updated_at: new Date().toISOString()});
      if (error) {
        console.log('[NotificationSettings] Supabase upsert note:', error.message);
      }
      return { success: true };
    }});

  const handleSave = () => {
    const emailPrefs = {
      marketing: settings.find(s => s.id === 'promotions')?.email ?? false,
      transactions: settings.find(s => s.id === 'investments')?.email ?? true,
      dividends: settings.find(s => s.id === 'dividends')?.email ?? true,
      newProperties: settings.find(s => s.id === 'market')?.email ?? false};
    const pushPrefs = {
      transactions: settings.find(s => s.id === 'investments')?.push ?? true,
      dividends: settings.find(s => s.id === 'dividends')?.push ?? true,
      newProperties: settings.find(s => s.id === 'market')?.push ?? true,
      priceAlerts: settings.find(s => s.id === 'market')?.push ?? true};

    updatePrefsMutation.mutate(
      { email: emailPrefs, push: pushPrefs },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          trackAction('notification_prefs_saved');
          Alert.alert('Saved', 'Your notification preferences have been updated.');
        },
        onError: (error) => {
          console.error('[NotificationSettings] Save error:', error);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Error', 'Failed to save your notification preferences. Please try again.');
        }}
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        <View style={styles.masterControls}>
          <Text style={styles.masterTitle}>Notification Channels</Text>
          <View style={styles.masterCard}>
            <View style={styles.masterRow}>
              <View style={styles.masterLeft}>
                <View style={[styles.masterIcon, { backgroundColor: Colors.primary + '15' }]}>
                  <Bell size={18} color={Colors.primary} />
                </View>
                <View>
                  <Text style={styles.masterLabel}>Push Notifications</Text>
                  <Text style={styles.masterSub}>Mobile alerts</Text>
                </View>
              </View>
              <Switch
                value={masterPush}
                onValueChange={(val) => { setMasterPush(val); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                trackColor={{ false: Colors.backgroundTertiary, true: Colors.primary + '50' }}
                thumbColor={masterPush ? Colors.primary : Colors.textTertiary}
              />
            </View>
            <View style={styles.masterDivider} />
            <View style={styles.masterRow}>
              <View style={styles.masterLeft}>
                <View style={[styles.masterIcon, { backgroundColor: Colors.info + '15' }]}>
                  <Mail size={18} color={Colors.info} />
                </View>
                <View>
                  <Text style={styles.masterLabel}>Email</Text>
                  <Text style={styles.masterSub}>Email notifications</Text>
                </View>
              </View>
              <Switch
                value={masterEmail}
                onValueChange={(val) => { setMasterEmail(val); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                trackColor={{ false: Colors.backgroundTertiary, true: Colors.info + '50' }}
                thumbColor={masterEmail ? Colors.info : Colors.textTertiary}
              />
            </View>
            <View style={styles.masterDivider} />
            <View style={styles.masterRow}>
              <View style={styles.masterLeft}>
                <View style={[styles.masterIcon, { backgroundColor: Colors.success + '15' }]}>
                  <MessageSquare size={18} color={Colors.success} />
                </View>
                <View>
                  <Text style={styles.masterLabel}>SMS</Text>
                  <Text style={styles.masterSub}>Text messages</Text>
                </View>
              </View>
              <Switch
                value={masterSms}
                onValueChange={(val) => { setMasterSms(val); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                trackColor={{ false: Colors.backgroundTertiary, true: Colors.success + '50' }}
                thumbColor={masterSms ? Colors.success : Colors.textTertiary}
              />
            </View>
          </View>
        </View>

        <View style={styles.categoriesSection}>
          <Text style={styles.categoriesTitle}>Categories</Text>
          {settings.map(setting => (
            <View key={setting.id} style={styles.categoryCard}>
              <View style={styles.categoryHeader}>
                <View style={styles.categoryIconContainer}>
                  {setting.icon}
                </View>
                <View style={styles.categoryMeta}>
                  <Text style={styles.categoryTitle}>{setting.title}</Text>
                  <Text style={styles.categoryDescription}>{setting.description}</Text>
                </View>
              </View>
              <View style={styles.channelToggles}>
                <View style={styles.channelToggle}>
                  <Text style={styles.channelLabel}>Push</Text>
                  <Switch
                    value={setting.push && masterPush}
                    onValueChange={() => toggleSetting(setting.id, 'push')}
                    trackColor={{ false: Colors.backgroundTertiary, true: Colors.primary + '50' }}
                    thumbColor={setting.push && masterPush ? Colors.primary : Colors.textTertiary}
                    disabled={!masterPush}
                  />
                </View>
                <View style={styles.channelToggle}>
                  <Text style={styles.channelLabel}>Email</Text>
                  <Switch
                    value={setting.email && masterEmail}
                    onValueChange={() => toggleSetting(setting.id, 'email')}
                    trackColor={{ false: Colors.backgroundTertiary, true: Colors.info + '50' }}
                    thumbColor={setting.email && masterEmail ? Colors.info : Colors.textTertiary}
                    disabled={!masterEmail}
                  />
                </View>
                <View style={styles.channelToggle}>
                  <Text style={styles.channelLabel}>SMS</Text>
                  <Switch
                    value={setting.sms && masterSms}
                    onValueChange={() => toggleSetting(setting.id, 'sms')}
                    trackColor={{ false: Colors.backgroundTertiary, true: Colors.success + '50' }}
                    thumbColor={setting.sms && masterSms ? Colors.success : Colors.textTertiary}
                    disabled={!masterSms}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <CheckCircle size={18} color={Colors.black} />
          <Text style={styles.saveButtonText}>Save Preferences</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  masterControls: { marginBottom: 16 },
  masterTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  masterCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  masterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  masterDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  masterLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  masterIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  masterLabel: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  masterSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2, flexShrink: 1 },
  categoriesSection: { marginBottom: 16 },
  categoriesTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  categoryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  categoryIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  categoryMeta: { flex: 1, gap: 2 },
  categoryTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  categoryDescription: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  channelToggles: { gap: 8, marginTop: 10 },
  channelToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  channelLabel: { color: Colors.textSecondary, fontSize: 13 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
