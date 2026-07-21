import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Href } from 'expo-router';
import { Bell } from 'lucide-react-native';
import Colors from '@/constants/colors';
import IVXBrandLogo from '@/components/IVXBrandLogo';

interface BrandBannerProps {
  notificationCount?: number;
}

export default function BrandBanner({ notificationCount = 2 }: BrandBannerProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleNotificationPress = () => {
    router.push('/notifications' as Href);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.banner}>
        <View style={styles.leftSection}>
          <IVXBrandLogo
            variant="symbol"
            size="sm"
            theme="dark"
            containerStyle={styles.logoContainer}
            accessibilityLabel="IVX HOLDINGS LLC logo"
          />
          <Text style={styles.brandText}>IVX HOLDINGS LLC</Text>
        </View>
        
        <TouchableOpacity 
          style={styles.notificationButton} 
          onPress={handleNotificationPress}
          testID="notification-button"
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={notificationCount > 0 ? `Notifications, ${notificationCount} unread` : 'Notifications'}
          accessibilityHint="Opens notifications screen"
        >
          <Bell size={24} color="#FFFFFF" />
          {notificationCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {notificationCount > 9 ? '9+' : notificationCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logoContainer: {
    marginRight: 12,
  },
  brandText: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#E53935',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700' as const,
  },
});
