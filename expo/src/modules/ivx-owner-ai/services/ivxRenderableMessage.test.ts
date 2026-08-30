import { describe, expect, it } from 'bun:test';
import { filterRenderableOwnerMessages, isRenderableOwnerMessage } from './ivxRenderableMessage';

describe('Owner AI renderable message guard', () => {
  it('rejects null, empty, and whitespace-only reply rows', () => {
    expect(isRenderableOwnerMessage({ body: null, attachmentUrl: null })).toBe(false);
    expect(isRenderableOwnerMessage({ body: '', attachmentUrl: null })).toBe(false);
    expect(isRenderableOwnerMessage({ body: '   ', attachmentUrl: null })).toBe(false);
  });

  it('keeps visible assistant text', () => {
    expect(isRenderableOwnerMessage({ body: 'Completed.', attachmentUrl: null })).toBe(true);
  });

  it('keeps attachment-only messages', () => {
    expect(isRenderableOwnerMessage({ body: null, attachmentUrl: 'https://example.test/proof.pdf' })).toBe(true);
  });

  it('filters an interrupted empty assistant row without deleting valid turns', () => {
    const rows = [
      { id: 'owner-1', body: 'Finish now', attachmentUrl: null },
      { id: 'assistant-empty', body: null, attachmentUrl: null },
      { id: 'assistant-2', body: 'Done', attachmentUrl: null },
    ];
    expect(filterRenderableOwnerMessages(rows).map((row) => row.id)).toEqual(['owner-1', 'assistant-2']);
  });
});
