/**
 * Investment Timeline Stages — canonical data model for project timelines.
 *
 * Each deal can have up to 7 standard stages with status tracking.
 * Used by InvestmentCard (summary), Deal Detail (full), and landing page.
 */

export type TimelineStageStatus = 'UPCOMING' | 'ACTIVE' | 'DELAYED' | 'COMPLETE';

export interface TimelineStage {
  id: string;
  name: string;
  startDate: string | null;
  estimatedCompletionDate: string | null;
  actualCompletionDate: string | null;
  status: TimelineStageStatus;
  percentComplete: number;
  note?: string | null;
}

export interface TimelineSummary {
  estimatedTotalDuration: string;
  currentStage: string;
  completionPercentage: number;
  estimatedCompletionDate: string | null;
  stages: TimelineStage[];
}

/** The 7 canonical project timeline stages in order. */
export const CANONICAL_TIMELINE_STAGES: readonly string[] = [
  'Acquisition / Closing',
  'Permits / Design',
  'Construction Start',
  'Structural / Rough Work',
  'Interior Finishes',
  'Final Inspection',
  'Sale / Refinance / Distribution',
] as const;

/**
 * Build a timeline summary from deal trust info and raw deal data.
 * Falls back to estimated stages based on timeline duration when no
 * explicit stages are provided.
 */
export function buildTimelineSummary(
  timelineMin: number | undefined,
  timelineMax: number | undefined,
  timelineUnit: 'months' | 'years' | undefined,
  rawStages?: TimelineStage[] | null,
  dealCreatedAt?: string | null,
): TimelineSummary {
  // If explicit stages are provided, use them
  if (rawStages && Array.isArray(rawStages) && rawStages.length > 0) {
    const stages = rawStages;
    const activeStage = stages.find(s => s.status === 'ACTIVE' || s.status === 'DELAYED');
    const completedCount = stages.filter(s => s.status === 'COMPLETE').length;
    const completionPercentage = Math.round((completedCount / stages.length) * 100);
    const min = timelineMin ?? 0;
    const max = timelineMax ?? 0;
    const unit = timelineUnit === 'years' ? 'yr' : 'mo';
    const durationLabel = min > 0 && max > 0
      ? `${min}\u2013${max} ${unit}`
      : max > 0 ? `${max} ${unit}` : min > 0 ? `${min} ${unit}` : 'Pending';

    const lastEstDate = stages
      .map(s => s.estimatedCompletionDate)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    return {
      estimatedTotalDuration: durationLabel,
      currentStage: activeStage?.name ?? (completedCount === stages.length ? 'Completed' : 'Pending'),
      completionPercentage,
      estimatedCompletionDate: lastEstDate,
      stages,
    };
  }

  // Build estimated stages from timeline duration
  const min = timelineMin ?? 0;
  const max = timelineMax ?? 0;
  const unit = timelineUnit === 'years' ? 'yr' : 'mo';
  const durationLabel = min > 0 && max > 0
    ? `${min}\u2013${max} ${unit}`
    : max > 0 ? `${max} ${unit}` : min > 0 ? `${min} ${unit}` : '';

  // If no timeline data at all, return empty summary
  if (!durationLabel) {
    return {
      estimatedTotalDuration: 'Timeline pending verification',
      currentStage: 'Pending',
      completionPercentage: 0,
      estimatedCompletionDate: null,
      stages: [],
    };
  }

  // Generate estimated stages evenly distributed across the timeline
  const totalMonths = (max > 0 ? max : min) * (timelineUnit === 'years' ? 12 : 1);
  const startDate = dealCreatedAt ? new Date(dealCreatedAt) : new Date();
  const monthsPerStage = Math.max(1, Math.floor(totalMonths / CANONICAL_TIMELINE_STAGES.length));

  const stages: TimelineStage[] = CANONICAL_TIMELINE_STAGES.map((name, idx) => {
    const stageStart = new Date(startDate);
    stageStart.setMonth(stageStart.getMonth() + idx * monthsPerStage);
    const stageEnd = new Date(stageStart);
    stageEnd.setMonth(stageEnd.getMonth() + monthsPerStage);

    const now = new Date();
    let status: TimelineStageStatus = 'UPCOMING';
    let percentComplete = 0;

    if (stageEnd < now) {
      status = 'COMPLETE';
      percentComplete = 100;
    } else if (stageStart <= now && stageEnd >= now) {
      const totalDuration = stageEnd.getTime() - stageStart.getTime();
      const elapsed = now.getTime() - stageStart.getTime();
      percentComplete = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
      status = 'ACTIVE';
    }

    return {
      id: `stage-${idx + 1}`,
      name,
      startDate: stageStart.toISOString(),
      estimatedCompletionDate: stageEnd.toISOString(),
      actualCompletionDate: status === 'COMPLETE' ? stageEnd.toISOString() : null,
      status,
      percentComplete,
    };
  });

  const activeStage = stages.find(s => s.status === 'ACTIVE');
  const completedCount = stages.filter(s => s.status === 'COMPLETE').length;
  const completionPercentage = Math.round((completedCount / stages.length) * 100);
  const lastEstDate = stages
    .map(s => s.estimatedCompletionDate)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    estimatedTotalDuration: durationLabel,
    currentStage: activeStage?.name ?? (completedCount === stages.length ? 'Completed' : 'Pending'),
    completionPercentage,
    estimatedCompletionDate: lastEstDate,
    stages,
  };
}

/** Format a timeline stage status with appropriate color label. */
export function getTimelineStatusColor(status: TimelineStageStatus): string {
  switch (status) {
    case 'COMPLETE': return '#00C48C';
    case 'ACTIVE': return '#FFD700';
    case 'DELAYED': return '#F59E0B';
    case 'UPCOMING': return '#555555';
    default: return '#555555';
  }
}

/** Format a date string for display (Mon DD, YYYY). */
export function formatTimelineDate(dateStr: string | null): string {
  if (!dateStr) return 'Not available';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Not available';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Not available';
  }
}
