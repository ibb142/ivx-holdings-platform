import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  FileText,
  Download,
  Mail,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle,
  Shield,
  Users,
  Building2,
  Wallet,
  TrendingUp,
  Bell,
  MessageSquare,
  Settings,
  BarChart3,
    Handshake,
  Brain,
  Gift,
  Lock,
  Palette,
  FileCheck,
  Plug,
  Filter,
  RefreshCw,
  Share2,
  Printer,
  ShieldCheck,
  LineChart,
  FileSpreadsheet,
  ArrowLeft,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';

import Colors from '@/constants/colors';
import {
  FUNCTIONALITY_REGISTRY,
  APP_INFO,
  getTotalFeatures,
  getTotalModules,
  getActiveFeatures,
  getBetaFeatures,
  generateTextReport,
  generateCSVReport,
  generateExcelHTML,
} from '@/mocks/functionality-registry';

const ICON_MAP: Record<string, React.ReactNode> = {
  Lock: <Lock size={20} color="#6366F1" />,
  Shield: <Shield size={20} color="#00C48C" />,
  Users: <Users size={20} color="#6366F1" />,
  Building2: <Building2 size={20} color="#F59E0B" />,
  TrendingUp: <TrendingUp size={20} color="#EC4899" />,
  BarChart3: <BarChart3 size={20} color="#8B5CF6" />,
  Wallet: <Wallet size={20} color="#14B8A6" />,
  Gift: <Gift size={20} color="#F97316" />,
  IVXBrandIcon: <IVXBrandIcon size={20} />,
  Bell: <Bell size={20} color="#FF4D4D" />,
  Brain: <Brain size={20} color="#A855F7" />,
  MessageSquare: <MessageSquare size={20} color="#4A90D9" />,
  Handshake: <Handshake size={20} color="#84CC16" />,
  Settings: <Settings size={20} color="#555555" />,
  ShieldCheck: <ShieldCheck size={20} color="#DC2626" />,
  Palette: <Palette size={20} color="#D946EF" />,
  LineChart: <LineChart size={20} color="#0EA5E9" />,
  FileCheck: <FileCheck size={20} color="#78716C" />,
  Plug: <Plug size={20} color="#00C48C" />,
};

