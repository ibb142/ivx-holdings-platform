import { describe, expect, test } from 'bun:test';
import {
  asksForCodeRetrieval,
  asksToBuildApp,
  asksToFinishOrProveSeniorDeveloperWork,
  buildIVXOwnerAIPlannerDecision,
  demandsExecutionProofNotNarrative,
  isOwnerExecutionOrTaskBlock,
  isServerBugFixRequest,
  resolveExactEchoCommand,
  resolveOwnerLocationClarificationIntent,
} from './ivx-owner-ai-intent-router';

const BLOCK_28_COMMAND = `BLOCK 28 — Visitor-to-Investor Conversion Engine

Create:

IVX → Conversion Engine

Track:

Visitor location
Visitor activity
Deal interest
Capital capacity

Dashboard:

Visitors
Leads
Conversions`;

describe('isOwnerExecutionOrTaskBlock', () => {
  test('detects an explicit BLOCK N task block', () => {
    expect(isOwnerExecutionOrTaskBlock(BLOCK_28_COMMAND)).toBe(true);
    expect(isOwnerExecutionOrTaskBlock('BLOCK 22 — Capital Pipeline')).toBe(true);
    expect(isOwnerExecutionOrTaskBlock('Step 3: wire the route')).toBe(true);
  });

  test('detects a long multi-marker structured spec', () => {
    const spec = 'Create:\nIVX -> Outreach\nCapabilities:\nEmail campaigns\nStore:\nSent\nOpened';
    expect(isOwnerExecutionOrTaskBlock(spec)).toBe(true);
  });

  test('detects an imperative engine/system build command', () => {
    expect(isOwnerExecutionOrTaskBlock('Create the Visitor-to-Investor Conversion Engine that tracks visitor location and deal interest for IVX')).toBe(true);
  });

  test('does NOT fire on a short genuine location question', () => {
    expect(isOwnerExecutionOrTaskBlock('what is my current location?')).toBe(false);
    expect(isOwnerExecutionOrTaskBlock('where am i physically')).toBe(false);
    expect(isOwnerExecutionOrTaskBlock('what time is it')).toBe(false);
  });
});

describe('location clarification never hijacks a long owner command', () => {
  test('a short physical-location question still routes to clarification', () => {
    expect(resolveOwnerLocationClarificationIntent('what is my physical location?')).toBe('physical_location_unavailable');
    const decision = buildIVXOwnerAIPlannerDecision('what is my physical location?');
    expect(decision.route).toBe('clarification');
    expect(decision.semanticIntent).toBe('physical_location_unavailable');
  });

  test('BLOCK 28 command mentioning "location" is NOT treated as a location question', () => {
    expect(resolveOwnerLocationClarificationIntent(BLOCK_28_COMMAND)).toBeNull();
  });

  test('BLOCK 28 "Create the Engine" command executes end-to-end, never a location clarification or phased plan', () => {
    const decision = buildIVXOwnerAIPlannerDecision(BLOCK_28_COMMAND);
    expect(decision.route).not.toBe('clarification');
    // A build/execute task block targeting this system routes to the senior-developer
    // runtime so IVX executes (inspect → patch → test → commit → deploy → verify)
    // instead of narrating a phased "once approved we'll proceed" plan.
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.route).toBe('self_developer');
    expect(decision.requiresTaskDecomposition).toBe(true);
    expect(decision.fallbackPolicy).toBe('fail_visible_not_canned');
  });
});

