/**
 * IVX Analytics Brain — Frontend client for the per-member behavioral
 * intelligence system. Provides typed access to all brain endpoints.
 */

import { Platform } from 'react-native';

const API_BASE = 'https://ivx-holdings-platform.onrender.com';

export interface BehaviorEventInput {
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
  id: string;
  user_id?: string;
  anonymous_id?: string;
  email?: string;
  total_sessions: number;
  total_screen_views: number;
  total_actions: number;
  intent_score: number;
  funnel_stage: string;
  last_seen: string;
  first_seen: string;
  interest_jv_deals: number;
  interest_tokenized_assets: number;
  interest_portfolio: number;
  interest_investing: number;
  interest_chat_ai: number;
  interest_crm: number;
  brain_recommendations: Recommendation[];
  brain_risk_flags: RiskFlag[];
  top_screens: { screen: string; views: number; pct: number }[];
  top_actions: { action: string; count: number; pct: number }[];
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

export interface BrainDashboard {
  total_members: number;
  active_today: number;
  total_events: number;
  funnel_distribution: Record<string, number>;
  high_intent_members: MemberProfile[];
  at_risk_members: MemberProfile[];
  scam_analyses: ScamAnalysis[];
  retention_cohorts: RetentionCohort[];
  brain_summary: {
    total_analyzed: number;
    avg_intent: number;
    conversion_ready: number;
    churn_risk_count: number;
    scams_detected: number;
  };
  timestamp: string;
}

export interface ScamAnalysis {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  scam_score: number;
  brain_verdict: string;
  red_flags: { flag: string; severity: string; description: string }[];
  green_flags: { flag: string; description: string }[];
  brain_recommendations: Recommendation[];
}

export interface RetentionCohort {
  cohort_date: string;
  cohort_size: number;
  period_type: string;
  retention_data: { period: number; retained_count: number; retention_pct: number }[];
  converted_count: number;
  conversion_rate: number;
  brain_insights: Record<string, unknown>;
}

export interface ConversionPathway {
  user_id?: string;
  anonymous_id?: string;
  current_stage: string;
  stage_history: { stage: string; entered_at: string; exited_at: string | null; duration_seconds: number }[];
  conversion_triggers: { trigger: string; from_stage: string; to_stage: string; timestamp: string }[];
  friction_points: { point: string; severity: string; suggestion: string }[];
  next_best_action: string;
  brain_recommendations: Recommendation[];
  conversion_probability: number;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Analytics Brain API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// ── Event Tracking ────────────────────────────────────────────────────────

export function trackEvent(event: BehaviorEventInput): Promise<{ ok: boolean; intent_delta: number }> {
  return apiFetch('/api/ivx/analytics/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export function trackBatchEvents(events: BehaviorEventInput[]): Promise<{ ingested: number; errors: number }> {
  return apiFetch('/api/ivx/analytics/events/batch', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}

// Convenience helpers
export function trackScreenView(screenName: string, sessionId: string, userId?: string, anonId?: string, dwellSeconds?: number): Promise<{ ok: boolean; intent_delta: number }> {
  return trackEvent({
    user_id: userId,
    anonymous_id: anonId,
    session_id: sessionId,
    event_type: 'screen_view',
    event_category: 'navigation',
    screen_name: screenName,
    dwell_time_seconds: dwellSeconds,
    interest_tags: inferInterestTags(screenName),
  });
}

export function trackClick(screenName: string, component: string, label: string, sessionId: string, userId?: string, anonId?: string): Promise<{ ok: boolean; intent_delta: number }> {
  return trackEvent({
    user_id: userId,
    anonymous_id: anonId,
    session_id: sessionId,
    event_type: 'click',
    event_category: 'engagement',
    screen_name: screenName,
    target_component: component,
    target_label: label,
    interest_tags: inferInterestTags(screenName),
  });
}

export function trackSearch(query: string, sessionId: string, userId?: string, anonId?: string): Promise<{ ok: boolean; intent_delta: number }> {
  return trackEvent({
    user_id: userId,
    anonymous_id: anonId,
    session_id: sessionId,
    event_type: 'search',
    event_category: 'search',
    action_name: query,
    interest_tags: inferInterestTags(query),
  });
}

export function trackConversion(action: string, value: number, sessionId: string, userId?: string, anonId?: string): Promise<{ ok: boolean; intent_delta: number }> {
  return trackEvent({
    user_id: userId,
    anonymous_id: anonId,
    session_id: sessionId,
    event_type: 'conversion',
    event_category: 'transaction',
    action_name: action,
    properties: { value },
    interest_tags: ['investing'],
  });
}

function inferInterestTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  if (lower.includes('jv') || lower.includes('venture') || lower.includes('deal')) tags.push('jv_deals');
  if (lower.includes('token') || lower.includes('blockchain') || lower.includes('crypto')) tags.push('tokenized_assets');
  if (lower.includes('portfolio') || lower.includes('holding')) tags.push('portfolio');
  if (lower.includes('market')) tags.push('marketplace');
  if (lower.includes('invest') || lower.includes('deal')) tags.push('investing');
  if (lower.includes('chat') || lower.includes('aura') || lower.includes('ai')) tags.push('chat_ai');
  if (lower.includes('crm') || lower.includes('contact')) tags.push('crm');
  return tags;
}

// ── Dashboard & Analysis ────────────────────────────────────────────────────

export function getBrainDashboard(): Promise<{ ok: boolean; dashboard: BrainDashboard }> {
  return apiFetch('/api/ivx/analytics/dashboard');
}

export function getMembers(limit = 50, offset = 0, minIntent = 0): Promise<{ ok: boolean; members: MemberProfile[]; total: number }> {
  return apiFetch(`/api/ivx/analytics/members?limit=${limit}&offset=${offset}&min_intent=${minIntent}`);
}

export function analyzeMember(memberId: string, anonymous = false): Promise<{ ok: boolean; member: MemberProfile }> {
  return apiFetch(`/api/ivx/analytics/members/analyze?member_id=${encodeURIComponent(memberId)}&anonymous=${anonymous}`);
}

export function getMemberProfile(memberId: string, anonymous = false): Promise<{ ok: boolean; profile: MemberProfile; recent_events: unknown[]; conversion_pathway: ConversionPathway | null }> {
  return apiFetch(`/api/ivx/analytics/members/profile?member_id=${encodeURIComponent(memberId)}&anonymous=${anonymous}`);
}

export function analyzeAssetForScam(input: {
  asset_id: string;
  asset_type: 'jv_deal' | 'tokenized_asset' | 'property' | 'security';
  asset_name?: string;
  asset_data: Record<string, unknown>;
}): Promise<{ ok: boolean; analysis: ScamAnalysis }> {
  return apiFetch('/api/ivx/analytics/scam/analyze', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getScamAnalyses(): Promise<{ ok: boolean; analyses: ScamAnalysis[]; count: number }> {
  return apiFetch('/api/ivx/analytics/scam/list');
}

export function getRetentionCohorts(period: 'daily' | 'weekly' | 'monthly' = 'weekly'): Promise<{ ok: boolean; cohorts: RetentionCohort[]; count: number }> {
  return apiFetch(`/api/ivx/analytics/retention?period=${period}`);
}

export function getConversionPathways(stage?: string): Promise<{ ok: boolean; pathways: ConversionPathway[]; count: number }> {
  const query = stage ? `?stage=${encodeURIComponent(stage)}` : '';
  return apiFetch(`/api/ivx/analytics/pathways${query}`);
}

export function getBrainAnalysisRuns(type?: string): Promise<{ ok: boolean; runs: unknown[]; count: number }> {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  return apiFetch(`/api/ivx/analytics/runs${query}`);
}

export function getSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnonymousId(): string {
  return `anon-${Platform.OS}-${Date.now().toString(36)}`;
}
