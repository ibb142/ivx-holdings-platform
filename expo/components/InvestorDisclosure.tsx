import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity} from 'react-native';
import { ChevronDown, ChevronUp, Shield } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface InvestorDisclosureProps {
  compact?: boolean;
}

export default function InvestorDisclosure({ compact = false }: InvestorDisclosureProps) {
  const [expanded, setExpanded] = useState(!compact);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <Shield size={16} color={Colors.textSecondary} />
          <Text style={styles.headerText}>Investment Risk Disclosure</Text>
        </View>
        {compact && (
          expanded
            ? <ChevronUp size={18} color={Colors.textSecondary} />
            : <ChevronDown size={18} color={Colors.textSecondary} />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <Text style={styles.disclosureText}>
            All investments involve risk, including the possible loss of principal. Past performance does not guarantee future results. Projected returns are estimates only and are not guaranteed. Real estate investments are illiquid and may not be suitable for all investors.
          </Text>
          <Text style={styles.disclosureText}>
            IVX Holdings LLC does not provide investment advice. You should consult with a qualified financial advisor before making any investment decisions. By proceeding, you acknowledge that you understand and accept these risks.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  body: {
    paddingTop: 4,
    gap: 8},
  disclosureText: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16}});
