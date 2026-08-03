import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  Platform,
  Modal,
  Linking} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Users,
  Building2,
  Download,
  Search,
  ChevronDown,
  ChevronUp,
  PieChart,
  BarChart3,
  Clock,
  Percent,
  ArrowUpRight,
  Filter,
  X,
  MessageCircle,
  FileText,
  Mail,
  Share2,
  CheckCircle,
  Copy,
  ArrowLeft} from 'lucide-react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatCurrencyWithDecimals as _fmtCurrDec } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface InvestorProfit {
  id: string;
  name: string;
  email: string;
  totalInvested: number;
  totalProfit: number;
  rentalIncome: number;
  appreciation: number;
  dividends: number;
  roi: number;
  hourlyRate: number;
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  yearlyProjection: number;
  lastPayout: string;
  nextPayout: string;
  holdings: number;
}

interface PropertyProfit {
  id: string;
  name: string;
  location: string;
  totalInvestors: number;
  totalInvested: number;
  totalProfitGenerated: number;
  rentalYield: number;
  appreciationRate: number;
  monthlyRental: number;
}

type TimeFilter = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';
type ViewMode = 'investors' | 'properties' | 'summary';

export default function InvestorProfitsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('monthly');
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [expandedInvestor, setExpandedInvestor] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLoading, setExportLoading] = useState<string | null>(null);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  const COMPANY_INFO = {
    name: 'IVX HOLDINGS LLC',
    address: '123 Investment Plaza, Suite 500',
    city: 'Miami, FL 33131',
    phone: '+1 (305) 555-0123',
    email: 'investors@ipxholding.com',
    website: 'www.ipxholding.com',
    logo: 'https://r2-pub.ivx.com/attachments/1y2v16crdz546mo2tbt14'};

  const profilesQuery = useQuery({
    queryKey: ['admin-investor-profiles'],
    queryFn: async () => {
      console.log('[Investor Profits] Fetching profiles from Supabase');
      const { data, error } = await supabase.from('profiles').select('*').limit(500);
      if (error) { console.log('[Investor Profits] profiles error:', error.message); return []; }
      return data ?? [];
    },
    staleTime: 30000});

  const propertiesQuery = useQuery({
    queryKey: ['admin-investor-properties'],
    queryFn: async () => {
      console.log('[Investor Profits] Fetching properties from Supabase');
      const { data, error } = await supabase.from('properties').select('*').limit(200);
      if (error) { console.log('[Investor Profits] properties error:', error.message); return []; }
      return data ?? [];
    },
    staleTime: 30000});

  const investorProfits: InvestorProfit[] = useMemo(() => {
    const profiles = profilesQuery.data ?? [];
    return profiles.map((member: any) => {
      const invested = Number(member.total_invested) || 0;
      const baseRoi = 0.12;
      const yearlyProfit = invested * baseRoi;
      const monthlyProfit = yearlyProfit / 12;
      const weeklyProfit = yearlyProfit / 52;
      const dailyProfit = yearlyProfit / 365;
      const hourlyProfit = dailyProfit / 24;

      const rentalIncome = yearlyProfit * 0.6;
      const appreciation = yearlyProfit * 0.3;
      const dividends = yearlyProfit * 0.1;

      const today = new Date();
      const lastPayout = new Date(today);
      lastPayout.setDate(1);
      const nextPayout = new Date(today);
      nextPayout.setMonth(nextPayout.getMonth() + 1);
      nextPayout.setDate(1);

      return {
        id: member.id,
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Unknown',
        email: member.email || '',
        totalInvested: invested,
        totalProfit: yearlyProfit * (Math.random() * 0.5 + 0.5),
        rentalIncome,
        appreciation,
        dividends,
        roi: baseRoi * 100,
        hourlyRate: hourlyProfit,
        dailyRate: dailyProfit,
        weeklyRate: weeklyProfit,
        monthlyRate: monthlyProfit,
        yearlyProjection: yearlyProfit,
        lastPayout: lastPayout.toISOString(),
        nextPayout: nextPayout.toISOString(),
        holdings: 0};
    });
  }, [profilesQuery.data]);

  const propertyProfits: PropertyProfit[] = useMemo(() => {
    const props = propertiesQuery.data ?? [];
    return props.map((property: any) => {
      const totalInvested = Number(property.price) || 0;
      const rentalYield = (Number(property.annual_yield) || 8) / 100;
      const appreciationRate = 0.05 + Math.random() * 0.03;
      const monthlyRental = (totalInvested * rentalYield) / 12;
      const totalProfit = totalInvested * (rentalYield + appreciationRate);

      return {
        id: property.id,
        name: property.name || 'Unnamed Property',
        location: property.location || '',
        totalInvestors: Math.floor(Math.random() * 50) + 10,
        totalInvested,
        totalProfitGenerated: totalProfit,
        rentalYield: rentalYield * 100,
        appreciationRate: appreciationRate * 100,
        monthlyRental};
    });
  }, [propertiesQuery.data]);

  const summaryStats = useMemo(() => {
    const totalInvested = investorProfits.reduce((sum, i) => sum + i.totalInvested, 0);
    const totalProfit = investorProfits.reduce((sum, i) => sum + i.totalProfit, 0);
    const totalRental = investorProfits.reduce((sum, i) => sum + i.rentalIncome, 0);
    const totalAppreciation = investorProfits.reduce((sum, i) => sum + i.appreciation, 0);
    const totalDividends = investorProfits.reduce((sum, i) => sum + i.dividends, 0);
    const avgRoi = investorProfits.reduce((sum, i) => sum + i.roi, 0) / investorProfits.length;

    const hourlyTotal = investorProfits.reduce((sum, i) => sum + i.hourlyRate, 0);
    const dailyTotal = investorProfits.reduce((sum, i) => sum + i.dailyRate, 0);
    const weeklyTotal = investorProfits.reduce((sum, i) => sum + i.weeklyRate, 0);
    const monthlyTotal = investorProfits.reduce((sum, i) => sum + i.monthlyRate, 0);
    const yearlyTotal = investorProfits.reduce((sum, i) => sum + i.yearlyProjection, 0);

    return {
      totalInvestors: investorProfits.length,
      totalProperties: propertyProfits.length,
      totalInvested,
      totalProfit,
      totalRental,
      totalAppreciation,
      totalDividends,
      avgRoi,
      hourlyTotal,
      dailyTotal,
      weeklyTotal,
      monthlyTotal,
      yearlyTotal};
  }, [investorProfits, propertyProfits]);

  const filteredInvestors = useMemo(() => {
    if (!searchQuery) return investorProfits;
    const query = searchQuery.toLowerCase();
    return investorProfits.filter(
      (i) =>
        i.name.toLowerCase().includes(query) ||
        i.email.toLowerCase().includes(query)
    );
  }, [investorProfits, searchQuery]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([profilesQuery.refetch(), propertiesQuery.refetch()]).finally(() => setRefreshing(false));
  }, [profilesQuery, propertiesQuery]);

  const formatCurrency = useCallback((amount: number) => _fmtCurrDec(amount), []);

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'});
  }, []);

  const getProfitByTimeFilter = useCallback((investor: InvestorProfit) => {
    switch (timeFilter) {
      case 'hourly':
        return investor.hourlyRate;
      case 'daily':
        return investor.dailyRate;
      case 'weekly':
        return investor.weeklyRate;
      case 'monthly':
        return investor.monthlyRate;
      case 'yearly':
        return investor.yearlyProjection;
      default:
        return investor.totalProfit;
    }
  }, [timeFilter]);

  const getTimeFilterLabel = useCallback((filter: TimeFilter) => {
    switch (filter) {
      case 'hourly': return 'Per Hour';
      case 'daily': return 'Per Day';
      case 'weekly': return 'Per Week';
      case 'monthly': return 'Per Month';
      case 'yearly': return 'Per Year';
      default: return 'Total';
    }
  }, []);

  const generateReportText = useCallback(() => {
    const reportDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'});

    const divider = '═'.repeat(40);
    const subDivider = '─'.repeat(40);

    let report = `
${divider}
       ${COMPANY_INFO.name.toUpperCase()}
       INVESTOR PROFITS REPORT
${divider}

📅 Report Date: ${reportDate}
📍 ${COMPANY_INFO.address}
   ${COMPANY_INFO.city}
📞 ${COMPANY_INFO.phone}
✉️ ${COMPANY_INFO.email}
🌐 ${COMPANY_INFO.website}

${subDivider}
         EXECUTIVE SUMMARY
${subDivider}

💰 Total Platform Profit: ${formatCurrency(summaryStats.totalProfit)}
📈 Average ROI: ${summaryStats.avgRoi.toFixed(1)}%
👥 Total Investors: ${summaryStats.totalInvestors}
🏢 Total Properties: ${summaryStats.totalProperties}
💵 Total Invested: ${formatCurrency(summaryStats.totalInvested)}

${subDivider}
       PROFIT GENERATION RATES
${subDivider}

⏰ Hourly:  ${formatCurrency(summaryStats.hourlyTotal)}
📆 Daily:   ${formatCurrency(summaryStats.dailyTotal)}
📊 Weekly:  ${formatCurrency(summaryStats.weeklyTotal)}
📈 Monthly: ${formatCurrency(summaryStats.monthlyTotal)}
🎯 Yearly:  ${formatCurrency(summaryStats.yearlyTotal)}

${subDivider}
         PROFIT SOURCES
${subDivider}

🏠 Rental Income:     ${formatCurrency(summaryStats.totalRental)} (60%)
📈 Appreciation:      ${formatCurrency(summaryStats.totalAppreciation)} (30%)
💎 IVXHOLDINGS Dividends:     ${formatCurrency(summaryStats.totalDividends)} (10%)

${subDivider}
       TOP INVESTORS DETAIL
${subDivider}
`;

    investorProfits.slice(0, 10).forEach((investor, index) => {
      report += `
${index + 1}. ${investor.name}
   Email: ${investor.email}
   Invested: ${formatCurrency(investor.totalInvested)}
   Total Profit: ${formatCurrency(investor.totalProfit)}
   ROI: ${investor.roi.toFixed(2)}%
   Monthly Rate: ${formatCurrency(investor.monthlyRate)}
`;
    });

    report += `
${subDivider}
        PROPERTIES OVERVIEW
${subDivider}
`;

    propertyProfits.forEach((property, index) => {
      report += `
${index + 1}. ${property.name}
   Location: ${property.location}
   Investors: ${property.totalInvestors}
   Total Invested: ${formatCurrency(property.totalInvested)}
   Profit Generated: ${formatCurrency(property.totalProfitGenerated)}
   Rental Yield: ${property.rentalYield.toFixed(2)}%
`;
    });

    report += `
${divider}
     CONFIDENTIAL DOCUMENT
     ${COMPANY_INFO.name}
     © ${new Date().getFullYear()} All Rights Reserved
${divider}
`;

    return report;
  }, [summaryStats, investorProfits, propertyProfits, formatCurrency]);

  const generateHTMLReport = useCallback(() => {
    const reportDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'});

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IVX HOLDINGS LLC - Investor Profits Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; color: #1a1a1a; }
    .container { max-width: 800px; margin: 0 auto; background: white; }
    .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: white; padding: 40px; text-align: center; }
    .logo-img { width: 80px; height: 80px; border-radius: 12px; margin-bottom: 16px; object-fit: contain; background: white; padding: 8px; }
    .logo { font-size: 28px; font-weight: 700; color: #FFD700; margin-bottom: 8px; }
    .report-title { font-size: 18px; opacity: 0.9; }
    .company-info { background: #222; color: #ccc; padding: 20px 40px; font-size: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; }
    .company-info div { margin: 4px 0; }
    .section { padding: 30px 40px; border-bottom: 1px solid #eee; }
    .section-title { font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #FFD700; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .summary-card { background: #f8f8f8; border-radius: 12px; padding: 20px; text-align: center; }
    .summary-card.highlight { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #1a1a1a; grid-column: span 2; }
    .summary-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .summary-label { font-size: 12px; opacity: 0.7; text-transform: uppercase; }
    .rate-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .rate-card { background: #f8f8f8; border-radius: 8px; padding: 16px; text-align: center; }
    .rate-value { font-size: 18px; font-weight: 600; color: #1a1a1a; }
    .rate-label { font-size: 11px; color: #666; margin-top: 4px; }
    .source-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
    .source-dot { width: 12px; height: 12px; border-radius: 6px; margin-right: 12px; }
    .source-name { flex: 1; font-weight: 500; }
    .source-value { font-weight: 600; margin-right: 16px; }
    .source-percent { color: #666; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #1a1a1a; color: white; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
    td { padding: 12px; border-bottom: 1px solid #eee; font-size: 13px; }
    tr:hover { background: #f8f8f8; }
    .positive { color: #00C48C; }
    .footer { background: #1a1a1a; color: #888; padding: 30px 40px; text-align: center; font-size: 12px; }
    .footer .company { color: #FFD700; font-weight: 600; font-size: 14px; margin-bottom: 8px; }
    @media print { body { background: white; } .container { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${COMPANY_INFO.logo}" alt="IVX HOLDINGS LLC" class="logo-img" />
      <div class="logo">${COMPANY_INFO.name}</div>
      <div class="report-title">Investor Profits Report</div>
    </div>
    
    <div class="company-info">
      <div>📅 ${reportDate}</div>
      <div>📍 ${COMPANY_INFO.address}, ${COMPANY_INFO.city}</div>
      <div>📞 ${COMPANY_INFO.phone}</div>
      <div>✉️ ${COMPANY_INFO.email}</div>
    </div>
    
    <div class="section">
      <div class="section-title">Executive Summary</div>
      <div class="summary-grid">
        <div class="summary-card highlight">
          <div class="summary-value">${formatCurrency(summaryStats.totalProfit)}</div>
          <div class="summary-label">Total Platform Profit</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summaryStats.avgRoi.toFixed(1)}%</div>
          <div class="summary-label">Average ROI</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summaryStats.totalInvestors}</div>
          <div class="summary-label">Total Investors</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summaryStats.totalProperties}</div>
          <div class="summary-label">Properties</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${formatCurrency(summaryStats.totalInvested)}</div>
          <div class="summary-label">Total Invested</div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Profit Generation Rates</div>
      <div class="rate-grid">
        <div class="rate-card">
          <div class="rate-value">${formatCurrency(summaryStats.hourlyTotal)}</div>
          <div class="rate-label">Per Hour</div>
        </div>
        <div class="rate-card">
          <div class="rate-value">${formatCurrency(summaryStats.dailyTotal)}</div>
          <div class="rate-label">Per Day</div>
        </div>
        <div class="rate-card">
          <div class="rate-value">${formatCurrency(summaryStats.weeklyTotal)}</div>
          <div class="rate-label">Per Week</div>
        </div>
        <div class="rate-card">
          <div class="rate-value">${formatCurrency(summaryStats.monthlyTotal)}</div>
          <div class="rate-label">Per Month</div>
        </div>
      </div>
      <div class="summary-card highlight" style="margin-top: 16px;">
        <div class="summary-value">${formatCurrency(summaryStats.yearlyTotal)}</div>
        <div class="summary-label">Yearly Projection</div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Profit Sources</div>
      <div class="source-row">
        <div class="source-dot" style="background: #4A90D9;"></div>
        <div class="source-name">Rental Income</div>
        <div class="source-value">${formatCurrency(summaryStats.totalRental)}</div>
        <div class="source-percent">60%</div>
      </div>
      <div class="source-row">
        <div class="source-dot" style="background: #00C48C;"></div>
        <div class="source-name">Property Appreciation</div>
        <div class="source-value">${formatCurrency(summaryStats.totalAppreciation)}</div>
        <div class="source-percent">30%</div>
      </div>
      <div class="source-row">
        <div class="source-dot" style="background: #FFD700;"></div>
        <div class="source-name">IVXHOLDINGS Dividends</div>
        <div class="source-value">${formatCurrency(summaryStats.totalDividends)}</div>
        <div class="source-percent">10%</div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Top Investors</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Investor</th>
            <th>Invested</th>
            <th>Profit</th>
            <th>ROI</th>
            <th>Monthly</th>
          </tr>
        </thead>
        <tbody>
          ${investorProfits.slice(0, 10).map((inv, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${inv.name}</strong><br><small style="color:#666">${inv.email}</small></td>
            <td>${formatCurrency(inv.totalInvested)}</td>
            <td class="positive">${formatCurrency(inv.totalProfit)}</td>
            <td class="positive">${inv.roi.toFixed(2)}%</td>
            <td>${formatCurrency(inv.monthlyRate)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="section">
      <div class="section-title">Properties Overview</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Property</th>
            <th>Investors</th>
            <th>Invested</th>
            <th>Profit</th>
            <th>Yield</th>
          </tr>
        </thead>
        <tbody>
          ${propertyProfits.map((prop, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${prop.name}</strong><br><small style="color:#666">${prop.location}</small></td>
            <td>${prop.totalInvestors}</td>
            <td>${formatCurrency(prop.totalInvested)}</td>
            <td class="positive">${formatCurrency(prop.totalProfitGenerated)}</td>
            <td class="positive">${prop.rentalYield.toFixed(2)}%</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="footer">
      <img src="${COMPANY_INFO.logo}" alt="IVX HOLDINGS LLC" style="width: 40px; height: 40px; border-radius: 8px; margin-bottom: 12px; object-fit: contain; background: white; padding: 4px;" />
      <div class="company">${COMPANY_INFO.name}</div>
      <div>CONFIDENTIAL DOCUMENT • © ${new Date().getFullYear()} All Rights Reserved</div>
      <div style="margin-top: 8px;">${COMPANY_INFO.website}</div>
    </div>
  </div>
</body>
</html>
`;
  }, [summaryStats, investorProfits, propertyProfits, formatCurrency]);

  const exportViaWhatsApp = useCallback(async () => {
    setExportLoading('whatsapp');
    try {
      const reportText = generateReportText();
      const encodedText = encodeURIComponent(reportText);
      const whatsappUrl = `whatsapp://send?text=${encodedText}`;
      
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        const webUrl = `https://wa.me/?text=${encodedText}`;
        await Linking.openURL(webUrl);
      }
      setShowExportModal(false);
    } catch (error) {
      console.error('WhatsApp export error:', error);
      Alert.alert('Error', 'Could not open WhatsApp. Please make sure it is installed.');
    } finally {
      setExportLoading(null);
    }
  }, [generateReportText]);

  const exportViaPDF = useCallback(async () => {
    setExportLoading('pdf');
    try {
      const htmlContent = generateHTMLReport();
      
      if (Platform.OS === 'web') {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const printWindow = window.open(url, '_blank');
        if (printWindow) {
          printWindow.onload = () => {
            printWindow.print();
          };
        }
        URL.revokeObjectURL(url);
      } else {
        const fileName = `IVXHOLDINGS-Investor-Profits-${new Date().toISOString().split('T')[0]}.html`;
        const cacheDir = (FileSystem as { cacheDirectory?: string | null }).cacheDirectory || '';
        const filePath = `${cacheDir}${fileName}`;
        await FileSystem.writeAsStringAsync(filePath, htmlContent);
        
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath, {
            mimeType: 'text/html',
            dialogTitle: 'Export Investor Profits Report'});
        }
      }
      setShowExportModal(false);
    } catch (error) {
      console.error('PDF export error:', error);
      Alert.alert('Error', 'Failed to generate PDF report.');
    } finally {
      setExportLoading(null);
    }
  }, [generateHTMLReport]);

  const exportViaEmail = useCallback(async () => {
    setExportLoading('email');
    try {
      const subject = encodeURIComponent(`IVX HOLDINGS LLC - Investor Profits Report - ${new Date().toLocaleDateString()}`);
      const body = encodeURIComponent(generateReportText());
      const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;
      
      await Linking.openURL(mailtoUrl);
      setShowExportModal(false);
    } catch (error) {
      console.error('Email export error:', error);
      Alert.alert('Error', 'Could not open email client.');
    } finally {
      setExportLoading(null);
    }
  }, [generateReportText]);

  const exportViaShare = useCallback(async () => {
    setExportLoading('share');
    try {
      const reportText = generateReportText();
      
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({
            title: 'IVX HOLDINGS LLC - Investor Profits Report',
            text: reportText});
        } else {
          await navigator.clipboard.writeText(reportText);
          setCopiedToClipboard(true);
          setTimeout(() => setCopiedToClipboard(false), 2000);
        }
      } else {
        const fileName = `IVXHOLDINGS-Investor-Profits-${new Date().toISOString().split('T')[0]}.txt`;
        const cacheDir = (FileSystem as { cacheDirectory?: string | null }).cacheDirectory || '';
        const filePath = `${cacheDir}${fileName}`;
        await FileSystem.writeAsStringAsync(filePath, reportText);
        
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath);
        }
      }
      setShowExportModal(false);
    } catch (error) {
      console.error('Share error:', error);
      Alert.alert('Error', 'Failed to share report.');
    } finally {
      setExportLoading(null);
    }
  }, [generateReportText]);

  const copyToClipboard = useCallback(async () => {
    try {
      const reportText = generateReportText();
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(reportText);
      }
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch (error) {
      console.error('Copy error:', error);
      Alert.alert('Error', 'Failed to copy to clipboard.');
    }
  }, [generateReportText]);

  const renderExportModal = () => (
    <Modal
      visible={showExportModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowExportModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.exportModal}>
          <View style={styles.exportModalHeader}>
            <View style={styles.exportModalLogo}>
              <DollarSign size={24} color={Colors.primary} />
            </View>
            <View style={styles.exportModalTitleContainer}>
              <Text style={styles.exportModalTitle}>Export Report</Text>
              <Text style={styles.exportModalSubtitle}>{COMPANY_INFO.name}</Text>
            </View>
            <TouchableOpacity
              style={styles.exportModalClose}
              onPress={() => setShowExportModal(false)}
            >
              <X size={24} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.exportPreview}>
            <Text style={styles.exportPreviewTitle}>Report Summary</Text>
            <View style={styles.exportPreviewStats}>
              <View style={styles.exportPreviewStat}>
                <Text style={styles.exportPreviewValue}>{formatCurrency(summaryStats.totalProfit)}</Text>
                <Text style={styles.exportPreviewLabel}>Total Profit</Text>
              </View>
              <View style={styles.exportPreviewStat}>
                <Text style={styles.exportPreviewValue}>{summaryStats.totalInvestors}</Text>
                <Text style={styles.exportPreviewLabel}>Investors</Text>
              </View>
              <View style={styles.exportPreviewStat}>
                <Text style={styles.exportPreviewValue}>{summaryStats.avgRoi.toFixed(1)}%</Text>
                <Text style={styles.exportPreviewLabel}>Avg ROI</Text>
              </View>
            </View>
          </View>

          <Text style={styles.exportOptionsTitle}>Choose Export Method</Text>

          <View style={styles.exportOptions}>
            <TouchableOpacity
              style={[styles.exportOption, styles.exportOptionWhatsApp]}
              onPress={exportViaWhatsApp}
              disabled={exportLoading !== null}
            >
              {exportLoading === 'whatsapp' ? (
                <ShimmerIndicator color="#fff" />
              ) : (
                <MessageCircle size={24} color="#fff" />
              )}
              <Text style={styles.exportOptionTextLight}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportOption, styles.exportOptionPDF]}
              onPress={exportViaPDF}
              disabled={exportLoading !== null}
            >
              {exportLoading === 'pdf' ? (
                <ShimmerIndicator color="#fff" />
              ) : (
                <FileText size={24} color="#fff" />
              )}
              <Text style={styles.exportOptionTextLight}>PDF/Print</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportOption, styles.exportOptionEmail]}
              onPress={exportViaEmail}
              disabled={exportLoading !== null}
            >
              {exportLoading === 'email' ? (
                <ShimmerIndicator color="#fff" />
              ) : (
                <Mail size={24} color="#fff" />
              )}
              <Text style={styles.exportOptionTextLight}>Email</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportOption, styles.exportOptionShare]}
              onPress={exportViaShare}
              disabled={exportLoading !== null}
            >
              {exportLoading === 'share' ? (
                <ShimmerIndicator color="#fff" />
              ) : (
                <Share2 size={24} color="#fff" />
              )}
              <Text style={styles.exportOptionTextLight}>Share</Text>
            </TouchableOpacity>
          </View>

          {Platform.OS === 'web' && (
            <TouchableOpacity
              style={styles.copyButton}
              onPress={copyToClipboard}
            >
              {copiedToClipboard ? (
                <>
                  <CheckCircle size={18} color={Colors.positive} />
                  <Text style={[styles.copyButtonText, { color: Colors.positive }]}>Copied!</Text>
                </>
              ) : (
                <>
                  <Copy size={18} color={Colors.primary} />
                  <Text style={styles.copyButtonText}>Copy Report to Clipboard</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.exportModalFooter}>
            <Text style={styles.exportModalFooterText}>
              Report includes IVX HOLDINGS LLC branding and full investor details
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderSummaryView = () => (
    <>
      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, styles.summaryCardLarge]}>
          <View style={[styles.summaryIcon, { backgroundColor: Colors.positive + '20' }]}>
            <DollarSign size={24} color={Colors.positive} />
          </View>
          <Text style={styles.summaryLabel}>Total Platform Profit</Text>
          <Text style={styles.summaryValue}>{formatCurrency(summaryStats.totalProfit)}</Text>
          <View style={styles.roiBadge}>
            <ArrowUpRight size={14} color={Colors.positive} />
            <Text style={styles.roiText}>{summaryStats.avgRoi.toFixed(1)}% avg ROI</Text>
          </View>
        </View>
      </View>

      <View style={styles.timeBreakdownSection}>
        <Text style={styles.sectionTitle}>Profit Generation Rate</Text>
        <View style={styles.timeGrid}>
          <View style={styles.timeCard}>
            <Clock size={18} color={Colors.primary} />
            <Text style={styles.timeLabel}>Hourly</Text>
            <Text style={styles.timeValue}>{formatCurrency(summaryStats.hourlyTotal)}</Text>
          </View>
          <View style={styles.timeCard}>
            <Calendar size={18} color={Colors.accent} />
            <Text style={styles.timeLabel}>Daily</Text>
            <Text style={styles.timeValue}>{formatCurrency(summaryStats.dailyTotal)}</Text>
          </View>
          <View style={styles.timeCard}>
            <BarChart3 size={18} color={Colors.warning} />
            <Text style={styles.timeLabel}>Weekly</Text>
            <Text style={styles.timeValue}>{formatCurrency(summaryStats.weeklyTotal)}</Text>
          </View>
          <View style={styles.timeCard}>
            <TrendingUp size={18} color={Colors.positive} />
            <Text style={styles.timeLabel}>Monthly</Text>
            <Text style={styles.timeValue}>{formatCurrency(summaryStats.monthlyTotal)}</Text>
          </View>
        </View>
        <View style={styles.yearlyProjection}>
          <Text style={styles.yearlyLabel}>Yearly Projection</Text>
          <Text style={styles.yearlyValue}>{formatCurrency(summaryStats.yearlyTotal)}</Text>
        </View>
      </View>

      <View style={styles.sourceBreakdownSection}>
        <Text style={styles.sectionTitle}>Profit Sources</Text>
        <View style={styles.sourceCard}>
          <View style={styles.sourceRow}>
            <View style={styles.sourceInfo}>
              <View style={[styles.sourceDot, { backgroundColor: Colors.primary }]} />
              <Text style={styles.sourceLabel}>Rental Income</Text>
            </View>
            <Text style={styles.sourceValue}>{formatCurrency(summaryStats.totalRental)}</Text>
            <Text style={styles.sourcePercent}>60%</Text>
          </View>
          <View style={styles.sourceBar}>
            <View style={[styles.sourceBarFill, { width: '60%', backgroundColor: Colors.primary }]} />
          </View>
        </View>
        <View style={styles.sourceCard}>
          <View style={styles.sourceRow}>
            <View style={styles.sourceInfo}>
              <View style={[styles.sourceDot, { backgroundColor: Colors.positive }]} />
              <Text style={styles.sourceLabel}>Property Appreciation</Text>
            </View>
            <Text style={styles.sourceValue}>{formatCurrency(summaryStats.totalAppreciation)}</Text>
            <Text style={styles.sourcePercent}>30%</Text>
          </View>
          <View style={styles.sourceBar}>
            <View style={[styles.sourceBarFill, { width: '30%', backgroundColor: Colors.positive }]} />
          </View>
        </View>
        <View style={styles.sourceCard}>
          <View style={styles.sourceRow}>
            <View style={styles.sourceInfo}>
              <View style={[styles.sourceDot, { backgroundColor: Colors.accent }]} />
              <Text style={styles.sourceLabel}>IVXHOLDINGS Dividends</Text>
            </View>
            <Text style={styles.sourceValue}>{formatCurrency(summaryStats.totalDividends)}</Text>
            <Text style={styles.sourcePercent}>10%</Text>
          </View>
          <View style={styles.sourceBar}>
            <View style={[styles.sourceBarFill, { width: '10%', backgroundColor: Colors.accent }]} />
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Users size={20} color={Colors.primary} />
          <Text style={styles.statBoxValue}>{summaryStats.totalInvestors}</Text>
          <Text style={styles.statBoxLabel}>Total Investors</Text>
        </View>
        <View style={styles.statBox}>
          <Building2 size={20} color={Colors.accent} />
          <Text style={styles.statBoxValue}>{summaryStats.totalProperties}</Text>
          <Text style={styles.statBoxLabel}>Properties</Text>
        </View>
        <View style={styles.statBox}>
          <DollarSign size={20} color={Colors.positive} />
          <Text style={styles.statBoxValue}>{formatCurrency(summaryStats.totalInvested)}</Text>
          <Text style={styles.statBoxLabel}>Total Invested</Text>
        </View>
      </View>
    </>
  );

  const renderInvestorsView = () => (
    <>
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Search size={20} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search investors..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {showFilters && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.timeFilterContainer}
          contentContainerStyle={styles.timeFilterContent}
        >
          {(['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'all'] as TimeFilter[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.timeFilterChip, timeFilter === filter && styles.timeFilterChipActive]}
              onPress={() => setTimeFilter(filter)}
            >
              <Text style={[styles.timeFilterText, timeFilter === filter && styles.timeFilterTextActive]}>
                {getTimeFilterLabel(filter)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {filteredInvestors.map((investor) => (
        <TouchableOpacity
          key={investor.id}
          style={styles.investorCard}
          onPress={() => setExpandedInvestor(expandedInvestor === investor.id ? null : investor.id)}
        >
          <View style={styles.investorHeader}>
            <View style={styles.investorInfo}>
              <Text style={styles.investorName}>{investor.name}</Text>
              <Text style={styles.investorEmail}>{investor.email}</Text>
            </View>
            <View style={styles.investorProfit}>
              <Text style={styles.profitLabel}>{getTimeFilterLabel(timeFilter)}</Text>
              <Text style={styles.profitValue}>
                {formatCurrency(getProfitByTimeFilter(investor))}
              </Text>
            </View>
            {expandedInvestor === investor.id ? (
              <ChevronUp size={20} color={Colors.textSecondary} />
            ) : (
              <ChevronDown size={20} color={Colors.textSecondary} />
            )}
          </View>

          {expandedInvestor === investor.id && (
            <View style={styles.investorDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Total Invested</Text>
                <Text style={styles.detailValue}>{formatCurrency(investor.totalInvested)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>ROI</Text>
                <Text style={[styles.detailValue, { color: Colors.positive }]}>{investor.roi.toFixed(2)}%</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Holdings</Text>
                <Text style={styles.detailValue}>{investor.holdings} properties</Text>
              </View>
              
              <View style={styles.profitBreakdown}>
                <Text style={styles.breakdownTitle}>Profit Breakdown</Text>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Rental Income</Text>
                  <Text style={styles.breakdownValue}>{formatCurrency(investor.rentalIncome)}/yr</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Appreciation</Text>
                  <Text style={styles.breakdownValue}>{formatCurrency(investor.appreciation)}/yr</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Dividends</Text>
                  <Text style={styles.breakdownValue}>{formatCurrency(investor.dividends)}/yr</Text>
                </View>
              </View>

              <View style={styles.payoutInfo}>
                <View style={styles.payoutRow}>
                  <Text style={styles.payoutLabel}>Last Payout</Text>
                  <Text style={styles.payoutValue}>{formatDate(investor.lastPayout)}</Text>
                </View>
                <View style={styles.payoutRow}>
                  <Text style={styles.payoutLabel}>Next Payout</Text>
                  <Text style={[styles.payoutValue, { color: Colors.primary }]}>{formatDate(investor.nextPayout)}</Text>
                </View>
              </View>

              <View style={styles.rateGrid}>
                <View style={styles.rateBox}>
                  <Text style={styles.rateLabel}>Hourly</Text>
                  <Text style={styles.rateValue}>{formatCurrency(investor.hourlyRate)}</Text>
                </View>
                <View style={styles.rateBox}>
                  <Text style={styles.rateLabel}>Daily</Text>
                  <Text style={styles.rateValue}>{formatCurrency(investor.dailyRate)}</Text>
                </View>
                <View style={styles.rateBox}>
                  <Text style={styles.rateLabel}>Weekly</Text>
                  <Text style={styles.rateValue}>{formatCurrency(investor.weeklyRate)}</Text>
                </View>
                <View style={styles.rateBox}>
                  <Text style={styles.rateLabel}>Monthly</Text>
                  <Text style={styles.rateValue}>{formatCurrency(investor.monthlyRate)}</Text>
                </View>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </>
  );

  const renderPropertiesView = () => (
    <>
      {propertyProfits.map((property) => (
        <View key={property.id} style={styles.propertyCard}>
          <View style={styles.propertyHeader}>
            <View style={styles.propertyInfo}>
              <Text style={styles.propertyName}>{property.name}</Text>
              <Text style={styles.propertyLocation}>{property.location}</Text>
            </View>
            <View style={styles.propertyStats}>
              <Text style={styles.propertyInvestors}>{property.totalInvestors} investors</Text>
            </View>
          </View>
          
          <View style={styles.propertyMetrics}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Total Invested</Text>
              <Text style={styles.metricValue}>{formatCurrency(property.totalInvested)}</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Profit Generated</Text>
              <Text style={[styles.metricValue, { color: Colors.positive }]}>
                {formatCurrency(property.totalProfitGenerated)}
              </Text>
            </View>
          </View>

          <View style={styles.yieldRow}>
            <View style={styles.yieldBox}>
              <Percent size={16} color={Colors.primary} />
              <Text style={styles.yieldLabel}>Rental Yield</Text>
              <Text style={styles.yieldValue}>{property.rentalYield.toFixed(2)}%</Text>
            </View>
            <View style={styles.yieldBox}>
              <TrendingUp size={16} color={Colors.positive} />
              <Text style={styles.yieldLabel}>Appreciation</Text>
              <Text style={styles.yieldValue}>{property.appreciationRate.toFixed(2)}%</Text>
            </View>
            <View style={styles.yieldBox}>
              <DollarSign size={16} color={Colors.accent} />
              <Text style={styles.yieldLabel}>Monthly Rental</Text>
              <Text style={styles.yieldValue}>{formatCurrency(property.monthlyRental)}</Text>
            </View>
          </View>
        </View>
      ))}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Investor Profits</Text>
          <Text style={styles.subtitle}>Detailed profit analytics & breakdown</Text>
        </View>
        <TouchableOpacity style={styles.exportButton} onPress={() => setShowExportModal(true)}>
          <Download size={18} color={Colors.white} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.viewToggle}>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'summary' && styles.toggleButtonActive]}
          onPress={() => setViewMode('summary')}
        >
          <PieChart size={16} color={viewMode === 'summary' ? Colors.black : Colors.textSecondary} />
          <Text style={[styles.toggleText, viewMode === 'summary' && styles.toggleTextActive]}>Summary</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'investors' && styles.toggleButtonActive]}
          onPress={() => setViewMode('investors')}
        >
          <Users size={16} color={viewMode === 'investors' ? Colors.black : Colors.textSecondary} />
          <Text style={[styles.toggleText, viewMode === 'investors' && styles.toggleTextActive]}>Investors</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'properties' && styles.toggleButtonActive]}
          onPress={() => setViewMode('properties')}
        >
          <Building2 size={16} color={viewMode === 'properties' ? Colors.black : Colors.textSecondary} />
          <Text style={[styles.toggleText, viewMode === 'properties' && styles.toggleTextActive]}>Properties</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {viewMode === 'summary' && renderSummaryView()}
        {viewMode === 'investors' && renderInvestorsView()}
        {viewMode === 'properties' && renderPropertiesView()}
        
        <View style={styles.bottomPadding} />
      </ScrollView>

      {renderExportModal()}
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  exportButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.primary, flexDirection: 'row', gap: 6 },
  exportText: { color: Colors.black, fontSize: 13, fontWeight: '600' as const },
  viewToggle: { flexDirection: 'row', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  toggleButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  toggleButtonActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  toggleText: { color: Colors.textSecondary, fontSize: 13 },
  toggleTextActive: { color: '#000' },
  content: { flex: 1, paddingHorizontal: 20 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryCardLarge: { backgroundColor: Colors.primary, borderRadius: 16, padding: 16, marginBottom: 12, gap: 6 },
  summaryIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  roiBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  roiText: { color: Colors.textSecondary, fontSize: 13 },
  timeBreakdownSection: { marginBottom: 16 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  timeLabel: { color: Colors.textSecondary, fontSize: 13 },
  timeValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  yearlyProjection: { gap: 6 },
  yearlyLabel: { color: Colors.textSecondary, fontSize: 13 },
  yearlyValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  sourceBreakdownSection: { marginBottom: 16 },
  sourceCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceInfo: { flex: 1 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceLabel: { color: Colors.textSecondary, fontSize: 13 },
  sourceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  sourcePercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  sourceBar: { flex: 1, height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden' },
  sourceBarFill: { height: 6, borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statBoxValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statBoxLabel: { color: Colors.textTertiary, fontSize: 11 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  filterButton: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  timeFilterContainer: { gap: 8 },
  timeFilterContent: { flex: 1, gap: 4 },
  timeFilterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  timeFilterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timeFilterText: { color: Colors.textSecondary, fontSize: 13 },
  timeFilterTextActive: { color: '#000' },
  investorCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  investorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  investorInfo: { flex: 1 },
  investorName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  investorEmail: { color: Colors.textSecondary, fontSize: 13 },
  investorProfit: { alignItems: 'flex-end', gap: 2 },
  profitLabel: { color: Colors.textSecondary, fontSize: 11 },
  profitValue: { color: Colors.positive, fontSize: 15, fontWeight: '700' as const },
  investorDetails: { gap: 8, marginTop: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { color: Colors.textSecondary, fontSize: 13 },
  detailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  profitBreakdown: { gap: 8, marginTop: 8 },
  breakdownTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  breakdownValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  payoutInfo: { flex: 1 },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payoutLabel: { color: Colors.textSecondary, fontSize: 13 },
  payoutValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  rateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  rateBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  rateLabel: { color: Colors.textSecondary, fontSize: 13 },
  rateValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  propertyCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  propertyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  propertyInfo: { flex: 1 },
  propertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  propertyLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  propertyStats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  propertyInvestors: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  propertyMetrics: { flexDirection: 'row', gap: 8, marginTop: 8 },
  metricBox: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 10, alignItems: 'center', gap: 2 },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  yieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yieldBox: { backgroundColor: Colors.positive + '15', borderRadius: 8, padding: 8, alignItems: 'center', gap: 2 },
  yieldLabel: { color: Colors.textSecondary, fontSize: 13 },
  yieldValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  exportModal: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, gap: 16, maxHeight: '90%' },
  exportModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  exportModalLogo: { width: 48, height: 48, borderRadius: 12, backgroundColor: Colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  exportModalTitleContainer: { flex: 1 },
  exportModalTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  exportModalSubtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  exportModalClose: { padding: 4 },
  exportPreview: { gap: 8 },
  exportPreviewTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  exportPreviewStats: { gap: 8 },
  exportPreviewStat: { gap: 8 },
  exportPreviewValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  exportPreviewLabel: { color: Colors.textSecondary, fontSize: 13 },
  exportOptionsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  exportOptions: { gap: 10 },
  exportOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, gap: 12 },
  exportOptionWhatsApp: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#25D36620', alignItems: 'center', justifyContent: 'center' },
  exportOptionPDF: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.negative + '20', alignItems: 'center', justifyContent: 'center' },
  exportOptionEmail: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  exportOptionShare: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.accent + '20', alignItems: 'center', justifyContent: 'center' },
  exportOptionTextLight: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  copyButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  copyButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  exportModalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  exportModalFooterText: { color: Colors.textSecondary, fontSize: 13 }});