describe('resolveExactEchoCommand — deterministic latest-message echo (acceptance test B)', () => {
  test('returns the exact payload for "Reply exactly" commands', () => {
    expect(resolveExactEchoCommand('Reply exactly OWNER proof-123')).toBe('OWNER proof-123');
    expect(resolveExactEchoCommand('Reply exactly: OWNER proof-123')).toBe('OWNER proof-123');
    expect(resolveExactEchoCommand('reply exactly with OWNER proof-123')).toBe('OWNER proof-123');
    expect(resolveExactEchoCommand('Respond exactly "OWNER proof-123"')).toBe('OWNER proof-123');
    expect(resolveExactEchoCommand('Please say exactly: hello world')).toBe('hello world');
  });

  test('preserves original casing/characters verbatim', () => {
    expect(resolveExactEchoCommand('reply exactly: OWNER proof-123')).toBe('OWNER proof-123');
  });

  test('returns null when there is no exact-echo directive', () => {
    expect(resolveExactEchoCommand('what is my physical location?')).toBeNull();
    expect(resolveExactEchoCommand('reply to the investor email')).toBeNull();
    expect(resolveExactEchoCommand(BLOCK_28_COMMAND)).toBeNull();
    expect(resolveExactEchoCommand('reply exactly')).toBeNull();
  });
});

describe('asksToBuildApp', () => {
  test('detects "build an app like X" product requests', () => {
    expect(asksToBuildApp('can you build an app like tiktok?')).toBe(true);
    expect(asksToBuildApp('i want to create a clone of uber')).toBe(true);
    expect(asksToBuildApp('build a marketplace app for me')).toBe(true);
    expect(asksToBuildApp('make a dating app similar to hinge')).toBe(true);
    expect(asksToBuildApp('design a saas product')).toBe(true);
  });

  test('does NOT hijack concrete in-repo execution requests', () => {
    expect(asksToBuildApp('build the project dashboard screen')).toBe(false);
    expect(asksToBuildApp('build this feature now')).toBe(false);
    expect(asksToBuildApp('fix the auth endpoint')).toBe(false);
  });

  test('does not fire on unrelated questions', () => {
    expect(asksToBuildApp('what time is it')).toBe(false);
    expect(asksToBuildApp('how is revenue trending')).toBe(false);
  });
});

describe('buildIVXOwnerAIPlannerDecision — app-build planning mode (anti-generic)', () => {
  test('"build an app like TikTok" routes to app_build_planning, not normal_question', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Can you build an app like TikTok?');
    expect(decision.semanticIntent).toBe('app_build_planning');
    expect(decision.requiresLongResponse).toBe(true);
    expect(decision.requiresTaskDecomposition).toBe(true);
    expect(decision.toolHints).toContain('app_planning_mode');
    expect(decision.fallbackPolicy).toBe('fail_visible_not_canned');
  });

  test('clone request enters planning mode', () => {
    const decision = buildIVXOwnerAIPlannerDecision('build me a clone of Instagram');
    expect(decision.semanticIntent).toBe('app_build_planning');
  });
});

describe('buildIVXOwnerAIPlannerDecision — own-system builds EXECUTE, never narrate', () => {
  test('"build the IVX Global Autonomous Investment Engine" executes, NOT app_build_planning', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Build the IVX Global Autonomous Investment Engine');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.route).toBe('self_developer');
    expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
  });

  test('own-system build phrasings all route to self developer, not narrative planning', () => {
    const prompts = [
      'create our investment platform',
      'build the IVX engine',
      'implement the IVX dashboard module',
      'finish the conversion engine',
      'build our autonomous investment pipeline',
      'develop the IVX backend and ship it',
    ];
    for (const prompt of prompts) {
      const decision = buildIVXOwnerAIPlannerDecision(prompt);
      expect(decision.route).toBe('self_developer');
      expect(decision.semanticIntent).not.toBe('app_build_planning');
    }
  });

  test('a genuinely external app request still enters planning mode', () => {
    expect(buildIVXOwnerAIPlannerDecision('build an app like TikTok').semanticIntent).toBe('app_build_planning');
    expect(buildIVXOwnerAIPlannerDecision('make a dating app similar to hinge').semanticIntent).toBe('app_build_planning');
  });
});

