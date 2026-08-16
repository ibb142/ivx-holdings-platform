/**
 * IVX Analytics Brain Service
 *
 * Per-member behavioral intelligence engine. NOT aggregate traffic metrics.
 * Studies each member's behavior, scores intent, detects scams, recommends
 * conversion actions, and tracks retention cohorts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BehaviorEvent {
  user_id?: string;
  anonymous_id?: string;
  session_id: string;
  event_type: 'screen_view' | 'click' | 'action' | 'search' | 'dwell' | 'scroll' | 'transaction' | 'conversion';
  event_category: 'navigation' | 'engagement' | 'transaction' | 'search' | 'investment';
  screen_name?: string;
  action_name?: string;
  target_component?: string;
  target_label?: string;
  properties?: Record<string, unknown>;
  dwell_time_seconds?: number;
  scroll_depth_pct?: number;
  interest_tags?: string[];
}

export interface MemberProfile {
  user_id?: string;
  anonymous_id?: string;
  email?: string;
  total_sessions: number;
  total_screen_views: number;
  total_actions: number;
  total_time_spent_seconds: number;
  interest_jv_deals: number;
  interest_tokenized_assets: number;
  interest_portfolio: number;
  interest_marketplace: number;
  interest_investing: number;
  interest_chat_ai: number;
  interest_crm: number;
  intent_score: number;
  intent_signals: IntentSignal[];
  funnel_stage: string;
  top_screens: ScreenStat[];
  top_actions: ActionStat[];
  preferred_categories: CategoryScore[];
  brain_analysis: Record<string, unknown>;
  brain_recommendations: Recommendation[];
  brain_risk_flags: RiskFlag[];
}

export interface IntentSignal {
  signal: string;
  weight: number;
  timestamp: string;
}

export interface ScreenStat {
  screen: string;
  views: number;
  pct: number;
}

export interface ActionStat {
  action: string;
  count: number;
  pct: number;
}

export interface CategoryScore {
  category: string;
  score: number;
}

export interface Recommendation {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  expected_impact: string;
  channel: 'push' | 'email' | 'in_app' | 'sms' | 'call';
}

export interface RiskFlag {
  type: 'churn_risk' | 'scam_interest' | 'low_engagement' | 'stalled_funnel' | 'inactivity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface ScamAnalysisInput {
  asset_id: string;
  asset_type: 'jv_deal' | 'tokenized_asset' | 'property' | 'security';
  asset_name?: string;
  asset_data: {
    title_chain?: string;
    ownership_docs?: string;
    financials?: string;
    legal_disclosures?: string;
    sec_registration?: string;
    third_party_audit?: string;
    description?: string;
    promoter_info?: string;
    expected_returns?: string;
    lockup_period?: string;
    minimum_investment?: string;
    tokenization_platform?: string;
    contract_address?: string;
  };
}

export interface ScamAnalysisResult {
  asset_id: string;
  scam_score: number;
  confidence_level: 'low' | 'medium' | 'high';
  red_flags: RedFlag[];
  green_flags: GreenFlag[];
  brain_verdict: 'legitimate' | 'suspicious' | 'likely_scam' | 'unverified';
  brain_analysis: Record<string, unknown>;
  brain_recommendations: Recommendation[];
}

export interface RedFlag {
  flag: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface GreenFlag {
  flag: string;
  description: string;
}

export interface RetentionCohort {
  cohort_date: string;
  cohort_size: number;
  period_type: 'daily' | 'weekly' | 'monthly';
  retention_data: { period: number; retained_count: number; retention_pct: number }[];
  converted_count: number;
  conversion_rate: number;
  brain_insights: Record<string, unknown>;
}

// ── Supabase Client ────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.IVX_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('Supabase not configured for analytics brain');
  }
  _client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _client;
}

// ── Interest Category Mapping ─────────────────────────────────────────────

const INTEREST_MAP: Record<string, keyof MemberProfile> = {
  jv_deals: 'interest_jv_deals',
  jv: 'interest_jv_deals',
  joint_venture: 'interest_jv_deals',
  tokenized: 'interest_tokenized_assets',
  tokenized_assets: 'interest_tokenized_assets',
  token: 'interest_tokenized_assets',
  blockchain: 'interest_tokenized_assets',
  portfolio: 'interest_portfolio',
  holdings: 'interest_portfolio',
  market: 'interest_marketplace',
  marketplace: 'interest_marketplace',
  invest: 'interest_investing',
  investing: 'interest_investing',
  investment: 'interest_investing',
  chat: 'interest_chat_ai',
  ai: 'interest_chat_ai',
  aura: 'interest_chat_ai',
  crm: 'interest_crm',
  contacts: 'interest_crm',
};

const INTENT_BOOSTS: Record<string, number> = {
  click: 2,
  dwell: 1,
  scroll: 1,
  search: 5,
  action: 3,
  transaction: 15,
  conversion: 25,
};

// ── Core: Ingest Behavior Event ────────────────────────────────────────────

export async function ingestBehaviorEvent(event: BehaviorEvent): Promise<{ ok: boolean; intent_delta: number }> {
  const sb = getSupabase();
  const now = new Date().toISOString();

  // Calculate intent delta from event
  let intent_delta = INTENT_BOOSTS[event.event_type] ?? 0;
  if (event.interest_tags) {
    for (const tag of event.interest_tags) {
      const mapped = INTEREST_MAP[tag.toLowerCase()];
      if (mapped && mapped.startsWith('interest_')) {
        intent_delta += 1;
      }
    }
  }
  // Boost for investment-related screens
  const screenLower = (event.screen_name || '').toLowerCase();
  if (screenLower.includes('invest') || screenLower.includes('deal') || screenLower.includes('portfolio')) {
    intent_delta += 3;
  }
  if (screenLower.includes('token') || screenLower.includes('blockchain')) {
    intent_delta += 2;
  }

  // Insert event
  const { error: eventErr } = await sb.from('member_behavior_events').insert({
    user_id: event.user_id || null,
    anonymous_id: event.anonymous_id || null,
    session_id: event.session_id,
    event_type: event.event_type,
    event_category: event.event_category,
    screen_name: event.screen_name || null,
    action_name: event.action_name || null,
    target_component: event.target_component || null,
    target_label: event.target_label || null,
    properties: event.properties || {},
    dwell_time_seconds: event.dwell_time_seconds || null,
    scroll_depth_pct: event.scroll_depth_pct || null,
    interest_tags: event.interest_tags || [],
    intent_delta: Math.max(0, intent_delta),
    timestamp: now,
  });

  if (eventErr) {
    console.error('[analytics-brain] Failed to insert event:', eventErr.message);
    return { ok: false, intent_delta: 0 };
  }

  // Update member profile
  await upsertMemberProfile(event, intent_delta, now);

  return { ok: true, intent_delta };
}

async function upsertMemberProfile(event: BehaviorEvent, intent_delta: number, now: string): Promise<void> {
  const sb = getSupabase();
  if (!event.user_id && !event.anonymous_id) return;
  const identifier: Record<string, string> = event.user_id
    ? { user_id: event.user_id }
    : { anonymous_id: event.anonymous_id! };

  // Try to fetch existing profile
  const { data: existing } = await sb
    .from('member_behavior_profiles')
    .select('*')
    .match(identifier)
    .maybeSingle();

  const isScreenView = event.event_type === 'screen_view';
  const isAction = event.event_type === 'click' || event.event_type === 'action' || event.event_type === 'transaction';

  if (existing) {
    // Update existing profile
    const updates: Record<string, unknown> = {
      last_seen: now,
      last_active_date: now.split('T')[0],
      total_screen_views: (existing.total_screen_views || 0) + (isScreenView ? 1 : 0),
      total_actions: (existing.total_actions || 0) + (isAction ? 1 : 0),
      total_time_spent_seconds: (existing.total_time_spent_seconds || 0) + (event.dwell_time_seconds || 0),
      intent_score: Math.min(100, (existing.intent_score || 0) + intent_delta),
      returning_visitor: true,
      updated_at: now,
    };

    // Update interest scores based on tags
    if (event.interest_tags) {
      for (const tag of event.interest_tags) {
        const field = INTEREST_MAP[tag.toLowerCase()];
        if (field && field.startsWith('interest_')) {
          updates[field] = Math.min(100, (existing[field] || 0) + 5);
        }
      }
    }

    // Boost screen-specific interests
    const screen = (event.screen_name || '').toLowerCase();
    if (screen.includes('invest') || screen.includes('deal')) updates.interest_investing = Math.min(100, (existing.interest_investing || 0) + 3);
    if (screen.includes('portfolio') || screen.includes('holding')) updates.interest_portfolio = Math.min(100, (existing.interest_portfolio || 0) + 3);
    if (screen.includes('market')) updates.interest_marketplace = Math.min(100, (existing.interest_marketplace || 0) + 3);
    if (screen.includes('token') || screen.includes('blockchain')) updates.interest_tokenized_assets = Math.min(100, (existing.interest_tokenized_assets || 0) + 3);
    if (screen.includes('chat') || screen.includes('aura') || screen.includes('ai')) updates.interest_chat_ai = Math.min(100, (existing.interest_chat_ai || 0) + 3);
    if (screen.includes('crm') || screen.includes('contact')) updates.interest_crm = Math.min(100, (existing.interest_crm || 0) + 3);
    if (screen.includes('jv') || screen.includes('venture')) updates.interest_jv_deals = Math.min(100, (existing.interest_jv_deals || 0) + 3);

    await sb.from('member_behavior_profiles').update(updates).eq('id', existing.id);
  } else {
    // Create new profile
    const newProfile: Record<string, unknown> = {
      ...identifier,
      email: event.user_id ? undefined : event.anonymous_id,
      total_sessions: 1,
      total_screen_views: isScreenView ? 1 : 0,
      total_actions: isAction ? 1 : 0,
      total_time_spent_seconds: event.dwell_time_seconds || 0,
      intent_score: Math.min(100, intent_delta),
      funnel_stage: 'visitor',
      first_seen: now,
      last_seen: now,
      last_active_date: now.split('T')[0],
      returning_visitor: false,
      intent_signals: [],
      top_screens: [],
      top_actions: [],
      preferred_categories: [],
      brain_analysis: {},
      brain_recommendations: [],
      brain_risk_flags: [],
    };

    // Set initial interests
    if (event.interest_tags) {
      for (const tag of event.interest_tags) {
        const field = INTEREST_MAP[tag.toLowerCase()];
        if (field && field.startsWith('interest_')) {
          newProfile[field] = 5;
        }
      }
    }

    const { error } = await sb.from('member_behavior_profiles').insert(newProfile);
    if (error && error.code !== '23505') {
      console.error('[analytics-brain] Failed to create profile:', error.message);
    }
  }
}

// ── Brain: Analyze Member Profile ──────────────────────────────────────────

export async function analyzeMember(memberId: string, isAnonymous: boolean = false): Promise<MemberProfile | null> {
  const sb = getSupabase();
  const startTime = Date.now();

  const matchField = isAnonymous ? 'anonymous_id' : 'user_id';
  const { data: profile } = await sb
    .from('member_behavior_profiles')
    .select('*')
    .eq(matchField, memberId)
    .maybeSingle();

  if (!profile) return null;

  // Fetch recent events for analysis
  const { data: events } = await sb
    .from('member_behavior_events')
    .select('*')
    .eq(matchField, memberId)
    .order('timestamp', { ascending: false })
    .limit(200);

  const analysis = computeMemberAnalysis(profile, events || []);
  const recommendations = generateRecommendations(profile, events || []);
  const riskFlags = detectRiskFlags(profile, events || []);
  const funnelStage = determineFunnelStage(profile, events || []);

  // Update profile with brain analysis
  await sb.from('member_behavior_profiles').update({
    brain_analysis: analysis,
    brain_recommendations: recommendations,
    brain_risk_flags: riskFlags,
    brain_last_analyzed: new Date().toISOString(),
    funnel_stage: funnelStage.stage,
    top_screens: analysis.topScreens,
    top_actions: analysis.topActions,
    preferred_categories: analysis.preferredCategories,
    intent_signals: analysis.intentSignals,
  }).eq('id', profile.id);

  // Update conversion pathway
  await updateConversionPathway(memberId, isAnonymous, funnelStage, recommendations);

  // Log analysis run
  const duration_ms = Date.now() - startTime;
  await sb.from('brain_analysis_runs').insert({
    analysis_type: 'member_profile',
    target_id: memberId,
    input_data: { event_count: events?.length || 0, profile_age_days: profile.days_active },
    output_data: analysis,
    recommendations: recommendations,
    risk_flags: riskFlags,
    confidence: analysis.confidence,
    duration_ms,
  });

  return {
    ...profile,
    intent_score: profile.intent_score,
    intent_signals: analysis.intentSignals,
    funnel_stage: funnelStage.stage,
    top_screens: analysis.topScreens,
    top_actions: analysis.topActions,
    preferred_categories: analysis.preferredCategories,
    brain_analysis: analysis,
    brain_recommendations: recommendations,
    brain_risk_flags: riskFlags,
  } as MemberProfile;
}

interface MemberAnalysis {
  confidence: number;
  topScreens: ScreenStat[];
  topActions: ActionStat[];
  preferredCategories: CategoryScore[];
  intentSignals: IntentSignal[];
  sessionPattern: Record<string, unknown>;
  behaviorSummary: string;
}

function computeMemberAnalysis(profile: Record<string, unknown>, events: Record<string, unknown>[]): MemberAnalysis {
  // Top screens
  const screenCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};
  const totalEvents = events.length || 1;

  for (const e of events) {
    if (e.screen_name) {
      screenCounts[e.screen_name as string] = (screenCounts[e.screen_name as string] || 0) + 1;
    }
    if (e.action_name) {
      actionCounts[e.action_name as string] = (actionCounts[e.action_name as string] || 0) + 1;
    }
  }

  const topScreens: ScreenStat[] = Object.entries(screenCounts)
    .map(([screen, views]) => ({ screen, views, pct: Math.round((views / totalEvents) * 100) }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const topActions: ActionStat[] = Object.entries(actionCounts)
    .map(([action, count]) => ({ action, count, pct: Math.round((count / totalEvents) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Preferred categories from interest scores
  const categories: CategoryScore[] = [
    { category: 'JV Deals', score: profile.interest_jv_deals as number },
    { category: 'Tokenized Assets', score: profile.interest_tokenized_assets as number },
    { category: 'Portfolio', score: profile.interest_portfolio as number },
    { category: 'Marketplace', score: profile.interest_marketplace as number },
    { category: 'Investing', score: profile.interest_investing as number },
    { category: 'Chat/AI', score: profile.interest_chat_ai as number },
    { category: 'CRM', score: profile.interest_crm as number },
  ].sort((a, b) => b.score - a.score);

  // Intent signals from recent events
  const intentSignals: IntentSignal[] = events
    .filter(e => (e.intent_delta as number) > 0)
    .slice(0, 20)
    .map(e => ({
      signal: `${e.event_type} on ${e.screen_name || 'unknown'}`,
      weight: e.intent_delta as number,
      timestamp: e.timestamp as string,
    }));

  // Session pattern analysis
  const sessionIds = new Set(events.map(e => e.session_id as string));
  const avgDwell = events.reduce((sum, e) => sum + ((e.dwell_time_seconds as number) || 0), 0) / totalEvents;

  const behaviorSummary = generateBehaviorSummary(profile, topScreens, topActions, categories, avgDwell);

  return {
    confidence: Math.min(1, totalEvents / 50),
    topScreens,
    topActions,
    preferredCategories: categories,
    intentSignals,
    sessionPattern: {
      unique_sessions: sessionIds.size,
      avg_dwell_seconds: Math.round(avgDwell),
      avg_events_per_session: Math.round(totalEvents / Math.max(1, sessionIds.size)),
    },
    behaviorSummary,
  };
}

function generateBehaviorSummary(
  profile: Record<string, unknown>,
  topScreens: ScreenStat[],
  topActions: ActionStat[],
  categories: CategoryScore[],
  avgDwell: number,
): string {
  const parts: string[] = [];
  const intent = profile.intent_score as number;
  const sessions = profile.total_sessions as number;

  parts.push(`Member has ${sessions} sessions with intent score ${intent}/100.`);
  if (topScreens.length > 0) {
    parts.push(`Most viewed: ${topScreens[0].screen} (${topScreens[0].views} views).`);
  }
  if (categories.length > 0 && categories[0].score > 0) {
    parts.push(`Primary interest: ${categories[0].category} (${categories[0].score}/100).`);
  }
  if (avgDwell > 0) {
    parts.push(`Average dwell time: ${Math.round(avgDwell)}s per screen.`);
  }
  if (intent > 60) {
    parts.push('High conversion intent — ready for investment outreach.');
  } else if (intent > 30) {
    parts.push('Moderate intent — needs nurturing with relevant content.');
  } else {
    parts.push('Low intent — early exploration phase.');
  }
  return parts.join(' ');
}

// ── Recommendations Engine ────────────────────────────────────────────────

function generateRecommendations(profile: Record<string, unknown>, events: Record<string, unknown>[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const intent = profile.intent_score as number;
  const stage = (profile.funnel_stage as string) || 'visitor';
  const lastSeen = new Date(profile.last_seen as string);
  const hoursSinceActive = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);
  const topCategory = [
    { name: 'JV Deals', score: profile.interest_jv_deals as number },
    { name: 'Tokenized Assets', score: profile.interest_tokenized_assets as number },
    { name: 'Investing', score: profile.interest_investing as number },
    { name: 'Portfolio', score: profile.interest_portfolio as number },
  ].sort((a, b) => b.score - a.score)[0];

  // High intent — push for conversion
  if (intent >= 60) {
    recs.push({
      action: 'Send personalized investment opportunity from their top interest category',
      priority: 'critical',
      reason: `Intent score is ${intent}/100 — member is ready to invest. Primary interest: ${topCategory.name}.`,
      expected_impact: 'High probability of conversion within 48 hours',
      channel: 'email',
    });
    recs.push({
      action: 'Schedule a call with an IVX investment advisor',
      priority: 'high',
      reason: 'High-intent members convert 3x faster with human contact',
      expected_impact: 'Accelerate conversion by 5-7 days',
      channel: 'call',
    });
  }

  // Moderate intent — nurture
  if (intent >= 30 && intent < 60) {
    recs.push({
      action: `Send ${topCategory.name} market insights and case studies`,
      priority: 'high',
      reason: `Member shows moderate interest in ${topCategory.name} (${topCategory.score}/100). Educational content will move them to high intent.`,
      expected_impact: 'Increase intent score by 15-20 points',
      channel: 'email',
    });
    recs.push({
      action: 'Show a success story notification in-app',
      priority: 'medium',
      reason: 'Social proof accelerates mid-funnel members',
      expected_impact: 'Re-engage within 24 hours',
      channel: 'in_app',
    });
  }

  // Low intent — educate and engage
  if (intent < 30) {
    recs.push({
      action: 'Send onboarding guide about IVX investment opportunities',
      priority: 'medium',
      reason: 'Member is in early exploration. Guide them to their first area of interest.',
      expected_impact: 'Move from visitor to engaged stage',
      channel: 'email',
    });
    recs.push({
      action: 'Trigger in-app welcome tour on next session',
      priority: 'low',
      reason: 'New members need orientation to platform features',
      expected_impact: 'Increase session duration by 40%',
      channel: 'in_app',
    });
  }

  // Churn risk — re-engage
  if (hoursSinceActive > 72 && hoursSinceActive < 168) {
    recs.push({
      action: 'Send "We miss you" re-engagement push with personalized content',
      priority: 'high',
      reason: `Member inactive for ${Math.round(hoursSinceActive / 24)} days. Churn risk increasing.`,
      expected_impact: '30% chance of reactivation',
      channel: 'push',
    });
  }
  if (hoursSinceActive >= 168) {
    recs.push({
      action: 'Send personalized email with a new investment opportunity matching their interests',
      priority: 'critical',
      reason: `Member inactive for ${Math.round(hoursSinceActive / 24)} days. High churn risk.`,
      expected_impact: '15-20% chance of reactivation with strong incentive',
      channel: 'email',
    });
  }

  // Stage-specific recommendations
  if (stage === 'engaged' && intent < 50) {
    recs.push({
      action: 'Offer a free portfolio consultation to bridge engagement to interest',
      priority: 'high',
      reason: 'Engaged but not yet showing strong intent — human touch can bridge the gap',
      expected_impact: '40% lift in conversion probability',
      channel: 'in_app',
    });
  }

  if (stage === 'ready_to_invest') {
    recs.push({
      action: 'Send time-sensitive deal from their top interest category',
      priority: 'critical',
      reason: 'Member is in ready_to_invest stage — timing is critical',
      expected_impact: 'Immediate conversion likely',
      channel: 'push',
    });
  }

  return recs;
}

// ── Risk Detection ──────────────────────────────────────────────────────────

function detectRiskFlags(profile: Record<string, unknown>, events: Record<string, unknown>[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const intent = profile.intent_score as number;
  const lastSeen = new Date(profile.last_seen as string);
  const hoursSinceActive = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);
  const totalSessions = profile.total_sessions as number;

  // Churn risk
  if (hoursSinceActive > 168) {
    flags.push({
      type: 'churn_risk',
      severity: 'critical',
      description: `Member inactive for ${Math.round(hoursSinceActive / 24)} days. Immediate re-engagement needed.`,
    });
  } else if (hoursSinceActive > 72) {
    flags.push({
      type: 'churn_risk',
      severity: 'high',
      description: `Member inactive for ${Math.round(hoursSinceActive / 24)} days. Churn risk increasing.`,
    });
  }

  // Low engagement
  if (totalSessions > 3 && intent < 20) {
    flags.push({
      type: 'low_engagement',
      severity: 'medium',
      description: `${totalSessions} sessions but intent still at ${intent}/100. Content may not be resonating.`,
    });
  }

  // Stalled funnel
  const stage = (profile.funnel_stage as string) || 'visitor';
  if (stage === 'engaged' && hoursSinceActive > 48) {
    flags.push({
      type: 'stalled_funnel',
      severity: 'high',
      description: 'Member reached engaged stage but hasn\'t progressed. Needs a nudge.',
    });
  }
  if (stage === 'interested' && hoursSinceActive > 24) {
    flags.push({
      type: 'stalled_funnel',
      severity: 'critical',
      description: 'Member showed interest but went silent. High-value conversion at risk.',
    });
  }

  // Inactivity
  if (totalSessions <= 1) {
    flags.push({
      type: 'inactivity',
      severity: 'low',
      description: 'Only 1 session. Member may not have found value yet.',
    });
  }

  // Scam interest detection — if member repeatedly views tokenized assets without verification
  const tokenEvents = events.filter(e => {
    const tags = e.interest_tags as string[] | null;
    return tags && tags.some(t => t.includes('token') || t.includes('blockchain'));
  });
  if (tokenEvents.length > 10 && (profile.interest_tokenized_assets as number) > 70) {
    flags.push({
      type: 'scam_interest',
      severity: 'medium',
      description: 'High interest in tokenized assets. Ensure they\'re viewing verified, legitimate opportunities only.',
    });
  }

  return flags;
}

// ── Funnel Stage Determination ─────────────────────────────────────────────

function determineFunnelStage(profile: Record<string, unknown>, events: Record<string, unknown>[]): { stage: string; confidence: number } {
  const intent = profile.intent_score as number;
  const totalSessions = profile.total_sessions as number;
  const hasTransaction = events.some(e => e.event_type === 'transaction' || e.event_type === 'conversion');
  const hasSearch = events.some(e => e.event_type === 'search');
  const hasMultipleSessions = totalSessions > 1;

  if (hasTransaction) return { stage: 'invested', confidence: 1.0 };
  if (intent >= 70) return { stage: 'ready_to_invest', confidence: 0.9 };
  if (intent >= 40 || hasSearch) return { stage: 'interested', confidence: 0.8 };
  if (hasMultipleSessions || intent >= 15) return { stage: 'engaged', confidence: 0.7 };
  if (profile.email || profile.user_id) return { stage: 'registered', confidence: 0.9 };
  return { stage: 'visitor', confidence: 1.0 };
}

// ── Conversion Pathway ─────────────────────────────────────────────────────

async function updateConversionPathway(
  memberId: string,
  isAnonymous: boolean,
  funnelStage: { stage: string; confidence: number },
  recommendations: Recommendation[],
): Promise<void> {
  const sb = getSupabase();
  const matchField = isAnonymous ? 'anonymous_id' : 'user_id';
  const now = new Date().toISOString();

  const { data: existing } = await sb
    .from('conversion_pathways')
    .select('*')
    .eq(matchField, memberId)
    .maybeSingle();

  const stageHistory = (existing?.stage_history as unknown[]) || [];
  const lastEntry = stageHistory[stageHistory.length - 1] as Record<string, unknown> | undefined;

  if (existing) {
    // Check if stage changed
    if (existing.current_stage !== funnelStage.stage) {
      // Close previous stage
      if (lastEntry && !lastEntry.exited_at) {
        lastEntry.exited_at = now;
        const entered = new Date(lastEntry.entered_at as string);
        lastEntry.duration_seconds = Math.round((Date.now() - entered.getTime()) / 1000);
      }
      // Add new stage
      stageHistory.push({ stage: funnelStage.stage, entered_at: now, exited_at: null, duration_seconds: 0 });

      // Record conversion trigger
      const triggers = (existing.conversion_triggers as unknown[]) || [];
      triggers.push({
        trigger: `Behavioral analysis detected stage change`,
        from_stage: existing.current_stage,
        to_stage: funnelStage.stage,
        timestamp: now,
      });

      await sb.from('conversion_pathways').update({
        current_stage: funnelStage.stage,
        stage_history: stageHistory,
        conversion_triggers: triggers,
        brain_recommendations: recommendations,
        next_best_action: recommendations[0]?.action || null,
        conversion_probability: calculateConversionProbability(funnelStage.stage),
        updated_at: now,
      }).eq('id', existing.id);
    }
  } else {
    // Create new pathway
    await sb.from('conversion_pathways').insert({
      [matchField]: memberId,
      current_stage: funnelStage.stage,
      stage_history: [{ stage: funnelStage.stage, entered_at: now, exited_at: null, duration_seconds: 0 }],
      conversion_triggers: [],
      friction_points: [],
      brain_recommendations: recommendations,
      next_best_action: recommendations[0]?.action || null,
      brain_reasoning: `Initial analysis: ${funnelStage.confidence * 100}% confidence in ${funnelStage.stage} stage`,
      conversion_probability: calculateConversionProbability(funnelStage.stage),
    });
  }
}

function calculateConversionProbability(stage: string): number {
  const probabilities: Record<string, number> = {
    visitor: 5,
    registered: 12,
    engaged: 25,
    interested: 45,
    ready_to_invest: 75,
    invested: 100,
    churned: 2,
  };
  return probabilities[stage] || 0;
}

// ── Scam Detection ────────────────────────────────────────────────────────

export async function analyzeAssetForScam(input: ScamAnalysisInput): Promise<ScamAnalysisResult> {
  const sb = getSupabase();
  const startTime = Date.now();

  const redFlags: RedFlag[] = [];
  const greenFlags: GreenFlag[] = [];
  let scamScore = 0;
  const data = input.asset_data;

  // ── Red Flag Detection ──────────────────────────────────────────────────

  // No title chain
  if (!data.title_chain || data.title_chain === 'unverified') {
    redFlags.push({
      flag: 'No verified title chain',
      severity: 'critical',
      description: 'Property/deal has no verifiable title chain. This is a major red flag for fraud.',
    });
    scamScore += 25;
  }

  // No ownership docs
  if (!data.ownership_docs || data.ownership_docs === 'unverified') {
    redFlags.push({
      flag: 'Ownership not verified',
      severity: 'critical',
      description: 'No documented proof of ownership. Cannot verify the seller/promoter owns the asset.',
    });
    scamScore += 25;
  }

  // No financials
  if (!data.financials || data.financials === 'unverified') {
    redFlags.push({
      flag: 'Financials not disclosed',
      severity: 'high',
      description: 'No audited financial statements. Returns projections are unverifiable.',
    });
    scamScore += 15;
  }

  // No legal disclosures
  if (!data.legal_disclosures || data.legal_disclosures === 'missing') {
    redFlags.push({
      flag: 'Missing legal disclosures',
      severity: 'high',
      description: 'No SEC risk disclosures, accreditation requirements, or offering documents.',
    });
    scamScore += 15;
  }

  // No SEC registration for securities
  if (input.asset_type === 'tokenized_asset' || input.asset_type === 'security') {
    if (!data.sec_registration || data.sec_registration === 'unverified') {
      redFlags.push({
        flag: 'No SEC registration verification',
        severity: 'critical',
        description: 'Security/tokenized asset has no verified SEC registration or exemption filing (Reg D, Reg A+, Reg S).',
      });
      scamScore += 20;
    }
  }

  // No third-party audit
  if (!data.third_party_audit || data.third_party_audit === 'none') {
    redFlags.push({
      flag: 'No third-party audit',
      severity: 'medium',
      description: 'No independent audit of the asset, financials, or smart contract.',
    });
    scamScore += 10;
  }

  // Unrealistic returns
  if (data.expected_returns) {
    const returnsStr = data.expected_returns.toLowerCase();
    const returnMatch = returnsStr.match(/(\d+)%/);
    if (returnMatch && parseInt(returnMatch[1]) > 25) {
      redFlags.push({
        flag: 'Unrealistic returns promised',
        severity: 'critical',
        description: `Promised returns of ${returnMatch[1]}% are far above market norms. Classic Ponzi/scam indicator.`,
      });
      scamScore += 20;
    }
  }

  // Guaranteed returns language
  if (data.description && /guaranteed|risk.?free|can.?t.?lose|no risk/i.test(data.description)) {
    redFlags.push({
      flag: 'Guaranteed returns language',
      severity: 'critical',
      description: 'Uses "guaranteed returns", "risk-free", or similar language. All investments carry risk — this is a scam indicator.',
    });
    scamScore += 20;
  }

  // Anonymous promoter
  if (!data.promoter_info || data.promoter_info === 'anonymous') {
    redFlags.push({
      flag: 'Anonymous promoter',
      severity: 'high',
      description: 'No verifiable information about the deal promoter. Anonymous promoters are a major fraud signal.',
    });
    scamScore += 15;
  }

  // Tokenized asset — check contract address
  if (input.asset_type === 'tokenized_asset') {
    if (!data.contract_address) {
      redFlags.push({
        flag: 'No smart contract address',
        severity: 'high',
        description: 'Tokenized asset has no published smart contract address. Cannot verify on-chain.',
      });
      scamScore += 15;
    }
    if (!data.tokenization_platform || data.tokenization_platform === 'unknown') {
      redFlags.push({
        flag: 'Unknown tokenization platform',
        severity: 'medium',
        description: 'No verifiable tokenization platform (e.g., Securitize, tZERO, Polymath).',
      });
      scamScore += 10;
    }
  }

  // High pressure — very short lockup
  if (data.lockup_period) {
    const lockupMatch = data.lockup_period.match(/(\d+)/);
    if (lockupMatch && parseInt(lockupMatch[1]) > 60) {
      redFlags.push({
        flag: 'Extended lockup period',
        severity: 'medium',
        description: `Lockup period of ${data.lockup_period} restricts liquidity. Verify exit terms carefully.`,
      });
      scamScore += 10;
    }
  }

  // High minimum investment with no accreditation check
  if (data.minimum_investment) {
    const minMatch = data.minimum_investment.match(/[\$]?([\d,]+)/);
    if (minMatch) {
      const minAmount = parseInt(minMatch[1].replace(/,/g, ''));
      if (minAmount > 50000) {
        redFlags.push({
          flag: 'High minimum investment',
          severity: 'medium',
          description: `Minimum investment of $${minAmount.toLocaleString()} is high. Verify accreditation requirements are enforced.`,
        });
        scamScore += 8;
      }
    }
  }

  // ── Green Flag Detection ───────────────────────────────────────────────

  if (data.title_chain && data.title_chain !== 'unverified') {
    greenFlags.push({ flag: 'Title chain verified', description: `Verified: ${data.title_chain}` });
  }
  if (data.ownership_docs && data.ownership_docs !== 'unverified') {
    greenFlags.push({ flag: 'Ownership documented', description: `Ownership docs: ${data.ownership_docs}` });
  }
  if (data.financials && data.financials !== 'unverified') {
    greenFlags.push({ flag: 'Financials disclosed', description: 'Audited financial statements available.' });
    scamScore = Math.max(0, scamScore - 5);
  }
  if (data.legal_disclosures && data.legal_disclosures !== 'missing') {
    greenFlags.push({ flag: 'Legal disclosures present', description: 'SEC risk disclosures and offering documents available.' });
    scamScore = Math.max(0, scamScore - 5);
  }
  if (data.sec_registration && data.sec_registration !== 'unverified') {
    greenFlags.push({ flag: 'SEC registration verified', description: `Registration: ${data.sec_registration}` });
    scamScore = Math.max(0, scamScore - 10);
  }
  if (data.third_party_audit && data.third_party_audit !== 'none') {
    greenFlags.push({ flag: 'Third-party audit completed', description: `Audited by: ${data.third_party_audit}` });
    scamScore = Math.max(0, scamScore - 8);
  }
  if (data.tokenization_platform && data.tokenization_platform !== 'unknown') {
    greenFlags.push({ flag: 'Established tokenization platform', description: `Platform: ${data.tokenization_platform}` });
    scamScore = Math.max(0, scamScore - 5);
  }

  // Clamp score
  scamScore = Math.min(100, Math.max(0, scamScore));

  // Determine verdict
  let verdict: ScamAnalysisResult['brain_verdict'];
  let confidence: 'low' | 'medium' | 'high';

  if (scamScore >= 70) {
    verdict = 'likely_scam';
    confidence = 'high';
  } else if (scamScore >= 40) {
    verdict = 'suspicious';
    confidence = 'medium';
  } else if (greenFlags.length >= 3 && scamScore < 20) {
    verdict = 'legitimate';
    confidence = 'high';
  } else {
    verdict = 'unverified';
    confidence = 'low';
  }

  // Generate recommendations
  const scamRecs: Recommendation[] = [];
  if (verdict === 'likely_scam') {
    scamRecs.push({
      action: 'DO NOT PROCEED with this deal. Flag as fraudulent and alert all members who viewed it.',
      priority: 'critical',
      reason: `${redFlags.filter(f => f.severity === 'critical').length} critical red flags detected. Scam score: ${scamScore}/100.`,
      expected_impact: 'Prevent member financial loss and legal liability',
      channel: 'in_app',
    });
    scamRecs.push({
      action: 'Report to SEC, FTC, and state attorney general',
      priority: 'critical',
      reason: 'Likely securities fraud detected. Mandatory reporting.',
      expected_impact: 'Regulatory compliance and member protection',
      channel: 'email',
    });
  } else if (verdict === 'suspicious') {
    scamRecs.push({
      action: 'Require additional documentation before listing: audited financials, SEC filing proof, title verification',
      priority: 'critical',
      reason: `${redFlags.length} red flags detected. Scam score: ${scamScore}/100. Not verified as legitimate.`,
      expected_impact: 'Protect members from potentially fraudulent deal',
      channel: 'in_app',
    });
    scamRecs.push({
      action: 'Add warning badge to listing: "Under Review — Not Fully Verified"',
      priority: 'high',
      reason: 'Members deserve transparency about verification status',
      expected_impact: 'Informed member decisions',
      channel: 'in_app',
    });
  } else if (verdict === 'unverified') {
    scamRecs.push({
      action: 'Request promoter provide: title chain, ownership docs, financials, SEC registration',
      priority: 'high',
      reason: 'Asset has insufficient verification. Cannot confirm legitimacy or fraud.',
      expected_impact: 'Achieve clear legitimate/scam verdict',
      channel: 'email',
    });
  } else {
    scamRecs.push({
      action: 'Approved for listing. Display verification badges to members.',
      priority: 'low',
      reason: `${greenFlags.length} green flags, scam score ${scamScore}/100. Asset verified as legitimate.`,
      expected_impact: 'Member confidence and conversion',
      channel: 'in_app',
    });
  }

  const result: ScamAnalysisResult = {
    asset_id: input.asset_id,
    scam_score: scamScore,
    confidence_level: confidence,
    red_flags: redFlags,
    green_flags: greenFlags,
    brain_verdict: verdict,
    brain_analysis: {
      total_red_flags: redFlags.length,
      critical_flags: redFlags.filter(f => f.severity === 'critical').length,
      total_green_flags: greenFlags.length,
      verification_checks: {
        title_verified: !!data.title_chain && data.title_chain !== 'unverified',
        ownership_verified: !!data.ownership_docs && data.ownership_docs !== 'unverified',
        financials_verified: !!data.financials && data.financials !== 'unverified',
        legal_disclosures_present: !!data.legal_disclosures && data.legal_disclosures !== 'missing',
        sec_registration_verified: !!data.sec_registration && data.sec_registration !== 'unverified',
        third_party_audit: !!data.third_party_audit && data.third_party_audit !== 'none',
      },
    },
    brain_recommendations: scamRecs,
  };

  // Save to database
  await sb.from('asset_scam_analysis').upsert({
    asset_id: input.asset_id,
    asset_type: input.asset_type,
    asset_name: input.asset_name || null,
    asset_data: data,
    scam_score: scamScore,
    confidence_level: confidence,
    red_flags: redFlags,
    green_flags: greenFlags,
    title_verified: !!data.title_chain && data.title_chain !== 'unverified',
    ownership_verified: !!data.ownership_docs && data.ownership_docs !== 'unverified',
    financials_verified: !!data.financials && data.financials !== 'unverified',
    legal_disclosures_present: !!data.legal_disclosures && data.legal_disclosures !== 'missing',
    sec_registration_verified: !!data.sec_registration && data.sec_registration !== 'unverified',
    third_party_audit: !!data.third_party_audit && data.third_party_audit !== 'none',
    brain_verdict: verdict,
    brain_analysis: result.brain_analysis,
    brain_recommendations: scamRecs,
    analyzed_at: new Date().toISOString(),
  }, { onConflict: 'asset_id' });

  // Log analysis run
  const duration_ms = Date.now() - startTime;
  await sb.from('brain_analysis_runs').insert({
    analysis_type: 'scam_detection',
    target_id: input.asset_id,
    input_data: input,
    output_data: result,
    recommendations: scamRecs,
    risk_flags: redFlags,
    confidence: confidence === 'high' ? 0.9 : confidence === 'medium' ? 0.7 : 0.4,
    duration_ms,
  });

  return result;
}

// ── Retention Cohort Analysis ──────────────────────────────────────────────

export async function computeRetentionCohorts(periodType: 'daily' | 'weekly' | 'monthly' = 'weekly'): Promise<RetentionCohort[]> {
  const sb = getSupabase();

  // Get all members with their first_seen date
  const { data: members } = await sb
    .from('member_behavior_profiles')
    .select('id, first_seen, last_seen, user_id, anonymous_id, funnel_stage')
    .order('first_seen', { ascending: true });

  if (!members || members.length === 0) return [];

  // Group members by cohort date
  const cohorts: Map<string, typeof members> = new Map();
  for (const m of members) {
    const cohortDate = truncateDate(m.first_seen, periodType);
    if (!cohorts.has(cohortDate)) cohorts.set(cohortDate, []);
    cohorts.get(cohortDate)!.push(m);
  }

  const results: RetentionCohort[] = [];
  const now = new Date();

  for (const [cohortDate, cohortMembers] of cohorts) {
    const cohortSize = cohortMembers.length;
    const retentionData: { period: number; retained_count: number; retention_pct: number }[] = [];
    const cohortStartDate = new Date(cohortDate);

    // Calculate retention for periods 0-12
    const maxPeriods = 12;
    for (let p = 0; p <= maxPeriods; p++) {
      const periodEnd = addPeriod(cohortStartDate, p, periodType);
      if (periodEnd > now) break;

      // Count members who were still active at this period
      let retained = 0;
      for (const m of cohortMembers) {
        const lastSeen = new Date(m.last_seen);
        if (lastSeen >= periodEnd) {
          retained++;
        }
      }
      retentionData.push({
        period: p,
        retained_count: retained,
        retention_pct: cohortSize > 0 ? Math.round((retained / cohortSize) * 100 * 100) / 100 : 0,
      });
    }

    // Calculate conversions
    const converted = cohortMembers.filter(m => m.funnel_stage === 'invested').length;
    const conversionRate = cohortSize > 0 ? Math.round((converted / cohortSize) * 100 * 100) / 100 : 0;

    // Generate brain insights
    const avgRetention = retentionData.length > 0
      ? retentionData.reduce((sum, r) => sum + r.retention_pct, 0) / retentionData.length
      : 0;
    const day1Retention = retentionData[1]?.retention_pct || 0;
    const week1Retention = retentionData[1]?.retention_pct || 0;

    const brain_insights = {
      avg_retention_pct: Math.round(avgRetention * 100) / 100,
      day1_retention: day1Retention,
      cohort_health: avgRetention > 40 ? 'healthy' : avgRetention > 20 ? 'at_risk' : 'critical',
      conversion_rate: conversionRate,
      insight: generateCohortInsight(avgRetention, day1Retention, conversionRate, cohortSize),
    };

    const cohort: RetentionCohort = {
      cohort_date: cohortDate,
      cohort_size: cohortSize,
      period_type: periodType,
      retention_data: retentionData,
      converted_count: converted,
      conversion_rate: conversionRate,
      brain_insights,
    };

    results.push(cohort);

    // Upsert to database
    await sb.from('member_retention_cohorts').upsert({
      cohort_date: cohortDate,
      cohort_size: cohortSize,
      period_type: periodType,
      retention_data: retentionData,
      converted_count: converted,
      conversion_rate: conversionRate,
      brain_insights,
    }, { onConflict: 'cohort_date,period_type' });
  }

  return results;
}

function truncateDate(dateStr: string, periodType: string): string {
  const d = new Date(dateStr);
  if (periodType === 'daily') {
    return d.toISOString().split('T')[0];
  } else if (periodType === 'weekly') {
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  } else {
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  }
}

function addPeriod(date: Date, periods: number, periodType: string): Date {
  const d = new Date(date);
  if (periodType === 'daily') {
    d.setDate(d.getDate() + periods);
  } else if (periodType === 'weekly') {
    d.setDate(d.getDate() + periods * 7);
  } else {
    d.setMonth(d.getMonth() + periods);
  }
  return d;
}

function generateCohortInsight(avgRetention: number, day1Retention: number, conversionRate: number, size: number): string {
  const parts: string[] = [];
  parts.push(`Cohort of ${size} members.`);
  if (day1Retention < 30) {
    parts.push(`Day 1 retention is ${day1Retention}% — critical drop-off after first session. Improve onboarding.`);
  } else if (day1Retention < 50) {
    parts.push(`Day 1 retention is ${day1Retention}% — below benchmark. Consider push notifications for re-engagement.`);
  } else {
    parts.push(`Day 1 retention is ${day1Retention}% — healthy. Members find value quickly.`);
  }
  if (avgRetention < 20) {
    parts.push(`Average retention ${Math.round(avgRetention)}% — long-term engagement needs attention.`);
  }
  if (conversionRate > 0) {
    parts.push(`${conversionRate}% converted to investment — strong performance.`);
  } else if (size > 10) {
    parts.push('No conversions yet — focus on moving engaged members to interested stage.');
  }
  return parts.join(' ');
}

// ── Dashboard Aggregation ──────────────────────────────────────────────────

export async function getBrainDashboard(): Promise<Record<string, unknown>> {
  const sb = getSupabase();

  // Total members
  const { count: totalMembers } = await sb
    .from('member_behavior_profiles')
    .select('*', { count: 'exact', head: true });

  // Members by funnel stage
  const { data: stageData } = await sb
    .from('member_behavior_profiles')
    .select('funnel_stage')
    .order('funnel_stage');

  const stageCounts: Record<string, number> = {};
  for (const row of stageData || []) {
    const stage = row.funnel_stage || 'visitor';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }

  // High-intent members
  const { data: highIntent } = await sb
    .from('member_behavior_profiles')
    .select('user_id, anonymous_id, email, intent_score, funnel_stage, last_seen, brain_recommendations')
    .gte('intent_score', 50)
    .order('intent_score', { ascending: false })
    .limit(20);

  // At-risk members (churn risk)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: atRisk } = await sb
    .from('member_behavior_profiles')
    .select('user_id, anonymous_id, email, intent_score, funnel_stage, last_seen, brain_risk_flags')
    .lt('last_seen', threeDaysAgo)
    .order('last_seen', { ascending: false })
    .limit(20);

  // Total events
  const { count: totalEvents } = await sb
    .from('member_behavior_events')
    .select('*', { count: 'exact', head: true });

  // Scam analyses
  const { data: scamAnalyses } = await sb
    .from('asset_scam_analysis')
    .select('asset_id, asset_name, asset_type, scam_score, brain_verdict, analyzed_at')
    .order('scam_score', { ascending: false })
    .limit(10);

  // Retention cohorts
  const cohorts = await computeRetentionCohorts('weekly');

  // Active members (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: activeToday } = await sb
    .from('member_behavior_profiles')
    .select('*', { count: 'exact', head: true })
    .gte('last_seen', oneDayAgo);

  return {
    total_members: totalMembers || 0,
    active_today: activeToday || 0,
    total_events: totalEvents || 0,
    funnel_distribution: stageCounts,
    high_intent_members: highIntent || [],
    at_risk_members: atRisk || [],
    scam_analyses: scamAnalyses || [],
    retention_cohorts: cohorts,
    brain_summary: {
      total_analyzed: totalMembers || 0,
      avg_intent: highIntent && highIntent.length > 0
        ? Math.round(highIntent.reduce((sum, m) => sum + (m.intent_score || 0), 0) / highIntent.length)
        : 0,
      conversion_ready: stageCounts['ready_to_invest'] || 0,
      churn_risk_count: (atRisk || []).length,
      scams_detected: (scamAnalyses || []).filter(s => s.brain_verdict === 'likely_scam' || s.brain_verdict === 'suspicious').length,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Batch Event Ingest ─────────────────────────────────────────────────────

export async function ingestBatchEvents(events: BehaviorEvent[]): Promise<{ ingested: number; errors: number }> {
  let ingested = 0;
  let errors = 0;

  for (const event of events) {
    try {
      await ingestBehaviorEvent(event);
      ingested++;
    } catch {
      errors++;
    }
  }

  return { ingested, errors };
}
