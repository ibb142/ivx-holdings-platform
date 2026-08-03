import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  Platform,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Sparkles,
  Send,
  Mail,
  CheckCircle,
  Eye,
  MousePointer,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Building2,
  Users,
  Zap,
  Globe,
  Lock,
  Star,
  CircleDot,
  Clock,
  BarChart3,
  RefreshCw,
  Copy,
  Check} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Lender, LenderOutreach, OutreachType } from '@/types';
import { lenders, lenderOutreachHistory, outreachCampaigns, getLenderStats } from '@/mocks/lenders';
import { discoveredLenders } from '@/mocks/lender-discovery';
import { properties } from '@/mocks/properties';
import { formatCurrencyCompact } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const formatCurrency = (amount: number): string => formatCurrencyCompact(amount);

const OUTREACH_STATUS_COLORS: Record<string, string> = {
  draft: Colors.textTertiary,
  scheduled: Colors.warning,
  sent: Colors.accent,
  delivered: Colors.accent,
  opened: Colors.primary,
  clicked: '#E879F9',
  replied: Colors.success,
  bounced: Colors.error,
  failed: Colors.error};

type StepType = 'select_property' | 'select_lenders' | 'compose' | 'review' | 'sent';
type LenderFilter = 'all' | 'private' | 'public';

const AI_TEMPLATES: Record<OutreachType, { subject: string; body: string }> = {
  invitation: {
    subject: 'Exclusive Investment Opportunity: {{property_name}} - {{yield}}% Projected Yield',
    body: `Dear {{lender_contact}},

I hope this message finds you well. I'm reaching out from IVX HOLDINGS LLC regarding an exclusive tokenized real estate investment opportunity that aligns with {{lender_name}}'s investment criteria.

PROPERTY OVERVIEW
━━━━━━━━━━━━━━━━
{{property_name}}
📍 {{property_location}}, {{property_city}}, {{property_country}}
💰 Target Raise: {{target_raise}}
📊 Projected Yield: {{yield}}%
📈 Projected IRR: {{irr}}%
🏢 Type: {{property_type}}
⚡ Status: {{property_status}}

WHY THIS OPPORTUNITY
━━━━━━━━━━━━━━━━━━━
• First-lien secured tokenized mortgage
• 24/7 secondary market liquidity
• Institutional-grade due diligence completed
• Regulatory compliant structure
• Minimum investment: {{min_investment}}

IVX HOLDINGS's platform enables fractional ownership of premium real estate assets with full transparency and blockchain-verified ownership records.

I would welcome the opportunity to schedule a brief call to discuss how this investment fits within your portfolio strategy.

Best regards,
IVX HOLDINGS LLC
Investment Relations Team`},
  follow_up: {
    subject: 'Following Up: {{property_name}} Investment Opportunity',
    body: `Dear {{lender_contact}},

I wanted to follow up on the {{property_name}} investment opportunity I shared previously. The property is generating significant interest, and I wanted to ensure {{lender_name}} has the opportunity to participate before the offering closes.

Key highlights since our last communication:
• Funding progress: {{funding_percent}}% subscribed
• Strong investor demand with {{available_shares}} shares remaining
• Recent property appraisal confirms {{yield}}% yield projection

Would you have 15 minutes this week to discuss further?

Best regards,
IVX HOLDINGS LLC`},
  property_alert: {
    subject: '🔔 New Listing Alert: {{property_name}} Now Available',
    body: `Dear {{lender_contact}},

A new premium property has just been listed on IVX HOLDINGS that matches {{lender_name}}'s investment preferences.

{{property_name}} - {{property_city}}, {{property_country}}
• Yield: {{yield}}% | IRR: {{irr}}%
• Property Type: {{property_type}}
• Target Raise: {{target_raise}}

View the full investment memorandum on our platform to learn more.

Best regards,
IVX HOLDINGS LLC`},
  newsletter: {
    subject: 'IVX HOLDINGS Monthly Update - New Opportunities & Market Insights',
    body: `Dear {{lender_contact}},

Here's your monthly update from IVX HOLDINGS LLC with the latest investment opportunities and market insights...`},
  partnership: {
    subject: 'IVX HOLDINGS LLC - Strategic Partnership Opportunity',
    body: `Dear {{lender_contact}},

I would like to introduce IVX HOLDINGS's institutional partnership program designed for leading organizations like {{lender_name}}...`}};