describe('demandsExecutionProofNotNarrative — audit+prove must EXECUTE, never narrate', () => {
  test('an audit paired with fix/deploy/prove is execution, not a report', () => {
    expect(demandsExecutionProofNotNarrative('audit end to end and fix and deploy and prove verified')).toBe(true);
    expect(demandsExecutionProofNotNarrative('review everything, deploy live and prove it')).toBe(true);
    expect(demandsExecutionProofNotNarrative('verify, fix this and ship it now')).toBe(true);
  });

  test('an explicit "stop narrative" / "no more narrative" forces execution', () => {
    expect(demandsExecutionProofNotNarrative('stop narrative and fix this now')).toBe(true);
    expect(demandsExecutionProofNotNarrative('no more narrative, deploy and verify')).toBe(true);
    expect(demandsExecutionProofNotNarrative('i need proof and live deploy and verified but stop narrative')).toBe(true);
  });

  test('a pure report/audit request without an action verb stays false', () => {
    expect(demandsExecutionProofNotNarrative('give me a full audit of the system')).toBe(false);
    expect(demandsExecutionProofNotNarrative('what is the current status')).toBe(false);
  });
});

describe('buildIVXOwnerAIPlannerDecision — "audit end to end + prove/deploy/stop narrative" EXECUTES', () => {
  test('"audit end to end and fix and deploy and prove verified" routes to self developer, NOT a narrative audit', () => {
    const decision = buildIVXOwnerAIPlannerDecision('audit end to end and fix and deploy and prove verified');
    expect(decision.route).toBe('self_developer');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
  });

  test('the exact owner phrasing with "stop narrative" routes to self developer', () => {
    const decision = buildIVXOwnerAIPlannerDecision('i still have same narrative audit end to end and I need proof and live deploy and verified but stop narrative, fix this now');
    expect(decision.route).toBe('self_developer');
    expect(decision.semanticIntent).toBe('self_developer_execution');
  });

  test('a genuine "full audit" report request (no action) still gets the long structured route', () => {
    const decision = buildIVXOwnerAIPlannerDecision('give me a full audit of the system, list all 50 checks');
    expect(decision.route).not.toBe('self_developer');
    expect(decision.requiresLongResponse).toBe(true);
  });
});

describe('buildIVXOwnerAIPlannerDecision — removal/cleanup commands EXECUTE (regression)', () => {
  test('"remove end to end chat loading" routes to self developer, NOT a narrative audit', () => {
    const decision = buildIVXOwnerAIPlannerDecision('remove end to end chat loading');
    expect(decision.route).toBe('self_developer');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
  });

  test('related removal phrasings all route to self developer', () => {
    const prompts = [
      'remove the chat loading spinner now',
      'remove the loading spinner from the chat screen',
      'get rid of the splash delay',
      'hide the duplicate banner on the feed',
      'clean up the loading animation end to end',
    ];
    for (const prompt of prompts) {
      expect(buildIVXOwnerAIPlannerDecision(prompt).route).toBe('self_developer');
    }
  });

  test('a plain question about loading still routes normally', () => {
    const decision = buildIVXOwnerAIPlannerDecision('why is the chat loading slow?');
    expect(decision.route).not.toBe('self_developer');
  });
});

describe('isServerBugFixRequest — short server crash/fix prompts', () => {
  test('detects "fix server crash" and related phrasings', () => {
    expect(isServerBugFixRequest('fix server crash')).toBe(true);
    expect(isServerBugFixRequest('can you fix server crash')).toBe(true);
    expect(isServerBugFixRequest('server is down')).toBe(true);
    expect(isServerBugFixRequest('fix the server issue')).toBe(true);
    expect(isServerBugFixRequest('backend api crash')).toBe(true);
    expect(isServerBugFixRequest('resolve the backend crash')).toBe(true);
  });

  test('does NOT fire on unrelated questions', () => {
    expect(isServerBugFixRequest('what time is it')).toBe(false);
    expect(isServerBugFixRequest('how is the server architecture designed')).toBe(false);
    expect(isServerBugFixRequest('show me the server logs')).toBe(false);
  });
});

describe('isOwnerExecutionOrTaskBlock — server crash prompts', () => {
  test('short "fix server crash" is a task block, not a general question', () => {
    expect(isOwnerExecutionOrTaskBlock('fix server crash')).toBe(true);
    expect(isOwnerExecutionOrTaskBlock('can you fix server crash')).toBe(true);
  });
});

