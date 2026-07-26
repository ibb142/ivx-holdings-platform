/**
 * Runtime-free vision helpers for the in-app public chat (`/public/chat`).
 *
 * Kept separate from `public-chat-ai.ts` so the attachment normalizer, the
 * vision system-prompt builder, and the image fallback can be unit-tested
 * without importing the heavy AI gateway runtime.
 */
/**
 * Normalize arbitrary attachment input from the chat client into image
 * attachments the vision model can consume. Accepts `images`, `imageUrls`,
 * `attachments[]`, and single `imageUrl`/`attachmentUrl` shapes; keeps only
 * image MIME types and de-dups by URL.
 */
export function extractPublicChatImages(input) {
    if (!input || typeof input !== 'object') {
        return [];
    }
    const out = [];
    const push = (url, mime) => {
        if (typeof url !== 'string')
            return;
        const trimmedUrl = url.trim();
        if (!trimmedUrl)
            return;
        const trimmedMime = typeof mime === 'string' ? mime.trim() : '';
        if (trimmedMime && !trimmedMime.toLowerCase().startsWith('image/'))
            return;
        out.push({ url: trimmedUrl, mimeType: trimmedMime || null });
    };
    const record = input;
    const arrays = [];
    if (Array.isArray(record.images))
        arrays.push(...record.images);
    if (Array.isArray(record.attachments))
        arrays.push(...record.attachments);
    for (const item of arrays) {
        if (typeof item === 'string') {
            push(item, 'image/*');
            continue;
        }
        if (item && typeof item === 'object') {
            const a = item;
            push(a.url ?? a.attachmentUrl ?? a.imageUrl ?? a.uri, a.mimeType ?? a.mime ?? a.attachmentMime ?? a.type);
        }
    }
    if (Array.isArray(record.imageUrls)) {
        for (const u of record.imageUrls)
            push(u, 'image/*');
    }
    const single = record.imageUrl ?? record.attachmentUrl;
    if (single)
        push(single, record.attachmentMime ?? record.mimeType ?? null);
    const seen = new Set();
    return out.filter((img) => (seen.has(img.url) ? false : (seen.add(img.url), true)));
}
/**
 * Vision instructions appended to the system prompt when image attachments are
 * present. Cross-references visible details against the loaded business context
 * so the model can identify a known IVX project (e.g. Casa Rosario) from its
 * details even when the screenshot does not spell the name.
 */
export function buildVisionInstructionBlock() {
    return [
        'VISUAL INTELLIGENCE: image attachment(s) are included with this message and you CAN see them. Never reply that you cannot view images.',
        'When analyzing an image:',
        '- Describe exactly what is visible (screen, page, property render, chart, UI).',
        '- Extract all readable text, labels, prices, numbers, and button/CTA labels.',
        '- For IVX property/project images: identify the project name, location, price, ROI, timeline, and ownership minimum when visible.',
        '- Cross-reference visible details against the IVX business context above. If the image shows a project whose details match a known IVX deal (e.g. matching location/price/ROI), name that project — for example identify Casa Rosario from its details even if the screenshot does not spell the name.',
        '- For app/landing screenshots: name the screen or page, list visible project cards, and flag broken cards, missing content, or visual inconsistencies.',
        '- Never fabricate values that are not visible in the image or grounded in the business context.',
    ].join('\n');
}
/**
 * Fallback used when image attachments are present but the vision model call
 * could not run (proxy unconfigured/unreachable). It must not claim the image
 * cannot be seen — it states the temporary technical reason instead.
 */
export function buildImageFallbackAnswer() {
    return 'I received your image, but the vision service is temporarily unavailable so I could not analyze it just now. The image was attached correctly — please retry in a moment, and I will describe what is shown and extract any project details (name, location, price, ROI, timeline).';
}
