/**
 * IVX Timeline Stages — canonical stage model and summary builder.
 *
 * Used by InvestmentCard, landing page, and published-deal-card-model.
 */

export type TimelineStageStatus = 'COMPLETE' | 'ACTIVE' | 'DELAYED' | 'UPCOMING';

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
  stages: TimelineStage[];
  completionPercentage: number;
  currentStage: string;
  estimatedTotalDuration: string;
  estimatedCompletionDate?: string | null;
}

/** The 7 canonical IVX project timeline stages. */
export const CANONICAL_TIMELINE_STAGES: readonly string[] = [
  'Acquisition / Closing',
  'Permits / Design',
  'Construction Start',
  'Structural / Rough Work',
  'Interior Finishes',
  'Final Inspection',
  'Sale / Refinance / Distribution',
] as const;

const STATUS_COLORS: Record<TimelineStageStatus, string> = {
  COMPLETE: '#00C48C',
  ACTIVE: '#FFD700',
  DELAYED: '#F59E0B',
  UPCOMING: '#555555',
};

/** Returns the hex color for a timeline stage status. */
export function getTimelineStatusColor(status: TimelineStageStatus): string {
  return STATUS_COLORS[status] ?? '#555555';
}

/** Formats an ISO date string for display, or returns "Not available". */
export function formatTimelineDate(date: string | null): string {
  if (!date) return 'Not available';
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return 'Not available';
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Raw stage shape as it may arrive from the backend / deal data. */
interface RawStage {
  id?: string;
  name?: string;
  startDate?: string | null;
  estimatedCompletionDate?: string | null;
  actualCompletionDate?: string | null;
  status?: string;
  percentComplete?: number;
}

/**
 * Builds a TimelineSummary from deal timeline data.
 *
 * If explicit stages are provided, they are used directly.
 * Otherwise, canonical stages are generated with evenly distributed dates.
 */
export function buildTimelineSummary(
  timelineMin: number | undefined,
  timelineMax: number | undefined,
  timelineUnit: 'months' | 'years' | undefined,
  explicitStages: RawStage[] | null,
  publishedAt: string | null,
): TimelineSummary {
  // Build duration label — treat 0 as "no data" (same as null/undefined)
  const hasMin = timelineMin != null && timelineMin > 0;
  const hasMax = timelineMax != null && timelineMax > 0;
  let estimatedTotalDuration: string;
  if (!hasMin && !hasMax) {
    estimatedTotalDuration = 'Timeline pending verification';
  } else if (hasMin && hasMax && timelineMin !== timelineMax) {
    const unit = timelineUnit === 'years' ? 'yr' : 'mo';
    estimatedTotalDuration = `${timelineMin}\u2013${timelineMax} ${unit}`;
  } else {
    const val = timelineMin ?? timelineMax;
    const unit = timelineUnit === 'years' ? 'yr' : 'mo';
    estimatedTotalDuration = `${val} ${unit}`;
  }

  // If no timeline data at all, return pending state
  if (!hasMin && !hasMax && !explicitStages) {
    return {
      stages: [],
      completionPercentage: 0,
      currentStage: 'Pending',
      estimatedTotalDuration,
    };
  }

  // Use explicit stages if provided
  if (explicitStages && explicitStages.length > 0) {
    const stages: TimelineStage[] = explicitStages.map((raw, idx) => {
      const status = normalizeStatus(raw.status);
      return {
        id: raw.id ?? `stage-${idx + 1}`,
        name: raw.name ?? CANONICAL_TIMELINE_STAGES[idx] ?? `Stage ${idx + 1}`,
        startDate: raw.startDate ?? null,
        estimatedCompletionDate: raw.estimatedCompletionDate ?? null,
        actualCompletionDate: raw.actualCompletionDate ?? null,
        status,
        percentComplete: raw.percentComplete ?? (status === 'COMPLETE' ? 100 : 0),
      };
    });

    const completedCount = stages.filter((s) => s.status === 'COMPLETE').length;
    const completionPercentage = Math.round((completedCount / stages.length) * 100);

    const activeStage = stages.find((s) => s.status === 'ACTIVE' || s.status === 'DELAYED');
    const currentStage = activeStage?.name
      ?? (completionPercentage === 100 ? 'Completed' : 'Pending');

    return {
      stages,
      completionPercentage,
      currentStage,
      estimatedTotalDuration,
    };
  }

  // Generate canonical stages with evenly distributed dates
  const totalMonths = (hasMax ? timelineMax! : hasMin ? timelineMin! : 12) * (timelineUnit === 'years' ? 12 : 1);
  const stageCount = CANONICAL_TIMELINE_STAGES.length;
  const monthsPerStage = Math.max(1, Math.round(totalMonths / stageCount));
  const baseDate = publishedAt ? new Date(publishedAt) : new Date();

  const stages: TimelineStage[] = CANONICAL_TIMELINE_STAGES.map((name, idx) => {
    const stageStart = new Date(baseDate);
    stageStart.setMonth(stageStart.getMonth() + idx * monthsPerStage);
    const stageEnd = new Date(stageStart);
    stageEnd.setMonth(stageEnd.getMonth() + monthsPerStage);

    const now = new Date();
    let status: TimelineStageStatus;
    if (stageEnd < now) {
      status = 'COMPLETE';
    } else if (stageStart <= now && now <= stageEnd) {
      status = 'ACTIVE';
    } else {
      status = 'UPCOMING';
    }

    return {
      id: `stage-${idx + 1}`,
      name,
      startDate: stageStart.toISOString(),
      estimatedCompletionDate: stageEnd.toISOString(),
      actualCompletionDate: status === 'COMPLETE' ? stageEnd.toISOString() : null,
      status,
      percentComplete: status === 'COMPLETE' ? 100 : status === 'ACTIVE' ? 50 : 0,
    };
  });

  const completedCount = stages.filter((s) => s.status === 'COMPLETE').length;
  const completionPercentage = Math.round((completedCount / stages.length) * 100);
  const activeStage = stages.find((s) => s.status === 'ACTIVE');
  const currentStage = activeStage?.name
    ?? (completionPercentage === 100 ? 'Completed' : 'Pending');

  return {
    stages,
    completionPercentage,
    currentStage,
    estimatedTotalDuration,
  };
}

/** Normalizes a raw status string to a TimelineStageStatus. */
function normalizeStatus(raw: string | undefined): TimelineStageStatus {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'COMPLETE' || upper === 'COMPLETED' || upper === 'DONE') return 'COMPLETE';
  if (upper === 'ACTIVE' || upper === 'IN_PROGRESS' || upper === 'IN PROGRESS') return 'ACTIVE';
  if (upper === 'DELAYED' || upper === 'LATE') return 'DELAYED';
  return 'UPCOMING';
}

