/**
 * IVX Task Type Classifier
 *
 * Classifies every owner request before execution. Each type requires
 * different completion evidence.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_TASK_CLASSIFIER_MARKER =
  'ivx-task-classifier-2026-07-22';

export type IVXTaskType =
  | 'CODE_FIX'
  | 'FEATURE'
  | 'UI_FIX'
  | 'DATA_FIX'
  | 'CONFIGURATION_FIX'
  | 'INFRASTRUCTURE_FIX'
  | 'DEPLOYMENT'
  | 'QA_ONLY'
  | 'INVESTIGATION'
  | 'CONTENT_REQUEST'
  | 'BUSINESS_ANALYSIS';

export type IVXTaskTypeResult = {
  type: IVXTaskType;
  confidence: number;
  matchedKeywords: string[];
};

/**
 * Classification keyword patterns. Each pattern maps to a task type.
 * The classifier picks the type with the most matching patterns.
 */
const CLASSIFICATION_PATTERNS: { type: IVXTaskType; patterns: RegExp[] }[] = [
  {
    type: 'CODE_FIX',
    patterns: [
      /\bfix\s+(?:the\s+)?(?:bug|issue|error|crash|defect|problem)\b/i,
      /\b(?:broken|not\s+working|doesn.t\s+work|does\s+not\s+work|failing)\b/i,
      /\b(?:root\s+cause|reproduce|debug|trace)\b/i,
      /\b(?:NaN|null\s+pointer|undefined|TypeError|SyntaxError)\b/i,
      /\bpatch\b/i,
      /\b(?:fix|repair|resolve)\s+(?:the\s+)?(?:code|function|method|handler|route)\b/i,
    ],
  },
  {
    type: 'FEATURE',
    patterns: [
      /\b(?:add|create|implement|build)\s+(?:a\s+)?(?:new\s+)?(?:feature|module|screen|page|capability|function)\b/i,
      /\b(?:enable|support)\s+(?:a\s+)?(?:new\s+)?(?:feature|capability)\b/i,
      /\b(?:add|implement)\s+(?:a\s+)?(?:button|form|modal|tab|section|widget)\b/i,
    ],
  },
  {
    type: 'UI_FIX',
    patterns: [
      /\b(?:fix|improve|correct)\s+(?:the\s+)?(?:UI|interface|layout|design|spacing|alignment)\b/i,
      /\b(?:fix|correct)\s+(?:the\s+)?(?:scroll|keyboard|input|button|color|style)\b/i,
      /\b(?:loading|skeleton|spinner|placeholder)\s+(?:fix|improve|add)\b/i,
      /\b(?:responsive|mobile|tablet|desktop)\s+(?:layout|design|fix)\b/i,
      /\b(?:visible\s+jump|layout\s+shift|flicker|flash)\b/i,
      /\b(?:open\s+at|scroll\s+to|auto.scroll|position)\b/i,
    ],
  },
  {
    type: 'DATA_FIX',
    patterns: [
      /\b(?:fix|correct|clean|normalize)\s+(?:the\s+)?(?:data|database|records?|entries?)\b/i,
      /\b(?:migration|schema|column|table|index|constraint)\b/i,
      /\b(?:NULL|empty|missing|duplicate)\s+(?:value|field|record|row)\b/i,
      /\b(?:Supabase|SQL|query|insert|update|delete)\s+(?:fix|repair)\b/i,
    ],
  },
  {
    type: 'CONFIGURATION_FIX',
    patterns: [
      /\b(?:config|configuration|env|environment\s+variable)\s+(?:fix|change|update|set)\b/i,
      /\b(?:SMTP|email|mailer|sender)\s+(?:config|setup|configure)\b/i,
      /\b(?:CORS|headers|policy|rules?)\s+(?:fix|update|change)\b/i,
      /\b(?:enable|disable|toggle)\s+(?:a\s+)?(?:setting|flag|feature\s+flag)\b/i,
      /\b(?:bind|unbind|wire\s+up)\s+(?:a\s+)?(?:variable|key|secret|credential)\b/i,
    ],
  },
  {
    type: 'INFRASTRUCTURE_FIX',
    patterns: [
      /\b(?:deploy|deployment|Render|AWS|S3|CloudFront)\s+(?:fix|repair|update)\b/i,
      /\b(?:DNS|domain|SSL|certificate|CDN)\b/i,
      /\b(?:server|instance|worker|process)\s+(?:fix|restart|scale)\b/i,
      /\b(?:pipeline|CI\/CD|build|release)\s+(?:fix|repair|update)\b/i,
    ],
  },
  {
    type: 'DEPLOYMENT',
    patterns: [
      /\bdeploy\s+(?:now|live|to\s+production)\b/i,
      /\bpush\s+to\s+(?:production|main|GitHub)\b/i,
      /\bupload\s+(?:APK|app|binary)\b/i,
      /\bpublish\s+(?:release|version|build)\b/i,
      /\b(?:invalidate|purge)\s+(?:CloudFront|CDN|cache)\b/i,
    ],
  },
  {
    type: 'QA_ONLY',
    patterns: [
      /\b(?:run|execute)\s+(?:tests?|QA|quality\s+check)\b/i,
      /\b(?:audit|inspect|verify|check)\s+(?:without\s+changing|read.only)\b/i,
      /\b(?:do\s+not\s+change|don.t\s+change|no\s+code\s+change)\b/i,
      /\b(?:regression|stress|soak)\s+test\b/i,
    ],
  },
  {
    type: 'INVESTIGATION',
    patterns: [
      /\b(?:investigate|analyze|audit|inspect|review|examine)\s+(?:the\s+)?(?:code|system|app|backend)\b/i,
      /\b(?:explain|understand|why\s+does|how\s+does)\b/i,
      /\b(?:root\s+cause\s+analysis|RCA)\b/i,
      /\b(?:what\s+is\s+(?:wrong|happening|going\s+on))\b/i,
    ],
  },
  {
    type: 'CONTENT_REQUEST',
    patterns: [
      /\b(?:write|create|generate|draft)\s+(?:a\s+)?(?:document|report|summary|description|copy)\b/i,
      /\b(?:marketing|listing|promotional)\s+(?:text|copy|content)\b/i,
      /\b(?:metadata|keywords|tags|labels?)\s+(?:for|update|create)\b/i,
    ],
  },
  {
    type: 'BUSINESS_ANALYSIS',
    patterns: [
      /\b(?:analyze|review|assess)\s+(?:the\s+)?(?:business|market|competitor|strategy)\b/i,
      /\b(?:investor|buyer|lead)\s+(?:analysis|scoring|matching)\b/i,
      /\b(?:KPI|metric|performance|growth)\s+(?:analysis|report)\b/i,
      /\b(?:opportunity|pipeline|funnel)\s+(?:review|analysis)\b/i,
    ],
  },
];

