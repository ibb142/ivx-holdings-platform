/**
 * IVX Intent & Complexity Classifier — Phase 5
 *
 * Classifies each owner request by intent type and complexity.
 * The classification determines model, context depth, tools, specialists,
 * approval requirements, verification requirements, and response format.
 */

// ─── Intent Types ─────────────────────────────────────────────────

export type IVXIntentType =
  | 'informational'
  | 'analysis'
  | 'planning'
  | 'code_inspection'
  | 'qa'
  | 'bug_fix'
  | 'feature'
  | 'module'
  | 'new_app'
  | 'database'
  | 'deployment'
  | 'destructive'
  | 'business_analysis'
  | 'investor_workflow'
  | 'content_generation'
  | 'visual_analysis';

export type IVXComplexity = 'simple' | 'moderate' | 'complex' | 'critical';

export type IVXIntentClassification = {
  intent: IVXIntentType;
  complexity: IVXComplexity;
  requiresApproval: boolean;
  requiresVerification: boolean;
  requiresSpecialist: boolean;
  suggestedSpecialists: string[];
  suggestedModel: 'fast' | 'reasoning' | 'vision' | 'high_quality';
  contextDepth: 'shallow' | 'standard' | 'deep';
  responseFormat: 'direct' | 'execution_update' | 'technical_report' | 'action_required' | 'proof' | 'business';
  reason: string;
};

// ─── Intent Detection ─────────────────────────────────────────────

export function classifyIntent(message: string): IVXIntentType {
  const text = message.toLowerCase().trim();

  // Destructive actions
  if (/\b(delete|remove|drop|destroy|wipe|purge|rollback|revert|destruct)\b/.test(text)) {
    return 'destructive';
  }

  // Visual analysis
  if (/\b(screenshot|image|photo|picture|diagram|visual|analyze.*image|look.*at)\b/.test(text)) {
    return 'visual_analysis';
  }

  // New app
  if (/\b(new app|create app|scaffold|bootstrap.*app|build.*app from scratch)\b/.test(text)) {
    return 'new_app';
  }

  // Module
  if (/\b(module|subsystem|component|service|create.*module|build.*module)\b/.test(text)) {
    return 'module';
  }

  // Feature
  if (/\b(feature|add.*capability|implement.*function|add.*endpoint|create.*flow)\b/.test(text)) {
    return 'feature';
  }

  // Bug fix
  if (/\b(fix|bug|error|crash|broken|not working|failing|debug|diagnose|traceback|stack trace)\b/.test(text)) {
    return 'bug_fix';
  }

  // Deployment
  if (/\b(deploy|push to prod|release|upload|cloudfront|invalidate|render|apk)\b/.test(text)) {
    return 'deployment';
  }

  // Database
  if (/\b(database|migration|schema|table|column|index|constraint|sql|query|supabase|rls)\b/.test(text)) {
    return 'database';
  }

  // Investor workflow
  if (/\b(investor|accreditation|kyc|investment.*amount|deal.*participation|tokenized)\b/.test(text)) {
    return 'investor_workflow';
  }

  // Business analysis
  if (/\b(roi|irr|cap rate|cash flow|valuation|deal.*analysis|property.*comparison|lead.*score|risk.*class)\b/.test(text)) {
    return 'business_analysis';
  }

  // QA
  if (/\b(test|qa|verify|validate|check.*quality|regression|integration test|unit test)\b/.test(text)) {
    return 'qa';
  }

  // Code inspection
  if (/\b(read.*code|inspect.*code|review.*code|search.*code|find.*file|show.*source)\b/.test(text)) {
    return 'code_inspection';
  }

  // Planning
  if (/\b(plan|roadmap|strategy|architect|design.*system|sequence|task graph|approach)\b/.test(text)) {
    return 'planning';
  }

  // Content generation
  if (/\b(write|generate|create|draft|compose|produce)\b/.test(text) && text.length > 20) {
    return 'content_generation';
  }

  // Analysis
  if (/\b(analyze|review|audit|inspect|assess|evaluate|examine)\b/.test(text)) {
    return 'analysis';
  }

  // Default: informational
  return 'informational';
}

// ─── Complexity Detection ─────────────────────────────────────────

