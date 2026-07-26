/**
 * IVX image generation through OpenAI API (proven backend path:
 * `OPENAI_API_KEY` -> `https://api.openai.com/v1`, the same auth the
 * runtime + owner-multimodal analysis already use).
 *
 * The gateway call is INJECTABLE (`GatewayImageGenerator`) so the request
 * shaping, provider selection, and provenance labeling are unit-testable
 * without importing the heavy `ai` package or hitting the network. The default
 * generator lazy-imports `ai` only when actually invoked at runtime.
 *
 * Use cases (owner spec): app mockups, landing pages, marketing assets,
 * diagrams. Every output is tagged GENERATED / EDITED / REFERENCE_BASED.
 */
import { resolveMediaProvenance } from './ivx-media-labels';
import { selectMediaProvider, estimateMediaCostUsd } from './ivx-media-providers';
import { autoDetectGatewayBaseUrl } from './ivx-provider-autodetect';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getGatewayApiKey() {
    return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.AI_GATEWAY_API_KEY);
}
function getGatewayBaseUrl() {
    return autoDetectGatewayBaseUrl();
}
/**
 * Default runtime generator. Image-only models (gpt-image-2) use the gateway
 * image model API; multimodal image LLMs (Gemini Nano Banana) emit images via
 * chat. Lazy-imports `ai` so this module loads without the package present.
 */
export const defaultGatewayImageGenerator = async (input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiModule = await import('ai');
    const { createOpenAI } = await import('@ai-sdk/openai');
    const provider = createOpenAI({ apiKey: input.apiKey, baseURL: input.baseURL });
    const isMultimodalLLM = input.modelId.includes('gemini') || input.modelId.includes('gpt-5');
    if (isMultimodalLLM) {
        const result = await aiModule.generateText({
            model: provider(input.modelId),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: input.prompt },
                        ...input.sourceImages.map((image) => ({ type: 'image', image })),
                    ],
                },
            ],
        });
        const files = (result.files ?? []);
        return files
            .filter((file) => typeof file.base64 === 'string' && (file.mediaType ?? '').startsWith('image/'))
            .map((file) => ({ base64: file.base64, mediaType: file.mediaType ?? 'image/png' }));
    }
    const result = await aiModule.experimental_generateImage({
        model: provider.image(input.modelId.replace(/^openai\//, '')),
        prompt: input.prompt,
    });
    const images = (result.images ?? []);
    return images
        .filter((img) => typeof img.base64 === 'string')
        .map((img) => ({ base64: img.base64, mediaType: img.mediaType ?? 'image/png' }));
};
/**
 * Generate one or more images for a prompt (+ optional source images), tagging
 * the output with the correct provenance label. Never throws — failures return
 * `ok:false` with the exact reason.
 */
export async function generateIVXImage(request, generator = defaultGatewayImageGenerator) {
    const generatedAt = new Date().toISOString();
    const prompt = readTrimmed(request.prompt);
    const sources = (request.sourceImages ?? []).map(readTrimmed).filter((s) => s.length > 0);
    const provenance = resolveMediaProvenance({
        kind: 'image',
        sourceImageCount: sources.length,
        edited: request.edit === true,
    });
    // Edits/reference flows need a multimodal image LLM; prompt-only uses gpt-image-2.
    const provider = selectMediaProvider('image_generation');
    const modelId = readTrimmed(request.modelId)
        || (sources.length > 0 ? 'google/gemini-3.1-flash-image' : provider.modelId);
    const resolvedProvider = { ...provider, modelId };
    const estimatedCostUsd = estimateMediaCostUsd('image_generation', 1);
    if (!prompt) {
        return {
            ok: false,
            images: [],
            provenance,
            provider: resolvedProvider,
            estimatedCostUsd,
            error: 'A non-empty prompt is required to generate an image.',
            generatedAt,
        };
    }
    const apiKey = getGatewayApiKey();
    if (!apiKey) {
        return {
            ok: false,
            images: [],
            provenance,
            provider: resolvedProvider,
            estimatedCostUsd,
            error: 'AI_GATEWAY_API_KEY is not configured for image generation.',
            generatedAt,
        };
    }
    try {
        const images = await generator({
            modelId,
            prompt,
            sourceImages: sources,
            apiKey,
            baseURL: getGatewayBaseUrl(),
        });
        if (images.length === 0) {
            return {
                ok: false,
                images: [],
                provenance,
                provider: resolvedProvider,
                estimatedCostUsd,
                error: 'The image model returned no image output.',
                generatedAt,
            };
        }
        return { ok: true, images, provenance, provider: resolvedProvider, estimatedCostUsd, error: null, generatedAt };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation failed.';
        return {
            ok: false,
            images: [],
            provenance,
            provider: resolvedProvider,
            estimatedCostUsd,
            error: message.slice(0, 400),
            generatedAt,
        };
    }
}