/**
 * Classify an owner request into a task type.
 * Returns the type with the most matching patterns, or INVESTIGATION
 * as the default fallback.
 */
export function classifyTaskType(request: string): IVXTaskTypeResult {
  const text = request.toLowerCase().trim();
  const scores: { type: IVXTaskType; count: number; matched: string[] }[] = [];

  for (const { type, patterns } of CLASSIFICATION_PATTERNS) {
    const matched: string[] = [];
    let count = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        count++;
        matched.push(pattern.source.slice(0, 40));
      }
    }
    if (count > 0) {
      scores.push({ type, count, matched });
    }
  }

  if (scores.length === 0) {
    return {
      type: 'INVESTIGATION',
      confidence: 0.3,
      matchedKeywords: [],
    };
  }

  scores.sort((a, b) => b.count - a.count);
  const best = scores[0];
  const total = scores.reduce((sum, s) => sum + s.count, 0);
  const confidence = Math.min(best.count / total, 1.0);

  return {
    type: best.type,
    confidence,
    matchedKeywords: best.matched,
  };
}

/**
 * Get the required evidence for a task type.
 * The completion validator uses this to know what to check.
 */
export function getRequiredEvidence(type: IVXTaskType): {
  requiresCodeChange: boolean;
  requiresTests: boolean;
  requiresDeployment: boolean;
  requiresDeviceQA: boolean;
  requiresFeatureVerification: boolean;
  requiresConfigurationBefore: boolean;
  requiresConfigurationAfter: boolean;
} {
  switch (type) {
    case 'CODE_FIX':
    case 'FEATURE':
    case 'UI_FIX':
      return {
        requiresCodeChange: true,
        requiresTests: true,
        requiresDeployment: true,
        requiresDeviceQA: true,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'DATA_FIX':
      return {
        requiresCodeChange: true,
        requiresTests: true,
        requiresDeployment: true,
        requiresDeviceQA: false,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'CONFIGURATION_FIX':
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: true,
        requiresDeviceQA: false,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: true,
        requiresConfigurationAfter: true,
      };
    case 'INFRASTRUCTURE_FIX':
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: true,
        requiresDeviceQA: false,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: true,
        requiresConfigurationAfter: true,
      };
    case 'DEPLOYMENT':
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: true,
        requiresDeviceQA: false,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'QA_ONLY':
      return {
        requiresCodeChange: false,
        requiresTests: true,
        requiresDeployment: false,
        requiresDeviceQA: false,
        requiresFeatureVerification: false,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'INVESTIGATION':
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: false,
        requiresDeviceQA: false,
        requiresFeatureVerification: false,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'CONTENT_REQUEST':
      return {
        requiresCodeChange: true,
        requiresTests: false,
        requiresDeployment: true,
        requiresDeviceQA: false,
        requiresFeatureVerification: true,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    case 'BUSINESS_ANALYSIS':
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: false,
        requiresDeviceQA: false,
        requiresFeatureVerification: false,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
    default:
      return {
        requiresCodeChange: false,
        requiresTests: false,
        requiresDeployment: false,
        requiresDeviceQA: false,
        requiresFeatureVerification: false,
        requiresConfigurationBefore: false,
        requiresConfigurationAfter: false,
      };
  }
}
