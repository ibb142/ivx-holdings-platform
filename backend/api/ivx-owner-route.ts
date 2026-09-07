import type { Context as HonoContext } from 'hono';
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';

export type IVXOwnerRouteHandler = (c: HonoContext) => Promise<Response>;

/**
 * Canonical Hono decorator for owner/system-only routes.
 *
 * It accepts a verified owner session or the active IVX system key and fails
 * closed before the wrapped handler can read or mutate protected state.
 */
export function withIVXOwnerOnly(handler: IVXOwnerRouteHandler): IVXOwnerRouteHandler {
  return async (c: HonoContext): Promise<Response> => {
    try {
      const owner = await assertIVXOwnerOnly(c.req.raw);
      if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
      }
      c.set('ownerEmail', owner.email ?? null);
      return await handler(c);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
      const status = /missing bearer|invalid or expired|authentication required/i.test(message) ? 401 : 403;
      return ownerOnlyJson({ ok: false, error: message }, status);
    }
  };
}
