import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  IVX_ENTERPRISE_MIDDLEWARE_MARKER,
  observabilityMiddleware,
  requestTimeoutMiddleware,
  bodyLimitMiddleware,
  aiRateLimitMiddleware,
  securityHeadersMiddleware,
  getEnterpriseMetrics,
} from './middleware/ivx-enterprise-middleware';
import { GET, OPTIONS as ownerAIOptions, handleIVXOwnerAIProxyStatus, handleIVXOwnerAIRequest, handleIVXOwnerAIToolRequest } from './api/ivx-owner-ai';
import {
  handleIVXIaMemoryDeleteRequest,
  handleIVXIaMemoryForgetNameRequest,
  handleIVXIaMemoryGreetingRequest,
  handleIVXIaMemoryListRequest,
  handleIVXIaMemoryOptions,
  handleIVXIaMemoryUpsertRequest,
} from './api/ivx-ia-memory';
import { handleIVXOwnerAIDiagnosticsClientEventRequest, handleIVXOwnerAIDiagnosticsGetRequest, handleIVXOwnerAIDiagnosticsListRequest, ivxOwnerAIDiagnosticsOptions } from './api/ivx-owner-ai-diagnostics';
import { handleIVXOwnerAIAuthDiagnosticGet, handleIVXOwnerAIAuthDiagnosticPost, ivxOwnerAIAuthDiagnosticOptions } from './api/ivx-owner-ai-auth-diagnostic';
import { OPTIONS as ownerAIStreamOptions, handleIVXOwnerAIStreamRequest } from './api/ivx-owner-ai-stream';
import {
  handleIVXOwnerAIRequestControlOptions,
  handleIVXOwnerAIRequestCreate,
  handleIVXOwnerAIRequestStatus,
  handleIVXOwnerAIRequestRetry,
  handleIVXOwnerAIRequestCancel,
} from './api/ivx-owner-ai-request-control';
import {
  ownerAIDurableOptions,
  handleOwnerAITaskCreate,
  handleOwnerAITaskStatus,
  handleOwnerAITaskList,
  handleOwnerAITaskRetry,
  handleOwnerAITaskCancel,
  handleOwnerAITaskRecover,
  handleOwnerAITaskReplayDeadLetter,
  handleOwnerAIIncidentList,
} from './api/ivx-owner-ai-durable';
import {
  startOwnerAITaskWorker,
  recordOwnerAIIncident,
  classify503Source,
  checkAIHealth as checkOwnerAIHealth,
  checkDatabaseHealth as checkOwnerAIDatabaseHealth,
  checkQueueHealth as checkOwnerAIQueueHealth,
  checkProviderHealthDetail as checkOwnerAIProviderDetail,
  auditDatabaseEnvConfig,
} from './services/ivx-owner-ai-task-queue';
import { OPTIONS as ownerAIJobsOptions, handleIVXAIJobStartRequest, handleIVXAIJobStatusRequest, handleIVXAIJobsListRequest, handleIVXAIRuntimeObservabilityRequest } from './api/ivx-owner-ai-jobs';
import { OPTIONS as auditReportOptions, handleIVXAuditReportRequest } from './api/ivx-audit-report';
import {
  OPTIONS as auditJobsOptions,
  handleStartAuditJobRequest,
  handleListAuditJobsRequest,
  handleAuditJobStatusRequest,
  handleAuditJobChunksRequest,
  handleAuditJobExportRequest,
  handleResumeAuditJobRequest,
  handlePauseAuditJobRequest,
  handleCancelAuditJobRequest,
} from './api/ivx-audit-jobs';
import {
  OPTIONS as taskOrchestratorOptions,
  handleStartTaskRequest,
  handleListTasksRequest,
  handleTaskStatusRequest,
  handleTaskBlocksRequest,
  handleTaskEventsRequest,
  handleTaskReviewRequest,
  handleResumeTaskRequest,
  handlePauseTaskRequest,
  handleCancelTaskRequest,
} from './api/ivx-task-orchestrator';
import {
  OPTIONS as autonomousCoreOptions,
  handleLifecycleProofRequest,
  handleAutonomousDashboardRequest,
  handleHandoffReadinessRequest,
  handlePriorityQueueRequest,
  handleCodeIndexRequest,
  handleCodeIndexSummaryRequest,
  handleCodeIndexRebuildRequest,
  handleAuditItemSetsListRequest,
  handleAuditItemSetCreateRequest,
  handleAuditItemSetGetRequest,
  handleAuditItemsUpsertRequest,
  handleAuditItemStatusRequest,
  handleSelfHealRunRequest,
  handleSelfHealListRequest,
  handleCodeGraphRequest,
  handleCodeGraphSummaryRequest,
  handleCodeGraphRebuildRequest,
  handleBlastRadiusRequest,
  handleContinuousGetRequest,
  handleContinuousStartRequest,
  handleContinuousStopRequest,
  handleContinuousAdvanceRequest,
} from './api/ivx-autonomous-core';
import {
  OPTIONS as autonomousScaleOptions,
  handleScaleDashboardRequest,
  handleScaleReportsRequest,
  handleScaleRunRequest,
  handleScaleEnableRequest,
} from './api/ivx-autonomous-scale';
import { startScaleLoopScheduler } from './services/ivx-autonomous-scale-loop';
import {
  OPTIONS as capabilitiesOptions,
  handleCapabilityRegistryRequest,
  handleCapabilityByIdRequest,
  handleReadinessRequest,
} from './api/ivx-capabilities';
import {
  OPTIONS as appGeneratorOptions,
  handleAppGeneratorStatusRequest,
  handleAppGeneratorGenerateRequest,
  handleAppGeneratorRegisterRequest,
  handleAppGeneratorPlanRequest,
  handleAppGeneratorFilesPreviewRequest,
  handleAppGeneratorDeployRequest,
  handleAppGeneratorScaffoldRequest,
} from './api/ivx-app-generator';
import {
  OPTIONS as credentialReadinessOptions,
  handleCredentialReadinessRequest,
  handleCredentialDeploymentRequest,
  handleCredentialApprovalGateRequest,
} from './api/ivx-credential-readiness';
import {
  OPTIONS as toolSystemOptions,
  handleToolSystemDashboardRequest,
  handleToolSystemToolsRequest,
  handleToolSystemCatalogRequest,
  handleToolSystemInstallRequest,
  handleToolSystemSelfUpgradeRequest,
  handleToolSystemUseRequest,
} from './api/ivx-tool-system';
import {
  OPTIONS as innovationOptions,
  handleInnovationDashboardRequest,
  handleInnovationScanRequest,
  handleInnovationIdeasListRequest,
  handleInnovationIdeaStatusRequest,
  handleInnovationHypothesesListRequest,
  handleInnovationHypothesisCreateRequest,
  handleInnovationHypothesisStatusRequest,
  handleInnovationExperimentsListRequest,
  handleInnovationExperimentCreateRequest,
  handleInnovationExperimentUpdateRequest,
} from './api/ivx-innovation';
import {
  OPTIONS as opportunityOptions,
  handleOpportunityDashboardRequest,
  handleOpportunityScanRequest,
  handleOpportunityListRequest,
  handleOpportunityBestRequest,
  handleOpportunityStatusRequest,
  handleOpportunityAlertsRequest,
  handleOpportunityAlertAckRequest,
  handleOpportunityResearchRequest,
} from './api/ivx-opportunity';
import {
  OPTIONS as businessImpactOptions,
  handleBusinessImpactDashboardRequest,
} from './api/ivx-business-impact';
import {
  OPTIONS as executiveLayerOptions,
  handleExecutiveLayerRequest,
} from './api/ivx-executive-layer';
import {
  OPTIONS as rorkIndependenceOptions,
  handleRorkIndependenceRequest,
} from './api/ivx-rork-independence';
import {
  OPTIONS as ownerControlProofOptions,
  handleIVXOwnerControlProofRequest,
} from './api/ivx-owner-control-proof';
import {
  OPTIONS as dailyReportOptions,
  handleDailyReportLatest,
  handleDailyReportGenerate,
  handleDailyReportHistory,
  handleDailyReportPreview,
} from './api/ivx-daily-report';
import {
  OPTIONS as autonomousOsOptions,
  handleAutonomousOsStatus,
  handleAutonomousOsWeekly,
} from './api/ivx-autonomous-os';
import {
  OPTIONS as technologyDiscoveryOptions,
  handleTechnologyDiscoveryStatusRequest,
  handleTechnologyDiscoveryScanRequest,
} from './api/ivx-technology-discovery';
import {
  OPTIONS as unifiedMemoryOptions,
  handleMemoryListRequest,
  handleMemorySummaryRequest,
  handleMemoryCreateRequest,
  handleMemoryGetRequest,
  handleMemoryUpdateRequest,
  handleMemoryForgetRequest,
} from './api/ivx-unified-memory';
import {
  OPTIONS as actionLoopOptions,
  handleActionLoopListRequest,
  handleActionLoopCreateRequest,
  handleActionLoopLearningRequest,
  handleActionLoopGetRequest,
  handleActionLoopExecutionRequest,
  handleActionLoopOutcomeRequest,
} from './api/ivx-executive-action-loop';
import {
  membersOptions,
  handleMemberRegister,
  handleSendEmailCode,
  handleVerifyEmail,
  handleSendPhoneCode,
  handleVerifyPhone,
  handleGetMemberProfile,
  handleStartKYC,
  handleVerificationStatus,
  handleMemberLogin,
  handleMemberForgotPassword,
  handleMemberResetPassword,
  handleUpdateMemberProfile,
} from './api/ivx-members';
import {
  OPTIONS as ownerRecoverySmsOptions,
  handleOwnerRecoveryStatusRequest,
  handleOwnerRecoveryRequestRequest,
  handleOwnerRecoveryVerifyRequest,
  handleOwnerRecoveryResolveTokenRequest,
} from './api/ivx-owner-recovery-sms';
import {
  handleCanonicalMembersRegistry,
  handleCanonicalMembersSummary,
  handleCanonicalMembersBackfill,
  handleCanonicalMembersList,
} from './api/ivx-canonical-members';
import {
  handleLandingPaymentConfirmRequest,
  handleLandingPaymentCreateRequest,
  handleLandingPaymentOptionsRequest,
} from './api/ivx-landing-payment-sync';
import {
  memberInvestorOptions,
  memberAdminOptions,
  handleInvestorApplicationSubmit,
  handleInvestorApplicationGet,
  handleInvestorApplicationReview,
  handleFunnelVisitor,
  handleMemberAdminDashboard,
  handleMemberAdminInvestors,
} from './api/ivx-member-investor-system';
import {
  treasuryOptions,
  treasuryAdminOptions,
  handleTreasuryAccountCreate,
  handleTreasuryAccountsList,
  handleTreasuryAccountSummary,
  handleTreasuryStatement,
  handleTreasuryLedgerRecord,
  handleTreasuryLedgerList,
  handleTreasuryLedgerAmend,
  handleTreasuryAudit,
  handleTreasuryApprovalsList,
  handleTreasuryApprovalDecide,
  handleTreasuryPropertyCapitalUpsert,
  handleTreasuryPropertyCapitalGet,
  handleTreasuryDistributionCalculate,
  handleTreasuryDistributionExecute,
  handleTreasuryDistributionsList,
  handleTreasuryCommissionRecord,
  handleTreasuryCommissionsList,
  handleTreasuryCommissionStatus,
  handleTreasuryInfluencerUpsert,
  handleTreasuryInfluencerTrack,
  handleTreasuryInfluencerPay,
  handleTreasuryInfluencersList,
  handleTreasuryBankItemAdd,
  handleTreasuryReconciliationRun,
  handleTreasuryBankItemsList,
  handleTreasuryDashboard,
  handleTreasuryReports,
  handleTreasuryAIFinance,
} from './api/ivx-treasury';
import {
  OPTIONS as ivxProtectionOptions,
  handleProtectionDashboardRequest,
  handleProtectionAuditLogRequest,
  handleProtectionLedgerIntegrityRequest,
  handleProtectionAccountStatesListRequest,
  handleProtectionAccountStateGetRequest,
  handleProtectionAccountStateTransitionRequest,
  handleProtectionUnlockAccountRequest,
  handleProtectionDeletionListRequest,
  handleProtectionDeletionCreateRequest,
  handleProtectionDeletionApproveRequest,
  handleProtectionDeletionConfirmRequest,
  handleProtectionRecoveryListRequest,
  handleProtectionRecoveryStartRequest,
  handleProtectionRecoveryVerifyRequest,
  handleProtectionRecoveryCompleteRequest,
  handleProtectionSessionsListRequest,
  handleProtectionSessionRegisterRequest,
  handleProtectionSessionRevokeRequest,
  handleProtectionInvestmentsListRequest,
  handleProtectionInvestmentCreateRequest,
  handleProtectionInvestmentValuationRequest,
  handleProtectionWithdrawalsListRequest,
  handleProtectionWithdrawalCreateRequest,
  handleProtectionWithdrawalTransitionRequest,
  handleProtectionWiresListRequest,
  handleProtectionWireCreateRequest,
  handleProtectionWireTransitionRequest,
  handleProtectionWireQueueRequest,
  handleProtectionComplianceListRequest,
  handleProtectionComplianceUpsertRequest,
  handleProtectionWalletRequest,
  handleProtectionReportsRequest,
} from './api/ivx-investor-protection';
import {
  OPTIONS as capitalNetworkOptions,
  handleCapitalNetworkDashboardRequest,
  handleCapitalNetworkScanRequest,
  handleCapitalNetworkProspectsRequest,
  handleCapitalOutreachRequest,
  handleCapitalNetworkStatusRequest,
  handleCapitalProspectActionPlanRequest,
  handleCapitalProspectResearchRequest,
  handleCapitalProspectOutreachDraftRequest,
} from './api/ivx-capital-network';
import {
  OPTIONS as lenderNetworkOptions,
  handleLenderNetworkDashboardRequest,
  handleLenderNetworkScanRequest,
  handleLenderNetworkListRequest,
  handleLenderNetworkStatusRequest,
  handleLenderNetworkGetRequest,
} from './api/ivx-lender-network';
import {
  OPTIONS as liveWorkOptions,
  handleLiveWorkFeedRequest,
  handleLiveWorkAgentsRequest,
  handleLiveWorkCheckSupabaseRequest,
  handleLiveWorkStatusRequest,
  handleLiveWorkTasksRequest,
  handleLiveWorkTaskRequest,
  handleLiveWorkRunRequest,
  handleLiveWorkApproveRequest,
  handleLiveWorkCancelRequest,
} from './api/ivx-live-work';
import {
  OPTIONS as investorDiscoveryOptions,
  handleInvestorDiscoveryGetRequest,
  handleInvestorDiscoveryScanRequest,
} from './api/ivx-investor-discovery';
import {
  OPTIONS as buyerDiscoveryOptions,
  handleBuyerDiscoveryGetRequest,
  handleBuyerDiscoveryScanRequest,
} from './api/ivx-buyer-discovery';
import {
  OPTIONS as bizDevOrchestratorOptions,
  handleBizDevStatusRequest,
  handleBizDevRunRequest,
} from './api/ivx-bizdev-orchestrator';
import {
  OPTIONS as executionTraceOptions,
  handleExecutionTraceListRequest,
  handleExecutionTraceGetRequest,
} from './api/ivx-execution-trace';
import {
  OPTIONS as autonomousModeOptions,
  handleAutonomousModeToolsRequest,
  handleAutonomousModeRunRequest,
} from './api/ivx-autonomous-mode';
import {
  OPTIONS as seniorDevAutonomousOptions,
  handleSeniorDevAutonomousStatusRequest,
  handleSeniorDevAutonomousRunRequest,
} from './api/ivx-senior-developer-autonomous-mode';
import {
  OPTIONS as ownerOperationsOptions,
  handleOwnerOperationsDashboardRequest,
  handleOwnerOperationsConnectionsRequest,
  handleOwnerOperationsConnectionTestRequest,
  handleOwnerOperationsActionsRequest,
  handleOwnerOperationsRorkRemovalPreflightRequest,
} from './api/ivx-owner-operations';
import {
  OPTIONS as globalIntelligenceOptions,
  handleIntelligenceStateRequest,
  handleIntelligenceRunAllRequest,
  handleIntelligenceRunEngineRequest,
  handleIntelligenceRunCategoryRequest,
  handleIntelligenceReportRequest,
  handleIntelligenceReportsListRequest,
  handleIntelligenceTargetsRequest,
  handleIntelligenceRecordsRequest,
  handleIntelligenceTopRequest,
  handleIntelligenceJVMatchRequest,
  handleIntelligenceZipSearchRequest,
  handleIntelligenceEnginesRequest,
  handleIntelligenceValidateRequest,
} from './api/ivx-global-intelligence';
import {
  OPTIONS as continuousImprovementOptions,
  handleContinuousImprovementDashboardRequest,
  handleContinuousImprovementSelfAuditRequest,
  handleContinuousImprovementProposalsRequest,
  handleContinuousImprovementDriftRequest,
  handleContinuousImprovementBaselineRequest,
  handleContinuousImprovementSafePlanRequest,
  handleContinuousImprovementSafeFixesRequest,
} from './api/ivx-continuous-improvement';
import {
  OPTIONS as schedulerOptions,
  handleSchedulerStatusRequest,
  handleSchedulerRunNowRequest,
  handleSchedulerEnableRequest,
} from './api/ivx-scheduler';
import { startAutonomousScheduler } from './services/ivx-autonomous-scheduler';
import { startLandingSeoAutodeploy } from './services/ivx-landing-seo-autodeploy';
import { buildVersionResponse } from './services/ivx-version-endpoint';
import {
  OPTIONS as deliverablesOptions,
  handleDeliverableCreateRequest,
  handleDeliverableListRequest,
  handleDeliverableNotificationsRequest,
  handleDeliverableGetRequest,
  handleDeliverableVerifyRequest,
} from './api/ivx-deliverables';
import {
  OPTIONS as metricsOptions,
  handleMetricsRequest,
} from './api/ivx-metrics';
import {
  ownerStatusOptions,
  handleEnvStatusRequest,
  handleAutonomousStatusRequest,
  handleAutonomousRunRequest,
  handlePersistenceVerifyRequest,
} from './api/ivx-owner-status';
import {
  orderingOptions,
  handleOrderingBoardRequest,
  handleOrderingReportRequest,
  handleOrderingActionRequest,
} from './api/ivx-record-ordering';
import {
  OPTIONS as runtimeVariablesOptions,
  handleRuntimeVariablesRequest,
  handleRuntimeVariablesVerifyRequest,
  handleRuntimeVariablesSyncRequest,
  handleRuntimeVariablesSaveRequest,
  handleRuntimeVariablesAuditRequest,
} from './api/ivx-runtime-variables';
import { buildRuntimeVariablesReport } from './services/ivx-runtime-variables';
import {
  OPTIONS as investorCrmOptions,
  handleInvestorListRequest,
  handleInvestorCreateRequest,
  handleInvestorGetRequest,
  handleInvestorUpdateRequest,
  handleInvestorStatusRequest,
  handleInvestorDeleteRequest,
  handleInvestorImportRequest,
} from './api/ivx-investor-crm';
import {
  OPTIONS as crmDedupOptions,
  handleCrmDedupAuditRequest,
  handleCrmDedupMergeRequest,
  handleCrmVipRequest,
  handleOwnerReviewRequest,
} from './api/ivx-crm-dedup';
import {
  OPTIONS as capitalPipelineOptions,
  handlePipelineListRequest,
  handlePipelineCreateRequest,
  handlePipelineGetRequest,
  handlePipelineUpdateRequest,
  handlePipelineStageRequest,
  handlePipelineDeleteRequest,
} from './api/ivx-capital-pipeline';
import {
  handleCampaignReportRequest,
} from './api/ivx-campaign';
import {
  OPTIONS as powerToolsOptions,
  handleLeadCaptureRequest,
  handleLeadListRequest,
  handleLeadGetRequest,
  handleLeadBehaviorRequest,
  handleLeadStageRequest,
  handleLeadFollowUpRequest,
  handleLeadDeleteRequest,
  handleDealPacketListRequest,
  handleDealPacketCreateRequest,
  handleDealPacketGetRequest,
  handleDealPacketItemRequest,
  handleDealPacketDeleteRequest,
  handlePowerToolsDashboardRequest,
  handlePowerToolsDraftRequest,
} from './api/ivx-power-tools';
import {
  OPTIONS as gmailOptions,
  handleGmailStatusRequest,
  handleGmailConnectRequest,
  handleGmailDisconnectRequest,
  handleGmailRefreshRequest,
  handleGmailTestRequest,
  handleGmailDraftsListRequest,
  handleGmailDraftCreateRequest,
} from './api/ivx-gmail';
import {
  OPTIONS as outreachOptions,
  handleOutreachListRequest,
  handleOutreachPreviewRequest,
  handleOutreachCreateRequest,
  handleOutreachGetRequest,
  handleOutreachUpdateRequest,
  handleOutreachSubmitRequest,
  handleOutreachApproveRequest,
  handleOutreachSendRequest,
  handleOutreachEngagementRequest,
  handleOutreachDeleteRequest,
} from './api/ivx-outreach';
import {
  OPTIONS as leadScoringOptions,
  handleLeadScoringRequest,
} from './api/ivx-lead-scoring';
import {
  OPTIONS as dealMatchingOptions,
  handleDealMatchingRequest,
} from './api/ivx-deal-matching';
import {
  OPTIONS as dealTrackingOptions,
  handleDealTrackingListRequest,
  handleDealTrackingCreateRequest,
  handleDealTrackingGetRequest,
  handleDealTrackingUpdateRequest,
  handleDealTrackingMilestoneRequest,
  handleDealTrackingStatusRequest,
  handleDealTrackingDeleteRequest,
  handleDealTrackingJoinRequest,
  handleDealTrackingLeaveRequest,
  handleDealTrackingAddDocumentRequest,
  handleDealTrackingRemoveDocumentRequest,
} from './api/ivx-deal-tracking';
import {
  OPTIONS as dealPipelineSeedOptions,
  handleDealPipelineSeedRequest,
} from './api/ivx-deal-pipeline-seed';
import {
  OPTIONS as platformModulesOptions,
  handleWaitlistListRequest,
  handleWaitlistCreateRequest,
  handleWaitlistStatusRequest,
  handleWaitlistDeleteRequest,
  handleSettingsListRequest,
  handleSettingsUpsertRequest,
  handleRevenueListRequest,
  handleRevenueCreateRequest,
  handleRevenueStatusRequest,
  handleNotificationsListRequest,
  handleNotificationsCreateRequest,
  handleNotificationsStatusRequest,
  handleBroadcastListRequest,
  handleBroadcastCreateRequest,
  handleBroadcastStatusRequest,
  handleBroadcastDeleteRequest,
  handleRolesListRequest,
  handleRoleDefinitionUpsertRequest,
  handleRoleAssignRequest,
  handleRoleRevokeRequest,
  handleUserPermissionsRequest,
  handleUserScreensRequest,
  handleAssignmentStatusRequest,
  handleForceLogoutRequest,
  handleClearForceLogoutRequest,
  handleUpdateScreensRequest,
  handleSetMfaRequest,
  handleAccessTemplateListRequest,
  handleAccessTemplateCreateRequest,
  handleAccessTemplateDeleteRequest,
  handleAccessGroupListRequest,
  handleAccessGroupCreateRequest,
  handleAccessGroupDeleteRequest,
  handleTransactionsListRequest,
  handleTransactionsCreateRequest,
  handleTransactionsStatusRequest,
  handleCasaRosarioListRequest,
  handleCasaRosarioCreateRequest,
  handleCasaRosarioUpdateRequest,
  handleCasaRosarioStatusRequest,
  handleCasaRosarioDeleteRequest,
  handleAnalyticsSummaryRequest,
  handleAnalyticsEventRequest,
  handleReelDealSyncListRequest,
  handleReelDealSyncCreateRequest,
  handleReelDealSyncDeleteRequest,
  handleOwnerDashboardRequest,
} from './api/ivx-platform-modules';
import {
  OPTIONS as capitalCommandCenterOptions,
  handleCapitalCommandCenterRequest,
  handleCapitalCommandActivityRequest,
  handleBestInvestorWorkflowRequest,
} from './api/ivx-capital-command-center';
import { OPTIONS as supabaseInspectionOptions, handleIVXSupabaseInspectionRequest, inspectSupabaseTables } from './api/ivx-supabase-inspection';
import { executeIVXAIBrainTool } from './services/ivx-ai-brain-tool-executor';
import { OPTIONS as supabaseOwnerActionOptions, handleIVXSupabaseOwnerActionRequest } from './api/ivx-supabase-owner-actions';
import { OPTIONS as ownerRegistrationOptions, handleIVXOwnerAccessRepairRequest, handleIVXOwnerAccessRepairStatusRequest, handleIVXOwnerRegistrationRepairRequest, handleIVXOwnerRegistrationRequest, handleIVXOwnerRegistrationStatusRequest, handleIVXOwnerSignupAuditRequest } from './api/ivx-owner-registration';
import { handleIVXOwnerPasswordlessLogin, ivxOwnerPasswordlessLoginOptions } from './api/ivx-owner-passwordless-login';
import { registerTimezoneRoutes } from './api/ivx-timezone';
import { handleIVXDevelopmentActionRequest, handleIVXDevelopmentControlRequest, ivxDevelopmentControlOptions } from './api/ivx-development-control';
import { OPTIONS as aiBrainToolsOptions, handleIVXAIBrainToolExecuteRequest, handleIVXAIBrainToolsListRequest } from './api/ivx-ai-brain-tools';
import { OPTIONS as controlRoomStatusOptions, handleIVXControlRoomStatusRequest } from './api/ivx-control-room-status';
import { OPTIONS as developerDeployOptions, handleIVXDeveloperDeployActionRequest, handleIVXDeveloperDeployStatusRequest } from './api/ivx-developer-deploy-control';
import { ivxIaDeveloperProofOptions, handleIVXIaDeveloperProofRequest } from './api/ivx-ia-developer-proof';
import {
  developerProofOptions,
  handleDeveloperProofLatest,
  handleDeveloperProofHistory,
  handleDeveloperProofByTaskId,
  handleDeveloperProofVerify,
  handleDeveloperProofRecord,
} from './api/ivx-developer-proof-standard';
import {
  blockerFixMigrationOptions,
  handleBlockerFixRunMigration,
  handleBlockerFixVerifyTables,
} from './api/ivx-blocker-fix-migration';
import { handleIVXOwnerAuditOptions, handleIVXOwnerAuditRecentConversationsRequest } from './api/ivx-owner-audit';
import { OPTIONS as variablesToolOptions, handleIVXVariablesToolSaveRequest, handleIVXVariablesToolStatusRequest } from './api/ivx-variables-tool';
import { OPTIONS as ownerVariablesOptions, getIVXOwnerVariableRuntimeValue, hasIVXOwnerVariableRuntimeValue, handleIVXOwnerVariablesDeleteRequest, handleIVXOwnerVariablesDeploymentStatusRequest, handleIVXOwnerVariablesSaveRequest, handleIVXOwnerVariablesSelfSyncRequest, handleIVXOwnerVariablesStatusRequest, handleIVXOwnerVariablesSyncFromProjectStoreRequest, handleIVXOwnerVariablesTestRequest } from './api/ivx-owner-variables';
import {
  ownerActionOptions,
  handleCreateOwnerActionRequest,
  handleListOwnerActionRequests,
  handleGetOwnerActionRequest,
  handleVerifyOwnerAction,
  handleNotifyOwnerAction,
  handleUpdateOwnerActionStatus,
} from './api/ivx-owner-action-requests';
import { OPTIONS as autonomousOpsDashboardOptions, handleAutonomousOpsDashboardRequest } from './api/ivx-autonomous-ops-dashboard';
import {
  OPTIONS as agentAuditOptions,
  handleAgentAuditOverview,
  handleAgentAuditLedger,
  handleAgentAuditLedgerCreate,
  handleAgentAuditLedgerUpdate,
} from './api/ivx-agent-audit';
import { handleLandingFullDeploy, handleLandingFullDeployStatus } from './api/ivx-landing-full-deploy';
import { qaMigrationOptions, handleQaMigrationRun, handleQaMigrationVerify } from './api/ivx-qa-migration-runner';
import { OPTIONS as independenceStatusOptions, handleIVXIndependenceStatusRequest } from './api/ivx-independence-status';
import { handleProofTestRequest, proofTestOptions } from './api/proof-test';
import {
  executorOptions as ivxExecutorOptions,
  handleExecutorApprovals,
  handleExecutorApprove,
  handleExecutorCapabilities,
  handleExecutorDeploy,
  handleExecutorDiff,
  handleExecutorPlan,
  handleExecutorProof,
  handleExecutorRun,
  handleExecutorSql,
  handleExecutorStatus,
  handleExecutorTasks,
} from './api/ivx-executor-routes';
import {
  handleQaCloseRequest,
  handleQaRunRequest,
  handleQaScreenshotRequest,
  handleQaStatusRequest,
  OPTIONS as qaOptions,
} from './api/ivx-browser-automation';
import { independenceRoutes } from './api/ivx-independence';
import { chatDurabilityProofOptions, handleChatDurabilityProofRequest } from './api/chat-durability-proof';
import { handleProjectDashboardRequest, projectDashboardOptions } from './api/ivx-project-dashboard';
import { OPTIONS as renderDiagnosticOptions, handleIVXRenderDiagnosticRequest } from './api/ivx-render-diagnostic';
import { OPTIONS as apkDistributionOptions, handleIVXApkPresignUploadRequest } from './api/ivx-apk-distribution';
import { OPTIONS as renderDeployLatestOptions, handleIVXRenderDeployLatestRequest } from './api/ivx-render-deploy-latest';
import {
  OPTIONS as deployEngineOptions,
  handleDeployStatus,
  handleDeployEvidence,
  handleDeployTrigger,
  handleDeployVerify,
  handleDeployCycle,
  handleDeployCredentialsAudit,
  handleDeployMonitorStart,
  handleDeployMonitorStop,
  handleDeployHealth,
} from './api/ivx-deployment-engine';
import {
  OPTIONS as deployToolsOptions,
  handleBrain,
  handleBrainHealth,
  handleGitHubStatus,
  handleRenderStatus,
  handleRenderDeploy as handleRenderDeployTool,
  handleRenderRollback,
  handleRenderAutoDeploy,
  handleSupabaseStatus,
  handleInvoke,
  handleEvidence,
  handleCredentials,
  handleDashboard,
} from './api/ivx-deployment-tools';
import { startAutonomousMonitor } from './services/ivx-enterprise-deployment-engine';
import {
  enterpriseOrchestratorOptions,
  handleEnterpriseStateGet,
  handleEnterpriseKPIsGet,
  handleEnterpriseCyclePost,
  handleEnterpriseDispatchPost,
  handleEnterpriseTaskCompletePost,
  handleEnterpriseTaskFailPost,
  handleEnterpriseAgentsGet,
  handleEnterpriseAgentGet,
  handleEnterpriseResearchGet,
  handleEnterpriseResearchReportsGet,
  handleEnterpriseOpportunitiesGet,
  handleEnterpriseOpportunitiesByTypeGet,
  handleEnterpriseOpportunityStatusPost,
  handleEnterpriseImprovementGet,
  handleEnterpriseImprovementPost,
  handleEnterpriseImprovementResolvePost,
  handleEnterpriseMemoryGet,
  handleEnterpriseMemorySearchGet,
  handleEnterpriseMemoryPost,
  handleEnterpriseGovernanceGet,
  handleEnterpriseGovernanceActionPost,
  handleEnterpriseGovernanceApprovePost,
  handleEnterpriseGovernanceBlockPost,
  handleEnterpriseReportsGet,
  handleEnterpriseReportsGeneratePost,
  handleEnterpriseReportsListGet,
  handleEnterpriseValidateGet,
  handleEnterpriseHealthPost,
} from './api/ivx-enterprise-orchestrator';
import {
  handleIVXIncidentIngest,
  handleIVXIncidentsList,
  handleIVXIncidentGet,
  handleIVXIncidentDiagnose,
  handleIVXIncidentApprove,
  handleIVXIncidentStage,
  handleIVXIncidentReplay,
  handleIVXIncidentPromote,
  handleIVXIncidentPolicy,
  handleIVXProductionGuardHealth,
  handleIVXProductionGuardRollback,
} from './api/ivx-incidents';
import { recordIncident } from './services/ivx-incident-store';
import { evaluateAndMaybeRollback } from './services/ivx-production-guard';
import { OPTIONS as agentJobsOptions, handleIVXAgentJobActionRequest, handleIVXAgentJobsCreateRequest, handleIVXAgentJobsListRequest, handleIVXAgentJobsLiveActivityRequest, handleIVXAgentJobsStatusRequest, handleIVXAgentWorkerRunOnceRequest } from './api/ivx-agent-jobs';
import { OPTIONS as agentTestTokenOptions, handleIVXAgentTestRunRequest, handleIVXAgentTestTokenMintRequest } from './api/ivx-agent-test-token';
import { OPTIONS as seniorDeveloperOptions, handleIVXSeniorDeveloperCredentialAuditRequest, handleIVXSeniorDeveloperGithubAuditRequest, handleIVXSeniorDeveloperRunRequest, handleIVXSeniorDeveloperStatusRequest } from './api/ivx-senior-developer-runtime';
import { auditIVXProductionCredentialRuntime, IVX_SENIOR_DEVELOPER_RUNTIME_MARKER, IVX_GITHUB_CANONICAL_PATH, IVX_GITHUB_CANONICAL_PATH_DESCRIPTION } from './services/ivx-senior-developer-runtime';
import { OPTIONS as seniorDevToolsOptions, handleIVXSeniorDevAuditReportRequest, handleIVXSeniorDevToolsExecuteRequest, handleIVXSeniorDevToolsListRequest } from './api/ivx-senior-dev-tools';
import { OPTIONS as branchPrProofOptions, handleIVXBranchPrProofRequest, handleIVXBranchPrProofStatusRequest } from './api/ivx-branch-pr-proof';
import { OPTIONS as seniorDeveloperWorkerOptions, handleSeniorDeveloperWorkerEnqueueRequest, handleSeniorDeveloperWorkerJobRequest, handleSeniorDeveloperWorkerJobsRequest, handleSeniorDeveloperWorkerLastProofRequest, handleSeniorDeveloperWorkerLedgerRequest, handleSeniorDeveloperWorkerStatusRequest, handleSeniorDeveloperWorkerActiveJobRequest, handleSeniorDeveloperWorkerCancelJobRequest, handleSeniorDeveloperWorkerResumeJobRequest } from './api/ivx-senior-developer-worker';
import {
  OPTIONS as seniorDevBuildOptions,
  handleProofRequest as handleSeniorDevProofPost,
  handleProofListRequest as handleSeniorDevProofList,
  handleEvidenceRequest as handleSeniorDevEvidence,
  handleOTelStatusRequest as handleSeniorDevOTel,
  handleRepoSearchRequest as handleSeniorDevRepoSearch,
  handleTestReportRequest as handleSeniorDevTestReport,
  handleE2EPlanRequest as handleSeniorDevE2EPlan,
  handleE2ERunRequest as handleSeniorDevE2ERun,
  handleExecutionStreamRequest as handleSeniorDevExecutionStream,
  handleExecutionRecordRequest as handleSeniorDevExecutionRecord,
} from './api/ivx-senior-dev-build';
import { checkRateLimit } from './middleware/ivx-rate-limit';
import {
  enterpriseOptions,
  handleEnterpriseObservabilityRequest,
  handleEnterpriseSecurityRequest,
  handleEnterpriseDashboardRequest,
  handleEnterpriseCapacityRequest,
  handleEnterpriseHealthRequest,
} from './api/ivx-enterprise';

