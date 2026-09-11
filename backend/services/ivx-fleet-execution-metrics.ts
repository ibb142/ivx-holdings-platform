import { getAIQueueSnapshot } from './ivx-ai-queue';
import { autonomousContinuityCapacity } from './ivx-autonomous-control-policy';

export type SeniorExecutionMetrics = { activeRepairs: number; activeQA: number; activeInspections: number;
  activeUnclassified: number; configuredSlots: number };
let seniorReader: (() => SeniorExecutionMetrics) | null = null;
export type FleetControlMetrics = { identitiesVerified: boolean; paused: number[]; disabled: number[] };
let controlReader: (() => FleetControlMetrics) | null = null;

/** Register counters without importing or starting the worker from a telemetry reader. */
export function registerSeniorExecutionMetrics(reader: () => SeniorExecutionMetrics): void { seniorReader = reader; }
export function registerFleetControlMetrics(reader: () => FleetControlMetrics): void { controlReader = reader; }

export function localFleetExecutionMetrics() {
  return { scope: 'process' as const, modelRuntime: getAIQueueSnapshot(),
    configuredPatrolSlots: autonomousContinuityCapacity(), senior: seniorReader?.() ?? null, controls: controlReader?.() ?? null };
}