export default function AIOutreachScreen() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepType>('select_property');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedLenderIds, setSelectedLenderIds] = useState<string[]>([]);
  const [outreachType, setOutreachType] = useState<OutreachType>('invitation');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [lenderFilter, setLenderFilter] = useState<LenderFilter>('all');


  const successAnim = useRef(new Animated.Value(0)).current;
  const stats = useMemo(() => getLenderStats(), []);



  const selectedProperty = useMemo(() => {
    return properties.find(p => p.id === selectedPropertyId);
  }, [selectedPropertyId]);

  const selectedLenders = useMemo(() => {
    return lenders.filter(l => selectedLenderIds.includes(l.id));
  }, [selectedLenderIds]);

  const liveProperties = useMemo(() => {
    return properties.filter(p => p.status === 'live' || p.status === 'coming_soon');
  }, []);

  const privateLenders = useMemo(() => lenders.filter(l => l.type === 'private'), []);
  const publicLenders = useMemo(() => lenders.filter(l => l.type === 'public'), []);
  const filteredLendersForSelection = useMemo(() => {
    if (lenderFilter === 'private') return privateLenders;
    if (lenderFilter === 'public') return publicLenders;
    return lenders;
  }, [lenderFilter, privateLenders, publicLenders]);

  const toggleLender = useCallback((id: string) => {
    setSelectedLenderIds(prev =>
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  }, []);

  const selectAllLenders = useCallback(() => {
    const currentList = lenderFilter === 'private' ? privateLenders :
      lenderFilter === 'public' ? publicLenders : lenders;
    const allIds = currentList.map(l => l.id);
    const allSelected = allIds.every(id => selectedLenderIds.includes(id));
    if (allSelected) {
      setSelectedLenderIds(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedLenderIds(prev => [...new Set([...prev, ...allIds])]);
    }
  }, [selectedLenderIds, lenderFilter, privateLenders, publicLenders]);

  const selectAllPrivateLenders = useCallback(() => {
    const privateIds = privateLenders.map(l => l.id);
    setSelectedLenderIds(prev => [...new Set([...prev, ...privateIds])]);
    setLenderFilter('private');
  }, [privateLenders]);

  const generateAIEmail = useCallback(() => {
    if (!selectedProperty) return;
    setIsGenerating(true);

    const template = AI_TEMPLATES[outreachType];
    const fundingPercent = Math.round((selectedProperty.currentRaise / selectedProperty.targetRaise) * 100);

    const subject = template.subject
      .replace('{{property_name}}', selectedProperty.name)
      .replace('{{yield}}', selectedProperty.yield.toString())
      .replace('{{irr}}', selectedProperty.irr.toString());

    const body = template.body
      .replace(/\{\{property_name\}\}/g, selectedProperty.name)
      .replace('{{property_location}}', selectedProperty.location)
      .replace('{{property_city}}', selectedProperty.city)
      .replace('{{property_country}}', selectedProperty.country)
      .replace('{{target_raise}}', formatCurrency(selectedProperty.targetRaise))
      .replace(/\{\{yield\}\}/g, selectedProperty.yield.toString())
      .replace(/\{\{irr\}\}/g, selectedProperty.irr.toString())
      .replace('{{property_type}}', selectedProperty.propertyType)
      .replace('{{property_status}}', selectedProperty.status)
      .replace('{{min_investment}}', `$${selectedProperty.minInvestment}`)
      .replace('{{funding_percent}}', fundingPercent.toString())
      .replace('{{available_shares}}', selectedProperty.availableShares.toLocaleString())
      .replace(/\{\{lender_contact\}\}/g, '[Lender Contact]')
      .replace(/\{\{lender_name\}\}/g, '[Lender Name]');

    setTimeout(() => {
      setEmailSubject(subject);
      setEmailBody(body);
      setIsGenerating(false);
      setCurrentStep('compose');
    }, 1500);
  }, [selectedProperty, outreachType]);

  const handleSendEmails = useCallback(() => {
    Alert.alert(
      'Send Outreach Emails',
      `Send personalized emails to ${selectedLenders.length} lender${selectedLenders.length !== 1 ? 's' : ''} about ${selectedProperty?.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            setIsSending(true);
            setTimeout(() => {
              setIsSending(false);
              setSentSuccess(true);
              setCurrentStep('sent');
              Animated.spring(successAnim, {
                toValue: 1,
                useNativeDriver: true,
                friction: 4}).start();
            }, 2000);
          }},
      ]
    );
  }, [selectedLenders, selectedProperty, successAnim]);

  const resetFlow = useCallback(() => {
    setCurrentStep('select_property');
    setSelectedPropertyId(null);
    setSelectedLenderIds([]);
    setEmailSubject('');
    setEmailBody('');
    setSentSuccess(false);
    successAnim.setValue(0);
  }, [successAnim]);

  const renderStepIndicator = () => {
    const steps: { key: StepType; label: string }[] = [
      { key: 'select_property', label: 'Property' },
      { key: 'select_lenders', label: 'Lenders' },
      { key: 'compose', label: 'Compose' },
      { key: 'review', label: 'Review' },
    ];
    const currentIndex = steps.findIndex(s => s.key === currentStep);

    return (
      <View style={styles.stepIndicator}>
        {steps.map((step, index) => (
          <View key={step.key} style={styles.stepItem}>
            <View style={[
              styles.stepDot,
              index <= currentIndex && styles.stepDotActive,
              currentStep === 'sent' && styles.stepDotActive,
            ]}>
              {index < currentIndex || currentStep === 'sent' ? (
                <Check size={12} color={Colors.background} />
              ) : (
                <Text style={[styles.stepNumber, index <= currentIndex && styles.stepNumberActive]}>
                  {index + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, index <= currentIndex && styles.stepLabelActive]}>
              {step.label}
            </Text>
            {index < steps.length - 1 && (
              <View style={[styles.stepLine, index < currentIndex && styles.stepLineActive]} />
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderPropertySelection = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Select Property</Text>
      <Text style={styles.sectionSubtitle}>Choose a property to promote to lenders</Text>

      <View style={styles.outreachTypeRow}>
        {(['invitation', 'follow_up', 'property_alert'] as OutreachType[]).map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.outreachTypeChip, outreachType === type && styles.outreachTypeChipActive]}
            onPress={() => setOutreachType(type)}
          >
            {type === 'invitation' && <Mail size={14} color={outreachType === type ? Colors.background : Colors.textSecondary} />}
            {type === 'follow_up' && <RefreshCw size={14} color={outreachType === type ? Colors.background : Colors.textSecondary} />}
            {type === 'property_alert' && <Zap size={14} color={outreachType === type ? Colors.background : Colors.textSecondary} />}
            <Text style={[styles.outreachTypeText, outreachType === type && styles.outreachTypeTextActive]}>
              {type === 'invitation' ? 'Invitation' : type === 'follow_up' ? 'Follow Up' : 'Alert'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {liveProperties.map((property) => (
        <TouchableOpacity
          key={property.id}
          style={[styles.propertyOption, selectedPropertyId === property.id && styles.propertyOptionSelected]}
          onPress={() => setSelectedPropertyId(property.id)}
        >
          <View style={styles.propertyOptionHeader}>
            <View style={styles.propertyRadio}>
              {selectedPropertyId === property.id && <View style={styles.propertyRadioInner} />}
            </View>
            <View style={styles.propertyOptionInfo}>
              <Text style={styles.propertyOptionName}>{property.name}</Text>
              <Text style={styles.propertyOptionLocation}>{property.city}, {property.country}</Text>
            </View>
            <View style={[styles.propertyStatusBadge, {
              backgroundColor: property.status === 'live' ? 'rgba(0,196,140,0.15)' : 'rgba(255,184,0,0.15)'
            }]}>
              <Text style={[styles.propertyStatusText, {
                color: property.status === 'live' ? Colors.success : Colors.warning
              }]}>
                {property.status === 'live' ? 'Live' : 'Coming Soon'}
              </Text>
            </View>
          </View>
          <View style={styles.propertyOptionMetrics}>
            <Text style={styles.propertyMetric}>Yield: <Text style={styles.propertyMetricValue}>{property.yield}%</Text></Text>
            <Text style={styles.propertyMetric}>IRR: <Text style={styles.propertyMetricValue}>{property.irr}%</Text></Text>
            <Text style={styles.propertyMetric}>Target: <Text style={styles.propertyMetricValue}>{formatCurrency(property.targetRaise)}</Text></Text>
          </View>
          <View style={styles.propertyProgressBar}>
            <View style={[styles.propertyProgressFill, { width: `${Math.min(100, (property.currentRaise / property.targetRaise) * 100)}%` }]} />
          </View>
          <Text style={styles.propertyProgressText}>
            {Math.round((property.currentRaise / property.targetRaise) * 100)}% funded
          </Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={[styles.nextButton, !selectedPropertyId && styles.nextButtonDisabled]}
        disabled={!selectedPropertyId}
        onPress={() => setCurrentStep('select_lenders')}
      >
        <Text style={[styles.nextButtonText, !selectedPropertyId && styles.nextButtonTextDisabled]}>
          Continue to Select Lenders
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderLenderSelection = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Select Lenders</Text>
          <Text style={styles.sectionSubtitle}>
            {selectedLenderIds.length} of {lenders.length} selected
          </Text>
        </View>
        <TouchableOpacity style={styles.selectAllBtn} onPress={selectAllLenders}>
          <Text style={styles.selectAllText}>
            {filteredLendersForSelection.every(l => selectedLenderIds.includes(l.id)) ? 'Deselect All' : 'Select All'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.quickActionBanner}
        onPress={selectAllPrivateLenders}
      >
        <View style={styles.quickActionLeft}>
          <View style={styles.quickActionIcon}>
            <Lock size={16} color="#E879F9" />
          </View>
          <View>
            <Text style={styles.quickActionTitle}>All Private Lenders ({privateLenders.length})</Text>
            <Text style={styles.quickActionSubtitle}>Select all private lenders for outreach</Text>
          </View>
        </View>
        <Text style={styles.quickActionCta}>Select</Text>
      </TouchableOpacity>

      <View style={styles.lenderFilterRow}>
        {(['all', 'private', 'public'] as LenderFilter[]).map((filter) => (
          <TouchableOpacity
            key={filter}
            style={[styles.lenderFilterChip, lenderFilter === filter && styles.lenderFilterChipActive]}
            onPress={() => setLenderFilter(filter)}
          >
            {filter === 'private' && <Lock size={12} color={lenderFilter === filter ? Colors.background : Colors.textSecondary} />}
            {filter === 'public' && <Globe size={12} color={lenderFilter === filter ? Colors.background : Colors.textSecondary} />}
            <Text style={[styles.lenderFilterText, lenderFilter === filter && styles.lenderFilterTextActive]}>
              {filter === 'all' ? `All (${lenders.length})` : filter === 'private' ? `Private (${privateLenders.length})` : `Public (${publicLenders.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredLendersForSelection.map((lender) => (
        <TouchableOpacity
          key={lender.id}
          style={[styles.lenderOption, selectedLenderIds.includes(lender.id) && styles.lenderOptionSelected]}
          onPress={() => toggleLender(lender.id)}
        >
          <View style={[styles.lenderCheckbox, selectedLenderIds.includes(lender.id) && styles.lenderCheckboxActive]}>
            {selectedLenderIds.includes(lender.id) && <Check size={14} color={Colors.background} />}
          </View>
          <View style={styles.lenderOptionInfo}>
            <View style={styles.lenderOptionRow}>
              <Text style={styles.lenderOptionName} numberOfLines={1}>{lender.name}</Text>
              {lender.type === 'public' ? (
                <Globe size={12} color={Colors.accent} />
              ) : (
                <Lock size={12} color="#E879F9" />
              )}
            </View>
            <Text style={styles.lenderOptionContact}>{lender.contactName} · {lender.email}</Text>
            <View style={styles.lenderOptionTags}>
              <Text style={styles.lenderOptionTag}>AUM: {formatCurrency(lender.aum)}</Text>
              <Text style={styles.lenderOptionTag}>{lender.category.replace('_', ' ')}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep('select_property')}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextButton, styles.nextButtonFlex, selectedLenderIds.length === 0 && styles.nextButtonDisabled]}
          disabled={selectedLenderIds.length === 0}
          onPress={generateAIEmail}
        >
          {isGenerating ? (
            <ShimmerIndicator color={Colors.background} size="small" />
          ) : (
            <>
              <Sparkles size={18} color={selectedLenderIds.length === 0 ? Colors.textTertiary : Colors.background} />
              <Text style={[styles.nextButtonText, selectedLenderIds.length === 0 && styles.nextButtonTextDisabled]}>
                Generate AI Email
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderCompose = () => (
    <View style={styles.section}>
      <View style={styles.composeBadge}>
        <Sparkles size={14} color={Colors.primary} />
        <Text style={styles.composeBadgeText}>AI Generated · Personalized per lender</Text>
      </View>

      <Text style={styles.composeLabel}>Subject</Text>
      <TextInput
        style={styles.composeSubjectInput}
        value={emailSubject}
        onChangeText={setEmailSubject}
        placeholderTextColor={Colors.inputPlaceholder}
        placeholder="Email subject..."
      />

      <Text style={styles.composeLabel}>Email Body</Text>
      <TextInput
        style={styles.composeBodyInput}
        value={emailBody}
        onChangeText={setEmailBody}
        placeholderTextColor={Colors.inputPlaceholder}
        placeholder="Email body..."
        multiline
        textAlignVertical="top"
      />

      <View style={styles.composeNote}>
        <Text style={styles.composeNoteText}>
          Variables like [Lender Contact] and [Lender Name] will be automatically personalized for each recipient.
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep('select_lenders')}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextButton, styles.nextButtonFlex]}
          onPress={() => setCurrentStep('review')}
        >
          <Eye size={18} color={Colors.background} />
          <Text style={styles.nextButtonText}>Preview & Review</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderReview = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Review & Send</Text>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Property</Text>
        <Text style={styles.reviewValue}>{selectedProperty?.name}</Text>
        <Text style={styles.reviewSubValue}>{selectedProperty?.city}, {selectedProperty?.country}</Text>
      </View>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Recipients ({selectedLenders.length})</Text>
        {selectedLenders.slice(0, 5).map((lender) => (
          <View key={lender.id} style={styles.reviewRecipient}>
            <View style={styles.reviewRecipientDot} />
            <Text style={styles.reviewRecipientName}>{lender.name}</Text>
            <Text style={styles.reviewRecipientEmail}>{lender.email}</Text>
          </View>
        ))}
        {selectedLenders.length > 5 && (
          <Text style={styles.reviewMore}>+{selectedLenders.length - 5} more lenders</Text>
        )}
      </View>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Email Preview</Text>
        <Text style={styles.reviewSubject}>{emailSubject}</Text>
        <View style={styles.reviewBodyPreview}>
          <Text style={styles.reviewBodyText} numberOfLines={8}>{emailBody}</Text>
        </View>
      </View>

      <View style={styles.reviewSummary}>
        <View style={styles.reviewSummaryItem}>
          <Mail size={16} color={Colors.accent} />
          <Text style={styles.reviewSummaryText}>{selectedLenders.length} personalized emails</Text>
        </View>
        <View style={styles.reviewSummaryItem}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.reviewSummaryText}>AI-generated content</Text>
        </View>
        <View style={styles.reviewSummaryItem}>
          <Building2 size={16} color={Colors.success} />
          <Text style={styles.reviewSummaryText}>{selectedProperty?.name}</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep('compose')}>
          <Text style={styles.backButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendButton, styles.nextButtonFlex]}
          onPress={handleSendEmails}
          disabled={isSending}
        >
          {isSending ? (
            <ShimmerIndicator color={Colors.background} size="small" />
          ) : (
            <>
              <Send size={18} color={Colors.background} />
              <Text style={styles.sendButtonText}>Send to {selectedLenders.length} Lenders</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSentSuccess = () => (
    <View style={styles.successContainer}>
      <Animated.View style={[styles.successIcon, { transform: [{ scale: successAnim }] }]}>
        <CheckCircle size={64} color={Colors.success} />
      </Animated.View>
      <Text style={styles.successTitle}>Emails Sent!</Text>
      <Text style={styles.successText}>
        {selectedLenders.length} personalized invitation{selectedLenders.length !== 1 ? 's' : ''} sent for {selectedProperty?.name}
      </Text>

      <View style={styles.successStats}>
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>{selectedLenders.length}</Text>
          <Text style={styles.successStatLabel}>Sent</Text>
        </View>
        <View style={styles.successStatDivider} />
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>{selectedLenders.filter(l => l.type === 'public').length}</Text>
          <Text style={styles.successStatLabel}>Public</Text>
        </View>
        <View style={styles.successStatDivider} />
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>{selectedLenders.filter(l => l.type === 'private').length}</Text>
          <Text style={styles.successStatLabel}>Private</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.newCampaignBtn} onPress={resetFlow}>
        <RefreshCw size={18} color={Colors.background} />
        <Text style={styles.newCampaignBtnText}>New Campaign</Text>
      </TouchableOpacity>
    </View>
  );

  const renderOutreachHistory = () => (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.historyToggle}
        onPress={() => setShowHistory(!showHistory)}
      >
        <View style={styles.historyToggleLeft}>
          <Clock size={18} color={Colors.primary} />
          <Text style={styles.historyToggleText}>Outreach History</Text>
        </View>
        {showHistory ? <ChevronUp size={18} color={Colors.textSecondary} /> : <ChevronDown size={18} color={Colors.textSecondary} />}
      </TouchableOpacity>

      {showHistory && (
        <View style={styles.historyContent}>
          <View style={styles.historyStats}>
            <View style={styles.historyStatItem}>
              <Send size={14} color={Colors.accent} />
              <Text style={styles.historyStatValue}>{stats.outreachSent}</Text>
              <Text style={styles.historyStatLabel}>Sent</Text>
            </View>
            <View style={styles.historyStatItem}>
              <Eye size={14} color={Colors.primary} />
              <Text style={styles.historyStatValue}>{Math.round(stats.outreachOpenRate)}%</Text>
              <Text style={styles.historyStatLabel}>Open Rate</Text>
            </View>
            <View style={styles.historyStatItem}>
              <MessageSquare size={14} color={Colors.success} />
              <Text style={styles.historyStatValue}>{Math.round(stats.outreachReplyRate)}%</Text>
              <Text style={styles.historyStatLabel}>Reply Rate</Text>
            </View>
          </View>

          {outreachCampaigns.map((campaign) => (
            <TouchableOpacity
              key={campaign.id}
              style={styles.campaignCard}
              onPress={() => setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)}
            >
              <View style={styles.campaignHeader}>
                <View style={styles.campaignHeaderLeft}>
                  <Text style={styles.campaignName} numberOfLines={1}>{campaign.name}</Text>
                  <Text style={styles.campaignProperty}>{campaign.propertyName}</Text>
                </View>
                <View style={[styles.campaignStatusBadge, {
                  backgroundColor: campaign.status === 'completed' ? 'rgba(0,196,140,0.15)' : 'rgba(255,184,0,0.15)'
                }]}>
                  <Text style={[styles.campaignStatusText, {
                    color: campaign.status === 'completed' ? Colors.success : Colors.warning
                  }]}>
                    {campaign.status}
                  </Text>
                </View>
              </View>

              <View style={styles.campaignMetrics}>
                <View style={styles.campaignMetric}>
                  <Send size={12} color={Colors.accent} />
                  <Text style={styles.campaignMetricText}>{campaign.sentCount} sent</Text>
                </View>
                <View style={styles.campaignMetric}>
                  <Eye size={12} color={Colors.primary} />
                  <Text style={styles.campaignMetricText}>{campaign.openedCount} opened</Text>
                </View>
                <View style={styles.campaignMetric}>
                  <MousePointer size={12} color="#E879F9" />
                  <Text style={styles.campaignMetricText}>{campaign.clickedCount} clicked</Text>
                </View>
                <View style={styles.campaignMetric}>
                  <MessageSquare size={12} color={Colors.success} />
                  <Text style={styles.campaignMetricText}>{campaign.repliedCount} replied</Text>
                </View>
              </View>

              {expandedCampaign === campaign.id && (
                <View style={styles.campaignDetails}>
                  <Text style={styles.campaignSubjectLabel}>Subject:</Text>
                  <Text style={styles.campaignSubject}>{campaign.subject}</Text>
                  <Text style={styles.campaignDate}>
                    Sent: {new Date(campaign.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}

          <Text style={styles.recentOutreachTitle}>Recent Emails</Text>
          {lenderOutreachHistory.map((outreach) => (
            <View key={outreach.id} style={styles.outreachItem}>
              <View style={[styles.outreachStatusDot, { backgroundColor: OUTREACH_STATUS_COLORS[outreach.status] }]} />
              <View style={styles.outreachItemInfo}>
                <Text style={styles.outreachItemName} numberOfLines={1}>{outreach.lenderName}</Text>
                <Text style={styles.outreachItemSubject} numberOfLines={1}>{outreach.subject}</Text>
                <Text style={styles.outreachItemDate}>
                  {outreach.status} · {outreach.sentAt ? new Date(outreach.sentAt).toLocaleDateString() : 'draft'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>AI Outreach</Text>
          <View style={styles.aiBadge}>
            <Sparkles size={10} color={Colors.primary} />
            <Text style={styles.aiBadgeText}>AI Powered</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.headerHistoryBtn} onPress={() => setShowHistory(!showHistory)}>
          <BarChart3 size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>

        {currentStep !== 'sent' && renderStepIndicator()}

        {currentStep === 'select_property' && renderPropertySelection()}
        {currentStep === 'select_lenders' && renderLenderSelection()}
        {currentStep === 'compose' && renderCompose()}
        {currentStep === 'review' && renderReview()}
        {currentStep === 'sent' && renderSentSuccess()}

        {renderOutreachHistory()}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  aiBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  aiBadgeText: { fontSize: 11, fontWeight: '700' as const },
  headerHistoryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  stepIndicator: { width: 4, borderRadius: 2 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepDotActive: { backgroundColor: Colors.primary },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFD700', alignItems: 'center', justifyContent: 'center' },
  stepNumberActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  stepLabel: { color: Colors.textSecondary, fontSize: 13 },
  stepLabelActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  stepLine: { gap: 4 },
  stepLineActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionSubtitle: { color: Colors.textTertiary, fontSize: 13, marginTop: 4 },
  outreachTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outreachTypeChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  outreachTypeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  outreachTypeText: { color: Colors.textSecondary, fontSize: 13 },
  outreachTypeTextActive: { color: '#000' },
  propertyOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  propertyOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  propertyOptionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  propertyRadio: { gap: 4 },
  propertyRadioInner: { gap: 4 },
  propertyOptionInfo: { flex: 1 },
  propertyOptionName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  propertyOptionLocation: { gap: 4 },
  propertyStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  propertyStatusText: { color: Colors.textSecondary, fontSize: 13 },
  propertyOptionMetrics: { gap: 4 },
  propertyMetric: { gap: 4 },
  propertyMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  propertyProgressBar: { gap: 4 },
  propertyProgressFill: { gap: 4 },
  propertyProgressText: { color: Colors.textSecondary, fontSize: 13 },
  nextButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  nextButtonFlex: { gap: 4 },
  nextButtonDisabled: { opacity: 0.4 },
  nextButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  nextButtonTextDisabled: { opacity: 0.4 },
  selectAllBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  selectAllText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  lenderOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  lenderOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  lenderCheckbox: { gap: 4 },
  lenderCheckboxActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  quickActionBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  quickActionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  quickActionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  quickActionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  quickActionSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  quickActionCta: { gap: 4 },
  lenderFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lenderFilterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  lenderFilterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  lenderFilterText: { color: Colors.textSecondary, fontSize: 13 },
  lenderFilterTextActive: { color: '#000' },
  lenderOptionInfo: { flex: 1 },
  lenderOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lenderOptionName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  lenderOptionContact: { gap: 4 },
  lenderOptionTags: { gap: 4 },
  lenderOptionTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backButton: { padding: 8 },
  backButtonText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  composeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  composeBadgeText: { fontSize: 11, fontWeight: '700' as const },
  composeLabel: { color: Colors.textSecondary, fontSize: 13 },
  composeSubjectInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  composeBodyInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  composeNote: { gap: 4 },
  composeNoteText: { color: Colors.textSecondary, fontSize: 13 },
  reviewCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  reviewLabel: { color: Colors.textSecondary, fontSize: 13 },
  reviewValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  reviewSubValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  reviewRecipient: { gap: 8 },
  reviewRecipientDot: { width: 8, height: 8, borderRadius: 4 },
  reviewRecipientName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  reviewRecipientEmail: { color: Colors.textSecondary, fontSize: 13 },
  reviewMore: { gap: 8 },
  reviewSubject: { gap: 8 },
  reviewBodyPreview: { gap: 8 },
  reviewBodyText: { color: Colors.textSecondary, fontSize: 13 },
  reviewSummary: { gap: 8 },
  reviewSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  reviewSummaryText: { color: Colors.textSecondary, fontSize: 13 },
  sendButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sendButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  successContainer: { gap: 8 },
  successIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  successText: { color: Colors.textSecondary, fontSize: 13 },
  successStats: { gap: 4 },
  successStat: { gap: 4 },
  successStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  successStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  successStatDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  newCampaignBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  newCampaignBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  historyToggle: { gap: 4 },
  historyToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  historyToggleText: { color: Colors.textSecondary, fontSize: 13 },
  historyContent: { flex: 1, gap: 4 },
  historyStats: { gap: 4 },
  historyStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  historyStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  historyStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  campaignHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  campaignName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  campaignProperty: { gap: 4 },
  campaignStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  campaignStatusText: { color: Colors.textSecondary, fontSize: 13 },
  campaignMetrics: { gap: 4 },
  campaignMetric: { gap: 4 },
  campaignMetricText: { color: Colors.textSecondary, fontSize: 13 },
  campaignDetails: { gap: 4 },
  campaignSubjectLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignSubject: { gap: 4 },
  campaignDate: { color: Colors.textTertiary, fontSize: 12 },
  recentOutreachTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  outreachItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  outreachStatusDot: { width: 8, height: 8, borderRadius: 4 },
  outreachItemInfo: { flex: 1 },
  outreachItemName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  outreachItemSubject: { gap: 4 },
  outreachItemDate: { color: Colors.textTertiary, fontSize: 12 }});