export function classifyComplexity(message: string, intent: IVXIntentType): IVXComplexity {
  const text = message.toLowerCase();
  const wordCount = text.split(/\s+/).length;
  const hasMultipleSteps = /\b(and then|after that|step|phase|first.*second|1\.\s.*2\.\s)\b/.test(text);
  const hasMultipleSystems = (text.match(/\b(backend|frontend|database|api|mobile|web|landing|apk|supabase|render|github|cloudfront)\b/g) || []).length > 2;
  const hasApprovalGates = /\b(approve|approval|confirm|owner.*action|gate|phrase)\b/.test(text);

  // Critical: destructive + multi-system
  if (intent === 'destructive' || (hasMultipleSystems && hasApprovalGates)) {
    return 'critical';
  }

  // Complex: multi-step + multi-system OR long prompt with architecture
  if ((hasMultipleSteps && hasMultipleSystems) || wordCount > 100 || intent === 'new_app' || intent === 'module') {
    return 'complex';
  }

  // Moderate: single system + some depth
  if (wordCount > 30 || hasMultipleSteps || intent === 'bug_fix' || intent === 'feature' || intent === 'database' || intent === 'deployment') {
    return 'moderate';
  }

  // Simple
  return 'simple';
}

// ─── Full Classification ──────────────────────────────────────────

export function classifyRequest(message: string): IVXIntentClassification {
  const intent = classifyIntent(message);
  const complexity = classifyComplexity(message, intent);

  // Determine requirements based on intent + complexity
  const requiresApproval = ['destructive', 'deployment', 'database', 'feature', 'module', 'new_app'].includes(intent)
    && complexity !== 'simple';

  const requiresVerification = ['bug_fix', 'feature', 'module', 'deployment', 'database', 'qa'].includes(intent);

  const requiresSpecialist = complexity === 'complex' || complexity === 'critical';

  // Suggest specialists
  const suggestedSpecialists: string[] = [];
  switch (intent) {
    case 'bug_fix':
      suggestedSpecialists.push('IVX Senior Developer', 'IVX QA Engineer');
      if (complexity === 'complex') suggestedSpecialists.push('IVX Architect');
      break;
    case 'feature':
    case 'module':
      suggestedSpecialists.push('IVX Architect', 'IVX Senior Developer', 'IVX QA Engineer');
      if (/\b(mobile|apk|android|ios)\b/.test(message.toLowerCase())) suggestedSpecialists.push('IVX Mobile Engineer');
      if (/\b(backend|api|server)\b/.test(message.toLowerCase())) suggestedSpecialists.push('IVX Backend Engineer');
      break;
    case 'database':
      suggestedSpecialists.push('IVX Database Engineer');
      break;
    case 'deployment':
      suggestedSpecialists.push('IVX DevOps Engineer');
      break;
    case 'destructive':
      suggestedSpecialists.push('IVX Security Engineer', 'IVX DevOps Engineer');
      break;
    case 'business_analysis':
    case 'investor_workflow':
      suggestedSpecialists.push('IVX Investor Analyst', 'IVX Product Analyst');
      break;
    case 'visual_analysis':
      suggestedSpecialists.push('IVX Senior Developer');
      break;
    case 'code_inspection':
      suggestedSpecialists.push('IVX Senior Developer');
      break;
    case 'qa':
      suggestedSpecialists.push('IVX QA Engineer', 'IVX Proof Verifier');
      break;
    default:
      if (complexity === 'complex') suggestedSpecialists.push('IVX Architect');
      break;
  }

  // Model selection
  let suggestedModel: IVXIntentClassification['suggestedModel'] = 'fast';
  if (intent === 'visual_analysis') suggestedModel = 'vision';
  else if (intent === 'bug_fix' || intent === 'feature' || intent === 'module' || intent === 'planning') suggestedModel = 'reasoning';
  else if (intent === 'content_generation' || intent === 'analysis') suggestedModel = 'high_quality';
  else if (complexity === 'complex' || complexity === 'critical') suggestedModel = 'reasoning';

  // Context depth
  let contextDepth: IVXIntentClassification['contextDepth'] = 'shallow';
  if (complexity === 'moderate') contextDepth = 'standard';
  if (complexity === 'complex' || complexity === 'critical') contextDepth = 'deep';

  // Response format
  let responseFormat: IVXIntentClassification['responseFormat'] = 'direct';
  switch (intent) {
    case 'informational':
      responseFormat = 'direct';
      break;
    case 'bug_fix':
    case 'feature':
    case 'module':
    case 'deployment':
      responseFormat = 'execution_update';
      break;
    case 'analysis':
    case 'code_inspection':
    case 'qa':
      responseFormat = 'technical_report';
      break;
    case 'destructive':
    case 'database':
      responseFormat = 'action_required';
      break;
    case 'business_analysis':
    case 'investor_workflow':
      responseFormat = 'business';
      break;
  }

  return {
    intent,
    complexity,
    requiresApproval,
    requiresVerification,
    requiresSpecialist,
    suggestedSpecialists,
    suggestedModel,
    contextDepth,
    responseFormat,
    reason: `intent=${intent}, complexity=${complexity}, specialists=${suggestedSpecialists.length}`,
  };
}

export const IVX_INTENT_CLASSIFIER_MARKER = 'ivx-intent-classifier-2026-07-23-v1';
