/**
 * Generation provenance labels for every IVX multimodal output.
 *
 * The owner spec requires that every generated/analyzed media asset is tagged
 * so a render can never be mistaken for a real photo, construction proof, or
 * permit document. Runtime-free + deterministic so it is unit-testable without
 * the AI gateway.
 */
export const MEDIA_LABELS = {
    /** Created from scratch by a model (text -> image / video / 3D). */
    GENERATED: 'GENERATED',
    /** A provided source asset was modified by a model. */
    EDITED: 'EDITED',
    /** Output derived from one or more reference inputs (image-to-3D, reference-to-video). */
    REFERENCE_BASED: 'REFERENCE_BASED',
    /** Understanding/analysis output (not a synthesized asset). */
    ANALYZED: 'ANALYZED',
};
/**
 * Owner-facing EVIDENCE labels every media/3D operation result carries, so a
 * consumer can tell a verified analysis from a generated asset, a procedural
 * preview, or a blocked-missing-provider state at a glance.
 */
export const MEDIA_EVIDENCE_LABELS = {
    IMAGE_ANALYSIS_VERIFIED: 'IMAGE_ANALYSIS_VERIFIED',
    IMAGE_GENERATED: 'IMAGE_GENERATED',
    VIDEO_ANALYSIS_VERIFIED: 'VIDEO_ANALYSIS_VERIFIED',
    GENERATED_3D: 'GENERATED_3D',
    PROCEDURAL_PREVIEW: 'PROCEDURAL_PREVIEW',
    BLOCKED_MISSING_PROVIDER_KEY: 'BLOCKED_MISSING_PROVIDER_KEY',
};
const SYNTHETIC_DISCLAIMER = 'AI-generated visual. Not a real photograph, as-built record, construction proof, or permit document unless independently verified.';
/**
 * Resolve the canonical provenance for a media output given how it was produced.
 * `sourceImageCount` distinguishes pure generation from edits/reference-based work.
 */
export function resolveMediaProvenance(input) {
    const sources = Math.max(0, input.sourceImageCount ?? 0);
    if (input.kind === 'analysis') {
        return {
            label: MEDIA_LABELS.ANALYZED,
            notice: 'Analysis of provided media. No new asset was synthesized.',
            isSynthetic: false,
            disclaimer: null,
        };
    }
    if (input.edited && sources > 0) {
        return {
            label: MEDIA_LABELS.EDITED,
            notice: `Edited from ${sources} provided source ${sources === 1 ? 'asset' : 'assets'} by an AI model.`,
            isSynthetic: true,
            disclaimer: SYNTHETIC_DISCLAIMER,
        };
    }
    if (sources > 0) {
        return {
            label: MEDIA_LABELS.REFERENCE_BASED,
            notice: `Generated using ${sources} reference ${sources === 1 ? 'input' : 'inputs'}.`,
            isSynthetic: true,
            disclaimer: SYNTHETIC_DISCLAIMER,
        };
    }
    return {
        label: MEDIA_LABELS.GENERATED,
        notice: 'Generated from a text prompt by an AI model.',
        isSynthetic: true,
        disclaimer: SYNTHETIC_DISCLAIMER,
    };
}
/** Type guard for an arbitrary string being one of the four canonical labels. */
export function isMediaLabel(value) {
    return typeof value === 'string' && Object.values(MEDIA_LABELS).includes(value);
}
