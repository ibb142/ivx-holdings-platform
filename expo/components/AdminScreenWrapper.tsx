import React, { useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface AdminScreenWrapperProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  headerRight?: React.ReactNode;
  testID?: string;
}

function AdminScreenWrapperInner({
  title,
  subtitle,
  icon,
  children,
  isLoading = false,
  isRefreshing = false,
  onRefresh,
  headerRight,
  testID}: AdminScreenWrapperProps) {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View style={styles.container} testID={testID}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.titleRow}>
              {icon ? <View style={styles.headerIcon}>{renderSafeViewChildren(icon)}</View> : null}
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
            </View>
            {subtitle && (
              <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
            )}
          </View>
          <View style={styles.headerRightSlot}>
            {renderSafeViewChildren(headerRight)}
          </View>
        </View>
      </SafeAreaView>

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={Colors.primary}
                colors={[Colors.primary]}
              />
            ) : undefined
          }
        >
          {renderSafeViewChildren(children)}
        </ScrollView>
      )}
    </View>
  );
}

export const AdminScreenWrapper = React.memo(AdminScreenWrapperInner);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeTop: {
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    marginLeft: 12},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center'},
  headerIcon: {
    marginRight: 8},
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    flex: 1},
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2},
  headerRightSlot: {
    marginLeft: 8},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 40},
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14}});
