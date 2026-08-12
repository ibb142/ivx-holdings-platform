import React, { useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert} from 'react-native';
import {
  FileText,
  Download,
  CheckCircle,
  Clock,
  Calendar,
  Info,
  Shield} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { useAnalytics } from '@/lib/analytics-context';

interface TaxDocument {
  id: string;
  name: string;
  type: '1099-DIV' | '1099-INT' | '1099-B' | 'K-1' | 'Annual Summary';
  year: string;
  date: string;
  status: 'available' | 'pending' | 'processing';
  description: string;
}

const TAX_DOCUMENTS: TaxDocument[] = [
  {
    id: '1',
    name: '1099-DIV',
    type: '1099-DIV',
    year: '2024',
    date: '2025-01-31',
    status: 'available',
    description: 'Dividend income from real estate investments'},
  {
    id: '2',
    name: '1099-B',
    type: '1099-B',
    year: '2024',
    date: '2025-02-15',
    status: 'available',
    description: 'Proceeds from property share sales'},
  {
    id: '3',
    name: 'K-1 Schedule',
    type: 'K-1',
    year: '2024',
    date: '2025-03-15',
    status: 'processing',
    description: 'Partnership income allocation'},
  {
    id: '4',
    name: 'Annual Tax Summary',
    type: 'Annual Summary',
    year: '2024',
    date: '2025-01-31',
    status: 'available',
    description: 'Complete summary of all taxable events'},
  {
    id: '5',
    name: '1099-DIV',
    type: '1099-DIV',
    year: '2023',
    date: '2024-01-31',
    status: 'available',
    description: 'Dividend income from real estate investments'},
  {
    id: '6',
    name: 'Annual Tax Summary',
    type: 'Annual Summary',
    year: '2023',
    date: '2024-01-31',
    status: 'available',
    description: 'Complete summary of all taxable events'},
];

export default function TaxDocumentsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const [selectedYear, setSelectedYear] = useState('2024');

  const years = [...new Set(TAX_DOCUMENTS.map(d => d.year))].sort((a, b) => Number(b) - Number(a));

  const filteredDocs = TAX_DOCUMENTS.filter(d => d.year === selectedYear);

  const { trackAction } = useAnalytics();

  const handleDownload = (doc: TaxDocument) => {
    if (doc.status !== 'available') {
      Alert.alert('Not Ready', 'This document is still being processed. You will be notified when it is ready.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Download Tax Document',
      `${doc.name} (${doc.year}) will be prepared for download.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: () => {
          trackAction('tax_document_downloaded', { type: doc.type, year: doc.year });
          logger.taxDocs.log('Download requested:', doc.id, doc.name, doc.year);
          Alert.alert('Preparing', 'Your tax document is being generated. Check your email in a few minutes.');
        }},
      ]
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available': return <CheckCircle size={16} color={Colors.success} />;
      case 'processing': return <Clock size={16} color={Colors.warning} />;
      case 'pending': return <Clock size={16} color={Colors.textTertiary} />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'available': return 'Ready';
      case 'processing': return 'Processing';
      case 'pending': return 'Pending';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return Colors.success;
      case 'processing': return Colors.warning;
      case 'pending': return Colors.textTertiary;
      default: return Colors.textTertiary;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        <View style={styles.yearSelector}>
          {years.map(year => (
            <TouchableOpacity
              key={year}
              style={[styles.yearButton, selectedYear === year && styles.yearButtonActive]}
              onPress={() => setSelectedYear(year)}
            >
              <Calendar size={14} color={selectedYear === year ? Colors.black : Colors.textTertiary} />
              <Text style={[styles.yearText, selectedYear === year && styles.yearTextActive]}>
                {year}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.deadlineCard}>
          <Shield size={18} color={Colors.warning} />
          <View style={styles.deadlineMeta}>
            <Text style={styles.deadlineTitle}>Tax Filing Deadline</Text>
            <Text style={styles.deadlineDate}>April 15, {Number(selectedYear) + 1}</Text>
          </View>
        </View>

        <View style={styles.listContainer}>
          {filteredDocs.map(doc => (
            <TouchableOpacity
              key={doc.id}
              style={styles.docCard}
              onPress={() => handleDownload(doc)}
              activeOpacity={0.7}
            >
              <View style={styles.docLeft}>
                <View style={styles.docIconContainer}>
                  <FileText size={22} color={Colors.primary} />
                </View>
                <View style={styles.docMeta}>
                  <Text style={styles.docName}>{doc.name}</Text>
                  <Text style={styles.docDescription}>{doc.description}</Text>
                  <View style={styles.docFooter}>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(doc.status) + '15' }]}>
                      {getStatusIcon(doc.status)}
                      <Text style={[styles.statusText, { color: getStatusColor(doc.status) }]}>
                        {getStatusText(doc.status)}
                      </Text>
                    </View>
                    <Text style={styles.docDate}>
                      {new Date(doc.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </View>
                </View>
              </View>
              {doc.status === 'available' && (
                <View style={styles.downloadButton}>
                  <Download size={18} color={Colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.infoCard}>
          <Info size={18} color={Colors.info} />
          <Text style={styles.infoText}>
            Tax documents are generated based on your investment activity. 1099 forms are available by January 31. K-1 schedules may be available by March 15. Please consult a tax professional for filing guidance.
          </Text>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  yearSelector: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  yearButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  yearButtonActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  yearText: { color: Colors.textSecondary, fontSize: 13 },
  yearTextActive: { color: '#000' },
  deadlineCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  deadlineMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deadlineTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  deadlineDate: { color: Colors.textTertiary, fontSize: 12 },
  listContainer: { gap: 10 },
  docCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  docLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  docIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  docDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  docFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  docDate: { color: Colors.textTertiary, fontSize: 12 },
  downloadButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
