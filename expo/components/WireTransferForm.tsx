import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert} from 'react-native';
import { 
  Banknote, 
  Copy, 
  Building2, 
  MapPin, 
  Globe, 
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  FileText} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { BankTransferInstructions } from '@/lib/payment-service';
import { formatNumber, formatCurrencyWithDecimals } from '@/lib/formatters';

interface WireTransferFormProps {
  amount: number;
  fee: number;
  onWireTypeChange: (type: 'domestic' | 'international') => void;
  wireType: 'domestic' | 'international';
  disabled?: boolean;
}

export default function WireTransferForm({
  amount,
  fee,
  onWireTypeChange,
  wireType,
  disabled = false}: WireTransferFormProps) {
  return (
    <View style={styles.container}>
      <View style={styles.wireTypeSelector}>
        <TouchableOpacity
          style={[
            styles.wireTypeButton,
            wireType === 'domestic' && styles.wireTypeButtonActive,
          ]}
          onPress={() => onWireTypeChange('domestic')}
          disabled={disabled}
        >
          <Building2 
            size={18} 
            color={wireType === 'domestic' ? Colors.primary : Colors.textSecondary} 
          />
          <Text style={[
            styles.wireTypeText,
            wireType === 'domestic' && styles.wireTypeTextActive,
          ]}>
            Domestic (US)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.wireTypeButton,
            wireType === 'international' && styles.wireTypeButtonActive,
          ]}
          onPress={() => onWireTypeChange('international')}
          disabled={disabled}
        >
          <Globe 
            size={18} 
            color={wireType === 'international' ? Colors.primary : Colors.textSecondary} 
          />
          <Text style={[
            styles.wireTypeText,
            wireType === 'international' && styles.wireTypeTextActive,
          ]}>
            International
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoHeader}>
          <Clock size={16} color={Colors.textSecondary} />
          <Text style={styles.infoText}>
            {wireType === 'domestic' 
              ? 'Domestic wires are typically processed same day if initiated before 4:00 PM ET'
              : 'International wires take 2-5 business days depending on your bank'
            }
          </Text>
        </View>
      </View>

      <View style={styles.feeNotice}>
        <AlertTriangle size={16} color={Colors.warning} />
        <Text style={styles.feeNoticeText}>
          Wire transfer fee: {formatCurrencyWithDecimals(fee)} • Minimum amount: $1,000
          {wireType === 'international' && '\nAdditional correspondent bank fees may apply'}
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Transfer Amount</Text>
          <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(amount)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Processing Fee</Text>
          <Text style={[styles.summaryValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(fee)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.summaryRowTotal]}>
          <Text style={styles.summaryLabelTotal}>You Will Receive</Text>
          <Text style={styles.summaryValueTotal}>{formatCurrencyWithDecimals(amount - fee)}</Text>
        </View>
      </View>
    </View>
  );
}

interface WireInstructionsDisplayProps {
  instructions: BankTransferInstructions;
  amount: number;
}

