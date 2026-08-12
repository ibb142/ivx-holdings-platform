import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Image,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent} from "react-native";
import { Platform as _FSPlatform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  FileText,
  Users,
  DollarSign,
  Shield,
  Scale,
  CheckCircle,
  TrendingUp,
  Briefcase,
  PieChart,
  Handshake,
  Eye,
  Download,
  MessageCircle,
  Sparkles,
  MapPin,
  UserCheck,
  Gavel,
  ImageIcon,
  Camera,
  X,
  Edit3} from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Globe } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { fetchJVDeals, upsertJVDeal, updateJVDeal, resetSupabaseCheck } from '@/lib/jv-storage';
import { uploadDealPhotosParallel } from '@/lib/photo-upload';
import { invalidateAllJVQueries } from '@/lib/jv-realtime';
import { syncToLandingPage } from '@/lib/landing-sync';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { formatAmountInput, parseAmountInput } from '@/lib/formatters';
import type { JVAgreement, JVPartner, PoolTier } from '@/types/jv';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';

const JV_AGREEMENT_TYPES = [
  { id: 'equity_split', label: 'Equity Split', icon: '📊', desc: 'Partners share ownership proportional to contribution', color: '#4A90D9' },
  { id: 'profit_sharing', label: 'Profit Sharing', icon: '💰', desc: 'Fixed returns based on profit distribution schedule', color: '#00C48C' },
  { id: 'hybrid', label: 'Hybrid Structure', icon: '🔄', desc: 'Combined equity + profit sharing arrangement', color: '#E879F9' },
  { id: 'development', label: 'Development JV', icon: '📋', desc: 'Joint development with milestone-based payouts', color: '#FFD700' },
] as const;

const EXIT_STRATEGIES = [
  'Sale of Property', 'Refinance & Cash Out', 'Buyout by Lead Partner',
  'IPO / Tokenization', 'Hold & Distribute', 'Third Party Sale',
] as const;

const DISTRIBUTION_FREQUENCIES = [
  { id: 'monthly', label: 'Monthly' }, { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' }, { id: 'at_exit', label: 'At Exit' },
] as const;

const JV_CLAUSES: Record<string, { title: string; description: string }> = {
  capital_call: { title: 'Capital Call Rights', description: 'Managing partner may issue capital calls with 30-day notice for approved expenditures.' },
  drag_along: { title: 'Drag-Along Rights', description: 'Partners holding 75%+ equity may compel remaining partners to join a sale.' },
  tag_along: { title: 'Tag-Along Rights', description: 'Minority partners can join any sale on the same terms as the selling partner.' },
  preemptive: { title: 'Pre-emptive Rights', description: 'Existing partners have first right to purchase shares before external sales.' },
  deadlock: { title: 'Deadlock Resolution', description: 'In case of deadlock, parties shall engage mediator before arbitration.' },
  force_majeure: { title: 'Force Majeure', description: 'Neither party liable for delays caused by events beyond reasonable control.' },
  anti_dilution: { title: 'Anti-Dilution Protection', description: 'Partners protected against equity dilution from future capital raises.' },
  waterfall: { title: 'Waterfall Distribution', description: 'Returns distributed in priority: 1) Return of capital, 2) Preferred return, 3) Promote split.' }};
import {
  safePartners,
  safeProfitSplit,
  safePoolTiers,
  safePhotos,
  formatJVCurrency as formatCurrency,
  calculateDefaultEndDate,
  generateJVNumber,
  isExistingBackendId} from '@/lib/jv-utils';

type ScreenMode = 'list' | 'create' | 'detail' | 'preview' | 'edit';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Live', color: '#00C48C', bg: '#00C48C20' },
  pending_review: { label: 'Pending Review', color: '#FFB800', bg: '#FFB80020' },
  completed: { label: 'Completed', color: '#4A90D9', bg: '#4A90D920' },
  expired: { label: 'Expired', color: '#FF4D4D', bg: '#FF4D4D20' }};

const DEFAULT_STATUS = STATUS_CONFIG.active;

const ROLE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  lp: { label: 'LP (Limited Partner)', color: '#4A90D9', description: 'Contributes capital, limited liability, no management authority' },
  silent: { label: 'Silent Partner', color: '#9A9A9A', description: 'Invests capital only, no involvement in operations or decisions' },
  co_investor: { label: 'Co-Investor', color: '#E879F9', description: 'Co-invests alongside lead, no management authority, shares returns' }};


const POOL_TIER_TYPES: { id: PoolTier['type']; label: string; icon: string; color: string }[] = [
  { id: 'jv_direct', label: 'JV Investment', icon: '🏛️', color: '#00C48C' },

  { id: 'private_lending', label: 'Private Lending', icon: '🏦', color: '#4A90D9' },
  { id: 'open', label: 'Open Pool', icon: '🌐', color: '#E879F9' },
];

