import { describe, expect, test } from 'bun:test';

import { OWNER_CONVERSATION_SELECT_COLUMNS } from '../api/ivx-owner-ai';

describe('owner conversation schema contract', () => {
  test('conversation reads use only columns shared by the IVX and legacy schemas', () => {
    expect(OWNER_CONVERSATION_SELECT_COLUMNS.split(',')).toEqual([
      'id',
      'slug',
      'title',
      'created_at',
      'updated_at',
    ]);
    expect(OWNER_CONVERSATION_SELECT_COLUMNS).not.toContain('user_id');
  });
});
