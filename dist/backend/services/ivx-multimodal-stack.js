/**
 * IVX multimodal stack status — one read-only surface that reports, per
 * capability: provider selected, cost estimate, implementation status, and the
 * honest blocker (if any). No fabrication: 3D generation routes through the
 * OWNER's own provider keys (MESHY_API_KEY / TRIPO_API_KEY) and falls back to a
 * deterministic procedural Three.js preview when no owner 3D key is present —
 * never through the Rork toolkit proxy.
 */
import { MEDIA_LABELS, MEDIA_EVIDENCE_LABELS } from './ivx-media-labels';
import { listMediaProviderSelections, selectMediaProvider, hasMeshyKey, hasTripoKey } from './ivx-media-providers';
const MARKER = 'ivx-multimodal-stack-2026-06-06';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** True when the AI gateway path (image/video/vision) is configured. */
export function isAiGatewayConfigured() {
    return readTrimmed(process.env.AI_GATEWAY_API_KEY).length > 0;
}
/** True when an owner-controlled 3D provider key (Meshy/Tripo direct) is present. */
export function isOwner3DProviderConfigured() {
    return hasMeshyKey() || hasTripoKey();
}
export function buildMultimodalStackReport() {
    const gatewayReady = isAiGatewayConfigured();
    const owner3DReady = isOwner3DProviderConfigured();
    const gatewayBlocker = gatewayReady
        ? null
        : {
            reason: 'AI_GATEWAY_API_KEY is not set on the backend runtime.',
            dependency: 'AI_GATEWAY_API_KEY (Vercel AI Gateway bearer).',
            ownerAction: 'Set AI_GATEWAY_API_KEY on the Render service.',
        };
    const capabilities = [
        {
            id: 'image_understanding',
            name: 'Image understanding (screenshots, UI, documents, photos)',
            status: gatewayReady ? 'COMPLETE' : 'BLOCKED',
            provider: selectMediaProvider('image_understanding'),
            useCases: ['OCR / text extraction', 'UI/UX inspection', 'bug detection from screenshots', 'project identification from renders'],
            serviceFiles: ['backend/ivx-ai-runtime.ts', 'backend/services/ivx-public-chat-vision.ts', 'backend/api/owner-multimodal.ts'],
            blocker: gatewayBlocker,
        },
        {
            id: 'video_understanding',
            name: 'Video understanding (frame/timeline analysis, bug + flow detection)',
            status: gatewayReady ? 'COMPLETE' : 'BLOCKED',
            provider: selectMediaProvider('video_understanding'),
            useCases: ['timeline analysis', 'bug detection from recordings', 'user-flow analysis from frames', 'UI review'],
            serviceFiles: ['backend/services/ivx-video-understanding.ts'],
            blocker: gatewayBlocker,
        },
        {
            id: 'image_generation',
            name: 'Image generation (app mockups, landing pages, marketing assets, diagrams)',
            status: gatewayReady ? 'COMPLETE' : 'BLOCKED',
            provider: selectMediaProvider('image_generation'),
            useCases: ['app mockups', 'landing-page concepts', 'marketing assets', 'diagrams'],
            serviceFiles: ['backend/services/ivx-image-generation.ts'],
            blocker: gatewayBlocker,
        },
        {
            id: 'model3d_generation',
            name: '3D generation (product renders, building/room/avatar concepts, investor presentations)',
            // 3D routes through the OWNER's own provider keys (Meshy/Tripo direct). When
            // no owner 3D key is set it falls back to a real deterministic procedural
            // Three.js preview — reported BLOCKED_MISSING_PROVIDER_KEY for real output,
            // never through the Rork toolkit proxy.
            status: owner3DReady ? 'COMPLETE' : 'BLOCKED',
            provider: selectMediaProvider('model3d_generation'),
            useCases: ['product renders', 'building concepts', 'room concepts', 'avatar concepts', 'investor presentation visuals'],
            serviceFiles: ['backend/services/ivx-model3d-generation.ts', 'backend/services/ivx-media-providers.ts'],
            blocker: owner3DReady
                ? null
                : {
                    reason: 'No owner-controlled 3D provider key is configured; a deterministic procedural Three.js preview is returned instead of a real generated model.',
                    dependency: 'MESHY_API_KEY (Meshy direct API) or TRIPO_API_KEY (Tripo direct API).',
                    ownerAction: 'Set MESHY_API_KEY or TRIPO_API_KEY on the backend to enable real GENERATED_3D output.',
                },
        },
    ];
    const complete = capabilities.filter((c) => c.status === 'COMPLETE').length;
    return {
        marker: MARKER,
        generatedAt: new Date().toISOString(),
        labels: [
            MEDIA_LABELS.GENERATED,
            MEDIA_LABELS.EDITED,
            MEDIA_LABELS.REFERENCE_BASED,
            MEDIA_LABELS.ANALYZED,
            MEDIA_EVIDENCE_LABELS.IMAGE_ANALYSIS_VERIFIED,
            MEDIA_EVIDENCE_LABELS.IMAGE_GENERATED,
            MEDIA_EVIDENCE_LABELS.VIDEO_ANALYSIS_VERIFIED,
            MEDIA_EVIDENCE_LABELS.GENERATED_3D,
            MEDIA_EVIDENCE_LABELS.PROCEDURAL_PREVIEW,
            MEDIA_EVIDENCE_LABELS.BLOCKED_MISSING_PROVIDER_KEY,
        ],
        capabilities,
        summary: { total: capabilities.length, complete, blocked: capabilities.length - complete },
        providers: listMediaProviderSelections(),
    };
}
