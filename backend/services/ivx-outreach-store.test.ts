import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// Force filesystem mode — prevents Supabase state pollution between test files
mock.module('./ivx-durable-store', () => ({
  isDurableStoreConfigured: () => false,
  readDurableJson: async (_f: string, fallback: unknown) => fallback,
  writeDurableJson: async () => {},
  appendDurableEvent: async () => {},
  readDurableEvents: async () => [],
  durableKeyForFile: (f: string) => f,
}));

import {
  approveOutreachMessage,
  createOutreachMessage,
  deleteOutreachMessage,
  getOutreachMessage,
  listOutreachMessages,
  markOutreachSent,
  recordEngagement,
  submitForApproval,
  summarizeOutreach,
  updateOutreachMessage,
  validateCreateOutreach,
  type CreateOutreachInput,
} from './ivx-outreach-store';

const ROOT = path.join(process.cwd(), 'logs', 'audit', 'outreach');

async function clean(): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
}

function baseInput(overrides: Partial<CreateOutreachInput> = {}): CreateOutreachInput {
  return {
    type: overrides.type ?? 'investor_intro',
    recipientName: overrides.recipientName ?? 'Jane Capital',
    ...overrides,
  };
}

beforeEach(clean);
afterEach(clean);

describe('validateCreateOutreach', () => {
  it('requires a valid type', () => {
    expect(validateCreateOutreach({ type: 'spam' as never, recipientName: 'X' }).ok).toBe(false);
  });

  it('requires a recipient name or company', () => {
    expect(validateCreateOutreach({ type: 'follow_up' }).ok).toBe(false);
    expect(validateCreateOutreach({ type: 'follow_up', recipientCompany: 'Acme' }).ok).toBe(true);
  });
});

describe('drafting', () => {
  it('auto-drafts a subject + body when none supplied and flags aiDrafted', async () => {
    const created = await createOutreachMessage(baseInput({ relatedDeal: 'Casa Rosario' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.message.aiDrafted).toBe(true);
    expect(created.message.subject.length).toBeGreaterThan(0);
    expect(created.message.body).toContain('Jane Capital');
    expect(created.message.status).toBe('draft');
  });

  it('keeps an owner-written subject + body and marks aiDrafted false', async () => {
    const created = await createOutreachMessage(baseInput({ subject: 'My subject', body: 'My body' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.message.aiDrafted).toBe(false);
    expect(created.message.subject).toBe('My subject');
  });
});

describe('approval gate (safety)', () => {
  it('cannot be sent until approved', async () => {
    const created = await createOutreachMessage(baseInput());
    if (!created.ok) return;
    const id = created.message.id;

    // Attempt to send a draft → stays draft (not sent).
    const sentDraft = await markOutreachSent(id);
    expect(sentDraft?.status).toBe('draft');
    expect(sentDraft?.sentAt).toBeNull();

    // Submit → approve → send.
    expect((await submitForApproval(id))?.status).toBe('pending_approval');
    const approved = await approveOutreachMessage(id);
    expect(approved?.status).toBe('approved');
    expect(approved?.approvedAt).not.toBeNull();

    const sent = await markOutreachSent(id);
    expect(sent?.status).toBe('sent');
    expect(sent?.sentAt).not.toBeNull();
  });

  it('editing an approved message reverts it to draft (must re-approve)', async () => {
    const created = await createOutreachMessage(baseInput());
    if (!created.ok) return;
    const id = created.message.id;
    await approveOutreachMessage(id);
    const edited = await updateOutreachMessage(id, { body: 'Updated body' });
    expect(edited?.status).toBe('draft');
    expect(edited?.approvedAt).toBeNull();
  });

  it('does not edit a message once sent', async () => {
    const created = await createOutreachMessage(baseInput());
    if (!created.ok) return;
    const id = created.message.id;
    await approveOutreachMessage(id);
    await markOutreachSent(id);
    const edited = await updateOutreachMessage(id, { body: 'Too late' });
    expect(edited?.status).toBe('sent');
    expect(edited?.body).not.toBe('Too late');
  });
});

describe('engagement + summary', () => {
  it('records engagement and flips to replied; summary rolls up', async () => {
    const a = await createOutreachMessage(baseInput({ type: 'email_campaign', recipientName: 'A' }));
    const b = await createOutreachMessage(baseInput({ type: 'follow_up', recipientName: 'B' }));
    if (!a.ok || !b.ok) return;

    await approveOutreachMessage(a.message.id);
    await markOutreachSent(a.message.id);
    const engaged = await recordEngagement(a.message.id, { opened: true, replied: true, meetingBooked: true });
    expect(engaged?.engagement.opened).toBe(true);
    expect(engaged?.status).toBe('replied');

    const summary = await summarizeOutreach();
    expect(summary.total).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.opened).toBe(1);
    expect(summary.replied).toBe(1);
    expect(summary.meetingsBooked).toBe(1);
    expect(summary.byType.email_campaign).toBe(1);
    expect(summary.byType.follow_up).toBe(1);
    expect(summary.drafts).toBe(1);
  });

  it('lists, reads, and deletes', async () => {
    const created = await createOutreachMessage(baseInput());
    if (!created.ok) return;
    const id = created.message.id;
    expect((await getOutreachMessage(id))?.id).toBe(id);
    expect(await listOutreachMessages()).toHaveLength(1);
    expect(await deleteOutreachMessage(id)).toBe(true);
    expect(await deleteOutreachMessage(id)).toBe(false);
    expect(await listOutreachMessages()).toHaveLength(0);
  });
});