export function WireInstructionsDisplay({ instructions, amount }: WireInstructionsDisplayProps) {
  const [showIntermediaryBank, setShowIntermediaryBank] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', `${label} copied to clipboard`);
  }, []);

  const copyAllDetails = useCallback(async () => {
    const details = `
Wire Transfer Details
=====================
Bank Name: ${instructions.bankName}
Account Name: ${instructions.accountName}
Account Number: ${instructions.accountNumber}
Routing Number (ABA): ${instructions.routingNumber}
${instructions.swiftCode ? `SWIFT/BIC Code: ${instructions.swiftCode}` : ''}
${instructions.iban ? `IBAN: ${instructions.iban}` : ''}

Reference Number: ${instructions.reference}
${instructions.fedReference ? `FED Reference: ${instructions.fedReference}` : ''}
${instructions.memo ? `Memo: ${instructions.memo}` : ''}

Bank Address:
${instructions.bankAddress?.line1 || ''}
${instructions.bankAddress?.city}, ${instructions.bankAddress?.state} ${instructions.bankAddress?.postalCode}
${instructions.bankAddress?.country}

Beneficiary:
${instructions.beneficiaryAddress?.name || ''}
${instructions.beneficiaryAddress?.line1 || ''}
${instructions.beneficiaryAddress?.line2 || ''}
${instructions.beneficiaryAddress?.city}, ${instructions.beneficiaryAddress?.state} ${instructions.beneficiaryAddress?.postalCode}
${instructions.beneficiaryAddress?.country}

Amount: ${formatNumber(amount)}
    `.trim();

    await Clipboard.setStringAsync(details);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'All wire transfer details copied to clipboard');
  }, [instructions, amount]);

  return (
    <ScrollView style={styles.instructionsContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.instructionsHeader}>
        <View style={styles.instructionsIconContainer}>
          <Banknote size={28} color={Colors.primary} />
        </View>
        <Text style={styles.instructionsTitle}>
          {instructions.wireType === 'international' ? 'International' : 'Domestic'} Wire Instructions
        </Text>
        <Text style={styles.instructionsSubtitle}>
          Use these details to complete your wire transfer
        </Text>
      </View>

      <TouchableOpacity style={styles.copyAllButton} onPress={copyAllDetails}>
        <Copy size={16} color={Colors.primary} />
        <Text style={styles.copyAllText}>Copy All Details</Text>
      </TouchableOpacity>

      <View style={styles.detailsSection}>
        <Text style={styles.sectionTitle}>Beneficiary Bank Details</Text>
        
        <DetailRow
          label="Bank Name"
          value={instructions.bankName}
          onCopy={() => copyToClipboard(instructions.bankName, 'Bank Name')}
        />
        <DetailRow
          label="Account Name"
          value={instructions.accountName}
          onCopy={() => copyToClipboard(instructions.accountName, 'Account Name')}
        />
        <DetailRow
          label="Account Number"
          value={instructions.accountNumber}
          onCopy={() => copyToClipboard(instructions.accountNumber, 'Account Number')}
          highlight
        />
        <DetailRow
          label="Routing Number (ABA)"
          value={instructions.routingNumber}
          onCopy={() => copyToClipboard(instructions.routingNumber, 'Routing Number')}
          highlight
        />
        {instructions.swiftCode && (
          <DetailRow
            label="SWIFT/BIC Code"
            value={instructions.swiftCode}
            onCopy={() => copyToClipboard(instructions.swiftCode!, 'SWIFT Code')}
            highlight
          />
        )}
        {instructions.iban && (
          <DetailRow
            label="IBAN"
            value={instructions.iban}
            onCopy={() => copyToClipboard(instructions.iban!, 'IBAN')}
          />
        )}
      </View>

      {instructions.bankAddress && (
        <View style={styles.detailsSection}>
          <View style={styles.sectionHeader}>
            <MapPin size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Bank Address</Text>
          </View>
          <View style={styles.addressCard}>
            <Text style={styles.addressText}>{instructions.bankAddress.line1}</Text>
            {instructions.bankAddress.line2 && (
              <Text style={styles.addressText}>{instructions.bankAddress.line2}</Text>
            )}
            <Text style={styles.addressText}>
              {instructions.bankAddress.city}, {instructions.bankAddress.state} {instructions.bankAddress.postalCode}
            </Text>
            <Text style={styles.addressText}>{instructions.bankAddress.country}</Text>
          </View>
        </View>
      )}

      {instructions.beneficiaryAddress && (
        <View style={styles.detailsSection}>
          <View style={styles.sectionHeader}>
            <Building2 size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Beneficiary Details</Text>
          </View>
          <View style={styles.addressCard}>
            <Text style={styles.beneficiaryName}>{instructions.beneficiaryAddress.name}</Text>
            <Text style={styles.addressText}>{instructions.beneficiaryAddress.line1}</Text>
            {instructions.beneficiaryAddress.line2 && (
              <Text style={styles.addressText}>{instructions.beneficiaryAddress.line2}</Text>
            )}
            <Text style={styles.addressText}>
              {instructions.beneficiaryAddress.city}, {instructions.beneficiaryAddress.state} {instructions.beneficiaryAddress.postalCode}
            </Text>
            <Text style={styles.addressText}>{instructions.beneficiaryAddress.country}</Text>
          </View>
        </View>
      )}

      {instructions.intermediaryBank && (
        <View style={styles.detailsSection}>
          <TouchableOpacity 
            style={styles.collapsibleHeader}
            onPress={() => setShowIntermediaryBank(!showIntermediaryBank)}
          >
            <View style={styles.sectionHeader}>
              <Globe size={16} color={Colors.textSecondary} />
              <Text style={styles.sectionTitle}>Intermediary/Correspondent Bank</Text>
            </View>
            {showIntermediaryBank ? (
              <ChevronUp size={20} color={Colors.textSecondary} />
            ) : (
              <ChevronDown size={20} color={Colors.textSecondary} />
            )}
          </TouchableOpacity>
          
          {showIntermediaryBank && (
            <View style={styles.intermediaryDetails}>
              <DetailRow
                label="Bank Name"
                value={instructions.intermediaryBank.bankName}
                onCopy={() => copyToClipboard(instructions.intermediaryBank!.bankName, 'Intermediary Bank')}
              />
              <DetailRow
                label="SWIFT Code"
                value={instructions.intermediaryBank.swiftCode}
                onCopy={() => copyToClipboard(instructions.intermediaryBank!.swiftCode, 'Intermediary SWIFT')}
                highlight
              />
              {instructions.intermediaryBank.routingNumber && (
                <DetailRow
                  label="Routing Number"
                  value={instructions.intermediaryBank.routingNumber}
                  onCopy={() => copyToClipboard(instructions.intermediaryBank!.routingNumber!, 'Intermediary Routing')}
                />
              )}
              {instructions.intermediaryBank.address && (
                <View style={styles.addressCard}>
                  <Text style={styles.addressText}>{instructions.intermediaryBank.address.line1}</Text>
                  <Text style={styles.addressText}>
                    {instructions.intermediaryBank.address.city}, {instructions.intermediaryBank.address.state} {instructions.intermediaryBank.address.postalCode}
                  </Text>
                  <Text style={styles.addressText}>{instructions.intermediaryBank.address.country}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.referenceSection}>
        <Text style={styles.referenceSectionTitle}>Payment Reference</Text>
        <Text style={styles.referenceNote}>Include this reference in your wire transfer memo</Text>
        
        <TouchableOpacity 
          style={styles.referenceBox}
          onPress={() => copyToClipboard(instructions.reference, 'Reference')}
        >
          <View>
            <Text style={styles.referenceLabel}>Reference Number</Text>
            <Text style={styles.referenceValue}>{instructions.reference}</Text>
          </View>
          <Copy size={20} color={Colors.primary} />
        </TouchableOpacity>

        {instructions.fedReference && (
          <TouchableOpacity 
            style={styles.referenceBox}
            onPress={() => copyToClipboard(instructions.fedReference!, 'FED Reference')}
          >
            <View>
              <Text style={styles.referenceLabel}>FED Reference</Text>
              <Text style={styles.referenceValue}>{instructions.fedReference}</Text>
            </View>
            <Copy size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}

        {instructions.memo && (
          <TouchableOpacity 
            style={styles.referenceBox}
            onPress={() => copyToClipboard(instructions.memo!, 'Memo')}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.referenceLabel}>Memo/Description</Text>
              <Text style={styles.memoValue}>{instructions.memo}</Text>
            </View>
            <Copy size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.detailsSection}>
        <TouchableOpacity 
          style={styles.collapsibleHeader}
          onPress={() => setShowInstructions(!showInstructions)}
        >
          <View style={styles.sectionHeader}>
            <FileText size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Step-by-Step Instructions</Text>
          </View>
          {showInstructions ? (
            <ChevronUp size={20} color={Colors.textSecondary} />
          ) : (
            <ChevronDown size={20} color={Colors.textSecondary} />
          )}
        </TouchableOpacity>

        {showInstructions && (
          <View style={styles.instructionsList}>
            {instructions.instructions.map((instruction, index) => (
              <View key={index} style={styles.instructionItem}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.instructionText}>{instruction.replace(/^\d+\.\s*/, '')}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {instructions.expiresAt && (
        <View style={styles.expirationNotice}>
          <Clock size={14} color={Colors.warning} />
          <Text style={styles.expirationText}>
            These instructions expire on {new Date(instructions.expiresAt).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'})}
          </Text>
        </View>
      )}

      <View style={styles.securityNotice}>
        <CheckCircle size={16} color={Colors.success} />
        <Text style={styles.securityText}>
          Your wire transfer is protected by bank-grade security. We will notify you once the funds are received and credited to your account.
        </Text>
      </View>
    </ScrollView>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  onCopy: () => void;
  highlight?: boolean;
}

function DetailRow({ label, value, onCopy, highlight = false }: DetailRowProps) {
  return (
    <TouchableOpacity style={styles.detailRow} onPress={onCopy}>
      <View style={styles.detailContent}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={[styles.detailValue, highlight && styles.detailValueHighlight]}>{value}</Text>
      </View>
      <Copy size={16} color={Colors.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16},
  wireTypeSelector: {
    flexDirection: 'row',
    gap: 12},
  wireTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: 'transparent'},
  wireTypeButtonActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary},
  wireTypeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  wireTypeTextActive: {
    color: Colors.primary},
  infoCard: {
    backgroundColor: Colors.backgroundTertiary,
    padding: 14,
    borderRadius: 12},
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10},
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18},
  feeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.warning + '15',
    padding: 14,
    borderRadius: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '30'},
  feeNoticeText: {
    flex: 1,
    fontSize: 13,
    color: Colors.warning,
    fontWeight: '500' as const,
    lineHeight: 18},
  summaryCard: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    padding: 16},
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  summaryRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    marginTop: 8,
    paddingTop: 12},
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary},
  summaryValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  summaryLabelTotal: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  summaryValueTotal: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.success},
  instructionsContainer: {
    flex: 1},
  instructionsHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: 16},
  instructionsIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12},
  instructionsTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  instructionsSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary},
  copyAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: Colors.primary + '10',
    borderRadius: 10,
    marginBottom: 20},
  copyAllText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary},
  detailsSection: {
    marginBottom: 20},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    marginBottom: 8},
  detailContent: {
    flex: 1,
    marginRight: 12},
  detailLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4},
  detailValue: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  detailValueHighlight: {
    color: Colors.primary,
    fontFamily: 'monospace'},
  addressCard: {
    backgroundColor: Colors.backgroundTertiary,
    padding: 14,
    borderRadius: 10},
  addressText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22},
  beneficiaryName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8},
  intermediaryDetails: {
    marginTop: 8},
  referenceSection: {
    backgroundColor: Colors.primary + '10',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  referenceSectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primary,
    marginBottom: 4},
  referenceNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16},
  referenceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 10,
    marginBottom: 10},
  referenceLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4},
  referenceValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primary,
    fontFamily: 'monospace'},
  memoValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  instructionsList: {
    gap: 12,
    marginTop: 8},
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12},
  instructionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center'},
  instructionNumberText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary},
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20},
  expirationNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.warning + '15',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16},
  expirationText: {
    flex: 1,
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '500' as const},
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.success + '10',
    padding: 14,
    borderRadius: 10,
    marginBottom: 20},
  securityText: {
    flex: 1,
    fontSize: 13,
    color: Colors.success,
    lineHeight: 18}});
