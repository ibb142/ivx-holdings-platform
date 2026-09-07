import { describe, expect, test } from 'bun:test';

import { getOwnerConversationSelectColumns } from '../api/ivx-owner-ai';

describe('owner conversation schema contract', () => {
  test('IVX conversation reads match the canonical schema', () => {
    const columns = getOwnerConversationSelectColumns('ivx').split(',');

    expect(columns).toEqual([
      'id',
      'slug',
      'title',
      'subtitle',
      'created_at',
      'updated_at',
      'last_message_text',
      'last_message_at',
    ]);
    expect(columns).not.toContain('user_id');
  });

  test('legacy generic conversation reads retain user scoping', () => {
    expect(getOwnerConversationSelectColumns('generic').split(',')).toContain('user_id');
  });
});