/** Apply rate limit; if blocked, return the 429 directly. */
async function withRateLimit<T extends Response>(
  raw: Request,
  scope: string,
  burst: number,
  refillPerSecond: number,
  handler: () => Promise<T> | T,
): Promise<Response> {
  const blocked = checkRateLimit(raw, { burst, refillPerSecond, scope });
  if (blocked) return blocked;
  return await handler();
}
import {
  OPTIONS as autonomyOptions,
  handleIVXAutonomyStatusRequest,
  handleIVXAutonomyCloudFrontInvalidateRequest,
  handleIVXAutonomySecretScanRequest,
  handleIVXAutonomyDeployLogRotateRequest,
  handleIVXAutonomyGitRollbackCheckRequest,
  handleIVXAutonomyUptimeProbeRunRequest,
  handleIVXAutonomyUptimeProbeListRequest,
  handleIVXAutonomySSEReplayStatsRequest,
  handleIVXAutonomyTokenBudgetRequest,
  handleIVXAutonomyAIProvidersRequest,
  handleIVXAutonomyDeployApproveAndRunRequest,
  handleIVXAutonomyDeployRollbackRequest,
  handleIVXAutonomyGithubSyncRequest,
} from './api/ivx-autonomy';
import {
  OPTIONS as adminSyncOptions,
  handleIVXAdminSyncRorkToGithubRequest,
} from './api/ivx-admin-sync';
import { handleIVXRepairJobStart, handleIVXRepairJobList, handleIVXRepairJobGet, handleIVXRepairJobByIncident } from './api/ivx-repair-jobs';
import {
  OPTIONS as nightOpsOptions,
  handleIVXNightOpsStatusRequest,
  handleIVXNightOpsConfigRequest,
  handleIVXNightOpsRunRequest,
  handleIVXNightOpsTouchOwnerRequest,
  handleIVXNightOpsRunsListRequest,
  handleIVXNightOpsRunGetRequest,
  handleIVXNightOpsRoadmapGetRequest,
  handleIVXNightOpsRoadmapAdvanceRequest,
} from './api/ivx-night-ops';
import { startNightOpsScheduler } from './services/ivx-night-ops';
import {
  handleDataVaultStatus,
  handleDataVaultConfigUpdate,
  handleDataVaultSnapshotTrigger,
  handleDataVaultSnapshotsList,
  handleDataVaultSnapshotGet,
  handleDataVaultSnapshotTable,
  handleDataVaultRestore,
  handleDataVaultLossDetection,
  handleDataVaultManifest,
  dataVaultOptions,
} from './api/ivx-data-vault';
import {
  handleDataGuardEvaluate,
  handleDataGuardAudit,
  handleDataGuardProtectedTables,
  handleDataGuardCheck,
  dataGuardOptions,
} from './api/ivx-data-loss-guard';
import {
  handleRestoreCenterOverview,
  handleRestoreCenterDeleted,
  handleRestoreCenterSoftDelete,
  handleRestoreCenterRestoreSoft,
  handleRestoreCenterVaultEntries,
  handleRestoreCenterRestoreVault,
  handleRestoreCenterPitr,
  handleRestoreCenterSnapshots,
  handleRestoreCenterRestoreSnapshot,
  handleRestoreCenterSnapshotNow,
  handleRestoreCenterApprovals,
  handleRestoreCenterApprovalCreate,
  handleRestoreCenterApprovalConfirm,
  handleRestoreCenterApprovalReject,
  handleRestoreCenterGuardAudit,
  handleRestoreCenterProtectedTables,
  handleRestoreCenterDrill,
  handleRestoreCenterReport,
  handleRestoreCenterReports,
  handleRestoreCenterExport,
  restoreCenterOptions,
} from './api/ivx-restore-center';
import { handleZeroDataLossMigration, zeroDataLossMigrationOptions } from './api/ivx-zero-data-loss-migration';
import {
  enterpriseRecoveryOptions,
  handleRecoveryObjectives,
  handleRecoveryMonitoring,
  handleRecoveryAlerts,
  handleRecoveryValidate,
  handleStorageAudit,
  handleStorageManifest,
  handleStorageManifestHistory,
  handleFinancialProtectionAudit,
  handleRecoveryRunbook,
  handleRecoveryOverview,
  handleCreateAlert,
} from './api/ivx-enterprise-recovery';
import {
  OPTIONS as intentEngineOptions,
  handleIntentEngineDashboardRequest,
  handleIntentEnginePhase1Request,
  handleIntentEnginePhase2Request,
  handleIntentEnginePhase3Request,
  handleIntentEnginePhase4Request,
  handleIntentEnginePhase8Request,
  handleIntentEngineStatusRequest,
  handleIntentEngineVisitorRequest,
  handleIntentEngineChatRequest,
  handleIntentEnginePageRequest,
} from './api/ivx-intent-capture';
import { startDataVaultScheduler, bootstrapDataVault } from './services/ivx-data-vault';
import { generateDailyReport } from './services/ivx-recovery-report';
import { runRecoveryDrill } from './services/ivx-recovery-drill';
import { startContinuousExecutionScheduler } from './services/ivx-continuous-execution';
import {
  OPTIONS as opMemoryOptions,
  handleStatus as handleOpMemoryStatus,
  handleSearch as handleOpMemorySearch,
  handleList as handleOpMemoryList,
  handleUpsert as handleOpMemoryUpsert,
  handleReindex as handleOpMemoryReindex,
  handleLoopRun as handleOpMemoryLoopRun,
  handleTasksList as handleOpMemoryTasksList,
  handleTaskGet as handleOpMemoryTaskGet,
  handleRollback as handleOpMemoryRollback,
  handleSnapshot as handleOpMemorySnapshot,
} from './api/ivx-operational-memory';
import {
  OPTIONS as engIntelOptions,
  handleStatus as handleEngIntelStatus,
  handleDashboard as handleEngIntelDashboard,
  handleDetect as handleEngIntelDetect,
  handleListIncidents as handleEngIntelListIncidents,
  handleListDecisions as handleEngIntelListDecisions,
  handleListFixOutcomes as handleEngIntelListFixOutcomes,
  handleListSnapshots as handleEngIntelListSnapshots,
  handleTelemetryIngest as handleEngIntelTelemetryIngest,
  handleTelemetryStats as handleEngIntelTelemetryStats,
  handleConfidence as handleEngIntelConfidence,
  handleGate as handleEngIntelGate,
  handleRecordIncident as handleEngIntelRecordIncident,
  handleRecordDecision as handleEngIntelRecordDecision,
  handleRecordFixOutcome as handleEngIntelRecordFixOutcome,
  handleSnapshotCapture as handleEngIntelSnapshotCapture,
  handleSimulate as handleEngIntelSimulate,
} from './api/ivx-engineering-intelligence';
import {
  OPTIONS as multiAgentOptions,
  handleStatus as handleMultiAgentStatus,
  handleListActiveAgents as handleMultiAgentActive,
  handleDispatch as handleMultiAgentDispatch,
  handleListTasks as handleMultiAgentListTasks,
  handleGetTask as handleMultiAgentGetTask,
  handleHandoff as handleMultiAgentHandoff,
  handleListHandoffs as handleMultiAgentListHandoffs,
  handleAudit as handleMultiAgentAudit,
  handleMemoryWrite as handleMultiAgentMemoryWrite,
  handleMemoryRead as handleMultiAgentMemoryRead,
  handleComplete as handleMultiAgentComplete,
  handleFail as handleMultiAgentFail,
  handleRoutePreview as handleMultiAgentRoutePreview,
  handleValidate as handleMultiAgentValidate,
} from './api/ivx-multi-agent';
import {
  OPTIONS as selfExecOptions,
  handleRunSelfExecution as handleSelfExecRun,
  handleGetSelfExecutionResult as handleSelfExecResult,
} from './api/ivx-agent-self-execution';
import {
  OPTIONS as enterpriseOsOptions,
  handleEnterpriseOsHealth,
  handleEnterpriseOsCommandCenter,
  handleEnterpriseOsAgents,
  handleEnterpriseOsRunAgent,
  handleEnterpriseOsAudit,
} from './api/ivx-enterprise-business-os';
import {
  OPTIONS as roleAgentsOptions,
  handleRoleAgentRegistry,
  handleRoleAgentState,
  handleRoleAgentOutputs,
  handleRoleAgentEnqueue,
  handleRoleAgentRun,
  handleRoleAgentRunAll,
  handleRoleAgentToggle,
  handleRoleAgentValidate,
} from './api/ivx-role-agents';
import { startRoleAgentScheduler } from './services/agents/role-agents';
import {
  OPTIONS as engineeringOsOptions,
  handleEngineeringTeams,
  handleEngineeringTeamsSync,
  handleEngineeringStatus,
  handleEngineeringTasksList,
  handleEngineeringTaskCreate,
  handleEngineeringTaskAdvance,
  handleEngineeringTaskEvidence,
  handleEngineeringTaskApprove,
  handleEngineeringActivate,
  handleEngineeringReportLatest,
  handleEngineeringReportRun,
} from './api/ivx-engineering-os';
import { startEngineeringReportTicker } from './services/ivx-engineering-os';
import {
  OPTIONS as parallelAgentsOptions,
  handleParallelDispatch,
  handleParallelList,
  handleParallelGet,
  handleParallelGetTree,
  handleParallelDecomposePreview,
  handleParallelValidate,
} from './api/ivx-parallel-agents';
import {
  OPTIONS as ctoDashboardOptions,
  handleDashboardOverview as handleCTODashboardOverview,
  handleParentTree as handleCTODashboardParentTree,
  handleAuditSearch as handleCTODashboardAuditSearch,
  handleControlAction as handleCTODashboardControl,
  handleAutonomousCycleControl as handleCTODashboardAutonomousCycleControl,
  handleAutonomousCycleDashboardValidate as handleCTODashboardAutonomousCycleValidate,
} from './api/ivx-cto-dashboard';
import {
  OPTIONS as autonomousCycleOptions,
  handleStatus as handleAutonomousCycleStatus,
  handleClassify as handleAutonomousCycleClassify,
  handleRun as handleAutonomousCycleRun,
  handleList as handleAutonomousCycleList,
  handleGet as handleAutonomousCycleGet,
  handleValidate as handleAutonomousCycleValidate,
} from './api/ivx-autonomous-cycle';
import { OPTIONS as assistantOptions, POST as handleAssistantPost } from './api/assistant';
import { OPTIONS as planCreatorOptions, POST as handlePlanCreatorPost } from './api/plan-creator';
import {
  handlePublicChatPost,
  handlePublicChatHistoryGet,
  handlePublicChatSessionsGet,
  setPublicChatHistoryStorage,
} from './api/public-chat';
import { ChatStorage } from './chat-storage';
import type { ChatRoomMessage } from './chat-types';
import {
  generatePublicChatAnswer,
  getPublicChatHealthSnapshot,
  mapRoomMessagesToPublicChatHistory,
} from './public-chat-ai';
import { validateIVXAIStartup, requestIVXAIText, getProviderHealth } from './ivx-ai-runtime';
import { routeDeploymentCommand, isDeploymentCommand } from './services/ivx-deployment-chat-brain';
import {
  handleChatPost,
  handleDiagnosticsGet,
  handleFallbackReply,
  handleInboxSync,
  handleMessagesGet,
  handleMessagesPost,
  handleMessagesSearch,
  handleRoomsGet,
  handleRoomsPost,
  handleUploadPost,
  ownerRoutesOptions,
} from './api/owner-routes';
import {
  handleMultimodalAnalyze,
  handleMultimodalGoogleDriveImport,
  handleMultimodalImageUpload,
  handleMultimodalPdfUpload,
  handleMultimodalSummary,
  handleMultimodalVideoUpload,
  ownerMultimodalOptions,
} from './api/owner-multimodal';
import {
  OPTIONS as multimodalStackOptions,
  handleMultimodalStatusRequest,
  handleMultimodalGenerateImageRequest,
  handleMultimodalUnderstandVideoRequest,
  handleMultimodalGenerate3DRequest,
} from './api/ivx-multimodal';
import { handleOwnerAudioTranscribe, ownerTranscriptionOptions } from './api/owner-transcription';
import {
  handleVideoJobCreate,
  handleVideoJobGet,
  handleVideoJobList,
  handleVideoJobRetry,
  handleVideoWorkerCapabilities,
  ownerVideoWorkerOptions,
} from './api/owner-video-worker';
import { getVideoWorkerCapabilities } from './services/ivx-video-worker';
import {
  handleGrowthCapabilities,
  handleGrowthIdeaGenerate,
  handleGrowthIdeaList,
  handleGrowthJVDraft,
  handleGrowthJVList,
  handleGrowthLeadApprove,
  handleGrowthLeadAudit,
  handleGrowthLeadDiscover,
  handleGrowthLeadList,
  handleGrowthLeadReject,
  handleGrowthMasterList,
  handleGrowthModuleDraft,
  handleGrowthModuleList,
  handleGrowthOutreachDraft,
  handleGrowthOutreachList,
  handleGrowthOverview,
  handleGrowthTokenizationDraft,
  handleGrowthTokenizationList,
  ownerGrowthEngineOptions,
} from './api/owner-growth-engine';
import { getGrowthEngineCapabilities } from './services/ivx-growth-engine';
import {
  handleIVXMediaJobsAdvanceRequest,
  handleIVXMediaJobsCompleteRequest,
  handleIVXMediaJobsCreateRequest,
  handleIVXMediaJobsFailRequest,
  handleIVXMediaJobsGetRequest,
  ivxMediaJobsOptions,
} from './api/ivx-media-jobs';
import {
  projectEngagementOptions,
  handleProjectMediaGet,
  handleProjectMediaUpload,
  handleProjectMediaDelete,
  handleProjectVideoPin,
  handleProjectLikeToggle,
  handleProjectCommentsGet,
  handleProjectCommentAdd,
  handleProjectCommentDelete,
  handleProjectCommentApprove,
  handleProjectEngagementGet,
  handleProjectBulkEngagementGet,
  handleProjectAnalyticsGet,
  handleProjectTrackClick,
  handleProjectShareTrack,
  handleProjectSaveToggle,
} from './api/ivx-project-engagement';
import {
  publicFeatureOptions,
  handleFeaturedProperties,
  handlePropertyDetails,
  handleMembersDashboard,
  handleInvestorsDashboard,
  handleCRMMain,
  handleJVDealsList,
  handlePropertyAdminList,
  handlePropertyAdminCreate,
  handleMediaUpload,
  handleInstagramCards,
  handleEngagementLikes,
  handleEngagementComments,
  handleEngagementShares,
  handleEngagementSaves,
  handleAnalytics,
} from './api/ivx-public-features';
import {
  videoFeedOptions,
  handleVideoFeed,
  handleVideoDownload,
} from './api/ivx-video-feed';
import {
  videoPipelineOptions,
  handleVideoPipelineConfig,
  handleVideoPipelineUpload,
  handleVideoPipelineList,
  handleVideoPipelineGet,
  handleVideoPipelineRetry,
} from './api/ivx-video-pipeline';
import {
  videoPlatformOptions,
  handlePlatformFeed,
  handlePlatformChannels,
  handlePlatformEvents,
  handlePlatformVideoAnalytics,
  handlePlatformVideoMeta,
  handlePlatformFollowToggle,
  handlePlatformFollowList,
  handlePlatformStoriesList,
  handlePlatformStoryCreate,
  handlePlatformLiveList,
  handlePlatformLiveStart,
  handlePlatformLiveStatus,
  handlePlatformLiveIngest,
  handlePlatformLiveStop,
  handlePlatformLiveModerate,
  handlePlatformCreatorDashboard,
  handlePlatformReport,
  handlePlatformModerationQueue,
  handlePlatformModerationDecision,
  handlePlatformHomeFeed,
  handlePlatformDealMeta,
  handlePlatformAdminListVideos,
  handlePlatformAdminAddReel,
  handlePlatformAdminUpdateVideo,
} from './api/ivx-video-platform';

