/**
 * IVX IA Brain Memory — owner-protected REST endpoints to view, edit, and delete
 * the durable user-profile memory, plus a public-shaped greeting endpoint the app
 * calls when opening a new conversation.
 *
 * Routes (registered in backend/hono.ts):
 *   GET    /api/ivx/ia-memory                 → list all remembered profiles (owner)
 *   GET    /api/ivx/ia-memory/greeting        → greeting + profile for a userId (owner)
 *   POST   /api/ivx/ia-memory                 → upsert a profile (owner)
 *   DELETE /api/ivx/ia-memory/:userId         → delete a profile (owner)
 *   POST   /api/ivx/ia-memory/forget-name     → clear a profile's name (owner)
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { deleteProfile, forgetName, getProfile, listProfiles, normalizeUserId, touchLastSeen, upsertProfile, IVX_IA_MEMORY_MARKER, IVX_IA_NAME, } from '../services/ivx-ia-memory-store';
import { buildGreeting } from '../services/ivx-ia-memory-commands';
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Unexpected error.';
}
function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** GET /api/ivx/ia-memory — list every remembered profile. */
export async function handleIVXIaMemoryListRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ error: errorMessage(error) }, 401);
    }
    try {
        const profiles = await listProfiles();
        return ownerOnlyJson({
            ok: true,
            marker: IVX_IA_MEMORY_MARKER,
            aiName: IVX_IA_NAME,
            count: profiles.length,
            profiles,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 500);
    }
}
/** GET /api/ivx/ia-memory/greeting?userId=owner — greeting + profile for a user. */
export async function handleIVXIaMemoryGreetingRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ error: errorMessage(error) }, 401);
    }
    try {
        const url = new URL(request.url);
        const userId = normalizeUserId(url.searchParams.get('userId'));
        const profile = await touchLastSeen(userId);
        return ownerOnlyJson({
            ok: true,
            marker: IVX_IA_MEMORY_MARKER,
            aiName: IVX_IA_NAME,
            greeting: buildGreeting(profile),
            profile,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 500);
    }
}
/** POST /api/ivx/ia-memory — create or update a remembered profile. */
export async function handleIVXIaMemoryUpsertRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ error: errorMessage(error) }, 401);
    }
    let body;
    try {
        const parsed = await request.json().catch(() => null);
        if (!parsed || typeof parsed !== 'object') {
            return ownerOnlyJson({ ok: false, error: 'Invalid or empty JSON body.' }, 400);
        }
        body = parsed;
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Request body unreadable.' }, 400);
    }
    const userId = normalizeUserId(body.userId);
    const input = {};
    if (body.fullName !== undefined)
        input.fullName = readString(body.fullName);
    if (body.preferredName !== undefined)
        input.preferredName = readString(body.preferredName);
    if (body.company !== undefined)
        input.company = readString(body.company);
    if (body.role !== undefined)
        input.role = readString(body.role);
    if (body.email !== undefined)
        input.email = readString(body.email);
    if (body.language !== undefined)
        input.language = readString(body.language);
    if (body.greetingStyle !== undefined) {
        input.greetingStyle = readString(body.greetingStyle);
    }
    try {
        const result = await upsertProfile(userId, input);
        if (!result.ok) {
            return ownerOnlyJson({ ok: false, error: result.error }, 422);
        }
        return ownerOnlyJson({
            ok: true,
            marker: IVX_IA_MEMORY_MARKER,
            profile: result.profile,
            greeting: buildGreeting(result.profile),
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 500);
    }
}
/** POST /api/ivx/ia-memory/forget-name — clear a profile's remembered name. */
export async function handleIVXIaMemoryForgetNameRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ error: errorMessage(error) }, 401);
    }
    let userId = 'owner';
    try {
        const parsed = await request.json().catch(() => null);
        if (parsed && typeof parsed === 'object') {
            userId = normalizeUserId(parsed.userId);
        }
    }
    catch {
        // default to owner
    }
    try {
        const profile = await forgetName(userId);
        if (!profile) {
            return ownerOnlyJson({ ok: false, error: 'No profile found for that user.' }, 404);
        }
        return ownerOnlyJson({ ok: true, marker: IVX_IA_MEMORY_MARKER, profile });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 500);
    }
}
/** DELETE /api/ivx/ia-memory/:userId — delete a remembered profile entirely. */
export async function handleIVXIaMemoryDeleteRequest(request, userIdParam) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ error: errorMessage(error) }, 401);
    }
    try {
        const userId = normalizeUserId(userIdParam);
        const deleted = await deleteProfile(userId);
        return ownerOnlyJson({ ok: deleted, marker: IVX_IA_MEMORY_MARKER, userId, deleted }, deleted ? 200 : 404);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 500);
    }
}
export function handleIVXIaMemoryOptions() {
    return ownerOnlyOptions();
}
// Re-export so callers needing a profile directly (e.g. tests) have one import.
export { getProfile };
