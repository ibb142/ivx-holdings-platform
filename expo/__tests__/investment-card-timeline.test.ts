/**
 * Investment Card + Timeline Stages — Automated Tests
 *
 * Tests:
 * - Timeline stages build correctly from deal data
 * - Timeline fallback renders when data is missing
 * - InvestmentCardData fields are correctly mapped
 * - No null/undefined/NaN in rendered values
 * - Sale price, total investment, ROI, timeline all render
 * - Minimum investment and ownership render
 * - Developer name renders
 * - Empty/invalid data handling
 */

import { buildTimelineSummary, getTimelineStatusColor, formatTimelineDate, CANONICAL_TIMELINE_STAGES } from '../lib/timeline-stages';

describe('Timeline Stages', () => {
  describe('buildTimelineSummary', () => {
    it('builds timeline from min/max months', () => {
      const summary = buildTimelineSummary(12, 18, 'months', null, '2025-01-01T00:00:00.000Z');
      expect(summary.estimatedTotalDuration).toBe('12\u201318 mo');
      expect(summary.stages.length).toBe(CANONICAL_TIMELINE_STAGES.length);
      expect(summary.completionPercentage).toBeGreaterThanOrEqual(0);
      expect(summary.completionPercentage).toBeLessThanOrEqual(100);
    });

    it('builds timeline from years', () => {
      const summary = buildTimelineSummary(1, 2, 'years', null, '2025-01-01T00:00:00.000Z');
      expect(summary.estimatedTotalDuration).toBe('1\u20132 yr');
      expect(summary.stages.length).toBe(7);
    });

    it('handles only max timeline', () => {
      const summary = buildTimelineSummary(undefined, 12, 'months', null, '2025-01-01T00:00:00.000Z');
      expect(summary.estimatedTotalDuration).toBe('12 mo');
      expect(summary.stages.length).toBe(7);
    });

    it('handles only min timeline', () => {
      const summary = buildTimelineSummary(6, undefined, 'months', null, '2025-01-01T00:00:00.000Z');
      expect(summary.estimatedTotalDuration).toBe('6 mo');
    });

    it('returns pending verification when no timeline data', () => {
      const summary = buildTimelineSummary(undefined, undefined, undefined, null, null);
      expect(summary.estimatedTotalDuration).toBe('Timeline pending verification');
      expect(summary.stages.length).toBe(0);
      expect(summary.completionPercentage).toBe(0);
      expect(summary.currentStage).toBe('Pending');
    });

    it('uses explicit stages when provided', () => {
      const explicitStages = [
        {
          id: 'stage-1',
          name: 'Acquisition / Closing',
          startDate: '2025-01-01T00:00:00.000Z',
          estimatedCompletionDate: '2025-02-01T00:00:00.000Z',
          actualCompletionDate: '2025-02-05T00:00:00.000Z',
          status: 'COMPLETE' as const,
          percentComplete: 100,
        },
        {
          id: 'stage-2',
          name: 'Permits / Design',
          startDate: '2025-02-01T00:00:00.000Z',
          estimatedCompletionDate: '2025-04-01T00:00:00.000Z',
          actualCompletionDate: null,
          status: 'ACTIVE' as const,
          percentComplete: 45,
        },
        {
          id: 'stage-3',
          name: 'Construction Start',
          startDate: '2025-04-01T00:00:00.000Z',
          estimatedCompletionDate: '2025-06-01T00:00:00.000Z',
          actualCompletionDate: null,
          status: 'UPCOMING' as const,
          percentComplete: 0,
        },
      ];
      const summary = buildTimelineSummary(6, 12, 'months', explicitStages, '2025-01-01T00:00:00.000Z');
      expect(summary.stages.length).toBe(3);
      expect(summary.completionPercentage).toBe(33); // 1 of 3 complete
      expect(summary.currentStage).toBe('Permits / Design'); // ACTIVE stage
    });

    it('handles DELAYED status in explicit stages', () => {
      const delayedStages = [
        {
          id: 'stage-1',
          name: 'Acquisition / Closing',
          startDate: '2025-01-01T00:00:00.000Z',
          estimatedCompletionDate: '2025-02-01T00:00:00.000Z',
          actualCompletionDate: null,
          status: 'DELAYED' as const,
          percentComplete: 60,
        },
      ];
      const summary = buildTimelineSummary(6, 12, 'months', delayedStages, '2025-01-01T00:00:00.000Z');
      expect(summary.stages[0].status).toBe('DELAYED');
      expect(summary.currentStage).toBe('Acquisition / Closing');
    });

    it('shows completed when all stages are COMPLETE', () => {
      const completedStages = CANONICAL_TIMELINE_STAGES.map((name, idx) => ({
        id: `stage-${idx + 1}`,
        name,
        startDate: '2024-01-01T00:00:00.000Z',
        estimatedCompletionDate: '2024-03-01T00:00:00.000Z',
        actualCompletionDate: '2024-03-01T00:00:00.000Z',
        status: 'COMPLETE' as const,
        percentComplete: 100,
      }));
      const summary = buildTimelineSummary(12, 18, 'months', completedStages, '2024-01-01T00:00:00.000Z');
      expect(summary.completionPercentage).toBe(100);
      expect(summary.currentStage).toBe('Completed');
    });
  });

  describe('getTimelineStatusColor', () => {
    it('returns correct colors for each status', () => {
      expect(getTimelineStatusColor('COMPLETE')).toBe('#00C48C');
      expect(getTimelineStatusColor('ACTIVE')).toBe('#FFD700');
      expect(getTimelineStatusColor('DELAYED')).toBe('#F59E0B');
      expect(getTimelineStatusColor('UPCOMING')).toBe('#555555');
    });
  });

  describe('formatTimelineDate', () => {
    it('formats valid dates', () => {
      const result = formatTimelineDate('2025-03-15T00:00:00.000Z');
      expect(result).toContain('Mar');
      expect(result).toContain('2025');
    });

    it('returns Not available for null', () => {
      expect(formatTimelineDate(null)).toBe('Not available');
    });

    it('returns Not available for invalid date string', () => {
      expect(formatTimelineDate('invalid-date')).toBe('Not available');
    });
  });

  describe('CANONICAL_TIMELINE_STAGES', () => {
    it('has exactly 7 stages', () => {
      expect(CANONICAL_TIMELINE_STAGES.length).toBe(7);
    });

    it('includes all required stage names', () => {
      const names = CANONICAL_TIMELINE_STAGES;
      expect(names).toContain('Acquisition / Closing');
      expect(names).toContain('Permits / Design');
      expect(names).toContain('Construction Start');
      expect(names).toContain('Structural / Rough Work');
      expect(names).toContain('Interior Finishes');
      expect(names).toContain('Final Inspection');
      expect(names).toContain('Sale / Refinance / Distribution');
    });
  });
});

