import { describe, expect, test } from 'bun:test';
import { buildImageFallbackAnswer, buildVisionInstructionBlock, extractPublicChatImages, } from './services/ivx-public-chat-vision';
describe('extractPublicChatImages', () => {
    test('extracts from images[] objects', () => {
        const images = extractPublicChatImages({
            images: [{ url: 'https://x/a.png', mimeType: 'image/png' }],
        });
        expect(images).toEqual([{ url: 'https://x/a.png', mimeType: 'image/png' }]);
    });
    test('extracts from attachments[] with varied keys', () => {
        const images = extractPublicChatImages({
            attachments: [
                { attachmentUrl: 'https://x/b.jpg', attachmentMime: 'image/jpeg' },
                { uri: 'https://x/c.webp', type: 'image/webp' },
            ],
        });
        expect(images.map((i) => i.url)).toEqual(['https://x/b.jpg', 'https://x/c.webp']);
    });
    test('extracts from imageUrls[] and single imageUrl', () => {
        expect(extractPublicChatImages({ imageUrls: ['https://x/d.png'] })[0]?.url).toBe('https://x/d.png');
        expect(extractPublicChatImages({ imageUrl: 'https://x/e.png' })[0]?.url).toBe('https://x/e.png');
    });
    test('drops non-image MIME types', () => {
        const images = extractPublicChatImages({
            attachments: [{ url: 'https://x/clip.mp4', mimeType: 'video/mp4' }],
        });
        expect(images).toEqual([]);
    });
    test('accepts string entries and de-dups by url', () => {
        const images = extractPublicChatImages({
            images: ['https://x/f.png', 'https://x/f.png'],
        });
        expect(images).toHaveLength(1);
    });
    test('returns empty for missing/invalid input', () => {
        expect(extractPublicChatImages(null)).toEqual([]);
        expect(extractPublicChatImages({})).toEqual([]);
        expect(extractPublicChatImages('nope')).toEqual([]);
    });
});
describe('image fallback (vision proxy unavailable)', () => {
    test('never claims the image cannot be seen', () => {
        const answer = buildImageFallbackAnswer().toLowerCase();
        expect(answer).toContain('received your image');
        expect(answer).not.toContain('cannot see');
        expect(answer).not.toContain("can't see");
    });
});
describe('buildVisionInstructionBlock', () => {
    test('instructs the model it CAN see images and to identify projects', () => {
        const block = buildVisionInstructionBlock();
        expect(block).toContain('you CAN see them');
        expect(block).toContain('Casa Rosario');
        expect(block.toLowerCase()).toContain('extract');
        expect(block.toLowerCase()).toContain('roi');
        expect(block).toContain('cannot');
        expect(block).toContain('Never reply that you cannot view images');
    });
});
