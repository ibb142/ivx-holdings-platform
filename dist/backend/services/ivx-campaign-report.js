/**
 * IVX 10-Day Buyer / JV / Investor Campaign — report aggregator (owner-only reads).
 *
 * Builds the campaign dashboard report from REAL captured leads only
 * (ivx-lead-capture-store). Nothing is fabricated:
 *   - Lead counts, roles, scores, sources, stages come straight from captured records.
 *   - Visitor / page-view analytics are NOT tracked anywhere in this platform, so the
 *     report exposes `visitorsTracked: false` and never invents a traffic number.
 *   - "Best candidate" per audience is simply the highest-scoring real lead in that role,
 *     or null when none exist.
 *
 * Audience classification (honest mapping over the real LeadRole):
 *   investor → investor
 *   buyer    → buyer
 *   jv_partner → JV / capital partner
 * Every other role still counts toward the total and the source/stage rollups.
 */
import { listLeads } from './ivx-lead-capture-store';
export const IVX_CAMPAIGN_MARKER = 'ivx-10day-campaign-2026-06';
export const IVX_CAMPAIGN_TITLE = 'IVX 10-Day Buyer / JV / Investor Campaign';
export const CAMPAIGN_WINDOW_DAYS = 10;
function nowIso() {
    return new Date().toISOString();
}
/** UTC calendar day key (YYYY-MM-DD) for an ISO timestamp. */
function dayKey(iso) {
    const t = Date.parse(iso);
    const d = Number.isFinite(t) ? new Date(t) : new Date();
    return d.toISOString().slice(0, 10);
}
function audienceForRole(role) {
    if (role === 'investor')
        return 'investor';
    if (role === 'buyer')
        return 'buyer';
    if (role === 'jv_partner')
        return 'jv';
    return 'other';
}
/**
 * Derive a dashboard status from real lead state only:
 *   stage closed → closed; stage lost → rejected; due follow-up → follow_up;
 *   qualified temperature/stage → qualified; any contact-side stage → contacted;
 *   otherwise → new.
 */
function statusForLead(lead) {
    if (lead.stage === 'closed')
        return 'closed';
    if (lead.stage === 'lost')
        return 'rejected';
    const due = lead.followUpDueAt ? Date.parse(lead.followUpDueAt) : NaN;
    if (Number.isFinite(due) && due <= Date.now())
        return 'follow_up';
    if (lead.temperature === 'qualified' || lead.stage === 'qualified')
        return 'qualified';
    const contactedStages = new Set([
        'contacted', 'replied', 'meeting_requested', 'data_room_sent', 'loi_requested', 'soft_commitment',
    ]);
    if (contactedStages.has(lead.stage))
        return 'contacted';
    return 'new';
}
function nextActionForLead(lead, status) {
    switch (status) {
        case 'new':
            return lead.email || lead.phone ? 'Make first contact within 24h' : 'Confirm a reachable contact';
        case 'contacted':
            return 'Send tailored deal packet and book a call';
        case 'qualified':
            return 'Move to data room / LOI — high intent';
        case 'follow_up':
            return 'Follow-up is due now — reach out today';
        case 'closed':
            return 'Closed — nurture for repeat / referral';
        case 'rejected':
            return 'No action — archived as not a fit';
        default:
            return 'Review lead';
    }
}
function contactString(lead) {
    return [lead.email, lead.phone].filter(Boolean).join(' · ');
}
function topSourceOf(leads) {
    if (leads.length === 0)
        return null;
    const counts = new Map();
    for (const lead of leads) {
        const key = (lead.campaign || lead.source || 'unknown').trim() || 'unknown';
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = null;
    let bestCount = -1;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    }
    return best;
}
function bestCandidate(leads, role) {
    const inRole = leads.filter((l) => l.role === role);
    if (inRole.length === 0)
        return null;
    const best = inRole.reduce((a, b) => (b.leadScore > a.leadScore ? b : a));
    return {
        id: best.id,
        name: best.name,
        leadScore: best.leadScore,
        temperature: best.temperature,
        contact: contactString(best),
        interest: best.dealInterest || best.preferredMarket || '',
    };
}
function dailyRecommendations(day) {
    const recs = [];
    if (day.followUpRequired > 0)
        recs.push(`${day.followUpRequired} follow-up(s) due — contact today`);
    if (day.hotLeads > 0)
        recs.push(`${day.hotLeads} hot lead(s) — send deal packet now`);
    if (day.qualifiedLeads > 0)
        recs.push(`${day.qualifiedLeads} qualified — push toward LOI / data room`);
    if (day.totalLeads === 0)
        recs.push('No leads captured — amplify landing-page distribution');
    if (recs.length === 0)
        recs.push('Nurture new leads and confirm contacts');
    return recs;
}
/**
 * Build the full 10-day campaign report from real captured leads.
 * The window is the last `windowDays` calendar days ending today (UTC).
 */