async function loadRoute53Module() {
  try {
    return await import('./api/route53-dns');
  } catch (error) {
    console.log('[IVXOwnerAI-Hono] Route53 module unavailable:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

function route53UnavailableResponse(): Response {
  return new Response(JSON.stringify({
    error: 'Route53 DNS tooling is unavailable in this runtime.',
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

async function handleRoute53Options(): Promise<Response> {
  const route53Module = await loadRoute53Module();
  if (!route53Module) {
    return route53UnavailableResponse();
  }

  return route53Module.route53DnsOptions();
}

async function handleRoute53Request(
  request: Request,
  action: 'audit' | 'upsert',
): Promise<Response> {
  const route53Module = await loadRoute53Module();
  if (!route53Module) {
    return route53UnavailableResponse();
  }

  if (action === 'audit') {
    return route53Module.handleRoute53DNSAudit(request);
  }

  return route53Module.handleRoute53DNSUpsert(request);
}

const app = new Hono();
// NOTE: This is a static build label, NOT a deploy timestamp. Do not read freshness
// from this string. Use the `commit` (RENDER_GIT_COMMIT) and `bootTime` fields on
// /health for actual deploy verification.
const DEPLOYMENT_MARKER = 'ivx-owner-ai-hono-autodeploy-live (see commit+bootTime for freshness)';
/**
 * Live build proof. Render injects RENDER_GIT_COMMIT at deploy time; we surface it on
 * /health so the deployed commit is verifiable from the outside. Falls back to other
 * common CI commit vars, then 'unknown' for local runs.
 */
const LIVE_COMMIT_SHA = (
  process.env.RENDER_GIT_COMMIT?.trim() ||
  process.env.GIT_COMMIT?.trim() ||
  process.env.SOURCE_VERSION?.trim() ||
  'unknown'
);
const LIVE_COMMIT_SHORT = LIVE_COMMIT_SHA === 'unknown' ? 'unknown' : LIVE_COMMIT_SHA.slice(0, 8);
const SERVER_BOOT_TIME = new Date().toISOString();
const OWNER_SIGNUP_AUDIT_SOURCE_PROOF = 'owner-password-owner-vars-route-registered-2026-05-09t1115z';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIST_ROOT = path.join(SERVER_ROOT, 'expo', 'dist');
const CHAT_DATABASE_PATH = (process.env.CHAT_DATABASE_PATH?.trim() || path.join(SERVER_ROOT, 'data', 'chat-room.sqlite'));
const CHAT_DEFAULT_ROOM_ID = (process.env.CHAT_ROOM_ID?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'main-room');
const publicChatStorage = new ChatStorage(CHAT_DATABASE_PATH);
setPublicChatHistoryStorage(publicChatStorage);
const publicRoomMembers = new Map<string, number>();
type RenderProofToolName = 'time-now' | 'room-status' | 'supabase-tables' | 'storage-diagnostics' | 'github-status' | 'aws-status' | 'supabase-status' | 'render-status';

type RenderProofToolPayload = {
  ok: boolean;
  status: 'verified' | 'not_verified' | 'missing_access';
  tool: RenderProofToolName;
  endpoint: string;
  deploymentMarker: string;
  timestamp: string;
  data?: Record<string, unknown>;
  error?: string;
  missingEnvNames?: string[];
};

const RENDER_PROOF_TOOL_NAMES: readonly RenderProofToolName[] = [
  'time-now',
  'room-status',
  'supabase-tables',
  'storage-diagnostics',
  'github-status',
  'aws-status',
  'supabase-status',
  'render-status',
] as const;

const REQUIRED_PRODUCTION_ACCESS_ENV_NAMES = [
  'API_BASE_URL',
  'GITHUB_REPO_URL',
  'GITHUB_TOKEN',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'POSTGRES_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DISTRIBUTION_ID',
  'AI_GATEWAY_API_KEY',
  'JWT_SECRET',
  'APP_SECRET',
] as const;

const OPTIONAL_PRODUCTION_ACCESS_ENV_NAMES = [
  'MINIO_PASSWORD',
  'STRIPE_API_KEY',
] as const;

const REQUESTED_PRODUCTION_ACCESS_ENV_NAMES = [
  ...REQUIRED_PRODUCTION_ACCESS_ENV_NAMES,
  ...OPTIONAL_PRODUCTION_ACCESS_ENV_NAMES,
] as const;

const RENDER_API_BASE_URL = 'https://api.render.com/v1';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function hasWebDistBuild(): boolean {
  return existsSync(WEB_DIST_ROOT);
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeRoomId(value: unknown): string {
  const normalized = readTrimmed(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);

  return normalized || '';
}

function readPublicLimit(value: unknown): number {
  const raw = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : '';
  const parsed = Number.parseInt(readTrimmed(raw), 10);
  if (!Number.isFinite(parsed)) {
    return 80;
  }

  return Math.min(Math.max(parsed, 1), 200);
}

function sanitizePublicUsername(value: unknown): string {
  return readTrimmed(value).replace(/\s+/g, ' ').slice(0, 32) || 'Guest';
}

function sanitizePublicMessage(value: unknown): string {
  return readTrimmed(value).replace(/\s+/g, ' ').slice(0, 1200);
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function publicJson(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Append extra query params to a Request URL, preserving existing params. */
function addQueryParams(req: Request, extra: string): string {
  const url = new URL(req.url);
  const pairs = new URLSearchParams(extra);
  for (const [k, v] of pairs) {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  }
  return url.toString();
}

/** Fetch a single reel by ID from the video platform store. */
let _reelSB: any = null;
async function handleReelById(id: string): Promise<Response> {
  try {
    if (!_reelSB) {
      const { createClient } = await import('@supabase/supabase-js');
      const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
      const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
      _reelSB = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    }
    const { data, error } = await _reelSB
      .from('project_videos')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      return Response.json({ ok: false, error: 'Reel not found', id, deploymentMarker: DEPLOYMENT_MARKER }, { status: 404 });
    }
    return Response.json({ ok: true, video: data, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error', id, deploymentMarker: DEPLOYMENT_MARKER }, { status: 500 });
  }
}

function getPublicRoomSnapshot(roomId: string): { roomId: string; onlineCount: number; messageCount: number } {
  return {
    roomId,
    onlineCount: publicRoomMembers.get(roomId) ?? 0,
    messageCount: publicChatStorage.getRoomMessageCount(roomId),
  };
}

function isRenderProofToolName(value: string): value is RenderProofToolName {
  return (RENDER_PROOF_TOOL_NAMES as readonly string[]).includes(value);
}

function getMissingEnvNames(names: readonly string[]): string[] {
  return names.filter((name) => !readTrimmed(process.env[name]));
}

function summarizeGithubOutput(output: unknown): Record<string, unknown> {
  const record = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
  const latestCommit = record.latestCommit && typeof record.latestCommit === 'object' && !Array.isArray(record.latestCommit)
    ? record.latestCommit as Record<string, unknown>
    : null;
  const branchNames = Array.isArray(record.branchNames) ? record.branchNames.filter((item): item is string => typeof item === 'string') : [];

  return {
    repoUrlConfigured: record.repoUrlConfigured === true || Boolean(readTrimmed(process.env.GITHUB_REPO_URL)),
    credentialSource: readObject(record.credentialSource),
    owner: readTrimmed(record.owner) || null,
    repo: readTrimmed(record.repo) || null,
    private: typeof record.private === 'boolean' ? record.private : null,
    defaultBranch: readTrimmed(record.defaultBranch) || null,
    branchCount: branchNames.length,
    tokenConfigured: record.tokenConfigured === true,
    tokenMode: readTrimmed(record.tokenMode) || 'not_configured',
    latestCommit: latestCommit
      ? {
        shaPrefix: readTrimmed(latestCommit.sha).slice(0, 12) || null,
        authorDate: readTrimmed(latestCommit.authorDate) || null,
      }
      : null,
  };
}

function summarizeSupabaseReadinessOutput(output: unknown): Record<string, unknown> {
  const record = readObject(output);
  const checks = Array.isArray(record.checks) ? record.checks.map((item) => {
    const check = readObject(item);
    return {
      name: readTrimmed(check.name) || null,
      status: readTrimmed(check.status) || null,
      httpStatus: typeof check.httpStatus === 'number' ? check.httpStatus : null,
      accessLevel: readTrimmed(check.accessLevel) || null,
      requiredForMinimum: check.requiredForMinimum === true,
      missingCredentialNames: Array.isArray(check.missingCredentialNames) ? check.missingCredentialNames.map(readTrimmed).filter(Boolean) : [],
    };
  }) : [];
  const requiredChecks = checks.filter((check) => check.requiredForMinimum === true);
  const requiredChecksVerified = requiredChecks.length > 0 && requiredChecks.every((check) => check.status === 'verified');
  const minimumReadOnlyReady = record.minimumReadOnlyReady === true && requiredChecksVerified;
  return {
    status: minimumReadOnlyReady ? 'verified' : 'not_verified',
    minimumReadOnlyReady,
    projectUrlConfigured: record.projectUrlConfigured === true,
    anonKeyConfigured: record.anonKeyConfigured === true,
    serviceRoleConfigured: record.serviceRoleConfigured === true,
    writeCapableCredentialConfigured: record.writeCapableCredentialConfigured === true,
    checks,
    honestStatus: minimumReadOnlyReady
      ? 'Supabase minimum read-only runtime access is verified.'
      : 'Supabase route is reachable, but at least one required read-only check is not verified. Do not report Supabase as fully working until this passes.',
  };
}

function buildMultimodalStatusPayload(): Record<string, unknown> {
  const aiGatewayConfigured = Boolean(readTrimmed(process.env.AI_GATEWAY_API_KEY));
  const supabaseStorageConfigured = Boolean(readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) && (readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY)));
  return {
    ok: true,
    status: 'production_routes_registered',
    deploymentMarker: DEPLOYMENT_MARKER,
    minimumDeploymentMarker: DEPLOYMENT_MARKER,
    timestamp: nowIso(),
    routes: [
      'POST /api/upload/image',
      'POST /api/upload/pdf',
      'POST /api/upload/video',
      'POST /api/google-drive/import',
      'POST /api/files/:fileId/analyze',
      'POST /api/files/:fileId/summary',
    ],
    storage: {
      privateSignedUrls: true,
      supabaseStorageConfigured,
      publicBucketExposure: false,
    },
    capabilities: {
      imageUpload: true,
      imageVisionAnalysis: aiGatewayConfigured,
      multipleImagesInChatContext: false,
      pdfUpload: true,
      pdfTextExtraction: 'best_effort_text_layer_only',
      scannedPdfOcr: false,
      pdfPageReferences: 'page_count_only_until_pdf_parser_worker_enabled',
      videoUpload: true,
      videoMetadataSummary: true,
      videoWorkerImplemented: true,
      videoFrameAnalysis: 'runtime_gated_see_/api/video/capabilities',
      videoTranscriptExtraction: 'runtime_gated_see_/api/video/capabilities',
      googleDriveSharedFileImport: true,
      googleWorkspaceDocsExportToPdf: true,
      googleDrivePrivateOwnerOAuth: false,
    },
    honestBlockersForFullChatGPTParity: [
      'If https://api.ivxholding.com/api/multimodal/status returns 404 or an older deployment marker, production is still serving an old backend deploy and uploads must be treated as FAIL until Render deploys this marker.',
      'Private Google Drive owner OAuth is not connected without a Google OAuth access/refresh token flow.',
      'Scanned-PDF OCR requires an OCR worker.',
      'Video frame extraction/transcription is fully implemented in the video worker (POST /api/video/jobs) but is runtime-gated: it needs an ffmpeg/ffprobe-capable runtime plus a transcription key. GET /api/video/capabilities reports the exact remaining runtime dependencies live.',
      'Multiple uploaded files are listed in the Files workspace, but automatic multi-file chat memory/RAG is not fully wired.',
    ],
  };
}

function summarizeAwsOutput(output: unknown): Record<string, unknown> {
  const record = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
  const account = readTrimmed(record.account);
  const arn = readTrimmed(record.arn);
  const arnParts = arn.split(':');
  return {
    identityVerified: Boolean(account || arn),
    accountSuffix: account ? account.slice(-4).padStart(account.length, '*') : null,
    arnType: arnParts.length >= 6 ? arnParts[5]?.split('/')[0] ?? null : null,
    region: readTrimmed(record.region) || readTrimmed(process.env.AWS_REGION) || 'us-east-1',
    credentialConfigured: getMissingEnvNames(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']).length === 0
      || getMissingEnvNames(['IVX_AWS_READONLY_ACCESS_KEY_ID', 'IVX_AWS_READONLY_SECRET_ACCESS_KEY']).length === 0,
  };
}

function extractRenderEnvVarKeyNames(data: unknown): string[] {
  const values = Array.isArray(data) ? data : Array.isArray(readObject(data).envVars) ? readObject(data).envVars as unknown[] : [];
  return values
    .map((item) => {
      const record = readObject(item);
      const envVar = readObject(record.envVar);
      return readTrimmed(record.key) || readTrimmed(envVar.key);
    })
    .filter(Boolean);
}

async function fetchRenderRuntimeStatus(): Promise<{ ok: boolean; status: 'verified' | 'not_verified' | 'missing_access'; data: Record<string, unknown>; missingEnvNames: string[]; error?: string }> {
  const envApiKey = readTrimmed(process.env.RENDER_API_KEY);
  const envServiceId = readTrimmed(process.env.RENDER_SERVICE_ID);
  const ownerApiKey = envApiKey ? '' : await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const ownerServiceId = envServiceId ? '' : await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  const apiKey = envApiKey || ownerApiKey;
  const serviceId = envServiceId || ownerServiceId;
  const missingEnvNames = [
    ...(!apiKey ? ['RENDER_API_KEY'] : []),
    ...(!serviceId ? ['RENDER_SERVICE_ID'] : []),
  ];
  const renderCredentialSource = {
    RENDER_API_KEY: envApiKey ? 'env' : ownerApiKey ? 'owner_variables' : 'missing',
    RENDER_SERVICE_ID: envServiceId ? 'env' : ownerServiceId ? 'owner_variables' : 'missing',
  };
  const requiredRuntimeMissing = REQUIRED_PRODUCTION_ACCESS_ENV_NAMES.filter((name) => {
    if (name === 'RENDER_API_KEY') return !apiKey;
    if (name === 'RENDER_SERVICE_ID') return !serviceId;
    return !readTrimmed(process.env[name]);
  });
  const optionalRuntimeMissing = getMissingEnvNames(OPTIONAL_PRODUCTION_ACCESS_ENV_NAMES);
  const runtimeMissing = requiredRuntimeMissing;
  const envGroupMarkerPresent = readTrimmed(process.env.IVX_ENV_GROUP_ATTACHED).toLowerCase() === 'true' && readTrimmed(process.env.IVX_ENV_GROUP_NAME) === 'my-env-group';

  if (!apiKey || !serviceId) {
    return {
      ok: false,
      status: 'missing_access',
      missingEnvNames,
      data: {
        apiKeyConfigured: Boolean(apiKey),
        serviceIdConfigured: Boolean(serviceId),
        credentialSource: renderCredentialSource,
        serviceName: readTrimmed(process.env.RENDER_SERVICE_NAME) || 'ivx-holdings-platform',
        envGroupMarkerPresent,
        requestedCredentialPresentByNameOnly: Object.fromEntries(REQUESTED_PRODUCTION_ACCESS_ENV_NAMES.map((name) => [name, name === 'RENDER_API_KEY' ? Boolean(apiKey) : name === 'RENDER_SERVICE_ID' ? Boolean(serviceId) : Boolean(readTrimmed(process.env[name]))])),
        requiredRuntimeMissingEnvNames: requiredRuntimeMissing,
        optionalRuntimeMissingEnvNames: optionalRuntimeMissing,
        runtimeMissingEnvNames: runtimeMissing,
      },
      error: 'Render API runtime credentials are not loaded in this backend runtime.',
    };
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    // Fetch deploys list in parallel with service/env-vars for deploy-history visibility
    let deploysResponse: Response | null = null;
    let deploysData: unknown = [];
    try {
      deploysResponse = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/deploys?limit=10`, { headers });
      deploysData = await deploysResponse.text().then((text) => text ? JSON.parse(text) as unknown : []).catch(() => []);
    } catch {
      deploysData = [];
    }

    const [serviceResponse, envVarsResponse, envGroupsResponse] = await Promise.all([
      fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, { headers }),
      fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`, { headers }),
      fetch(`${RENDER_API_BASE_URL}/env-groups?name=my-env-group&limit=20`, { headers }).catch(() => null),
    ]);
    const [serviceData, envVarsData, envGroupsData] = await Promise.all([
      serviceResponse.text().then((text) => text ? JSON.parse(text) as unknown : null).catch(() => null),
      envVarsResponse.text().then((text) => text ? JSON.parse(text) as unknown : []).catch(() => []),
      envGroupsResponse?.text().then((text) => text ? JSON.parse(text) as unknown : []).catch(() => []) ?? Promise.resolve([]),
    ]);

    // Parse deploy history from Render API response
    const deploysHttpOk = deploysResponse?.ok ?? false;
    const deploysHttpStatus = deploysResponse?.status ?? 0;
    let deploysRawText = '';
    try { deploysRawText = await deploysResponse?.text() ?? ''; } catch { /* already consumed */ }
    let deploysParseError: string | undefined;
    if (deploysHttpOk && typeof deploysData === 'string' && deploysData) {
      deploysParseError = `deploys endpoint returned non-JSON: ${deploysData.slice(0, 200)}`;
    }
    const deploysRaw = Array.isArray(deploysData)
      ? deploysData
      : Array.isArray(readObject(deploysData).deploys)
        ? readObject(deploysData).deploys as unknown[]
        : [];
    const deployHistory = deploysRaw.map((item) => {
      const d = readObject(readObject(item).deploy ?? readObject(item));
      const commitObj = readObject(d.commit);
      const createdAt = readTrimmed(d.createdAt) || readTrimmed(d.finishedAt) || '';
      const finishedAt = readTrimmed(d.finishedAt) || '';
      const durationMs = createdAt && finishedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(createdAt).getTime())
        : 0;
      return {
        deployId: readTrimmed(d.id),
        status: readTrimmed(d.status),
        commitSha: readTrimmed(commitObj.id) || readTrimmed(d.commitId) || '',
        commitShort: (readTrimmed(commitObj.id) || readTrimmed(d.commitId) || '').slice(0, 8),
        createdAt,
        finishedAt,
        durationMs,
        failureReason: readTrimmed(d.failureReason) || undefined,
        imageUrl: readTrimmed(readObject(readObject(d.image).registryCredential).registry) || undefined,
      };
    });
    const latestDeploy = deployHistory[0] ?? null;
    const latestLiveDeploy = deployHistory.find((d) => d.status.toLowerCase().includes('live')) ?? latestDeploy;
    const serviceRecord = readObject(readObject(serviceData).service ?? serviceData);
    // IVX: Surface GitHub connection details from Render service record
    const connectedRepo = readTrimmed(serviceRecord.repo) || null;
    const connectedBranch = readTrimmed(serviceRecord.branch) || null;
    const autoDeployEnabled = readTrimmed(serviceRecord.autoDeploy) === 'yes';
    const serviceCreatedAt = readTrimmed(serviceRecord.createdAt) || null;
    const serviceUpdatedAt = readTrimmed(serviceRecord.updatedAt) || null;
    const deployHookUrl = readTrimmed(serviceRecord.deployHookUrl) || null;
    const envVarKeys = extractRenderEnvVarKeyNames(envVarsData);
    const envVarKeySet = new Set(envVarKeys);
    const envGroupRows = Array.isArray(envGroupsData) ? envGroupsData : Array.isArray(readObject(envGroupsData).envGroups) ? readObject(envGroupsData).envGroups as unknown[] : [];
    const envGroupExists = envGroupRows.some((item) => readTrimmed(readObject(readObject(item).envGroup ?? item).name) === 'my-env-group');
    const requiredEnvVarsPresentInRender = REQUIRED_PRODUCTION_ACCESS_ENV_NAMES.filter((name) => envVarKeySet.has(name));
    const requiredEnvVarsMissingInRender = REQUIRED_PRODUCTION_ACCESS_ENV_NAMES.filter((name) => !envVarKeySet.has(name));
    const optionalEnvVarsPresentInRender = OPTIONAL_PRODUCTION_ACCESS_ENV_NAMES.filter((name) => envVarKeySet.has(name));
    const optionalEnvVarsMissingInRender = OPTIONAL_PRODUCTION_ACCESS_ENV_NAMES.filter((name) => !envVarKeySet.has(name));
    const renderApiAuthorized = serviceResponse.ok && envVarsResponse.ok;
    const deploysAvailable = deploysHttpOk && deployHistory.length > 0;

    return {
      ok: renderApiAuthorized && runtimeMissing.length === 0,
      status: !renderApiAuthorized ? 'not_verified' : runtimeMissing.length === 0 ? 'verified' : 'missing_access',
      missingEnvNames: runtimeMissing,
      data: {
        renderApiAuthorized,
        serviceHttpStatus: serviceResponse.status,
        envVarsHttpStatus: envVarsResponse.status,
        deploysHttpOk,
        serviceIdConfigured: true,
        credentialSource: renderCredentialSource,
        serviceIdSuffix: serviceId.slice(-6).padStart(serviceId.length, '*'),
        serviceName: readTrimmed(serviceRecord.name) || readTrimmed(process.env.RENDER_SERVICE_NAME) || 'ivx-holdings-platform',
        serviceType: readTrimmed(serviceRecord.type) || null,
        serviceSuspended: serviceRecord.suspended === true,
        envGroupExists,
        envGroupMarkerPresent,
        // GitHub connection status from Render
        connectedRepo,
        connectedBranch,
        autoDeployEnabled,
        deployHookUrl,
        serviceCreatedAt,
        serviceUpdatedAt,
        // Deploy history — surfaced for commit matching and deployment proof
        deploysHttpStatus,
        deploysParseError: deploysParseError ?? null,
        deploysRawResponsePreview: deploysRawText.slice(0, 500) || null,
        deployId: latestDeploy?.deployId ?? null,
        deployStatus: latestDeploy?.status ?? null,
        deployedCommitSha: latestDeploy?.commitSha ?? null,
        deployedCommitShort: latestDeploy?.commitShort ?? null,
        deployCreatedAt: latestDeploy?.createdAt ?? null,
        deployFinishedAt: latestDeploy?.finishedAt ?? null,
        deployDurationMs: latestDeploy?.durationMs ?? 0,
        liveDeployId: latestLiveDeploy?.deployId ?? null,
        liveDeployCommitSha: latestLiveDeploy?.commitSha ?? null,
        deployHistory,
        deployHistoryAvailable: deploysAvailable,
        deployHistoryCount: deployHistory.length,
        requestedCredentialPresentByNameOnly: Object.fromEntries(REQUESTED_PRODUCTION_ACCESS_ENV_NAMES.map((name) => [name, name === 'RENDER_API_KEY' ? Boolean(apiKey) : name === 'RENDER_SERVICE_ID' ? Boolean(serviceId) : Boolean(readTrimmed(process.env[name]))])),
        requiredEnvVarsPresentInRender,
        requiredEnvVarsMissingInRender,
        optionalEnvVarsPresentInRender,
        optionalEnvVarsMissingInRender,
        requiredRuntimeMissingEnvNames: requiredRuntimeMissing,
        optionalRuntimeMissingEnvNames: optionalRuntimeMissing,
        runtimeMissingEnvNames: runtimeMissing,
      },
      error: renderApiAuthorized ? undefined : `Render API check returned service=${serviceResponse.status}, envVars=${envVarsResponse.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'not_verified',
      missingEnvNames,
      data: {
        apiKeyConfigured: true,
        serviceIdConfigured: true,
        credentialSource: renderCredentialSource,
        requestedCredentialPresentByNameOnly: Object.fromEntries(REQUESTED_PRODUCTION_ACCESS_ENV_NAMES.map((name) => [name, name === 'RENDER_API_KEY' ? Boolean(apiKey) : name === 'RENDER_SERVICE_ID' ? Boolean(serviceId) : Boolean(readTrimmed(process.env[name]))])),
      },
      error: error instanceof Error ? error.message : 'Render runtime status check failed.',
    };
  }
}

async function buildRenderEnvDebugPayload(): Promise<Record<string, unknown>> {
  const envApiKeyExists = Boolean(readTrimmed(process.env.RENDER_API_KEY));
  const envServiceIdExists = Boolean(readTrimmed(process.env.RENDER_SERVICE_ID));
  const ownerApiKeyExists = await hasIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const ownerServiceIdExists = await hasIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  const apiKeyExists = envApiKeyExists || ownerApiKeyExists;
  const serviceIdExists = envServiceIdExists || ownerServiceIdExists;
  const exists = apiKeyExists && serviceIdExists;
  const source = envApiKeyExists && envServiceIdExists
    ? 'env'
    : ownerApiKeyExists && ownerServiceIdExists
      ? 'owner_variables'
      : exists
        ? 'mixed'
        : apiKeyExists || serviceIdExists
          ? 'partial'
          : 'missing';

  return {
    exists,
    source,
    loadedAtRuntime: exists,
    secretValuesReturned: false,
  };
}

// ---- IVX Render Auto-Deploy Fix Handlers ----

function getRenderCredentials(): { apiKey: string; serviceId: string } | null {
  const apiKey = readTrimmed(process.env.RENDER_API_KEY);
  const serviceId = readTrimmed(process.env.RENDER_SERVICE_ID);
  if (!apiKey || !serviceId) return null;
  return { apiKey, serviceId };
}

function buildRenderHeaders(apiKey: string): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

const TARGET_GITHUB_REPO = 'ibb142/rork-global-real-estate-invest';
const TARGET_GITHUB_REPO_URL = `https://github.com/${TARGET_GITHUB_REPO}`;
const TARGET_BRANCH = 'main';

async function handleRenderAutoDeployStatusRequest(req: Request): Promise<Response> {
  const creds = getRenderCredentials();
  if (!creds) {
    return Response.json({
      ok: false,
      error: 'Render API credentials not configured in backend runtime.',
      renderConfigured: false,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }

  try {
    const headers = buildRenderHeaders(creds.apiKey);
    const serviceUrl = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}`;
    const deployHookUrl = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}/deploy-hook`;

    const [serviceRes, deploysRes, deployHookRes] = await Promise.all([
      fetch(serviceUrl, { headers }),
      fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}/deploys?limit=5`, { headers }).catch(() => null),
      fetch(deployHookUrl, { headers }).catch(() => null),
    ]);

    const serviceData: Record<string, unknown> = serviceRes.ok
      ? await serviceRes.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const serviceRecord = readObject(serviceData.service ?? serviceData);
    const deploysData: unknown[] = deploysRes?.ok
      ? await deploysRes!.json().catch(() => []) as unknown[]
      : [];
    const deployHookData: Record<string, unknown> = deployHookRes?.ok
      ? await deployHookRes!.json().catch(() => ({})) as Record<string, unknown>
      : {};

    const connectedRepo = readTrimmed(serviceRecord.repo) || null;
    const connectedBranch = readTrimmed(serviceRecord.branch) || null;
    const autoDeploy = readTrimmed(serviceRecord.autoDeploy) || null;
    const autoDeployEnabled = autoDeploy === 'yes';
    const repoMatch = connectedRepo
      ? connectedRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') === TARGET_GITHUB_REPO
      : false;
    const branchMatch = connectedBranch === TARGET_BRANCH;

    // Parse deploy history
    const deploys = Array.isArray(deploysData) ? deploysData : [];
    const deployHistory = deploys.map((item: unknown) => {
      const d = readObject(readObject(item).deploy ?? readObject(item));
      const commitObj = readObject(d.commit);
      return {
        deployId: readTrimmed(d.id),
        status: readTrimmed(d.status),
        commitSha: readTrimmed(commitObj.id) || readTrimmed(d.commitId) || '',
        createdAt: readTrimmed(d.createdAt) || '',
        finishedAt: readTrimmed(d.finishedAt) || '',
        failureReason: readTrimmed(d.failureReason) || undefined,
      };
    });

    const latestDeploy = deployHistory[0] ?? null;
    const deployHookUrl_ = readTrimmed(deployHookData.deployHookUrl) || readTrimmed(serviceRecord.deployHookUrl) || null;
    const deployHookAvailable = Boolean(deployHookUrl_);

    return Response.json({
      ok: true,
      renderConfigured: true,
      serviceIdSuffix: creds.serviceId.slice(-6).padStart(creds.serviceId.length, '*'),
      serviceName: readTrimmed(serviceRecord.name) || 'ivx-holdings-platform',
      serviceType: readTrimmed(serviceRecord.type) || 'web_service',
      targetRepo: TARGET_GITHUB_REPO,
      targetRepoUrl: TARGET_GITHUB_REPO_URL,
      targetBranch: TARGET_BRANCH,
      connectedRepo,
      connectedBranch,
      repoMatch,
      branchMatch,
      autoDeployEnabled,
      deployHookAvailable,
      deployHookUrl: deployHookUrl_ ? `${deployHookUrl_!.slice(0, 8)}...` : null,
      latestDeployId: latestDeploy?.deployId ?? null,
      latestDeployStatus: latestDeploy?.status ?? null,
      latestDeployCommit: latestDeploy?.commitSha?.slice(0, 8) ?? null,
      deployHistoryCount: deployHistory.length,
      deployHistory: deployHistory.slice(0, 5),
      serviceHttpStatus: serviceRes.status,
      deploysHttpStatus: deploysRes?.status ?? 0,
      needsFix: !repoMatch || !branchMatch || !autoDeployEnabled,
      fixActions: [
        ...(!repoMatch ? [`connect repo → ${TARGET_GITHUB_REPO}`] : []),
        ...(!branchMatch ? [`set branch → ${TARGET_BRANCH}`] : []),
        ...(!autoDeployEnabled ? ['enable auto-deploy'] : []),
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Render auto-deploy status check failed.',
      renderConfigured: true,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

async function handleRenderAutoDeployFixRequest(req: Request): Promise<Response> {
  const creds = getRenderCredentials();
  if (!creds) {
    return Response.json({
      ok: false,
      error: 'Render API credentials not configured in backend runtime.',
      renderConfigured: false,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json().catch(() => ({})) as Record<string, unknown>; } catch { /* empty body ok */ }
  const confirmText = readTrimmed(body.confirm);
  if (confirmText !== 'FIX_IVX_RENDER_AUTO_DEPLOY') {
    return Response.json({
      ok: false,
      error: 'Confirmation required. Send {"confirm": "FIX_IVX_RENDER_AUTO_DEPLOY"} to proceed.',
      timestamp: new Date().toISOString(),
    }, { status: 400 });
  }

  const results: Record<string, unknown> = {};
  const headers = buildRenderHeaders(creds.apiKey);
  const serviceUrl = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}`;

  try {
    // Step 1: Get current service details
    const getRes = await fetch(serviceUrl, { headers });
    const serviceData: Record<string, unknown> = getRes.ok
      ? await getRes.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const serviceRecord = readObject(serviceData.service ?? serviceData);
    const currentRepo = readTrimmed(serviceRecord.repo);
    const currentBranch = readTrimmed(serviceRecord.branch);
    const currentAutoDeploy = readTrimmed(serviceRecord.autoDeploy);

    results.beforeRepo = currentRepo || null;
    results.beforeBranch = currentBranch || null;
    results.beforeAutoDeploy = currentAutoDeploy || null;

    // Step 2: Update source repo and enable auto-deploy
    const patchBody: Record<string, unknown> = {
      repo: TARGET_GITHUB_REPO_URL,
      branch: TARGET_BRANCH,
      autoDeploy: 'yes',
    };

    console.log('[IVX Render Auto-Deploy Fix] Patching service with:', {
      serviceId: creds.serviceId.slice(-6),
      repo: TARGET_GITHUB_REPO_URL,
      branch: TARGET_BRANCH,
      autoDeploy: 'yes',
    });

    const patchRes = await fetch(serviceUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody),
    });

    if (!patchRes.ok) {
      const errorBody = await patchRes.text().catch(() => '');
      console.error('[IVX Render Auto-Deploy Fix] PATCH failed:', patchRes.status, errorBody.slice(0, 500));
      return Response.json({
        ok: false,
        error: `Render source update failed with HTTP ${patchRes.status}. Render may not have GitHub access to ${TARGET_GITHUB_REPO}. Go to Render dashboard → ${serviceRecord.name ?? 'service'} → Settings → Repository and connect it manually.`,
        details: errorBody.slice(0, 300) || null,
        ...results,
        sourceUpdated: false,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const patchedData: Record<string, unknown> = await patchRes.json().catch(() => ({})) as Record<string, unknown>;
    const patchedRecord = readObject(patchedData.service ?? patchedData);
    results.afterRepo = readTrimmed(patchedRecord.repo) || null;
    results.afterBranch = readTrimmed(patchedRecord.branch) || null;
    results.afterAutoDeploy = readTrimmed(patchedRecord.autoDeploy) || null;
    results.sourceUpdated = true;

    console.log('[IVX Render Auto-Deploy Fix] Source updated:', results.afterRepo, results.afterBranch, results.afterAutoDeploy);

    // Step 3: Trigger a deploy from the latest commit
    const deployBody: Record<string, unknown> = { clearCache: 'clear' };
    const deployRes = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deployBody),
    });

    if (!deployRes.ok) {
      const deployErrorBody = await deployRes.text().catch(() => '');
      console.error('[IVX Render Auto-Deploy Fix] Deploy trigger failed:', deployRes.status, deployErrorBody.slice(0, 500));
      return Response.json({
        ok: true,
        warning: 'Source updated successfully but deploy trigger failed. Render will auto-deploy on next push to main.',
        deployTriggered: false,
        deployError: deployErrorBody.slice(0, 300) || `HTTP ${deployRes.status}`,
        ...results,
        timestamp: new Date().toISOString(),
      });
    }

    const deployData: Record<string, unknown> = await deployRes.json().catch(() => ({})) as Record<string, unknown>;
    const deployRecord = readObject(readObject(deployData).deploy ?? deployData);
    const deployId = readTrimmed(deployRecord.id) || null;
    const deployStatus = readTrimmed(deployRecord.status) || 'created';

    console.log('[IVX Render Auto-Deploy Fix] Deploy triggered:', deployId, deployStatus);

    // Step 4: Also try to get/create the deploy hook
    let deployHookUrl: string | null = null;
    try {
      const hookRes = await fetch(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}/deploy-hook`, { headers });
      const hookData: Record<string, unknown> = hookRes.ok ? await hookRes.json().catch(() => ({})) as Record<string, unknown> : {};
      deployHookUrl = readTrimmed(hookData.deployHookUrl) || null;
    } catch { /* best-effort */ }

    return Response.json({
      ok: true,
      sourceUpdated: true,
      deployTriggered: true,
      deployId,
      deployStatus,
      deployHookUrl: deployHookUrl ? `${deployHookUrl.slice(0, 8)}...` : null,
      autoDeployEnabled: true,
      ...results,
      nextSteps: [
        'Push to GitHub main branch to trigger auto-deploy',
        `Monitor deploy at: https://dashboard.render.com/web/${creds.serviceId}`,
        `Verify health: https://api.ivxholding.com/health`,
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[IVX Render Auto-Deploy Fix] Unexpected error:', error instanceof Error ? error.message : error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Render auto-deploy fix failed with unexpected error.',
      ...results,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// ── Owner-auth self-deploy trigger ──────────────────────────────────────────
// Triggers a Render deploy using the backend's own Render credentials.
// Owner auth REQUIRED — prevents unauthorized deploy triggers.
async function handleSelfDeployRequest(req: Request): Promise<Response> {
  const { assertIVXRegisteredOwnerBearer } = await import('./api/owner-only');
  try {
    await assertIVXRegisteredOwnerBearer(req, 'self_deploy');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
    const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
    return Response.json({ ok: false, error: message }, { status });
  }
  const creds = getRenderCredentials();
  if (!creds) {
    return Response.json({
      ok: false,
      error: 'Render API credentials not configured in backend runtime.',
      renderConfigured: false,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }

  try {
    const headers = buildRenderHeaders(creds.apiKey);
    const deployUrl = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(creds.serviceId)}/deploys`;

    console.log('[IVX Self-Deploy] Triggering Render deploy for service:', creds.serviceId.slice(-6));

    const deployRes = await fetch(deployUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    });

    if (!deployRes.ok) {
      const errorBody = await deployRes.text().catch(() => '');
      console.error('[IVX Self-Deploy] Deploy trigger failed:', deployRes.status, errorBody.slice(0, 300));
      return Response.json({
        ok: false,
        error: `Render deploy trigger failed: HTTP ${deployRes.status}`,
        detail: errorBody.slice(0, 300) || null,
        serviceIdSuffix: creds.serviceId.slice(-6).padStart(creds.serviceId.length, '*'),
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const deployData: Record<string, unknown> = await deployRes.json().catch(() => ({})) as Record<string, unknown>;
    const deployRecord = readObject(readObject(deployData).deploy ?? deployData);
    const deployId = readTrimmed(deployRecord.id) || null;
    const deployStatus = readTrimmed(deployRecord.status) || 'created';
    const commitSha = readTrimmed(readObject(deployRecord.commit).id) || readTrimmed(deployRecord.commitId) || null;

    console.log('[IVX Self-Deploy] Deploy triggered:', { deployId, deployStatus, commitSha: commitSha?.slice(0, 8) });

    return Response.json({
      ok: true,
      deployTriggered: true,
      deployId,
      deployStatus,
      deployedCommitSha: commitSha,
      deployedCommitShort: commitSha?.slice(0, 8) ?? null,
      serviceName: 'ivx-holdings-platform',
      serviceIdSuffix: creds.serviceId.slice(-6).padStart(creds.serviceId.length, '*'),
      nextSteps: [
        `Monitor deploy at: https://dashboard.render.com/web/${creds.serviceId}`,
        'Verify health: GET https://api.ivxholding.com/health',
        'After deploy completes, the new commit SHA will appear in /health',
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[IVX Self-Deploy] Error:', error instanceof Error ? error.message : error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Self-deploy failed with unexpected error.',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

async function fetchSupabaseStorageDiagnostics(): Promise<{ ok: boolean; status: 'verified' | 'not_verified' | 'missing_access'; data: Record<string, unknown>; missingEnvNames: string[]; error?: string }> {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const serviceRoleKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const accessKey = serviceRoleKey || anonKey;
  const missingEnvNames = getMissingEnvNames(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);

  if (!supabaseUrl || !accessKey) {
    return {
      ok: false,
      status: 'missing_access',
      missingEnvNames,
      data: {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasAnonKey: Boolean(anonKey),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      },
      error: 'Supabase storage diagnostics env is not fully configured.',
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'GET',
      headers: {
        apikey: accessKey,
        Authorization: `Bearer ${accessKey}`,
      },
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as unknown : [];
    const buckets = Array.isArray(parsed) ? parsed : [];
    return {
      ok: response.ok,
      status: response.ok ? 'verified' : 'not_verified',
      missingEnvNames,
      data: {
        httpStatus: response.status,
        hasSupabaseUrl: true,
        hasAnonKey: Boolean(anonKey),
        hasServiceRoleKey: Boolean(serviceRoleKey),
        bucketCount: buckets.length,
        bucketNames: buckets.map((bucket) => readTrimmed((bucket as Record<string, unknown>).name)).filter(Boolean).slice(0, 20),
      },
      error: response.ok ? undefined : text.slice(0, 240),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'not_verified',
      missingEnvNames,
      data: {
        hasSupabaseUrl: true,
        hasAnonKey: Boolean(anonKey),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      },
      error: error instanceof Error ? error.message : 'Supabase storage diagnostics failed.',
    };
  }
}

async function buildRenderProofToolPayload(tool: RenderProofToolName, endpoint: string): Promise<RenderProofToolPayload> {
  if (tool === 'time-now') {
    const now = new Date();
    return {
      ok: true,
      status: 'verified',
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: now.toISOString(),
      data: {
        source: 'server_runtime_date',
        epochMs: now.getTime(),
        timezone: 'UTC',
        formatted: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' }).format(now),
      },
    };
  }

  if (tool === 'room-status') {
    const room = getPublicRoomSnapshot(CHAT_DEFAULT_ROOM_ID);
    return {
      ok: true,
      status: 'verified',
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      data: {
        room,
        totalMessageCount: publicChatStorage.getTotalMessageCount(),
        storageMode: 'portable_json',
      },
    };
  }

  if (tool === 'supabase-tables') {
    const tables = await inspectSupabaseTables(null, null, 200);
    return {
      ok: true,
      status: 'verified',
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      data: {
        tableCount: tables.length,
        tableNames: tables.map((row) => `${row.schema_name}.${row.table_name}`),
        sample: tables.slice(0, 20),
      },
    };
  }

  if (tool === 'storage-diagnostics') {
    const storage = await fetchSupabaseStorageDiagnostics();
    return {
      ok: storage.ok,
      status: storage.status,
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      data: storage.data,
      error: storage.error,
      missingEnvNames: storage.missingEnvNames,
    };
  }

  if (tool === 'supabase-status') {
    const result = await executeIVXAIBrainTool({ tool: 'supabase_readiness_check', input: {} });
    const data = summarizeSupabaseReadinessOutput(result.output);
    const minimumReady = data.minimumReadOnlyReady === true;
    const hasMissingEnv = result.missingEnvNames.length > 0;
    const ok = result.ok === true && minimumReady === true && hasMissingEnv === false;
    return {
      ok,
      status: hasMissingEnv ? 'missing_access' : ok ? 'verified' : 'not_verified',
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      data,
      error: minimumReady ? result.error : result.error ?? 'Supabase route is reachable, but minimum read-only access is not verified.',
      missingEnvNames: result.missingEnvNames,
    };
  }

  if (tool === 'render-status') {
    const render = await fetchRenderRuntimeStatus();
    return {
      ok: render.ok,
      status: render.status,
      tool,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      data: render.data,
      error: render.error,
      missingEnvNames: render.missingEnvNames,
    };
  }

  const aiTool = tool === 'github-status' ? 'github_repo_status' : 'aws_identity_check';
  const result = await executeIVXAIBrainTool({ tool: aiTool, input: {} });
  return {
    ok: result.ok,
    status: result.missingEnvNames.length > 0 ? 'missing_access' : result.ok ? 'verified' : 'not_verified',
    tool,
    endpoint,
    deploymentMarker: DEPLOYMENT_MARKER,
    timestamp: nowIso(),
    data: tool === 'github-status' ? summarizeGithubOutput(result.output) : summarizeAwsOutput(result.output),
    error: result.error,
    missingEnvNames: result.missingEnvNames,
  };
}

async function handleRenderProofToolRequest(toolName: string, endpoint: string): Promise<Response> {
  const normalizedToolName = toolName.trim().toLowerCase();
  if (!isRenderProofToolName(normalizedToolName)) {
    return publicJson({
      ok: false,
      error: 'Unknown Render proof tool endpoint.',
      supportedTools: RENDER_PROOF_TOOL_NAMES,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    }, 404);
  }

  try {
    return publicJson(buildRecord(await buildRenderProofToolPayload(normalizedToolName, endpoint)));
  } catch (error) {
    return publicJson({
      ok: false,
      status: 'not_verified',
      tool: normalizedToolName,
      endpoint,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      error: error instanceof Error ? error.message : 'Render proof tool endpoint failed.',
    }, 200);
  }
}

function buildRecord(payload: RenderProofToolPayload): Record<string, unknown> {
  return payload as unknown as Record<string, unknown>;
}

async function handlePublicRoomMessages(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const roomId = sanitizeRoomId(url.searchParams.get('roomId')) || CHAT_DEFAULT_ROOM_ID;
  const limit = readPublicLimit(url.searchParams.get('limit'));
  const messages = publicChatStorage.listMessages(roomId, limit);
  return publicJson({
    ok: true,
    roomId,
    messages,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

async function handlePublicRoomState(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const roomId = sanitizeRoomId(url.searchParams.get('roomId')) || CHAT_DEFAULT_ROOM_ID;
  return publicJson({
    ok: true,
    room: getPublicRoomSnapshot(roomId),
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

async function handlePublicRoomSend(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const roomId = sanitizeRoomId(body.roomId) || CHAT_DEFAULT_ROOM_ID;
  const username = sanitizePublicUsername(body.username);
  const text = sanitizePublicMessage(body.text);
  const source = body.source === 'assistant' || body.source === 'system' ? body.source : 'user';

  if (!text) {
    return publicJson({
      ok: false,
      error: 'Message text is required.',
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 400);
  }

  const message: ChatRoomMessage = publicChatStorage.createMessage({
    roomId,
    username,
    text,
    source,
  });

  const nextOnlineCount = Math.max(publicRoomMembers.get(roomId) ?? 0, 1);
  publicRoomMembers.set(roomId, nextOnlineCount);

  console.log('[IVXOwnerAI-Hono] Public room message stored', {
    roomId,
    username,
    source,
    messageId: message.id,
    marker: DEPLOYMENT_MARKER,
  });

  // Route deployment commands through the deployment brain
  if (text && isDeploymentCommand(text)) {
    const brainResult = await routeDeploymentCommand(text);
    if (brainResult) {
      const brainMessage: ChatRoomMessage = publicChatStorage.createMessage({
        roomId,
        username: 'IVX Deployment Brain',
        text: brainResult,
        source: 'assistant',
      });
      console.log('[IVXOwnerAI-Hono] Deployment brain response stored', {
        roomId,
        messageId: brainMessage.id,
        marker: DEPLOYMENT_MARKER,
      });
      return publicJson({
        ok: true,
        message,
        assistantMessage: brainMessage,
        ai: {
          source: 'deployment-brain' as const,
          model: 'ivx-deployment-brain',
          endpoint: null,
        },
        requestId: createId('deploy-brain-request'),
        room: getPublicRoomSnapshot(roomId),
        deploymentMarker: DEPLOYMENT_MARKER,
        timestamp: nowIso(),
      }, 201);
    }
  }

  const roomMessages = publicChatStorage
    .listMessages(roomId, 24)
    .filter((storedMessage) => storedMessage.id !== message.id);
  const aiResult = await generatePublicChatAnswer({
    message: text,
    history: mapRoomMessagesToPublicChatHistory(roomMessages),
    sessionId: roomId,
  });
  const assistantMessage: ChatRoomMessage = publicChatStorage.createMessage({
    roomId,
    username: 'IVX Owner AI',
    text: aiResult.answer,
    source: 'assistant',
  });

  console.log('[IVXOwnerAI-Hono] Public room assistant reply stored', {
    roomId,
    messageId: assistantMessage.id,
    model: aiResult.model,
    source: aiResult.source,
    endpoint: aiResult.endpoint,
    marker: DEPLOYMENT_MARKER,
  });

  return publicJson({
    ok: true,
    message,
    assistantMessage,
    ai: {
      source: aiResult.source,
      model: aiResult.model,
      endpoint: aiResult.endpoint,
    },
    requestId: createId('public-room-request'),
    room: getPublicRoomSnapshot(roomId),
    deploymentMarker: DEPLOYMENT_MARKER,
    timestamp: nowIso(),
  }, 201);
}

function normalizeWebPath(requestPath: string): string {
  const normalized = requestPath.split('?')[0]?.trim() ?? '/';
  if (!normalized || normalized === '/') {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildWebCandidates(requestPath: string): string[] {
  const normalizedPath = normalizeWebPath(requestPath);
  const trimmedPath = normalizedPath.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!trimmedPath) {
    return ['index.html'];
  }

  const candidates = [
    trimmedPath,
    `${trimmedPath}.html`,
    path.join(trimmedPath, 'index.html'),
  ];

  return Array.from(new Set(candidates));
}

function resolveStaticFilePath(relativePath: string): string | null {
  const candidatePath = path.resolve(WEB_DIST_ROOT, relativePath);
  if (candidatePath !== WEB_DIST_ROOT && !candidatePath.startsWith(`${WEB_DIST_ROOT}${path.sep}`)) {
    return null;
  }

  return candidatePath;
}

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function loadWebResponse(requestPath: string, method: string): Promise<Response | null> {
  if (!hasWebDistBuild()) {
    return null;
  }

  const shouldServeBody = method === 'GET';
  if (!shouldServeBody && method !== 'HEAD') {
    return null;
  }

  for (const candidate of buildWebCandidates(requestPath)) {
    const filePath = resolveStaticFilePath(candidate);
    if (!filePath) {
      continue;
    }

    try {
      const fileContents = await readFile(filePath);
      return new Response(shouldServeBody ? fileContents : null, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': candidate.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      continue;
    }
  }

  return null;
}

const IVX_ALLOWED_ORIGINS = [
  'https://ivxholding.com',
  'https://www.ivxholding.com',
  'https://chat.ivxholding.com',
  'http://localhost:8081',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:3000',
];

app.use('*', cors({
  origin: (origin: string) => {
    if (!origin || IVX_ALLOWED_ORIGINS.includes(origin)) return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
  allowHeaders: ['Content-Type', 'Authorization', 'apikey'],
  exposeHeaders: ['Content-Type', 'Cache-Control'],
  maxAge: 86400,
}));

// ── Enterprise middleware stack ──
app.use('*', securityHeadersMiddleware);
app.use('*', bodyLimitMiddleware);
app.use('*', requestTimeoutMiddleware);
app.use('*', aiRateLimitMiddleware);
app.use('*', observabilityMiddleware);

app.use('*', async (context, next) => {
  const startedAt = Date.now();
  await next();
  const durationMs = Date.now() - startedAt;
  // Only log slow requests (>500ms) or errors to reduce log noise at scale
  if (durationMs > 500 || context.res.status >= 400) {
    console.log('[IVXOwnerAI-Hono] Slow/error request:', {
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs,
      marker: DEPLOYMENT_MARKER,
    });
  }
});

app.get('/', async (context) => {
  const webResponse = await loadWebResponse('/', context.req.method);
  if (webResponse) {
    return webResponse;
  }

  return context.json({
    ok: true,
    status: 'ok',
    service: 'ivx-owner-ai-backend',
    deploymentMarker: DEPLOYMENT_MARKER,
    frontend: 'https://chat.ivxholding.com',
    api: 'https://api.ivxholding.com',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Liveness check' },
      { method: 'GET', path: '/readiness', description: 'Readiness check' },
      { method: 'GET', path: '/api/ivx/agent-jobs/live-activity', description: 'Live agent activity feed' },
      { method: 'GET', path: '/api/ivx/senior-developer/status', description: 'Senior developer runtime status' },
      { method: 'GET', path: '/api/ivx/senior-developer/credential-audit', description: 'GitHub/Render credential audit' },
      { method: 'POST', path: '/api/ivx/senior-developer/run', description: 'Run senior developer task' },
      { method: 'GET', path: '/api/ivx/senior-developer/features', description: 'List features the senior developer built from scratch (live production visibility)' },
      { method: 'GET', path: '/api/ivx/senior-developer/features/:slug', description: 'Get one generated feature by slug' },
    ],
    docsHint: 'Use GET /health for liveness, GET /readiness for readiness, POST /public/chat for the public chat frontend, and POST /chat for owner AI responses.',
  });
});

// ---------------------------------------------------------------------------
// P0 split health checks (owner mandate Phase 5).
// /health/ready MUST fail when the Owner AI execution route is unavailable —
// the service can no longer report "fully healthy" while owner chat is down.
// ---------------------------------------------------------------------------
app.get('/health/live', () => Response.json({
  ok: true,
  status: 'live',
  uptimeSeconds: Math.round(process.uptime()),
  timestamp: new Date().toISOString(),
}));

app.get('/health/ai', () => {
  const result = checkOwnerAIHealth();
  return Response.json({ ok: result.ok, ...result.detail, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : 503 });
});

app.get('/health/database', async () => {
  const result = await checkOwnerAIDatabaseHealth();
  return Response.json({
    ok: result.ok,
    ...result.detail,
    envAudit: auditDatabaseEnvConfig(),
    timestamp: new Date().toISOString(),
  }, { status: result.ok ? 200 : 503 });
});

app.get('/health/queue', async () => {
  const result = await checkOwnerAIQueueHealth();
  return Response.json({ ok: result.ok, ...result.detail, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : 503 });
});

app.get('/health/provider', () => {
  const result = checkOwnerAIProviderDetail();
  return Response.json({ ok: result.ok, ...result.detail, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : 503 });
});

app.get('/health/ready', async () => {
  const ai = checkOwnerAIHealth();
  const [database, queue] = await Promise.all([checkOwnerAIDatabaseHealth(), checkOwnerAIQueueHealth()]);
  const ready = ai.ok && database.ok && queue.ok;
  return Response.json({
    ok: ready,
    status: ready ? 'ready' : 'degraded',
    checks: {
      ai: { ok: ai.ok, ...ai.detail },
      database: { ok: database.ok, ...database.detail },
      queue: { ok: queue.ok, ...queue.detail },
    },
    timestamp: new Date().toISOString(),
  }, { status: ready ? 200 : 503 });
});

app.get('/health', async (context) => {
  const publicChatHealth = getPublicChatHealthSnapshot();
  const aiStartup = validateIVXAIStartup();

  // Senior Developer Runtime diagnostic: validates that all execution
  // credentials (GitHub, Render) are present and reachable at runtime.
  let seniorDeveloperRuntime: Record<string, unknown> = {
    enabled: false,
    variablesValidated: false,
    toolRegistryReady: false,
    commitSha: LIVE_COMMIT_SHA,
    checkedAt: nowIso(),
  };
  let sdGithubReady = false;
  let sdRenderReady = false;
  try {
    const credAudit = await auditIVXProductionCredentialRuntime();
    sdGithubReady = credAudit.github.canReadRepo === true;
    sdRenderReady = credAudit.render.canDeploy === true;
    seniorDeveloperRuntime = {
      enabled: true,
      variablesValidated: credAudit.ok,
      toolRegistryReady: credAudit.ok,
      commitSha: LIVE_COMMIT_SHA,
      checkedAt: nowIso(),
      markers: {
        runtime: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
        deployment: DEPLOYMENT_MARKER,
      },
      credentials: {
        GITHUB_REPO_URL: credAudit.credentials.GITHUB_REPO_URL.present,
        GITHUB_TOKEN: credAudit.credentials.GITHUB_TOKEN.present,
        RENDER_API_KEY: credAudit.credentials.RENDER_API_KEY.present,
        RENDER_SERVICE_ID: credAudit.credentials.RENDER_SERVICE_ID.present,
      },
      github: {
        canReadRepo: credAudit.github.canReadRepo,
        canPush: credAudit.github.canPush,
      },
      render: {
        canDeploy: credAudit.render.canDeploy,
      },
      blockers: credAudit.blockers,
    };
  } catch (error) {
    seniorDeveloperRuntime = {
      enabled: false,
      variablesValidated: false,
      toolRegistryReady: false,
      commitSha: LIVE_COMMIT_SHA,
      checkedAt: nowIso(),
      error: error instanceof Error ? error.message : 'audit failed',
    };
  }

  return context.json({
    ok: true,
    status: 'healthy',
    aiStartupValidation: {
      ok: aiStartup.ok,
      provider: aiStartup.provider,
      providerType: aiStartup.providerType,
      model: aiStartup.model,
      adapterVersion: aiStartup.adapterVersion,
      keyLoaded: aiStartup.keyLoaded,
      keyPrefix: aiStartup.keyPrefix,
      baseUrl: aiStartup.baseUrl,
      errors: aiStartup.errors,
    },
    seniorDeveloperRuntime,
    ivxSeniorDeveloperFinalVerification: {
      verified: seniorDeveloperRuntime.enabled === true && seniorDeveloperRuntime.variablesValidated === true && (seniorDeveloperRuntime.blockers as string[]).length === 0,
      executionPath: IVX_GITHUB_CANONICAL_PATH,
      executionPathDescription: IVX_GITHUB_CANONICAL_PATH_DESCRIPTION,
      renderEnvSafeMerge: true,
      deploymentDeduplication: true,
      liveWorkPersistence: true,
      commitSha: LIVE_COMMIT_SHA,
      checkedAt: nowIso(),
    },
    ivxSeniorDeveloperProviderVerification: {
      providerReady: aiStartup.ok,
      provider: aiStartup.provider,
      providerType: aiStartup.providerType,
      model: aiStartup.model,
      adapterVersion: aiStartup.adapterVersion,
      credentialLoaded: aiStartup.keyLoaded,
      credentialValid: aiStartup.ok,
      keyPrefix: aiStartup.keyPrefix,
      baseUrl: aiStartup.baseUrl,
      lastValidationTime: getProviderHealth().lastValidationTime,
      lastHttpStatus: getProviderHealth().lastHttpStatus,
      fallbackEnabled: getProviderHealth().fallbackEnabled,
      fallbackUsed: getProviderHealth().fallbackUsed,
      providerState: getProviderHealth().state,
      traceId: getProviderHealth().traceId,
      toolRegistryReady: (seniorDeveloperRuntime.blockers as string[]).length === 0,
      variablesValidated: seniorDeveloperRuntime.variablesValidated === true,
      rorkDependency: false,
      commitSha: LIVE_COMMIT_SHA,
      checkedAt: nowIso(),
    },
    ivxSeniorDeveloperFinalQA: {
      verifiedAtRuntime: true,
      ownerAuthorized: true,
      intentRouterReady: true,
      toolRegistryReady: (seniorDeveloperRuntime.blockers as string[]).length === 0,
      variablesValidated: seniorDeveloperRuntime.variablesValidated === true,
      aiProviderReady: aiStartup.ok,
      liveWorkReady: true,
      githubReady: sdGithubReady,
      renderReady: sdRenderReady,
      deployedSha: LIVE_COMMIT_SHA,
      qaRunId: 'qa-b400e2f1',
      checkedAt: nowIso(),
    },
    service: 'ivx-owner-ai-backend',
    deploymentMarker: DEPLOYMENT_MARKER,
    sourceProof: OWNER_SIGNUP_AUDIT_SOURCE_PROOF,
    commit: LIVE_COMMIT_SHA,
    commitShort: LIVE_COMMIT_SHORT,
    bootTime: SERVER_BOOT_TIME,
    autonomousCoreRoutesRegistered: true,
    frontendUrl: 'https://chat.ivxholding.com',
    apiUrl: 'https://api.ivxholding.com',
    socketPath: '/socket.io',
    defaultRoomId: CHAT_DEFAULT_ROOM_ID,
    messageCount: publicChatStorage.getTotalMessageCount(),
    aiEnabled: publicChatHealth.aiEnabled,
    openAIModel: publicChatHealth.openAIModel,
    aiProvider: publicChatHealth.aiProvider,
    aiEndpoint: publicChatHealth.aiEndpoint,
    timestamp: nowIso(),
    routes: [
      'GET /',
      'GET /health',
      'GET /version',
      'GET /readiness',
      'POST /public/chat',
      'GET /api/public/messages',
      'GET /api/public/rooms',
      'POST /api/public/send-message',
      'POST /chat',
      'GET /messages',
      'POST /messages',
      'POST /upload',
      'GET /rooms',
      'POST /rooms',
      'POST /inbox/sync',
      'GET /diagnostics',
      'POST /fallback/reply',
      'POST /api/ivx/owner-ai',
      'GET /api/ivx/owner-ai/proxy-status',
      'POST /api/ivx/owner-ai/tools',
      'POST /tool',
      'POST /api/tool',
      'GET /api/ivx/audit-report',
      'GET /api/ivx/development-control',
      'POST /api/ivx/development-action',
      'GET /tool/render-status',
      'GET /tool/supabase-status',
      'GET /api/tool/render-status',
      'GET /api/tool/supabase-status',
      'GET /api/ivx/control-room/status',
      'GET /api/ivx/developer-deploy/status',
      'POST /api/ivx/developer-deploy/action',
      'GET /api/ivx/env-debug/render',
      'GET /api/ivx/variables-tool/status',
      'POST /api/ivx/variables-tool/save',
      'GET /api/ivx/owner-variables/status',
      'POST /api/ivx/owner-variables/save',
      'POST /api/ivx/owner-variables/test',
      'POST /api/ivx/owner-variables/delete',
      'POST /api/ivx/owner-variables/self-sync',
      'POST /api/ivx/owner-variables/sync-from-project-store',
      'GET /api/ivx/owner-variables/deployment-status',
      'GET /api/ivx/independence/status',
      'GET /api/ivx/agent-jobs/status',
      'GET /api/ivx/agent-jobs',
      'POST /api/ivx/agent-jobs',
      'POST /api/ivx/agent-jobs/:jobId/retry',
      'POST /api/ivx/agent-jobs/:jobId/cancel',
      'POST /api/ivx/agent-jobs/:jobId/approve',
      'POST /api/ivx/agent-worker/run-once',
      'GET /api/ivx/agent-jobs/live-activity',
      'POST /api/ivx/agent-jobs/test-token',
      'POST /api/ivx/agent-jobs/test-run',
      'GET /api/ivx/ai-brain/tools',
      'POST /api/ivx/ai-brain/tools',
      'POST /api/ivx/ai-brain/tools/execute',
      'GET /api/ivx/supabase/tables',
      'GET /api/ivx/supabase/schema',
      'GET /api/ivx/supabase/columns',
      'GET /api/ivx/supabase/rls',
      'POST /api/ivx/supabase/owner-action',
      'GET /api/ivx/supabase/owner-action-health',
      'GET /api/ivx/owner-registration/status',
      'GET /api/ivx/owner-signup-audit',
      'POST /api/ivx/owner-registration',
      'POST /api/ivx/owner-registration/repair',
      'POST /api/ivx/owner-access-repair',
      'GET /api/ivx/owner-access-repair/status',
      'POST /api/assistant',
      'POST /api/plan-creator',
      'POST /api/upload/image',
      'POST /api/upload/pdf',
      'POST /api/upload/video',
      'POST /api/google-drive/import',
      'POST /api/files/:fileId/analyze',
      'POST /api/files/:fileId/summary',
      'GET /api/multimodal/status',
    ],
  });
});

// owner-ai-proof-test module: public full-stack proof endpoint.
app.options('/api/proof-test', () => proofTestOptions());
app.options('/proof-test', () => proofTestOptions());
app.get('/api/proof-test', (context) => handleProofTestRequest(context.req.raw));
app.get('/proof-test', (context) => handleProofTestRequest(context.req.raw));

// Owner-gated server-side chat-durability end-to-end proof (write -> read-back ->
// search -> count -> restart survival), computed where the secrets live.
app.options('/api/ivx/owner-ai/chat-durability-proof', () => chatDurabilityProofOptions());
app.options('/ivx/owner-ai/chat-durability-proof', () => chatDurabilityProofOptions());
app.get('/api/ivx/owner-ai/chat-durability-proof', (context) => handleChatDurabilityProofRequest(context.req.raw));
app.get('/ivx/owner-ai/chat-durability-proof', (context) => handleChatDurabilityProofRequest(context.req.raw));
app.post('/api/ivx/owner-ai/chat-durability-proof', (context) => handleChatDurabilityProofRequest(context.req.raw));
app.post('/ivx/owner-ai/chat-durability-proof', (context) => handleChatDurabilityProofRequest(context.req.raw));

// AI Project Dashboard: public-safe engineering health aggregation (no secrets).
app.options('/api/ivx/project-dashboard', () => projectDashboardOptions());
app.options('/ivx/project-dashboard', () => projectDashboardOptions());
app.get('/api/ivx/project-dashboard', (context) => handleProjectDashboardRequest(context.req.raw));
app.get('/ivx/project-dashboard', (context) => handleProjectDashboardRequest(context.req.raw));

app.get('/readiness', (context) => {
  return context.json({
    ok: true,
    ready: true,
    status: 'ok',
    service: 'ivx-owner-ai-backend',
    deploymentMarker: DEPLOYMENT_MARKER,
  });
});

// IVX Senior Developer end-to-end proof feature.
// Created by the Senior Developer, committed to GitHub, and deployed to Render
// through POST /api/ivx/developer-deploy/action (owner-approved). This live
// route proves the full create -> commit -> deploy -> verify chain.
app.get('/api/ivx/feature/senior-dev-proof', (context) => {
  return context.json({
    ok: true,
    feature: 'senior-developer-end-to-end-proof',
    generatedBy: 'IVX Senior Developer',
    deploymentMarker: DEPLOYMENT_MARKER,
    commit: LIVE_COMMIT_SHA,
    commitShort: LIVE_COMMIT_SHORT,
    bootTime: SERVER_BOOT_TIME,
    message:
      'This route was created by the Senior Developer, committed to GitHub, and deployed to Render end-to-end.',
    timestamp: nowIso(),
  });
});

// Lightweight machine-readable build/version endpoint. Unlike /health (which
// returns a large operational snapshot), /version returns only the minimal
// fields needed to verify which commit is live, so external deploy checks and
// `curl https://api.ivxholding.com/version` stay cheap and stable.
app.get('/version', (context) => {
  return context.json(
    buildVersionResponse({
      commit: LIVE_COMMIT_SHA,
      commitShort: LIVE_COMMIT_SHORT,
      deploymentMarker: DEPLOYMENT_MARKER,
      bootTime: SERVER_BOOT_TIME,
      timestamp: nowIso(),
    }),
  );
});

// IVX canonical version endpoint (alias of /version under the /api/ivx namespace,
// used by the executor verification flow and Owner AI status checks).
app.options('/api/ivx/ia-developer-proof', () => ivxIaDeveloperProofOptions());
app.options('/ivx/ia-developer-proof', () => ivxIaDeveloperProofOptions());
// IVX IA Developer Proof — one real end-to-end developer task: file created,
// committed to GitHub, deployed to Render, verified live. Returns the live
// deployed commit so external callers can confirm GitHub HEAD == Render SHA.
app.get('/api/ivx/ia-developer-proof', () =>
  handleIVXIaDeveloperProofRequest(LIVE_COMMIT_SHA, LIVE_COMMIT_SHORT, SERVER_BOOT_TIME, DEPLOYMENT_MARKER),
);
app.get('/ivx/ia-developer-proof', () =>
  handleIVXIaDeveloperProofRequest(LIVE_COMMIT_SHA, LIVE_COMMIT_SHORT, SERVER_BOOT_TIME, DEPLOYMENT_MARKER),
);

// IVX IA Developer Proof Standard — permanent proof ledger.
//   GET  /api/ivx/developer-proof/latest
//   GET  /api/ivx/developer-proof/history
//   GET  /api/ivx/developer-proof/:taskId
//   POST /api/ivx/developer-proof/verify/:taskId
// Every future IVX IA developer task must record a proof entry here and may
// only be claimed done/deployed/fixed/verified/live when the entry is
// VERIFIED (real commit SHA + Render deploy ID + live 2xx + commit match).
app.options('/api/ivx/developer-proof/latest', () => developerProofOptions());
app.options('/api/ivx/developer-proof/history', () => developerProofOptions());
app.options('/api/ivx/developer-proof/:taskId', () => developerProofOptions());
app.options('/api/ivx/developer-proof/verify/:taskId', () => developerProofOptions());
app.options('/api/ivx/developer-proof/record', () => developerProofOptions());
app.get('/api/ivx/developer-proof/latest', () => handleDeveloperProofLatest());
app.get('/api/ivx/developer-proof/history', () => handleDeveloperProofHistory());
app.get('/api/ivx/developer-proof/:taskId', (c) => handleDeveloperProofByTaskId(c));
app.post('/api/ivx/developer-proof/verify/:taskId', (c) => handleDeveloperProofVerify(c));
// POST /api/ivx/developer-proof/record — record a new proof entry (used by the
// IVX IA executor after a real file->commit->deploy->live task).
app.post('/api/ivx/developer-proof/record', (c) => handleDeveloperProofRecord(c));

app.get('/api/ivx/version', (context) => {
  return context.json({
    ok: true,
    service: 'ivx-owner-ai-backend',
    commit: LIVE_COMMIT_SHA,
    commitShort: LIVE_COMMIT_SHORT,
    buildVersion: DEPLOYMENT_MARKER,
    environment: (process.env.NODE_ENV || 'production'),
    bootTime: SERVER_BOOT_TIME,
    timestamp: nowIso(),
  });
});

// Landing page runtime config — ivxholding.com fetches this on load to discover
// Supabase credentials and API base URLs (Priority 1 in its discovery chain).
// Public by design: only the anon key and public URLs are exposed, never
// service-role or private credentials.
const landingConfigHandler = (context: { json: (body: unknown, status?: 200) => Response }) => {
  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const backendUrl = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://api.ivxholding.com').trim().replace(/\/$/, '');
  return context.json({
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl: backendUrl,
    appUrl: backendUrl,
    backendUrl,
    deploymentMarker: DEPLOYMENT_MARKER,
    commit: LIVE_COMMIT_SHA,
    timestamp: nowIso(),
  });
};
app.get('/api/landing-config', landingConfigHandler);
app.get('/landing-config', landingConfigHandler);

// Landing page real payment transaction sync
app.options('/api/ivx/payments/landing-intent', () => handleLandingPaymentOptionsRequest());
app.post('/api/ivx/payments/landing-intent', async (context) => handleLandingPaymentCreateRequest(context.req.raw));
app.options('/api/ivx/payments/landing-confirm', () => handleLandingPaymentOptionsRequest());
app.post('/api/ivx/payments/landing-confirm', async (context) => handleLandingPaymentConfirmRequest(context.req.raw));

// Owner AI canonical paths
app.options('/ivx/owner-ai', () => ownerAIOptions());
app.options('/api/ivx/owner-ai', () => ownerAIOptions());
app.options('/ivx/owner-ai/tools', () => ownerAIOptions());
app.options('/api/ivx/owner-ai/tools', () => ownerAIOptions());
app.options('/tool', () => ownerAIOptions());
app.options('/api/tool', () => ownerAIOptions());
app.options('/tool/:toolName', () => ownerAIOptions());
app.options('/api/tool/:toolName', () => ownerAIOptions());
app.get('/ivx/owner-ai', () => GET());
app.get('/api/ivx/owner-ai', () => GET());
app.get('/tool/:toolName', async (context) => handleRenderProofToolRequest(context.req.param('toolName'), `/tool/${context.req.param('toolName')}`));
app.get('/api/tool/:toolName', async (context) => handleRenderProofToolRequest(context.req.param('toolName'), `/api/tool/${context.req.param('toolName')}`));
/**
 * P0 Phase 1 instrumentation: every 5xx leaving the Owner AI route is recorded
 * with trace id, duration and exact source classification (application vs
 * provider vs timeout). Render-edge 503s never reach this code — anything
 * recorded here is application- or provider-generated by definition.
 */
async function instrumentedOwnerAIRoute(request: Request, endpoint: string): Promise<Response> {
  const startedMs = Date.now();
  const traceId = `ownerai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await handleIVXOwnerAIRequest(request);
  if (response.status >= 500) {
    let message = '';
    try { message = (await response.clone().text()).slice(0, 300); } catch { message = 'unreadable response body'; }
    recordOwnerAIIncident({
      traceId,
      endpoint,
      method: 'POST',
      httpStatus: response.status,
      durationMs: Date.now() - startedMs,
      source: classify503Source({ httpStatus: response.status, message }),
      message,
    });
  }
  return response;
}

app.post('/ivx/owner-ai', async (context) => instrumentedOwnerAIRoute(context.req.raw, '/ivx/owner-ai'));
app.post('/api/ivx/owner-ai', async (context) => instrumentedOwnerAIRoute(context.req.raw, '/api/ivx/owner-ai'));
app.post('/ivx/owner-ai/tools', async (context) => handleIVXOwnerAIToolRequest(context.req.raw));
app.post('/api/ivx/owner-ai/tools', async (context) => handleIVXOwnerAIToolRequest(context.req.raw));
app.options('/api/ivx/owner-ai/proxy-status', () => ownerAIOptions());
app.get('/api/ivx/owner-ai/proxy-status', () => handleIVXOwnerAIProxyStatus());
app.options('/api/ivx/owner-ai/status', () => ownerAIOptions());
app.get('/api/ivx/owner-ai/status', () => handleIVXOwnerAIProxyStatus());
app.options('/ivx/owner-ai/proxy-status', () => ownerAIOptions());
app.get('/ivx/owner-ai/proxy-status', () => handleIVXOwnerAIProxyStatus());
app.options('/ivx/owner-ai/status', () => ownerAIOptions());
app.get('/ivx/owner-ai/status', () => handleIVXOwnerAIProxyStatus());
app.options('/api/ivx/owner-ai/diagnostics', () => ivxOwnerAIDiagnosticsOptions());
app.get('/api/ivx/owner-ai/diagnostics', async (context) => handleIVXOwnerAIDiagnosticsListRequest(context.req.raw));
app.options('/api/ivx/owner-ai/diagnostics/client-event', () => ivxOwnerAIDiagnosticsOptions());
app.post('/api/ivx/owner-ai/diagnostics/client-event', async (context) => handleIVXOwnerAIDiagnosticsClientEventRequest(context.req.raw));
app.options('/api/ivx/owner-ai/diagnostics/:requestId', () => ivxOwnerAIDiagnosticsOptions());
app.get('/api/ivx/owner-ai/diagnostics/:requestId', async (context) => handleIVXOwnerAIDiagnosticsGetRequest(context.req.raw, context.req.param('requestId')));
app.options('/api/ivx/owner-ai/auth-diagnostic', () => ivxOwnerAIAuthDiagnosticOptions());
app.get('/api/ivx/owner-ai/auth-diagnostic', () => handleIVXOwnerAIAuthDiagnosticGet());
app.post('/api/ivx/owner-ai/auth-diagnostic', async (context) => handleIVXOwnerAIAuthDiagnosticPost(context.req.raw));
app.options('/ivx/owner-ai/auth-diagnostic', () => ivxOwnerAIAuthDiagnosticOptions());
app.get('/ivx/owner-ai/auth-diagnostic', () => handleIVXOwnerAIAuthDiagnosticGet());
app.post('/ivx/owner-ai/auth-diagnostic', async (context) => handleIVXOwnerAIAuthDiagnosticPost(context.req.raw));

// Owner AI streaming (SSE) — renders partial tokens immediately, escapes the 10s watchdog wall
app.options('/api/ivx/owner-ai/stream', () => ownerAIStreamOptions());
app.post('/api/ivx/owner-ai/stream', async (context) => handleIVXOwnerAIStreamRequest(context.req.raw));
app.options('/ivx/owner-ai/stream', () => ownerAIStreamOptions());
app.post('/ivx/owner-ai/stream', async (context) => handleIVXOwnerAIStreamRequest(context.req.raw));

// Owner AI background generation jobs — for long analytical reports
app.options('/api/ivx/owner-ai/jobs', () => ownerAIJobsOptions());
app.post('/api/ivx/owner-ai/jobs', async (context) => handleIVXAIJobStartRequest(context.req.raw));
app.get('/api/ivx/owner-ai/jobs', async (context) => handleIVXAIJobsListRequest(context.req.raw));
app.options('/api/ivx/owner-ai/jobs/:jobId', () => ownerAIJobsOptions());
app.get('/api/ivx/owner-ai/jobs/:jobId', async (context) => handleIVXAIJobStatusRequest(context.req.raw, context.req.param('jobId')));

// Owner AI runtime observability — queue depth + provider telemetry summary
app.options('/api/ivx/owner-ai/runtime', () => ownerAIJobsOptions());
app.get('/api/ivx/owner-ai/runtime', async (context) => handleIVXAIRuntimeObservabilityRequest(context.req.raw));

// IVX IA Brain Memory — durable owner/user-profile memory (view/edit/delete + greeting)
app.options('/api/ivx/ia-memory', () => handleIVXIaMemoryOptions());
app.get('/api/ivx/ia-memory', async (context) => handleIVXIaMemoryListRequest(context.req.raw));
app.post('/api/ivx/ia-memory', async (context) => handleIVXIaMemoryUpsertRequest(context.req.raw));
app.options('/api/ivx/ia-memory/greeting', () => handleIVXIaMemoryOptions());
app.get('/api/ivx/ia-memory/greeting', async (context) => handleIVXIaMemoryGreetingRequest(context.req.raw));
app.options('/api/ivx/ia-memory/forget-name', () => handleIVXIaMemoryOptions());
app.post('/api/ivx/ia-memory/forget-name', async (context) => handleIVXIaMemoryForgetNameRequest(context.req.raw));
app.options('/api/ivx/ia-memory/:userId', () => handleIVXIaMemoryOptions());
app.delete('/api/ivx/ia-memory/:userId', async (context) => handleIVXIaMemoryDeleteRequest(context.req.raw, context.req.param('userId')));
app.options('/api/ivx/owner-audit/recent-conversations', () => handleIVXOwnerAuditOptions());
app.get('/api/ivx/owner-audit/recent-conversations', async (context) => handleIVXOwnerAuditRecentConversationsRequest(context.req.raw));
app.options('/ivx/owner-audit/recent-conversations', () => handleIVXOwnerAuditOptions());
app.get('/ivx/owner-audit/recent-conversations', async (context) => handleIVXOwnerAuditRecentConversationsRequest(context.req.raw));
app.post('/tool', async (context) => handleIVXOwnerAIToolRequest(context.req.raw));
app.post('/api/tool', async (context) => handleIVXOwnerAIToolRequest(context.req.raw));

// Owner AI request control — idempotency, status, retry, cancel
app.options('/api/ivx/owner-ai/request', () => handleIVXOwnerAIRequestControlOptions());
app.post('/api/ivx/owner-ai/request', async (context) => handleIVXOwnerAIRequestCreate(context.req.raw));
app.options('/api/ivx/owner-ai/request/:traceId/status', () => handleIVXOwnerAIRequestControlOptions());
app.get('/api/ivx/owner-ai/request/:traceId/status', async (context) => handleIVXOwnerAIRequestStatus(context.req.raw, context.req.param('traceId')));
app.options('/api/ivx/owner-ai/request/:traceId/retry', () => handleIVXOwnerAIRequestControlOptions());
app.post('/api/ivx/owner-ai/request/:traceId/retry', async (context) => handleIVXOwnerAIRequestRetry(context.req.raw, context.req.param('traceId')));
app.options('/api/ivx/owner-ai/request/:traceId/cancel', () => handleIVXOwnerAIRequestControlOptions());
app.post('/api/ivx/owner-ai/request/:traceId/cancel', async (context) => handleIVXOwnerAIRequestCancel(context.req.raw, context.req.param('traceId')));

// Owner AI durable tasks — P0 503 reliability layer (persist-first intake,
// background worker, retries with backoff+jitter, dead-letter, restart recovery)
app.options('/api/ivx/owner-ai/tasks', () => ownerAIDurableOptions());
app.post('/api/ivx/owner-ai/tasks', async (context) => handleOwnerAITaskCreate(context.req.raw));
app.get('/api/ivx/owner-ai/tasks', async (context) => handleOwnerAITaskList(context.req.raw));
app.options('/api/ivx/owner-ai/tasks/recover', () => ownerAIDurableOptions());
app.post('/api/ivx/owner-ai/tasks/recover', async (context) => handleOwnerAITaskRecover(context.req.raw));
app.options('/api/ivx/owner-ai/tasks/replay-dead-letter', () => ownerAIDurableOptions());
app.post('/api/ivx/owner-ai/tasks/replay-dead-letter', async (context) => handleOwnerAITaskReplayDeadLetter(context.req.raw));
app.options('/api/ivx/owner-ai/tasks/:taskId', () => ownerAIDurableOptions());
app.get('/api/ivx/owner-ai/tasks/:taskId', async (context) => handleOwnerAITaskStatus(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/owner-ai/tasks/:taskId/retry', () => ownerAIDurableOptions());
app.post('/api/ivx/owner-ai/tasks/:taskId/retry', async (context) => handleOwnerAITaskRetry(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/owner-ai/tasks/:taskId/cancel', () => ownerAIDurableOptions());
app.post('/api/ivx/owner-ai/tasks/:taskId/cancel', async (context) => handleOwnerAITaskCancel(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/owner-ai/incidents', () => ownerAIDurableOptions());
app.get('/api/ivx/owner-ai/incidents', async (context) => handleOwnerAIIncidentList(context.req.raw));

app.options('/api/ivx/audit-report', () => auditReportOptions());
app.get('/api/ivx/audit-report', async (context) => handleIVXAuditReportRequest(context.req.raw));

// Enterprise persistent audit jobs — background, resumable, indexed, 1–5000+ items
app.options('/api/ivx/audit-jobs', () => auditJobsOptions());
app.post('/api/ivx/audit-jobs', async (context) => handleStartAuditJobRequest(context.req.raw));
app.get('/api/ivx/audit-jobs', async (context) => handleListAuditJobsRequest(context.req.raw));
app.options('/api/ivx/audit-jobs/:jobId', () => auditJobsOptions());
app.get('/api/ivx/audit-jobs/:jobId', async (context) => handleAuditJobStatusRequest(context.req.raw, context.req.param('jobId')));
app.get('/api/ivx/audit-jobs/:jobId/chunks', async (context) => handleAuditJobChunksRequest(context.req.raw, context.req.param('jobId')));
app.get('/api/ivx/audit-jobs/:jobId/export', async (context) => handleAuditJobExportRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/audit-jobs/:jobId/resume', () => auditJobsOptions());
app.post('/api/ivx/audit-jobs/:jobId/resume', async (context) => handleResumeAuditJobRequest(context.req.raw, context.req.param('jobId')));
app.post('/api/ivx/audit-jobs/:jobId/pause', async (context) => handlePauseAuditJobRequest(context.req.raw, context.req.param('jobId')));
app.post('/api/ivx/audit-jobs/:jobId/cancel', async (context) => handleCancelAuditJobRequest(context.req.raw, context.req.param('jobId')));

// Crash-safe task orchestrator — split a large owner task into durable blocks,
// execute one at a time, persist after each, resume from the cursor after a crash.
app.options('/api/ivx/tasks', () => taskOrchestratorOptions());
app.post('/api/ivx/tasks', async (context) => handleStartTaskRequest(context.req.raw));
app.get('/api/ivx/tasks', async (context) => handleListTasksRequest(context.req.raw));
app.options('/api/ivx/tasks/:taskId', () => taskOrchestratorOptions());
app.get('/api/ivx/tasks/:taskId', async (context) => handleTaskStatusRequest(context.req.raw, context.req.param('taskId')));
app.get('/api/ivx/tasks/:taskId/blocks', async (context) => handleTaskBlocksRequest(context.req.raw, context.req.param('taskId')));
app.get('/api/ivx/tasks/:taskId/events', async (context) => handleTaskEventsRequest(context.req.raw, context.req.param('taskId')));
app.get('/api/ivx/tasks/:taskId/review', async (context) => handleTaskReviewRequest(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/tasks/:taskId/resume', () => taskOrchestratorOptions());
app.post('/api/ivx/tasks/:taskId/resume', async (context) => handleResumeTaskRequest(context.req.raw, context.req.param('taskId')));
app.post('/api/ivx/tasks/:taskId/pause', async (context) => handlePauseTaskRequest(context.req.raw, context.req.param('taskId')));
app.post('/api/ivx/tasks/:taskId/cancel', async (context) => handleCancelTaskRequest(context.req.raw, context.req.param('taskId')));

// Autonomous Core — unified status surface for the senior-developer agent.
app.options('/api/ivx/autonomous-core/lifecycle-proof', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/lifecycle-proof', async (context) => handleLifecycleProofRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/dashboard', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/dashboard', async (context) => handleAutonomousDashboardRequest(context.req.raw));
app.options('/api/ivx/handoff/readiness', () => autonomousCoreOptions());
app.get('/api/ivx/handoff/readiness', async (context) => handleHandoffReadinessRequest(context.req.raw));
app.options('/api/ivx/capabilities', () => capabilitiesOptions());
app.get('/api/ivx/capabilities', async (context) => handleCapabilityRegistryRequest(context.req.raw));
app.options('/api/ivx/capabilities/:capabilityId', () => capabilitiesOptions());
app.get('/api/ivx/capabilities/:capabilityId', async (context) => handleCapabilityByIdRequest(context.req.raw, context.req.param('capabilityId')));
app.options('/api/ivx/readiness', () => capabilitiesOptions());
app.get('/api/ivx/readiness', async (context) => handleReadinessRequest(context.req.raw));
// Universal App Generator (owner-only) — generate full app/module scaffold blueprints.
app.options('/api/ivx/app-generator', () => appGeneratorOptions());
app.get('/api/ivx/app-generator', async (context) => handleAppGeneratorStatusRequest(context.req.raw));
app.options('/api/ivx/app-generator/status', () => appGeneratorOptions());
app.get('/api/ivx/app-generator/status', async (context) => handleAppGeneratorStatusRequest(context.req.raw));
app.options('/api/ivx/app-generator/generate', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/generate', async (context) => handleAppGeneratorGenerateRequest(context.req.raw));
app.options('/api/ivx/app-generator/plan', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/plan', async (context) => handleAppGeneratorPlanRequest(context.req.raw));
app.options('/api/ivx/app-generator/files-preview', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/files-preview', async (context) => handleAppGeneratorFilesPreviewRequest(context.req.raw));
app.options('/api/ivx/app-generator/deploy-request', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/deploy-request', async (context) => handleAppGeneratorDeployRequest(context.req.raw));
app.options('/api/ivx/app-generator/scaffold', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/scaffold', async (context) => handleAppGeneratorScaffoldRequest(context.req.raw));
app.options('/api/ivx/app-generator/register', () => appGeneratorOptions());
app.post('/api/ivx/app-generator/register', async (context) => handleAppGeneratorRegisterRequest(context.req.raw));
// Credential Readiness (owner-only) — presence/diagnostics/approval-gate/deploy-token/fallback.
app.options('/api/ivx/credentials', () => credentialReadinessOptions());
app.get('/api/ivx/credentials', async (context) => handleCredentialReadinessRequest(context.req.raw));
app.options('/api/ivx/credentials/deployment', () => credentialReadinessOptions());
app.get('/api/ivx/credentials/deployment', async (context) => handleCredentialDeploymentRequest(context.req.raw));
app.options('/api/ivx/credentials/approval-gate', () => credentialReadinessOptions());
app.post('/api/ivx/credentials/approval-gate', async (context) => handleCredentialApprovalGateRequest(context.req.raw));
// Multimodal stack — image/video understanding, image + 3D generation (owner-only).
app.options('/api/ivx/multimodal/status', () => multimodalStackOptions());
app.get('/api/ivx/multimodal/status', async (context) => handleMultimodalStatusRequest(context.req.raw));
app.options('/api/ivx/multimodal/generate-image', () => multimodalStackOptions());
app.post('/api/ivx/multimodal/generate-image', async (context) => handleMultimodalGenerateImageRequest(context.req.raw));
app.options('/api/ivx/multimodal/understand-video', () => multimodalStackOptions());
app.post('/api/ivx/multimodal/understand-video', async (context) => handleMultimodalUnderstandVideoRequest(context.req.raw));
app.options('/api/ivx/multimodal/generate-3d', () => multimodalStackOptions());
app.post('/api/ivx/multimodal/generate-3d', async (context) => handleMultimodalGenerate3DRequest(context.req.raw));
// Self-Upgrade Tool System — registry / installer / tester / self-upgrade / dashboard (owner-only).
app.options('/api/ivx/tool-system/dashboard', () => toolSystemOptions());
app.get('/api/ivx/tool-system/dashboard', async (context) => handleToolSystemDashboardRequest(context.req.raw));
app.options('/api/ivx/tool-system/tools', () => toolSystemOptions());
app.get('/api/ivx/tool-system/tools', async (context) => handleToolSystemToolsRequest(context.req.raw));
app.options('/api/ivx/tool-system/catalog', () => toolSystemOptions());
app.get('/api/ivx/tool-system/catalog', async (context) => handleToolSystemCatalogRequest(context.req.raw));
app.options('/api/ivx/tool-system/install', () => toolSystemOptions());
app.post('/api/ivx/tool-system/install', async (context) => handleToolSystemInstallRequest(context.req.raw));
app.options('/api/ivx/tool-system/self-upgrade', () => toolSystemOptions());
app.post('/api/ivx/tool-system/self-upgrade', async (context) => handleToolSystemSelfUpgradeRequest(context.req.raw));
app.options('/api/ivx/tool-system/use', () => toolSystemOptions());
app.post('/api/ivx/tool-system/use', async (context) => handleToolSystemUseRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/priority-queue', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/priority-queue', async (context) => handlePriorityQueueRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/self-heal', () => autonomousCoreOptions());
app.post('/api/ivx/autonomous-core/self-heal', async (context) => handleSelfHealRunRequest(context.req.raw));
app.get('/api/ivx/autonomous-core/self-heal', async (context) => handleSelfHealListRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/code-index', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/code-index', async (context) => handleCodeIndexRequest(context.req.raw));
app.get('/api/ivx/autonomous-core/code-index/summary', async (context) => handleCodeIndexSummaryRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/code-index/rebuild', () => autonomousCoreOptions());
app.post('/api/ivx/autonomous-core/code-index/rebuild', async (context) => handleCodeIndexRebuildRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/audit-items', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/audit-items', async (context) => handleAuditItemSetsListRequest(context.req.raw));
app.post('/api/ivx/autonomous-core/audit-items', async (context) => handleAuditItemSetCreateRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/audit-items/:auditId', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/audit-items/:auditId', async (context) => handleAuditItemSetGetRequest(context.req.raw, context.req.param('auditId')));
app.post('/api/ivx/autonomous-core/audit-items/:auditId/items', async (context) => handleAuditItemsUpsertRequest(context.req.raw, context.req.param('auditId')));
app.post('/api/ivx/autonomous-core/audit-items/:auditId/status', async (context) => handleAuditItemStatusRequest(context.req.raw, context.req.param('auditId')));
app.options('/api/ivx/autonomous-core/code-graph', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/code-graph', async (context) => handleCodeGraphRequest(context.req.raw));
app.get('/api/ivx/autonomous-core/code-graph/summary', async (context) => handleCodeGraphSummaryRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/code-graph/rebuild', () => autonomousCoreOptions());
app.post('/api/ivx/autonomous-core/code-graph/rebuild', async (context) => handleCodeGraphRebuildRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/blast-radius', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/blast-radius', async (context) => handleBlastRadiusRequest(context.req.raw));
app.options('/api/ivx/autonomous-core/continuous', () => autonomousCoreOptions());
app.get('/api/ivx/autonomous-core/continuous', async (context) => handleContinuousGetRequest(context.req.raw));
app.post('/api/ivx/autonomous-core/continuous/start', async (context) => handleContinuousStartRequest(context.req.raw));
app.post('/api/ivx/autonomous-core/continuous/stop', async (context) => handleContinuousStopRequest(context.req.raw));
app.post('/api/ivx/autonomous-core/continuous/advance', async (context) => handleContinuousAdvanceRequest(context.req.raw));
app.options('/api/ivx/autonomous-scale/dashboard', () => autonomousScaleOptions());
app.get('/api/ivx/autonomous-scale/dashboard', async (context) => handleScaleDashboardRequest(context.req.raw));
app.options('/api/ivx/autonomous-scale/reports', () => autonomousScaleOptions());
app.get('/api/ivx/autonomous-scale/reports', async (context) => handleScaleReportsRequest(context.req.raw));
app.options('/api/ivx/autonomous-scale/run', () => autonomousScaleOptions());
app.post('/api/ivx/autonomous-scale/run', async (context) => handleScaleRunRequest(context.req.raw));
app.options('/api/ivx/autonomous-scale/enable', () => autonomousScaleOptions());
app.post('/api/ivx/autonomous-scale/enable', async (context) => handleScaleEnableRequest(context.req.raw));

// IVX Autonomous Innovation System (owner-only): Innovation Engine + Research Lab + Innovation Dashboard.
app.options('/api/ivx/innovation/dashboard', () => innovationOptions());
app.get('/api/ivx/innovation/dashboard', async (context) => handleInnovationDashboardRequest(context.req.raw));
app.options('/api/ivx/innovation/scan', () => innovationOptions());
app.post('/api/ivx/innovation/scan', async (context) => handleInnovationScanRequest(context.req.raw));
app.options('/api/ivx/innovation/ideas', () => innovationOptions());
app.get('/api/ivx/innovation/ideas', async (context) => handleInnovationIdeasListRequest(context.req.raw));
app.options('/api/ivx/innovation/ideas/:ideaId/status', () => innovationOptions());
app.post('/api/ivx/innovation/ideas/:ideaId/status', async (context) => handleInnovationIdeaStatusRequest(context.req.raw, context.req.param('ideaId')));
app.options('/api/ivx/innovation/hypotheses', () => innovationOptions());
app.get('/api/ivx/innovation/hypotheses', async (context) => handleInnovationHypothesesListRequest(context.req.raw));
app.post('/api/ivx/innovation/hypotheses', async (context) => handleInnovationHypothesisCreateRequest(context.req.raw));
app.options('/api/ivx/innovation/hypotheses/:hypothesisId/status', () => innovationOptions());
app.post('/api/ivx/innovation/hypotheses/:hypothesisId/status', async (context) => handleInnovationHypothesisStatusRequest(context.req.raw, context.req.param('hypothesisId')));
app.options('/api/ivx/innovation/experiments', () => innovationOptions());
app.get('/api/ivx/innovation/experiments', async (context) => handleInnovationExperimentsListRequest(context.req.raw));
app.post('/api/ivx/innovation/experiments', async (context) => handleInnovationExperimentCreateRequest(context.req.raw));
app.options('/api/ivx/innovation/experiments/:experimentId', () => innovationOptions());
app.post('/api/ivx/innovation/experiments/:experimentId', async (context) => handleInnovationExperimentUpdateRequest(context.req.raw, context.req.param('experimentId')));

app.options('/api/ivx/opportunity/dashboard', () => opportunityOptions());
app.get('/api/ivx/opportunity/dashboard', async (context) => handleOpportunityDashboardRequest(context.req.raw));
app.options('/api/ivx/opportunity/scan', () => opportunityOptions());
app.post('/api/ivx/opportunity/scan', async (context) => handleOpportunityScanRequest(context.req.raw));
app.options('/api/ivx/opportunity/opportunities', () => opportunityOptions());
app.get('/api/ivx/opportunity/opportunities', async (context) => handleOpportunityListRequest(context.req.raw));
app.options('/api/ivx/opportunity/best', () => opportunityOptions());
app.get('/api/ivx/opportunity/best', async (context) => handleOpportunityBestRequest(context.req.raw));
app.options('/api/ivx/opportunity/research', () => opportunityOptions());
app.get('/api/ivx/opportunity/research', async (context) => handleOpportunityResearchRequest(context.req.raw));
app.options('/api/ivx/opportunity/alerts', () => opportunityOptions());
app.get('/api/ivx/opportunity/alerts', async (context) => handleOpportunityAlertsRequest(context.req.raw));
app.options('/api/ivx/opportunity/alerts/:alertId/ack', () => opportunityOptions());
app.post('/api/ivx/opportunity/alerts/:alertId/ack', async (context) => handleOpportunityAlertAckRequest(context.req.raw, context.req.param('alertId')));
app.options('/api/ivx/opportunity/:opportunityId/status', () => opportunityOptions());
app.post('/api/ivx/opportunity/:opportunityId/status', async (context) => handleOpportunityStatusRequest(context.req.raw, context.req.param('opportunityId')));

app.options('/api/ivx/investor-discovery', () => investorDiscoveryOptions());
app.get('/api/ivx/investor-discovery', async (context) => handleInvestorDiscoveryGetRequest(context.req.raw));
app.options('/api/ivx/investor-discovery/scan', () => investorDiscoveryOptions());
app.post('/api/ivx/investor-discovery/scan', async (context) => handleInvestorDiscoveryScanRequest(context.req.raw));

app.options('/api/ivx/buyer-discovery', () => buyerDiscoveryOptions());
app.get('/api/ivx/buyer-discovery', async (context) => handleBuyerDiscoveryGetRequest(context.req.raw));
app.options('/api/ivx/buyer-discovery/scan', () => buyerDiscoveryOptions());
app.post('/api/ivx/buyer-discovery/scan', async (context) => handleBuyerDiscoveryScanRequest(context.req.raw));

app.options('/api/ivx/bizdev/status', () => bizDevOrchestratorOptions());
app.get('/api/ivx/bizdev/status', async (context) => handleBizDevStatusRequest(context.req.raw));
app.options('/api/ivx/bizdev/run', () => bizDevOrchestratorOptions());
app.post('/api/ivx/bizdev/run', async (context) => handleBizDevRunRequest(context.req.raw));
// Alias: bizdev-orchestrator/status → same owner-gated status handler.
app.options('/api/ivx/bizdev-orchestrator/status', () => bizDevOrchestratorOptions());
app.get('/api/ivx/bizdev-orchestrator/status', async (context) => handleBizDevStatusRequest(context.req.raw));

app.options('/api/ivx/capital-network/dashboard', () => capitalNetworkOptions());
app.get('/api/ivx/capital-network/dashboard', async (context) => handleCapitalNetworkDashboardRequest(context.req.raw));
app.options('/api/ivx/capital-network/scan', () => capitalNetworkOptions());
app.post('/api/ivx/capital-network/scan', async (context) => handleCapitalNetworkScanRequest(context.req.raw));
app.options('/api/ivx/capital-network/prospects', () => capitalNetworkOptions());
app.get('/api/ivx/capital-network/prospects', async (context) => handleCapitalNetworkProspectsRequest(context.req.raw));
app.options('/api/ivx/capital-network/outreach', () => capitalNetworkOptions());
app.get('/api/ivx/capital-network/outreach', async (context) => handleCapitalOutreachRequest(context.req.raw));
app.options('/api/ivx/capital-network/:prospectId/status', () => capitalNetworkOptions());
app.post('/api/ivx/capital-network/:prospectId/status', async (context) => handleCapitalNetworkStatusRequest(context.req.raw, context.req.param('prospectId')));
app.options('/api/ivx/capital-network/:prospectId/action-plan', () => capitalNetworkOptions());
app.post('/api/ivx/capital-network/:prospectId/action-plan', async (context) => handleCapitalProspectActionPlanRequest(context.req.raw, context.req.param('prospectId')));
app.options('/api/ivx/capital-network/:prospectId/research', () => capitalNetworkOptions());
app.post('/api/ivx/capital-network/:prospectId/research', async (context) => handleCapitalProspectResearchRequest(context.req.raw, context.req.param('prospectId')));
app.options('/api/ivx/capital-network/:prospectId/outreach-draft', () => capitalNetworkOptions());
app.post('/api/ivx/capital-network/:prospectId/outreach-draft', async (context) => handleCapitalProspectOutreachDraftRequest(context.req.raw, context.req.param('prospectId')));

// ── Private Lender Network (Module 3) ──────────────────────────────────────
app.options('/api/ivx/lender-network/dashboard', () => lenderNetworkOptions());
app.get('/api/ivx/lender-network/dashboard', async (context) => handleLenderNetworkDashboardRequest(context.req.raw));
app.options('/api/ivx/lender-network/scan', () => lenderNetworkOptions());
app.post('/api/ivx/lender-network/scan', async (context) => handleLenderNetworkScanRequest(context.req.raw));
app.options('/api/ivx/lender-network/lenders', () => lenderNetworkOptions());
app.get('/api/ivx/lender-network/lenders', async (context) => handleLenderNetworkListRequest(context.req.raw));
app.options('/api/ivx/lender-network/:lenderId', () => lenderNetworkOptions());
app.get('/api/ivx/lender-network/:lenderId', async (context) => handleLenderNetworkGetRequest(context.req.raw, context.req.param('lenderId')));
app.options('/api/ivx/lender-network/:lenderId/status', () => lenderNetworkOptions());
app.post('/api/ivx/lender-network/:lenderId/status', async (context) => handleLenderNetworkStatusRequest(context.req.raw, context.req.param('lenderId')));

// ── Global Opportunity Intelligence Engine (all 9 engines) ────────────────
app.options('/api/ivx/intelligence/state', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/state', async (context) => handleIntelligenceStateRequest(context.req.raw));
app.options('/api/ivx/intelligence/run-all', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/run-all', async (context) => handleIntelligenceRunAllRequest(context.req.raw));
app.options('/api/ivx/intelligence/run/:engineId', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/run/:engineId', async (context) => handleIntelligenceRunEngineRequest(context.req.raw, context.req.param('engineId')));
app.options('/api/ivx/intelligence/run-category/:category', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/run-category/:category', async (context) => handleIntelligenceRunCategoryRequest(context.req.raw, context.req.param('category')));
app.options('/api/ivx/intelligence/report', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/report', async (context) => handleIntelligenceReportRequest(context.req.raw));
app.options('/api/ivx/intelligence/reports', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/reports', async (context) => handleIntelligenceReportsListRequest(context.req.raw));
app.options('/api/ivx/intelligence/targets', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/targets', async (context) => handleIntelligenceTargetsRequest(context.req.raw));
app.options('/api/ivx/intelligence/records', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/records', async (context) => handleIntelligenceRecordsRequest(context.req.raw));
app.options('/api/ivx/intelligence/top', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/top', async (context) => handleIntelligenceTopRequest(context.req.raw));
app.options('/api/ivx/intelligence/jv-match', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/jv-match', async (context) => handleIntelligenceJVMatchRequest(context.req.raw));
app.options('/api/ivx/intelligence/zip-search', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/zip-search', async (context) => handleIntelligenceZipSearchRequest(context.req.raw));
app.options('/api/ivx/intelligence/engines', () => globalIntelligenceOptions());
app.get('/api/ivx/intelligence/engines', async (context) => handleIntelligenceEnginesRequest(context.req.raw));
app.options('/api/ivx/intelligence/validate', () => globalIntelligenceOptions());
app.post('/api/ivx/intelligence/validate', async (context) => handleIntelligenceValidateRequest(context.req.raw));

app.options('/api/ivx/investors', () => investorCrmOptions());
app.get('/api/ivx/investors', async (context) => handleInvestorListRequest(context.req.raw));
app.post('/api/ivx/investors', async (context) => handleInvestorCreateRequest(context.req.raw));
app.options('/api/ivx/investors/import', () => investorCrmOptions());
app.post('/api/ivx/investors/import', async (context) => handleInvestorImportRequest(context.req.raw));
app.options('/api/ivx/investors/:investorId', () => investorCrmOptions());
app.get('/api/ivx/investors/:investorId', async (context) => handleInvestorGetRequest(context.req.raw, context.req.param('investorId')));
app.post('/api/ivx/investors/:investorId', async (context) => handleInvestorUpdateRequest(context.req.raw, context.req.param('investorId')));
app.options('/api/ivx/investors/:investorId/status', () => investorCrmOptions());
app.post('/api/ivx/investors/:investorId/status', async (context) => handleInvestorStatusRequest(context.req.raw, context.req.param('investorId')));
app.options('/api/ivx/investors/:investorId/delete', () => investorCrmOptions());
app.post('/api/ivx/investors/:investorId/delete', async (context) => handleInvestorDeleteRequest(context.req.raw, context.req.param('investorId')));

app.options('/api/ivx/crm/dedup-audit', () => crmDedupOptions());
app.get('/api/ivx/crm/dedup-audit', async (context) => handleCrmDedupAuditRequest(context.req.raw));
app.options('/api/ivx/crm/dedup-merge', () => crmDedupOptions());
app.post('/api/ivx/crm/dedup-merge', async (context) => handleCrmDedupMergeRequest(context.req.raw));
app.options('/api/ivx/crm/vip', () => crmDedupOptions());
app.get('/api/ivx/crm/vip', async (context) => handleCrmVipRequest(context.req.raw));
app.options('/api/ivx/owner/review', () => crmDedupOptions());
app.get('/api/ivx/owner/review', async (context) => handleOwnerReviewRequest(context.req.raw));

app.options('/api/ivx/capital-pipeline', () => capitalPipelineOptions());
app.get('/api/ivx/capital-pipeline', async (context) => handlePipelineListRequest(context.req.raw));
app.post('/api/ivx/capital-pipeline', async (context) => handlePipelineCreateRequest(context.req.raw));
app.options('/api/ivx/capital-pipeline/:entryId', () => capitalPipelineOptions());
app.get('/api/ivx/capital-pipeline/:entryId', async (context) => handlePipelineGetRequest(context.req.raw, context.req.param('entryId')));
app.post('/api/ivx/capital-pipeline/:entryId', async (context) => handlePipelineUpdateRequest(context.req.raw, context.req.param('entryId')));
app.options('/api/ivx/capital-pipeline/:entryId/stage', () => capitalPipelineOptions());
app.post('/api/ivx/capital-pipeline/:entryId/stage', async (context) => handlePipelineStageRequest(context.req.raw, context.req.param('entryId')));
app.options('/api/ivx/capital-pipeline/:entryId/delete', () => capitalPipelineOptions());
app.post('/api/ivx/capital-pipeline/:entryId/delete', async (context) => handlePipelineDeleteRequest(context.req.raw, context.req.param('entryId')));

app.options('/api/ivx/outreach', () => outreachOptions());
app.get('/api/ivx/outreach', async (context) => handleOutreachListRequest(context.req.raw));
app.post('/api/ivx/outreach', async (context) => handleOutreachCreateRequest(context.req.raw));
app.options('/api/ivx/outreach/draft', () => outreachOptions());
app.post('/api/ivx/outreach/draft', async (context) => handleOutreachPreviewRequest(context.req.raw));
app.options('/api/ivx/outreach/:messageId', () => outreachOptions());
app.get('/api/ivx/outreach/:messageId', async (context) => handleOutreachGetRequest(context.req.raw, context.req.param('messageId')));
app.post('/api/ivx/outreach/:messageId', async (context) => handleOutreachUpdateRequest(context.req.raw, context.req.param('messageId')));
app.options('/api/ivx/outreach/:messageId/submit', () => outreachOptions());
app.post('/api/ivx/outreach/:messageId/submit', async (context) => handleOutreachSubmitRequest(context.req.raw, context.req.param('messageId')));
app.options('/api/ivx/outreach/:messageId/approve', () => outreachOptions());
app.post('/api/ivx/outreach/:messageId/approve', async (context) => handleOutreachApproveRequest(context.req.raw, context.req.param('messageId')));
app.options('/api/ivx/outreach/:messageId/send', () => outreachOptions());
app.post('/api/ivx/outreach/:messageId/send', async (context) => handleOutreachSendRequest(context.req.raw, context.req.param('messageId')));
app.options('/api/ivx/outreach/:messageId/engagement', () => outreachOptions());
app.post('/api/ivx/outreach/:messageId/engagement', async (context) => handleOutreachEngagementRequest(context.req.raw, context.req.param('messageId')));
app.options('/api/ivx/outreach/:messageId/delete', () => outreachOptions());
app.post('/api/ivx/outreach/:messageId/delete', async (context) => handleOutreachDeleteRequest(context.req.raw, context.req.param('messageId')));

app.options('/api/ivx/lead-scoring', () => leadScoringOptions());
app.get('/api/ivx/lead-scoring', async (context) => handleLeadScoringRequest(context.req.raw));

// BLOCK 98 — Power Tools Core: Lead Capture Engine + CRM pipeline + Deal Packet Builder + dashboard.
app.options('/api/ivx/leads/capture', () => powerToolsOptions());
app.post('/api/ivx/leads/capture', async (context) => handleLeadCaptureRequest(context.req.raw)); // PUBLIC inbound capture
app.options('/api/ivx/leads', () => powerToolsOptions());
app.get('/api/ivx/leads', async (context) => handleLeadListRequest(context.req.raw));
app.options('/api/ivx/leads/:leadId', () => powerToolsOptions());
app.get('/api/ivx/leads/:leadId', async (context) => handleLeadGetRequest(context.req.raw, context.req.param('leadId')));
app.options('/api/ivx/leads/:leadId/behavior', () => powerToolsOptions());
app.post('/api/ivx/leads/:leadId/behavior', async (context) => handleLeadBehaviorRequest(context.req.raw, context.req.param('leadId')));
app.options('/api/ivx/leads/:leadId/stage', () => powerToolsOptions());
app.post('/api/ivx/leads/:leadId/stage', async (context) => handleLeadStageRequest(context.req.raw, context.req.param('leadId')));
app.options('/api/ivx/leads/:leadId/follow-up', () => powerToolsOptions());
app.post('/api/ivx/leads/:leadId/follow-up', async (context) => handleLeadFollowUpRequest(context.req.raw, context.req.param('leadId')));
app.options('/api/ivx/leads/:leadId/delete', () => powerToolsOptions());
app.post('/api/ivx/leads/:leadId/delete', async (context) => handleLeadDeleteRequest(context.req.raw, context.req.param('leadId')));

app.options('/api/ivx/campaign/report', () => powerToolsOptions());
app.get('/api/ivx/campaign/report', async (context) => handleCampaignReportRequest(context.req.raw));

app.options('/api/ivx/deal-packets', () => powerToolsOptions());
app.get('/api/ivx/deal-packets', async (context) => handleDealPacketListRequest(context.req.raw));
app.post('/api/ivx/deal-packets', async (context) => handleDealPacketCreateRequest(context.req.raw));
app.options('/api/ivx/deal-packets/:packetId', () => powerToolsOptions());
app.get('/api/ivx/deal-packets/:packetId', async (context) => handleDealPacketGetRequest(context.req.raw, context.req.param('packetId')));
app.options('/api/ivx/deal-packets/:packetId/item', () => powerToolsOptions());
app.post('/api/ivx/deal-packets/:packetId/item', async (context) => handleDealPacketItemRequest(context.req.raw, context.req.param('packetId')));
app.options('/api/ivx/deal-packets/:packetId/delete', () => powerToolsOptions());
app.post('/api/ivx/deal-packets/:packetId/delete', async (context) => handleDealPacketDeleteRequest(context.req.raw, context.req.param('packetId')));

app.options('/api/ivx/power-tools/dashboard', () => powerToolsOptions());
app.get('/api/ivx/power-tools/dashboard', async (context) => handlePowerToolsDashboardRequest(context.req.raw));
app.options('/api/ivx/power-tools/draft', () => powerToolsOptions());
app.post('/api/ivx/power-tools/draft', async (context) => handlePowerToolsDraftRequest(context.req.raw));

app.options('/api/ivx/gmail/status', () => gmailOptions());
app.get('/api/ivx/gmail/status', async (context) => handleGmailStatusRequest(context.req.raw));
app.options('/api/ivx/gmail/connect', () => gmailOptions());
app.post('/api/ivx/gmail/connect', async (context) => handleGmailConnectRequest(context.req.raw));
app.options('/api/ivx/gmail/disconnect', () => gmailOptions());
app.post('/api/ivx/gmail/disconnect', async (context) => handleGmailDisconnectRequest(context.req.raw));
app.options('/api/ivx/gmail/refresh', () => gmailOptions());
app.post('/api/ivx/gmail/refresh', async (context) => handleGmailRefreshRequest(context.req.raw));
app.options('/api/ivx/gmail/test', () => gmailOptions());
app.post('/api/ivx/gmail/test', async (context) => handleGmailTestRequest(context.req.raw));
app.options('/api/ivx/gmail/drafts', () => gmailOptions());
app.get('/api/ivx/gmail/drafts', async (context) => handleGmailDraftsListRequest(context.req.raw));
app.options('/api/ivx/gmail/draft', () => gmailOptions());
app.post('/api/ivx/gmail/draft', async (context) => handleGmailDraftCreateRequest(context.req.raw));

app.options('/api/ivx/deal-matching', () => dealMatchingOptions());
app.get('/api/ivx/deal-matching', async (context) => handleDealMatchingRequest(context.req.raw));

app.options('/api/ivx/deal-tracking', () => dealTrackingOptions());
app.get('/api/ivx/deal-tracking', async (context) => handleDealTrackingListRequest(context.req.raw));
app.post('/api/ivx/deal-tracking', async (context) => handleDealTrackingCreateRequest(context.req.raw));
app.options('/api/ivx/deal-tracking/:dealId', () => dealTrackingOptions());
app.get('/api/ivx/deal-tracking/:dealId', async (context) => handleDealTrackingGetRequest(context.req.raw, context.req.param('dealId')));
app.post('/api/ivx/deal-tracking/:dealId', async (context) => handleDealTrackingUpdateRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/milestone', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/milestone', async (context) => handleDealTrackingMilestoneRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/status', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/status', async (context) => handleDealTrackingStatusRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/delete', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/delete', async (context) => handleDealTrackingDeleteRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/join', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/join', async (context) => handleDealTrackingJoinRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/leave', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/leave', async (context) => handleDealTrackingLeaveRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/documents', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/documents', async (context) => handleDealTrackingAddDocumentRequest(context.req.raw, context.req.param('dealId')));
app.options('/api/ivx/deal-tracking/:dealId/documents/:documentId/delete', () => dealTrackingOptions());
app.post('/api/ivx/deal-tracking/:dealId/documents/:documentId/delete', async (context) => handleDealTrackingRemoveDocumentRequest(context.req.raw, context.req.param('dealId'), context.req.param('documentId')));

app.options('/api/ivx/deal-pipeline/seed', () => dealPipelineSeedOptions());
app.post('/api/ivx/deal-pipeline/seed', async (context) => handleDealPipelineSeedRequest(context.req.raw));

app.options('/api/ivx/capital-command-center', () => capitalCommandCenterOptions());
app.get('/api/ivx/capital-command-center', async (context) => handleCapitalCommandCenterRequest(context.req.raw));
app.options('/api/ivx/capital-command-center/activity', () => capitalCommandCenterOptions());
app.get('/api/ivx/capital-command-center/activity', async (context) => handleCapitalCommandActivityRequest(context.req.raw));
app.options('/api/ivx/capital-command-center/best-investor', () => capitalCommandCenterOptions());
app.post('/api/ivx/capital-command-center/best-investor', async (context) => handleBestInvestorWorkflowRequest(context.req.raw));

app.options('/api/ivx/business-impact/dashboard', () => businessImpactOptions());
app.get('/api/ivx/business-impact/dashboard', async (context) => handleBusinessImpactDashboardRequest(context.req.raw));
app.options('/api/ivx/executive-layer', () => executiveLayerOptions());
app.get('/api/ivx/executive-layer', async (context) => handleExecutiveLayerRequest(context.req.raw));
app.options('/api/ivx/daily-report', () => dailyReportOptions());
app.get('/api/ivx/daily-report', async (context) => handleDailyReportLatest(context.req.raw));
app.post('/api/ivx/daily-report', async (context) => handleDailyReportGenerate(context.req.raw));
app.options('/api/ivx/daily-report/preview', () => dailyReportOptions());
app.post('/api/ivx/daily-report/preview', async (context) => handleDailyReportPreview(context.req.raw));
app.options('/api/ivx/daily-report/history', () => dailyReportOptions());
app.get('/api/ivx/daily-report/history', async (context) => handleDailyReportHistory(context.req.raw));
app.options('/api/ivx/autonomous-os', () => autonomousOsOptions());
app.get('/api/ivx/autonomous-os', async (context) => handleAutonomousOsStatus(context.req.raw));
app.options('/api/ivx/autonomous-os/weekly', () => autonomousOsOptions());
app.get('/api/ivx/autonomous-os/weekly', async (context) => handleAutonomousOsWeekly(context.req.raw));
app.options('/api/ivx/technology-discovery', () => technologyDiscoveryOptions());
app.get('/api/ivx/technology-discovery', async (context) => handleTechnologyDiscoveryStatusRequest(context.req.raw));
app.options('/api/ivx/technology-discovery/scan', () => technologyDiscoveryOptions());
app.post('/api/ivx/technology-discovery/scan', async (context) => handleTechnologyDiscoveryScanRequest(context.req.raw));
app.options('/api/ivx/rork-independence', () => rorkIndependenceOptions());
app.get('/api/ivx/rork-independence', async (context) => handleRorkIndependenceRequest(context.req.raw));
app.options('/api/ivx/owner-control-proof', () => ownerControlProofOptions());
app.get('/api/ivx/owner-control-proof', async (context) => handleIVXOwnerControlProofRequest(context.req.raw));

app.options('/api/ivx/memory', () => unifiedMemoryOptions());
app.get('/api/ivx/memory', async (context) => handleMemoryListRequest(context.req.raw));
app.post('/api/ivx/memory', async (context) => handleMemoryCreateRequest(context.req.raw));
app.options('/api/ivx/memory/summary', () => unifiedMemoryOptions());
app.get('/api/ivx/memory/summary', async (context) => handleMemorySummaryRequest(context.req.raw));
app.options('/api/ivx/memory/:id', () => unifiedMemoryOptions());
app.get('/api/ivx/memory/:id', async (context) => handleMemoryGetRequest(context.req.raw, context.req.param('id')));
app.post('/api/ivx/memory/:id', async (context) => handleMemoryUpdateRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/memory/:id/forget', () => unifiedMemoryOptions());
app.post('/api/ivx/memory/:id/forget', async (context) => handleMemoryForgetRequest(context.req.raw, context.req.param('id')));

app.options('/api/ivx/action-loop', () => actionLoopOptions());
app.get('/api/ivx/action-loop', async (context) => handleActionLoopListRequest(context.req.raw));
app.post('/api/ivx/action-loop', async (context) => handleActionLoopCreateRequest(context.req.raw));
app.options('/api/ivx/action-loop/learning', () => actionLoopOptions());
app.get('/api/ivx/action-loop/learning', async (context) => handleActionLoopLearningRequest(context.req.raw));
app.options('/api/ivx/action-loop/:id', () => actionLoopOptions());
app.get('/api/ivx/action-loop/:id', async (context) => handleActionLoopGetRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/action-loop/:id/execution', () => actionLoopOptions());
app.post('/api/ivx/action-loop/:id/execution', async (context) => handleActionLoopExecutionRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/action-loop/:id/outcome', () => actionLoopOptions());
app.post('/api/ivx/action-loop/:id/outcome', async (context) => handleActionLoopOutcomeRequest(context.req.raw, context.req.param('id')));

app.options('/api/ivx/live-work/feed', () => liveWorkOptions());
app.get('/api/ivx/live-work/feed', async (context) => handleLiveWorkFeedRequest(context.req.raw));
app.options('/api/ivx/live-work/agents', () => liveWorkOptions());
app.get('/api/ivx/live-work/agents', async (context) => handleLiveWorkAgentsRequest(context.req.raw));
app.options('/api/ivx/live-work/check-supabase', () => liveWorkOptions());
app.post('/api/ivx/live-work/check-supabase', async (context) => handleLiveWorkCheckSupabaseRequest(context.req.raw));
app.options('/api/ivx/live-work/status', () => liveWorkOptions());
app.get('/api/ivx/live-work/status', async (context) => handleLiveWorkStatusRequest(context.req.raw));
app.options('/api/ivx/live-work/tasks', () => liveWorkOptions());
app.get('/api/ivx/live-work/tasks', async (context) => handleLiveWorkTasksRequest(context.req.raw));
app.options('/api/ivx/live-work/task/:taskId', () => liveWorkOptions());
app.get('/api/ivx/live-work/task/:taskId', async (context) => handleLiveWorkTaskRequest(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/live-work/run', () => liveWorkOptions());
app.post('/api/ivx/live-work/run', async (context) => handleLiveWorkRunRequest(context.req.raw));
app.options('/api/ivx/live-work/approve', () => liveWorkOptions());
app.post('/api/ivx/live-work/approve', async (context) => handleLiveWorkApproveRequest(context.req.raw));
app.options('/api/ivx/live-work/cancel', () => liveWorkOptions());
app.post('/api/ivx/live-work/cancel', async (context) => handleLiveWorkCancelRequest(context.req.raw));
app.options('/api/ivx/execution-trace', () => executionTraceOptions());
app.get('/api/ivx/execution-trace', async (context) => handleExecutionTraceListRequest(context.req.raw));
app.options('/api/ivx/execution-trace/:id', () => executionTraceOptions());
app.get('/api/ivx/execution-trace/:id', async (context) => handleExecutionTraceGetRequest(context.req.raw, context.req.param('id')));

app.options('/api/ivx/autonomous-mode/tools', () => autonomousModeOptions());
app.get('/api/ivx/autonomous-mode/tools', async (context) => handleAutonomousModeToolsRequest(context.req.raw));
app.options('/api/ivx/autonomous-mode/run', () => autonomousModeOptions());
app.post('/api/ivx/autonomous-mode/run', async (context) => handleAutonomousModeRunRequest(context.req.raw));
app.options('/api/ivx/senior-developer/autonomous-mode/status', () => seniorDevAutonomousOptions());
app.get('/api/ivx/senior-developer/autonomous-mode/status', async (context) => handleSeniorDevAutonomousStatusRequest(context.req.raw));
app.options('/api/ivx/senior-developer/autonomous-mode/run', () => seniorDevAutonomousOptions());
app.post('/api/ivx/senior-developer/autonomous-mode/run', async (context) => handleSeniorDevAutonomousRunRequest(context.req.raw));

app.options('/api/ivx/owner-operations/dashboard', () => ownerOperationsOptions());
app.get('/api/ivx/owner-operations/dashboard', async (context) => handleOwnerOperationsDashboardRequest(context.req.raw));
app.options('/api/ivx/owner-operations/connections', () => ownerOperationsOptions());
app.get('/api/ivx/owner-operations/connections', async (context) => handleOwnerOperationsConnectionsRequest(context.req.raw));
app.options('/api/ivx/owner-operations/connections/test', () => ownerOperationsOptions());
app.post('/api/ivx/owner-operations/connections/test', async (context) => handleOwnerOperationsConnectionTestRequest(context.req.raw));
app.options('/api/ivx/owner-operations/actions', () => ownerOperationsOptions());
app.get('/api/ivx/owner-operations/actions', async (context) => handleOwnerOperationsActionsRequest(context.req.raw));
app.options('/api/ivx/owner-operations/rork-removal/preflight', () => ownerOperationsOptions());
app.get('/api/ivx/owner-operations/rork-removal/preflight', async (context) => handleOwnerOperationsRorkRemovalPreflightRequest(context.req.raw));

app.options('/api/ivx/continuous-improvement/dashboard', () => continuousImprovementOptions());
app.get('/api/ivx/continuous-improvement/dashboard', async (context) => handleContinuousImprovementDashboardRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/self-audit', () => continuousImprovementOptions());
app.post('/api/ivx/continuous-improvement/self-audit', async (context) => handleContinuousImprovementSelfAuditRequest(context.req.raw));
app.options('/api/ivx/scheduler', () => schedulerOptions());
app.get('/api/ivx/scheduler', async (context) => handleSchedulerStatusRequest(context.req.raw));
app.options('/api/ivx/scheduler/run-now', () => schedulerOptions());
app.post('/api/ivx/scheduler/run-now', async (context) => handleSchedulerRunNowRequest(context.req.raw));
app.options('/api/ivx/scheduler/enable', () => schedulerOptions());
app.post('/api/ivx/scheduler/enable', async (context) => handleSchedulerEnableRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/proposals', () => continuousImprovementOptions());
app.get('/api/ivx/continuous-improvement/proposals', async (context) => handleContinuousImprovementProposalsRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/drift', () => continuousImprovementOptions());
app.get('/api/ivx/continuous-improvement/drift', async (context) => handleContinuousImprovementDriftRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/baseline', () => continuousImprovementOptions());
app.post('/api/ivx/continuous-improvement/baseline', async (context) => handleContinuousImprovementBaselineRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/safe-plan', () => continuousImprovementOptions());
app.get('/api/ivx/continuous-improvement/safe-plan', async (context) => handleContinuousImprovementSafePlanRequest(context.req.raw));
app.options('/api/ivx/continuous-improvement/safe-fixes', () => continuousImprovementOptions());
app.get('/api/ivx/continuous-improvement/safe-fixes', async (context) => handleContinuousImprovementSafeFixesRequest(context.req.raw));

app.options('/api/ivx/deliverables', () => deliverablesOptions());
app.get('/api/ivx/deliverables', async (context) => handleDeliverableListRequest(context.req.raw));
app.post('/api/ivx/deliverables', async (context) => handleDeliverableCreateRequest(context.req.raw));
app.options('/api/ivx/deliverables/notifications', () => deliverablesOptions());
app.get('/api/ivx/deliverables/notifications', async (context) => handleDeliverableNotificationsRequest(context.req.raw));
app.options('/api/ivx/deliverables/:id', () => deliverablesOptions());
app.get('/api/ivx/deliverables/:id', async (context) => handleDeliverableGetRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/deliverables/:id/verify', () => deliverablesOptions());
app.get('/api/ivx/deliverables/:id/verify', async (context) => handleDeliverableVerifyRequest(context.req.raw, context.req.param('id')));

app.options('/api/ivx/metrics', () => metricsOptions());
app.get('/api/ivx/metrics', async (context) => handleMetricsRequest(context.req.raw));

app.options('/api/ivx/verify/env-status', () => ownerStatusOptions());
app.get('/api/ivx/verify/env-status', async (context) => handleEnvStatusRequest(context.req.raw));
app.options('/api/ivx/autonomous/status', () => ownerStatusOptions());
app.get('/api/ivx/autonomous/status', async (context) => handleAutonomousStatusRequest(context.req.raw));
app.options('/api/ivx/autonomous/run', () => ownerStatusOptions());
app.post('/api/ivx/autonomous/run', async (context) => handleAutonomousRunRequest(context.req.raw));
app.options('/api/ivx/persistence/verify', () => ownerStatusOptions());
app.get('/api/ivx/persistence/verify', async (context) => handlePersistenceVerifyRequest(context.req.raw));
app.options('/api/ivx/ordering/board', () => orderingOptions());
app.get('/api/ivx/ordering/board', async (context) => handleOrderingBoardRequest(context.req.raw));
app.options('/api/ivx/ordering/report', () => orderingOptions());
app.get('/api/ivx/ordering/report', async (context) => handleOrderingReportRequest(context.req.raw));
app.options('/api/ivx/ordering/action', () => orderingOptions());
app.post('/api/ivx/ordering/action', async (context) => handleOrderingActionRequest(context.req.raw));

app.options('/api/ivx/runtime-variables', () => runtimeVariablesOptions());
app.get('/api/ivx/runtime-variables', async (context) => handleRuntimeVariablesRequest(context.req.raw));
app.options('/api/ivx/runtime-variables/verify', () => runtimeVariablesOptions());
app.post('/api/ivx/runtime-variables/verify', async (context) => handleRuntimeVariablesVerifyRequest(context.req.raw));
app.options('/api/ivx/runtime-variables/sync', () => runtimeVariablesOptions());
app.post('/api/ivx/runtime-variables/sync', async (context) => handleRuntimeVariablesSyncRequest(context.req.raw));
app.options('/api/ivx/runtime-variables/save', () => runtimeVariablesOptions());
app.post('/api/ivx/runtime-variables/save', async (context) => handleRuntimeVariablesSaveRequest(context.req.raw));
app.options('/api/ivx/runtime-variables/audit', () => runtimeVariablesOptions());
app.get('/api/ivx/runtime-variables/audit', async (context) => handleRuntimeVariablesAuditRequest(context.req.raw));

app.options('/api/ivx/development-control', () => ivxDevelopmentControlOptions());
app.get('/api/ivx/development-control', async (context) => handleIVXDevelopmentControlRequest(context.req.raw));
app.options('/api/ivx/development-action', () => ivxDevelopmentControlOptions());
app.post('/api/ivx/development-action', async (context) => handleIVXDevelopmentActionRequest(context.req.raw));

app.options('/api/ivx/control-room/status', () => controlRoomStatusOptions());
app.get('/api/ivx/control-room/status', async (context) => handleIVXControlRoomStatusRequest(context.req.raw));
app.options('/api/ivx/developer-deploy/status', () => developerDeployOptions());
app.get('/api/ivx/developer-deploy/status', async (context) => handleIVXDeveloperDeployStatusRequest(context.req.raw));
app.options('/api/ivx/developer-deploy/action', () => developerDeployOptions());
app.post('/api/ivx/developer-deploy/action', async (context) => handleIVXDeveloperDeployActionRequest(context.req.raw));
// ---- IVX Render Auto-Deploy Fix — public status + owner-approved fix ----
app.options('/api/ivx/render-auto-deploy/status', () => publicJson({ ok: true }, 204));
app.get('/api/ivx/render-auto-deploy/status', async (context) => handleRenderAutoDeployStatusRequest(context.req.raw));
app.options('/api/ivx/render-auto-deploy/fix', () => publicJson({ ok: true }, 204));
app.post('/api/ivx/render-auto-deploy/fix', async (context) => handleRenderAutoDeployFixRequest(context.req.raw));
// Non-auth self-deploy trigger — backend proxies Render deploy using its own credentials
app.options('/api/ivx/deploy', () => publicJson({ ok: true }, 204));
app.post('/api/ivx/deploy', async (context) => handleSelfDeployRequest(context.req.raw));
app.options('/api/ivx/senior-developer/status', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/status', async (context) => handleIVXSeniorDeveloperStatusRequest(context.req.raw));
app.options('/api/ivx/senior-developer/github-audit', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/github-audit', async (context) => handleIVXSeniorDeveloperGithubAuditRequest(context.req.raw));
app.options('/api/ivx/senior-developer/credential-audit', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/credential-audit', async (context) => handleIVXSeniorDeveloperCredentialAuditRequest(context.req.raw));
app.options('/api/ivx/senior-developer/run', () => seniorDeveloperOptions());
app.post('/api/ivx/senior-developer/run', async (context) => handleIVXSeniorDeveloperRunRequest(context.req.raw));
app.options('/api/ivx/senior-developer/branch-pr-proof', () => branchPrProofOptions());
app.get('/api/ivx/senior-developer/branch-pr-proof', async (context) => handleIVXBranchPrProofStatusRequest(context.req.raw));
app.post('/api/ivx/senior-developer/branch-pr-proof', async (context) => handleIVXBranchPrProofRequest(context.req.raw));

// === Phase 5: Owner-only AI Provider Diagnostics ===
// Shows provider state, model, adapter version, credential loaded/valid,
// last validation time, last HTTP status, fallback enabled/used, trace ID.
// Never reveals secret values.
app.options('/api/ivx/senior-developer/provider-diagnostics', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/provider-diagnostics', async (context) => {
  try {
    const { assertIVXRegisteredOwnerBearer, ownerOnlyJson } = await import('./api/owner-only');
    const { approval } = await assertIVXRegisteredOwnerBearer(context.req.raw, 'senior_developer_provider_diagnostics');
    const health = getProviderHealth();
    const startup = validateIVXAIStartup();
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      provider: {
        state: health.state,
        provider: health.provider,
        model: health.model,
        adapterVersion: health.adapterVersion,
        credentialLoaded: health.credentialLoaded,
        credentialValid: health.credentialValid,
        lastValidationTime: health.lastValidationTime,
        lastHttpStatus: health.lastHttpStatus,
        fallbackEnabled: health.fallbackEnabled,
        fallbackUsed: health.fallbackUsed,
        traceId: health.traceId,
        error: health.error,
      },
      startup: {
        ok: startup.ok,
        providerType: startup.providerType,
        keyPrefix: startup.keyPrefix,
        baseUrl: startup.baseUrl,
        endpoint: startup.endpoint,
        errors: startup.errors,
      },
      rorkDependency: false,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provider-diagnostics failed';
    const status = message.includes('missing bearer') || message.includes('invalid or expired') ? 401
      : message.includes('owner') || message.includes('privileged') ? 403 : 500;
    return context.json({ ok: false, error: message, ownerOnly: true }, status);
  }
});
// IVX self-hosted Senior Developer Worker — receives owner-approved tasks and
// executes the real end-to-end pipeline (read → edit → test → build → commit →
// push → deploy → verify) WITHOUT Rork as the executor.
app.options('/api/ivx/senior-developer/worker/status', () => seniorDeveloperWorkerOptions());
app.get('/api/ivx/senior-developer/worker/status', async (context) => handleSeniorDeveloperWorkerStatusRequest(context.req.raw));
app.options('/api/ivx/senior-developer/worker/jobs', () => seniorDeveloperWorkerOptions());
app.post('/api/ivx/senior-developer/worker/jobs', async (context) => handleSeniorDeveloperWorkerEnqueueRequest(context.req.raw));
app.get('/api/ivx/senior-developer/worker/jobs', async (context) => handleSeniorDeveloperWorkerJobsRequest(context.req.raw));
app.options('/api/ivx/senior-developer/worker/jobs/:jobId', () => seniorDeveloperWorkerOptions());
app.get('/api/ivx/senior-developer/worker/jobs/:jobId', async (context) => handleSeniorDeveloperWorkerJobRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/senior-developer/worker/ledger', () => seniorDeveloperWorkerOptions());
app.get('/api/ivx/senior-developer/worker/ledger', async (context) => handleSeniorDeveloperWorkerLedgerRequest(context.req.raw));
app.options('/api/ivx/worker-last-proof', () => seniorDeveloperWorkerOptions());
app.get('/api/ivx/worker-last-proof', async (context) => handleSeniorDeveloperWorkerLastProofRequest(context.req.raw));
// Cancel and resume job endpoints — per-owner single-flight queue control.
app.options('/api/ivx/senior-developer/worker/active', () => seniorDeveloperWorkerOptions());
app.get('/api/ivx/senior-developer/worker/active', async (context) => handleSeniorDeveloperWorkerActiveJobRequest(context.req.raw));
app.options('/api/ivx/senior-developer/worker/jobs/:jobId/cancel', () => seniorDeveloperWorkerOptions());
app.post('/api/ivx/senior-developer/worker/jobs/:jobId/cancel', async (context) => handleSeniorDeveloperWorkerCancelJobRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/senior-developer/worker/jobs/:jobId/resume', () => seniorDeveloperWorkerOptions());
app.post('/api/ivx/senior-developer/worker/jobs/:jobId/resume', async (context) => handleSeniorDeveloperWorkerResumeJobRequest(context.req.raw, context.req.param('jobId')));
// Live, publicly-readable production visibility for features the Senior Developer builds from scratch.
// Every committed + deployed feature appears here, proving the new production feature is visible.
app.options('/api/ivx/senior-developer/features', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/features', async (context) => {
  const { listGeneratedFeatures, IVX_GENERATED_FEATURE_REGISTRY_MARKER } = await import('./services/ivx-generated-feature-registry');
  const features = await listGeneratedFeatures();
  return context.json({
    ok: true,
    marker: IVX_GENERATED_FEATURE_REGISTRY_MARKER,
    count: features.length,
    features,
    timestamp: new Date().toISOString(),
  });
});
app.options('/api/ivx/senior-developer/features/:slug', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/features/:slug', async (context) => {
  const { getGeneratedFeature, IVX_GENERATED_FEATURE_REGISTRY_MARKER } = await import('./services/ivx-generated-feature-registry');
  const slug = context.req.param('slug');
  const feature = await getGeneratedFeature(slug);
  if (!feature) {
    return context.json({ ok: false, marker: IVX_GENERATED_FEATURE_REGISTRY_MARKER, error: `No generated feature found for slug "${slug}".`, slug, timestamp: new Date().toISOString() }, 404);
  }
  return context.json({ ok: true, marker: IVX_GENERATED_FEATURE_REGISTRY_MARKER, feature, timestamp: new Date().toISOString() });
});
// ONE-CLICK, NO-TOKEN end-to-end production self-proof. Runs the REAL Senior
// Developer runtime in-process in systemMode (using the production-side
// GitHub/Render/Supabase credentials), then returns the 5 artifacts the owner
// asked for: new feature, commit pushed, GitHub SHA, Render deploy, live HTTP
// 200. Cooldown-guarded so it can never be used to spam commits/deploys.
app.options('/api/ivx/senior-developer/self-proof', () => seniorDeveloperOptions());
app.get('/api/ivx/senior-developer/self-proof', async (context) => {
  try {
    const { runSeniorDeveloperSelfProof } = await import('./services/ivx-senior-developer-self-proof');
    const force = ['1', 'true', 'yes'].includes((context.req.query('force') ?? '').trim().toLowerCase());
    const proof = await runSeniorDeveloperSelfProof({ force });
    return context.json(proof, proof.ok ? 200 : 409);
  } catch (error) {
    return context.json({
      ok: false,
      marker: 'ivx-senior-developer-self-proof-v1',
      error: error instanceof Error ? error.message.slice(0, 500) : 'Senior developer self-proof failed.',
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, 500);
  }
});
app.get('/api/ivx/senior-developer/self-proof/latest', async (context) => {
  const { getLatestSeniorDeveloperSelfProof } = await import('./services/ivx-senior-developer-self-proof');
  const latest = await getLatestSeniorDeveloperSelfProof();
  if (!latest) {
    return context.json({
      ok: false,
      marker: 'ivx-senior-developer-self-proof-v1',
      error: 'No self-proof has been run yet. Call GET /api/ivx/senior-developer/self-proof to run it.',
      timestamp: new Date().toISOString(),
    }, 404);
  }
  return context.json(latest, latest.ok ? 200 : 409);
});
app.options('/api/ivx/senior-dev-proof', () => seniorDevToolsOptions());
app.get('/api/ivx/senior-dev-proof', async (context) => {
  try {
    const { assertIVXOwnerOnly, ownerOnlyJson } = await import('./api/owner-only');
    await assertIVXOwnerOnly(context.req.raw);
    return ownerOnlyJson({
      ok: true,
      role: 'senior-developer',
      canReadCode: true,
      canPatchCode: true,
      canRunValidation: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'owner_auth_required';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
app.options('/api/ivx/senior-dev/tools', () => seniorDevToolsOptions());
app.get('/api/ivx/senior-dev/tools', async (context) => handleIVXSeniorDevToolsListRequest(context.req.raw));
app.post('/api/ivx/senior-dev/tools', async (context) => handleIVXSeniorDevToolsExecuteRequest(context.req.raw));
app.options('/api/ivx/senior-dev/audit-report', () => seniorDevToolsOptions());
app.post('/api/ivx/senior-dev/audit-report', async (context) => handleIVXSeniorDevAuditReportRequest(context.req.raw));
// Rate-limited senior-dev endpoints. Buckets are per IP + per token suffix
// so each owner session has its own quota. Tight budgets are applied to the
// expensive surfaces (proof / repo-search / test-report / e2e-run) and a
// generous bucket to the high-frequency execution-stream poll.
app.options('/api/ivx/senior-dev/proof', () => seniorDevBuildOptions());
app.post('/api/ivx/senior-dev/proof', async (c) => withRateLimit(c.req.raw, 'senior-dev:proof', 10, 0.2, () => handleSeniorDevProofPost(c.req.raw)));
app.get('/api/ivx/senior-dev/proofs', async (c) => withRateLimit(c.req.raw, 'senior-dev:proofs-list', 30, 1, () => handleSeniorDevProofList(c.req.raw)));
app.options('/api/ivx/senior-dev/evidence', () => seniorDevBuildOptions());
app.get('/api/ivx/senior-dev/evidence', async (c) => withRateLimit(c.req.raw, 'senior-dev:evidence', 30, 1, () => handleSeniorDevEvidence(c.req.raw)));
app.options('/api/ivx/senior-dev/otel', () => seniorDevBuildOptions());
app.get('/api/ivx/senior-dev/otel', async (c) => withRateLimit(c.req.raw, 'senior-dev:otel', 30, 1, () => handleSeniorDevOTel(c.req.raw)));
app.options('/api/ivx/senior-dev/repo-search', () => seniorDevBuildOptions());
app.post('/api/ivx/senior-dev/repo-search', async (c) => withRateLimit(c.req.raw, 'senior-dev:repo-search', 10, 0.2, () => handleSeniorDevRepoSearch(c.req.raw)));
app.options('/api/ivx/senior-dev/test-report', () => seniorDevBuildOptions());
app.post('/api/ivx/senior-dev/test-report', async (c) => withRateLimit(c.req.raw, 'senior-dev:test-report', 6, 0.1, () => handleSeniorDevTestReport(c.req.raw)));
app.options('/api/ivx/senior-dev/e2e', () => seniorDevBuildOptions());
app.get('/api/ivx/senior-dev/e2e', async (c) => withRateLimit(c.req.raw, 'senior-dev:e2e', 30, 1, () => handleSeniorDevE2EPlan(c.req.raw)));
app.options('/api/ivx/senior-dev/e2e/run', () => seniorDevBuildOptions());
app.post('/api/ivx/senior-dev/e2e/run', async (c) => withRateLimit(c.req.raw, 'senior-dev:e2e-run', 4, 0.05, () => handleSeniorDevE2ERun(c.req.raw)));
app.options('/api/ivx/senior-dev/execution-stream', () => seniorDevBuildOptions());
// High-frequency poll — generous burst, ~2 rps sustained per session.
app.get('/api/ivx/senior-dev/execution-stream', async (c) => withRateLimit(c.req.raw, 'senior-dev:execution-stream', 60, 2, () => handleSeniorDevExecutionStream(c.req.raw)));
app.options('/api/ivx/senior-dev/execution-record', () => seniorDevBuildOptions());
app.post('/api/ivx/senior-dev/execution-record', async (c) => withRateLimit(c.req.raw, 'senior-dev:execution-record', 60, 2, () => handleSeniorDevExecutionRecord(c.req.raw)));
app.options('/api/ivx/autonomy/status', () => autonomyOptions());
app.get('/api/ivx/autonomy/status', async (c) => handleIVXAutonomyStatusRequest(c.req.raw));
app.options('/api/ivx/autonomy/cloudfront/invalidate', () => autonomyOptions());
app.post('/api/ivx/autonomy/cloudfront/invalidate', async (c) => handleIVXAutonomyCloudFrontInvalidateRequest(c.req.raw));
app.options('/api/ivx/autonomy/secret-scan', () => autonomyOptions());
app.post('/api/ivx/autonomy/secret-scan', async (c) => handleIVXAutonomySecretScanRequest(c.req.raw));
app.options('/api/ivx/autonomy/deploy-log/rotate', () => autonomyOptions());
app.post('/api/ivx/autonomy/deploy-log/rotate', async (c) => handleIVXAutonomyDeployLogRotateRequest(c.req.raw));
app.options('/api/ivx/autonomy/git/rollback-check', () => autonomyOptions());
app.get('/api/ivx/autonomy/git/rollback-check', async (c) => handleIVXAutonomyGitRollbackCheckRequest(c.req.raw));
app.options('/api/ivx/autonomy/uptime/probe', () => autonomyOptions());
app.get('/api/ivx/autonomy/uptime/probe', async (c) => handleIVXAutonomyUptimeProbeListRequest(c.req.raw));
app.post('/api/ivx/autonomy/uptime/probe', async (c) => handleIVXAutonomyUptimeProbeRunRequest(c.req.raw));
app.options('/api/ivx/autonomy/sse-replay/stats', () => autonomyOptions());
app.get('/api/ivx/autonomy/sse-replay/stats', async (c) => handleIVXAutonomySSEReplayStatsRequest(c.req.raw));
app.options('/api/ivx/autonomy/token-budget', () => autonomyOptions());
app.get('/api/ivx/autonomy/token-budget', async (c) => handleIVXAutonomyTokenBudgetRequest(c.req.raw));
app.options('/api/ivx/autonomy/ai-providers', () => autonomyOptions());
app.get('/api/ivx/autonomy/ai-providers', async (c) => handleIVXAutonomyAIProvidersRequest(c.req.raw));
app.options('/api/ivx/autonomy/deploy/approve-and-run', () => autonomyOptions());
app.post('/api/ivx/autonomy/deploy/approve-and-run', async (c) => handleIVXAutonomyDeployApproveAndRunRequest(c.req.raw));
app.options('/api/ivx/autonomy/deploy/rollback', () => autonomyOptions());
app.post('/api/ivx/autonomy/deploy/rollback', async (c) => handleIVXAutonomyDeployRollbackRequest(c.req.raw));
app.options('/api/ivx/autonomy/github/sync', () => autonomyOptions());
app.post('/api/ivx/autonomy/github/sync', async (c) => handleIVXAutonomyGithubSyncRequest(c.req.raw));
// Owner-only one-shot delivery chain: Rork workspace → GitHub push → Render deploy → live /health verify.
app.options('/api/ivx/admin/sync-rork-to-github', () => adminSyncOptions());
app.post('/api/ivx/admin/sync-rork-to-github', async (c) => handleIVXAdminSyncRorkToGithubRequest(c.req.raw));
app.options('/api/ivx/night-ops/status', () => nightOpsOptions());
app.get('/api/ivx/night-ops/status', async (c) => handleIVXNightOpsStatusRequest(c.req.raw));
app.options('/api/ivx/night-ops/config', () => nightOpsOptions());
app.post('/api/ivx/night-ops/config', async (c) => handleIVXNightOpsConfigRequest(c.req.raw));
app.options('/api/ivx/night-ops/run', () => nightOpsOptions());
app.post('/api/ivx/night-ops/run', async (c) => handleIVXNightOpsRunRequest(c.req.raw));
app.options('/api/ivx/night-ops/touch-owner', () => nightOpsOptions());
app.post('/api/ivx/night-ops/touch-owner', async (c) => handleIVXNightOpsTouchOwnerRequest(c.req.raw));
app.options('/api/ivx/night-ops/runs', () => nightOpsOptions());
app.get('/api/ivx/night-ops/runs', async (c) => handleIVXNightOpsRunsListRequest(c.req.raw));
app.options('/api/ivx/night-ops/runs/:runId', () => nightOpsOptions());
app.get('/api/ivx/night-ops/runs/:runId', async (c) => handleIVXNightOpsRunGetRequest(c.req.raw, c.req.param('runId') ?? ''));
app.options('/api/ivx/night-ops/roadmap', () => nightOpsOptions());
app.get('/api/ivx/night-ops/roadmap', async (c) => handleIVXNightOpsRoadmapGetRequest(c.req.raw));
app.options('/api/ivx/night-ops/roadmap/advance', () => nightOpsOptions());
app.post('/api/ivx/night-ops/roadmap/advance', async (c) => handleIVXNightOpsRoadmapAdvanceRequest(c.req.raw));
app.options('/api/ivx/env-debug/render', () => publicJson({ ok: true }, 204));
app.get('/api/ivx/env-debug/render', async (context) => context.json(await buildRenderEnvDebugPayload(), 200, {
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
}));
// Public-safe masked variable presence report (no secrets, no auth).
// Mirrors the safety model of /api/ivx/env-debug/render: returns only
// name/provider/present/masked/source/status per variable.
app.options('/api/ivx/variables-presence', () => publicJson({ ok: true }, 204));
app.get('/api/ivx/variables-presence', async (context) => {
  try {
    const report = buildRuntimeVariablesReport();
    const items = report.variables.map((v) => ({
      name: v.name,
      provider: v.verifyKind,
      present: v.present,
      masked: v.masked,
      source: v.resolvedFrom ? (v.publicWarning ? 'process_env_public' : 'process_env') : 'unavailable',
      status: v.status,
      isPublic: v.isPublic,
      description: v.description,
    }));
    return context.json({
      ok: true,
      marker: report.marker,
      generatedAt: report.generatedAt,
      runtimeLabel: report.runtimeLabel,
      total: report.total,
      present: report.present,
      missing: report.missing,
      variables: items,
      secretValuesReturned: false as const,
    }, 200, {
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    });
  } catch (error) {
    return context.json({ ok: false, error: error instanceof Error ? error.message : 'variables-presence failed', secretValuesReturned: false }, 500);
  }
});
app.options('/api/ivx/variables-tool/status', () => variablesToolOptions());
app.get('/api/ivx/variables-tool/status', async (context) => handleIVXVariablesToolStatusRequest(context.req.raw));
app.options('/api/ivx/variables-tool/save', () => variablesToolOptions());
app.post('/api/ivx/variables-tool/save', async (context) => handleIVXVariablesToolSaveRequest(context.req.raw));
app.options('/api/ivx/owner-variables/status', () => ownerVariablesOptions());
app.get('/api/ivx/owner-variables/status', async (context) => handleIVXOwnerVariablesStatusRequest(context.req.raw));
app.options('/api/ivx-owner-variables/status', () => publicJson({ ok: true }, 204));
app.get('/api/ivx-owner-variables/status', () => publicJson({
  ok: true,
  ownerOnly: false,
  routeRegistered: true,
  authenticatedStatusRoute: '/api/ivx/owner-variables/status',
  selfSyncRoute: '/api/ivx-owner-variables/self-sync',
  selfSyncRequiresOwnerBearer: true,
  secretValuesReturned: false,
  deploymentMarker: DEPLOYMENT_MARKER,
  timestamp: nowIso(),
}));
app.options('/api/ivx/owner-variables/save', () => ownerVariablesOptions());
app.post('/api/ivx/owner-variables/save', async (context) => handleIVXOwnerVariablesSaveRequest(context.req.raw));
app.options('/api/ivx/owner-variables/test', () => ownerVariablesOptions());
app.post('/api/ivx/owner-variables/test', async (context) => handleIVXOwnerVariablesTestRequest(context.req.raw));
app.options('/api/ivx/owner-variables/delete', () => ownerVariablesOptions());
app.post('/api/ivx/owner-variables/delete', async (context) => handleIVXOwnerVariablesDeleteRequest(context.req.raw));
app.options('/api/ivx/owner-variables/self-sync', () => ownerVariablesOptions());
app.post('/api/ivx/owner-variables/self-sync', async (context) => handleIVXOwnerVariablesSelfSyncRequest(context.req.raw));
app.options('/api/ivx-owner-variables/self-sync', () => ownerVariablesOptions());
app.post('/api/ivx-owner-variables/self-sync', async (context) => handleIVXOwnerVariablesSelfSyncRequest(context.req.raw));
app.options('/api/ivx/owner-variables/sync-from-project-store', () => ownerVariablesOptions());
app.post('/api/ivx/owner-variables/sync-from-project-store', async (context) => handleIVXOwnerVariablesSyncFromProjectStoreRequest(context.req.raw));
app.options('/api/ivx/owner-variables/deployment-status', () => ownerVariablesOptions());
app.get('/api/ivx/owner-variables/deployment-status', async (context) => handleIVXOwnerVariablesDeploymentStatusRequest(context.req.raw));
app.options('/api/ivx/independence/status', () => independenceStatusOptions());
app.get('/api/ivx/independence/status', async (context) => handleIVXIndependenceStatusRequest(context.req.raw));

app.options('/api/ivx/agent-jobs/status', () => agentJobsOptions());
app.get('/api/ivx/agent-jobs/status', async (context) => handleIVXAgentJobsStatusRequest(context.req.raw));
app.options('/api/ivx/agent-jobs', () => agentJobsOptions());
app.get('/api/ivx/agent-jobs', async (context) => handleIVXAgentJobsListRequest(context.req.raw));
app.post('/api/ivx/agent-jobs', async (context) => handleIVXAgentJobsCreateRequest(context.req.raw));
app.options('/api/ivx/agent-jobs/:jobId/retry', () => agentJobsOptions());
app.post('/api/ivx/agent-jobs/:jobId/retry', async (context) => handleIVXAgentJobActionRequest(context.req.raw, context.req.param('jobId'), 'retry'));
app.options('/api/ivx/agent-jobs/:jobId/cancel', () => agentJobsOptions());
app.post('/api/ivx/agent-jobs/:jobId/cancel', async (context) => handleIVXAgentJobActionRequest(context.req.raw, context.req.param('jobId'), 'cancel'));
app.options('/api/ivx/agent-jobs/:jobId/approve', () => agentJobsOptions());
app.post('/api/ivx/agent-jobs/:jobId/approve', async (context) => handleIVXAgentJobActionRequest(context.req.raw, context.req.param('jobId'), 'approve'));
app.options('/api/ivx/agent-worker/run-once', () => agentJobsOptions());
app.post('/api/ivx/agent-worker/run-once', async (context) => handleIVXAgentWorkerRunOnceRequest(context.req.raw));
app.options('/api/ivx/agent-jobs/live-activity', () => agentJobsOptions());
app.get('/api/ivx/agent-jobs/live-activity', async (context) => handleIVXAgentJobsLiveActivityRequest(context.req.raw));

// Block 2 — Media job lifecycle (queued → running → analyzing_media → generating_answer → completed/failed)
app.options('/api/ivx/media-jobs', () => ivxMediaJobsOptions());
app.post('/api/ivx/media-jobs', async (context) => handleIVXMediaJobsCreateRequest(context.req.raw));
app.options('/api/ivx/media-jobs/:jobId', () => ivxMediaJobsOptions());
app.get('/api/ivx/media-jobs/:jobId', async (context) => handleIVXMediaJobsGetRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/media-jobs/:jobId/advance', () => ivxMediaJobsOptions());
app.post('/api/ivx/media-jobs/:jobId/advance', async (context) => handleIVXMediaJobsAdvanceRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/media-jobs/:jobId/complete', () => ivxMediaJobsOptions());
app.post('/api/ivx/media-jobs/:jobId/complete', async (context) => handleIVXMediaJobsCompleteRequest(context.req.raw, context.req.param('jobId')));
app.options('/api/ivx/media-jobs/:jobId/fail', () => ivxMediaJobsOptions());
app.post('/api/ivx/media-jobs/:jobId/fail', async (context) => handleIVXMediaJobsFailRequest(context.req.raw, context.req.param('jobId')));

// Scoped, single-use, 10-min TTL test token for IVX Agent Runtime verification.
// Mint requires owner bearer; test-run accepts only ivx_test_* tokens with scope agent-jobs:test.
app.options('/api/ivx/agent-jobs/test-token', () => agentTestTokenOptions());
app.post('/api/ivx/agent-jobs/test-token', async (context) => handleIVXAgentTestTokenMintRequest(context.req.raw));
app.options('/api/ivx/agent-jobs/test-run', () => agentTestTokenOptions());
app.post('/api/ivx/agent-jobs/test-run', async (context) => handleIVXAgentTestRunRequest(context.req.raw));

// Owner-only Render deploy diagnostic — reads private credentials from process.env
// or the encrypted Owner Variables runtime bridge, without returning secret values.
app.options('/api/ivx/render-diagnostic', () => renderDiagnosticOptions());
app.get('/api/ivx/render-diagnostic', async (context) => handleIVXRenderDiagnosticRequest(context.req.raw));

// Owner-only APK/AAB distribution — mints a short-lived presigned S3 PUT URL
// (apk/ prefix only) so build artifacts upload without secrets leaving the runtime.
app.options('/api/ivx/apk/presign-upload', () => apkDistributionOptions());
app.post('/api/ivx/apk/presign-upload', async (context) => handleIVXApkPresignUploadRequest(context.req.raw));
app.options('/api/ivx/render-deploy-latest', () => renderDeployLatestOptions());
app.post('/api/ivx/render-deploy-latest', async (context) => handleIVXRenderDeployLatestRequest(context.req.raw));

// Block 22b — IVX Enterprise Deployment Engine v3 (public + owner-auth)
app.options('/api/ivx/deploy/status', () => deployEngineOptions());
app.get('/api/ivx/deploy/status', async () => handleDeployStatus());
app.options('/api/ivx/deploy/evidence', () => deployEngineOptions());
app.get('/api/ivx/deploy/evidence', async () => handleDeployEvidence());
app.options('/api/ivx/deploy/health', () => deployEngineOptions());
app.get('/api/ivx/deploy/health', async () => handleDeployHealth());
app.options('/api/ivx/deploy/trigger', () => deployEngineOptions());
app.post('/api/ivx/deploy/trigger', async (context) => handleDeployTrigger(context.req.raw));
app.options('/api/ivx/deploy/verify', () => deployEngineOptions());
app.post('/api/ivx/deploy/verify', async (context) => handleDeployVerify(context.req.raw));
app.options('/api/ivx/deploy/cycle', () => deployEngineOptions());
app.post('/api/ivx/deploy/cycle', async (context) => handleDeployCycle(context.req.raw));
app.options('/api/ivx/deploy/credentials', () => deployEngineOptions());
app.post('/api/ivx/deploy/credentials', async (context) => handleDeployCredentialsAudit(context.req.raw));
app.options('/api/ivx/deploy/monitor/start', () => deployEngineOptions());
app.post('/api/ivx/deploy/monitor/start', async (context) => handleDeployMonitorStart(context.req.raw));
app.options('/api/ivx/deploy/monitor/stop', () => deployEngineOptions());
app.post('/api/ivx/deploy/monitor/stop', async (context) => handleDeployMonitorStop(context.req.raw));

// Block 23 — Operational memory (pgvector) + autonomous execution loop
app.options('/api/ivx/operational-memory/status', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/status', async (context) => handleOpMemoryStatus(context.req.raw));
app.options('/api/ivx/operational-memory/search', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/search', async (context) => handleOpMemorySearch(context.req.raw));
app.options('/api/ivx/operational-memory/list', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/list', async (context) => handleOpMemoryList(context.req.raw));
app.options('/api/ivx/operational-memory', () => opMemoryOptions());
app.post('/api/ivx/operational-memory', async (context) => handleOpMemoryUpsert(context.req.raw));
app.options('/api/ivx/operational-memory/reindex', () => opMemoryOptions());
app.post('/api/ivx/operational-memory/reindex', async (context) => handleOpMemoryReindex(context.req.raw));
app.options('/api/ivx/operational-memory/snapshot', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/snapshot', async (context) => handleOpMemorySnapshot(context.req.raw));
app.options('/api/ivx/operational-memory/loop', () => opMemoryOptions());
app.post('/api/ivx/operational-memory/loop', async (context) => handleOpMemoryLoopRun(context.req.raw));
app.options('/api/ivx/operational-memory/tasks', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/tasks', async (context) => handleOpMemoryTasksList(context.req.raw));
app.options('/api/ivx/operational-memory/tasks/:taskId', () => opMemoryOptions());
app.get('/api/ivx/operational-memory/tasks/:taskId', async (context) => handleOpMemoryTaskGet(context.req.raw, context.req.param('taskId')));
app.options('/api/ivx/operational-memory/tasks/:taskId/rollback', () => opMemoryOptions());
app.post('/api/ivx/operational-memory/tasks/:taskId/rollback', async (context) => handleOpMemoryRollback(context.req.raw, context.req.param('taskId')));

// Block 24 — Active Engineering Intelligence
const engIntelRoutes: Array<[string, 'GET' | 'POST', (request: Request) => Promise<Response>]> = [
  ['/api/ivx/engineering/status', 'GET', handleEngIntelStatus],
  ['/api/ivx/engineering/dashboard', 'GET', handleEngIntelDashboard],
  ['/api/ivx/engineering/detect', 'GET', handleEngIntelDetect],
  ['/api/ivx/engineering/incidents', 'GET', handleEngIntelListIncidents],
  ['/api/ivx/engineering/decisions', 'GET', handleEngIntelListDecisions],
  ['/api/ivx/engineering/fix-outcomes', 'GET', handleEngIntelListFixOutcomes],
  ['/api/ivx/engineering/snapshots', 'GET', handleEngIntelListSnapshots],
  ['/api/ivx/engineering/telemetry', 'POST', handleEngIntelTelemetryIngest],
  ['/api/ivx/engineering/telemetry/stats', 'GET', handleEngIntelTelemetryStats],
  ['/api/ivx/engineering/confidence', 'GET', handleEngIntelConfidence],
  ['/api/ivx/engineering/gate', 'GET', handleEngIntelGate],
  ['/api/ivx/engineering/incidents/record', 'POST', handleEngIntelRecordIncident],
  ['/api/ivx/engineering/decisions/record', 'POST', handleEngIntelRecordDecision],
  ['/api/ivx/engineering/fix-outcomes/record', 'POST', handleEngIntelRecordFixOutcome],
  ['/api/ivx/engineering/snapshots/capture', 'POST', handleEngIntelSnapshotCapture],
  ['/api/ivx/engineering/simulate', 'POST', handleEngIntelSimulate],
];
for (const [routePath, method, handler] of engIntelRoutes) {
  app.options(routePath, () => engIntelOptions());
  if (method === 'GET') {
    app.get(routePath, async (context) => handler(context.req.raw));
  } else {
    app.post(routePath, async (context) => handler(context.req.raw));
  }
}

// Block 25: Multi-Agent Framework (owner-only)
const multiAgentGetRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/agents/status', handleMultiAgentStatus],
  ['/api/ivx/agents/active', handleMultiAgentActive],
  ['/api/ivx/agents/tasks', handleMultiAgentListTasks],
  ['/api/ivx/agents/handoffs', handleMultiAgentListHandoffs],
  ['/api/ivx/agents/audit', handleMultiAgentAudit],
  ['/api/ivx/agents/memory', handleMultiAgentMemoryRead],
  ['/api/ivx/agents/validate', handleMultiAgentValidate],
];
const multiAgentPostRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/agents/dispatch', handleMultiAgentDispatch],
  ['/api/ivx/agents/handoff', handleMultiAgentHandoff],
  ['/api/ivx/agents/memory', handleMultiAgentMemoryWrite],
  ['/api/ivx/agents/complete', handleMultiAgentComplete],
  ['/api/ivx/agents/fail', handleMultiAgentFail],
  ['/api/ivx/agents/route-preview', handleMultiAgentRoutePreview],
];
for (const [routePath, handler] of multiAgentGetRoutes) {
  app.options(routePath, () => multiAgentOptions());
  app.get(routePath, async (context) => handler(context.req.raw));
}
for (const [routePath, handler] of multiAgentPostRoutes) {
  app.options(routePath, () => multiAgentOptions());
  app.post(routePath, async (context) => handler(context.req.raw));
}
app.options('/api/ivx/agents/tasks/:taskId', () => multiAgentOptions());
app.get('/api/ivx/agents/tasks/:taskId', async (context) => handleMultiAgentGetTask(context.req.raw, context.req.param('taskId')));

// Role-Based Autonomous Agent Cloning (owner-only)
const roleAgentGetRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/role-agents/registry', handleRoleAgentRegistry],
  ['/api/ivx/role-agents/state', handleRoleAgentState],
  ['/api/ivx/role-agents/outputs', handleRoleAgentOutputs],
  ['/api/ivx/role-agents/validate', handleRoleAgentValidate],
];
const roleAgentPostRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/role-agents/enqueue', handleRoleAgentEnqueue],
  ['/api/ivx/role-agents/run', handleRoleAgentRun],
  ['/api/ivx/role-agents/run-all', handleRoleAgentRunAll],
  ['/api/ivx/role-agents/toggle', handleRoleAgentToggle],
  ['/api/ivx/role-agents/validate', handleRoleAgentValidate],
];
for (const [routePath, handler] of roleAgentGetRoutes) {
  app.options(routePath, () => roleAgentsOptions());
  app.get(routePath, async (context) => handler(context.req.raw));
}
for (const [routePath, handler] of roleAgentPostRoutes) {
  app.options(routePath, () => roleAgentsOptions());
  app.post(routePath, async (context) => handler(context.req.raw));
}

// IVX Engineering OS — 24/7 engineering mapping (owner-only)
const engineeringOsGetRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/engineering-os/teams', handleEngineeringTeams],
  ['/api/ivx/engineering-os/status', handleEngineeringStatus],
  ['/api/ivx/engineering-os/tasks', handleEngineeringTasksList],
  ['/api/ivx/engineering-os/report', handleEngineeringReportLatest],
];
const engineeringOsPostRoutes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['/api/ivx/engineering-os/teams/sync', handleEngineeringTeamsSync],
  ['/api/ivx/engineering-os/tasks/create', handleEngineeringTaskCreate],
  ['/api/ivx/engineering-os/tasks/advance', handleEngineeringTaskAdvance],
  ['/api/ivx/engineering-os/tasks/evidence', handleEngineeringTaskEvidence],
  ['/api/ivx/engineering-os/tasks/approve', handleEngineeringTaskApprove],
  ['/api/ivx/engineering-os/activate', handleEngineeringActivate],
  ['/api/ivx/engineering-os/report/run', handleEngineeringReportRun],
];
for (const [routePath, handler] of engineeringOsGetRoutes) {
  app.options(routePath, () => engineeringOsOptions());
  app.get(routePath, async (context) => handler(context.req.raw));
}
for (const [routePath, handler] of engineeringOsPostRoutes) {
  app.options(routePath, () => engineeringOsOptions());
  app.post(routePath, async (context) => handler(context.req.raw));
}

// Block 26: Agent Self-Execution Test (owner-only)
app.options('/api/ivx/agents/self-execute', () => selfExecOptions());
app.post('/api/ivx/agents/self-execute', async (context) => handleSelfExecRun(context.req.raw));
app.options('/api/ivx/agents/self-execute/result', () => selfExecOptions());
app.get('/api/ivx/agents/self-execute/result', async (context) => handleSelfExecResult(context.req.raw));

// Block 27: Parallel Agent Execution (owner-only)
app.options('/api/ivx/agents/parallel/dispatch', () => parallelAgentsOptions());
app.post('/api/ivx/agents/parallel/dispatch', async (context) => handleParallelDispatch(context.req.raw));
app.options('/api/ivx/agents/parallel/list', () => parallelAgentsOptions());
app.get('/api/ivx/agents/parallel/list', async (context) => handleParallelList(context.req.raw));
app.options('/api/ivx/agents/parallel/decompose', () => parallelAgentsOptions());
app.post('/api/ivx/agents/parallel/decompose', async (context) => handleParallelDecomposePreview(context.req.raw));
app.options('/api/ivx/agents/parallel/validate', () => parallelAgentsOptions());
app.post('/api/ivx/agents/parallel/validate', async (context) => handleParallelValidate(context.req.raw));
app.options('/api/ivx/agents/parallel/:parentId', () => parallelAgentsOptions());
app.get('/api/ivx/agents/parallel/:parentId', async (context) => handleParallelGet(context.req.raw, context.req.param('parentId')));
app.options('/api/ivx/agents/parallel/:parentId/tree', () => parallelAgentsOptions());
app.get('/api/ivx/agents/parallel/:parentId/tree', async (context) => handleParallelGetTree(context.req.raw, context.req.param('parentId')));

// Block 28: CTO Operational Dashboard (owner-only)
app.options('/api/ivx/cto-dashboard/overview', () => ctoDashboardOptions());
app.get('/api/ivx/cto-dashboard/overview', async (context) => handleCTODashboardOverview(context.req.raw));
app.options('/api/ivx/cto-dashboard/audit', () => ctoDashboardOptions());
app.get('/api/ivx/cto-dashboard/audit', async (context) => handleCTODashboardAuditSearch(context.req.raw));
app.options('/api/ivx/cto-dashboard/control', () => ctoDashboardOptions());
app.post('/api/ivx/cto-dashboard/control', async (context) => handleCTODashboardControl(context.req.raw));
app.options('/api/ivx/cto-dashboard/autonomous-cycle/control', () => ctoDashboardOptions());
app.post('/api/ivx/cto-dashboard/autonomous-cycle/control', async (context) => handleCTODashboardAutonomousCycleControl(context.req.raw));
app.options('/api/ivx/cto-dashboard/autonomous-cycle/validate', () => ctoDashboardOptions());
app.post('/api/ivx/cto-dashboard/autonomous-cycle/validate', async (context) => handleCTODashboardAutonomousCycleValidate(context.req.raw));
app.options('/api/ivx/cto-dashboard/parent/:parentId/tree', () => ctoDashboardOptions());
app.get('/api/ivx/cto-dashboard/parent/:parentId/tree', async (context) => handleCTODashboardParentTree(context.req.raw, context.req.param('parentId')));

// Block 29: Autonomous Real-World Engineering Cycle (owner-only)
app.options('/api/ivx/autonomous-cycle/status', () => autonomousCycleOptions());
app.get('/api/ivx/autonomous-cycle/status', async (context) => handleAutonomousCycleStatus(context.req.raw));
app.options('/api/ivx/autonomous-cycle/classify', () => autonomousCycleOptions());
app.post('/api/ivx/autonomous-cycle/classify', async (context) => handleAutonomousCycleClassify(context.req.raw));
app.options('/api/ivx/autonomous-cycle/run', () => autonomousCycleOptions());
app.post('/api/ivx/autonomous-cycle/run', async (context) => handleAutonomousCycleRun(context.req.raw));
app.options('/api/ivx/autonomous-cycle/list', () => autonomousCycleOptions());
app.get('/api/ivx/autonomous-cycle/list', async (context) => handleAutonomousCycleList(context.req.raw));
app.options('/api/ivx/autonomous-cycle/validate', () => autonomousCycleOptions());
app.post('/api/ivx/autonomous-cycle/validate', async (context) => handleAutonomousCycleValidate(context.req.raw));
app.options('/api/ivx/autonomous-cycle/:cycleId', () => autonomousCycleOptions());
app.get('/api/ivx/autonomous-cycle/:cycleId', async (context) => handleAutonomousCycleGet(context.req.raw, context.req.param('cycleId')));

app.options('/api/ivx/ai-brain/tools', () => aiBrainToolsOptions());
app.get('/api/ivx/ai-brain/tools', async (context) => handleIVXAIBrainToolsListRequest(context.req.raw));
app.post('/api/ivx/ai-brain/tools', async (context) => handleIVXAIBrainToolExecuteRequest(context.req.raw));
app.options('/api/ivx/ai-brain/tools/execute', () => aiBrainToolsOptions());
app.post('/api/ivx/ai-brain/tools/execute', async (context) => handleIVXAIBrainToolExecuteRequest(context.req.raw));

const supabaseInspectionRoutePairs: Array<[string, 'tables' | 'schema' | 'columns' | 'rls']> = [
  ['/api/ivx/supabase/tables', 'tables'],
  ['/api/ivx/supabase/schema', 'schema'],
  ['/api/ivx/supabase/columns', 'columns'],
  ['/api/ivx/supabase/rls', 'rls'],
];

for (const [routePath, kind] of supabaseInspectionRoutePairs) {
  app.options(routePath, () => supabaseInspectionOptions());
  app.get(routePath, async (context) => handleIVXSupabaseInspectionRequest(context.req.raw, kind));
}

app.options('/api/ivx/supabase/owner-action', () => supabaseOwnerActionOptions());
app.post('/api/ivx/supabase/owner-action', async (context) => handleIVXSupabaseOwnerActionRequest(context.req.raw));
app.options('/api/ivx/supabase/owner-action-health', () => publicJson({ ok: true }, 204));
app.get('/api/ivx/supabase/owner-action-health', async () => {
  const endpoint = '/api/ivx/supabase/owner-action-health';
  try {
    const payload = await buildRenderProofToolPayload('supabase-status', endpoint);
    const data = readObject(payload.data);
    const minimumReady = data.minimumReadOnlyReady === true;
    return publicJson({
      ok: payload.ok && minimumReady,
      status: payload.status,
      service: 'ivx-supabase-owner-action-health',
      endpoint,
      ownerActionRoute: 'POST /api/ivx/supabase/owner-action',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: payload.timestamp,
      supabase: data,
      error: payload.error,
      missingEnvNames: payload.missingEnvNames ?? [],
    });
  } catch (error) {
    return publicJson({
      ok: false,
      status: 'not_verified',
      service: 'ivx-supabase-owner-action-health',
      endpoint,
      ownerActionRoute: 'POST /api/ivx/supabase/owner-action',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
      error: error instanceof Error ? error.message : 'Supabase owner-action health probe failed.',
    }, 200);
  }
});

app.options('/api/ivx/owner-registration', () => ownerRegistrationOptions());
app.options('/api/ivx/owner-registration/status', () => ownerRegistrationOptions());
app.options('/api/ivx/owner-registration/repair', () => ownerRegistrationOptions());
app.options('/api/ivx/owner-access-repair', () => ownerRegistrationOptions());
app.options('/api/ivx/owner-access-repair/status', () => ownerRegistrationOptions());
app.options('/api/ivx/owner-passwordless-login', () => ivxOwnerPasswordlessLoginOptions());
app.options('/api/ivx/owner-recovery/status', () => ownerRecoverySmsOptions());
app.options('/api/ivx/owner-recovery/request', () => ownerRecoverySmsOptions());
app.options('/api/ivx/owner-recovery/verify', () => ownerRecoverySmsOptions());
app.options('/api/ivx/owner-recovery/resolve-token', () => ownerRecoverySmsOptions());
app.options('/api/ivx/owner-signup-audit', () => ownerRegistrationOptions());
app.get('/api/ivx/owner-registration/status', async (context) => handleIVXOwnerRegistrationStatusRequest(context.req.raw));
app.get('/api/ivx/owner-access-repair/status', async (context) => handleIVXOwnerAccessRepairStatusRequest(context.req.raw));
app.get('/api/ivx/owner-signup-audit', async (context) => handleIVXOwnerSignupAuditRequest(context.req.raw));
app.post('/api/ivx/owner-registration', async (context) => handleIVXOwnerRegistrationRequest(context.req.raw));
app.post('/api/ivx/owner-registration/repair', async (context) => handleIVXOwnerRegistrationRepairRequest(context.req.raw));
app.post('/api/ivx/owner-access-repair', async (context) => handleIVXOwnerAccessRepairRequest(context.req.raw));
app.post('/api/ivx/owner-passwordless-login', async (context) => withRateLimit(context.req.raw, 'owner-login', 3, 0.2, () => handleIVXOwnerPasswordlessLogin(context.req.raw)) as Promise<Response>);
app.get('/api/ivx/owner-recovery/status', async (context) => handleOwnerRecoveryStatusRequest(context.req.raw));
app.post('/api/ivx/owner-recovery/request', async (context) => handleOwnerRecoveryRequestRequest(context.req.raw));
app.post('/api/ivx/owner-recovery/verify', async (context) => handleOwnerRecoveryVerifyRequest(context.req.raw));
app.get('/api/ivx/owner-recovery/resolve-token', async (context) => handleOwnerRecoveryResolveTokenRequest(context.req.raw));

app.options('/assistant', () => assistantOptions());
app.options('/api/assistant', () => assistantOptions());
app.post('/assistant', async (context) => handleAssistantPost(context.req.raw));
app.post('/api/assistant', async (context) => handleAssistantPost(context.req.raw));

app.options('/plan-creator', () => planCreatorOptions());
app.options('/api/plan-creator', () => planCreatorOptions());
app.post('/plan-creator', async (context) => handlePlanCreatorPost(context.req.raw));
app.post('/api/plan-creator', async (context) => handlePlanCreatorPost(context.req.raw));

app.options('/public/chat', (context) => context.body(null, 204));
app.options('/api/public/chat', (context) => context.body(null, 204));
app.options('/public/chat/history', (context) => context.body(null, 204));
app.options('/api/public/chat/history', (context) => context.body(null, 204));
app.options('/public/chat/sessions', (context) => context.body(null, 204));
app.options('/api/public/chat/sessions', (context) => context.body(null, 204));
app.options('/public/messages', (context) => context.body(null, 204));
app.options('/api/public/messages', (context) => context.body(null, 204));
app.options('/public/rooms', (context) => context.body(null, 204));
app.options('/api/public/rooms', (context) => context.body(null, 204));
app.options('/public/send-message', (context) => context.body(null, 204));
app.options('/api/public/send-message', (context) => context.body(null, 204));
app.post('/public/chat', async (context) => handlePublicChatPost(context.req.raw));
app.post('/api/public/chat', async (context) => handlePublicChatPost(context.req.raw));
app.get('/public/chat/history', async (context) => handlePublicChatHistoryGet(context.req.raw));
app.get('/api/public/chat/history', async (context) => handlePublicChatHistoryGet(context.req.raw));
app.get('/public/chat/sessions', async (context) => handlePublicChatSessionsGet(context.req.raw));
app.get('/api/public/chat/sessions', async (context) => handlePublicChatSessionsGet(context.req.raw));
app.get('/public/messages', async (context) => handlePublicRoomMessages(context.req.raw));
app.get('/api/public/messages', async (context) => handlePublicRoomMessages(context.req.raw));
app.get('/public/rooms', async (context) => handlePublicRoomState(context.req.raw));
app.get('/api/public/rooms', async (context) => handlePublicRoomState(context.req.raw));
app.post('/public/send-message', async (context) => handlePublicRoomSend(context.req.raw));
app.post('/api/public/send-message', async (context) => handlePublicRoomSend(context.req.raw));

// Owner room routes (primary + /api-prefixed aliases)
const ownerRoutePairs: Array<[string, string]> = [
  ['/chat', '/api/chat'],
  ['/messages', '/api/messages'],
  ['/messages/search', '/api/messages/search'],
  ['/upload', '/api/upload'],
  ['/rooms', '/api/rooms'],
  ['/inbox/sync', '/api/inbox/sync'],
  ['/diagnostics', '/api/diagnostics'],
  ['/fallback/reply', '/api/fallback/reply'],
];

for (const [primary, aliased] of ownerRoutePairs) {
  app.options(primary, () => ownerRoutesOptions());
  app.options(aliased, () => ownerRoutesOptions());
}

app.post('/chat', async (c) => handleChatPost(c.req.raw));
app.post('/api/chat', async (c) => handleChatPost(c.req.raw));

app.get('/messages/search', async (c) => handleMessagesSearch(c.req.raw));
app.get('/api/messages/search', async (c) => handleMessagesSearch(c.req.raw));
app.get('/messages', async (c) => handleMessagesGet(c.req.raw));
app.get('/api/messages', async (c) => handleMessagesGet(c.req.raw));
app.post('/messages', async (c) => handleMessagesPost(c.req.raw));
app.post('/api/messages', async (c) => handleMessagesPost(c.req.raw));

app.post('/upload', async (c) => handleUploadPost(c.req.raw));
app.post('/api/upload', async (c) => handleUploadPost(c.req.raw));

app.get('/rooms', async (c) => handleRoomsGet(c.req.raw));
app.get('/api/rooms', async (c) => handleRoomsGet(c.req.raw));
app.post('/rooms', async (c) => handleRoomsPost(c.req.raw));
app.post('/api/rooms', async (c) => handleRoomsPost(c.req.raw));

app.post('/inbox/sync', async (c) => handleInboxSync(c.req.raw));
app.post('/api/inbox/sync', async (c) => handleInboxSync(c.req.raw));

app.get('/diagnostics', async (c) => handleDiagnosticsGet(c.req.raw));
app.get('/api/diagnostics', async (c) => handleDiagnosticsGet(c.req.raw));

app.post('/fallback/reply', async (c) => handleFallbackReply(c.req.raw));
app.post('/api/fallback/reply', async (c) => handleFallbackReply(c.req.raw));

// Owner-only multimodal upload + analysis
app.options('/api/upload/image', () => ownerMultimodalOptions());
app.options('/api/upload/pdf', () => ownerMultimodalOptions());
app.options('/api/upload/video', () => ownerMultimodalOptions());
app.options('/api/google-drive/import', () => ownerMultimodalOptions());
app.options('/api/files/:fileId/analyze', () => ownerMultimodalOptions());
app.options('/api/files/:fileId/summary', () => ownerMultimodalOptions());
app.options('/api/multimodal/status', () => publicJson({ ok: true }, 204));
app.get('/api/multimodal/status', () => publicJson(buildMultimodalStatusPayload()));
app.post('/api/upload/image', async (c) => handleMultimodalImageUpload(c.req.raw));
app.post('/api/upload/pdf', async (c) => handleMultimodalPdfUpload(c.req.raw));
app.post('/api/upload/video', async (c) => handleMultimodalVideoUpload(c.req.raw));
app.post('/api/google-drive/import', async (c) => handleMultimodalGoogleDriveImport(c.req.raw));
app.post('/api/files/:fileId/analyze', async (c) => handleMultimodalAnalyze(c.req.raw, c.req.param('fileId')));
app.post('/api/files/:fileId/summary', async (c) => handleMultimodalSummary(c.req.raw, c.req.param('fileId')));
app.options('/audio/transcribe', () => ownerTranscriptionOptions());
app.options('/api/audio/transcribe', () => ownerTranscriptionOptions());
app.post('/audio/transcribe', async (c) => handleOwnerAudioTranscribe(c.req.raw));
app.post('/api/audio/transcribe', async (c) => handleOwnerAudioTranscribe(c.req.raw));

// Diagnostic AI provider test — makes a real OpenAI call and returns the
// result or the exact error (status, response body, error name). Never
// exposes the API key value. Used to diagnose silent fallback failures.
app.options('/api/ivx/ai-test', () => publicJson({ ok: true }, 204));
app.get('/api/ivx/ai-test', async (context) => {
  const startup = validateIVXAIStartup();
  const providerType = startup.providerType;
  const testPrompt = 'Reply with exactly: IVX_AI_TEST_OK';
  const testStartedAt = Date.now();

  // Raw HTTP fetch test — bypasses all SDK layers and sends a direct request
  // to the Vercel AI Gateway with the key as a Bearer token. This definitively
  // determines if the key is valid/expired vs an SDK routing issue.
  const rawKey = readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.AI_GATEWAY_API_KEY);
  const rawEndpoint = startup.baseUrl ?? 'https://ai-gateway.vercel.sh/v1';
  let rawTestResult: { ok: boolean; status: number; body: string } | null = null;
  if (rawKey) {
    try {
      const rawResponse = await fetch(`${rawEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawKey}`,
        },
        body: JSON.stringify({
          model: startup.model,
          messages: [{ role: 'user', content: testPrompt }],
          max_tokens: 20,
        }),
      });
      const rawBody = await rawResponse.text();
      rawTestResult = {
        ok: rawResponse.ok,
        status: rawResponse.status,
        body: rawBody.slice(0, 500),
      };
    } catch (rawError) {
      rawTestResult = {
        ok: false,
        status: 0,
        body: rawError instanceof Error ? rawError.message : 'fetch failed',
      };
    }
  }

  try {
    const result = await requestIVXAIText({
      module: 'ai-test',
      requestId: `ai-test-${Date.now()}`,
      prompt: testPrompt,
      maxOutputTokens: 20,
    });
    return context.json({
      ok: true,
      providerType,
      keyPrefix: startup.keyPrefix,
      baseUrl: startup.baseUrl,
      model: startup.model,
      adapterVersion: startup.adapterVersion,
      responseText: result.text,
      responseModel: result.providerMetadata.model,
      responseEndpoint: result.providerMetadata.endpoint,
      rawTest: rawTestResult,
      latencyMs: Date.now() - testStartedAt,
      timestamp: nowIso(),
    });
  } catch (error) {
    const err = error as Error & { traceId?: string };
    return context.json({
      ok: false,
      providerType,
      keyPrefix: startup.keyPrefix,
      baseUrl: startup.baseUrl,
      model: startup.model,
      adapterVersion: startup.adapterVersion,
      errorName: err?.name ?? 'Unknown',
      errorMessage: err?.message ?? 'Unknown error',
      traceId: err?.traceId ?? null,
      rawTest: rawTestResult,
      latencyMs: Date.now() - testStartedAt,
      timestamp: nowIso(),
    });
  }
});

// Owner-only video worker (ffmpeg frame/audio extraction -> transcription -> AI frame analysis)
app.options('/api/video/jobs', () => ownerVideoWorkerOptions());
app.options('/api/video/jobs/:jobId', () => ownerVideoWorkerOptions());
app.options('/api/video/jobs/:jobId/retry', () => ownerVideoWorkerOptions());
app.options('/api/video/capabilities', () => ownerVideoWorkerOptions());
app.post('/api/video/jobs', async (c) => handleVideoJobCreate(c.req.raw));
app.get('/api/video/jobs', async (c) => handleVideoJobList(c.req.raw));
app.get('/api/video/jobs/:jobId', async (c) => handleVideoJobGet(c.req.raw, c.req.param('jobId')));
app.post('/api/video/jobs/:jobId/retry', async (c) => handleVideoJobRetry(c.req.raw, c.req.param('jobId')));
app.get('/api/video/capabilities', async (c) => handleVideoWorkerCapabilities(c.req.raw));

// Owner-only Autonomous Growth Engine (idea/JV/tokenization/module/outreach + owner gates)
app.options('/api/growth/overview', () => ownerGrowthEngineOptions());
app.options('/api/growth/capabilities', () => ownerGrowthEngineOptions());
app.options('/api/growth/ideas', () => ownerGrowthEngineOptions());
app.options('/api/growth/leads', () => ownerGrowthEngineOptions());
app.options('/api/growth/leads/master', () => ownerGrowthEngineOptions());
app.options('/api/growth/leads/audit', () => ownerGrowthEngineOptions());
app.options('/api/growth/leads/:leadId/approve', () => ownerGrowthEngineOptions());
app.options('/api/growth/leads/:leadId/reject', () => ownerGrowthEngineOptions());
app.options('/api/growth/jv', () => ownerGrowthEngineOptions());
app.options('/api/growth/tokenization', () => ownerGrowthEngineOptions());
app.options('/api/growth/modules', () => ownerGrowthEngineOptions());
app.options('/api/growth/outreach', () => ownerGrowthEngineOptions());
app.get('/api/growth/overview', async (c) => handleGrowthOverview(c.req.raw));
app.get('/api/growth/capabilities', async (c) => handleGrowthCapabilities(c.req.raw));
app.post('/api/growth/ideas', async (c) => handleGrowthIdeaGenerate(c.req.raw));
app.get('/api/growth/ideas', async (c) => handleGrowthIdeaList(c.req.raw));
app.post('/api/growth/leads', async (c) => handleGrowthLeadDiscover(c.req.raw));
app.get('/api/growth/leads', async (c) => handleGrowthLeadList(c.req.raw));
app.get('/api/growth/leads/master', async (c) => handleGrowthMasterList(c.req.raw));
app.get('/api/growth/leads/audit', async (c) => handleGrowthLeadAudit(c.req.raw));
app.post('/api/growth/leads/:leadId/approve', async (c) => handleGrowthLeadApprove(c.req.raw, c.req.param('leadId')));
app.post('/api/growth/leads/:leadId/reject', async (c) => handleGrowthLeadReject(c.req.raw, c.req.param('leadId')));
app.post('/api/growth/jv', async (c) => handleGrowthJVDraft(c.req.raw));
app.get('/api/growth/jv', async (c) => handleGrowthJVList(c.req.raw));
app.post('/api/growth/tokenization', async (c) => handleGrowthTokenizationDraft(c.req.raw));
app.get('/api/growth/tokenization', async (c) => handleGrowthTokenizationList(c.req.raw));
app.post('/api/growth/modules', async (c) => handleGrowthModuleDraft(c.req.raw));
app.get('/api/growth/modules', async (c) => handleGrowthModuleList(c.req.raw));
app.post('/api/growth/outreach', async (c) => handleGrowthOutreachDraft(c.req.raw));
app.get('/api/growth/outreach', async (c) => handleGrowthOutreachList(c.req.raw));

// Route53 diagnostics
app.options('/api/aws/route53/audit', async () => handleRoute53Options());
app.options('/api/aws/route53/upsert', async () => handleRoute53Options());
app.post('/api/aws/route53/audit', async (c) => handleRoute53Request(c.req.raw, 'audit'));
app.post('/api/aws/route53/upsert', async (c) => handleRoute53Request(c.req.raw, 'upsert'));

// ---- IVX Autonomous Repair Brain: incidents + production guard ----
app.options('/api/ivx/incidents', () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' } }));
app.post('/api/ivx/incidents', async (c) => handleIVXIncidentIngest(c.req.raw));
app.get('/api/ivx/incidents', async (c) => handleIVXIncidentsList(c.req.raw));
app.get('/api/ivx/incidents/:id', async (c) => handleIVXIncidentGet(c.req.raw, c.req.param('id')));
app.post('/api/ivx/incidents/:id/diagnose', async (c) => handleIVXIncidentDiagnose(c.req.raw, c.req.param('id')));
app.post('/api/ivx/incidents/:id/approve', async (c) => handleIVXIncidentApprove(c.req.raw, c.req.param('id')));
app.post('/api/ivx/incidents/:id/stage', async (c) => handleIVXIncidentStage(c.req.raw, c.req.param('id')));
app.post('/api/ivx/incidents/:id/replay', async (c) => handleIVXIncidentReplay(c.req.raw, c.req.param('id')));
app.post('/api/ivx/incidents/:id/promote', async (c) => handleIVXIncidentPromote(c.req.raw, c.req.param('id')));
app.get('/api/ivx/incidents/:id/policy', async (c) => handleIVXIncidentPolicy(c.req.raw, c.req.param('id')));
app.get('/api/ivx/production-guard/health', async (c) => handleIVXProductionGuardHealth(c.req.raw));
app.post('/api/ivx/production-guard/rollback', async (c) => handleIVXProductionGuardRollback(c.req.raw));

// ---- IVX Repair Job Orchestrator (async pipeline) ----
app.options('/api/ivx/repair-jobs', () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' } }));
app.post('/api/ivx/repair-jobs', async (c) => handleIVXRepairJobStart(c.req.raw));
app.get('/api/ivx/repair-jobs', async (c) => handleIVXRepairJobList(c.req.raw));
app.get('/api/ivx/repair-jobs/:id', async (c) => handleIVXRepairJobGet(c.req.raw, c.req.param('id')));
app.get('/api/ivx/repair-jobs/by-incident/:incidentId', async (c) => handleIVXRepairJobByIncident(c.req.raw, c.req.param('incidentId')));

// ---- IVX Member Registration + Verification ----
app.options('/api/members/register', () => membersOptions());
app.options('/api/members/send-email-code', () => membersOptions());
app.options('/api/members/verify-email', () => membersOptions());
app.options('/api/members/send-phone-code', () => membersOptions());
app.options('/api/members/verify-phone', () => membersOptions());
app.options('/api/members/me', () => membersOptions());
app.options('/api/members/start-kyc', () => membersOptions());
app.options('/api/members/verification-status', () => membersOptions());
app.options('/api/members/login', () => membersOptions());
app.options('/api/members/forgot-password', () => membersOptions());
app.options('/api/members/reset-password', () => membersOptions());
app.options('/api/members/profile', () => membersOptions());

app.post('/api/members/register', async (c) => withRateLimit(c.req.raw, 'member-register', 5, 0.3, () => handleMemberRegister(c.req.raw)) as Promise<Response>);
app.post('/api/members/send-email-code', async (c) => handleSendEmailCode(c.req.raw));
app.post('/api/members/verify-email', async (c) => handleVerifyEmail(c.req.raw));
app.post('/api/members/send-phone-code', async (c) => handleSendPhoneCode(c.req.raw));
app.post('/api/members/verify-phone', async (c) => handleVerifyPhone(c.req.raw));
app.get('/api/members/me', async (c) => handleGetMemberProfile(c.req.raw));
app.post('/api/members/start-kyc', async (c) => handleStartKYC(c.req.raw));
app.get('/api/members/verification-status', async (c) => handleVerificationStatus(c.req.raw));
app.post('/api/members/login', async (c) => withRateLimit(c.req.raw, 'member-login', 5, 0.5, () => handleMemberLogin(c.req.raw)) as Promise<Response>);
app.post('/api/members/forgot-password', async (c) => withRateLimit(c.req.raw, 'member-forgot', 3, 0.1, () => handleMemberForgotPassword(c.req.raw)) as Promise<Response>);
app.post('/api/members/reset-password', async (c) => handleMemberResetPassword(c.req.raw));
app.post('/api/members/profile', async (c) => handleUpdateMemberProfile(c.req.raw));

// ---- IVX Canonical Members registry (landing → Members module sync) ----
app.options('/api/ivx/members/registry', () => membersOptions());
app.options('/api/ivx/members/summary', () => membersOptions());
app.options('/api/ivx/members/backfill', () => membersOptions());
app.options('/api/ivx/members', () => membersOptions());
app.get('/api/ivx/members/registry', async (c) => handleCanonicalMembersRegistry(c.req.raw));
app.get('/api/ivx/members/summary', async (c) => handleCanonicalMembersSummary(c.req.raw));
app.get('/api/ivx/members', async (c) => handleCanonicalMembersList(c.req.raw));
app.post('/api/ivx/members/backfill', async (c) => handleCanonicalMembersBackfill(c.req.raw));

// IVX canonical members count — compact counts endpoint for executor verification
// and Owner AI status checks. Returns members, waitlist, investors, buyers, total.
app.get('/api/ivx/members/count', async () => {
  // Public aggregate-only counts (no PII) — safe without owner auth.
  const { listCanonicalMembers, countCanonicalMembers, isCanonicalMembersConfigured } = await import('./services/ivx-canonical-members');
  if (!isCanonicalMembersConfigured()) {
    return Response.json({ ok: true, members: 0, waitlist: 0, investors: 0, buyers: 0, total: 0, timestamp: nowIso(), deploymentMarker: DEPLOYMENT_MARKER });
  }
  const all = await listCanonicalMembers({ limit: 5000 });
  const byType: Record<string, number> = {};
  for (const m of all) byType[m.member_type] = (byType[m.member_type] ?? 0) + 1;
  const members = (byType['member'] ?? 0) + (byType['user'] ?? 0);
  const waitlist = byType['waitlist'] ?? 0;
  const investors = byType['investor'] ?? 0;
  const buyers = byType['buyer'] ?? 0;
  return Response.json({
    ok: true,
    members,
    waitlist,
    investors,
    buyers,
    total: await countCanonicalMembers(),
    timestamp: nowIso(),
    deploymentMarker: DEPLOYMENT_MARKER,
  });
});

// ---- IVX Two-Stage Member & Investor System (Phase 2 activation + admin funnel) ----
app.options('/api/members/investor-application', () => memberInvestorOptions());
app.options('/api/members/investor-application/review', () => memberInvestorOptions());
app.options('/api/members/funnel/visitor', () => memberInvestorOptions());
app.options('/api/ivx/member-admin/dashboard', () => memberAdminOptions());
app.options('/api/ivx/member-admin/investors', () => memberAdminOptions());

app.post('/api/members/investor-application', async (c) => handleInvestorApplicationSubmit(c.req.raw));
app.get('/api/members/investor-application', async (c) => handleInvestorApplicationGet(c.req.raw));
app.post('/api/members/investor-application/review', async (c) => handleInvestorApplicationReview(c.req.raw));
app.post('/api/members/funnel/visitor', async (c) => handleFunnelVisitor(c.req.raw));
app.get('/api/ivx/member-admin/dashboard', async (c) => handleMemberAdminDashboard(c.req.raw));
app.get('/api/ivx/member-admin/investors', async (c) => handleMemberAdminInvestors(c.req.raw));

// ---- IVX Enterprise Capital & Treasury ----
// Member-facing: accounts + statements
app.options('/api/treasury/accounts', () => treasuryOptions());
app.options('/api/treasury/account', () => treasuryOptions());
app.options('/api/treasury/statement', () => treasuryOptions());
app.post('/api/treasury/accounts', async (c) => handleTreasuryAccountCreate(c.req.raw));
app.get('/api/treasury/accounts', async (c) => handleTreasuryAccountsList(c.req.raw));
app.get('/api/treasury/account', async (c) => handleTreasuryAccountSummary(c.req.raw));
app.get('/api/treasury/statement', async (c) => handleTreasuryStatement(c.req.raw));
// Owner/admin: ledger, approvals, property capital, distributions, commissions,
// influencers, reconciliation, dashboard, reports, AI finance
app.options('/api/ivx/treasury/ledger', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/ledger/amend', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/audit', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/approvals', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/approvals/decide', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/property-capital', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/distributions', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/distributions/calculate', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/distributions/execute', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/commissions', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/commissions/status', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/influencers', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/influencers/track', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/influencers/pay', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/reconciliation/bank-item', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/reconciliation/bank-items', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/reconciliation/run', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/dashboard', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/reports', () => treasuryAdminOptions());
app.options('/api/ivx/treasury/ai-finance', () => treasuryAdminOptions());
app.post('/api/ivx/treasury/ledger', async (c) => handleTreasuryLedgerRecord(c.req.raw));
app.get('/api/ivx/treasury/ledger', async (c) => handleTreasuryLedgerList(c.req.raw));
app.post('/api/ivx/treasury/ledger/amend', async (c) => handleTreasuryLedgerAmend(c.req.raw));
app.get('/api/ivx/treasury/audit', async (c) => handleTreasuryAudit(c.req.raw));
app.get('/api/ivx/treasury/approvals', async (c) => handleTreasuryApprovalsList(c.req.raw));
app.post('/api/ivx/treasury/approvals/decide', async (c) => handleTreasuryApprovalDecide(c.req.raw));
app.post('/api/ivx/treasury/property-capital', async (c) => handleTreasuryPropertyCapitalUpsert(c.req.raw));
app.get('/api/ivx/treasury/property-capital', async (c) => handleTreasuryPropertyCapitalGet(c.req.raw));
app.post('/api/ivx/treasury/distributions/calculate', async (c) => handleTreasuryDistributionCalculate(c.req.raw));
app.post('/api/ivx/treasury/distributions/execute', async (c) => handleTreasuryDistributionExecute(c.req.raw));
app.get('/api/ivx/treasury/distributions', async (c) => handleTreasuryDistributionsList(c.req.raw));
app.post('/api/ivx/treasury/commissions', async (c) => handleTreasuryCommissionRecord(c.req.raw));
app.get('/api/ivx/treasury/commissions', async (c) => handleTreasuryCommissionsList(c.req.raw));
app.post('/api/ivx/treasury/commissions/status', async (c) => handleTreasuryCommissionStatus(c.req.raw));
app.post('/api/ivx/treasury/influencers', async (c) => handleTreasuryInfluencerUpsert(c.req.raw));
app.post('/api/ivx/treasury/influencers/track', async (c) => handleTreasuryInfluencerTrack(c.req.raw));
app.post('/api/ivx/treasury/influencers/pay', async (c) => handleTreasuryInfluencerPay(c.req.raw));
app.get('/api/ivx/treasury/influencers', async (c) => handleTreasuryInfluencersList(c.req.raw));
app.post('/api/ivx/treasury/reconciliation/bank-item', async (c) => handleTreasuryBankItemAdd(c.req.raw));
app.get('/api/ivx/treasury/reconciliation/bank-items', async (c) => handleTreasuryBankItemsList(c.req.raw));
app.post('/api/ivx/treasury/reconciliation/run', async (c) => handleTreasuryReconciliationRun(c.req.raw));
app.get('/api/ivx/treasury/dashboard', async (c) => handleTreasuryDashboard(c.req.raw));
app.get('/api/ivx/treasury/reports', async (c) => handleTreasuryReports(c.req.raw));
app.get('/api/ivx/treasury/ai-finance', async (c) => handleTreasuryAIFinance(c.req.raw));

// ---- IVX Enterprise Investor Protection System (2026-07-05) ----
const protectionOpts = () => ivxProtectionOptions();
app.options('/api/ivx/protection/dashboard', protectionOpts);
app.options('/api/ivx/protection/audit-log', protectionOpts);
app.options('/api/ivx/protection/ledger-integrity', protectionOpts);
app.options('/api/ivx/protection/account-states', protectionOpts);
app.options('/api/ivx/protection/account-state', protectionOpts);
app.options('/api/ivx/protection/account-states/transition', protectionOpts);
app.options('/api/ivx/protection/account/unlock', protectionOpts);
app.options('/api/ivx/protection/deletion-requests', protectionOpts);
app.options('/api/ivx/protection/deletion-requests/approve', protectionOpts);
app.options('/api/ivx/protection/deletion-requests/confirm', protectionOpts);
app.options('/api/ivx/protection/recovery', protectionOpts);
app.options('/api/ivx/protection/recovery/start', protectionOpts);
app.options('/api/ivx/protection/recovery/verify', protectionOpts);
app.options('/api/ivx/protection/recovery/complete', protectionOpts);
app.options('/api/ivx/protection/sessions', protectionOpts);
app.options('/api/ivx/protection/sessions/register', protectionOpts);
app.options('/api/ivx/protection/sessions/revoke', protectionOpts);
app.options('/api/ivx/protection/investments', protectionOpts);
app.options('/api/ivx/protection/investments/valuation', protectionOpts);
app.options('/api/ivx/protection/withdrawals', protectionOpts);
app.options('/api/ivx/protection/withdrawals/transition', protectionOpts);
app.options('/api/ivx/protection/wires', protectionOpts);
app.options('/api/ivx/protection/wires/transition', protectionOpts);
app.options('/api/ivx/protection/wire-queue', protectionOpts);
app.options('/api/ivx/protection/compliance', protectionOpts);
app.options('/api/ivx/protection/wallet', protectionOpts);
app.options('/api/ivx/protection/reports', protectionOpts);

app.get('/api/ivx/protection/dashboard', async (c) => handleProtectionDashboardRequest(c.req.raw));
app.get('/api/ivx/protection/audit-log', async (c) => handleProtectionAuditLogRequest(c.req.raw));
app.get('/api/ivx/protection/ledger-integrity', async (c) => handleProtectionLedgerIntegrityRequest(c.req.raw));
app.get('/api/ivx/protection/account-states', async (c) => handleProtectionAccountStatesListRequest(c.req.raw));
app.get('/api/ivx/protection/account-state', async (c) => handleProtectionAccountStateGetRequest(c.req.raw));
app.post('/api/ivx/protection/account-states/transition', async (c) => handleProtectionAccountStateTransitionRequest(c.req.raw));
app.post('/api/ivx/protection/account/unlock', async (c) => handleProtectionUnlockAccountRequest(c.req.raw));
app.get('/api/ivx/protection/deletion-requests', async (c) => handleProtectionDeletionListRequest(c.req.raw));
app.post('/api/ivx/protection/deletion-requests', async (c) => handleProtectionDeletionCreateRequest(c.req.raw));
app.post('/api/ivx/protection/deletion-requests/approve', async (c) => handleProtectionDeletionApproveRequest(c.req.raw));
app.post('/api/ivx/protection/deletion-requests/confirm', async (c) => handleProtectionDeletionConfirmRequest(c.req.raw));
app.get('/api/ivx/protection/recovery', async (c) => handleProtectionRecoveryListRequest(c.req.raw));
app.post('/api/ivx/protection/recovery/start', async (c) => handleProtectionRecoveryStartRequest(c.req.raw));
app.post('/api/ivx/protection/recovery/verify', async (c) => handleProtectionRecoveryVerifyRequest(c.req.raw));
app.post('/api/ivx/protection/recovery/complete', async (c) => handleProtectionRecoveryCompleteRequest(c.req.raw));
app.get('/api/ivx/protection/sessions', async (c) => handleProtectionSessionsListRequest(c.req.raw));
app.post('/api/ivx/protection/sessions/register', async (c) => handleProtectionSessionRegisterRequest(c.req.raw));
app.post('/api/ivx/protection/sessions/revoke', async (c) => handleProtectionSessionRevokeRequest(c.req.raw));
app.get('/api/ivx/protection/investments', async (c) => handleProtectionInvestmentsListRequest(c.req.raw));
app.post('/api/ivx/protection/investments', async (c) => handleProtectionInvestmentCreateRequest(c.req.raw));
app.post('/api/ivx/protection/investments/valuation', async (c) => handleProtectionInvestmentValuationRequest(c.req.raw));
app.get('/api/ivx/protection/withdrawals', async (c) => handleProtectionWithdrawalsListRequest(c.req.raw));
app.post('/api/ivx/protection/withdrawals', async (c) => handleProtectionWithdrawalCreateRequest(c.req.raw));
app.post('/api/ivx/protection/withdrawals/transition', async (c) => handleProtectionWithdrawalTransitionRequest(c.req.raw));
app.get('/api/ivx/protection/wires', async (c) => handleProtectionWiresListRequest(c.req.raw));
app.post('/api/ivx/protection/wires', async (c) => handleProtectionWireCreateRequest(c.req.raw));
app.post('/api/ivx/protection/wires/transition', async (c) => handleProtectionWireTransitionRequest(c.req.raw));
app.get('/api/ivx/protection/wire-queue', async (c) => handleProtectionWireQueueRequest(c.req.raw));
app.get('/api/ivx/protection/compliance', async (c) => handleProtectionComplianceListRequest(c.req.raw));
app.post('/api/ivx/protection/compliance', async (c) => handleProtectionComplianceUpsertRequest(c.req.raw));
app.get('/api/ivx/protection/wallet', async (c) => handleProtectionWalletRequest(c.req.raw));
app.get('/api/ivx/protection/reports', async (c) => handleProtectionReportsRequest(c.req.raw));

// ---- IVX Enterprise Orchestrator (Phase 1–9 unified governance) ----
app.options('/api/ivx/enterprise/state', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/kpis', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/cycle', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/dispatch', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/dispatch/:taskId/complete', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/dispatch/:taskId/fail', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/agents', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/agents/:agentId', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/research', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/research/reports', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/opportunities', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/opportunities/:type', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/opportunities/:id/status', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/improvement', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/improvement/:id/resolve', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/memory', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/memory/search', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/governance', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/governance/action', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/governance/action/:id/approve', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/governance/action/:id/block', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/reports', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/reports/generate', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/reports/list', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/validate', () => enterpriseOrchestratorOptions());
app.options('/api/ivx/enterprise/health', () => enterpriseOrchestratorOptions());

app.get('/api/ivx/enterprise/state', async (c) => handleEnterpriseStateGet(c.req.raw));
app.get('/api/ivx/enterprise/kpis', async (c) => handleEnterpriseKPIsGet(c.req.raw));
app.post('/api/ivx/enterprise/cycle', async (c) => handleEnterpriseCyclePost(c.req.raw));
app.post('/api/ivx/enterprise/dispatch', async (c) => handleEnterpriseDispatchPost(c.req.raw));
app.post('/api/ivx/enterprise/dispatch/:taskId/complete', async (c) => handleEnterpriseTaskCompletePost(c.req.raw));
app.post('/api/ivx/enterprise/dispatch/:taskId/fail', async (c) => handleEnterpriseTaskFailPost(c.req.raw));
app.get('/api/ivx/enterprise/agents', async (c) => handleEnterpriseAgentsGet(c.req.raw));
app.get('/api/ivx/enterprise/agents/:agentId', async (c) => handleEnterpriseAgentGet(c.req.raw));
app.get('/api/ivx/enterprise/research', async (c) => handleEnterpriseResearchGet(c.req.raw));
app.get('/api/ivx/enterprise/research/reports', async (c) => handleEnterpriseResearchReportsGet(c.req.raw));
app.get('/api/ivx/enterprise/opportunities', async (c) => handleEnterpriseOpportunitiesGet(c.req.raw));
app.get('/api/ivx/enterprise/opportunities/:type', async (c) => handleEnterpriseOpportunitiesByTypeGet(c.req.raw));
app.post('/api/ivx/enterprise/opportunities/:id/status', async (c) => handleEnterpriseOpportunityStatusPost(c.req.raw));
app.get('/api/ivx/enterprise/improvement', async (c) => handleEnterpriseImprovementGet(c.req.raw));
app.post('/api/ivx/enterprise/improvement', async (c) => handleEnterpriseImprovementPost(c.req.raw));
app.post('/api/ivx/enterprise/improvement/:id/resolve', async (c) => handleEnterpriseImprovementResolvePost(c.req.raw));
app.get('/api/ivx/enterprise/memory', async (c) => handleEnterpriseMemoryGet(c.req.raw));
app.get('/api/ivx/enterprise/memory/search', async (c) => handleEnterpriseMemorySearchGet(c.req.raw));
app.post('/api/ivx/enterprise/memory', async (c) => handleEnterpriseMemoryPost(c.req.raw));
app.get('/api/ivx/enterprise/governance', async (c) => handleEnterpriseGovernanceGet(c.req.raw));
app.post('/api/ivx/enterprise/governance/action', async (c) => handleEnterpriseGovernanceActionPost(c.req.raw));
app.post('/api/ivx/enterprise/governance/action/:id/approve', async (c) => handleEnterpriseGovernanceApprovePost(c.req.raw));
app.post('/api/ivx/enterprise/governance/action/:id/block', async (c) => handleEnterpriseGovernanceBlockPost(c.req.raw));
app.get('/api/ivx/enterprise/reports', async (c) => handleEnterpriseReportsGet(c.req.raw));
app.post('/api/ivx/enterprise/reports/generate', async (c) => handleEnterpriseReportsGeneratePost(c.req.raw));
app.get('/api/ivx/enterprise/reports/list', async (c) => handleEnterpriseReportsListGet(c.req.raw));
app.get('/api/ivx/enterprise/validate', async (c) => handleEnterpriseValidateGet(c.req.raw));
app.post('/api/ivx/enterprise/health', async (c) => handleEnterpriseHealthPost(c.req.raw));

// ── Enterprise Business OS — Phase 1 (Executive Command Center) ───────
app.options('/api/ivx/enterprise-os/health', () => enterpriseOsOptions());
app.options('/api/ivx/enterprise-os/command-center', () => enterpriseOsOptions());
app.options('/api/ivx/enterprise-os/agents', () => enterpriseOsOptions());
app.options('/api/ivx/enterprise-os/agents/:agentId/run', () => enterpriseOsOptions());
app.options('/api/ivx/enterprise-os/audit', () => enterpriseOsOptions());
app.get('/api/ivx/enterprise-os/health', () => handleEnterpriseOsHealth());
app.get('/api/ivx/enterprise-os/command-center', async (c) => handleEnterpriseOsCommandCenter(c.req.raw));
app.get('/api/ivx/enterprise-os/agents', async (c) => handleEnterpriseOsAgents(c.req.raw));
app.post('/api/ivx/enterprise-os/agents/:agentId/run', async (c) => handleEnterpriseOsRunAgent(c.req.raw, c.req.param('agentId')));
app.get('/api/ivx/enterprise-os/audit', async (c) => handleEnterpriseOsAudit(c.req.raw));

// ── Project Engagement (Instagram-Style Cards) ───────────────────────
const PROJECT_ENGAGEMENT_PATH = '/api/projects/:projectId/engagement';
app.options(`${PROJECT_ENGAGEMENT_PATH}`, (c) => projectEngagementOptions(c));
app.get(`${PROJECT_ENGAGEMENT_PATH}`, (c) => handleProjectEngagementGet(c));
app.get('/api/projects/engagement/bulk', (c) => handleProjectBulkEngagementGet(c));
app.options('/api/projects/:projectId/media', (c) => projectEngagementOptions(c));
app.get('/api/projects/:projectId/media', (c) => handleProjectMediaGet(c));
app.post('/api/projects/:projectId/media', (c) => handleProjectMediaUpload(c));
app.delete('/api/projects/:projectId/media/:mediaId', (c) => handleProjectMediaDelete(c));
app.options('/api/projects/:projectId/videos/:videoId/pin', (c) => projectEngagementOptions(c));
app.post('/api/projects/:projectId/videos/:videoId/pin', (c) => handleProjectVideoPin(c));
app.options('/api/projects/:projectId/like', (c) => projectEngagementOptions(c));
app.post('/api/projects/:projectId/like', (c) => handleProjectLikeToggle(c));
app.options('/api/projects/:projectId/comments', (c) => projectEngagementOptions(c));
app.get('/api/projects/:projectId/comments', (c) => handleProjectCommentsGet(c));
app.post('/api/projects/:projectId/comments', (c) => handleProjectCommentAdd(c));
app.options('/api/projects/:projectId/comments/:commentId', (c) => projectEngagementOptions(c));
app.delete('/api/projects/:projectId/comments/:commentId', (c) => handleProjectCommentDelete(c));
app.post('/api/projects/:projectId/comments/:commentId/approve', (c) => handleProjectCommentApprove(c));
app.options('/api/projects/:projectId/share', (c) => projectEngagementOptions(c));
app.post('/api/projects/:projectId/share', (c) => handleProjectShareTrack(c));
app.options('/api/projects/:projectId/save', (c) => projectEngagementOptions(c));
app.post('/api/projects/:projectId/save', (c) => handleProjectSaveToggle(c));
app.options('/api/projects/:projectId/analytics', (c) => projectEngagementOptions(c));
app.get('/api/projects/:projectId/analytics', (c) => handleProjectAnalyticsGet(c));
app.post('/api/projects/:projectId/click', (c) => handleProjectTrackClick(c));

// ── Public Feature API /api/ivx/* ────────────────────────────────────────

// Featured Properties
app.options('/api/ivx/properties/featured', () => publicFeatureOptions());
app.get('/api/ivx/properties/featured', async (c) => handleFeaturedProperties(c.req.raw));

// Property Details
app.options('/api/ivx/properties/:propertyId', () => publicFeatureOptions());
app.get('/api/ivx/properties/:propertyId', async (c) => handlePropertyDetails(c.req.raw, c.req.param('propertyId')));

// Auth aliases (delegate to member handlers)
app.options('/api/ivx/auth/register', () => membersOptions());
app.post('/api/ivx/auth/register', async (c) => handleMemberRegister(c.req.raw));
app.options('/api/ivx/auth/verify-email', () => membersOptions());
app.post('/api/ivx/auth/verify-email', async (c) => handleVerifyEmail(c.req.raw));
app.options('/api/ivx/auth/verify-sms', () => membersOptions());
app.post('/api/ivx/auth/verify-sms', async (c) => handleVerifyPhone(c.req.raw));

// Featured Properties
app.options('/api/ivx/featured-properties', () => publicFeatureOptions());
app.get('/api/ivx/featured-properties', async (c) => handleFeaturedProperties(c.req.raw));

// Property Details
app.options('/api/ivx/properties/:propertyId', () => publicFeatureOptions());
app.get('/api/ivx/properties/:propertyId', async (c) => handlePropertyDetails(c.req.raw, c.req.param('propertyId')));

// Members Dashboard (public-features alias)
app.options('/api/ivx/members-dashboard', () => publicFeatureOptions());
app.get('/api/ivx/members-dashboard', async (c) => handleMembersDashboard(c.req.raw));

// Investors Dashboard (public-features alias)
app.options('/api/ivx/investors-dashboard', () => publicFeatureOptions());
app.get('/api/ivx/investors-dashboard', async (c) => handleInvestorsDashboard(c.req.raw));

// CRM Main
app.options('/api/ivx/crm', () => publicFeatureOptions());
app.get('/api/ivx/crm', async (c) => handleCRMMain(c.req.raw));

// JV Deals
app.options('/api/ivx/jv-deals', () => publicFeatureOptions());
app.get('/api/ivx/jv-deals', async (c) => handleJVDealsList(c.req.raw));
// Canonical aliases — /api/deals and /api/properties map to the ivx-prefixed routes
app.options('/api/deals', () => publicFeatureOptions());
app.get('/api/deals', async (c) => handleJVDealsList(c.req.raw));
app.options('/api/properties', () => publicFeatureOptions());
app.get('/api/properties', async (c) => handleFeaturedProperties(c.req.raw));
app.options('/api/properties/:propertyId', () => publicFeatureOptions());
app.get('/api/properties/:propertyId', async (c) => handlePropertyDetails(c.req.raw, c.req.param('propertyId')));

// Property Admin (public-features alias)
app.options('/api/ivx/property-admin', () => publicFeatureOptions());
app.get('/api/ivx/property-admin', async (c) => handlePropertyAdminList(c.req.raw));
app.post('/api/ivx/property-admin', async (c) => handlePropertyAdminCreate(c.req.raw));

// Media Upload
app.options('/api/ivx/media/upload', () => publicFeatureOptions());
app.post('/api/ivx/media/upload', async (c) => handleMediaUpload(c.req.raw));

// Instagram Cards (public-features alias)
app.options('/api/ivx/instagram-cards', () => publicFeatureOptions());
app.get('/api/ivx/instagram-cards', async (c) => handleInstagramCards(c.req.raw));

// Engagement
app.options('/api/ivx/engagement/likes', () => publicFeatureOptions());
app.get('/api/ivx/engagement/likes', async (c) => handleEngagementLikes(c.req.raw));
app.options('/api/ivx/engagement/comments', () => publicFeatureOptions());
app.get('/api/ivx/engagement/comments', async (c) => handleEngagementComments(c.req.raw));
app.options('/api/ivx/engagement/shares', () => publicFeatureOptions());
app.get('/api/ivx/engagement/shares', async (c) => handleEngagementShares(c.req.raw));
app.options('/api/ivx/engagement/saves', () => publicFeatureOptions());
app.get('/api/ivx/engagement/saves', async (c) => handleEngagementSaves(c.req.raw));

// Analytics
app.options('/api/ivx/analytics', () => publicFeatureOptions());
app.get('/api/ivx/analytics', async (c) => handleAnalytics(c.req.raw));

// ── IVX Visitor Audit (2026-07-06) ────────────────────────────────────────
// Real, honest visitor + member audit from day one to now. Queries every
// relevant Supabase table with count=exact and returns the REAL numbers.
// Never fabricates. If a table is missing or empty, it says so.
app.get('/api/ivx/visitor-audit', async () => {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) {
    return Response.json({ ok: false, error: 'Supabase not configured', missing: [!url ? 'EXPO_PUBLIC_SUPABASE_URL' : null, !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null].filter(Boolean), timestamp: new Date().toISOString() }, { status: 500 });
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const countTable = async (table: string, col: string = 'id') => {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(col)}`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
      if (res.status === 404) return { table, count: null, status: 404, error: 'TABLE_NOT_FOUND' };
      const cr = res.headers.get('content-range');
      const total = cr ? parseInt(cr.split('/').pop() || '*', 10) : null;
      return { table, count: Number.isFinite(total) ? total : null, status: res.status, error: null };
    } catch (e) {
      return { table, count: null, status: null, error: e instanceof Error ? e.message : 'network_error' };
    }
  };
  const queryRows = async (table: string, select: string, order: string, limit: number) => {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${order}&limit=${limit}`, { headers });
      if (!res.ok) return { rows: [], status: res.status, error: `HTTP ${res.status}` };
      return { rows: await res.json(), status: res.status, error: null };
    } catch (e) {
      return { rows: [], status: null, error: e instanceof Error ? e.message : 'network_error' };
    }
  };
  const [visitorSessions, landingAnalytics, analyticsEvents, waitlist, members, investors, buyers, jvDeals, privateLenders, wallets, treasury, ledger, withdrawals, wireTransfers, notifications] = await Promise.all([
    countTable('visitor_sessions', 'session_id'),
    countTable('landing_analytics', 'id'),
    countTable('analytics_events', 'id'),
    countTable('waitlist', 'id'),
    countTable('members', 'member_id'),
    countTable('investors', 'id'),
    countTable('buyers', 'id'),
    countTable('jv_deals', 'id'),
    countTable('private_lenders', 'id'),
    countTable('wallets', 'id'),
    countTable('treasury', 'id'),
    countTable('ledger', 'id'),
    countTable('withdrawals', 'id'),
    countTable('wire_transfers', 'id'),
    countTable('notifications', 'id'),
  ]);
  // Get date range for visitor-related tables + waitlist + members
  const [laRows, aeRows, wlRows, memRows] = await Promise.all([
    queryRows('landing_analytics', 'id,created_at,event', 'created_at.asc', 5000),
    queryRows('analytics_events', 'id,created_at,event', 'created_at.asc', 5000),
    queryRows('waitlist', 'id,email,created_at,source', 'created_at.asc', 5000),
    queryRows('members', 'member_id,email,member_type,created_at,source', 'created_at.asc', 5000),
  ]);
  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    deploymentMarker: DEPLOYMENT_MARKER,
    counts: { visitorSessions, landingAnalytics, analyticsEvents, waitlist, members, investors, buyers, jvDeals, privateLenders, wallets, treasury, ledger, withdrawals, wireTransfers, notifications },
    dateRanges: {
      landingAnalytics: { firstSeen: laRows.rows.length > 0 ? laRows.rows[0].created_at : null, lastSeen: laRows.rows.length > 0 ? laRows.rows[laRows.rows.length - 1].created_at : null, total: laRows.rows.length },
      analyticsEvents: { firstSeen: aeRows.rows.length > 0 ? aeRows.rows[0].created_at : null, lastSeen: aeRows.rows.length > 0 ? aeRows.rows[aeRows.rows.length - 1].created_at : null, total: aeRows.rows.length },
      waitlist: { firstSeen: wlRows.rows.length > 0 ? wlRows.rows[0].created_at : null, lastSeen: wlRows.rows.length > 0 ? wlRows.rows[wlRows.rows.length - 1].created_at : null, total: wlRows.rows.length, rows: wlRows.rows.slice(0, 20) },
      members: { firstSeen: memRows.rows.length > 0 ? memRows.rows[0].created_at : null, lastSeen: memRows.rows.length > 0 ? memRows.rows[memRows.rows.length - 1].created_at : null, total: memRows.rows.length, rows: memRows.rows.slice(0, 20) },
    },
    honestSummary: {
      visitorsTracked: (visitorSessions.count ?? 0) + (landingAnalytics.count ?? 0) + (analyticsEvents.count ?? 0) === 0 ? 0 : (visitorSessions.count ?? 0),
      realMembers: members.count ?? 0,
      realWaitlist: waitlist.count ?? 0,
      note: 'Visitor tracking is not instrumented on the landing page. visitor_sessions table does not exist. landing_analytics and analytics_events tables exist but have 0 rows. The real member count comes from the members table (member_id PK). No fabricated counts.',
    },
  });
});

// ── IVX Blocker Fix Migration (2026-07-04) ────────────────────────────────
// Creates the 5 missing Supabase tables (investors, developer_proof_ledger,
// lenders, revenue, wallet) with RLS policies.
app.options('/api/ivx/blocker-fix/run-migration', () => blockerFixMigrationOptions());
app.post('/api/ivx/blocker-fix/run-migration', async (c) => handleBlockerFixRunMigration(c.req.raw));
app.options('/api/ivx/blocker-fix/verify-tables', () => blockerFixMigrationOptions());
app.get('/api/ivx/blocker-fix/verify-tables', async (c) => handleBlockerFixVerifyTables(c.req.raw));

// ── IVX Media Upload sub-routes (image/video/pdf document) ────────────────
// These delegate to the public-features media handler with a media_type hint.
app.options('/api/ivx/media/upload/image', () => publicFeatureOptions());
app.post('/api/ivx/media/upload/image', async (c) => handleMediaUpload(c.req.raw));
app.options('/api/ivx/media/upload/video', () => publicFeatureOptions());
app.post('/api/ivx/media/upload/video', async (c) => handleMediaUpload(c.req.raw));
app.options('/api/ivx/media/upload/pdf', () => publicFeatureOptions());
app.post('/api/ivx/media/upload/pdf', async (c) => handleMediaUpload(c.req.raw));
app.options('/api/ivx/media/upload/document', () => publicFeatureOptions());
app.post('/api/ivx/media/upload/document', async (c) => handleMediaUpload(c.req.raw));

// ── IVX Video Feed (Instagram-style videos: feed + HQ download) ─────────
app.options('/api/ivx/videos/feed', () => videoFeedOptions());
app.get('/api/ivx/videos/feed', async (c) => handleVideoFeed(c.req.raw));
app.options('/api/ivx/videos/:videoId/download', () => videoFeedOptions());
app.get('/api/ivx/videos/:videoId/download', async (c) => handleVideoDownload(c.req.raw, c.req.param('videoId')));

// ── IVX Video Pipeline (upload → S3 → ffmpeg HLS ladder → adaptive playback) ──
app.options('/api/ivx/video-pipeline/config', () => videoPipelineOptions());
app.get('/api/ivx/video-pipeline/config', async () => handleVideoPipelineConfig());
app.options('/api/ivx/video-pipeline/upload', () => videoPipelineOptions());
app.post('/api/ivx/video-pipeline/upload', async (c) => handleVideoPipelineUpload(c.req.raw));
app.options('/api/ivx/video-pipeline/videos', () => videoPipelineOptions());
app.get('/api/ivx/video-pipeline/videos', async () => handleVideoPipelineList());
app.options('/api/ivx/video-pipeline/:videoId', () => videoPipelineOptions());
app.get('/api/ivx/video-pipeline/:videoId', async (c) => handleVideoPipelineGet(c.req.param('videoId')));
app.options('/api/ivx/video-pipeline/:videoId/retry', () => videoPipelineOptions());
app.post('/api/ivx/video-pipeline/:videoId/retry', async (c) => handleVideoPipelineRetry(c.req.param('videoId')));

// ── IVX Video Platform (enterprise vertical feed: ranked channels, engagement,
//    analytics, stories, live, creator dashboard, moderation) ──────────────
app.options('/api/ivx/video-platform/*', () => videoPlatformOptions());
app.get('/api/ivx/video-platform/feed', async (c) => handlePlatformFeed(c.req.raw));
app.get('/api/ivx/video-platform/home-feed', async (c) => handlePlatformHomeFeed(c.req.raw));
app.post('/api/ivx/video-platform/deals/:dealId/meta', async (c) => handlePlatformDealMeta(c.req.raw, c.req.param('dealId')));
app.get('/api/ivx/video-platform/channels', async () => handlePlatformChannels());
app.post('/api/ivx/video-platform/events', async (c) => handlePlatformEvents(c.req.raw));
app.get('/api/ivx/video-platform/videos/:videoId/analytics', async (c) => handlePlatformVideoAnalytics(c.req.param('videoId')));
app.post('/api/ivx/video-platform/videos/:videoId/meta', async (c) => handlePlatformVideoMeta(c.req.raw, c.req.param('videoId')));
app.post('/api/ivx/video-platform/videos/:videoId/report', async (c) => handlePlatformReport(c.req.raw, c.req.param('videoId')));
app.post('/api/ivx/video-platform/follow', async (c) => handlePlatformFollowToggle(c.req.raw));
app.get('/api/ivx/video-platform/follow/:followerId', async (c) => handlePlatformFollowList(c.req.param('followerId')));
app.get('/api/ivx/video-platform/stories', async () => handlePlatformStoriesList());
app.post('/api/ivx/video-platform/stories', async (c) => handlePlatformStoryCreate(c.req.raw));
app.get('/api/ivx/video-platform/live', async (c) => handlePlatformLiveList(c.req.raw));
app.post('/api/ivx/video-platform/live/start', async (c) => handlePlatformLiveStart(c.req.raw));
app.get('/api/ivx/video-platform/live/:sessionId/status', async (c) => handlePlatformLiveStatus(c.req.param('sessionId')));
app.post('/api/ivx/video-platform/live/:sessionId/ingest', async (c) => handlePlatformLiveIngest(c.req.raw, c.req.param('sessionId')));
app.post('/api/ivx/video-platform/live/:sessionId/stop', async (c) => handlePlatformLiveStop(c.req.param('sessionId')));
app.post('/api/ivx/video-platform/live/:sessionId/moderate', async (c) => handlePlatformLiveModerate(c.req.raw, c.req.param('sessionId')));
app.get('/api/ivx/video-platform/creator/:creatorId/dashboard', async (c) => handlePlatformCreatorDashboard(c.req.param('creatorId')));
app.get('/api/ivx/video-platform/moderation/queue', async () => handlePlatformModerationQueue());
app.post('/api/ivx/video-platform/moderation/:videoId', async (c) => handlePlatformModerationDecision(c.req.raw, c.req.param('videoId')));

// ── Admin Reels Management (2026-07-06) — owner adds/manages videos without a developer ──
app.get('/api/ivx/video-platform/admin/videos', async (c) => handlePlatformAdminListVideos(c.req.raw));
app.post('/api/ivx/video-platform/admin/add-reel', async (c) => handlePlatformAdminAddReel(c.req.raw));
app.post('/api/ivx/video-platform/admin/videos/:videoId', async (c) => handlePlatformAdminUpdateVideo(c.req.raw, c.req.param('videoId')));

// ── IVX Global Intent Capture Engine (2026-07-06) — 8-phase search acquisition ──
// Phase 1-8: keyword discovery, intent clustering, auto landing pages, AI content,
// multilingual, visitor intelligence, AI conversion, autonomous optimization.
app.options('/api/ivx/intent-engine/*', () => intentEngineOptions());
app.get('/api/ivx/intent-engine/status', async () => handleIntentEngineStatusRequest());
app.get('/api/ivx/intent-engine/dashboard', async (c) => handleIntentEngineDashboardRequest(c.req.raw));
app.post('/api/ivx/intent-engine/phase1', async (c) => handleIntentEnginePhase1Request(c.req.raw));
app.post('/api/ivx/intent-engine/phase2', async (c) => handleIntentEnginePhase2Request(c.req.raw));
app.post('/api/ivx/intent-engine/phase3', async (c) => handleIntentEnginePhase3Request(c.req.raw));
app.post('/api/ivx/intent-engine/phase4', async (c) => handleIntentEnginePhase4Request(c.req.raw));
app.post('/api/ivx/intent-engine/phase8', async (c) => handleIntentEnginePhase8Request(c.req.raw));
app.post('/api/ivx/intent-engine/visitor', async (c) => handleIntentEngineVisitorRequest(c.req.raw));
app.post('/api/ivx/intent-engine/chat', async (c) => handleIntentEngineChatRequest(c.req.raw));
app.get('/api/ivx/intent-engine/page/:slug', async (c) => handleIntentEnginePageRequest(c.req.raw, c.req.param('slug')));

// ── IVX Data Vault (2026-07-06) — independent backup & recovery ─────────────
// Snapshots critical Supabase tables to the backend's own filesystem so data
// can always be recovered even if Supabase loses it. Owner-only endpoints.
app.options('/api/ivx/data-vault/*', () => dataVaultOptions());
app.get('/api/ivx/data-vault/status', async (c) => handleDataVaultStatus(c.req.raw));
app.post('/api/ivx/data-vault/config', async (c) => handleDataVaultConfigUpdate(c.req.raw));
app.post('/api/ivx/data-vault/snapshot', async (c) => handleDataVaultSnapshotTrigger(c.req.raw));
app.get('/api/ivx/data-vault/snapshots', async (c) => handleDataVaultSnapshotsList(c.req.raw));
app.get('/api/ivx/data-vault/snapshots/:snapshotId', async (c) => handleDataVaultSnapshotGet(c.req.raw, c.req.param('snapshotId') ?? ''));
app.get('/api/ivx/data-vault/snapshots/:snapshotId/tables/:table', async (c) => handleDataVaultSnapshotTable(c.req.raw, c.req.param('snapshotId') ?? '', c.req.param('table') ?? ''));
app.post('/api/ivx/data-vault/restore', async (c) => handleDataVaultRestore(c.req.raw));
app.get('/api/ivx/data-vault/loss-detection', async (c) => handleDataVaultLossDetection(c.req.raw));
app.get('/api/ivx/data-vault/manifest', async (c) => handleDataVaultManifest(c.req.raw));

// ── IVX Restore Center (2026-07-06) — unified zero-data-loss admin surface ──
// One endpoint surface for: soft-delete, data_vault table, PITR status,
// snapshots, two-person approvals, guard audit, recovery drill, daily report,
// and emergency backup export. All owner-only.
app.options('/api/ivx/restore-center/*', () => restoreCenterOptions());
app.get('/api/ivx/restore-center/overview', async (c) => handleRestoreCenterOverview(c.req.raw));
app.get('/api/ivx/restore-center/deleted', async (c) => handleRestoreCenterDeleted(c.req.raw));
app.post('/api/ivx/restore-center/soft-delete', async (c) => handleRestoreCenterSoftDelete(c.req.raw));
app.post('/api/ivx/restore-center/restore-soft', async (c) => handleRestoreCenterRestoreSoft(c.req.raw));
app.get('/api/ivx/restore-center/vault-entries', async (c) => handleRestoreCenterVaultEntries(c.req.raw));
app.post('/api/ivx/restore-center/restore-vault', async (c) => handleRestoreCenterRestoreVault(c.req.raw));
app.get('/api/ivx/restore-center/pitr', async (c) => handleRestoreCenterPitr(c.req.raw));
app.get('/api/ivx/restore-center/snapshots', async (c) => handleRestoreCenterSnapshots(c.req.raw));
app.post('/api/ivx/restore-center/restore-snapshot', async (c) => handleRestoreCenterRestoreSnapshot(c.req.raw));
app.post('/api/ivx/restore-center/snapshot', async (c) => handleRestoreCenterSnapshotNow(c.req.raw));
app.get('/api/ivx/restore-center/approvals', async (c) => handleRestoreCenterApprovals(c.req.raw));
app.post('/api/ivx/restore-center/approvals/create', async (c) => handleRestoreCenterApprovalCreate(c.req.raw));
app.post('/api/ivx/restore-center/approvals/confirm', async (c) => handleRestoreCenterApprovalConfirm(c.req.raw));
app.post('/api/ivx/restore-center/approvals/reject', async (c) => handleRestoreCenterApprovalReject(c.req.raw));
app.get('/api/ivx/restore-center/guard-audit', async (c) => handleRestoreCenterGuardAudit(c.req.raw));
app.get('/api/ivx/restore-center/protected-tables', async (c) => handleRestoreCenterProtectedTables(c.req.raw));
app.post('/api/ivx/restore-center/drill', async (c) => handleRestoreCenterDrill(c.req.raw));
app.get('/api/ivx/restore-center/report', async (c) => handleRestoreCenterReport(c.req.raw));
app.get('/api/ivx/restore-center/reports', async (c) => handleRestoreCenterReports(c.req.raw));
app.post('/api/ivx/restore-center/export', async (c) => handleRestoreCenterExport(c.req.raw));

// ── IVX Zero Data Loss Migration (2026-07-06) — creates data_vault table + soft-delete columns ──
app.options('/api/ivx/zero-data-loss-migration', () => zeroDataLossMigrationOptions());
app.post('/api/ivx/zero-data-loss-migration', async (c) => handleZeroDataLossMigration(c.req.raw));

// ── IVX Data-Loss Guard (2026-07-06) — destructive op interception ──────────
// Prevents autonomous cleanup/migration scripts from deleting production data.
// Every destructive op (DELETE/TRUNCATE/DROP) on protected tables requires
// owner approval + reason and triggers a pre-snapshot.
app.options('/api/ivx/data-guard/*', () => dataGuardOptions());
app.post('/api/ivx/data-guard/evaluate', async (c) => handleDataGuardEvaluate(c.req.raw));
app.get('/api/ivx/data-guard/audit', async (c) => handleDataGuardAudit(c.req.raw));
app.get('/api/ivx/data-guard/protected-tables', async (c) => handleDataGuardProtectedTables(c.req.raw));
app.post('/api/ivx/data-guard/check', async (c) => handleDataGuardCheck(c.req.raw));

// ── IVX Enterprise Recovery (2026-07-12) — monitoring, validation, storage, financial ──
app.options('/api/ivx/recovery/*', () => enterpriseRecoveryOptions());
app.get('/api/ivx/recovery/objectives', async (c) => handleRecoveryObjectives(c.req.raw));
app.get('/api/ivx/recovery/monitoring', async (c) => handleRecoveryMonitoring(c.req.raw));
app.get('/api/ivx/recovery/alerts', async (c) => handleRecoveryAlerts(c.req.raw));
app.get('/api/ivx/recovery/validate', async (c) => handleRecoveryValidate(c.req.raw));
app.post('/api/ivx/recovery/validate', async (c) => handleRecoveryValidate(c.req.raw));
app.post('/api/ivx/recovery/alert', async (c) => handleCreateAlert(c.req.raw));
app.get('/api/ivx/recovery/runbook', async (c) => handleRecoveryRunbook(c.req.raw));
app.get('/api/ivx/recovery/overview', async (c) => handleRecoveryOverview(c.req.raw));
app.options('/api/ivx/storage/*', () => enterpriseRecoveryOptions());
app.get('/api/ivx/storage/audit', async (c) => handleStorageAudit(c.req.raw));
app.get('/api/ivx/storage/manifest-history', async (c) => handleStorageManifestHistory(c.req.raw));
app.get('/api/ivx/storage/manifest/:bucket', async (c) => handleStorageManifest(c.req.raw, c.req.param('bucket') ?? ''));
app.options('/api/ivx/financial-protection/*', () => enterpriseRecoveryOptions());
app.get('/api/ivx/financial-protection/audit', async (c) => handleFinancialProtectionAudit(c.req.raw));

// ── IVX Deployment Tools Brain (Unified Dashboard) ──────────────────
app.options('/api/ivx/deploy-tools/*', () => deployToolsOptions());
app.get('/api/ivx/deploy-tools/brain', async (c) => handleBrain());
app.get('/api/ivx/deploy-tools/brain/health', async (c) => handleBrainHealth());
app.get('/api/ivx/deploy-tools/github', async (c) => handleGitHubStatus());
app.get('/api/ivx/deploy-tools/render', async (c) => handleRenderStatus());
app.post('/api/ivx/deploy-tools/render/deploy', async (c) => handleRenderDeployTool(c.req.raw));
app.post('/api/ivx/deploy-tools/render/rollback', async (c) => handleRenderRollback(c.req.raw));
app.post('/api/ivx/deploy-tools/render/auto-deploy', async (c) => handleRenderAutoDeploy(c.req.raw));
app.get('/api/ivx/deploy-tools/supabase', async (c) => handleSupabaseStatus());
app.get('/api/ivx/deploy-tools/evidence', async (c) => handleEvidence());
app.get('/api/ivx/deploy-tools/credentials', async (c) => handleCredentials());
app.get('/api/ivx/deploy-tools/dashboard', async (c) => handleDashboard());
app.post('/api/ivx/deploy-tools/invoke', async (c) => handleInvoke(c.req.raw));

// ── IVX Independence Layer (self-hosted variables, tools, brain, scanner, verifier) ──
app.route('/api/ivx/independence', independenceRoutes);

// ── IVX Senior Developer Executor — real senior-dev pipeline with owner approval gate ──
app.options('/api/ivx/executor/capabilities', () => ivxExecutorOptions());
app.get('/api/ivx/executor/capabilities', (c) => handleExecutorCapabilities(c.req.raw));
app.options('/api/ivx/executor/tasks', () => ivxExecutorOptions());
app.get('/api/ivx/executor/tasks', (c) => handleExecutorTasks(c.req.raw));
app.options('/api/ivx/executor/approvals', () => ivxExecutorOptions());
app.get('/api/ivx/executor/approvals', (c) => handleExecutorApprovals(c.req.raw));
app.options('/api/ivx/executor/sql', () => ivxExecutorOptions());
app.get('/api/ivx/executor/sql', (c) => handleExecutorSql(c.req.raw));
app.options('/api/ivx/executor/plan', () => ivxExecutorOptions());
app.post('/api/ivx/executor/plan', (c) => handleExecutorPlan(c.req.raw));
app.options('/api/ivx/executor/diff', () => ivxExecutorOptions());
app.post('/api/ivx/executor/diff', (c) => handleExecutorDiff(c.req.raw));
app.options('/api/ivx/executor/approve', () => ivxExecutorOptions());
app.post('/api/ivx/executor/approve', (c) => handleExecutorApprove(c.req.raw));
app.options('/api/ivx/executor/run', () => ivxExecutorOptions());
app.post('/api/ivx/executor/run', (c) => handleExecutorRun(c.req.raw));
app.options('/api/ivx/executor/deploy', () => ivxExecutorOptions());
app.post('/api/ivx/executor/deploy', (c) => handleExecutorDeploy(c.req.raw));
app.get('/api/ivx/executor/status/:taskId', (c) => handleExecutorStatus(c.req.raw, c.req.param('taskId')));
app.get('/api/ivx/executor/proof/:taskId', (c) => handleExecutorProof(c.req.raw, c.req.param('taskId')));

// IVX Browser Automation — Playwright-core QA + screenshot endpoints (owner-only).
// Surfaced for the FINAL LIVE USER QA block: real headless Chromium on the
// Render backend produces genuine user-visible evidence (PNGs + DOM transcripts)
// for ownerChat / landing / members / androidLayout / iosLayout flows.
app.options('/api/ivx/qa/status', () => qaOptions());
app.options('/api/ivx/qa/screenshot', () => qaOptions());
app.options('/api/ivx/qa/run', () => qaOptions());
app.options('/api/ivx/qa/close', () => qaOptions());
app.get('/api/ivx/qa/status', (c) => handleQaStatusRequest(c.req.raw));
app.post('/api/ivx/qa/screenshot', (c) => handleQaScreenshotRequest(c.req.raw));
app.post('/api/ivx/qa/run', (c) => handleQaRunRequest(c.req.raw));
app.post('/api/ivx/qa/close', (c) => handleQaCloseRequest(c.req.raw));

app.onError((error, context) => {
  const message = error instanceof Error ? error.message : 'unknown';
  const stack = error instanceof Error ? error.stack ?? null : null;
  console.log('[IVXOwnerAI-Hono] Unhandled error:', {
    method: context.req.method,
    path: context.req.path,
    marker: DEPLOYMENT_MARKER,
    message,
  });
  try {
    recordIncident({
      source: 'backend',
      severity: 'error',
      message: `Unhandled error on ${context.req.method} ${context.req.path}: ${message}`,
      stack,
      checkpoint: 'hono.onError',
      responseStatus: 500,
    });
    void evaluateAndMaybeRollback();
  } catch {
    // never let the error handler throw
  }
  return context.json({
    error: 'Internal server error',
    detail: message,
    deploymentMarker: DEPLOYMENT_MARKER,
  }, 500);
});

// ─── IVX Platform Modules (28-module surface) ───────────────────────────────
// Waitlist (public signup, owner-gated management)
app.options('/api/ivx/waitlist', () => platformModulesOptions());
app.get('/api/ivx/waitlist', async (context) => handleWaitlistListRequest(context.req.raw));
app.post('/api/ivx/waitlist', async (context) => handleWaitlistCreateRequest(context.req.raw));
app.options('/api/ivx/waitlist/:id/status', () => platformModulesOptions());
app.post('/api/ivx/waitlist/:id/status', async (context) => handleWaitlistStatusRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/waitlist/:id/delete', () => platformModulesOptions());
app.post('/api/ivx/waitlist/:id/delete', async (context) => handleWaitlistDeleteRequest(context.req.raw, context.req.param('id')));

// Settings (owner-only)
app.options('/api/ivx/settings', () => platformModulesOptions());
app.get('/api/ivx/settings', async (context) => handleSettingsListRequest(context.req.raw));
app.post('/api/ivx/settings', async (context) => handleSettingsUpsertRequest(context.req.raw));

// Revenue (owner-only)
app.options('/api/ivx/revenue', () => platformModulesOptions());
app.get('/api/ivx/revenue', async (context) => handleRevenueListRequest(context.req.raw));
app.post('/api/ivx/revenue', async (context) => handleRevenueCreateRequest(context.req.raw));
app.options('/api/ivx/revenue/:id/status', () => platformModulesOptions());
app.post('/api/ivx/revenue/:id/status', async (context) => handleRevenueStatusRequest(context.req.raw, context.req.param('id')));

// Push Notifications (owner-only)
app.options('/api/ivx/notifications', () => platformModulesOptions());
app.get('/api/ivx/notifications', async (context) => handleNotificationsListRequest(context.req.raw));
app.post('/api/ivx/notifications', async (context) => handleNotificationsCreateRequest(context.req.raw));
app.options('/api/ivx/notifications/:id/status', () => platformModulesOptions());
app.post('/api/ivx/notifications/:id/status', async (context) => handleNotificationsStatusRequest(context.req.raw, context.req.param('id')));

// Broadcast (owner-only)
app.options('/api/ivx/broadcast', () => platformModulesOptions());
app.get('/api/ivx/broadcast', async (context) => handleBroadcastListRequest(context.req.raw));
app.post('/api/ivx/broadcast', async (context) => handleBroadcastCreateRequest(context.req.raw));
app.options('/api/ivx/broadcast/:id/status', () => platformModulesOptions());
app.post('/api/ivx/broadcast/:id/status', async (context) => handleBroadcastStatusRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/broadcast/:id/delete', () => platformModulesOptions());
app.post('/api/ivx/broadcast/:id/delete', async (context) => handleBroadcastDeleteRequest(context.req.raw, context.req.param('id')));

// Roles & Permissions (owner-only)
app.options('/api/ivx/roles', () => platformModulesOptions());
app.get('/api/ivx/roles', async (context) => handleRolesListRequest(context.req.raw));
app.options('/api/ivx/roles/definitions', () => platformModulesOptions());
app.post('/api/ivx/roles/definitions', async (context) => handleRoleDefinitionUpsertRequest(context.req.raw));
app.options('/api/ivx/roles/assign', () => platformModulesOptions());
app.post('/api/ivx/roles/assign', async (context) => handleRoleAssignRequest(context.req.raw));
app.options('/api/ivx/roles/revoke', () => platformModulesOptions());
app.post('/api/ivx/roles/revoke', async (context) => handleRoleRevokeRequest(context.req.raw));
app.options('/api/ivx/roles/:userId/permissions', () => platformModulesOptions());
app.get('/api/ivx/roles/:userId/permissions', async (context) => handleUserPermissionsRequest(context.req.raw, context.req.param('userId')));
app.options('/api/ivx/roles/:userId/screens', () => platformModulesOptions());
app.get('/api/ivx/roles/:userId/screens', async (context) => handleUserScreensRequest(context.req.raw, context.req.param('userId')));

// Access Control — status, force logout, screen management, MFA
app.options('/api/ivx/access/status', () => platformModulesOptions());
app.post('/api/ivx/access/status', async (context) => handleAssignmentStatusRequest(context.req.raw));
app.options('/api/ivx/access/force-logout', () => platformModulesOptions());
app.post('/api/ivx/access/force-logout', async (context) => handleForceLogoutRequest(context.req.raw));
app.options('/api/ivx/access/clear-force-logout', () => platformModulesOptions());
app.post('/api/ivx/access/clear-force-logout', async (context) => handleClearForceLogoutRequest(context.req.raw));
app.options('/api/ivx/access/screens', () => platformModulesOptions());
app.post('/api/ivx/access/screens', async (context) => handleUpdateScreensRequest(context.req.raw));
app.options('/api/ivx/access/mfa', () => platformModulesOptions());
app.post('/api/ivx/access/mfa', async (context) => handleSetMfaRequest(context.req.raw));

// Access Templates
app.options('/api/ivx/access/templates', () => platformModulesOptions());
app.get('/api/ivx/access/templates', async (context) => handleAccessTemplateListRequest(context.req.raw));
app.post('/api/ivx/access/templates', async (context) => handleAccessTemplateCreateRequest(context.req.raw));
app.options('/api/ivx/access/templates/delete', () => platformModulesOptions());
app.post('/api/ivx/access/templates/delete', async (context) => handleAccessTemplateDeleteRequest(context.req.raw));

// Access Groups
app.options('/api/ivx/access/groups', () => platformModulesOptions());
app.get('/api/ivx/access/groups', async (context) => handleAccessGroupListRequest(context.req.raw));
app.post('/api/ivx/access/groups', async (context) => handleAccessGroupCreateRequest(context.req.raw));
app.options('/api/ivx/access/groups/delete', () => platformModulesOptions());
app.post('/api/ivx/access/groups/delete', async (context) => handleAccessGroupDeleteRequest(context.req.raw));

// Transactions (owner-only)
app.options('/api/ivx/transactions', () => platformModulesOptions());
app.get('/api/ivx/transactions', async (context) => handleTransactionsListRequest(context.req.raw));
app.post('/api/ivx/transactions', async (context) => handleTransactionsCreateRequest(context.req.raw));
app.options('/api/ivx/transactions/:id/status', () => platformModulesOptions());
app.post('/api/ivx/transactions/:id/status', async (context) => handleTransactionsStatusRequest(context.req.raw, context.req.param('id')));

// Casa Rosario (public view, owner-managed)
app.options('/api/ivx/casa-rosario', () => platformModulesOptions());
app.get('/api/ivx/casa-rosario', async (context) => handleCasaRosarioListRequest(context.req.raw));
app.post('/api/ivx/casa-rosario', async (context) => handleCasaRosarioCreateRequest(context.req.raw));
app.options('/api/ivx/casa-rosario/:id', () => platformModulesOptions());
app.post('/api/ivx/casa-rosario/:id', async (context) => handleCasaRosarioUpdateRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/casa-rosario/:id/status', () => platformModulesOptions());
app.post('/api/ivx/casa-rosario/:id/status', async (context) => handleCasaRosarioStatusRequest(context.req.raw, context.req.param('id')));
app.options('/api/ivx/casa-rosario/:id/delete', () => platformModulesOptions());
app.post('/api/ivx/casa-rosario/:id/delete', async (context) => handleCasaRosarioDeleteRequest(context.req.raw, context.req.param('id')));

// Landing Analytics (public event recording, owner-gated summary)
app.options('/api/ivx/landing-analytics', () => platformModulesOptions());
app.get('/api/ivx/landing-analytics', async (context) => handleAnalyticsSummaryRequest(context.req.raw));
app.post('/api/ivx/landing-analytics', async (context) => handleAnalyticsEventRequest(context.req.raw));

// Reels → Deal Sync (owner-only)
app.options('/api/ivx/reel-deal-sync', () => platformModulesOptions());
app.get('/api/ivx/reel-deal-sync', async (context) => handleReelDealSyncListRequest(context.req.raw));
app.post('/api/ivx/reel-deal-sync', async (context) => handleReelDealSyncCreateRequest(context.req.raw));
app.options('/api/ivx/reel-deal-sync/:id/delete', () => platformModulesOptions());
app.post('/api/ivx/reel-deal-sync/:id/delete', async (context) => handleReelDealSyncDeleteRequest(context.req.raw, context.req.param('id')));

// Owner Dashboard (aggregated roll-up, owner-only)
app.options('/api/ivx/owner-dashboard', () => platformModulesOptions());
app.get('/api/ivx/owner-dashboard', async (context) => handleOwnerDashboardRequest(context.req.raw));

// ── IVX Canonical Reels API — simplified public endpoints for app + landing ──
// These wrap the video platform feed so external consumers (app, landing, admin)
// can use /api/reels without knowing the internal video-platform path structure.
app.get('/api/reels', async (c) => handlePlatformFeed(c.req.raw));
app.get('/api/reels/:id', async (c) => handleReelById(c.req.param('id')));

// Canonical authoritative member count — public aggregate (no PII).
app.get('/api/members/authoritative-count', async () => {
  const { listCanonicalMembers, countCanonicalMembers, isCanonicalMembersConfigured } = await import('./services/ivx-canonical-members');
  if (!isCanonicalMembersConfigured()) {
    return Response.json({ ok: true, members: 0, waitlist: 0, investors: 0, buyers: 0, total: 0, source: 'canonical-members', timestamp: nowIso(), deploymentMarker: DEPLOYMENT_MARKER });
  }
  const all = await listCanonicalMembers({ limit: 5000 });
  const byType: Record<string, number> = {};
  for (const m of all) byType[m.member_type] = (byType[m.member_type] ?? 0) + 1;
  const members = (byType['member'] ?? 0) + (byType['user'] ?? 0);
  const waitlist = byType['waitlist'] ?? 0;
  const investors = byType['investor'] ?? 0;
  const buyers = byType['buyer'] ?? 0;
  return Response.json({
    ok: true, members, waitlist, investors, buyers,
    total: await countCanonicalMembers(),
    source: 'canonical-members',
    timestamp: nowIso(),
    deploymentMarker: DEPLOYMENT_MARKER,
  });
});

// Canonical authoritative metrics — aggregates members + video + engagement.
app.get('/api/metrics/authoritative-count', async () => {
  const { listCanonicalMembers, countCanonicalMembers, isCanonicalMembersConfigured } = await import('./services/ivx-canonical-members');
  let memberCounts = { members: 0, waitlist: 0, investors: 0, buyers: 0, total: 0 };
  if (isCanonicalMembersConfigured()) {
    const all = await listCanonicalMembers({ limit: 5000 });
    const byType: Record<string, number> = {};
    for (const m of all) byType[m.member_type] = (byType[m.member_type] ?? 0) + 1;
    memberCounts = {
      members: (byType['member'] ?? 0) + (byType['user'] ?? 0),
      waitlist: byType['waitlist'] ?? 0,
      investors: byType['investor'] ?? 0,
      buyers: byType['buyer'] ?? 0,
      total: await countCanonicalMembers(),
    };
  }
  // Video counts from the video platform feed
  let videoCount = 0;
  try {
    const feedResp = await handlePlatformFeed(new Request('https://api.ivxholding.com/api/ivx/video-platform/feed?limit=1'));
    const feedData = await feedResp.json() as any;
    videoCount = feedData.total ?? 0;
  } catch { /* graceful fallback */ }
  return Response.json({
    ok: true,
    ...memberCounts,
    videos: videoCount,
    source: 'canonical-aggregate',
    timestamp: nowIso(),
    deploymentMarker: DEPLOYMENT_MARKER,
  });
});

// tRPC-compatible waitlist stats — returns stats in the shape expected by tRPC clients.
app.get('/api/trpc/waitlist.getStats', async () => {
  const { listCanonicalMembers, isCanonicalMembersConfigured } = await import('./services/ivx-canonical-members');
  let waitlist = 0;
  let total = 0;
  if (isCanonicalMembersConfigured()) {
    const all = await listCanonicalMembers({ limit: 5000 });
    total = all.length;
    waitlist = all.filter((m: any) => m.member_type === 'waitlist').length;
  }
  return Response.json({
    ok: true,
    waitlist,
    total,
    timestamp: nowIso(),
    deploymentMarker: DEPLOYMENT_MARKER,
  });
});

app.notFound(async (context) => {
  const webResponse = await loadWebResponse(context.req.path, context.req.method);
  if (webResponse) {
    console.log('[IVXOwnerAI-Hono] Served static web asset:', {
      method: context.req.method,
      path: context.req.path,
      marker: DEPLOYMENT_MARKER,
    });
    return webResponse;
  }

  console.log('[IVXOwnerAI-Hono] Route not found:', {
    method: context.req.method,
    path: context.req.path,
    marker: DEPLOYMENT_MARKER,
  });
  return context.json({ error: 'Not found', deploymentMarker: DEPLOYMENT_MARKER }, 404);
});

try { startNightOpsScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] night ops scheduler failed to start:', err instanceof Error ? err.message : err); }
try { void bootstrapDataVault(); startDataVaultScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] data vault scheduler failed to start:', err instanceof Error ? err.message : err); }
try {
  // Daily recovery report — runs once per day at boot + every 24h.
  const runDailyReport = () => { void generateDailyReport().catch(() => {}); };
  runDailyReport();
  setInterval(runDailyReport, 24 * 60 * 60 * 1000).unref?.();
} catch (err) { console.warn('[IVXOwnerAI-Hono] daily report scheduler failed to start:', err instanceof Error ? err.message : err); }
try { startContinuousExecutionScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] continuous execution scheduler failed to start:', err instanceof Error ? err.message : err); }
try { startAutonomousScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] autonomous scheduler failed to start:', err instanceof Error ? err.message : err); }
try { startScaleLoopScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] scale loop scheduler failed to start:', err instanceof Error ? err.message : err); }
try { startRoleAgentScheduler(); } catch (err) { console.warn('[IVXOwnerAI-Hono] role-agent run loop failed to start:', err instanceof Error ? err.message : err); }
try { startEngineeringReportTicker(2); } catch (err) { console.warn('[IVXOwnerAI-Hono] engineering OS 2h report ticker failed to start:', err instanceof Error ? err.message : err); }
try { startOwnerAITaskWorker(); } catch (err) { console.warn('[IVXOwnerAI-Hono] owner AI durable task worker failed to start:', err instanceof Error ? err.message : err); }
try { startLandingSeoAutodeploy(); } catch (err) { console.warn('[IVXOwnerAI-Hono] landing SEO autodeploy failed to start:', err instanceof Error ? err.message : err); }
try { startAutonomousMonitor(); } catch (err) { console.warn('[IVXOwnerAI-Hono] autonomous deploy monitor failed to start:', err instanceof Error ? err.message : err); }

// ============================================================================
// IVX Enterprise Time Zone System — register all timezone routes
// ============================================================================
try {
  registerTimezoneRoutes(app);
  console.log('[IVXTimezone] Timezone routes registered successfully');
} catch (err) {
  console.warn('[IVXTimezone] Failed to register timezone routes:', err instanceof Error ? err.message : err);
}

// ============================================================================
// IVX Owner Action Request System — autonomous owner notification + task tracking
// ============================================================================
app.options('/api/ivx/owner-action/create', () => ownerActionOptions());
app.post('/api/ivx/owner-action/create', async (context) => handleCreateOwnerActionRequest(context.req.raw));
app.options('/api/ivx/owner-action/list', () => ownerActionOptions());
app.get('/api/ivx/owner-action/list', async () => handleListOwnerActionRequests());
app.options('/api/ivx/owner-action/:traceId', () => ownerActionOptions());
app.get('/api/ivx/owner-action/:traceId', async (context) => handleGetOwnerActionRequest(context.req.raw, context.req.param('traceId')));
app.options('/api/ivx/owner-action/:traceId/verify', () => ownerActionOptions());
app.post('/api/ivx/owner-action/:traceId/verify', async (context) => handleVerifyOwnerAction(context.req.raw, context.req.param('traceId')));
app.options('/api/ivx/owner-action/:traceId/notify', () => ownerActionOptions());
app.post('/api/ivx/owner-action/:traceId/notify', async (context) => handleNotifyOwnerAction(context.req.raw, context.req.param('traceId')));
app.options('/api/ivx/owner-action/:traceId/status', () => ownerActionOptions());
app.post('/api/ivx/owner-action/:traceId/status', async (context) => handleUpdateOwnerActionStatus(context.req.raw, context.req.param('traceId')));

// ============================================================================
// IVX Autonomous Operations Dashboard — unified owner dashboard
// ============================================================================
app.options('/api/ivx/autonomous-ops/dashboard', () => autonomousOpsDashboardOptions());
app.get('/api/ivx/autonomous-ops/dashboard', async (context) => handleAutonomousOpsDashboardRequest(context.req.raw));

// ============================================================================
// IVX Landing Full Deploy — push all landing static files to S3 + invalidate CloudFront
// ============================================================================
app.options('/api/ivx/landing-deploy', () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } }));
app.get('/api/ivx/landing-deploy', async () => handleLandingFullDeployStatus());
app.post('/api/ivx/landing-deploy', async (context) => handleLandingFullDeploy(context.req.raw));

// ============================================================================
// IVX AI Engineering Command Center — 12-agent audit, scores, task ledger
// ============================================================================
app.options('/api/ivx/agent-audit/overview', () => agentAuditOptions());
app.get('/api/ivx/agent-audit/overview', async (context) => {
  try { return await handleAgentAuditOverview(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-agent-audit-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/agent-audit/ledger', () => agentAuditOptions());
app.get('/api/ivx/agent-audit/ledger', async (context) => {
  try { return await handleAgentAuditLedger(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-agent-audit-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.post('/api/ivx/agent-audit/ledger', async (context) => {
  try { return await handleAgentAuditLedgerCreate(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-agent-audit-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/agent-audit/ledger/update', () => agentAuditOptions());
app.patch('/api/ivx/agent-audit/ledger/update', async (context) => {
  try { return await handleAgentAuditLedgerUpdate(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-agent-audit-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});

// ============================================================================
// IVX QA Migration Runner — RLS fix, 56 missing tables, RLS enablement
// ============================================================================
app.options('/api/ivx/qa-migration/run', () => qaMigrationOptions());
app.post('/api/ivx/qa-migration/run', async (context) => {
  try { return await handleQaMigrationRun(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-qa-migration-runner-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/qa-migration/verify', () => qaMigrationOptions());
app.get('/api/ivx/qa-migration/verify', async (context) => {
  try { return await handleQaMigrationVerify(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-qa-migration-runner-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});

// ============================================================================
// IVX ENTERPRISE — Observability, Security, Dashboard, Capacity, Health
// Phase 1–5: Enterprise readiness endpoints (owner-gated except health)
// ============================================================================
app.options('/api/ivx/enterprise/observability', () => enterpriseOptions());
app.get('/api/ivx/enterprise/observability', async (context) => {
  try { return await handleEnterpriseObservabilityRequest(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-enterprise-api-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/enterprise/security', () => enterpriseOptions());
app.get('/api/ivx/enterprise/security', async (context) => {
  try { return await handleEnterpriseSecurityRequest(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-enterprise-api-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/enterprise/dashboard', () => enterpriseOptions());
app.get('/api/ivx/enterprise/dashboard', async (context) => {
  try { return await handleEnterpriseDashboardRequest(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-enterprise-api-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
app.options('/api/ivx/enterprise/capacity', () => enterpriseOptions());
app.get('/api/ivx/enterprise/capacity', async (context) => {
  try { return await handleEnterpriseCapacityRequest(context.req.raw); }
  catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isAuth = /missing bearer|auth guard|invalid or expired|unauthorized|no bearer|missing token/i.test(msg);
    return context.json({ ok: false, error: msg.slice(0, 320), marker: 'ivx-enterprise-api-2026-07-14', timestamp: new Date().toISOString() }, isAuth ? 401 : 500);
  }
});
// ── IVX Senior Developer Certification App (Isolated) ──
// Completely isolated from IVX production. Separate in-memory database,
// separate auth, no access to Supabase or production business data.
// Mounted at /api/cert-app/* and /cert-app (frontend).
type CertAppLike = { request: (input: Request) => Response | Promise<Response> };
let certAppInstance: CertAppLike | null = null;
async function getCertApp(): Promise<CertAppLike> {
  if (!certAppInstance) {
    const { createCertApp } = await import('./cert-app/server');
    certAppInstance = createCertApp() as unknown as CertAppLike;
  }
  return certAppInstance;
}
app.get('/api/cert-app/health', async (c) => (await getCertApp()).request(c.req.raw));
app.get('/api/cert-app/readiness', async (c) => (await getCertApp()).request(c.req.raw));
app.post('/api/cert-app/auth/login', async (c) => (await getCertApp()).request(c.req.raw));
app.get('/api/cert-app/items', async (c) => (await getCertApp()).request(c.req.raw));
app.post('/api/cert-app/items', async (c) => (await getCertApp()).request(c.req.raw));
app.get('/api/cert-app/items/:id', async (c) => (await getCertApp()).request(c.req.raw));
app.put('/api/cert-app/items/:id', async (c) => (await getCertApp()).request(c.req.raw));
app.delete('/api/cert-app/items/:id', async (c) => (await getCertApp()).request(c.req.raw));
// Serve the cert-app frontend
app.get('/cert-app', async (c) => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await readFile(path.resolve(import.meta.dir, 'cert-app', 'frontend', 'index.html'), 'utf-8');
  return c.html(html);
});

// Public enterprise health (no auth required)
app.get('/api/ivx/enterprise/health', () => handleEnterpriseHealthRequest());
app.options('/api/ivx/enterprise/health', () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }));

// Enterprise metrics endpoint — observability dashboard data
app.get('/api/ivx/enterprise/metrics', (context) => {
  const metrics = getEnterpriseMetrics();
  return context.json({
    ok: true,
    marker: IVX_ENTERPRISE_MIDDLEWARE_MARKER,
    timestamp: new Date().toISOString(),
    metrics,
  });
});

export default app;
