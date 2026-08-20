import { describe, expect, test } from 'bun:test';
import {
  buildIVXOwnerAIPlannerDecision,
  resolveLiveGroundingIntent,
  resolveOwnerLocationClarificationIntent,
  shouldUseCurrentTimeTool,
} from '../../backend/services/ivx-owner-ai-intent-router';
import {
  buildIVXAgentRuntimeV2Envelope,
  buildIVXAgentRuntimeV2StatusSnapshot,
} from '../../backend/services/ivx-agent-runtime-v2';
import { executeIVXAgentRuntimeV2Loop } from '../../backend/services/ivx-agent-runtime-v2-execution-loop';
import { routeTaskToAgent } from '../../backend/services/agents/multi-agent-framework';
import {
  IVX_SAFE_PATCH_CONFIRM_TEXT,
  auditIVXGithubRuntimeAccess,
  buildIVXSeniorDeveloperStatusSnapshot,
  runIVXSeniorDeveloperTask,
} from '../../backend/services/ivx-senior-developer-runtime';
import { evaluateIVXRegisteredOwnerBearerContext } from '../../backend/api/owner-only';
import { IVX_OPEN_ACCESS_OWNER_TOKEN, type IVXAuthenticatedRequestContext } from '../../expo/shared/ivx';

describe('IVX Owner AI natural-routing guards', () => {
  test('routes exact time question to the time tool only', () => {
    expect(shouldUseCurrentTimeTool('What time is it?')).toBe(true);
    expect(resolveOwnerLocationClarificationIntent('What time is it?')).toBeNull();
    expect(resolveLiveGroundingIntent('What time is it?')).toBe('time');
  });

  test('does not answer ambiguous where-now question with time', () => {
    expect(shouldUseCurrentTimeTool('Where are we now?')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('Where are we now?')).toBe('ambiguous_where_are_we');
    expect(buildIVXOwnerAIPlannerDecision('Where are we now?')).toMatchObject({
      semanticIntent: 'ambiguous_location',
      route: 'clarification',
      useTools: false,
    });
  });

  test('reports missing physical location context clearly', () => {
    expect(shouldUseCurrentTimeTool('In what location we are right now')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('In what location we are right now')).toBe('physical_location_unavailable');
    expect(buildIVXOwnerAIPlannerDecision('In what location we are right now')).toMatchObject({
      semanticIntent: 'physical_location_unavailable',
      route: 'clarification',
      useTools: false,
    });
  });

  test('keeps bug-review prompt on conversational GPT path', () => {
    expect(shouldUseCurrentTimeTool('What bugs do you see?')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('What bugs do you see?')).toBeNull();
    expect(resolveLiveGroundingIntent('What bugs do you see?')).toBeNull();
    expect(buildIVXOwnerAIPlannerDecision('What bugs do you see?')).toMatchObject({
      semanticIntent: 'bug_review',
      route: 'gpt_conversation',
      useTools: false,
      requiresTaskDecomposition: true,
    });
  });

  test('keeps deal review prompt on conversational GPT path', () => {
    expect(shouldUseCurrentTimeTool('Review this deal')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('Review this deal')).toBeNull();
    expect(resolveLiveGroundingIntent('Review this deal')).toBeNull();
    expect(buildIVXOwnerAIPlannerDecision('Review this deal')).toMatchObject({
      semanticIntent: 'deal_review',
      route: 'gpt_conversation',
      useTools: false,
    });
  });

  test('grounds current IVX app status without misrouting to time', () => {
    expect(shouldUseCurrentTimeTool('Explain current IVX app status')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('Explain current IVX app status')).toBeNull();
    expect(resolveLiveGroundingIntent('Explain current IVX app status')).toBe('project_state');
    expect(buildIVXOwnerAIPlannerDecision('Explain current IVX app status')).toMatchObject({
      semanticIntent: 'project_status',
      route: 'tool_grounded_gpt',
      useTools: true,
      toolHints: ['live_project_state'],
    });
  });

  test('keeps complaint about not answering on normal GPT conversation path', () => {
    expect(shouldUseCurrentTimeTool('Why you not answering my questions?')).toBe(false);
    expect(resolveOwnerLocationClarificationIntent('Why you not answering my questions?')).toBeNull();
    expect(buildIVXOwnerAIPlannerDecision('Why you not answering my questions?')).toMatchObject({
      semanticIntent: 'normal_question',
      route: 'gpt_conversation',
      useTools: false,
    });
  });

  test('routes "Complete this task 100%" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Complete this task 100%');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
      toolHints: ['run_ivx_senior_developer_task'],
      requiresTaskDecomposition: true,
      fallbackPolicy: 'fail_visible_not_canned',
    });
  });

  test('routes "Fix this code now" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Fix this code now');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('routes "Build this feature today" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Build this feature today');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('routes "Run tests and deploy" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Run tests and deploy');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('routes "Audit and patch this bug" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Audit and patch this bug');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('routes "Implement this screen now" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Implement this screen now');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('routes "Ship this to production" to self-developer execution mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Ship this to production');
    expect(decision).toMatchObject({
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
    });
  });

  test('supports long structured senior developer list without status/tool routing', () => {
    expect(buildIVXOwnerAIPlannerDecision('Provide full list what you can do as senior developer from 1 to 200')).toMatchObject({
      semanticIntent: 'long_structured_response',
      route: 'gpt_conversation',
      useTools: false,
      requiresLongResponse: true,
      fallbackPolicy: 'fail_visible_not_canned',
    });
  });

  test('uses tools only when owner explicitly asks for live inspection', () => {
    expect(buildIVXOwnerAIPlannerDecision('Inspect Supabase tables and list all schemas')).toMatchObject({
      semanticIntent: 'explicit_tool_request',
      route: 'tool_grounded_gpt',
      useTools: true,
    });
  });

  test('builds Agent Runtime v2 envelope with persistent memory and no fallback masking', () => {
    const envelope = buildIVXAgentRuntimeV2Envelope({
      requestId: 'test-runtime-v2',
      conversationId: 'owner-room-1',
      prompt: 'Why you not answering my questions?',
      recentMessages: [
        { sender_role: 'owner', body: 'Remember I want senior developer answers.' },
        { sender_role: 'assistant', body: 'Understood. I will answer naturally and expose real state.' },
      ],
    });

    expect(envelope.version).toBe('agent_runtime_v2');
    expect(envelope.backendState.fallbackMasking).toBe(false);
    expect(envelope.memory.state).toBe('loaded');
    expect(envelope.memory.loadedTurnCount).toBe(2);
    expect(envelope.planner.route).toBe('gpt_conversation');
    expect(envelope.planner.useTools).toBe(false);
    expect(envelope.toolChain[0]).toMatchObject({ name: 'no_tool_required', status: 'skipped' });
    expect(envelope.taskTree.flat.length).toBeGreaterThanOrEqual(4);
  });

  test('Agent Runtime v2 preserves long structured answer contract with chunking', () => {
    const envelope = buildIVXAgentRuntimeV2Envelope({
      requestId: 'test-long-response',
      conversationId: 'owner-room-1',
      prompt: 'Provide full list what you can do as senior developer from 1 to 200',
    });

    expect(envelope.planner.semanticIntent).toBe('long_structured_response');
    expect(envelope.streaming.shouldChunk).toBe(true);
    expect(envelope.streaming.estimatedChunks).toBeGreaterThanOrEqual(5);
    expect(envelope.taskTree.flat.some((node) => node.title.includes('Chunk long structured response'))).toBe(true);
    expect(envelope.retryRecovery.visibleFailurePolicy).toBe('surface_backend_or_tool_error_never_canned_answer');
  });

  test('Agent Runtime v2 status snapshot exposes multi-agent architecture', () => {
    const snapshot = buildIVXAgentRuntimeV2StatusSnapshot();
    expect(snapshot.requestId).toBeNull();
    expect(snapshot.conversationId).toBeNull();
    expect(snapshot.backendState.trueStateExposed).toBe(true);
    expect(snapshot.multiAgent.coordinator).toBe('cto_orchestrator');
    expect(snapshot.multiAgent.availableAgents.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.taskTree.supported).toBe(true);
  });

  test('routes exact Runtime v2 safe audit task to bug-review tool-grounded planning', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Inspect current IVX AI chat behavior and produce a prioritized bug list.');
    expect(decision).toMatchObject({
      semanticIntent: 'bug_review',
      route: 'tool_grounded_gpt',
      useTools: true,
      requiresTaskDecomposition: true,
      requiresLongResponse: true,
      fallbackPolicy: 'fail_visible_not_canned',
    });
  });

  test('executes local Runtime v2 loop with task tree, retry proof, chunks, dashboard proof, and audit files', async () => {
    const proof = await executeIVXAgentRuntimeV2Loop({
      prompt: 'Inspect current IVX AI chat behavior and produce a prioritized bug list.',
      conversationId: 'test-runtime-v2-loop',
      forceRetryProbe: true,
      maxChunkCharacters: 900,
    });

    expect(proof.ok).toBe(true);
    expect(proof.safeMode.productionDataMutated).toBe(false);
    expect(proof.safeMode.deployed).toBe(false);
    expect(proof.planner.semanticIntent).toBe('bug_review');
    expect(proof.taskTree.flat.length).toBeGreaterThanOrEqual(6);
    expect(proof.memoryState.stored).toBe(true);
    expect(proof.retry.recovered).toBe(true);
    expect(proof.logs.some((log) => log.phase === 'worker_step_failed')).toBe(true);
    expect(proof.streaming.chunks.length).toBeGreaterThan(1);
    expect(proof.dashboard.runtimeV2TileFound).toBe(true);
    expect(proof.auditFiles.json).toMatch(/^logs\/audit\/runtime-v2-job-/);
    expect(proof.finalResult).toContain('prioritized IVX AI chat behavior bug list');
  });

  test('Block 33-37 senior developer runtime exposes minimum replacement capabilities only', () => {
    const snapshot = buildIVXSeniorDeveloperStatusSnapshot();
    expect(snapshot).toMatchObject({
      ok: true,
      dashboardsAdded: false,
      fallbackMasking: false,
      secretValuesReturned: false,
      requiredPatchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
    });
    expect(Array.isArray(snapshot.blocks)).toBe(true);
    expect(snapshot.routes).toBeUndefined();
  });

  test('senior developer owner mutation gate rejects shell/dev owner token', () => {
    const context = {
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'owner@example.com',
      role: 'owner',
      accessToken: IVX_OPEN_ACCESS_OWNER_TOKEN,
      guardMode: 'test_open_access',
      roleAudit: {
        profileRoleRaw: 'owner',
        profileRole: 'owner',
        appMetadataRole: null,
        userMetadataRole: null,
        rawRole: 'owner',
        normalizedRole: 'owner',
        profileFound: false,
        profileLookupError: null,
      },
      client: {} as IVXAuthenticatedRequestContext['client'],
    } satisfies IVXAuthenticatedRequestContext;

    const evaluation = evaluateIVXRegisteredOwnerBearerContext(
      context,
      'senior_developer_git_commit_render_deploy',
      'owner@example.com',
    );

    expect(evaluation.approved).toBe(false);
    expect(evaluation.status).toBe(401);
    expect(evaluation.proof.ownerSessionDetected).toBe(true);
    expect(evaluation.proof.bearerAccepted).toBe(false);
    expect(evaluation.proof.ownerVerified).toBe(false);
    expect(evaluation.proof.ownerEmailMatched).toBe(true);
    expect(evaluation.proof.secretValuesReturned).toBe(false);
    expect(evaluation.blocker).toContain('real Supabase owner bearer token');
  });

  test('senior developer owner mutation gate accepts real Supabase bearer with allowlisted owner email', () => {
    const context = {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'Owner@Example.com',
      role: 'admin',
      accessToken: 'header.payload.signature',
      guardMode: 'strict',
      roleAudit: {
        profileRoleRaw: 'admin',
        profileRole: 'admin',
        appMetadataRole: null,
        userMetadataRole: null,
        rawRole: 'admin',
        normalizedRole: 'admin',
        profileFound: true,
        profileLookupError: null,
      },
      client: {} as IVXAuthenticatedRequestContext['client'],
    } satisfies IVXAuthenticatedRequestContext;

    const evaluation = evaluateIVXRegisteredOwnerBearerContext(
      context,
      'senior_developer_git_commit_render_deploy',
      'owner@example.com, second@example.com',
    );

    expect(evaluation.approved).toBe(true);
    expect(evaluation.status).toBe(200);
    expect(evaluation.proof.ownerSessionDetected).toBe(true);
    expect(evaluation.proof.bearerAccepted).toBe(true);
    expect(evaluation.proof.ownerVerified).toBe(true);
    expect(evaluation.proof.ownerEmailMatched).toBe(true);
    expect(evaluation.proof.ownerEmailMasked).toBe('ow***r@example.com');
    expect(evaluation.proof.action).toBe('senior_developer_git_commit_render_deploy');
    expect(evaluation.proof.blocker).toBeNull();
    expect(evaluation.proof.secretValuesReturned).toBe(false);
  });

  test('GitHub runtime audit reports missing local token without returning secrets', async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    const previousRepoUrl = process.env.GITHUB_REPO_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO_URL;
    const proof = await auditIVXGithubRuntimeAccess();
    if (typeof previousToken === 'string') process.env.GITHUB_TOKEN = previousToken;
    if (typeof previousRepoUrl === 'string') process.env.GITHUB_REPO_URL = previousRepoUrl;

    expect(proof.tokenConfigured).toBe(false);
    expect(proof.repoConfigured).toBe(false);
    expect(proof.auth.error).toContain('GITHUB_TOKEN is not readable by this backend runtime');
    expect(proof.repository.error).toContain('GITHUB_REPO_URL is not readable by this backend runtime');
    expect(proof.secretValuesReturned).toBe(false);
  });

  test('senior developer coding goals route to backend developer after Block 34 patch', () => {
    expect(routeTaskToAgent('Act as senior developer: inspect repo, fix backend bug, run tests, and deploy')).toBe('backend_developer');
  });

  test('Block 37 senior developer runtime can inspect, plan, validate, and save audit proof without deploy mutation', async () => {
    // Skip this AI-dependent test when no valid AI provider is configured in the test runner.
    const aiKey = (process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || '').trim();
    if (!aiKey || aiKey.includes('XX') || aiKey.length < 20) {
      console.log('[SKIP] Block 37 senior runtime test: AI provider not configured in test runner.');
      return;
    }

    if (process.env.IVX_SENIOR_RUNTIME_VALIDATION_CHILD === '1') {
      expect(routeTaskToAgent('Act as senior developer: inspect repo, fix backend bug, run tests, and deploy')).toBe('backend_developer');
      return;
    }

    const previousFastVerify = process.env.IVX_SENIOR_RUNTIME_FAST_VERIFY;
    process.env.IVX_SENIOR_RUNTIME_FAST_VERIFY = '1';
    const ownerApprovedAction = {
      proposedPlan: 'Inspect repo, validate routing, save proof, no production mutation.',
      filesAffected: ['backend/services/agents/multi-agent-framework.ts'],
      riskLevel: 'medium' as const,
      rollbackOption: 'Revert the generated GitHub commit and redeploy the previous known-good Render deploy.',
      rollbackAvailable: true,
      auditLog: ['ownerSessionDetected=true', 'bearerAccepted=true', 'ownerVerified=true'],
      secretValuesReturned: false as const,
    };
    const proof = await runIVXSeniorDeveloperTask({
      goal: 'Act as IVX senior developer: inspect repo, confirm senior coding tasks route to Backend Developer Agent, validate, and report proof.',
      approvePatch: true,
      patchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
      validationMode: 'focused',
      ownerApprovedAction,
    });
    if (typeof previousFastVerify === 'string') {
      process.env.IVX_SENIOR_RUNTIME_FAST_VERIFY = previousFastVerify;
    } else {
      delete process.env.IVX_SENIOR_RUNTIME_FAST_VERIFY;
    }

    expect(proof.ok).toBe(true);
    expect(proof.repoBrain.canInspectFullRepo).toBe(true);
    expect(proof.repoBrain.indexedFileCount).toBeGreaterThan(20);
    expect(proof.planner.taskTree.map((task) => task.block)).toEqual([33, 34, 35, 36, 37]);
    expect(proof.patchProposal.block).toBe(34);
    expect(proof.validations.every((validation) => validation.ok)).toBe(true);
    expect(proof.gitDeployOperator.github.commitAttempted).toBe(false);
    expect(proof.gitDeployOperator.render.deployAttempted).toBe(false);
    expect(proof.endToEndProductionComplete).toBe(false);
    expect(proof.ownerApprovedAction).toMatchObject({
      proposedPlan: ownerApprovedAction.proposedPlan,
      filesAffected: ownerApprovedAction.filesAffected,
      riskLevel: 'medium',
      rollbackAvailable: true,
      secretValuesReturned: false,
    });
    expect(proof.logs.some((log) => log.phase === 'plan_created' && JSON.stringify(log.metadata).includes('ownerApprovedAction'))).toBe(true);
    expect(proof.auditFiles.json).toMatch(/^logs\/audit\/ivx-senior-dev-/);
    // This case indexes the repo and calls a live AI provider, so it cannot fit
    // in bun's 5s default. The timeout is raised, NOT the assertions: every
    // expectation above still has to hold.
  }, 120_000);
});
