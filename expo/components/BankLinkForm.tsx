import React, { useState, useCallback } from 'react';
import {View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity} from "react-native";
import { Building2, Check, Link2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface BankLinkFormProps {
  onBankLinked: (bank: BankData | null) => void;
  disabled?: boolean;
}

export interface BankData {
  bankName: string;
  accountType: 'checking' | 'savings';
  last4: string;
  isLinked: boolean;
}

const TEST_BANKS = [
  { name: 'Chase', logo: '🏦', last4: '4521' },
  { name: 'Bank of America', logo: '🏛️', last4: '7832' },
  { name: 'Wells Fargo', logo: '🏪', last4: '2156' },
  { name: 'Citi', logo: '🏢', last4: '9043' },
];

export default function BankLinkForm({ onBankLinked, disabled }: BankLinkFormProps) {
  const [isLinking, setIsLinking] = useState(false);
  const [linkedBank, setLinkedBank] = useState<BankData | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking');

  const simulatePlaidLink = useCallback(async (bank: typeof TEST_BANKS[0]) => {
    setIsLinking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const bankData: BankData = {
      bankName: bank.name,
      accountType: 'checking',
      last4: bank.last4,
      isLinked: true};

    setLinkedBank(bankData);
    onBankLinked(bankData);
    setIsLinking(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [onBankLinked]);

  const handleManualLink = useCallback(async () => {
    if (routingNumber.length !== 9 || accountNumber.length < 8) {
      return;
    }

    setIsLinking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const bankData: BankData = {
      bankName: 'Manual Bank Account',
      accountType,
      last4: accountNumber.slice(-4),
      isLinked: true};

    setLinkedBank(bankData);
    onBankLinked(bankData);
    setIsLinking(false);
    setShowManualEntry(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [routingNumber, accountNumber, accountType, onBankLinked]);

  const unlinkBank = useCallback(() => {
    setLinkedBank(null);
    onBankLinked(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [onBankLinked]);

  if (linkedBank) {
    return (
      <View style={styles.linkedContainer}>
        <View style={styles.linkedHeader}>
          <View style={styles.linkedIcon}>
            <Building2 size={20} color={Colors.success} />
          </View>
          <View style={styles.linkedInfo}>
            <Text style={styles.linkedBankName}>{linkedBank.bankName}</Text>
            <Text style={styles.linkedAccountInfo}>
              {linkedBank.accountType.charAt(0).toUpperCase() + linkedBank.accountType.slice(1)} ••••{linkedBank.last4}
            </Text>
          </View>
          <View style={styles.linkedBadge}>
            <Check size={14} color={Colors.success} />
            <Text style={styles.linkedBadgeText}>Linked</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.unlinkButton}
          onPress={unlinkBank}
          disabled={disabled}
        >
          <Text style={styles.unlinkText}>Unlink Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLinking) {
    return (
      <View style={styles.linkingContainer}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.linkingText}>Connecting to your bank...</Text>
        <Text style={styles.linkingSubtext}>This simulates Plaid Link</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.plaidSection}>
        <View style={styles.plaidHeader}>
          <Link2 size={18} color={Colors.primary} />
          <Text style={styles.plaidTitle}>Connect with Plaid (Simulated)</Text>
        </View>
        <Text style={styles.plaidDescription}>
          Select a test bank to simulate Plaid Link connection
        </Text>
        <View style={styles.bankGrid}>
          {TEST_BANKS.map((bank, index) => (
            <TouchableOpacity
              key={index}
              style={styles.bankOption}
              onPress={() => simulatePlaidLink(bank)}
              disabled={disabled}
            >
              <Text style={styles.bankLogo}>{bank.logo}</Text>
              <Text style={styles.bankName}>{bank.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        style={styles.manualToggle}
        onPress={() => setShowManualEntry(!showManualEntry)}
        disabled={disabled}
      >
        <Text style={styles.manualToggleText}>
          {showManualEntry ? 'Hide Manual Entry' : 'Enter Account Manually'}
        </Text>
      </TouchableOpacity>

      {showManualEntry && (
        <View style={styles.manualSection}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Routing Number</Text>
            <TextInput
              style={styles.input}
              value={routingNumber}
              onChangeText={(text) => setRoutingNumber(text.replace(/\D/g, '').slice(0, 9))}
              placeholder="123456789"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              maxLength={9}
              editable={!disabled}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Account Number</Text>
            <TextInput
              style={styles.input}
              value={accountNumber}
              onChangeText={(text) => setAccountNumber(text.replace(/\D/g, '').slice(0, 17))}
              placeholder="••••••••1234"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              maxLength={17}
              editable={!disabled}
            />
          </View>

          <View style={styles.accountTypeContainer}>
            <Text style={styles.inputLabel}>Account Type</Text>
            <View style={styles.accountTypeButtons}>
              <TouchableOpacity
                style={[
                  styles.accountTypeButton,
                  accountType === 'checking' && styles.accountTypeButtonActive,
                ]}
                onPress={() => setAccountType('checking')}
                disabled={disabled}
              >
                <Text style={[
                  styles.accountTypeText,
                  accountType === 'checking' && styles.accountTypeTextActive,
                ]}>
                  Checking
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.accountTypeButton,
                  accountType === 'savings' && styles.accountTypeButtonActive,
                ]}
                onPress={() => setAccountType('savings')}
                disabled={disabled}
              >
                <Text style={[
                  styles.accountTypeText,
                  accountType === 'savings' && styles.accountTypeTextActive,
                ]}>
                  Savings
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.linkManualButton,
              (routingNumber.length !== 9 || accountNumber.length < 8) && styles.linkManualButtonDisabled,
            ]}
            onPress={handleManualLink}
            disabled={disabled || routingNumber.length !== 9 || accountNumber.length < 8}
          >
            <Text style={styles.linkManualText}>Link Bank Account</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16},
  plaidSection: {
    backgroundColor: Colors.primary + '08',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20'},
  plaidHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8},
  plaidTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary},
  plaidDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12},
  bankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  bankOption: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  bankLogo: {
    fontSize: 24,
    marginBottom: 6},
  bankName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center'},
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.surfaceBorder},
  dividerText: {
    fontSize: 12,
    color: Colors.textTertiary},
  manualToggle: {
    alignSelf: 'center'},
  manualToggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary},
  manualSection: {
    gap: 12},
  inputContainer: {
    gap: 6},
  inputLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  input: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  accountTypeContainer: {
    gap: 8},
  accountTypeButtons: {
    flexDirection: 'row',
    gap: 10},
  accountTypeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  accountTypeButtonActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  accountTypeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  accountTypeTextActive: {
    color: Colors.primary},
  linkManualButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center'},
  linkManualButtonDisabled: {
    backgroundColor: Colors.primary + '50'},
  linkManualText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.black},
  linkingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12},
  linkingText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text},
  linkingSubtext: {
    fontSize: 12,
    color: Colors.textTertiary},
  linkedContainer: {
    backgroundColor: Colors.success + '10',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.success + '30'},
  linkedHeader: {
    flexDirection: 'row',
    alignItems: 'center'},
  linkedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.success + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12},
  linkedInfo: {
    flex: 1},
  linkedBankName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  linkedAccountInfo: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2},
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '20',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6},
  linkedBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.success},
  unlinkButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center'},
  unlinkText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.error}});