describe('buildIVXOwnerAIPlannerDecision — senior developer execution prompts', () => {
  test('"fix server crash" routes to the senior developer runtime', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Can you fix server crash');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.route).toBe('self_developer');
    expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
  });

  test('"fix this bug" routes to the senior developer runtime', () => {
    const decision = buildIVXOwnerAIPlannerDecision('fix this bug in the chat screen');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.route).toBe('self_developer');
    expect(decision.useTools).toBe(true);
  });

  test('"deploy this to production" routes to self developer', () => {
    const decision = buildIVXOwnerAIPlannerDecision('deploy this to production now');
    expect(decision.route).toBe('self_developer');
  });
});

describe('buildIVXOwnerAIPlannerDecision — work-completion / "prove you are a senior developer"', () => {
  test('"Finish and show proof you are a senior developer" routes to self developer, NOT an audit report', () => {
    const decision = buildIVXOwnerAIPlannerDecision('Finish and show proof you are a senior developer.');
    expect(decision.semanticIntent).toBe('self_developer_execution');
    expect(decision.route).toBe('self_developer');
    expect(decision.useTools).toBe(true);
    expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
  });

  test('related completion / persona phrasings all route to self developer', () => {
    const prompts = [
      'finish the task and prove it',
      'complete the work and deploy now',
      'act as a senior developer and finish this',
      'prove you are a senior engineer',
      'finish and ship it today',
    ];
    for (const prompt of prompts) {
      expect(buildIVXOwnerAIPlannerDecision(prompt).route).toBe('self_developer');
    }
  });

  test('asksToFinishOrProveSeniorDeveloperWork recognises the failing prompt and excludes plain audit asks', () => {
    expect(asksToFinishOrProveSeniorDeveloperWork('finish and show proof you are a senior developer')).toBe(true);
    expect(asksToFinishOrProveSeniorDeveloperWork('prove you are a senior developer')).toBe(true);
    // A genuine status/audit question must NOT be captured as developer execution.
    expect(asksToFinishOrProveSeniorDeveloperWork('is the ai runtime free and unlimited')).toBe(false);
    expect(asksToFinishOrProveSeniorDeveloperWork('what is our current project status')).toBe(false);
  });
});

describe('buildIVXOwnerAIPlannerDecision — code retrieval', () => {
  test('"show me the analytics code" grounds in the repo via tools', () => {
    const decision = buildIVXOwnerAIPlannerDecision('show me the analytics implementation code');
    expect(decision.semanticIntent).toBe('code_retrieval');
    expect(decision.route).toBe('tool_grounded_gpt');
    expect(decision.toolHints).toContain('search_code');
  });

  test('asksForCodeRetrieval recognises file/endpoint phrasing', () => {
    expect(asksForCodeRetrieval('where is the auth endpoint')).toBe(true);
    expect(asksForCodeRetrieval('return the database queries used by analytics')).toBe(true);
  });
});

describe('buildIVXOwnerAIPlannerDecision — infrastructure / live tools', () => {
  test('"list supabase tables" requests live tools', () => {
    const decision = buildIVXOwnerAIPlannerDecision('list the supabase tables');
    expect(decision.useTools).toBe(true);
    expect(decision.route).toBe('tool_grounded_gpt');
  });

  test('"inspect the rls policies" requests live tools', () => {
    const decision = buildIVXOwnerAIPlannerDecision('inspect the rls policies on the users table');
    expect(decision.useTools).toBe(true);
  });
});

describe('buildIVXOwnerAIPlannerDecision — fallback policy never canned', () => {
  test('every route uses fail_visible_not_canned', () => {
    const prompts = [
      'Can you build an app like TikTok?',
      'fix this bug',
      'show me the analytics code',
      'list supabase tables',
      'how should I price my product',
      'what is our current project status',
    ];
    for (const prompt of prompts) {
      expect(buildIVXOwnerAIPlannerDecision(prompt).fallbackPolicy).toBe('fail_visible_not_canned');
    }
  });
});