export async function buildCampaignReport(windowDays = CAMPAIGN_WINDOW_DAYS) {
    const days = Math.max(1, Math.min(60, Math.round(windowDays)));
    const allLeads = await listLeads();
    // Window boundaries (UTC day buckets).
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    const startKey = startDate.toISOString().slice(0, 10);
    const inWindow = allLeads.filter((l) => dayKey(l.createdAt) >= startKey);
    // Pre-bucket leads by their creation day.
    const byDay = new Map();
    for (const lead of inWindow) {
        const key = dayKey(lead.createdAt);
        const bucket = byDay.get(key);
        if (bucket)
            bucket.push(lead);
        else
            byDay.set(key, [lead]);
    }
    const dailyReports = [];
    for (let i = 0; i < days; i += 1) {
        const d = new Date(startDate);
        d.setUTCDate(startDate.getUTCDate() + i);
        const key = d.toISOString().slice(0, 10);
        const dayLeads = byDay.get(key) ?? [];
        const qualified = dayLeads.filter((l) => statusForLead(l) === 'qualified').length;
        const hot = dayLeads.filter((l) => l.temperature === 'hot' || l.temperature === 'qualified').length;
        const followUp = dayLeads.filter((l) => statusForLead(l) === 'follow_up').length;
        const report = {
            date: key,
            dayNumber: i + 1,
            isToday: key === todayKey,
            totalLeads: dayLeads.length,
            buyerLeads: dayLeads.filter((l) => l.role === 'buyer').length,
            jvLeads: dayLeads.filter((l) => l.role === 'jv_partner').length,
            investorLeads: dayLeads.filter((l) => l.role === 'investor').length,
            qualifiedLeads: qualified,
            hotLeads: hot,
            followUpRequired: followUp,
            conversionRatePct: dayLeads.length > 0 ? Math.round((qualified / dayLeads.length) * 100) : 0,
            topSource: topSourceOf(dayLeads),
            recommendedNextActions: [],
        };
        report.recommendedNextActions = dailyRecommendations(report);
        dailyReports.push(report);
    }
    const leadViews = inWindow.map((lead) => {
        const status = statusForLead(lead);
        return {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            company: lead.sourceDetail && /company/i.test(lead.sourceDetail) ? lead.sourceDetail : '',
            role: lead.role,
            audience: audienceForRole(lead.role),
            budgetRange: lead.budgetRange,
            interest: lead.dealInterest || lead.preferredMarket || lead.relatedDeal || '',
            leadScore: lead.leadScore,
            temperature: lead.temperature,
            status,
            source: lead.campaign || lead.source,
            notes: lead.notes,
            nextAction: nextActionForLead(lead, status),
            followUpDueAt: lead.followUpDueAt,
            createdAt: lead.createdAt,
            updatedAt: lead.updatedAt,
        };
    });
    const qualifiedTotal = leadViews.filter((l) => l.status === 'qualified').length;
    const totals = {
        totalLeads: inWindow.length,
        buyerLeads: inWindow.filter((l) => l.role === 'buyer').length,
        jvLeads: inWindow.filter((l) => l.role === 'jv_partner').length,
        investorLeads: inWindow.filter((l) => l.role === 'investor').length,
        otherLeads: inWindow.filter((l) => audienceForRole(l.role) === 'other').length,
        qualifiedLeads: qualifiedTotal,
        hotLeads: inWindow.filter((l) => l.temperature === 'hot' || l.temperature === 'qualified').length,
        followUpRequired: leadViews.filter((l) => l.status === 'follow_up').length,
        closedLeads: leadViews.filter((l) => l.status === 'closed').length,
        rejectedLeads: leadViews.filter((l) => l.status === 'rejected').length,
        conversionRatePct: inWindow.length > 0 ? Math.round((qualifiedTotal / inWindow.length) * 100) : 0,
        topSource: topSourceOf(inWindow),
    };
    const recommendedDeals = Array.from(new Set(inWindow
        .map((l) => (l.dealInterest || l.relatedDeal).trim())
        .filter((v) => v.length > 0))).slice(0, 8);
    const next30DayActionPlan = buildNext30DayPlan(totals);
    const finalSummary = {
        totalLeads: inWindow.length,
        bestSource: totals.topSource,
        bestInvestor: bestCandidate(inWindow, 'investor'),
        bestBuyer: bestCandidate(inWindow, 'buyer'),
        bestJv: bestCandidate(inWindow, 'jv_partner'),
        recommendedDeals,
        next30DayActionPlan,
    };
    return {
        marker: IVX_CAMPAIGN_MARKER,
        title: IVX_CAMPAIGN_TITLE,
        generatedAt: nowIso(),
        windowDays: days,
        campaignStartDate: startKey,
        campaignEndDate: todayKey,
        visitorsTracked: false,
        visitorsNote: 'Visitor / page-view analytics are not instrumented on this platform, so traffic counts are intentionally omitted rather than fabricated. Only real captured leads are reported.',
        totals,
        dailyReports,
        leads: leadViews,
        finalSummary,
    };
}
function buildNext30DayPlan(totals) {
    const plan = [];
    if (totals.followUpRequired > 0) {
        plan.push(`Clear ${totals.followUpRequired} overdue follow-up(s) in the next 48 hours.`);
    }
    if (totals.qualifiedLeads > 0) {
        plan.push(`Advance ${totals.qualifiedLeads} qualified lead(s) into data room / LOI conversations.`);
    }
    if (totals.hotLeads > 0) {
        plan.push(`Send tailored deal packets to ${totals.hotLeads} hot lead(s) this week.`);
    }
    if (totals.totalLeads === 0) {
        plan.push('Drive traffic to the landing page — no leads captured yet in this window.');
    }
    else {
        plan.push('Double down on the top-performing lead source and retire underperforming channels.');
    }
    plan.push('Re-score the pipeline weekly and prune cold leads to keep the funnel honest.');
    return plan;
}
