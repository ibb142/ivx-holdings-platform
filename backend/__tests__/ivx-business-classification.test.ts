/**
 * IVX Business-Data Classification — GATE 2 tests.
 *
 * Covers all 7 required acceptance tests:
 *   1. DISCOVERED cannot jump directly to FUNDED
 *   2. Draft cannot appear as SENT
 *   3. Funding target cannot appear as committed capital
 *   4. TEST records are excluded from production totals
 *   5. DUPLICATE records are excluded
 *   6. DO_NOT_CONTACT records cannot enter outreach
 *   7. Every total reconciles with source records
 */
import {
  describe, test, expect, beforeEach,
} from 'bun:test';
import {
  isTransitionAllowed,
  assertValidTransition,
  isProductionTotalEligible,
  isTestRecord,
  isDuplicateRecord,
  canEnterOutreach,
  separateFundingTargetFromCommitted,
  reconcileTotal,
  outreachStageNotSent,
  ALLOWED_TRANSITIONS,
  ALL_BUSINESS_STATUSES,
  PIPELINE_STATUSES,
  QUARANTINE_STATUSES,
  type BusinessStatus,
} from '../services/ivx-business-classification';

describe('GATE 2 — Business-Data Classification', () => {

  describe('14 mandatory classifications', () => {
    test('all 14 statuses are defined', () => {
      expect(ALL_BUSINESS_STATUSES.length).toBe(14);
      const expected: BusinessStatus[] = [
        'DISCOVERED', 'CONTACT_VERIFIED', 'OWNER_APPROVED_FOR_OUTREACH',
        'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'QUALIFIED',
        'COMMITTED', 'FUNDED', 'INVALID', 'DUPLICATE', 'TEST', 'DO_NOT_CONTACT',
      ];
      expect(ALL_BUSINESS_STATUSES).toEqual(expected);
    });

    test('pipeline statuses are the 10 funnel stages', () => {
      expect(PIPELINE_STATUSES.length).toBe(10);
      expect(PIPELINE_STATUSES[0]).toBe('DISCOVERED');
      expect(PIPELINE_STATUSES[PIPELINE_STATUSES.length - 1]).toBe('FUNDED');
    });

    test('quarantine statuses are the 4 excluded stages', () => {
      expect(QUARANTINE_STATUSES.length).toBe(4);
      expect(QUARANTINE_STATUSES).toContain('TEST');
      expect(QUARANTINE_STATUSES).toContain('DUPLICATE');
      expect(QUARANTINE_STATUSES).toContain('DO_NOT_CONTACT');
      expect(QUARANTINE_STATUSES).toContain('INVALID');
    });
  });

  // ─── REQUIRED TEST 1: DISCOVERED cannot jump directly to FUNDED ───
  describe('REQUIRED TEST 1: DISCOVERED cannot jump directly to FUNDED', () => {
    test('DISCOVERED → FUNDED is rejected', () => {
      expect(isTransitionAllowed('DISCOVERED', 'FUNDED')).toBe(false);
      expect(() => assertValidTransition('DISCOVERED', 'FUNDED')).toThrow();
    });

    test('DISCOVERED → COMMITTED is rejected', () => {
      expect(isTransitionAllowed('DISCOVERED', 'COMMITTED')).toBe(false);
      expect(() => assertValidTransition('DISCOVERED', 'COMMITTED')).toThrow();
    });

    test('DISCOVERED → QUALIFIED is rejected', () => {
      expect(isTransitionAllowed('DISCOVERED', 'QUALIFIED')).toBe(false);
      expect(() => assertValidTransition('DISCOVERED', 'QUALIFIED')).toThrow();
    });

    test('DISCOVERED → INTERESTED is rejected', () => {
      expect(isTransitionAllowed('DISCOVERED', 'INTERESTED')).toBe(false);
      expect(() => assertValidTransition('DISCOVERED', 'INTERESTED')).toThrow();
    });

    test('DISCOVERED → CONTACTED is rejected (discovered is not contacted)', () => {
      expect(isTransitionAllowed('DISCOVERED', 'CONTACTED')).toBe(false);
      expect(() => assertValidTransition('DISCOVERED', 'CONTACTED')).toThrow(/Discovered is not contacted/);
    });

    test('DISCOVERED → CONTACT_VERIFIED is allowed', () => {
      expect(isTransitionAllowed('DISCOVERED', 'CONTACT_VERIFIED')).toBe(true);
    });

    test('error message names the violated rule', () => {
      try {
        assertValidTransition('DISCOVERED', 'FUNDED');
        expect(true).toBe(false); // should not reach
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        expect(msg).toContain('Invalid transition: DISCOVERED → FUNDED');
      }
    });

    test('full forward pipeline path is allowed step by step', () => {
      const path: BusinessStatus[] = [
        'DISCOVERED', 'CONTACT_VERIFIED', 'OWNER_APPROVED_FOR_OUTREACH',
        'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'QUALIFIED',
        'COMMITTED', 'FUNDED',
      ];
      for (let i = 0; i < path.length - 1; i++) {
        expect(isTransitionAllowed(path[i], path[i + 1])).toBe(true);
      }
    });
  });

  // ─── REQUIRED TEST 2: Draft cannot appear as SENT ───
  describe('REQUIRED TEST 2: Draft cannot appear as SENT', () => {
    test('draft count and sent count are tracked separately', () => {
      const result = outreachStageNotSent(5, 3, 2, 1);
      expect(result.draftAppearsAsSent).toBe(false);
      expect(result.queuedAppearsAsDelivered).toBe(false);
    });

    test('queued outreach is not delivered', () => {
      const result = outreachStageNotSent(10, 8, 5, 3);
      expect(result.queuedAppearsAsDelivered).toBe(false);
    });
  });

  // ─── REQUIRED TEST 3: Funding target cannot appear as committed capital ───
  describe('REQUIRED TEST 3: Funding target cannot appear as committed capital', () => {
    test('funding target and committed capital are tracked separately', () => {
      const records = [
        { id: '1', status: 'QUALIFIED' as BusinessStatus, fundingTarget: 10_000_000, committedCapital: 0 },
        { id: '2', status: 'COMMITTED' as BusinessStatus, fundingTarget: 5_000_000, committedCapital: 2_500_000 },
        { id: '3', status: 'FUNDED' as BusinessStatus, fundingTarget: 5_000_000, committedCapital: 5_000_000 },
      ];
      const result = separateFundingTargetFromCommitted(records);
      expect(result.fundingTargetTotal).toBe(20_000_000);
      expect(result.committedCapitalTotal).toBe(7_500_000);
      expect(result.mismatch).toBe(0);
    });

    test('funding target is not committed capital (they differ)', () => {
      const records = [
        { id: '1', status: 'QUALIFIED' as BusinessStatus, fundingTarget: 100_000_000, committedCapital: 0 },
      ];
      const result = separateFundingTargetFromCommitted(records);
      expect(result.fundingTargetTotal).toBe(100_000_000);
      expect(result.committedCapitalTotal).toBe(0);
      expect(result.fundingTargetTotal).not.toBe(result.committedCapitalTotal);
    });

    test('quarantined records excluded from financial totals', () => {
      const records = [
        { id: '1', status: 'TEST' as BusinessStatus, fundingTarget: 999_999_999, committedCapital: 999_999_999 },
        { id: '2', status: 'DUPLICATE' as BusinessStatus, fundingTarget: 999_999_999, committedCapital: 999_999_999 },
        { id: '3', status: 'QUALIFIED' as BusinessStatus, fundingTarget: 1_000_000, committedCapital: 500_000 },
      ];
      const result = separateFundingTargetFromCommitted(records);
      expect(result.fundingTargetTotal).toBe(1_000_000);
      expect(result.committedCapitalTotal).toBe(500_000);
    });
  });

  // ─── REQUIRED TEST 4: TEST records are excluded from production totals ───
  describe('REQUIRED TEST 4: TEST records are excluded from production totals', () => {
    test('isTestRecord identifies TEST status', () => {
      expect(isTestRecord('TEST')).toBe(true);
      expect(isTestRecord('DISCOVERED')).toBe(false);
      expect(isTestRecord('FUNDED')).toBe(false);
    });

    test('isProductionTotalEligible excludes TEST', () => {
      expect(isProductionTotalEligible('TEST')).toBe(false);
      expect(isProductionTotalEligible('DISCOVERED')).toBe(true);
      expect(isProductionTotalEligible('FUNDED')).toBe(true);
    });

    test('reconcileTotal excludes TEST records', () => {
      const records = [
        { status: 'TEST' as BusinessStatus },
        { status: 'TEST' as BusinessStatus },
        { status: 'DISCOVERED' as BusinessStatus },
        { status: 'QUALIFIED' as BusinessStatus },
      ];
      const result = reconcileTotal(2, records, (r) => isProductionTotalEligible(r.status));
      expect(result.actualTotal).toBe(2);
      expect(result.reconciled).toBe(true);
    });
  });

  // ─── REQUIRED TEST 5: DUPLICATE records are excluded ───
  describe('REQUIRED TEST 5: DUPLICATE records are excluded', () => {
    test('isDuplicateRecord identifies DUPLICATE status', () => {
      expect(isDuplicateRecord('DUPLICATE')).toBe(true);
      expect(isDuplicateRecord('DISCOVERED')).toBe(false);
    });

    test('isProductionTotalEligible excludes DUPLICATE', () => {
      expect(isProductionTotalEligible('DUPLICATE')).toBe(false);
    });

    test('reconcileTotal excludes DUPLICATE records', () => {
      const records = [
        { status: 'DUPLICATE' as BusinessStatus },
        { status: 'DISCOVERED' as BusinessStatus },
        { status: 'QUALIFIED' as BusinessStatus },
        { status: 'FUNDED' as BusinessStatus },
      ];
      const result = reconcileTotal(3, records, (r) => isProductionTotalEligible(r.status));
      expect(result.actualTotal).toBe(3);
      expect(result.reconciled).toBe(true);
    });
  });

  // ─── REQUIRED TEST 6: DO_NOT_CONTACT records cannot enter outreach ───
  describe('REQUIRED TEST 6: DO_NOT_CONTACT records cannot enter outreach', () => {
    test('canEnterOutreach rejects DO_NOT_CONTACT', () => {
      expect(canEnterOutreach('DO_NOT_CONTACT')).toBe(false);
    });

    test('canEnterOutreach rejects INVALID', () => {
      expect(canEnterOutreach('INVALID')).toBe(false);
    });

    test('canEnterOutreach rejects DUPLICATE', () => {
      expect(canEnterOutreach('DUPLICATE')).toBe(false);
    });

    test('canEnterOutreach rejects TEST', () => {
      expect(canEnterOutreach('TEST')).toBe(false);
    });

    test('canEnterOutreach allows OWNER_APPROVED_FOR_OUTREACH', () => {
      expect(canEnterOutreach('OWNER_APPROVED_FOR_OUTREACH')).toBe(true);
    });

    test('canEnterOutreach allows CONTACT_VERIFIED', () => {
      expect(canEnterOutreach('CONTACT_VERIFIED')).toBe(true);
    });

    test('DO_NOT_CONTACT → OWNER_APPROVED_FOR_OUTREACH is not in allowed transitions', () => {
      const allowed = ALLOWED_TRANSITIONS.DO_NOT_CONTACT ?? [];
      expect(allowed).not.toContain('OWNER_APPROVED_FOR_OUTREACH');
    });
  });

  // ─── REQUIRED TEST 7: Every total reconciles with source records ───
  describe('REQUIRED TEST 7: Every total reconciles with source records', () => {
    test('reconcileTotal returns reconciled=true when claimed matches actual', () => {
      const records = [
        { status: 'DISCOVERED' as BusinessStatus },
        { status: 'CONTACTED' as BusinessStatus },
        { status: 'QUALIFIED' as BusinessStatus },
      ];
      const result = reconcileTotal(3, records, (r) => isProductionTotalEligible(r.status));
      expect(result.reconciled).toBe(true);
      expect(result.actualTotal).toBe(3);
      expect(result.sourceRecordCount).toBe(3);
    });

    test('reconcileTotal returns reconciled=false when claimed does not match', () => {
      const records = [
        { status: 'DISCOVERED' as BusinessStatus },
        { status: 'TEST' as BusinessStatus },
      ];
      const result = reconcileTotal(2, records, (r) => isProductionTotalEligible(r.status));
      expect(result.reconciled).toBe(false);
      expect(result.actualTotal).toBe(1);
      expect(result.claimedTotal).toBe(2);
    });

    test('reconcileTotal exposes sourceRecordCount for audit', () => {
      const records = [
        { status: 'DISCOVERED' as BusinessStatus },
        { status: 'QUALIFIED' as BusinessStatus },
        { status: 'FUNDED' as BusinessStatus },
        { status: 'TEST' as BusinessStatus },
        { status: 'DUPLICATE' as BusinessStatus },
      ];
      const result = reconcileTotal(3, records, (r) => isProductionTotalEligible(r.status));
      expect(result.sourceRecordCount).toBe(5);
      expect(result.actualTotal).toBe(3);
      expect(result.reconciled).toBe(true);
    });
  });

  // ─── Additional transition rule tests ─────────────────────────────
  describe('Transition rules — all stage-separation rules enforced', () => {
    test('Contacted is not interested', () => {
      expect(isTransitionAllowed('CONTACTED', 'INTERESTED')).toBe(false);
      expect(() => assertValidTransition('CONTACTED', 'INTERESTED')).toThrow(/Contacted is not interested/);
    });

    test('Interested is not qualified — INTERESTED cannot skip to COMMITTED', () => {
      // Interested → Qualified is the correct next step (allowed).
      // The rule means a record at INTERESTED must not be treated as COMMITTED (skipping QUALIFIED).
      expect(isTransitionAllowed('INTERESTED', 'QUALIFIED')).toBe(true);
      expect(isTransitionAllowed('INTERESTED', 'COMMITTED')).toBe(false);
      expect(isTransitionAllowed('INTERESTED', 'FUNDED')).toBe(false);
    });

    test('Qualified is not committed — QUALIFIED cannot skip to FUNDED', () => {
      // Qualified → Committed is the correct next step (allowed).
      // The rule means a record at QUALIFIED must not be treated as FUNDED (skipping COMMITTED).
      expect(isTransitionAllowed('QUALIFIED', 'COMMITTED')).toBe(true);
      expect(isTransitionAllowed('QUALIFIED', 'FUNDED')).toBe(false);
      expect(() => assertValidTransition('QUALIFIED', 'FUNDED')).toThrow();
    });

    test('Only COMMITTED may advance to FUNDED', () => {
      expect(isTransitionAllowed('COMMITTED', 'FUNDED')).toBe(true);
      expect(isTransitionAllowed('QUALIFIED', 'FUNDED')).toBe(false);
      expect(isTransitionAllowed('INTERESTED', 'FUNDED')).toBe(false);
      expect(isTransitionAllowed('DISCOVERED', 'FUNDED')).toBe(false);
    });

    test('no-op transition is rejected', () => {
      expect(() => assertValidTransition('DISCOVERED', 'DISCOVERED')).toThrow();
    });

    test('DO_NOT_CONTACT can only return to DISCOVERED', () => {
      const allowed = ALLOWED_TRANSITIONS.DO_NOT_CONTACT;
      expect(allowed).toEqual(['DISCOVERED']);
    });

    test('FUNDED has no forward transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS.FUNDED).toEqual([]);
    });

    test('INVALID has no forward transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS.INVALID).toEqual([]);
    });

    test('DUPLICATE has no forward transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS.DUPLICATE).toEqual([]);
    });

    test('TEST has no forward transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS.TEST).toEqual([]);
    });
  });
});