export default function AppDocsScreen() {
  const router = useRouter();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [searchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'beta' | 'coming_soon'>('all');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const totalFeatures = useMemo(() => getTotalFeatures(), []);
  const totalModules = useMemo(() => getTotalModules(), []);
  const activeFeatures = useMemo(() => getActiveFeatures(), []);
  const betaFeatures = useMemo(() => getBetaFeatures(), []);
  

  const filteredModules = useMemo(() => {
    return FUNCTIONALITY_REGISTRY.map(module => {
      const filteredFeatures = module.features.filter(feature => {
        const matchesSearch = searchQuery === '' || 
          feature.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          module.title.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = filterStatus === 'all' || feature.status === filterStatus;
        return matchesSearch && matchesStatus;
      });
      return { ...module, features: filteredFeatures };
    }).filter(module => module.features.length > 0);
  }, [searchQuery, filterStatus]);

  const toggleModule = useCallback((moduleId: string) => {
    setExpandedModules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(moduleId)) {
        newSet.delete(moduleId);
      } else {
        newSet.add(moduleId);
      }
      return newSet;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedModules(new Set(FUNCTIONALITY_REGISTRY.map(m => m.id)));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedModules(new Set());
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    const content = generateTextReport();
    await Clipboard.setStringAsync(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    Alert.alert('Copied!', 'Documentation copied to clipboard. You can now paste it anywhere.');
  }, []);

  const handleGeneratePDF = useCallback(async () => {
    setIsGeneratingPDF(true);
    try {
      const html = generateExcelHTML();
      
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          setTimeout(() => printWindow.print(), 500);
        }
      } else {
        const { uri } = await Print.printToFileAsync({
          html,
          base64: false,
        });
        console.log('PDF generated at:', uri);
        await Share.share({
          title: 'IVXHOLDINGS App Documentation',
          url: uri,
        });
      }
    } catch (error) {
      console.error('PDF generation error:', error);
      Alert.alert('Error', 'Failed to generate PDF. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  }, []);

  const handleShareWhatsApp = useCallback(async () => {
    const content = generateTextReport();
    const shortSummary = `📱 *IVXHOLDINGS App Documentation*\n\n📦 ${totalModules} Modules\n✅ ${totalFeatures} Features\n🟢 ${activeFeatures} Active\n\n_Full report attached_`;

    try {
      if (Platform.OS === 'web') {
        const message = encodeURIComponent(shortSummary + '\n\n' + content.substring(0, 2500) + '...');
        window.open(`https://wa.me/?text=${message}`, '_blank');
      } else {
        const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(shortSummary + '\n\n' + content)}`;
        const canOpen = await Linking.canOpenURL(whatsappUrl);
        if (canOpen) {
          await Linking.openURL(whatsappUrl);
        } else {
          await Share.share({ message: shortSummary + '\n\n' + content });
        }
      }
    } catch (error) {
      console.log('WhatsApp share error:', error);
      await Share.share({ message: content });
    }
  }, [totalModules, totalFeatures, activeFeatures]);

  const handleShareEmail = useCallback(async () => {
    const content = generateTextReport();
    const subject = 'IVXHOLDINGS App - Complete Functionality Documentation';
    
    try {
      if (Platform.OS === 'web') {
        const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`;
        window.open(mailtoUrl, '_blank');
      } else {
        const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`;
        const canOpen = await Linking.canOpenURL(mailtoUrl);
        if (canOpen) {
          await Linking.openURL(mailtoUrl);
        } else {
          await Share.share({
            title: subject,
            message: content,
          });
        }
      }
    } catch (error) {
      console.log('Email share error:', error);
      await Share.share({ message: content });
    }
  }, []);

  const handleDownloadText = useCallback(() => {
    const content = generateTextReport();
    
    if (Platform.OS === 'web') {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IVXHOLDINGS-App-Documentation-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Alert.alert('Downloaded!', 'Text file has been downloaded.');
    } else {
      void Share.share({
        title: 'IVXHOLDINGS App Documentation',
        message: content,
      });
    }
  }, []);

  const handleExportExcel = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        const excelContent = generateExcelHTML();
        const blob = new Blob([excelContent], { 
          type: 'application/vnd.ms-excel;charset=utf-8' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `IVXHOLDINGS-App-Functionality-${new Date().toISOString().split('T')[0]}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert('Downloaded!', 'Excel file has been downloaded.');
      } else {
        const csvContent = generateCSVReport();
        await Share.share({
          title: 'IVXHOLDINGS App Functionality - Excel/CSV',
          message: csvContent,
        });
      }
    } catch (error) {
      console.log('Excel export error:', error);
      const csvContent = generateCSVReport();
      await Share.share({ message: csvContent });
    }
  }, []);

  const handleShareGeneral = useCallback(async () => {
    const content = generateTextReport();
    try {
      await Share.share({
        title: 'IVXHOLDINGS App - Functionality Documentation',
        message: content,
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  }, []);

  const getModuleIcon = (iconName: string) => {
    return ICON_MAP[iconName] || <FileText size={20} color={Colors.primary} />;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#00C48C';
      case 'beta': return '#F59E0B';
      case 'coming_soon': return '#555555';
      default: return Colors.textSecondary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Active';
      case 'beta': return 'Beta';
      case 'coming_soon': return 'Soon';
      default: return status;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerIcon}>
            <FileText size={32} color={Colors.primary} />
          </View>
          <Text style={styles.headerTitle}>Smart Functionality Tracker</Text>
          <Text style={styles.headerSubtitle}>
            Auto-updated list of all modules and features
          </Text>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>v{APP_INFO.version}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{totalModules}</Text>
            <Text style={styles.statLabel}>Modules</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{totalFeatures}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={[styles.statCard, styles.statActive]}>
            <Text style={[styles.statNumber, { color: '#00C48C' }]}>{activeFeatures}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#F59E0B' }]}>{betaFeatures}</Text>
            <Text style={styles.statLabel}>Beta</Text>
          </View>
        </View>

        <View style={styles.exportSection}>
          <Text style={styles.sectionTitle}>Export & Share</Text>
          
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportButton, styles.pdfButton]}
              onPress={handleGeneratePDF}
              disabled={isGeneratingPDF}
            >
              {isGeneratingPDF ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Printer size={18} color="#fff" />
              )}
              <Text style={styles.exportButtonText}>
                {isGeneratingPDF ? 'Creating...' : 'PDF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, styles.whatsappButton]}
              onPress={handleShareWhatsApp}
            >
              <MessageCircle size={18} color="#fff" />
              <Text style={styles.exportButtonText}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, styles.emailButton]}
              onPress={handleShareEmail}
            >
              <Mail size={18} color="#fff" />
              <Text style={styles.exportButtonText}>Email</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportButton, styles.excelButton]}
              onPress={handleExportExcel}
            >
              <FileSpreadsheet size={18} color="#fff" />
              <Text style={styles.exportButtonText}>Excel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, styles.copyButton]}
              onPress={handleCopyToClipboard}
            >
              {copied ? (
                <CheckCircle size={18} color="#fff" />
              ) : (
                <Copy size={18} color="#fff" />
              )}
              <Text style={styles.exportButtonText}>
                {copied ? 'Copied!' : 'Copy'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, styles.shareButton]}
              onPress={handleShareGeneral}
            >
              <Share2 size={18} color="#fff" />
              <Text style={styles.exportButtonText}>Share</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportButton, styles.downloadButton]}
              onPress={handleDownloadText}
            >
              <Download size={18} color="#fff" />
              <Text style={styles.exportButtonText}>Text File</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.filterSection}>
          <View style={styles.filterHeader}>
            <Filter size={16} color={Colors.textSecondary} />
            <Text style={styles.filterLabel}>Filter by status:</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            <View style={styles.filterChips}>
              {(['all', 'active', 'beta', 'coming_soon'] as const).map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.filterChip,
                    filterStatus === status && styles.filterChipActive,
                  ]}
                  onPress={() => setFilterStatus(status)}
                >
                  <Text style={[
                    styles.filterChipText,
                    filterStatus === status && styles.filterChipTextActive,
                  ]}>
                    {status === 'all' ? 'All' : 
                     status === 'active' ? 'Active' :
                     status === 'beta' ? 'Beta' : 'Coming Soon'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.modulesSection}>
          <View style={styles.modulesSectionHeader}>
            <Text style={styles.sectionTitle}>
              All Modules ({filteredModules.length})
            </Text>
            <View style={styles.expandCollapseButtons}>
              <TouchableOpacity onPress={expandAll} style={styles.expandButton}>
                <Text style={styles.expandButtonText}>Expand</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={collapseAll} style={styles.collapseButton}>
                <Text style={styles.collapseButtonText}>Collapse</Text>
              </TouchableOpacity>
            </View>
          </View>

          {filteredModules.map((module, index) => {
            const isExpanded = expandedModules.has(module.id);
            const originalModule = FUNCTIONALITY_REGISTRY.find(m => m.id === module.id);
            return (
              <View key={module.id} style={styles.moduleCard}>
                <TouchableOpacity
                  style={styles.moduleHeader}
                  onPress={() => toggleModule(module.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.moduleHeaderLeft}>
                    <View style={[styles.moduleIcon, { backgroundColor: `${module.color}15` }]}>
                      {getModuleIcon(module.icon)}
                    </View>
                    <View style={styles.moduleInfo}>
                      <Text style={styles.moduleNumber}>Module {index + 1}</Text>
                      <Text style={styles.moduleTitle}>{module.title}</Text>
                      <Text style={styles.moduleDesc} numberOfLines={1}>
                        {module.description}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.moduleHeaderRight}>
                    <View style={styles.featureCountBadge}>
                      <Text style={styles.featureCountText}>
                        {module.features.length}
                        {originalModule && module.features.length !== originalModule.features.length && 
                          `/${originalModule.features.length}`}
                      </Text>
                    </View>
                    {isExpanded ? (
                      <ChevronDown size={20} color={Colors.textSecondary} />
                    ) : (
                      <ChevronRight size={20} color={Colors.textSecondary} />
                    )}
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.featuresList}>
                    {module.features.map((feature, fIndex) => (
                      <View key={feature.id} style={styles.featureItem}>
                        <View style={styles.featureLeft}>
                          <Text style={styles.featureNumber}>{fIndex + 1}.</Text>
                          <Text style={styles.featureText}>{feature.name}</Text>
                        </View>
                        <View style={[
                          styles.statusBadge,
                          { backgroundColor: `${getStatusColor(feature.status)}15` }
                        ]}>
                          <Text style={[
                            styles.statusText,
                            { color: getStatusColor(feature.status) }
                          ]}>
                            {getStatusLabel(feature.status)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Quick Summary</Text>
          <View style={styles.summaryCard}>
            {FUNCTIONALITY_REGISTRY.map((module) => (
              <View key={module.id} style={styles.summaryRow}>
                <View style={styles.summaryLeft}>
                  {getModuleIcon(module.icon)}
                  <Text style={styles.summaryModuleName} numberOfLines={1}>
                    {module.title}
                  </Text>
                </View>
                <Text style={styles.summaryCount}>{module.features.length}</Text>
              </View>
            ))}
            <View style={styles.summaryTotal}>
              <Text style={styles.summaryTotalLabel}>TOTAL FEATURES</Text>
              <Text style={styles.summaryTotalCount}>{totalFeatures}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <RefreshCw size={20} color={Colors.primary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Auto-Updated Registry</Text>
            <Text style={styles.infoText}>
              This list automatically updates when new features are added to the app. 
              Export anytime to share with your team.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {APP_INFO.name}
          </Text>
          <Text style={styles.footerDate}>
            Last Updated: {new Date().toLocaleDateString()}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 20, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginTop: 4 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  versionBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  versionText: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center', marginBottom: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  statNumber: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  exportSection: { marginBottom: 16 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  exportRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exportButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  exportButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  pdfButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  whatsappButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  emailButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  copyButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  downloadButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  shareButton: { padding: 8 },
  excelButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  filterSection: { marginBottom: 12 },
  filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  filterLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 8 },
  filterScroll: { marginBottom: 12 },
  filterChips: { flexDirection: 'row', gap: 8 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  modulesSection: { marginBottom: 16 },
  modulesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  expandCollapseButtons: { gap: 4 },
  expandButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  expandButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  collapseButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  collapseButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  moduleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  moduleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  moduleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  moduleInfo: { flex: 1 },
  moduleNumber: { gap: 4 },
  moduleTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  moduleDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  moduleHeaderRight: { alignItems: 'flex-end' },
  featureCountBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  featureCountText: { color: Colors.textSecondary, fontSize: 13 },
  featuresList: { gap: 8 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  featureLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  featureNumber: { gap: 4 },
  featureText: { color: Colors.textSecondary, fontSize: 13 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  summarySection: { marginBottom: 16 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  summaryModuleName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  summaryCount: { gap: 4 },
  summaryTotal: { gap: 4 },
  summaryTotalLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryTotalCount: { gap: 4 },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoContent: { flex: 1, gap: 4 },
  infoTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  footerText: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center' },
  footerDate: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 4 },
});
