import type { MemberLoginResult } from './ivx-member-database';

type LoginDependencies = {
  loginMember: (email: string, password: string) => Promise<MemberLoginResult>;
  jsonResponse: (body: unknown, status?: number) => Response;
  deploymentMarker: string;
};

/** Reject malformed credentials before any durable-store or Auth request.
 * Plausible credentials still require an authoritative password verdict. */
export async function handleMemberLoginRequest(request: Request, {
  loginMember, jsonResponse, deploymentMarker,
}: LoginDependencies): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  // Passwords are opaque. Trimming changes a valid credential.
  const password = typeof record.password === 'string' ? record.password : '';
  if (!email || !password) {
    return jsonResponse({ success: false, message: 'Email and password are required.', deploymentMarker }, 400);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ success: false, message: 'Invalid email or password.', deploymentMarker }, 401);
  }
  const result = await loginMember(email, password);
  if (result.success) return jsonResponse(result, 200);
  if (result.requiresVerification) return jsonResponse(result, 403);
  if (result.errorCode === 'auth_upstream_timeout') return jsonResponse(result, 503);
  return jsonResponse(result, 401);
}
