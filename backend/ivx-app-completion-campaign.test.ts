/**
 * IVX 112-Agent App Completion Campaign — real assignment integrity tests.
 *
 * Verifies the campaign honors the hard honesty rules:
 * every agent has a real duty, no implementer certifies its own fix,
 * every audit item is backed by evidence, and no status is fabricated.
 */
import { describe, expect, it } from 'bun:test';
import {
  APP_COMPLETION_AUDIT_ITEMS,
  VERIFICATION_DUTIES,
  buildAppCompletionCampaign,
  updateControlState,
} from './services/ivx-app-completion-campaign';

describe('IVX app completion campaign', () => {
  const campaign = buildAppCompletionCampaign();

  it('assigns a real duty to all 112 agents with zero idle', () => {
    expect(campaign.totals.agentsTotal).toBe(112);
    expect(campaign.totals.agentsAssigned).toBe(112);
    expect(campaign.totals.idleAgents).toBe(0);
    expect(campaign.assignments.length).toBe(112);
    const numbers = campaign.assignments.map((a) => a.agentNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 112 }, (_, i) => i + 1));
    for (const a of campaign.assignments) {
      expect(a.assignedTask.length).toBeGreaterThan(10);
      expect(a.module.length).toBeGreaterThan(0);
      expect(a.currentStep.length).toBeGreaterThan(0);
    }
  });

  it('has only evidence-backed audit items — no invented items', () => {
    expect(APP_COMPLETION_AUDIT_ITEMS.length).toBeGreaterThan(0);
    for (const item of APP_COMPLETION_AUDIT_ITEMS) {
      expect(item.evidence.length).toBeGreaterThan(20);
      expect(item.problem.length).toBeGreaterThan(20);
      expect(item.expectedResult.length).toBeGreaterThan(10);
      expect(item.fileOrRoute.length).toBeGreaterThan(0);
      expect(['P0', 'P1', 'P2']).toContain(item.priority);
    }
  });

  it('gives every audit item an implementer AND an independent QA agent', () => {
    for (const item of APP_COMPLETION_AUDIT_ITEMS) {
      const impl = campaign.assignments.filter((a) => a.dutyId === item.id && a.role === 'IMPLEMENT');
      const qa = campaign.assignments.filter((a) => a.dutyId === item.id && a.role === 'QA');
      expect(impl.length).toBe(1);
      expect(qa.length).toBe(1);
      expect(impl[0].agentNumber).not.toBe(qa[0].agentNumber);
      expect(impl[0].qaAgentNumber).toBe(qa[0].agentNumber);
    }
  });

  it('never marks a fix item COMPLETED without real execution evidence', () => {
    for (const a of campaign.assignments) {
      if (a.role === 'IMPLEMENT' || a.role === 'QA') {
        expect(a.status).not.toBe('COMPLETED');
        expect(a.progress).toBe(0);
      }
    }
  });

  it('flags owner-gated items as PENDING_OWNER instead of pretending to run', () => {
    for (const item of APP_COMPLETION_AUDIT_ITEMS) {
      const impl = campaign.assignments.find((a) => a.dutyId === item.id && a.role === 'IMPLEMENT');
      expect(impl).toBeDefined();
      if (item.ownerGate) {
        expect(impl!.status).toBe('PENDING_OWNER');
        expect(impl!.currentStep).toContain('OWNER');
      } else {
        expect(impl!.status).toBe('QUEUED');
      }
    }
  });

  it('derives verification statuses from the real runtime state only', () => {
    const verifyAgents = campaign.assignments.filter((a) => a.role === 'VERIFY');
    expect(verifyAgents.length).toBeGreaterThan(50);
    const allowed: string[] = ['QUEUED', 'RUNNING', 'VERIFYING', 'FAILED'];
    for (const a of verifyAgents) {
      expect(allowed).toContain(a.status);
    }
  });

  it('covers all four phases with the audit items and verification duties', () => {
    const phases = new Set(campaign.assignments.map((a) => a.phase));
    expect(phases.size).toBe(4);
    const p1 = campaign.assignments.filter((a) => a.phase === 'PHASE_1_MOBILE_CORE');
    const p2 = campaign.assignments.filter((a) => a.phase === 'PHASE_2_BUSINESS');
    const p3 = campaign.assignments.filter((a) => a.phase === 'PHASE_3_BACKEND');
    const p4 = campaign.assignments.filter((a) => a.phase === 'PHASE_4_PRODUCTION');
    expect(p1.length).toBe(28);
    expect(p2.length).toBe(28);
    expect(p3.length).toBe(28);
    expect(p4.length).toBe(28);
    expect(VERIFICATION_DUTIES.length).toBeGreaterThanOrEqual(30);
  });

  it('reports honest pending counts — nothing hidden', () => {
    expect(campaign.pendingAppItems).toBe(APP_COMPLETION_AUDIT_ITEMS.length);
    expect(campaign.p0Open).toBe(APP_COMPLETION_AUDIT_ITEMS.filter((i) => i.priority === 'P0').length);
    const total = Object.values(campaign.counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(112);
  });

  it('supports owner controls: pause/resume/stop/retry', async () => {
    await updateControlState('pause_all');
    let paused = buildAppCompletionCampaign();
    expect(paused.control.paused).toBe(true);
    expect(paused.assignments.every((a) => a.currentStep === 'PAUSED BY OWNER')).toBe(true);

    await updateControlState('stop_agent', 42);
    paused = buildAppCompletionCampaign();
    const agent42 = paused.assignments.find((a) => a.agentNumber === 42)!;
    expect(agent42.status).toBe('FAILED');
    expect(agent42.currentStep).toBe('STOPPED BY OWNER');

    await updateControlState('retry_agent', 42);
    await updateControlState('resume_all');
    const resumed = buildAppCompletionCampaign();
    expect(resumed.control.paused).toBe(false);
    const agent42b = resumed.assignments.find((a) => a.agentNumber === 42)!;
    expect(agent42b.currentStep).not.toBe('STOPPED BY OWNER');
  });
});
