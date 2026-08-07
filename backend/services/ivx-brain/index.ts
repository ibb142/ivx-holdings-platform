/**
 * IVX IA Brain — Module Index.
 *
 * Single entry point for all IVX IA Brain enterprise intelligence
 * modules. Import from this file to access the full brain system.
 */

export { routeIVXBrainDomains, IVX_BRAIN_DOMAIN_ROUTER_MARKER } from './ivx-brain-domain-router';
export type { IVXBrainDomain, IVXBrainRoute, IVXBrainRoutingDecision } from './ivx-brain-domain-router';

export { assessConfidence, appendConfidenceDisclaimer, IVX_BRAIN_CONFIDENCE_GATE_MARKER } from './ivx-brain-confidence-gate';
export type { IVXConfidenceLevel, IVXConfidenceAssessment } from './ivx-brain-confidence-gate';

export {
  detectDataCategory,
  evaluateRetrieval,
  isDataFresh,
  assessSourceQuality,
  formatRetrievalCitations,
  FRESHNESS_POLICIES,
  IVX_BRAIN_LIVE_RETRIEVAL_MARKER,
} from './ivx-brain-live-retrieval';
export type { IVXDataCategory, IVXFreshnessPolicy, IVXRetrievalRecord, IVXRetrievedSource } from './ivx-brain-live-retrieval';

export { applyHallucinationGate, IVX_BRAIN_HALLUCINATION_GATE_MARKER } from './ivx-brain-hallucination-gate';
export type { IVXHallucinationGateResult, IVXHallucinationFlag } from './ivx-brain-hallucination-gate';

export { buildBrainEvent, aggregateBrainDashboard, estimateCost, IVX_BRAIN_OBSERVABILITY_MARKER } from './ivx-brain-observability';
export type { IVXBrainEvent, IVXBrainDashboard, IVXBrainEventBuilder } from './ivx-brain-observability';

export {
  selectSpecialistFramework,
  buildSpecialistSystemPrompt,
  SENIOR_DEVELOPER_FRAMEWORK,
  BUSINESS_EXPERT_FRAMEWORK,
  MARKETING_EXPERT_FRAMEWORK,
  REAL_ESTATE_ANALYTICS_FRAMEWORK,
  INVESTMENT_ANALYSIS_FRAMEWORK,
  IVX_BRAIN_SPECIALIST_MODES_MARKER,
} from './ivx-brain-specialist-modes';
export type { SpecialistFramework } from './ivx-brain-specialist-modes';

export {
  getQADataset,
  getQATestsForDomain,
  getQADatasetSummary,
  scoreResponse,
  IVX_BRAIN_QA_DATASET_MARKER,
} from './ivx-brain-qa-dataset';
export type { IVXQADomain, IVXQATestCase, IVXScoringRubric, IVXQAScoredResult } from './ivx-brain-qa-dataset';

export {
  ADVERSARIAL_TEST_CASES,
  evaluateAdversarialResponse,
  runAdversarialTestSuite,
  summarizeAdversarialResults,
  IVX_BRAIN_ADVERSARIAL_QA_MARKER,
} from './ivx-brain-adversarial-qa';
export type { IVXAdversarialTestCategory, IVXAdversarialTestCase, IVXAdversarialTestResult } from './ivx-brain-adversarial-qa';

export {
  evaluateReleaseThresholds,
  getRequiredThresholdNames,
  RELEASE_THRESHOLDS,
  IVX_BRAIN_RELEASE_THRESHOLDS_MARKER,
} from './ivx-brain-release-thresholds';
export type { IVXThresholdCheck, IVXReleaseThresholdResult } from './ivx-brain-release-thresholds';

export {
  orchestratePreResponse,
  orchestratePostResponse,
  IVX_BRAIN_ORCHESTRATOR_MARKER,
} from './ivx-brain-orchestrator';
export type { IVXBrainOrchestrationInput, IVXBrainOrchestrationPreResponse, IVXBrainOrchestrationPostResponse } from './ivx-brain-orchestrator';

export {
  runCertification,
  runStructuralCertification,
  formatCertificationResult,
  IVX_BRAIN_CERTIFICATION_RUNNER_MARKER,
} from './ivx-brain-certification-runner';
export type { IVXCertificationResult } from './ivx-brain-certification-runner';