function generateJVContractHTML(agreement: JVAgreement): string {
  const partners = safePartners(agreement.partners);
  const partnersHTML = partners.map((p, i) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;color:#fff;">${i + 1}. ${p.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;color:#FFD700;font-weight:700;">${ROLE_CONFIG[p.role]?.label || p.role}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;color:#00C48C;font-weight:700;">${formatCurrency(p.contribution)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;color:#4A90D9;font-weight:700;">${p.equityShare}%</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;">${p.location}</td>
    </tr>
  `).join('');

  const clausesHTML = Object.values(JV_CLAUSES).map(c => `
    <div style="margin-bottom:12px;padding:14px;background:#141414;border-radius:10px;border:1px solid #2a2a2a;">
      <h4 style="color:#FFD700;margin:0 0 6px 0;font-size:14px;">${c.title}</h4>
      <p style="color:#9a9a9a;margin:0;font-size:13px;line-height:1.5;">${c.description}</p>
    </div>
  `).join('');

  const profitSplitHTML = safeProfitSplit(agreement.profitSplit).map(ps => {
    const partner = partners.find(p => p.id === ps.partnerId);
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a1a;">
      <span style="color:#fff;">${partner?.name || 'Unknown'}</span>
      <span style="color:#00C48C;font-weight:700;">${ps.percentage}%</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JV Agreement — ${agreement.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0A; color: #fff; padding: 40px; }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #FFD700; }
    .logo { font-size: 28px; font-weight: 900; color: #FFD700; letter-spacing: 3px; }
    .subtitle { color: #9a9a9a; font-size: 14px; margin-top: 8px; }
    .agreement-title { font-size: 24px; font-weight: 800; margin-top: 16px; }
    .badge { display: inline-block; background: #FFD70020; color: #FFD700; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-top: 12px; }
    .section { margin-bottom: 30px; }
    .section-title { color: #FFD700; font-size: 18px; font-weight: 700; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #2a2a2a; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .info-item { background: #141414; border-radius: 10px; padding: 14px; border: 1px solid #2a2a2a; }
    .info-label { color: #6a6a6a; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .info-value { color: #fff; font-size: 16px; font-weight: 700; }
    .info-value.gold { color: #FFD700; }
    .info-value.green { color: #00C48C; }
    table { width: 100%; border-collapse: collapse; background: #141414; border-radius: 10px; overflow: hidden; }
    th { background: #1a1a1a; color: #FFD700; padding: 12px 14px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .signature-section { margin-top: 40px; padding-top: 30px; border-top: 2px solid #2a2a2a; }
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 20px; }
    .sig-box { border: 1px dashed #2a2a2a; border-radius: 10px; padding: 20px; text-align: center; }
    .sig-line { border-bottom: 1px solid #6a6a6a; margin: 30px 0 10px; }
    .sig-name { color: #9a9a9a; font-size: 13px; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #2a2a2a; color: #6a6a6a; font-size: 11px; }
    @media print { body { background: #fff; color: #000; } .section-title { color: #1a3a5c; } th { background: #f0f0f0; color: #1a3a5c; } .info-item { background: #f8f8f8; border-color: #e0e0e0; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">IVXHOLDINGS</div>
    <div class="subtitle">Joint Venture Agreement</div>
    <div class="agreement-title">${agreement.title}</div>
    <div class="badge">JV-${agreement.id.toUpperCase()} | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>

  <div class="section">
    <div class="section-title">Agreement Overview</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Project</div><div class="info-value">${agreement.projectName}</div></div>
      <div class="info-item"><div class="info-label">Type</div><div class="info-value gold">${JV_AGREEMENT_TYPES.find(t => t.id === agreement.type)?.label || agreement.type}</div></div>
      <div class="info-item"><div class="info-label">Total Investment</div><div class="info-value green">${formatCurrency(agreement.totalInvestment)}</div></div>
      <div class="info-item"><div class="info-label">Expected ROI</div><div class="info-value green">${agreement.expectedROI}%</div></div>
      <div class="info-item"><div class="info-label">Start Date</div><div class="info-value">${agreement.startDate}</div></div>
      <div class="info-item"><div class="info-label">End Date</div><div class="info-value">${agreement.endDate}</div></div>
      <div class="info-item"><div class="info-label">Distribution</div><div class="info-value">${agreement.distributionFrequency}</div></div>
      <div class="info-item"><div class="info-label">Exit Strategy</div><div class="info-value">${agreement.exitStrategy}</div></div>
    </div>
  </div>

  ${agreement.propertyAddress ? `<div class="section"><div class="section-title">Property</div><div class="info-item"><div class="info-label">Address</div><div class="info-value">${agreement.propertyAddress}</div></div><p style="color:#9a9a9a;margin-top:12px;line-height:1.6;">${agreement.description}</p></div>` : ''}

  <div class="section">
    <div class="section-title">Partners & Capital Structure</div>
    <table>
      <thead><tr><th>Partner</th><th>Role</th><th>Contribution</th><th>Equity</th><th>Location</th></tr></thead>
      <tbody>${partnersHTML}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Profit Distribution</div>
    ${profitSplitHTML}
  </div>

  <div class="section">
    <div class="section-title">Fee Structure</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Management Fee</div><div class="info-value">${agreement.managementFee}% p.a.</div></div>
      <div class="info-item"><div class="info-label">Performance Fee</div><div class="info-value">${agreement.performanceFee}% above hurdle</div></div>
      <div class="info-item"><div class="info-label">Min Hold Period</div><div class="info-value">${agreement.minimumHoldPeriod} months</div></div>
      <div class="info-item"><div class="info-label">Non-Compete</div><div class="info-value">${agreement.nonCompetePeriod} months</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Legal Provisions</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Governing Law</div><div class="info-value">${agreement.governingLaw}</div></div>
      <div class="info-item"><div class="info-label">Dispute Resolution</div><div class="info-value">${agreement.disputeResolution}</div></div>
      <div class="info-item"><div class="info-label">Confidentiality</div><div class="info-value">${agreement.confidentialityPeriod} months</div></div>
      <div class="info-item"><div class="info-label">Non-Compete</div><div class="info-value">${agreement.nonCompetePeriod} months</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Key Clauses</div>
    ${clausesHTML}
  </div>

  <div class="signature-section">
    <div class="section-title">Signatures</div>
    <div class="sig-grid">
      ${partners.map(p => `
        <div class="sig-box">
          <div style="color:#FFD700;font-weight:700;margin-bottom:4px;">${ROLE_CONFIG[p.role]?.label || p.role}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${p.name}</div>
          <div style="color:#6a6a6a;font-size:11px;margin-top:4px;">Date: _______________</div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    <p>This Joint Venture Agreement is confidential and proprietary to the parties named herein.</p>
    <p style="margin-top:8px;">IVXHOLDINGS Global Investments — JV Agreement System</p>
    <p style="margin-top:4px;">Generated: ${new Date().toISOString()}</p>
  </div>
</body>
</html>`;
}

export default function JVAgreementScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const editIdHandledRef = useRef<string | null>(null);

  const [mode, setMode] = useState<ScreenMode>('list');
  const [agreements, setAgreements] = useState<JVAgreement[]>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<JVAgreement | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const persistLocal = useCallback(async (deals: JVAgreement[]) => {
    try {
      if (deals.length === 0) {
        const existingRaw = await AsyncStorage.getItem('ivx_jv_agreements_cache');
        if (existingRaw) {
          const existing = JSON.parse(existingRaw);
          if (Array.isArray(existing) && existing.length > 0) {
            console.log('[JV] 🛡️ SAFETY: persistLocal refusing to overwrite', existing.length, 'cached deals with empty array');
            return;
          }
        }
      }
      const json = JSON.stringify(deals);
      await Promise.all([
        AsyncStorage.setItem('ivx_jv_agreements_cache', json),
        AsyncStorage.setItem(`@ivx_p_ivx-holdings::jv_deals_v2`, json),
      ]);
      console.log('[JV] Persisted', deals.length, 'deals to BOTH cache keys (backup + primary)');
    } catch (err) {
      console.log('[JV] Local persist error:', (err as Error)?.message);
    }
  }, []);

  const cleanRef = useRef(false);
  useEffect(() => {
    if (cleanRef.current) return;
    cleanRef.current = true;
    console.log('[JV] Local cache preserved as backup (no longer cleared on mount)');
  }, []);

  const backendDealsQuery = useQuery({
    queryKey: ['jvAgreements.list'],
    queryFn: async () => {
      console.log('[JV] Fetching all JV deals for agreements screen (Platform:', Platform.OS, ')...');
      const result = await fetchJVDeals({});

  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
      console.log('[JV] fetchJVDeals returned', result.deals.length, 'deals, total:', result.total);
      if (result.deals.length === 0) {
        console.log('[JV] No deals returned — retrying with forceReset...');
        const retryResult = await fetchJVDeals({ forceReset: true });
        console.log('[JV] forceReset retry returned', retryResult.deals.length, 'deals');
        if (retryResult.deals.length > 0) return retryResult;

        console.log('[JV] Still 0 deals after forceReset — second retry in 2s...');
        await new Promise(r => setTimeout(r, 2000));
        const lastTry = await fetchJVDeals({ forceReset: true });
        console.log('[JV] Last resort retry returned', lastTry.deals.length, 'deals');
        if (lastTry.deals.length > 0) return lastTry;
      }
      return result;
    },
    retry: 6,
    retryDelay: (attempt: number) => Math.min(1500 * Math.pow(1.5, attempt), 10000),
    refetchOnWindowFocus: true,
    refetchOnMount: 'always' as const,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 60,
    placeholderData: (previousData: { deals: any[]; total: number } | undefined) => previousData});

  useEffect(() => {
    if (backendDealsQuery.data) {
      console.log('[JV] Fetched deals from backend:', backendDealsQuery.data.total);
      if (backendDealsQuery.data.deals && backendDealsQuery.data.deals.length > 0) {
        const backendDeals: JVAgreement[] = backendDealsQuery.data.deals.map((d: any) => ({
          id: d.id,
          title: d.title,
          projectName: d.projectName,
          status: d.status || 'active',
          type: d.type || 'equity_split',
          totalInvestment: d.totalInvestment || 0,
          currency: d.currency || 'USD',
          partners: safePartners(d.partners),
          profitSplit: safeProfitSplit(d.profitSplit),
          poolTiers: safePoolTiers(d.poolTiers),
          startDate: d.startDate || '',
          endDate: d.endDate || '',
          createdAt: d.createdAt || '',
          updatedAt: d.updatedAt,
          propertyAddress: d.propertyAddress,
          expectedROI: d.expectedROI || 0,
          distributionFrequency: d.distributionFrequency || 'quarterly',
          exitStrategy: d.exitStrategy || '',
          governingLaw: d.governingLaw || '',
          disputeResolution: d.disputeResolution || '',
          confidentialityPeriod: d.confidentialityPeriod || 60,
          nonCompetePeriod: d.nonCompetePeriod || 24,
          managementFee: d.managementFee || 2,
          performanceFee: d.performanceFee || 20,
          minimumHoldPeriod: d.minimumHoldPeriod || 12,
          description: d.description || '',
          photos: safePhotos(d.photos).length > 0 ? safePhotos(d.photos) : undefined,
          published: d.published ?? false,
          publishedAt: d.publishedAt ?? null}));
        const seenIds = new Set<string>();
        const dedupedDeals = backendDeals.filter(d => {
          if (seenIds.has(d.id)) {
            console.log('[JV] ⚠️ DEDUP: Removing duplicate deal from backend data:', d.id, d.title);
            return false;
          }
          const s = d.status as string;
          if (s === 'trashed' || s === 'archived' || s === 'permanently_deleted') {
            console.log('[JV] Filtering out deleted deal:', d.id, d.title, 'status:', s);
            return false;
          }
          seenIds.add(d.id);
          return true;
        });
        if (dedupedDeals.length !== backendDeals.length) {
          console.log('[JV] ⚠️ Removed', backendDeals.length - dedupedDeals.length, 'duplicate deals from backend response');
        }
        setAgreements(() => {
          console.log('[JV] Setting', dedupedDeals.length, 'deals from backend (deduped, source of truth)');
          return dedupedDeals;
        });
        void persistLocal(dedupedDeals);
        console.log('[JV] Synced', dedupedDeals.length, 'deals from backend to local state, photos:', backendDeals.filter(d => d.photos && d.photos.length > 0).length, 'deals with photos');
      } else if (backendDealsQuery.data.deals && backendDealsQuery.data.deals.length === 0) {
        console.log('[JV] 🛡️ Backend returned 0 deals — PRESERVING current local state to prevent data loss');
        if (agreements.length > 0) {
          console.log('[JV] 🛡️ SAFETY: Keeping', agreements.length, 'existing deals in UI — refusing to show empty list');
        }
      }
    }
  }, [backendDealsQuery.data, persistLocal, agreements.length]);

  useEffect(() => {
    if (backendDealsQuery.error) {
      console.log('[JV] Backend fetch error:', backendDealsQuery.error.message);
    }
  }, [backendDealsQuery.error]);

  const queryClient = useQueryClient();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    partners: false,
    terms: false,
    fees: false,
    legal: false,
    clauses: false,
    photos_section: true,
    pool_tiers: true});

  const [formTitle, setFormTitle] = useState<string>('');
  const [formProjectName, setFormProjectName] = useState<string>('');
  const [formType, setFormType] = useState<string>('equity_split');
  const [formTotalInvestment, setFormTotalInvestment] = useState<string>('');

  const formTitleRef = useRef<string>('');
  const formProjectNameRef = useRef<string>('');
  const formTotalInvestmentRef = useRef<string>('');
  const editingAgreementIdRef = useRef<string | null>(null);
  const formPhotosRef = useRef<string[]>([]);
  const [formCurrency, setFormCurrency] = useState<string>('USD');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formPropertyAddress, setFormPropertyAddress] = useState<string>('');
  const [formExpectedROI, setFormExpectedROI] = useState<string>('');
  const [formDistribution, setFormDistribution] = useState<string>('quarterly');
  const [formExitStrategy, setFormExitStrategy] = useState<string>(EXIT_STRATEGIES[0]);
  const [formGoverningLaw, setFormGoverningLaw] = useState<string>('State of New York, USA');
  const [formDisputeResolution, setFormDisputeResolution] = useState<string>('Arbitration — JAMS');
  const [formConfidentiality, setFormConfidentiality] = useState<string>('60');
  const [formNonCompete, setFormNonCompete] = useState<string>('24');
  const [formManagementFee, setFormManagementFee] = useState<string>('2.0');
  const [formPerformanceFee, setFormPerformanceFee] = useState<string>('20.0');
  const [formMinHold, setFormMinHold] = useState<string>('12');
  const [formStartDate, setFormStartDate] = useState<string>(new Date().toISOString().split('T')[0] ?? '');
  const [formEndDate, setFormEndDate] = useState<string>('');

  const [partners, setPartners] = useState<JVPartner[]>([
    { id: 'new-p1', name: 'IVX Holdings LLC', role: 'lp', contribution: 0, equityShare: 50, location: 'New York, USA', verified: true },
  ]);

  const [formPoolTiers, setFormPoolTiers] = useState<PoolTier[]>([
    { id: 'pool-jv', label: 'JV Investment', type: 'jv_direct', targetAmount: 1000000, minInvestment: 100, currentRaised: 0, investorCount: 0, status: 'open' },
  ]);

  const [editingAgreementId, setEditingAgreementId] = useState<string | null>(null);

  const [formPhotos, setFormPhotos] = useState<string[]>([]);

  useEffect(() => { formTitleRef.current = formTitle; }, [formTitle]);
  useEffect(() => { formProjectNameRef.current = formProjectName; }, [formProjectName]);
  useEffect(() => { formTotalInvestmentRef.current = formTotalInvestment; }, [formTotalInvestment]);
  useEffect(() => { editingAgreementIdRef.current = editingAgreementId; }, [editingAgreementId]);
  useEffect(() => { formPhotosRef.current = formPhotos; }, [formPhotos]);
  const [galleryIndex, setGalleryIndex] = useState<number>(0);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);
  const screenWidth = Dimensions.get('window').width;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(30);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 12, useNativeDriver: true }),
    ]).start();
  }, [mode, fadeAnim, slideAnim]);

  const filteredAgreements = useMemo(() => {
    if (activeFilter === 'all') return agreements;
    return agreements.filter(a => a.status === activeFilter);
  }, [agreements, activeFilter]);

  const totalPortfolioValue = useMemo(() => {
    return agreements.reduce((sum, a) => sum + a.totalInvestment, 0);
  }, [agreements]);

  const activeDeals = useMemo(() => {
    return agreements.filter(a => a.status === 'active').length;
  }, [agreements]);

  const avgROI = useMemo(() => {
    if (agreements.length === 0) return 0;
    return agreements.reduce((sum, a) => sum + a.expectedROI, 0) / agreements.length;
  }, [agreements]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const addPartner = useCallback(() => {
    const newId = `new-p${partners.length + 1}-${Date.now()}`;
    setPartners(prev => [...prev, {
      id: newId,
      name: '',
      role: 'lp',
      contribution: 0,
      equityShare: 0,
      location: '',
      verified: false}]);
  }, [partners.length]);

  const removePartner = useCallback((index: number) => {
    if (partners.length <= 1) {
      Alert.alert('Required', 'At least one partner is required.');
      return;
    }
    setPartners(prev => prev.filter((_, i) => i !== index));
  }, [partners.length]);

  const updatePartner = useCallback((index: number, field: keyof JVPartner, value: string | number) => {
    setPartners(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }, []);

  const addPoolTier = useCallback(() => {
    const newId = `tier-${formPoolTiers.length + 1}-${Date.now()}`;
    setFormPoolTiers(prev => [...prev, {
      id: newId,
      label: '',
      type: 'open' as const,
      targetAmount: 0,
      minInvestment: 0,
      currentRaised: 0,
      investorCount: 0,
      status: 'open' as const}]);
  }, [formPoolTiers.length]);

  const removePoolTier = useCallback((index: number) => {
    setFormPoolTiers(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updatePoolTier = useCallback((index: number, field: keyof PoolTier, value: string | number) => {
    setFormPoolTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  }, []);

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormProjectName('');
    setFormType('equity_split');
    setFormTotalInvestment('');
    setFormCurrency('USD');
    setFormDescription('');
    setFormPropertyAddress('');
    setFormExpectedROI('');
    setFormDistribution('quarterly');
    setFormExitStrategy(EXIT_STRATEGIES[0]);
    setFormGoverningLaw('State of New York, USA');
    setFormDisputeResolution('Arbitration — JAMS');
    setFormConfidentiality('60');
    setFormNonCompete('24');
    setFormManagementFee('2.0');
    setFormPerformanceFee('20.0');
    setFormMinHold('12');
    setFormStartDate(new Date().toISOString().split('T')[0] ?? '');
    setFormEndDate('');
    setPartners([{
      id: 'new-p1',
      name: 'IVX Holdings LLC',
      role: 'lp',
      contribution: 0,
      equityShare: 50,
      location: 'New York, USA',
      verified: true}]);
    setFormPoolTiers([
      { id: 'pool-jv', label: 'JV Investment', type: 'jv_direct', targetAmount: 1000000, minInvestment: 100, currentRaised: 0, investorCount: 0, status: 'open' },

    ]);
    setFormPhotos([]);
    setEditingAgreementId(null);
  }, []);

  const loadAgreementForEdit = useCallback((agreement: JVAgreement) => {
    setEditingAgreementId(agreement.id);
    setFormTitle(agreement.title);
    setFormProjectName(agreement.projectName);
    setFormType(agreement.type);
    setFormTotalInvestment(agreement.totalInvestment ? formatAmountInput(String(agreement.totalInvestment)) : '');
    setFormCurrency(agreement.currency);
    setFormDescription(agreement.description);
    setFormPropertyAddress(agreement.propertyAddress || '');
    setFormExpectedROI(agreement.expectedROI ? String(agreement.expectedROI) : '');
    setFormDistribution(agreement.distributionFrequency);
    setFormExitStrategy(agreement.exitStrategy);
    setFormGoverningLaw(agreement.governingLaw);
    setFormDisputeResolution(agreement.disputeResolution);
    setFormConfidentiality(String(agreement.confidentialityPeriod));
    setFormNonCompete(String(agreement.nonCompetePeriod));
    setFormManagementFee(String(agreement.managementFee));
    setFormPerformanceFee(String(agreement.performanceFee));
    setFormMinHold(String(agreement.minimumHoldPeriod));
    setFormStartDate(agreement.startDate);
    setFormEndDate(agreement.endDate);
    setPartners(safePartners(agreement.partners).map(p => ({ ...p })));
    setFormPoolTiers(safePoolTiers(agreement.poolTiers).map(t => ({ ...t })));
    setFormPhotos(safePhotos(agreement.photos));
    setExpandedSections({ overview: true, partners: true, terms: false, fees: false, legal: false, clauses: false, photos_section: true, pool_tiers: true });
    setMode('edit');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    console.log('[JV] Loaded agreement for editing:', agreement.id);
  }, []);

  useEffect(() => {
    if (!editId || editIdHandledRef.current === editId) return;
    if (!backendDealsQuery.data?.deals || backendDealsQuery.data.deals.length === 0) return;
    const dealToEdit = agreements.find(a => a.id === editId);
    if (dealToEdit) {
      editIdHandledRef.current = editId;
      console.log('[JV] Auto-loading deal for edit from editId param:', editId);
      loadAgreementForEdit(dealToEdit);
    }
  }, [editId, agreements, backendDealsQuery.data, loadAgreementForEdit]);

  const pickPhotos = useCallback(async () => {
    try {
      const remaining = 8 - formPhotos.length;
      if (remaining <= 0) {
        Alert.alert('Limit Reached', 'Maximum 8 photos allowed per project.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.85,
        exif: false});
      if (!result.canceled && result.assets) {
        const newUris = result.assets.map(a => a.uri);
        setFormPhotos(prev => {
          const combined = [...prev, ...newUris];
          return combined.slice(0, 8);
        });
        console.log('[JV] Photos picked:', newUris.length);
      }
    } catch (error) {
      console.log('[JV] Photo pick error:', error);
      Alert.alert('Error', 'Failed to pick photos.');
    }
  }, [formPhotos]);

  const takePhoto = useCallback(async () => {
    if (formPhotos.length >= 8) {
      Alert.alert('Limit Reached', 'Maximum 8 photos allowed per project.');
      return;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        allowsEditing: false,
        exif: false});
      if (!result.canceled && result.assets) {
        const firstAsset = result.assets[0];
        if (firstAsset) setFormPhotos(prev => [...prev, firstAsset.uri].slice(0, 8));
        console.log('[JV] Photo taken');
      }
    } catch (error) {
      console.log('[JV] Camera error:', error);
      Alert.alert('Error', 'Failed to take photo.');
    }
  }, [formPhotos]);

  const { isAdmin } = useAuth();

  const removePhoto = useCallback((index: number) => {
    if (editingAgreementId) {
      console.log('[JV] ❌ BLOCKED: Photo removal from existing deal is DISABLED. Deal:', editingAgreementId, 'isAdmin:', isAdmin, 'index:', index);
      Alert.alert(
        'Photo Removal Blocked',
        'Photos cannot be removed from existing deals through this screen. Use the Admin Panel > JV Deals > Photo Management to manage photos safely.',
        [{ text: 'OK' }]
      );
      return;
    }
    console.log('[JV] removePhoto — new deal (no editingId), index:', index);
    setFormPhotos(prev => prev.filter((_, i) => i !== index));
  }, [isAdmin, editingAgreementId]);

  const [isUploadingPhotos, setIsUploadingPhotos] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');


  const convertPhotoToBase64 = useCallback(async (uri: string): Promise<{ base64: string; mimeType: string } | null> => {
    try {
      if (uri.startsWith('data:image/')) {
        const mimeMatch = uri.match(/^data:(image\/[^;]+);/);
        return { base64: uri, mimeType: mimeMatch?.[1] ?? 'image/jpeg' };
      }

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const mimeType = blob.type || 'image/jpeg';

        const MAX_WEB_KB = 500;
        const needsCompress = blob.size > MAX_WEB_KB * 1024;
        console.log('[JV] Web photo:', (blob.size / 1024).toFixed(0), 'KB, needsCompress:', needsCompress);

        try {
          const bitmap = await createImageBitmap(blob);
          const maxDim = 1200;
          let w = bitmap.width;
          let h = bitmap.height;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, w, h);
            const quality = 0.65;
            const compressedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(compressedBlob);
            });
            console.log('[JV] Compressed photo from', (blob.size / 1024).toFixed(0), 'KB to', (compressedBlob.size / 1024).toFixed(0), 'KB, dims:', w, 'x', h);
            if (compressedBlob.size > 500 * 1024) {
              const retryW = Math.round(w * 0.7);
              const retryH = Math.round(h * 0.7);
              const tinyCanvas = new OffscreenCanvas(retryW, retryH);
              const tinyCtx = tinyCanvas.getContext('2d');
              if (tinyCtx) {
                tinyCtx.drawImage(bitmap, 0, 0, retryW, retryH);
                const tinyBlob = await tinyCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.45 });
                const tinyBase64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(tinyBlob);
                });
                console.log('[JV] Re-compressed to', (tinyBlob.size / 1024).toFixed(0), 'KB at', retryW, 'x', retryH);
                return { base64: tinyBase64, mimeType: 'image/jpeg' };
              }
            }
            return { base64, mimeType: 'image/jpeg' };
          }
        } catch (compressErr) {
          console.warn('[JV] Web compression failed, using raw:', (compressErr as Error)?.message);
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return { base64, mimeType };
      }

      const response = await fetch(uri);
      const blob = await response.blob();
      let mimeType = blob.type || 'image/jpeg';
      if (uri.toLowerCase().includes('.png')) mimeType = 'image/png';
      else if (uri.toLowerCase().includes('.webp')) mimeType = 'image/webp';
      console.log('[JV] Native photo fetched, size:', (blob.size / 1024 / 1024).toFixed(1), 'MB');

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      return { base64, mimeType };
    } catch (err) {
      console.error('[JV] convertPhotoToBase64 error:', (err as Error)?.message);
      return null;
    }
  }, []);

  const _uploadAllPhotos = useCallback(async (dealId: string, photos: string[]): Promise<string[]> => {
    if (!photos || photos.length === 0) {
      console.log('[JV] No photos to upload');
      return [];
    }

    setIsUploadingPhotos(true);
    console.log('[JV] Starting photo upload pipeline for deal:', dealId, 'photos:', photos.length);

    try {
      const { urls, failedCount, errors: uploadErrors } = await uploadDealPhotosParallel(
        dealId,
        photos,
        (_idx, _result, completed, total) => {
          setUploadProgress(`Uploading photo ${completed} of ${total}...`);
        },
      );

      console.log('[JV] Photo upload pipeline complete:', urls.length, 'URLs,', failedCount, 'failed');

      if (failedCount > 0 && urls.length === 0) {
        const allQueued = uploadErrors.every(e => e === 'offline_queued');
        if (allQueued && uploadErrors.length > 0) {
          Alert.alert('Photos Queued', `${uploadErrors.length} photo(s) saved locally and will upload automatically when internet is available.`);
          setIsUploadingPhotos(false);
          setUploadProgress('');
          return [];
        }
        console.log('[JV] All Storage uploads failed, falling back to base64 conversion...');
        const fallbackUrls: string[] = [];
        for (let i = 0; i < photos.length; i++) {
          const uri = photos[i];
          if (!uri) continue;
          const isRemote = (uri.startsWith('https://') || uri.startsWith('http://')) && !uri.startsWith('blob:');
          if (isRemote) {
            fallbackUrls.push(uri);
            continue;
          }
          try {
            const converted = await convertPhotoToBase64(uri);
            if (converted?.base64) {
              fallbackUrls.push(converted.base64);
              console.log('[JV] Base64 fallback photo', i + 1, 'size:', (converted.base64.length / 1024).toFixed(0), 'KB');
            }
          } catch {
            console.log('[JV] Base64 fallback also failed for photo', i + 1);
          }
        }
        setIsUploadingPhotos(false);
        setUploadProgress('');
        return fallbackUrls;
      }

      if (failedCount > 0) {
        Alert.alert(
          'Photo Upload Issue',
          `${failedCount} photo(s) could not be uploaded to cloud storage. The deal was saved but some photos may be missing. Try re-editing and uploading them again.`,
          [{ text: 'OK' }]
        );
      }

      setIsUploadingPhotos(false);
      setUploadProgress('');
      return urls;
    } catch (err) {
      console.error('[JV] Photo upload pipeline error:', (err as Error)?.message);
      setIsUploadingPhotos(false);
      setUploadProgress('');
      return [];
    }
  }, [convertPhotoToBase64]);

  const saveAndPublishMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      console.log('[JV] saveAndPublish via jv-storage');
      const { data, error } = await upsertJVDeal({
        ...payload,
        published: true,
        publishedAt: new Date().toISOString()});
      if (error) {
        console.error('[JV] saveAndPublish ERROR:', error.message);
        throw error;
      }
      console.log('[JV] saveAndPublish success — id:', (data as Record<string, unknown>)?.id);
      return data as Record<string, unknown>;
    }});

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      console.log('[JV] save via jv-storage');
      const { data, error } = await upsertJVDeal(payload);
      if (error) {
        console.error('[JV] save ERROR:', error.message);
        throw error;
      }
      console.log('[JV] Saved to backend:', (data as Record<string, unknown>)?.id);
      return data as Record<string, unknown>;
    }});

  const buildJVPayload = useCallback((agreement: JVAgreement, skipLocalPhotos = false) => {
    const payloadPartners = safePartners(agreement.partners);
    const payloadProfitSplit = safeProfitSplit(agreement.profitSplit) as { partnerId: string; percentage: number }[];
    const rawPhotos: string[] = safePhotos(agreement.photos);
    const isHostedUrl = (p: string) => typeof p === 'string' && p.length > 0 && (p.startsWith('https://') || p.startsWith('http://')) && !p.startsWith('blob:');
    const filteredPhotos: string[] = skipLocalPhotos ? rawPhotos.filter(isHostedUrl) : rawPhotos.filter((p: string) => isHostedUrl(p) || (typeof p === 'string' && p.startsWith('data:image/')));
    const safePoolTiersArr = safePoolTiers(agreement.poolTiers);
    console.log('[JV] buildJVPayload — photos raw:', rawPhotos.length, 'safe (remote URLs):', filteredPhotos.length, 'skipLocalPhotos:', skipLocalPhotos);

    const today = new Date().toISOString().split('T')[0];
    const threeYearsLater = new Date(Date.now() + 365 * 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const validRoles = ['lp', 'silent', 'co_investor'] as const;
    const validTypes = ['equity_split', 'profit_sharing', 'hybrid', 'development'] as const;
    const validFreqs = ['monthly', 'quarterly', 'annually', 'at_exit'] as const;
    const validTierTypes = ['jv_direct', 'token_shares', 'private_lending', 'open', 'tokenized', 'single_investor', 'institutional', 'custom'] as const;
    type ValidTierType = typeof validTierTypes[number];
    const validTierStatuses = ['open', 'closed', 'filled'] as const;

    const payload: any = {
      id: agreement.id || undefined,
      title: String(agreement.title || 'Untitled Deal').trim(),
      projectName: String(agreement.projectName || 'Untitled Project').trim(),
      type: validTypes.includes(agreement.type as any) ? agreement.type : 'equity_split',
      totalInvestment: Number(agreement.totalInvestment) || 0,
      currency: agreement.currency || 'USD',
      partners: payloadPartners.map(p => ({
        id: String(p?.id || `p-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`),
        name: String(p?.name || 'Partner').trim(),
        role: (validRoles.includes(p?.role as any) ? p.role : 'lp') as 'lp' | 'silent' | 'co_investor',
        contribution: Number(p?.contribution) || 0,
        equityShare: Number(p?.equityShare) || 0,
        location: String(p?.location || ''),
        verified: Boolean(p?.verified)})),
      profitSplit: payloadProfitSplit.map((ps: { partnerId: string; percentage: number }) => ({
        partnerId: String(ps?.partnerId || ''),
        percentage: Number(ps?.percentage) || 0})),
      startDate: agreement.startDate || today,
      endDate: agreement.endDate || threeYearsLater,
      propertyAddress: agreement.propertyAddress || undefined,
      expectedROI: Number(agreement.expectedROI) || 15,
      distributionFrequency: (validFreqs.includes(agreement.distributionFrequency as any) ? agreement.distributionFrequency : 'quarterly') as 'monthly' | 'quarterly' | 'annually' | 'at_exit',
      exitStrategy: agreement.exitStrategy || 'Sale of Property',
      governingLaw: agreement.governingLaw || 'State of New York, USA',
      disputeResolution: agreement.disputeResolution || 'Arbitration \u2014 JAMS',
      confidentialityPeriod: Number(agreement.confidentialityPeriod) || 60,
      nonCompetePeriod: Number(agreement.nonCompetePeriod) || 24,
      managementFee: Number(agreement.managementFee) || 2,
      performanceFee: Number(agreement.performanceFee) || 20,
      minimumHoldPeriod: Number(agreement.minimumHoldPeriod) || 12,
      description: String(agreement.description || '')};

    if (filteredPhotos.length > 0) {
      payload.photos = filteredPhotos;
    }
    console.log('[JV] buildJVPayload — photos:', filteredPhotos.length, 'in payload, skipLocalPhotos:', skipLocalPhotos);

    if (safePoolTiersArr.length > 0) {
      payload.poolTiers = safePoolTiersArr.map(t => ({
        id: String(t?.id || `tier-${Date.now()}`),
        label: String(t?.label || ''),
        type: (validTierTypes.includes(t?.type as any) ? t.type : 'open') as ValidTierType,
        targetAmount: Number(t?.targetAmount) || 0,
        minInvestment: Number(t?.minInvestment) || 0,
        maxInvestors: t?.maxInvestors ? Number(t.maxInvestors) : undefined,
        currentRaised: Number(t?.currentRaised) || 0,
        investorCount: Number(t?.investorCount) || 0,
        status: (validTierStatuses.includes(t?.status as any) ? t.status : 'open') as 'open' | 'closed' | 'filled'}));
    }

    return payload;
  }, []);



  const handleSaveAndPublish = useCallback(async (agreement: JVAgreement, existingBackendId?: string, _localPhotosToUpload?: string[]) => {
    setIsPublishing(true);
    let backendId: string | null = null;
    let errorMsg: string | null = null;

    const isUpdate = existingBackendId || isExistingBackendId(agreement.id);
    const idToUpdate = existingBackendId || agreement.id;

    const processedPhotos: string[] = [];
    const publishPhotos = safePhotos(agreement.photos);
    if (publishPhotos.length > 0) {
      for (const photo of publishPhotos) {
        const isRemote = (photo.startsWith('https://') || photo.startsWith('http://')) && !photo.startsWith('blob:');
        const isDataUri = photo.startsWith('data:image/');
        if (isRemote || isDataUri) {
          processedPhotos.push(photo);
        } else {
          try {
            const converted = await convertPhotoToBase64(photo);
            if (converted?.base64) {
              processedPhotos.push(converted.base64);
              console.log('[JV] Converted photo in publish, size:', (converted.base64.length / 1024).toFixed(0), 'KB');
            }
          } catch (convErr) {
            console.warn('[JV] Photo conversion in publish failed:', (convErr as Error)?.message);
          }
        }
      }
    }
    const agreementWithPhotos: JVAgreement = { ...agreement, partners: safePartners(agreement.partners), profitSplit: safeProfitSplit(agreement.profitSplit) as any, poolTiers: safePoolTiers(agreement.poolTiers), photos: processedPhotos.length > 0 ? processedPhotos : undefined };

    try {
      const payload = buildJVPayload(agreementWithPhotos, false);
      console.log('[JV] saveAndPublish — mode:', isUpdate ? 'UPDATE' : 'CREATE', 'for:', agreement.title);
      console.log('[JV] saveAndPublish — payload keys:', Object.keys(payload).join(', '));
      console.log('[JV] saveAndPublish — partners:', (payload.partners || []).length, 'photos in payload:', (payload.photos || []).length, 'poolTiers:', (payload.poolTiers || []).length);

      if (isUpdate) {
        console.log('[JV] Updating + publishing existing agreement in single call:', idToUpdate);
        console.log('[JV] Photos in payload:', (payload.photos || []).length, 'photo sizes:', (payload.photos || []).map((p: string) => `${(p.length / 1024).toFixed(0)}KB`).join(', '));
        const { data: updateData, error: updateErr } = await updateJVDeal(idToUpdate, {
          ...payload,
          published: true,
          publishedAt: new Date().toISOString()});
        if (updateErr) {
          console.error('[JV] Combined update+publish ERROR:', updateErr.message);
          throw updateErr;
        }
        backendId = (updateData as any)?.id || idToUpdate;
        console.log('[JV] Updated & Published in single call — LIVE:', backendId, 'photos saved:', ((updateData as any)?.photos || []).length);
      } else {
        console.log('[JV] Creating new agreement via saveAndPublish');
        console.log('[JV] Photos in payload:', (payload.photos || []).length, 'photo sizes:', (payload.photos || []).map((p: string) => `${(p.length / 1024).toFixed(0)}KB`).join(', '));
        const result = await saveAndPublishMutation.mutateAsync(payload);
        console.log('[JV] saveAndPublish — result:', JSON.stringify(result).substring(0, 300));

        if (result?.id) {
          backendId = typeof result.id === 'string' ? result.id : JSON.stringify(result.id);
          console.log('[JV] saveAndPublish — LIVE with id:', backendId, 'photos saved:', ((result as any)?.photos || []).length);
        } else {
          errorMsg = 'Server returned no ID. Please try again.';
          console.error('[JV] saveAndPublish — no id returned');
        }
      }
    } catch (err: any) {
      const errMessage = err?.message || '';
      const errData = err?.data?.message || err?.shape?.message || '';
      errorMsg = errMessage || errData || 'Network error — please check your connection and try again.';
      console.error('[JV] saveAndPublish — CATCH error:', errMessage || errData);
      try {
        console.error('[JV] saveAndPublish — full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)).substring(0, 1000));
      } catch {
        console.error('[JV] saveAndPublish — error (not serializable):', String(err));
      }
    }

    const didPublish = backendId !== null;

    setAgreements(prev => {
      const updated = prev.map(a =>
        a.id === agreement.id
          ? {
              ...a,
              id: backendId || agreement.id,
              ...(didPublish
                ? { status: 'active' as JVAgreement['status'], published: true, publishedAt: new Date().toISOString() }
                : {})}
          : a
      );
      return updated;
    });

    try {
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      await backendDealsQuery.refetch();
      console.log('[JV] Invalidated all JV queries after publish/save, didPublish:', didPublish);

      if (didPublish && backendId) {
        const verifyId = backendId;
        setTimeout(async () => {
          try {
            const verifyResult = await fetchJVDeals({ published: true });
            const found = verifyResult.deals.find((d: any) => d.id === verifyId);
            if (found) {
              console.log('[JV] ✅ POST-PUBLISH VERIFY: Deal', verifyId, 'confirmed visible in published list. Title:', found.title, 'Status:', found.status, 'Published:', found.published);
            } else {
              console.error('[JV] ❌ POST-PUBLISH VERIFY FAILED: Deal', verifyId, 'NOT found in published list! Total published deals:', verifyResult.deals.length);
              console.error('[JV] Published deal IDs:', verifyResult.deals.map((d: any) => d.id).join(', '));
            }
          } catch (verifyErr) {
            console.warn('[JV] Post-publish verify error:', (verifyErr as Error)?.message);
          }
        }, 2000);
      }
    } catch (refetchErr) {
      console.warn('[JV] Refetch after publish failed:', (refetchErr as Error)?.message);
    }
    if (selectedAgreement?.id === agreement.id && didPublish) {
      const refetched = backendDealsQuery.data?.deals?.find(d => d.id === (backendId || agreement.id));
      const finalPhotos = safePhotos(refetched?.photos).length > 0 ? safePhotos(refetched?.photos) : safePhotos(agreement.photos);
      setSelectedAgreement({
        ...agreement,
        id: backendId || agreement.id,
        status: 'active',
        published: true,
        publishedAt: new Date().toISOString(),
        photos: finalPhotos,
        partners: safePartners(agreement.partners),
        profitSplit: safeProfitSplit(agreement.profitSplit) as any,
        poolTiers: safePoolTiers(agreement.poolTiers)});
    }

    setIsPublishing(false);
    setIsSaving(false);

    if (didPublish) {
      try {
        console.log('[JV] Triggering landing page sync after publish...');
        const syncResult = await syncToLandingPage();
        console.log('[JV] Landing sync result:', syncResult.success, 'synced:', syncResult.syncedDeals, 'errors:', syncResult.errors.length);
        if (syncResult.errors.length > 0) {
          console.warn('[JV] Landing sync had errors:', syncResult.errors.join('; '));
        }
      } catch (syncErr) {
        console.warn('[JV] Landing sync failed (non-blocking):', (syncErr as Error)?.message);
      }

      Alert.alert(
        'Published — LIVE!',
        `"${agreement.title}" is now LIVE on your landing page and invest module in real time.\n\nInvestors worldwide can see this deal and start investing immediately.`,
        [
          {
            text: 'Go to Invest',
            style: 'default',
            onPress: () => router.push('/(tabs)/invest' as any)},
          { text: 'Stay Here', style: 'cancel' },
        ]
      );
    } else {
      Alert.alert(
        'Publish Failed',
        `Could not publish "${agreement.title}" right now.\n\nError: ${errorMsg || 'Unknown error'}\n\nPlease try again.`,
        [
          { text: 'Retry', style: 'default', onPress: () => void handleSaveAndPublish(agreement, existingBackendId) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  }, [saveAndPublishMutation, selectedAgreement, backendDealsQuery, buildJVPayload, router, queryClient, convertPhotoToBase64]);

  const _handleSaveDraft = useCallback(async (agreement: JVAgreement) => {
    setIsSaving(true);
    let backendId: string | null = null;
    try {
      const payload = buildJVPayload(agreement);
      console.log('[JV] Save draft - sending payload:', agreement.title);

      const saveResult = await saveMutation.mutateAsync(payload);
      console.log('[JV] Draft save result:', JSON.stringify(saveResult).substring(0, 300));

      if (saveResult?.id) {
        backendId = typeof saveResult.id === 'string' ? saveResult.id : JSON.stringify(saveResult.id);
        console.log('[JV] Saved draft to backend successfully:', backendId);
      }
    } catch (err: any) {
      console.error('[JV] Draft save error:', err?.message || err);
    }

    setAgreements(prev => {
      const updated = prev.map(a =>
        a.id === agreement.id ? { ...a, id: backendId || agreement.id } : a
      );
      void persistLocal(updated);
      return updated;
    });

    if (backendId) {
      try {
        resetSupabaseCheck();
        invalidateAllJVQueries(queryClient);
        void backendDealsQuery.refetch();
      } catch { /* ignore */ }
    }

    setIsSaving(false);

    Alert.alert(
      backendId ? 'Saved to Server' : 'Save Failed',
      backendId
        ? `"${agreement.title}" has been saved to your account.`
        : `Could not save "${agreement.title}". Please check your connection and try again.`,
      [{ text: 'OK' }]
    );
  }, [saveMutation, backendDealsQuery, buildJVPayload, persistLocal, queryClient]);

  const buildAgreementFromForm = useCallback((): JVAgreement => {
    return {
      id: editingAgreementId || generateJVNumber(),
      title: formTitle.trim(),
      projectName: formProjectName.trim(),
      status: 'active' as const,
      type: formType as JVAgreement['type'],
      totalInvestment: parseFloat(parseAmountInput(formTotalInvestment)) || 0,
      currency: formCurrency,
      partners: partners.map(p => ({ ...p })),
      profitSplit: partners.map(p => ({ partnerId: p.id, percentage: p.equityShare })),
      photos: formPhotos.length > 0 ? [...formPhotos] : undefined,
      poolTiers: formPoolTiers.length > 0 ? formPoolTiers.map(t => ({ ...t })) : undefined,
      startDate: formStartDate,
      endDate: formEndDate || calculateDefaultEndDate(formStartDate),
      createdAt: new Date().toISOString().split('T')[0] ?? '',
      propertyAddress: formPropertyAddress.trim() || undefined,
      expectedROI: parseFloat(formExpectedROI) || 15,
      distributionFrequency: formDistribution as JVAgreement['distributionFrequency'],
      exitStrategy: formExitStrategy,
      governingLaw: formGoverningLaw,
      disputeResolution: formDisputeResolution,
      confidentialityPeriod: parseInt(formConfidentiality) || 60,
      nonCompetePeriod: parseInt(formNonCompete) || 24,
      managementFee: parseFloat(formManagementFee) || 2,
      performanceFee: parseFloat(formPerformanceFee) || 20,
      minimumHoldPeriod: parseInt(formMinHold) || 12,
      description: formDescription.trim()};
  }, [formTitle, formProjectName, formTotalInvestment, formCurrency, formType, formDescription, formPropertyAddress, formExpectedROI, formDistribution, formExitStrategy, formGoverningLaw, formDisputeResolution, formConfidentiality, formNonCompete, formManagementFee, formPerformanceFee, formMinHold, formStartDate, formEndDate, partners, formPhotos, formPoolTiers, editingAgreementId]);

  const publishLockRef = useRef<boolean>(false);

  const handleCreateAndPublish = useCallback(async () => {
    if (publishLockRef.current || isPublishing || isSaving) {
      console.log('[JV] handleCreateAndPublish BLOCKED — already in progress (lock:', publishLockRef.current, 'publishing:', isPublishing, 'saving:', isSaving, ')');
      return;
    }
    publishLockRef.current = true;

    const currentTitle = formTitleRef.current;
    const currentProjectName = formProjectNameRef.current;
    const currentTotalInvestment = formTotalInvestmentRef.current;
    const currentEditingId = editingAgreementIdRef.current;
    const currentPhotos = formPhotosRef.current;

    console.log('[JV] handleCreateAndPublish — title:', JSON.stringify(currentTitle), 'project:', JSON.stringify(currentProjectName), 'investment:', JSON.stringify(currentTotalInvestment));

    const missing: string[] = [];
    if (!currentTitle.trim()) missing.push('Agreement Title');
    if (!currentProjectName.trim()) missing.push('Project Name');
    if (!currentTotalInvestment.trim()) missing.push('Total Investment');
    if (missing.length > 0) {
      Alert.alert('Required Fields', `Please fill in: ${missing.join(', ')}`);
      publishLockRef.current = false;
      return;
    }

    setIsPublishing(true);

    const processedPhotos: string[] = [];
    for (const photo of currentPhotos) {
      const isRemote = (photo.startsWith('https://') || photo.startsWith('http://')) && !photo.startsWith('blob:');
      const isDataUri = photo.startsWith('data:image/');
      if (isRemote) {
        processedPhotos.push(photo);
      } else if (isDataUri) {
        processedPhotos.push(photo);
      } else {
        try {
          const converted = await convertPhotoToBase64(photo);
          if (converted?.base64) {
            processedPhotos.push(converted.base64);
            console.log('[JV] Converted local photo to base64, size:', (converted.base64.length / 1024).toFixed(0), 'KB');
          }
        } catch (err) {
          console.warn('[JV] Photo conversion failed:', (err as Error)?.message);
        }
      }
    }
    console.log('[JV] Photos converted:', processedPhotos.length, 'of', formPhotos.length);

    const newAgreement = buildAgreementFromForm();
    newAgreement.photos = processedPhotos.length > 0 ? processedPhotos : undefined;
    const existingId = currentEditingId && isExistingBackendId(currentEditingId) ? currentEditingId : undefined;

    console.log('[JV] handleCreateAndPublish — editing:', currentEditingId, 'existingBackendId:', existingId, 'photos:', processedPhotos.length);

    if (currentEditingId) {
      setAgreements(prev => prev.map(a => a.id === currentEditingId ? newAgreement : a));
    } else {
      setAgreements(prev => [newAgreement, ...prev]);
    }

    setMode('list');
    scrollRef.current?.scrollTo({ y: 0, animated: true });

    try {
      await handleSaveAndPublish(newAgreement, existingId);
    } catch (err) {
      console.error('[JV] handleCreateAndPublish save error:', (err as Error)?.message);
    } finally {
      publishLockRef.current = false;
    }

    resetForm();
  }, [buildAgreementFromForm, resetForm, handleSaveAndPublish, convertPhotoToBase64, formPhotos.length, isPublishing, isSaving]);

  const handleExportPDF = useCallback(async (agreement: JVAgreement) => {
    setIsGenerating(true);
    try {
      const html = generateJVContractHTML(agreement);
      if (Platform.OS === 'web') {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        console.log('[JV Agreement] PDF created:', uri);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `JV Agreement — ${agreement.title}` });
        } else {
          Alert.alert('PDF Generated', `File: ${uri}`);
        }
      }
    } catch (error) {
      console.log('[JV Agreement] Export error:', error);
      Alert.alert('Error', 'Failed to generate PDF.');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handlePreview = useCallback(async (agreement: JVAgreement) => {
    try {
      const html = generateJVContractHTML(agreement);
      if (Platform.OS === 'web') {
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.log('[JV Agreement] Preview error:', error);
    }
  }, []);

  const handleShareWhatsApp = useCallback(async (agreement: JVAgreement) => {
    const msg = `IVXHOLDINGS — Joint Venture Agreement\n\n` +
      `Project: ${agreement.title}\n` +
      `Total Investment: ${formatCurrency(agreement.totalInvestment)}\n` +
      `Expected ROI: ${agreement.expectedROI}%\n` +
      `Partners: ${safePartners(agreement.partners).length}\n` +
      `Type: ${JV_AGREEMENT_TYPES.find(t => t.id === agreement.type)?.label}\n\n` +
      `Partners:\n${safePartners(agreement.partners).map(p => `- ${p.name} (${p.equityShare}% equity)`).join('\n')}\n\n` +
      `Status: ${STATUS_CONFIG[agreement.status]?.label || agreement.status}\n` +
      `Distribution: ${agreement.distributionFrequency}\n` +
      `Exit Strategy: ${agreement.exitStrategy}`;

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    try {
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        const supported = await Linking.canOpenURL(url);
        if (supported) await Linking.openURL(url);
      }
    } catch (error) {
      console.log('[JV Agreement] WhatsApp error:', error);
    }
  }, []);

  const renderInput = useCallback((label: string, value: string, onChangeText: (t: string) => void, opts?: { multiline?: boolean; keyboardType?: 'default' | 'numeric' | 'email-address'; placeholder?: string }) => (
    <View style={st.inputGroup}>
      <Text style={st.inputLabel}>{label}</Text>
      <TextInput
        style={[st.input, opts?.multiline && st.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={Colors.inputPlaceholder}
        placeholder={opts?.placeholder || label}
        multiline={opts?.multiline}
        keyboardType={opts?.keyboardType || 'default'}
        numberOfLines={opts?.multiline ? 4 : 1}
        textAlignVertical={opts?.multiline ? 'top' : 'center'}
      />
    </View>
  ), []);

  const renderSectionHeader = useCallback((key: string, title: string, icon: React.ReactNode) => (
    <TouchableOpacity style={st.sectionHeader} onPress={() => toggleSection(key)} activeOpacity={0.7}>
      <View style={st.sectionHeaderLeft}>
        <View style={st.sectionIcon}>{icon}</View>
        <Text style={st.sectionHeaderTitle}>{title}</Text>
      </View>
      {expandedSections[key] ? <ChevronUp size={20} color={Colors.textSecondary} /> : <ChevronDown size={20} color={Colors.textSecondary} />}
    </TouchableOpacity>
  ), [expandedSections, toggleSection]);

  const renderPortfolioStats = () => (
    <View style={st.statsRow}>
      <View style={st.statCard}>
        <View style={[st.statIconWrap, { backgroundColor: '#FFD70015' }]}>
          <DollarSign size={18} color="#FFD700" />
        </View>
        <Text style={st.statValue} numberOfLines={1} adjustsFontSizeToFit>{formatCurrency(totalPortfolioValue)}</Text>
        <Text style={st.statLabel}>Portfolio Value</Text>
      </View>
      <View style={st.statCard}>
        <View style={[st.statIconWrap, { backgroundColor: '#00C48C15' }]}>
          <Handshake size={18} color="#00C48C" />
        </View>
        <Text style={st.statValue}>{activeDeals}</Text>
        <Text style={st.statLabel}>Active Deals</Text>
      </View>
      <View style={st.statCard}>
        <View style={[st.statIconWrap, { backgroundColor: '#4A90D915' }]}>
          <TrendingUp size={18} color="#4A90D9" />
        </View>
        <Text style={st.statValue}>{avgROI.toFixed(1)}%</Text>
        <Text style={st.statLabel}>Avg ROI</Text>
      </View>
    </View>
  );

  const renderFilters = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filtersRow}>
      {[
        { id: 'all', label: 'All' },
        { id: 'active', label: 'Live' },
        { id: 'pending_review', label: 'Pending' },
        { id: 'completed', label: 'Completed' },
      ].map(f => (
        <TouchableOpacity
          key={f.id}
          style={[st.filterChip, activeFilter === f.id && st.filterChipActive]}
          onPress={() => setActiveFilter(f.id)}
          activeOpacity={0.7}
        >
          <Text style={[st.filterChipText, activeFilter === f.id && st.filterChipTextActive]}>{f.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderAgreementCard = (agreement: JVAgreement) => {
    const statusCfg = STATUS_CONFIG[agreement.status] ?? DEFAULT_STATUS!;
    const typeCfg = JV_AGREEMENT_TYPES.find(t => t.id === agreement.type);
    let validPhotos = safePhotos(agreement.photos).filter((p: string) => typeof p === 'string' && (p.startsWith('http') || p.startsWith('data:image/')));
    if (validPhotos.length === 0) {
      try {
        const { getFallbackPhotosForDeal } = require('@/constants/deal-photos');
        validPhotos = getFallbackPhotosForDeal(agreement);
      } catch {}
    }

    return (
      <TouchableOpacity
        style={st.igCard}
        onPress={() => {
          const safeAg: JVAgreement = {
            ...agreement,
            partners: safePartners(agreement.partners),
            profitSplit: safeProfitSplit(agreement.profitSplit) as any,
            poolTiers: safePoolTiers(agreement.poolTiers),
            photos: safePhotos(agreement.photos).length > 0 ? safePhotos(agreement.photos) : undefined};
          setSelectedAgreement(safeAg);
          setMode('detail');
        }}
        activeOpacity={0.9}
        testID={`jv-card-${agreement.id}`}
      >
        {validPhotos.length > 0 ? (
          <View style={st.igCardGalleryWrap}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={st.igCardGalleryScroll}
            >
              {validPhotos.map((uri: string, idx: number) => (
                <Image
                  key={`card-photo-${agreement.id}-${idx}`}
                  source={{ uri }}
                  style={[st.igCardImage, { width: screenWidth - 40 }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
            <View style={st.igCardOverlayTop}>
              <View style={[st.statusBadge, { backgroundColor: statusCfg.bg }]}>
                <View style={[st.statusDot, { backgroundColor: statusCfg.color }]} />
                <Text style={[st.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              </View>
              <View style={st.igCardPhotoCount}>
                <ImageIcon size={10} color="#fff" />
                <Text style={st.igCardPhotoCountText}>{validPhotos.length}</Text>
              </View>
            </View>
            {agreement.published && (
              <View style={st.igCardLiveBadge}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#00C48C' }} />
                <Text style={{ color: '#00C48C', fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.8 }}>LIVE</Text>
              </View>
            )}
            {validPhotos.length > 1 && (
              <View style={st.igCardDots}>
                {validPhotos.map((_: string, idx: number) => (
                  <View key={idx} style={[st.igCardDot, idx === 0 && st.igCardDotActive]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={st.igCardNoPhoto}>
            <ImageIcon size={32} color="#3A3A3A" />
            <Text style={st.igCardNoPhotoText}>No photos yet</Text>
            <View style={st.igCardOverlayTop}>
              <View style={[st.statusBadge, { backgroundColor: statusCfg.bg }]}>
                <View style={[st.statusDot, { backgroundColor: statusCfg.color }]} />
                <Text style={[st.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              </View>
            </View>
            {agreement.published && (
              <View style={st.igCardLiveBadge}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#00C48C' }} />
                <Text style={{ color: '#00C48C', fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.8 }}>LIVE</Text>
              </View>
            )}
          </View>
        )}

        <View style={st.igCardBody}>
          <View style={st.igCardHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.igCardTitle}>{agreement.title}</Text>
              <Text style={st.igCardProject}>{agreement.projectName}</Text>
            </View>
            <View style={st.igCardTypeBadge}>
              <Text style={st.igCardTypeText}>{typeCfg?.icon} {typeCfg?.label}</Text>
            </View>
          </View>

          {agreement.propertyAddress ? (
            <View style={st.igCardLocationRow}>
              <MapPin size={12} color="#5A5A5A" />
              <Text style={st.igCardLocation} numberOfLines={1}>{agreement.propertyAddress}</Text>
            </View>
          ) : null}

          <View style={st.igCardMetrics}>
            <View style={st.igCardMetric}>
              <DollarSign size={14} color="#FFD700" />
              <Text style={st.igCardMetricValue} numberOfLines={1} adjustsFontSizeToFit>{formatCurrency(agreement.totalInvestment)}</Text>
              <Text style={st.igCardMetricLabel}>Total Investment</Text>
            </View>
            <View style={st.igCardMetricDivider} />
            <View style={st.igCardMetric}>
              <TrendingUp size={14} color="#00C48C" />
              <Text style={[st.igCardMetricValue, { color: '#00C48C' }]}>{agreement.expectedROI}%</Text>
              <Text style={st.igCardMetricLabel}>Expected ROI</Text>
            </View>
            <View style={st.igCardMetricDivider} />
            <View style={st.igCardMetric}>
              <Users size={14} color="#4A90D9" />
              <Text style={st.igCardMetricValue}>{safePartners(agreement.partners).length}</Text>
              <Text style={st.igCardMetricLabel}>Partners</Text>
            </View>
          </View>

          <View style={st.igCardFooter}>
            <View style={st.igCardAvatars}>
              {safePartners(agreement.partners).slice(0, 3).map((p, i) => (
                <View key={`avatar-${p.id}-${i}`} style={[st.partnerAvatarSmall, { backgroundColor: ROLE_CONFIG[p.role]?.color || '#666', marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }]}>
                  <Text style={st.partnerAvatarText}>{p.name.charAt(0)}</Text>
                </View>
              ))}
              {safePartners(agreement.partners).length > 3 && (
                <Text style={st.morePartners}>+{safePartners(agreement.partners).length - 3}</Text>
              )}
            </View>
            <View style={st.igCardActions}>
              {!agreement.published && (
                <>
                  <TouchableOpacity
                    style={st.editCardBtn}
                    onPress={() => loadAgreementForEdit(agreement)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Edit3 size={14} color={Colors.primary} />
                  </TouchableOpacity>

                </>
              )}
              {agreement.published && (
                <View style={{ backgroundColor: '#00C48C15', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 4 }}>
                  <Text style={{ color: '#00C48C', fontSize: 10, fontWeight: '700' as const }}>Admin Only</Text>
                </View>
              )}
              <ChevronRight size={16} color={Colors.textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderListMode = () => (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <View style={st.heroCard}>
        <View style={st.heroIconRow}>
          <Handshake size={28} color="#FFD700" />
          <Shield size={22} color="#00C48C" />
          <Scale size={22} color="#4A90D9" />
        </View>
        <Text style={st.heroTitle}>Joint Venture Agreements</Text>
        <Text style={st.heroSubtitle}>Smart, secure partnerships for global real estate investment. Create, manage, and track JV deals with institutional-grade legal protection.</Text>
      </View>

      {renderPortfolioStats()}
      {renderFilters()}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <TouchableOpacity
          style={[st.createBtn, { flex: 1, marginTop: 0 }]}
          onPress={() => { resetForm(); setMode('create'); }}
          activeOpacity={0.85}
          testID="jv-create-new"
        >
          <Plus size={20} color="#000" />
          <Text style={st.createBtnText}>Create New</Text>
        </TouchableOpacity>
      </View>

      {agreements.some(a => a.published) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: '#1A1A2E', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#2A2A3E' }}>
          <Shield size={16} color="#FFD700" />
          <Text style={{ color: '#9A9A9A', fontSize: 12, flex: 1 }}>
            {'Live deals can only be edited or deleted from the '}
            <Text style={{ color: '#FFD700', fontWeight: '700' as const }}>Admin Panel.</Text>
          </Text>
        </View>
      )}

      {filteredAgreements.length === 0 ? (
        <View style={st.emptyState}>
          {backendDealsQuery.isLoading || backendDealsQuery.isFetching ? (
            <>
              <ShimmerIndicator size="large" color="#FFD700" />
              <Text style={st.emptyTitle}>Loading Deals...</Text>
              <Text style={st.emptySubtitle}>Connecting to server{Platform.OS !== 'web' ? ' (mobile)' : ''}...</Text>
            </>
          ) : backendDealsQuery.isError ? (
            <>
              <Briefcase size={48} color="#FF4D4D" />
              <Text style={st.emptyTitle}>Connection Error</Text>
              <Text style={st.emptySubtitle}>Could not load deals. Check your connection and try again.</Text>
              <TouchableOpacity
                style={{ marginTop: 12, backgroundColor: '#FFD700', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}
                onPress={() => {
                  resetSupabaseCheck();
                  void backendDealsQuery.refetch();
                }}
              >
                <Text style={{ color: '#000', fontWeight: '700' as const, fontSize: 14 }}>Retry Now</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Briefcase size={48} color={Colors.textTertiary} />
              <Text style={st.emptyTitle}>No Agreements Found</Text>
              <Text style={st.emptySubtitle}>{activeFilter !== 'all' ? `No ${activeFilter} agreements. Try "All" filter.` : 'Create your first JV agreement to get started'}</Text>
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={{ marginTop: 12, backgroundColor: '#222', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#333' }}
                  onPress={() => {
                    resetSupabaseCheck();
                    void backendDealsQuery.refetch();
                  }}
                >
                  <Text style={{ color: '#FFD700', fontWeight: '600' as const, fontSize: 13 }}>Refresh from Server</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      ) : (
        filteredAgreements.map((agreement, idx) => (
          <React.Fragment key={`jv-${agreement.id || idx}-${idx}`}>
            {renderAgreementCard(agreement)}
          </React.Fragment>
        ))
      )}
    </Animated.View>
  );

  const renderDetailMode = () => {
    if (!selectedAgreement) return null;
    const ag = selectedAgreement;
    const statusCfg = STATUS_CONFIG[ag.status] ?? DEFAULT_STATUS!;
    const typeCfg = JV_AGREEMENT_TYPES.find(t => t.id === ag.type);
    const agPhotos = safePhotos(ag.photos);
    const agPoolTiers = safePoolTiers(ag.poolTiers);

    return (
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        {agPhotos.length > 0 && (
          <View style={st.igGalleryContainer}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                setGalleryIndex(idx);
              }}
              style={st.igGalleryScroll}
            >
              {agPhotos.map((uri, i) => (
                <TouchableOpacity
                  key={`gallery-${i}`}
                  activeOpacity={0.95}
                  onPress={() => setFullscreenPhoto(uri)}
                >
                  <Image
                    source={{ uri }}
                    style={[st.igGalleryImage, { width: screenWidth }]}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={st.igGalleryOverlay}>
              <View style={[st.statusBadge, { backgroundColor: statusCfg.bg }]}>
                <View style={[st.statusDot, { backgroundColor: statusCfg.color }]} />
                <Text style={[st.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              </View>
              <View style={st.igGalleryCounter}>
                <ImageIcon size={12} color="#fff" />
                <Text style={st.igGalleryCounterText}>{galleryIndex + 1}/{agPhotos.length}</Text>
              </View>
            </View>
            <View style={st.igGalleryDots}>
              {agPhotos.map((_: string, i: number) => (
                <View
                  key={`dot-${i}`}
                  style={[st.igGalleryDot, galleryIndex === i && st.igGalleryDotActive]}
                />
              ))}
            </View>
          </View>
        )}

        <View style={st.detailHero}>
          {agPhotos.length === 0 && (
            <View style={st.detailHeroTop}>
              <View style={[st.statusBadge, { backgroundColor: statusCfg.bg }]}>
                <View style={[st.statusDot, { backgroundColor: statusCfg.color }]} />
                <Text style={[st.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              </View>
              <Text style={st.detailType}>{typeCfg?.icon} {typeCfg?.label}</Text>
            </View>
          )}
          {agPhotos.length > 0 && (
            <View style={st.detailHeroTopInline}>
              <Text style={st.detailType}>{typeCfg?.icon} {typeCfg?.label}</Text>
            </View>
          )}
          <Text style={st.detailTitle}>{ag.title}</Text>
          <Text style={st.detailProject}>{ag.projectName}</Text>

          <View style={st.detailMetrics}>
            <View style={st.detailMetricItem}>
              <DollarSign size={16} color="#FFD700" />
              <Text style={st.detailMetricValue}>{formatCurrency(ag.totalInvestment)}</Text>
              <Text style={st.detailMetricLabel}>Total Investment</Text>
            </View>
            <View style={st.detailMetricItem}>
              <TrendingUp size={16} color="#00C48C" />
              <Text style={[st.detailMetricValue, { color: '#00C48C' }]}>{ag.expectedROI}%</Text>
              <Text style={st.detailMetricLabel}>Expected ROI</Text>
            </View>
            <View style={st.detailMetricItem}>
              <Users size={16} color="#4A90D9" />
              <Text style={st.detailMetricValue}>{safePartners(ag.partners).length}</Text>
              <Text style={st.detailMetricLabel}>Partners</Text>
            </View>
          </View>
        </View>

        {agPoolTiers.length > 0 && (
          <View style={st.formCard}>
            <View style={st.poolTableHeader}>
              <View style={st.poolTableHeaderLeft}>
                <View style={[st.sectionIcon, { backgroundColor: '#FFD70015' }]}>
                  <PieChart size={18} color="#FFD700" />
                </View>
                <Text style={st.sectionHeaderTitle}>Pool Investment Table</Text>
              </View>
              <View style={st.poolTotalBadge}>
                <Text style={st.poolTotalLabel}>Total Raise</Text>
                <Text style={st.poolTotalValue}>{formatCurrency(agPoolTiers.reduce((s: number, t: PoolTier) => s + t.targetAmount, 0))}</Text>
              </View>
            </View>

            <View style={st.poolTiersContainer}>
              {agPoolTiers.map((tier: PoolTier, tierIdx: number) => {
                const tierCfg = POOL_TIER_TYPES.find(t => t.id === tier.type);
                const fillPct = tier.targetAmount > 0 ? Math.min((tier.currentRaised / tier.targetAmount) * 100, 100) : 0;
                return (
                  <View key={`pool-${tier.id}-${tierIdx}`} style={st.poolTierCard}>
                    <View style={st.poolTierHeaderRow}>
                      <View style={st.poolTierLabelRow}>
                        <Text style={st.poolTierIcon}>{tierCfg?.icon || '\u2699\ufe0f'}</Text>
                        <View>
                          <Text style={st.poolTierLabel}>{tier.label || tierCfg?.label}</Text>
                          <Text style={[st.poolTierType, { color: tierCfg?.color || '#999' }]}>{tierCfg?.label}</Text>
                        </View>
                      </View>
                      <View style={[st.poolTierStatusBadge, {
                        backgroundColor: tier.status === 'open' ? '#00C48C20' : tier.status === 'filled' ? '#FFD70020' : '#FF4D4D20'
                      }]}>
                        <View style={[st.poolTierStatusDot, {
                          backgroundColor: tier.status === 'open' ? '#00C48C' : tier.status === 'filled' ? '#FFD700' : '#FF4D4D'
                        }]} />
                        <Text style={[st.poolTierStatusText, {
                          color: tier.status === 'open' ? '#00C48C' : tier.status === 'filled' ? '#FFD700' : '#FF4D4D'
                        }]}>{tier.status === 'open' ? 'Open' : tier.status === 'filled' ? 'Filled' : 'Closed'}</Text>
                      </View>
                    </View>

                    <View style={st.poolTierAmountRow}>
                      <Text style={st.poolTierTargetLabel}>Target</Text>
                      <Text style={st.poolTierTargetValue}>{formatCurrency(tier.targetAmount)}</Text>
                    </View>

                    <View style={st.poolTierProgressWrap}>
                      <View style={[st.poolTierProgressBar, { width: `${fillPct}%` as any, backgroundColor: tierCfg?.color || '#FFD700' }]} />
                    </View>
                    <View style={st.poolTierProgressLabels}>
                      <Text style={st.poolTierRaised}>{formatCurrency(tier.currentRaised)} raised</Text>
                      <Text style={st.poolTierPct}>{fillPct.toFixed(0)}%</Text>
                    </View>

                    <View style={st.poolTierInfoGrid}>
                      <View style={st.poolTierInfoItem}>
                        <Text style={st.poolTierInfoLabel}>Min Investment</Text>
                        <Text style={st.poolTierInfoValue}>{formatCurrency(tier.minInvestment)}</Text>
                      </View>
                      <View style={st.poolTierInfoDivider} />
                      <View style={st.poolTierInfoItem}>
                        <Text style={st.poolTierInfoLabel}>Max Investors</Text>
                        <Text style={st.poolTierInfoValue}>{tier.maxInvestors ? tier.maxInvestors : 'Unlimited'}</Text>
                      </View>
                      <View style={st.poolTierInfoDivider} />
                      <View style={st.poolTierInfoItem}>
                        <Text style={st.poolTierInfoLabel}>Investors</Text>
                        <Text style={st.poolTierInfoValue}>{tier.investorCount}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {!ag.published ? (
          <>
            <TouchableOpacity
              style={st.editDetailBtn}
              onPress={() => loadAgreementForEdit(ag)}
              activeOpacity={0.85}
              testID="jv-detail-edit"
            >
              <Edit3 size={18} color="#000" />
              <Text style={st.editDetailBtnText}>Edit This Deal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={st.publishDetailBtn}
              onPress={() => handleSaveAndPublish(ag)}
              activeOpacity={0.85}
              disabled={isSaving || isPublishing}
              testID="jv-detail-publish"
            >
              <Globe size={18} color="#fff" />
              <Text style={st.publishDetailBtnText}>
                {isSaving ? 'Saving...' : isPublishing ? 'Publishing...' : 'Save & Publish to Landing Page'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={{ backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#FFD70030', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Shield size={18} color="#FFD700" />
              <Text style={{ color: '#FFD700', fontSize: 15, fontWeight: '700' as const }}>Published & Live</Text>
            </View>
            <Text style={{ color: '#9A9A9A', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>This deal is live. To edit or delete, go to the Admin Panel → JV Deal Management.</Text>
          </View>
        )}

        <View style={st.detailActions}>
          <TouchableOpacity style={st.actionBtn} onPress={() => handlePreview(ag)} activeOpacity={0.7}>
            <Eye size={16} color={Colors.primary} />
            <Text style={st.actionBtnText}>Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.actionBtn} onPress={() => handleExportPDF(ag)} activeOpacity={0.7} disabled={isGenerating}>
            <Download size={16} color="#00C48C" />
            <Text style={[st.actionBtnText, { color: '#00C48C' }]}>{isGenerating ? 'Generating...' : 'Export PDF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.actionBtn} onPress={() => handleShareWhatsApp(ag)} activeOpacity={0.7}>
            <MessageCircle size={16} color="#25D366" />
            <Text style={[st.actionBtnText, { color: '#25D366' }]}>WhatsApp</Text>
          </TouchableOpacity>
        </View>

        <View style={st.formCard}>
          {renderSectionHeader('overview', 'Agreement Overview', <FileText size={18} color={Colors.primary} />)}
          {expandedSections.overview && (
            <View style={st.sectionContent}>
              {ag.propertyAddress && (
                <View style={st.detailInfoRow}>
                  <MapPin size={14} color={Colors.textTertiary} />
                  <Text style={st.detailInfoText}>{ag.propertyAddress}</Text>
                </View>
              )}
              <Text style={st.detailDescription}>{ag.description}</Text>

              <View style={st.infoGrid}>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Start Date</Text>
                  <Text style={st.infoValue}>{ag.startDate}</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>End Date</Text>
                  <Text style={st.infoValue}>{ag.endDate}</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Distribution</Text>
                  <Text style={st.infoValue}>{ag.distributionFrequency}</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Exit Strategy</Text>
                  <Text style={st.infoValue}>{ag.exitStrategy}</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={st.formCard}>
          {renderSectionHeader('partners', 'Partners & Capital Structure', <Users size={18} color="#4A90D9" />)}
          {expandedSections.partners && (
            <View style={st.sectionContent}>
              {safePartners(ag.partners).map((p, pIdx) => {
                const roleCfg = ROLE_CONFIG[p.role] ?? ROLE_CONFIG.silent ?? { label: 'Partner', color: '#9A9A9A', description: '' };
                return (
                  <View key={`partner-${p.id}-${pIdx}`} style={st.partnerCard}>
                    <View style={st.partnerCardTop}>
                      <View style={[st.partnerAvatar, { backgroundColor: roleCfg.color }]}>
                        <Text style={st.partnerAvatarLetter}>{p.name.charAt(0)}</Text>
                      </View>
                      <View style={st.partnerInfo}>
                        <Text style={st.partnerName}>{p.name}</Text>
                        <View style={st.partnerRoleBadge}>
                          <Text style={[st.partnerRoleText, { color: roleCfg.color }]}>{roleCfg.label}</Text>
                        </View>
                      </View>
                      {p.verified && <UserCheck size={16} color="#00C48C" />}
                    </View>
                    <View style={st.partnerMetrics}>
                      <View style={st.partnerMetricItem}>
                        <Text style={st.partnerMetricLabel}>Contribution</Text>
                        <Text style={[st.partnerMetricValue, { color: '#00C48C' }]}>{formatCurrency(p.contribution)}</Text>
                      </View>
                      <View style={st.partnerMetricItem}>
                        <Text style={st.partnerMetricLabel}>Equity Share</Text>
                        <Text style={[st.partnerMetricValue, { color: '#FFD700' }]}>{p.equityShare}%</Text>
                      </View>
                      <View style={st.partnerMetricItem}>
                        <Text style={st.partnerMetricLabel}>Location</Text>
                        <Text style={st.partnerMetricValue}>{p.location}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}

              <View style={st.profitSplitCard}>
                <Text style={st.profitSplitTitle}>Profit Distribution</Text>
                {safeProfitSplit(ag.profitSplit).map((ps, psIdx) => {
                  const partner = safePartners(ag.partners).find(p => p.id === ps.partnerId);
                  return (
                    <View key={`profit-${ps.partnerId}-${psIdx}`} style={st.profitSplitRow}>
                      <Text style={st.profitSplitName}>{partner?.name || 'Unknown'}</Text>
                      <View style={st.profitBarWrap}>
                        <View style={[st.profitBar, { width: `${ps.percentage}%` as any }]} />
                      </View>
                      <Text style={st.profitSplitPct}>{ps.percentage}%</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        <View style={st.formCard}>
          {renderSectionHeader('fees', 'Fee Structure', <PieChart size={18} color="#E879F9" />)}
          {expandedSections.fees && (
            <View style={st.sectionContent}>
              <View style={st.infoGrid}>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Management Fee</Text>
                  <Text style={st.infoValue}>{ag.managementFee}% p.a.</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Performance Fee</Text>
                  <Text style={st.infoValue}>{ag.performanceFee}%</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Min Hold Period</Text>
                  <Text style={st.infoValue}>{ag.minimumHoldPeriod} months</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={st.formCard}>
          {renderSectionHeader('legal', 'Legal Provisions', <Gavel size={18} color="#FF6B6B" />)}
          {expandedSections.legal && (
            <View style={st.sectionContent}>
              <View style={st.infoGrid}>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Governing Law</Text>
                  <Text style={st.infoValue}>{ag.governingLaw}</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Dispute Resolution</Text>
                  <Text style={st.infoValue}>{ag.disputeResolution}</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Confidentiality</Text>
                  <Text style={st.infoValue}>{ag.confidentialityPeriod} months</Text>
                </View>
                <View style={st.infoItem}>
                  <Text style={st.infoLabel}>Non-Compete</Text>
                  <Text style={st.infoValue}>{ag.nonCompetePeriod} months</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={st.formCard}>
          {renderSectionHeader('clauses', 'Key Clauses & Protections', <Shield size={18} color="#FFD700" />)}
          {expandedSections.clauses && (
            <View style={st.sectionContent}>
              {Object.entries(JV_CLAUSES).map(([key, clause]) => (
                <View key={key} style={st.clauseCard}>
                  <Text style={st.clauseTitle}>{clause.title}</Text>
                  <Text style={st.clauseDesc}>{clause.description}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Animated.View>
    );
  };

  const renderCreateMode = () => (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <View style={st.createHero}>
        <Sparkles size={28} color="#FFD700" />
        <Text style={st.createHeroTitle}>{editingAgreementId ? 'Edit JV Agreement' : 'New JV Agreement'}</Text>
        <Text style={st.createHeroSubtitle}>{editingAgreementId ? 'Update your joint venture agreement details below.' : 'Create a professionally structured joint venture agreement with full legal protection.'}</Text>
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('overview', 'Agreement Details', <FileText size={18} color={Colors.primary} />)}
        {expandedSections.overview && (
          <View style={st.sectionContent}>
            {renderInput('Agreement Title', formTitle, setFormTitle, { placeholder: 'e.g. Manhattan Luxury Development JV' })}
            {renderInput('Project Name', formProjectName, setFormProjectName, { placeholder: 'e.g. The Pinnacle @ 5th Ave' })}
            {renderInput('Property Address', formPropertyAddress, setFormPropertyAddress, { placeholder: 'e.g. 432 5th Avenue, New York' })}
            {renderInput('Description', formDescription, setFormDescription, { multiline: true, placeholder: 'Describe the joint venture project...' })}

            <Text style={st.inputLabel}>Agreement Type</Text>
            <View style={st.typeGrid}>
              {JV_AGREEMENT_TYPES.map(type => (
                <TouchableOpacity
                  key={type.id}
                  style={[st.typeCard, formType === type.id && { borderColor: type.color, backgroundColor: type.color + '12' }]}
                  onPress={() => setFormType(type.id)}
                  activeOpacity={0.8}
                >
                  <Text style={st.typeEmoji}>{type.icon}</Text>
                  <Text style={st.typeLabel}>{type.label}</Text>
                  <Text style={st.typeDesc}>{type.desc}</Text>
                  {formType === type.id && (
                    <View style={[st.typeCheck, { backgroundColor: type.color }]}>
                      <CheckCircle size={12} color="#000" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={st.rowInputs}>
              <View style={{ flex: 1 }}>
                {renderInput('Total Investment ($)', formTotalInvestment ? formatAmountInput(formTotalInvestment) : '', (v) => setFormTotalInvestment(parseAmountInput(v)), { keyboardType: 'numeric', placeholder: '5,000,000' })}
              </View>
              <View style={{ width: 100 }}>
                {renderInput('Currency', formCurrency, setFormCurrency)}
              </View>
            </View>

            {renderInput('Expected ROI (%)', formExpectedROI, setFormExpectedROI, { keyboardType: 'numeric', placeholder: '22.5' })}

            <Text style={st.inputLabel}>Distribution Frequency</Text>
            <View style={st.chipRow}>
              {DISTRIBUTION_FREQUENCIES.map(df => (
                <TouchableOpacity
                  key={df.id}
                  style={[st.chip, formDistribution === df.id && st.chipActive]}
                  onPress={() => setFormDistribution(df.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[st.chipText, formDistribution === df.id && st.chipTextActive]}>{df.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={st.inputLabel}>Exit Strategy</Text>
            <View style={st.chipRow}>
              {EXIT_STRATEGIES.map(es => (
                <TouchableOpacity
                  key={es}
                  style={[st.chip, formExitStrategy === es && st.chipActive]}
                  onPress={() => setFormExitStrategy(es)}
                  activeOpacity={0.7}
                >
                  <Text style={[st.chipText, formExitStrategy === es && st.chipTextActive]}>{es}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={st.rowInputs}>
              <View style={{ flex: 1 }}>
                {renderInput('Start Date', formStartDate, setFormStartDate, { placeholder: 'YYYY-MM-DD' })}
              </View>
              <View style={{ flex: 1 }}>
                {renderInput('End Date', formEndDate, setFormEndDate, { placeholder: 'YYYY-MM-DD' })}
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('partners', 'Partners', <Users size={18} color="#4A90D9" />)}
        {expandedSections.partners && (
          <View style={st.sectionContent}>
            {partners.map((partner, index) => (
              <View key={`form-partner-${partner.id}-${index}`} style={st.partnerFormCard}>
                <View style={st.partnerFormHeader}>
                  <Text style={st.partnerFormTitle}>Partner {index + 1}</Text>
                  {partners.length > 1 && (
                    <TouchableOpacity onPress={() => removePartner(index)} activeOpacity={0.7}>
                      <Trash2 size={18} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                {renderInput('Name', partner.name, (v) => updatePartner(index, 'name', v), { placeholder: 'Partner name' })}
                
                <Text style={st.inputLabel}>Role</Text>
                <View style={st.chipRow}>
                  {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                    <TouchableOpacity
                      key={key}
                      style={[st.chip, partner.role === key && { borderColor: cfg.color, backgroundColor: cfg.color + '20' }]}
                      onPress={() => updatePartner(index, 'role', key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[st.chipText, partner.role === key && { color: cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={st.rowInputs}>
                  <View style={{ flex: 1 }}>
                    {renderInput('Contribution ($)', partner.contribution ? formatAmountInput(String(partner.contribution)) : '', (v) => updatePartner(index, 'contribution', parseFloat(parseAmountInput(v)) || 0), { keyboardType: 'numeric' })}
                  </View>
                  <View style={{ width: 100 }}>
                    {renderInput('Equity %', String(partner.equityShare || ''), (v) => updatePartner(index, 'equityShare', parseFloat(v) || 0), { keyboardType: 'numeric' })}
                  </View>
                </View>
                {renderInput('Location', partner.location, (v) => updatePartner(index, 'location', v), { placeholder: 'City, Country' })}
              </View>
            ))}

            <TouchableOpacity style={st.addPartnerBtn} onPress={addPartner} activeOpacity={0.7}>
              <Plus size={18} color={Colors.primary} />
              <Text style={st.addPartnerText}>Add Partner</Text>
            </TouchableOpacity>

            <View style={st.equitySummary}>
              <Text style={st.equitySummaryLabel}>Total Equity Allocated</Text>
              <Text style={[st.equitySummaryValue, { color: partners.reduce((s, p) => s + p.equityShare, 0) === 100 ? '#00C48C' : '#FF4D4D' }]}>
                {partners.reduce((s, p) => s + p.equityShare, 0)}%
              </Text>
              {partners.reduce((s, p) => s + p.equityShare, 0) !== 100 && (
                <Text style={st.equityWarning}>{partners.reduce((s, p) => s + p.equityShare, 0) > 100 ? 'Exceeds 100% — review equity split' : `${100 - partners.reduce((s, p) => s + p.equityShare, 0)}% unallocated — add more partners or adjust`}</Text>
              )}
            </View>
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('photos_section', 'Project Photos', <Camera size={18} color="#FF9500" />)}
        {expandedSections.photos_section && (
          <View style={st.sectionContent}>
            <Text style={st.photoHint}>Upload up to 8 high-quality photos to showcase your project to investors</Text>

            {formPhotos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.photoPreviewScroll}>
                {formPhotos.map((uri, i) => {
                  const isLocal = uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('blob:') || uri.startsWith('data:image/');
                  return (
                    <View key={`photo-${i}`} style={st.photoPreviewItem}>
                      <Image source={{ uri }} style={st.photoPreviewImage} />
                      {!editingAgreementId && (
                        <TouchableOpacity
                          style={st.photoRemoveBtn}
                          onPress={() => removePhoto(i)}
                          activeOpacity={0.7}
                        >
                          <X size={14} color="#fff" />
                        </TouchableOpacity>
                      )}
                      <View style={[st.photoIndexBadge, isLocal ? { backgroundColor: '#FF9500' } : { backgroundColor: '#00C48C' }]}>
                        <Text style={st.photoIndexText}>{isLocal ? '↑' : '✓'}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <View style={st.photoUploadRow}>
              <TouchableOpacity style={st.photoUploadBtn} onPress={pickPhotos} activeOpacity={0.7}>
                <ImageIcon size={20} color={Colors.primary} />
                <Text style={st.photoUploadBtnText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.photoUploadBtn} onPress={takePhoto} activeOpacity={0.7}>
                <Camera size={20} color="#FF9500" />
                <Text style={[st.photoUploadBtnText, { color: '#FF9500' }]}>Camera</Text>
              </TouchableOpacity>
            </View>
            <Text style={st.photoCount}>{formPhotos.length}/8 photos added</Text>
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('pool_tiers', 'Pool Investment Table', <PieChart size={18} color="#FFD700" />)}
        {expandedSections.pool_tiers && (
          <View style={st.sectionContent}>
            <Text style={st.photoHint}>Define investment tiers for your deal. Investors select a pool to participate in.</Text>

            <View style={st.poolFormSummary}>
              <View style={st.poolFormSummaryRow}>
                <Text style={st.poolFormSummaryLabel}>Total Raise Target</Text>
                <Text style={st.poolFormSummaryValue}>{formatCurrency(formPoolTiers.reduce((s, t) => s + t.targetAmount, 0))}</Text>
              </View>
              <View style={st.poolFormSummaryDivider} />
              <View style={st.poolFormSummaryRow}>
                <Text style={st.poolFormSummaryLabel}>Tiers</Text>
                <Text style={st.poolFormSummaryValue}>{formPoolTiers.length}</Text>
              </View>
            </View>

            {formPoolTiers.map((tier, index) => {
              const tierCfg = POOL_TIER_TYPES.find(t => t.id === tier.type);
              return (
                <View key={`form-tier-${tier.id}-${index}`} style={[st.poolTierFormCard, { borderLeftColor: tierCfg?.color || '#666' }]}>
                  <View style={st.partnerFormHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 20 }}>{tierCfg?.icon || '\u2699\ufe0f'}</Text>
                      <Text style={[st.partnerFormTitle, { color: tierCfg?.color || Colors.primary }]}>Tier {index + 1}</Text>
                    </View>
                    {formPoolTiers.length > 1 && (
                      <TouchableOpacity onPress={() => removePoolTier(index)} activeOpacity={0.7}>
                        <Trash2 size={18} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {renderInput('Tier Label', tier.label, (v) => updatePoolTier(index, 'label', v), { placeholder: 'e.g. Tokenized Pool' })}

                  <Text style={st.inputLabel}>Investment Type</Text>
                  <View style={st.chipRow}>
                    {POOL_TIER_TYPES.map(pt => (
                      <TouchableOpacity
                        key={pt.id}
                        style={[st.chip, tier.type === pt.id && { borderColor: pt.color, backgroundColor: pt.color + '20' }]}
                        onPress={() => updatePoolTier(index, 'type', pt.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={[st.chipText, tier.type === pt.id && { color: pt.color }]}>{pt.icon} {pt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={st.rowInputs}>
                    <View style={{ flex: 1 }}>
                      {renderInput('Target Amount ($)', tier.targetAmount ? formatAmountInput(String(tier.targetAmount)) : '', (v) => updatePoolTier(index, 'targetAmount', parseFloat(parseAmountInput(v)) || 0), { keyboardType: 'numeric', placeholder: '400,000' })}
                    </View>
                    <View style={{ flex: 1 }}>
                      {renderInput('Min Investment ($)', tier.minInvestment ? formatAmountInput(String(tier.minInvestment)) : '', (v) => updatePoolTier(index, 'minInvestment', parseFloat(parseAmountInput(v)) || 0), { keyboardType: 'numeric', placeholder: '1,000' })}
                    </View>
                  </View>

                  {renderInput('Max Investors (optional)', String(tier.maxInvestors || ''), (v) => updatePoolTier(index, 'maxInvestors', v === '' ? 0 : (parseInt(v) || 0)), { keyboardType: 'numeric', placeholder: 'Leave empty for unlimited' })}
                </View>
              );
            })}

            <TouchableOpacity style={st.addPartnerBtn} onPress={addPoolTier} activeOpacity={0.7}>
              <Plus size={18} color={Colors.primary} />
              <Text style={st.addPartnerText}>Add Investment Tier</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('fees', 'Fees & Hold Period', <PieChart size={18} color="#E879F9" />)}
        {expandedSections.fees && (
          <View style={st.sectionContent}>
            <View style={st.rowInputs}>
              <View style={{ flex: 1 }}>
                {renderInput('Management Fee (%)', formManagementFee, setFormManagementFee, { keyboardType: 'numeric' })}
              </View>
              <View style={{ flex: 1 }}>
                {renderInput('Performance Fee (%)', formPerformanceFee, setFormPerformanceFee, { keyboardType: 'numeric' })}
              </View>
            </View>
            {renderInput('Minimum Hold (months)', formMinHold, setFormMinHold, { keyboardType: 'numeric' })}
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('legal', 'Legal Terms', <Gavel size={18} color="#FF6B6B" />)}
        {expandedSections.legal && (
          <View style={st.sectionContent}>
            {renderInput('Governing Law', formGoverningLaw, setFormGoverningLaw)}
            {renderInput('Dispute Resolution', formDisputeResolution, setFormDisputeResolution)}
            <View style={st.rowInputs}>
              <View style={{ flex: 1 }}>
                {renderInput('Confidentiality (months)', formConfidentiality, setFormConfidentiality, { keyboardType: 'numeric' })}
              </View>
              <View style={{ flex: 1 }}>
                {renderInput('Non-Compete (months)', formNonCompete, setFormNonCompete, { keyboardType: 'numeric' })}
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={st.formCard}>
        {renderSectionHeader('clauses', 'Included Clauses', <Shield size={18} color="#FFD700" />)}
        {expandedSections.clauses && (
          <View style={st.sectionContent}>
            {Object.entries(JV_CLAUSES).map(([key, clause]) => (
              <View key={key} style={st.clauseCard}>
                <View style={st.clauseHeader}>
                  <CheckCircle size={14} color="#00C48C" />
                  <Text style={st.clauseTitle}>{clause.title}</Text>
                </View>
                <Text style={st.clauseDesc}>{clause.description}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {isUploadingPhotos && (
        <View style={st.uploadProgressBar}>
          <ShimmerIndicator size="small" color={Colors.primary} />
          <Text style={st.uploadProgressText}>{uploadProgress || 'Uploading photos...'}</Text>
        </View>
      )}

      <TouchableOpacity
        style={st.publishBtn}
        onPress={handleCreateAndPublish}
        activeOpacity={0.85}
        testID="jv-publish"
        disabled={isPublishing || isSaving || isUploadingPhotos}
      >
        <Globe size={20} color="#fff" />
        <Text style={st.publishBtnText}>{isUploadingPhotos ? uploadProgress : isSaving ? 'Saving...' : isPublishing ? 'Publishing...' : editingAgreementId ? 'Update & Publish' : 'Save & Publish'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  const getBackHandler = () => {
    if (mode === 'detail' || mode === 'create' || mode === 'edit') {
      return () => { resetForm(); setMode('list'); };
    }
    return () => router.back();
  };

  const getHeaderTitle = () => {
    if (mode === 'create') return 'New JV Agreement';
    if (mode === 'edit') return 'Edit JV Agreement';
    if (mode === 'detail' && selectedAgreement) return selectedAgreement.title;
    return 'JV Agreements';
  };

  const renderFullscreenViewer = () => {
    if (!fullscreenPhoto) return null;
    const photos = safePhotos(selectedAgreement?.photos);
    const currentIdx = photos.indexOf(fullscreenPhoto);
    return (
      <Modal visible={!!fullscreenPhoto} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <View style={st.fullscreenOverlay}>
          <TouchableOpacity style={st.fullscreenClose} onPress={() => setFullscreenPhoto(null)} activeOpacity={0.7}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          <Image source={{ uri: fullscreenPhoto }} style={st.fullscreenImage} resizeMode="contain" />
          {currentIdx >= 0 && (
            <View style={st.fullscreenNav}>
              {currentIdx > 0 && (
                <TouchableOpacity style={st.fullscreenArrow} onPress={() => setFullscreenPhoto(photos[currentIdx - 1] ?? null)} activeOpacity={0.7}>
                  <ChevronLeft size={28} color="#fff" />
                </TouchableOpacity>
              )}
              <Text style={st.fullscreenCounter}>{currentIdx + 1} / {photos.length}</Text>
              {currentIdx < photos.length - 1 && (
                <TouchableOpacity style={st.fullscreenArrow} onPress={() => setFullscreenPhoto(photos[currentIdx + 1] ?? null)} activeOpacity={0.7}>
                  <ChevronRight size={28} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </Modal>
    );
  };

  return (
    <View style={st.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {renderFullscreenViewer()}
      <SafeAreaView edges={['top']} style={st.safeArea}>
        <View style={st.header}>
          <TouchableOpacity style={st.backBtn} onPress={getBackHandler()} activeOpacity={0.7}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.headerTitle} numberOfLines={1}>{getHeaderTitle()}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={st.scrollView}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={st.scrollContent}
          >
            {mode === 'list' && renderListMode()}
            {mode === 'detail' && renderDetailMode()}
            {(mode === 'create' || mode === 'edit') && renderCreateMode()}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: Colors.surface },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' as const },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 120 },

  heroCard: { marginTop: 20, backgroundColor: Colors.surface, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center' },
  heroIconRow: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'center' },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '900' as const, textAlign: 'center' as const, marginBottom: 8 },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' as const, lineHeight: 20 },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const, marginTop: 4 },

  filtersRow: { paddingVertical: 16, gap: 8 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary + '20', borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.primary },

  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, marginBottom: 20 },
  createBtnText: { color: '#000', fontSize: 15, fontWeight: '800' as const },

  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  emptySubtitle: { color: Colors.textTertiary, fontSize: 13 },

  agreementCard: { backgroundColor: Colors.surface, borderRadius: 18, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  igCard: { backgroundColor: Colors.surface, borderRadius: 18, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  igCardGalleryWrap: { position: 'relative' as const, height: 280, overflow: 'hidden' as const, backgroundColor: '#000' },
  igCardGalleryScroll: { height: 280 },
  igCardImage: { height: 280, backgroundColor: Colors.backgroundSecondary },
  igCardOverlayTop: { position: 'absolute' as const, top: 12, left: 12, right: 12, flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, zIndex: 2 },
  igCardPhotoCount: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  igCardPhotoCountText: { color: '#fff', fontSize: 10, fontWeight: '700' as const },
  igCardLiveBadge: { position: 'absolute' as const, top: 12, right: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: '#00C48C18', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#00C48C30', zIndex: 3 },
  igCardDots: { position: 'absolute' as const, bottom: 12, left: 0, right: 0, flexDirection: 'row' as const, justifyContent: 'center' as const, gap: 5, zIndex: 2 },
  igCardDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  igCardDotActive: { width: 18, backgroundColor: '#fff', borderRadius: 3 },
  igCardNoPhoto: { height: 160, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#0A0A0C', gap: 6, position: 'relative' as const },
  igCardNoPhotoText: { color: '#3A3A3A', fontSize: 12 },
  igCardBody: { padding: 16, gap: 12 },
  igCardHeaderRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  igCardTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, marginBottom: 2 },
  igCardProject: { color: Colors.textSecondary, fontSize: 13 },
  igCardTypeBadge: { backgroundColor: Colors.backgroundSecondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: Colors.surfaceBorder },
  igCardTypeText: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  igCardLocationRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  igCardLocation: { color: '#5A5A5A', fontSize: 12, flex: 1 },
  igCardMetrics: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14 },
  igCardMetric: { flex: 1, alignItems: 'center' as const, gap: 4 },
  igCardMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  igCardMetricLabel: { color: Colors.textTertiary, fontSize: 9, marginTop: 1 },
  igCardMetricDivider: { width: 1, height: 34, backgroundColor: Colors.surfaceBorder },
  igCardFooter: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  igCardAvatars: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  igCardActions: { flexDirection: 'row' as const, alignItems: 'center' as const },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  cardType: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' as const },
  cardTitle: { color: Colors.text, fontSize: 17, fontWeight: '800' as const, marginBottom: 4 },
  cardProject: { color: Colors.textSecondary, fontSize: 13, marginBottom: 8 },
  cardLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  cardLocation: { color: Colors.textTertiary, fontSize: 12, flex: 1 },
  cardMetricsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, marginBottom: 12 },
  cardMetric: { flex: 1, alignItems: 'center' },
  cardMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  cardMetricLabel: { color: Colors.textTertiary, fontSize: 10, marginTop: 3 },
  cardMetricDivider: { width: 1, height: 30, backgroundColor: Colors.surfaceBorder },
  cardPartnersRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  partnerAvatarSmall: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.surface },
  partnerAvatarText: { color: '#000', fontSize: 11, fontWeight: '800' as const },
  morePartners: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' as const, marginLeft: 4 },

  detailHero: { marginTop: 20, backgroundColor: Colors.surface, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: Colors.surfaceBorder },
  detailHeroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  detailType: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' as const },
  detailTitle: { color: Colors.text, fontSize: 22, fontWeight: '900' as const, marginBottom: 4 },
  detailProject: { color: Colors.textSecondary, fontSize: 14, marginBottom: 16 },
  detailMetrics: { flexDirection: 'row', gap: 12 },
  detailMetricItem: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  detailMetricValue: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  detailMetricLabel: { color: Colors.textTertiary, fontSize: 10 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionBtnText: { color: Colors.primary, fontSize: 12, fontWeight: '700' as const },
  detailInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  detailInfoText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  detailDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 16 },

  formCard: { marginTop: 14, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  sectionContent: { paddingHorizontal: 16, paddingBottom: 16 },

  inputGroup: { marginBottom: 14 },
  inputLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  input: { backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 14, borderWidth: 1, borderColor: Colors.inputBorder },
  inputMultiline: { minHeight: 100, paddingTop: 14 },
  rowInputs: { flexDirection: 'row', gap: 10 },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  typeCard: { width: '47%' as any, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: Colors.surfaceBorder, position: 'relative' },
  typeEmoji: { fontSize: 24, marginBottom: 8 },
  typeLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' as const, marginBottom: 4 },
  typeDesc: { color: Colors.textTertiary, fontSize: 10, lineHeight: 14 },
  typeCheck: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.backgroundSecondary, borderWidth: 1, borderColor: Colors.surfaceBorder },
  chipActive: { backgroundColor: Colors.primary + '20', borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  chipTextActive: { color: Colors.primary },

  partnerFormCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  partnerFormHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  partnerFormTitle: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  addPartnerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary + '40', borderStyle: 'dashed' as const },
  addPartnerText: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  equitySummary: { marginTop: 14, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, alignItems: 'center' },
  equitySummaryLabel: { color: Colors.textTertiary, fontSize: 12, marginBottom: 4 },
  equitySummaryValue: { fontSize: 28, fontWeight: '900' as const },
  equityWarning: { color: Colors.error, fontSize: 11, marginTop: 4 },

  partnerCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  partnerCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  partnerAvatar: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  partnerAvatarLetter: { color: '#000', fontSize: 18, fontWeight: '900' as const },
  partnerInfo: { flex: 1 },
  partnerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  partnerRoleBadge: { marginTop: 3 },
  partnerRoleText: { fontSize: 11, fontWeight: '700' as const },
  partnerMetrics: { flexDirection: 'row', gap: 8 },
  partnerMetricItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: 10, padding: 10 },
  partnerMetricLabel: { color: Colors.textTertiary, fontSize: 9, marginBottom: 3 },
  partnerMetricValue: { color: Colors.text, fontSize: 12, fontWeight: '700' as const },

  profitSplitCard: { marginTop: 12, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 16 },
  profitSplitTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, marginBottom: 12 },
  profitSplitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  profitSplitName: { color: Colors.textSecondary, fontSize: 12, width: 100 },
  profitBarWrap: { flex: 1, height: 8, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden' },
  profitBar: { height: 8, backgroundColor: Colors.primary, borderRadius: 4 },
  profitSplitPct: { color: Colors.primary, fontSize: 13, fontWeight: '800' as const, width: 40, textAlign: 'right' as const },

  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoItem: { width: '47%' as any, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12 },
  infoLabel: { color: Colors.textTertiary, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },

  clauseCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, marginBottom: 8 },
  clauseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  clauseTitle: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
  clauseDesc: { color: Colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: 4 },

  createHero: { marginTop: 20, alignItems: 'center', gap: 8, marginBottom: 8 },
  createHeroTitle: { color: Colors.text, fontSize: 22, fontWeight: '900' as const },
  createHeroSubtitle: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 20 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 18, marginTop: 20 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '800' as const },
  uploadProgressBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary + '15', borderRadius: 12, padding: 14, marginBottom: 12 },
  uploadProgressText: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#00C48C', borderRadius: 16, paddingVertical: 18, marginTop: 12, marginBottom: 40 },
  publishBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' as const },
  editDetailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 16, marginTop: 14 },
  editDetailBtnText: { color: '#000', fontSize: 15, fontWeight: '800' as const },
  publishDetailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#00C48C', borderRadius: 16, paddingVertical: 16, marginTop: 10 },
  publishDetailBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' as const },
  editCardBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 8 },

  cardPhotoStrip: { flexDirection: 'row', gap: 6, marginBottom: 12, alignItems: 'center' },
  cardPhotoThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: Colors.backgroundSecondary },
  cardPhotoMore: { width: 52, height: 52, borderRadius: 10, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  cardPhotoMoreText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' as const },

  galleryContainer: { marginTop: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, position: 'relative' as const },
  galleryScroll: { borderRadius: 16 },
  galleryImage: { height: 280, backgroundColor: Colors.backgroundSecondary },
  galleryDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  galleryDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.surfaceBorder },
  galleryDotActive: { backgroundColor: Colors.primary, width: 20 },
  galleryCounter: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  galleryCounterText: { color: '#fff', fontSize: 11, fontWeight: '700' as const },

  igGalleryContainer: { marginHorizontal: -20, marginTop: -16, marginBottom: 4, position: 'relative' as const, backgroundColor: '#000' },
  igGalleryScroll: {},
  igGalleryImage: { height: 380, backgroundColor: Colors.backgroundSecondary },
  igGalleryOverlay: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  igGalleryCounter: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  igGalleryCounterText: { color: '#fff', fontSize: 11, fontWeight: '700' as const },
  igGalleryDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: 'transparent', position: 'absolute', bottom: 0, left: 0, right: 0 },
  igGalleryDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  igGalleryDotActive: { backgroundColor: '#fff', width: 20 },
  detailHeroTopInline: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 },

  photoHint: { color: Colors.textTertiary, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  photoPreviewScroll: { marginBottom: 14 },
  photoPreviewItem: { width: 110, height: 110, borderRadius: 14, marginRight: 10, position: 'relative' as const },
  photoPreviewImage: { width: 110, height: 110, borderRadius: 14, backgroundColor: Colors.backgroundSecondary },
  photoRemoveBtn: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,60,60,0.9)', alignItems: 'center', justifyContent: 'center' },
  photoIndexBadge: { position: 'absolute', bottom: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  photoIndexText: { color: '#fff', fontSize: 10, fontWeight: '800' as const },
  photoUploadRow: { flexDirection: 'row', gap: 10 },
  photoUploadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.surfaceBorder, borderStyle: 'dashed' as const, backgroundColor: Colors.backgroundSecondary },
  photoUploadBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
  photoCount: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center' as const, marginTop: 10 },

  fullscreenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullscreenClose: { position: 'absolute', top: 60, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  fullscreenImage: { width: '100%' as any, height: '70%' as any },
  fullscreenNav: { flexDirection: 'row', alignItems: 'center', gap: 30, marginTop: 20 },
  fullscreenArrow: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  fullscreenCounter: { color: '#fff', fontSize: 15, fontWeight: '700' as const },

  poolTableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  poolTableHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  poolTotalBadge: { backgroundColor: '#FFD70012', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'flex-end' as const },
  poolTotalLabel: { color: Colors.textTertiary, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  poolTotalValue: { color: '#FFD700', fontSize: 16, fontWeight: '900' as const },
  poolTiersContainer: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  poolTierCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  poolTierHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  poolTierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  poolTierIcon: { fontSize: 24 },
  poolTierLabel: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  poolTierType: { fontSize: 11, fontWeight: '600' as const, marginTop: 2 },
  poolTierStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  poolTierStatusDot: { width: 6, height: 6, borderRadius: 3 },
  poolTierStatusText: { fontSize: 11, fontWeight: '700' as const },
  poolTierAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  poolTierTargetLabel: { color: Colors.textTertiary, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  poolTierTargetValue: { color: Colors.text, fontSize: 20, fontWeight: '900' as const },
  poolTierProgressWrap: { height: 8, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  poolTierProgressBar: { height: 8, borderRadius: 4 },
  poolTierProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  poolTierRaised: { color: Colors.textTertiary, fontSize: 11 },
  poolTierPct: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' as const },
  poolTierInfoGrid: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, padding: 10 },
  poolTierInfoItem: { flex: 1, alignItems: 'center' as const },
  poolTierInfoLabel: { color: Colors.textTertiary, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 3 },
  poolTierInfoValue: { color: Colors.text, fontSize: 13, fontWeight: '800' as const },
  poolTierInfoDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },
  poolFormSummary: { backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center' },
  poolFormSummaryRow: { flex: 1, alignItems: 'center' as const },
  poolFormSummaryLabel: { color: Colors.textTertiary, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 3 },
  poolFormSummaryValue: { color: '#FFD700', fontSize: 18, fontWeight: '900' as const },
  poolFormSummaryDivider: { width: 1, height: 32, backgroundColor: Colors.surfaceBorder },
  poolTierFormCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, borderLeftWidth: 3 }});

