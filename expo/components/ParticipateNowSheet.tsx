/**
 * IVX Participate Now Sheet
 *
 * Bottom sheet that appears when a deal has multiple active pathways.
 * Shows available participation options and routes to the correct page.
 *
 * Tokenized: From $50/share
 * JV Partnership: From $20,000
 * Buyer Offer: Starting from current asking price
 */

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  X,
  Coins,
  Handshake,
  Home,
  ChevronRight,
  Shield} from 'lucide-react-native';
import Colors from '@/constants/colors';

export interface ParticipateNowOption {
  id: 'tokenized' | 'jv' | 'buyer';
  label: string;
  subtitle: string;
  minAmount: string;
  icon: 'coins' | 'handshake' | 'home';
  enabled: boolean;
  status: string;
  route: string;
}

interface ParticipateNowSheetProps {
  visible: boolean;
  onClose: () => void;
  dealSlug: string;
  options: ParticipateNowOption[];
}

function getIcon(icon: string, size: number, color: string) {
  switch (icon) {
    case 'coins': return <Coins color={color} size={size} />;
    case 'handshake': return <Handshake color={color} size={size} />;
    case 'home': return <Home color={color} size={size} />;
    default: return <Coins color={color} size={size} />;
  }
}

function ParticipateNowSheet({ visible, onClose, dealSlug, options }: ParticipateNowSheetProps) {
  const activeOptions = options.filter(o => o.enabled);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.overlayTouch} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Participate Now</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color={Colors.textSecondary} size={20} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Choose how you'd like to participate in this project.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.optionsList}>
            {activeOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={styles.optionCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onClose();
                  // Navigation handled by parent component
                }}
              >
                <View style={styles.optionIconWrap}>
                  {getIcon(option.icon, 24, Colors.primary)}
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
                  <Text style={styles.optionMinAmount}>{option.minAmount}</Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            ))}

            {activeOptions.length === 0 && (
              <View style={styles.emptyState}>
                <Shield color={Colors.textTertiary} size={32} />
                <Text style={styles.emptyText}>
                  No participation pathways are currently available for this project.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              All investments involve risk. Not FDIC insured. May lose value.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default memo(ParticipateNowSheet);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end'},
  overlayTouch: {
    flex: 1},
  sheet: {
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
    maxHeight: '80%'},
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 4},
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700'},
  closeButton: {
    padding: 8},
  subtitle: {
    color: '#909090',
    fontSize: 14,
    paddingHorizontal: 20,
    marginBottom: 16},
  optionsList: {
    paddingHorizontal: 20},
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A'},
  optionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(230,194,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14},
  optionInfo: {
    flex: 1},
  optionLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2},
  optionSubtitle: {
    color: '#909090',
    fontSize: 13,
    marginBottom: 4},
  optionMinAmount: {
    color: '#E6C200',
    fontSize: 14,
    fontWeight: '600'},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32},
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12},
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    marginTop: 8},
  footerText: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center'}});
