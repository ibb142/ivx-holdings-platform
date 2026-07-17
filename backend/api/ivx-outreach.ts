/**
 * IVX Capital Deployment Platform — Automated Outreach API (owner-only).
 *
 * BLOCK 23. IVX drafts outreach automatically; the owner approves before any
 * message is sent. Endpoints:
 *   GET    /api/ivx/outreach              → list messages (newest first) + summary
 *   POST   /api/ivx/outreach              → create (IVX auto-drafts when no body)
 *   POST   /api/ivx/outreach/draft        → preview a draft without saving
 *   GET    /api/ivx/outreach/:id          → read one message
 *   POST   /api/ivx/outreach/:id          → edit a draft (reverts approval)
 *   POST   /api/ivx/outreach/:id/submit   → move draft into the approval queue
 *   POST   /api/ivx/outreach/:id/approve  → owner approves for sending
 *   POST   /api/ivx/outreach/:id/send     → mark an APPROVED message sent
 *   POST   /api/ivx/outreach/:id/engagement → record opened/clicked/replied/meeting
 *   POST   /api/ivx/outreach/:id/delete   → delete a message
 *
 * Owner-only. SAFETY: a message can only be sent after explicit owner approval.
 * HONESTY: recipients/contacts are owner-supplied; engagement is owner-recorded.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
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
  type CreateOutreachInput,
  type OutreachEngagement,
  type OutreachType,
  type UpdateOutreachInput,
} from '../services/ivx-outreach-store';
import { buildOutreachDraft } from '../services/ivx-outreach-drafter';
import { sendSesEmail, isSesConfigured } from '../services/ivx-ses-email';

export const OPTIONS = (): Response => ownerOnlyOptions();

const VALID_TYPES: ReadonlySet<string> = new Set([
  'email_campaign', 'follow_up', 'investor_intro', 'buyer_intro', 'meeting_request', 'deal_update',
]);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return undefined;
}

async function requireOwner(request: Request): Promise<Response | null> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
    const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleOutreachListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get('limit') ?? '100', 10);
  const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  const [allMessages, summary] = await Promise.all([listOutreachMessages(), summarizeOutreach()]);
  const total = allMessages.length;
  const messages = allMessages.slice(offset, offset + limit);
  return ownerOnlyJson({ ok: true, messages, summary, total, limit, offset, hasMore: offset + limit < total });
}

/** Preview a deterministic draft without persisting it. */
export async function handleOutreachPreviewRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const type = asString(body.type) as OutreachType;
  if (!VALID_TYPES.has(type)) {
    return ownerOnlyJson({ ok: false, error: 'A valid outreach type is required.' }, 400);
  }
  const draft = buildOutreachDraft({
    type,
    recipientName: asString(body.recipientName),
    recipientCompany: asString(body.recipientCompany),
    relatedDeal: asString(body.relatedDeal),
    contextNote: asString(body.contextNote),
    senderName: asString(body.senderName),
  });
  return ownerOnlyJson({ ok: true, draft });
}

export async function handleOutreachCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const input: CreateOutreachInput = {
    type: asString(body.type) as OutreachType,
    recipientName: asString(body.recipientName),
    recipientCompany: asString(body.recipientCompany),
    recipientContact: asString(body.recipientContact),
    relatedDeal: asString(body.relatedDeal),
    contextNote: asString(body.contextNote),
    senderName: asString(body.senderName),
    subject: asString(body.subject),
    body: asString(body.body),
    notes: asString(body.notes),
  };
  const result = await createOutreachMessage(input);
  if (!result.ok) {
    return ownerOnlyJson({ ok: false, error: result.error }, 400);
  }
  return ownerOnlyJson({ ok: true, message: result.message }, 201);
}

export async function handleOutreachGetRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const message = await getOutreachMessage(id);
  if (!message) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, message });
}

export async function handleOutreachUpdateRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const patch: UpdateOutreachInput = {};
  if (body.subject !== undefined) patch.subject = asString(body.subject);
  if (body.body !== undefined) patch.body = asString(body.body);
  if (body.recipientName !== undefined) patch.recipientName = asString(body.recipientName);
  if (body.recipientCompany !== undefined) patch.recipientCompany = asString(body.recipientCompany);
  if (body.recipientContact !== undefined) patch.recipientContact = asString(body.recipientContact);
  if (body.relatedDeal !== undefined) patch.relatedDeal = asString(body.relatedDeal);
  if (body.notes !== undefined) patch.notes = asString(body.notes);
  const updated = await updateOutreachMessage(id, patch);
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, message: updated });
}

export async function handleOutreachSubmitRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const updated = await submitForApproval(id);
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, message: updated });
}

export async function handleOutreachApproveRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const updated = await approveOutreachMessage(id);
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, message: updated });
}

export async function handleOutreachSendRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const before = await getOutreachMessage(id);
  if (!before) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  if (before.status !== 'approved') {
    return ownerOnlyJson({ ok: false, error: 'Message must be approved by the owner before it can be sent.' }, 409);
  }

  // Real delivery via Amazon SES (replaces SendGrid). Only mark the message as
  // sent if SES actually accepted it — never fake a send.
  if (isSesConfigured()) {
    const delivery = await sendSesEmail({
      to: before.recipientContact,
      subject: before.subject,
      body: before.body,
    });
    if (!delivery.ok) {
      return ownerOnlyJson(
        {
          ok: false,
          error: `Email send failed via Amazon SES: ${delivery.error ?? 'unknown error'}`,
          delivery,
        },
        delivery.status === 'missing_config' ? 422 : 502,
      );
    }
    const updated = await markOutreachSent(id);
    return ownerOnlyJson({ ok: true, message: updated, delivery, provider: 'aws_ses' });
  }

  return ownerOnlyJson(
    {
      ok: false,
      error:
        'EMAIL_PROVIDER_NOT_CONFIGURED — Amazon SES requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and a verified IVX_SES_FROM_EMAIL. Set IVX_SES_FROM_EMAIL to enable sending.',
    },
    422,
  );
}

export async function handleOutreachEngagementRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const patch: Partial<OutreachEngagement> = {};
  const opened = asBool(body.opened);
  if (opened !== undefined) patch.opened = opened;
  const clicked = asBool(body.clicked);
  if (clicked !== undefined) patch.clicked = clicked;
  const replied = asBool(body.replied);
  if (replied !== undefined) patch.replied = replied;
  const meetingBooked = asBool(body.meetingBooked);
  if (meetingBooked !== undefined) patch.meetingBooked = meetingBooked;
  const updated = await recordEngagement(id, patch);
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, message: updated });
}

export async function handleOutreachDeleteRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const removed = await deleteOutreachMessage(id);
  if (!removed) {
    return ownerOnlyJson({ ok: false, error: 'Outreach message not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, deleted: true, id });
}
