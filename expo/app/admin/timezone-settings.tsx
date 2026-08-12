/**
 * =============================================================================
 * IVX OWNER DASHBOARD — TIME ZONE SETTINGS
 * =============================================================================
 *
 * Owner Time Zone Settings screen with:
 *  - UTC display mode
 *  - Owner Time display mode
 *  - User Time display mode
 *  - Property Time display mode
 *  - Custom Time Zone selector
 *  - Auto-detect button
 *  - Current device timezone info
 *  - DST status for all test cities
 *  - 12h/24h preference toggle
 * =============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Globe,
  Clock,
  MapPin,
  Sun,
  Moon,
  RefreshCw,
  Check,
  ChevronRight,
  Search} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  type IanaTimezone,
  type TimeDisplayMode,
  type HourPreference,
  type TimezoneProfile,
  type DetectedTimezone,
  detectDeviceTimezone,
  autoDetectAndSaveTimezone,
  loadTimezoneProfile,
  saveTimezoneProfile,
  saveDisplayMode,
  loadDisplayMode,
  saveCustomTimezone,
  loadCustomTimezone,
  getTimezonesByRegion,
  getUtcOffsetMinutes,
  getOffsetString,
  isDst,
  isValidTimezone,
  nowUtc,
  formatTimestamp,
  getDeviceIdentifier,
  SUPPORTED_TEST_CITIES} from '@/lib/time-service';

const DISPLAY_MODES: Array<{ mode: TimeDisplayMode; label: string; description: string; icon: typeof Globe }> = [
  { mode: 'utc',       label: 'UTC',           description: 'Coordinated Universal Time — server standard', icon: Globe },
  { mode: 'owner',     label: 'Owner Time',    description: 'Display in the owner\'s local timezone', icon: Clock },
  { mode: 'user',      label: 'User Time',     description: 'Display in each user\'s local timezone', icon: MapPin },
  { mode: 'property',  label: 'Property Time', description: 'Display in the property\'s local timezone', icon: MapPin },
  { mode: 'custom',    label: 'Custom Time Zone', description: 'Select a specific timezone for all displays', icon: Globe },
];

export default function TimeZoneSettingsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<TimezoneProfile | null>(null);
  const [detected, setDetected] = useState<DetectedTimezone | null>(null);
  const [displayMode, setDisplayMode] = useState<TimeDisplayMode>('local');
  const [customTz, setCustomTz] = useState<IanaTimezone | null>(null);
  const [hourPref, setHourPref] = useState<HourPreference>('12h');
  const [showTimezonePicker, setShowTimezonePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverTime, setServerTime] = useState(nowUtc());
  const [device, setDevice] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [savedProfile, savedMode, savedCustomTz, deviceDetected] = await Promise.all([
        loadTimezoneProfile(),
        loadDisplayMode(),
        loadCustomTimezone(),
        Promise.resolve(detectDeviceTimezone()),
      ]);
      setProfile(savedProfile);
      setDisplayMode(savedMode);
      setCustomTz(savedCustomTz);
      setDetected(deviceDetected);
      setHourPref(savedProfile?.hour_preference || deviceDetected.hour_preference);
      setDevice(getDeviceIdentifier());
    } catch (error) {
      console.error('[TimeZoneSettings] Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    const timer = setInterval(() => setServerTime(nowUtc()), 1000);
    return () => clearInterval(timer);
  }, [loadSettings]);

  const handleAutoDetect = useCallback(async () => {
    setSaving(true);
    try {
      const newProfile = await autoDetectAndSaveTimezone();
      setProfile(newProfile);
      setDetected(detectDeviceTimezone());
      setHourPref(newProfile.hour_preference);
      Alert.alert('Timezone Detected', `Timezone: ${newProfile.timezone}\nOffset: ${getOffsetString(newProfile.utc_offset)}\nCountry: ${newProfile.country || 'Unknown'}`);
    } catch (error) {
      Alert.alert('Detection Failed', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleDisplayModeChange = useCallback(async (mode: TimeDisplayMode) => {
    setDisplayMode(mode);
    await saveDisplayMode(mode);
  }, []);

  const handleHourPrefToggle = useCallback(async (is24h: boolean) => {
    const newPref: HourPreference = is24h ? '24h' : '12h';
    setHourPref(newPref);
    if (profile) {
      const updated = { ...profile, hour_preference: newPref, last_timezone_update: nowUtc() };
      setProfile(updated);
      await saveTimezoneProfile(updated);
    }
  }, [profile]);

  const handleCustomTimezoneSelect = useCallback(async (tz: IanaTimezone) => {
    setCustomTz(tz);
    await saveCustomTimezone(tz);
    setShowTimezonePicker(false);
    setSearchQuery('');
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await saveTimezoneProfile(profile);
      Alert.alert('Saved', 'Timezone profile saved successfully.');
    } catch (error) {
      Alert.alert('Save Failed', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }, [profile]);

  const timezonesByRegion = getTimezonesByRegion();
  const filteredTimezones = React.useMemo(() => {
    if (!searchQuery.trim()) return timezonesByRegion;
    const query = searchQuery.toLowerCase();
    const result: Record<string, IanaTimezone[]> = {};
    for (const [region, tzs] of Object.entries(timezonesByRegion)) {
      const filtered = tzs.filter(tz =>
        tz.toLowerCase().includes(query) ||
        tz.replace(/_/g, ' ').toLowerCase().includes(query)
      );
      if (filtered.length > 0) result[region] = filtered;
    }
    return result;
  }, [searchQuery, timezonesByRegion]);

  const currentOffset = profile ? getOffsetString(profile.utc_offset) : 'UTC+00:00';
  const currentDst = profile ? isDst(profile.timezone) : false;
  const formattedServerTime = formatTimestamp(serverTime, profile?.timezone || 'UTC', profile?.locale || 'en-US', hourPref);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Time Zone Settings</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading timezone settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Time Zone Settings</Text>
        <TouchableOpacity onPress={handleAutoDetect} style={styles.backButton} disabled={saving}>
          {saving ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={22} color={Colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Current Time Display */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CURRENT TIME</Text>
          <View style={styles.currentTimeCard}>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Your Time</Text>
              <Text style={styles.timeValue}>{formattedServerTime.formatted_time}</Text>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Timezone</Text>
              <Text style={styles.timeValue}>{profile?.timezone || 'UTC'}</Text>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Offset</Text>
              <Text style={styles.timeValue}>{currentOffset}</Text>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>DST Active</Text>
              <View style={styles.dstBadge}>
                {currentDst ? <Sun size={12} color={Colors.success} /> : <Moon size={12} color={Colors.textTertiary} />}
                <Text style={[styles.dstText, { color: currentDst ? Colors.success : Colors.textTertiary }]}>
                  {currentDst ? 'Yes' : 'No'}
                </Text>
              </View>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>UTC Server</Text>
              <Text style={styles.timeValueMono}>{serverTime.substring(11, 19)}Z</Text>
            </View>
          </View>
        </View>

        {/* Auto-Detected Info */}
        {detected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DEVICE DETECTION</Text>
            <View style={styles.infoCard}>
              <InfoRow label="IANA Timezone" value={detected.timezone} />
              <InfoRow label="UTC Offset" value={getOffsetString(detected.utc_offset)} />
              <InfoRow label="Country" value={detected.country || 'Unknown'} />
              <InfoRow label="Region" value={detected.region || 'Unknown'} />
              <InfoRow label="Locale" value={detected.locale} />
              <InfoRow label="Device" value={device} />
              <InfoRow label="Source" value={detected.source} />
            </View>
          </View>
        )}

        {/* Display Mode Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DISPLAY MODE</Text>
          <Text style={styles.sectionDescription}>Choose how timestamps are displayed in reports, dashboards, and audit logs.</Text>
          {DISPLAY_MODES.map(({ mode, label, description, icon: Icon }) => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeCard, displayMode === mode && styles.modeCardActive]}
              onPress={() => handleDisplayModeChange(mode)}
            >
              <View style={styles.modeIconContainer}>
                <Icon size={20} color={displayMode === mode ? Colors.primary : Colors.textTertiary} />
              </View>
              <View style={styles.modeContent}>
                <Text style={[styles.modeLabel, displayMode === mode && styles.modeLabelActive]}>{label}</Text>
                <Text style={styles.modeDescription}>{description}</Text>
              </View>
              {displayMode === mode && <Check size={20} color={Colors.primary} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Timezone Picker */}
        {displayMode === 'custom' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CUSTOM TIMEZONE</Text>
            <TouchableOpacity style={styles.customTzButton} onPress={() => setShowTimezonePicker(!showTimezonePicker)}>
              <Text style={styles.customTzValue}>{customTz || 'Select timezone...'}</Text>
              <ChevronRight size={20} color={Colors.textTertiary} />
            </TouchableOpacity>

            {showTimezonePicker && (
              <View style={styles.pickerContainer}>
                <View style={styles.searchContainer}>
                  <Search size={16} color={Colors.textTertiary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search timezone..."
                    placeholderTextColor={Colors.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>
                <ScrollView style={styles.pickerList} nestedScrollEnabled>
                  {Object.entries(filteredTimezones).map(([region, tzs]) => (
                    <View key={region}>
                      <Text style={styles.pickerRegionLabel}>{region}</Text>
                      {tzs.map((tz) => (
                        <TouchableOpacity
                          key={tz}
                          style={[styles.pickerItem, customTz === tz && styles.pickerItemActive]}
                          onPress={() => handleCustomTimezoneSelect(tz)}
                        >
                          <Text style={[styles.pickerItemText, customTz === tz && styles.pickerItemTextActive]}>
                            {tz.replace(/_/g, ' ')}
                          </Text>
                          <Text style={styles.pickerItemOffset}>{getOffsetString(getUtcOffsetMinutes(tz))}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* Hour Preference */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TIME FORMAT</Text>
          <View style={styles.toggleCard}>
            <View style={styles.toggleContent}>
              <Text style={styles.toggleLabel}>24-Hour Format</Text>
              <Text style={styles.toggleDescription}>
                {hourPref === '24h' ? '14:30' : '2:30 PM'} — Toggle between 12h and 24h clock
              </Text>
            </View>
            <Switch
              value={hourPref === '24h'}
              onValueChange={handleHourPrefToggle}
              trackColor={{ false: Colors.surfaceBorder, true: Colors.primary }}
              ios_backgroundColor={Colors.surfaceBorder}
            />
          </View>
        </View>

        {/* Test Cities DST Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WORLD CLOCK — DST STATUS</Text>
          <View style={styles.citiesCard}>
            {SUPPORTED_TEST_CITIES.map((city, index) => {
              const offset = getUtcOffsetMinutes(city.timezone);
              const dst = isDst(city.timezone);
              const cityTime = formatTimestamp(serverTime, city.timezone, 'en-US', hourPref);
              return (
                <View key={city.city} style={[styles.cityRow, index < SUPPORTED_TEST_CITIES.length - 1 && styles.cityRowBorder]}>
                  <View style={styles.cityLeft}>
                    <Text style={styles.cityName}>{city.city}</Text>
                    <Text style={styles.cityTimezone}>{city.timezone}</Text>
                  </View>
                  <View style={styles.cityRight}>
                    <Text style={styles.cityTime}>{cityTime.formatted_time}</Text>
                    <View style={styles.cityOffsetRow}>
                      <Text style={styles.cityOffset}>{getOffsetString(offset)}</Text>
                      {dst && <Sun size={10} color={Colors.success} />}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveProfile} disabled={saving}>
          {saving ? (
            <ShimmerIndicator size="small" color={Colors.black} />
          ) : (
            <Text style={styles.saveButtonText}>Save Profile</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All timestamps are stored in UTC. Display conversion happens at the client level using your timezone profile.
            DST is automatically handled by the IANA timezone database.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text},
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  loadingText: {
    fontSize: 14,
    color: Colors.textTertiary,
    marginTop: 12},
  scrollView: {
    flex: 1},
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40},
  section: {
    marginTop: 24},
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 10},
  sectionDescription: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginBottom: 12},
  currentTimeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  timeLabel: {
    fontSize: 14,
    color: Colors.textTertiary},
  timeValue: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  timeValueMono: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    fontFamily: 'monospace'},
  dstBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  dstText: {
    fontSize: 14,
    fontWeight: '600' as const},
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6},
  infoLabel: {
    fontSize: 13,
    color: Colors.textTertiary},
  infoValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  modeCardActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(0, 196, 140, 0.05)'},
  modeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12},
  modeContent: {
    flex: 1},
  modeLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  modeLabelActive: {
    color: Colors.primary},
  modeDescription: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  customTzButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  customTzValue: {
    fontSize: 15,
    color: Colors.text},
  pickerContainer: {
    marginTop: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    maxHeight: 350},
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text},
  pickerList: {
    maxHeight: 280},
  pickerRegionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    letterSpacing: 1,
    paddingVertical: 6,
    paddingHorizontal: 4},
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8},
  pickerItemActive: {
    backgroundColor: 'rgba(0, 196, 140, 0.1)'},
  pickerItemText: {
    fontSize: 14,
    color: Colors.text},
  pickerItemTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const},
  pickerItemOffset: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontFamily: 'monospace'},
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  toggleContent: {
    flex: 1},
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  toggleDescription: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  citiesCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12},
  cityRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder},
  cityLeft: {
    flex: 1},
  cityName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  cityTimezone: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2},
  cityRight: {
    alignItems: 'flex-end'},
  cityTime: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    fontFamily: 'monospace'},
  cityOffsetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2},
  cityOffset: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontFamily: 'monospace'},
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24},
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.black},
  footer: {
    marginTop: 20,
    paddingHorizontal: 4},
  footerText: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18}});