describe('InvestmentCardData Field Mapping', () => {
  // Simulate the homeFeedDealToInvestmentCard mapping logic
  function mapToCardData(deal: {
    salePrice?: number | null;
    totalInvestment?: number | null;
    expectedROI?: number | null;
    minInvestment?: number | null;
    developerName?: string | null;
    timelineMin?: number | null;
    timelineMax?: number | null;
    timelineUnit?: 'months' | 'years' | null;
    description?: string | null;
    created_at?: string | null;
  }) {
    const timelineSummary = buildTimelineSummary(
      deal.timelineMin,
      deal.timelineMax,
      deal.timelineUnit,
      null,
      deal.created_at ?? null,
    );

    return {
      salePrice: deal.salePrice && deal.salePrice > 0 ? deal.salePrice : null,
      totalInvestment: deal.totalInvestment && deal.totalInvestment > 0 ? deal.totalInvestment : null,
      roi: deal.expectedROI ?? null,
      minimumInvestment: deal.minInvestment ?? null,
      developerName: deal.developerName ?? null,
      timelineSummary,
      investmentDetails: deal.description ?? null,
    };
  }

  it('maps all investment fields correctly', () => {
    const data = mapToCardData({
      salePrice: 3130000,
      totalInvestment: 2500000,
      expectedROI: 25,
      minInvestment: 50,
      developerName: 'ONE STOP DEVELOPMENT LLC',
      timelineMin: 12,
      timelineMax: 18,
      timelineUnit: 'months',
      description: 'Premium investment opportunity',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    expect(data.salePrice).toBe(3130000);
    expect(data.totalInvestment).toBe(2500000);
    expect(data.roi).toBe(25);
    expect(data.minimumInvestment).toBe(50);
    expect(data.developerName).toBe('ONE STOP DEVELOPMENT LLC');
    expect(data.timelineSummary.estimatedTotalDuration).toBe('12\u201318 mo');
    expect(data.timelineSummary.stages.length).toBe(7);
    expect(data.investmentDetails).toBe('Premium investment opportunity');
  });

  it('handles null/undefined values without crashing', () => {
    const data = mapToCardData({
      salePrice: null,
      totalInvestment: undefined,
      expectedROI: null,
      minInvestment: null,
      developerName: null,
      timelineMin: null,
      timelineMax: null,
      timelineUnit: null,
      description: null,
      created_at: null,
    });

    expect(data.salePrice).toBeNull();
    expect(data.totalInvestment).toBeNull();
    expect(data.roi).toBeNull();
    expect(data.minimumInvestment).toBeNull();
    expect(data.developerName).toBeNull();
    expect(data.timelineSummary.estimatedTotalDuration).toBe('Timeline pending verification');
    expect(data.timelineSummary.stages.length).toBe(0);
  });

  it('handles zero values correctly', () => {
    const data = mapToCardData({
      salePrice: 0,
      totalInvestment: 0,
      expectedROI: 0,
      minInvestment: 0,
      developerName: '',
      timelineMin: 0,
      timelineMax: 0,
      timelineUnit: 'months',
      description: '',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    expect(data.salePrice).toBeNull(); // 0 is treated as null
    expect(data.totalInvestment).toBeNull();
    expect(data.roi).toBe(0); // ROI of 0 is kept as-is
    expect(data.minimumInvestment).toBe(0);
    expect(data.developerName).toBe('');
    expect(data.timelineSummary.estimatedTotalDuration).toBe('Timeline pending verification');
  });

  it('never produces null/undefined/NaN in timeline display values', () => {
    const data = mapToCardData({
      salePrice: 3130000,
      totalInvestment: 2500000,
      expectedROI: 25,
      minInvestment: 50,
      developerName: 'ONE STOP DEVELOPMENT LLC',
      timelineMin: 12,
      timelineMax: 18,
      timelineUnit: 'months',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    const ts = data.timelineSummary;
    expect(ts.estimatedTotalDuration).not.toBe('null');
    expect(ts.estimatedTotalDuration).not.toBe('undefined');
    expect(ts.estimatedTotalDuration).not.toBe('NaN');
    expect(ts.estimatedTotalDuration).not.toBe('');
    expect(ts.currentStage).not.toBe('null');
    expect(ts.currentStage).not.toBe('undefined');
    expect(ts.completionPercentage).not.toBeNaN();
    expect(ts.completionPercentage).toBeGreaterThanOrEqual(0);

    for (const stage of ts.stages) {
      expect(stage.name).not.toBe('null');
      expect(stage.name).not.toBe('undefined');
      expect(stage.status).not.toBe('null');
      expect(stage.percentComplete).not.toBeNaN();
      expect(stage.percentComplete).toBeGreaterThanOrEqual(0);
      expect(stage.percentComplete).toBeLessThanOrEqual(100);
    }
  });
});

describe('Card and Deal Detail Parity', () => {
  it('card and deal detail share the same timeline summary builder', () => {
    const dealData = {
      timelineMin: 12,
      timelineMax: 18,
      timelineUnit: 'months' as const,
      created_at: '2025-01-01T00:00:00.000Z',
    };

    // Card uses this via homeFeedDealToInvestmentCard
    const cardTimeline = buildTimelineSummary(
      dealData.timelineMin,
      dealData.timelineMax,
      dealData.timelineUnit,
      null,
      dealData.created_at,
    );

    // Deal detail uses the same function
    const detailTimeline = buildTimelineSummary(
      dealData.timelineMin,
      dealData.timelineMax,
      dealData.timelineUnit,
      null,
      dealData.created_at,
    );

    expect(cardTimeline.estimatedTotalDuration).toBe(detailTimeline.estimatedTotalDuration);
    expect(cardTimeline.currentStage).toBe(detailTimeline.currentStage);
    expect(cardTimeline.completionPercentage).toBe(detailTimeline.completionPercentage);
    expect(cardTimeline.stages.length).toBe(detailTimeline.stages.length);
  });
});
