import {
  runAutonomousMode,
  type AutonomousModeReport,
  type RunAutonomousModeOptions,
} from './ivx-autonomous-mode';
import {
  certifyAutonomousQuality,
  type AutonomousQualityDecision,
} from './ivx-autonomous-quality-controller';

export const IVX_AUTONOMOUS_INTELLIGENT_MODE_MARKER = 'ivx-autonomous-intelligent-mode-2026-08-20-v1';

export type IntelligentAutonomousModeReport = AutonomousModeReport & {
  intelligenceMarker: typeof IVX_AUTONOMOUS_INTELLIGENT_MODE_MARKER;
  builderFinalStatus: AutonomousModeReport['finalStatus'];
  quality: AutonomousQualityDecision;
  releaseAllowed: boolean;
};

export async function runIntelligentAutonomousMode(
  task: string,
  options: RunAutonomousModeOptions = {},
): Promise<IntelligentAutonomousModeReport> {
  const builder = await runAutonomousMode(task, options);
  const quality = certifyAutonomousQuality({
    ownerStopVerifiedInactive: builder.ownerStopVerifiedInactive,
    decision: {
      requiresApproval: builder.intent.requiresApproval,
      approvalCategories: builder.intent.approvalCategories,
    },
    selfHeal: builder.selfHeal,
  });

  const builderFinalStatus = builder.finalStatus;
  const certified = builderFinalStatus === 'VERIFIED' && quality.releaseAllowed;
  const finalStatus: AutonomousModeReport['finalStatus'] =
    builderFinalStatus === 'BLOCKED_FOR_APPROVAL' || builderFinalStatus === 'STOPPED_BY_OWNER'
      ? builderFinalStatus
      : certified
        ? 'VERIFIED'
        : 'FAILED';

  const classification: AutonomousModeReport['classification'] =
    finalStatus === 'VERIFIED'
      ? builder.classification
      : builderFinalStatus === 'BLOCKED_FOR_APPROVAL' || builderFinalStatus === 'STOPPED_BY_OWNER'
        ? builder.classification
        : 'UNVERIFIED';

  return {
    ...builder,
    intelligenceMarker: IVX_AUTONOMOUS_INTELLIGENT_MODE_MARKER,
    builderFinalStatus,
    quality,
    releaseAllowed: certified,
    finalStatus,
    classification,
  };
}
