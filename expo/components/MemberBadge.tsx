/**
 * IVX Member Classification Badge Component
 *
 * Displays the member's tier badge (PENDING, REGULAR, INVESTOR, VIP)
 * with appropriate colors and icons.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Clock,
  User,
  Briefcase,
  Crown,
  type LucideIcon} from 'lucide-react-native';
import { type MemberTier, type InvestorStatus, TIER_META, INVESTOR_STATUS_META } from '@/lib/classification-service';

interface MemberBadgeProps {
  tier: MemberTier;
  investorStatus?: InvestorStatus;
  size?: 'small' | 'medium' | 'large';
  showStatus?: boolean;
}

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock,
  user: User,
  briefcase: Briefcase,
  crown: Crown};

export function MemberBadge({ tier, investorStatus, size = 'medium', showStatus = false }: MemberBadgeProps) {
  const meta = TIER_META[tier];
  const Icon = ICON_MAP[meta.icon] || User;

  const sizeConfig = {
    small: { iconSize: 12, fontSize: 10, paddingH: 8, paddingV: 4, radius: 6 },
    medium: { iconSize: 14, fontSize: 12, paddingH: 12, paddingV: 6, radius: 8 },
    large: { iconSize: 18, fontSize: 14, paddingH: 16, paddingV: 8, radius: 10 }};
  const cfg = sizeConfig[size];

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: meta.bgColor,
            borderColor: meta.borderColor,
            paddingHorizontal: cfg.paddingH,
            paddingVertical: cfg.paddingV,
            borderRadius: cfg.radius},
        ]}
      >
        <Icon size={cfg.iconSize} color={meta.color} />
        <Text style={[styles.label, { fontSize: cfg.fontSize, color: meta.color, marginLeft: 4 }]}>
          {meta.shortLabel}
        </Text>
      </View>
      {showStatus && investorStatus && investorStatus !== 'NOT_VERIFIED' && (
        <Text style={[styles.status, { fontSize: cfg.fontSize - 1, color: INVESTOR_STATUS_META[investorStatus].color }]}>
          {INVESTOR_STATUS_META[investorStatus].label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1},
  label: {
    fontWeight: '700' as const,
    letterSpacing: 0.5},
  status: {
    fontWeight: '500' as const}});
