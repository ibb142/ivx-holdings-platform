import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sanitizeEmail, sanitizePasswordForSignIn, validateEmail } from '@/lib/auth-helpers';

type OwnerBootstrapRequestBody = {
  email?: unknown;
  password?: unknown;
  firstName?: unknown;
  lastName?: unknown;
};

type JsonRecord = Record<string, unknown>;

type AdminUserRecord = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type ServiceRoleStatus = 'ready' | 'missing' | 'matches_anon' | 'unexpected_jwt_role';

type OwnerBootstrapDiagnostics = {
  success: true;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceRoleKey: boolean;
  hasBootstrapSecret: boolean;
  anonJwtRole: string | null;
  serviceRoleJwtRole: string | null;
  serviceRoleStatus: ServiceRoleStatus;
  hasRealServiceRole: boolean;
  canRepairExistingOwner: boolean;
  message: string;
  warnings: string[];
};

type SupabaseEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  anonJwtRole: string | null;
  serviceRoleJwtRole: string | null;
  serviceRoleStatus: ServiceRoleStatus;
  hasRealServiceRole: boolean;
};

type OwnerBootstrapResult = {
  success: boolean;
  message: string;
  mode: 'service_role_repair' | 'public_bootstrap';
  hasRealServiceRole: boolean;
  canSignInNow: boolean;
  userId: string | null;
  ownerEmail: string;
  profileRoleEnsured: boolean;
  warnings: string[];
  blocker: string | null;
  serviceRoleStatus?: ServiceRoleStatus;
  serviceRoleJwtRole?: string | null;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'} as const;

function jsonResponse(payload: JsonRecord, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS});
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeBase64Url(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function extractJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64Url(parts[1]);
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const role = payload.role;
    return typeof role === 'string' && role.trim() ? role.trim() : null;
  } catch {
    return null;
  }
}

function getServiceRoleStatus(anonKey: string, serviceRoleKey: string, serviceRoleJwtRole: string | null): ServiceRoleStatus {
  if (!serviceRoleKey) {
    return 'missing';
  }

  if (serviceRoleKey === anonKey) {
    return 'matches_anon';
  }

  if (serviceRoleJwtRole && serviceRoleJwtRole !== 'service_role' && serviceRoleJwtRole !== 'supabase_admin') {
    return 'unexpected_jwt_role';
  }

  return 'ready';
}

function buildServiceRoleStatusMessage(status: ServiceRoleStatus, serviceRoleJwtRole: string | null): string {
  switch (status) {
    case 'missing':
      return 'SUPABASE_SERVICE_ROLE_KEY is missing on the server, so existing owner auth users cannot be repaired programmatically.';
    case 'matches_anon':
      return 'SUPABASE_SERVICE_ROLE_KEY currently matches the anon key, so Supabase admin endpoints stay blocked.';
    case 'unexpected_jwt_role':
      return `SUPABASE_SERVICE_ROLE_KEY is present but its role claim is ${serviceRoleJwtRole ?? 'unknown'}, not service_role.`;
    case 'ready':
    default:
      return 'Server-side owner auth repair is ready. Existing owner users can be created, updated, and verified programmatically.';
  }
}

function readSupabaseEnvDiagnostics(): OwnerBootstrapDiagnostics & SupabaseEnv {
  const url = readTrimmedString(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const anonKey = readTrimmedString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = readTrimmedString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonJwtRole = extractJwtRole(anonKey);
  const serviceRoleJwtRole = extractJwtRole(serviceRoleKey);
  const serviceRoleStatus = getServiceRoleStatus(anonKey, serviceRoleKey, serviceRoleJwtRole);
  const hasRealServiceRole = serviceRoleStatus === 'ready';
  const warnings: string[] = [];

  if (!url) {
    warnings.push('EXPO_PUBLIC_SUPABASE_URL is missing.');
  }
  if (!anonKey) {
    warnings.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing.');
  }
  if (!getBootstrapSecret()) {
    warnings.push('JWT_SECRET is missing, so secure owner-bootstrap requests are not authorized.');
  }
  if (!hasRealServiceRole) {
    warnings.push(buildServiceRoleStatusMessage(serviceRoleStatus, serviceRoleJwtRole));
  }

  return {
    success: true,
    hasUrl: !!url,
    hasAnonKey: !!anonKey,
    hasServiceRoleKey: !!serviceRoleKey,
    hasBootstrapSecret: !!getBootstrapSecret(),
    anonJwtRole,
    serviceRoleJwtRole,
    serviceRoleStatus,
    hasRealServiceRole,
    canRepairExistingOwner: !!url && !!anonKey && hasRealServiceRole,
    message: buildServiceRoleStatusMessage(serviceRoleStatus, serviceRoleJwtRole),
    warnings,
    url,
    anonKey,
    serviceRoleKey};
}

function getSupabaseEnv(): SupabaseEnv {
  const env = readSupabaseEnvDiagnostics();

  if (!env.url || !env.anonKey) {
    throw new Error('Supabase environment variables are missing.');
  }

  return {
    url: env.url,
    anonKey: env.anonKey,
    serviceRoleKey: env.serviceRoleKey,
    anonJwtRole: env.anonJwtRole,
    serviceRoleJwtRole: env.serviceRoleJwtRole,
    serviceRoleStatus: env.serviceRoleStatus,
    hasRealServiceRole: env.hasRealServiceRole};
}

function createPublicClient(): SupabaseClient {
  const env = getSupabaseEnv();
  return createClient(env.url, env.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false}});
}

function createAdminClient(serviceRoleKey: string): SupabaseClient {
  const env = getSupabaseEnv();
  return createClient(env.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false}});
}

function getBootstrapSecret(): string {
  return readTrimmedString(process.env.JWT_SECRET);
}

function isAuthorizedBootstrapRequest(request: Request): boolean {
  const configuredSecret = getBootstrapSecret();
  const providedSecret = readTrimmedString(request.headers.get('x-owner-bootstrap-secret'));
  return !!configuredSecret && !!providedSecret && configuredSecret === providedSecret;
}

function extractBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  const trimmedToken = readTrimmedString(token);
  return trimmedToken.length > 0 ? trimmedToken : null;
}

function normalizeOwnerRole(value: string | null | undefined): 'owner' | 'investor' {
  const normalizedValue = readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalizedValue === 'owner' || normalizedValue === 'owneradmin' ? 'owner' : 'investor';
}

async function assertOwnerBootstrapAccess(request: Request, url: string, serviceRoleKey: string): Promise<void> {
  if (!serviceRoleKey) {
    throw new Error('Owner bootstrap maintenance is unavailable.');
  }

  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    throw new Error('Owner authorization is required.');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false}});
  const userResult = await client.auth.getUser(accessToken);

  if (userResult.error || !userResult.data.user) {
    throw new Error('Invalid owner session.');
  }

  const profileResult = await client.from('profiles').select('role').eq('id', userResult.data.user.id).maybeSingle();
  const profileRole = profileResult.data && typeof profileResult.data === 'object' && 'role' in profileResult.data
    ? readTrimmedString((profileResult.data as { role?: unknown }).role)
    : '';

  if (normalizeOwnerRole(profileRole) !== 'owner') {
    throw new Error('Owner access is required.');
  }
}

function buildOwnerMetadata(firstName: string, lastName: string): Record<string, unknown> {
  return {
    firstName,
    lastName,
    role: 'owner',
    kycStatus: 'approved'};
}

function buildOwnerProfilePayload(userId: string, email: string, firstName: string, lastName: string): Record<string, unknown> {
  // Production profiles schema does not include a `status` column; sending it
  // causes the upsert to fail with `column profiles.status does not exist`.
  return {
    id: userId,
    email,
    first_name: firstName,
    last_name: lastName,
    role: 'owner',
    kyc_status: 'approved',
    updated_at: new Date().toISOString()};
}

async function listAdminUsersByEmail(url: string, serviceRoleKey: string, email: string): Promise<AdminUserRecord | null> {
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'}});

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase admin list users failed (${response.status}): ${text || 'Unknown error'}`);
    }

    const payload = await response.json() as { users?: AdminUserRecord[] };
    const users = Array.isArray(payload.users) ? payload.users : [];
    const matchedUser = users.find((user) => sanitizeEmail(user.email ?? '') === email);
    if (matchedUser) {
      return matchedUser;
    }

    if (users.length < 200) {
      break;
    }
  }

  return null;
}

async function createAdminUser(url: string, serviceRoleKey: string, email: string, password: string, firstName: string, lastName: string): Promise<AdminUserRecord> {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'},
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: buildOwnerMetadata(firstName, lastName)})});

  const payload = await response.json() as { user?: AdminUserRecord; msg?: string; message?: string };
  if (!response.ok || !payload.user?.id) {
    throw new Error(payload.message || payload.msg || `Supabase admin create user failed (${response.status}).`);
  }

  return payload.user;
}

async function updateAdminUser(url: string, serviceRoleKey: string, userId: string, password: string, firstName: string, lastName: string): Promise<void> {
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'},
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: buildOwnerMetadata(firstName, lastName)})});

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: '' })) as { message?: string; msg?: string };
    throw new Error(payload.message || payload.msg || `Supabase admin update user failed (${response.status}).`);
  }
}

async function ensureOwnerProfile(client: SupabaseClient, userId: string, email: string, firstName: string, lastName: string): Promise<boolean> {
  const payload = buildOwnerProfilePayload(userId, email, firstName, lastName);
  const { error } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    const message = error.message || '';
    const lower = message.toLowerCase();
    const missingColumnMatch = lower.match(/column "?([a-z_]+)"? .*does not exist/);
    const missingColumn = missingColumnMatch?.[1];
    if (missingColumn && missingColumn in payload) {
      console.log('[OwnerBootstrapAPI] Profile upsert dropping missing column and retrying:', missingColumn);
      const retryPayload = { ...payload };
      delete retryPayload[missingColumn];
      const retry = await client
        .from('profiles')
        .upsert(retryPayload, { onConflict: 'id' });
      if (!retry.error) {
        return true;
      }
      console.log('[OwnerBootstrapAPI] Profile retry upsert failed:', retry.error.message);
      return false;
    }
    console.log('[OwnerBootstrapAPI] Profile upsert failed:', message);
    return false;
  }

  return true;
}

async function verifyPasswordSignIn(email: string, password: string): Promise<{ canSignInNow: boolean; message: string }> {
  const client = createPublicClient();
  const normalizedEmail = sanitizeEmail(email);
  const normalizedPassword = sanitizePasswordForSignIn(password);
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword});

  if (error) {
    return {
      canSignInNow: false,
      message: error.message || 'Password sign-in verification failed.'};
  }

  if (data.session) {
    await client.auth.signOut().catch(() => undefined);
    return {
      canSignInNow: true,
      message: 'Password sign-in verified successfully.'};
  }

  return {
    canSignInNow: false,
    message: 'No active session returned after password verification.'};
}

async function repairWithServiceRole(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  url: string;
  serviceRoleKey: string;
  serviceRoleStatus: ServiceRoleStatus;
  serviceRoleJwtRole: string | null;
}): Promise<OwnerBootstrapResult> {
  const warnings: string[] = [];
  const adminClient = createAdminClient(params.serviceRoleKey);
  let user = await listAdminUsersByEmail(params.url, params.serviceRoleKey, params.email);

  if (user?.id) {
    console.log('[OwnerBootstrapAPI] Existing auth user found. Updating owner credentials for:', params.email);
    await updateAdminUser(params.url, params.serviceRoleKey, user.id, params.password, params.firstName, params.lastName);
  } else {
    console.log('[OwnerBootstrapAPI] No auth user found. Creating owner credentials for:', params.email);
    user = await createAdminUser(params.url, params.serviceRoleKey, params.email, params.password, params.firstName, params.lastName);
  }

  const userId = user?.id ?? null;
  if (!userId) {
    throw new Error('Supabase admin flow did not return a user id.');
  }

  const profileRoleEnsured = await ensureOwnerProfile(adminClient, userId, params.email, params.firstName, params.lastName);
  if (!profileRoleEnsured) {
    warnings.push('The auth user was repaired, but the public profile role could not be confirmed as owner yet.');
  }

  const signInCheck = await verifyPasswordSignIn(params.email, params.password);
  if (!signInCheck.canSignInNow) {
    warnings.push(signInCheck.message);
  }

  return {
    success: true,
    message: signInCheck.canSignInNow
      ? 'Owner credentials are active and password sign-in now works.'
      : 'Owner credentials were repaired, but immediate password verification still did not return a live session.',
    mode: 'service_role_repair',
    hasRealServiceRole: true,
    canSignInNow: signInCheck.canSignInNow,
    userId,
    ownerEmail: params.email,
    profileRoleEnsured,
    warnings,
    blocker: null,
    serviceRoleStatus: params.serviceRoleStatus,
    serviceRoleJwtRole: params.serviceRoleJwtRole};
}

async function bootstrapWithPublicSignup(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  serviceRoleStatus: ServiceRoleStatus;
  serviceRoleJwtRole: string | null;
}): Promise<OwnerBootstrapResult> {
  const warnings: string[] = [];
  const client = createPublicClient();
  const serviceRoleMessage = buildServiceRoleStatusMessage(params.serviceRoleStatus, params.serviceRoleJwtRole);
  console.log('[OwnerBootstrapAPI] Service role is not ready. Attempting controlled public bootstrap for:', params.email, 'status:', params.serviceRoleStatus);

  const signUpResult = await client.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: buildOwnerMetadata(params.firstName, params.lastName)}});

  if (signUpResult.error) {
    const lowerMessage = (signUpResult.error.message || '').toLowerCase();
    const blocker = lowerMessage.includes('already') || lowerMessage.includes('exists')
      ? 'existing_account_requires_real_service_role'
      : 'public_owner_bootstrap_failed';

    return {
      success: false,
      message: blocker === 'existing_account_requires_real_service_role'
        ? `This email already exists in Supabase Auth. ${serviceRoleMessage}`
        : signUpResult.error.message || 'Public owner bootstrap failed.',
      mode: 'public_bootstrap',
      hasRealServiceRole: false,
      canSignInNow: false,
      userId: null,
      ownerEmail: params.email,
      profileRoleEnsured: false,
      warnings: [serviceRoleMessage],
      blocker,
      serviceRoleStatus: params.serviceRoleStatus,
      serviceRoleJwtRole: params.serviceRoleJwtRole};
  }

  const createdUser = signUpResult.data.user;
  const identities = Array.isArray(createdUser?.identities) ? createdUser.identities : [];
  if (createdUser && !signUpResult.data.session && identities.length === 0) {
    return {
      success: false,
      message: `Supabase reported that this email already exists. ${serviceRoleMessage}`,
      mode: 'public_bootstrap',
      hasRealServiceRole: false,
      canSignInNow: false,
      userId: createdUser.id,
      ownerEmail: params.email,
      profileRoleEnsured: false,
      warnings: [serviceRoleMessage],
      blocker: 'existing_account_requires_real_service_role',
      serviceRoleStatus: params.serviceRoleStatus,
      serviceRoleJwtRole: params.serviceRoleJwtRole};
  }

  const userId = createdUser?.id ?? null;
  let profileRoleEnsured = false;
  if (userId) {
    profileRoleEnsured = await ensureOwnerProfile(client, userId, params.email, params.firstName, params.lastName);
    if (!profileRoleEnsured) {
      warnings.push('The auth user was created, but the owner profile row could not be confirmed.');
    }
  }

  const signInCheck = await verifyPasswordSignIn(params.email, params.password);
  if (!signInCheck.canSignInNow) {
    warnings.push(signInCheck.message);
  }

  warnings.push(serviceRoleMessage);

  return {
    success: true,
    message: signInCheck.canSignInNow
      ? 'A new owner auth user was bootstrapped and password sign-in now works.'
      : 'A new owner auth user was bootstrapped, but Supabase still did not return an immediate live session for this password.',
    mode: 'public_bootstrap',
    hasRealServiceRole: false,
    canSignInNow: signInCheck.canSignInNow,
    userId,
    ownerEmail: params.email,
    profileRoleEnsured,
    warnings,
    blocker: null,
    serviceRoleStatus: params.serviceRoleStatus,
    serviceRoleJwtRole: params.serviceRoleJwtRole};
}

export async function GET(): Promise<Response> {
  try {
    const diagnostics = readSupabaseEnvDiagnostics();
    console.log('[OwnerBootstrapAPI] Diagnostics requested. serviceRoleStatus:', diagnostics.serviceRoleStatus, 'canRepairExistingOwner:', diagnostics.canRepairExistingOwner);
    return jsonResponse(diagnostics as unknown as JsonRecord, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner bootstrap diagnostics failed.';
    console.log('[OwnerBootstrapAPI] Diagnostics error:', message);
    return jsonResponse({
      success: false,
      message,
      blocker: 'owner_bootstrap_diagnostics_exception'}, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedBootstrapRequest(request)) {
      return jsonResponse({ success: false, message: 'Unauthorized owner bootstrap request.' }, 401);
    }

    const body = await request.json() as OwnerBootstrapRequestBody;
    const email = sanitizeEmail(readTrimmedString(body.email));
    const password = readTrimmedString(body.password);
    const firstName = readTrimmedString(body.firstName) || 'Owner';
    const lastName = readTrimmedString(body.lastName);

    if (!validateEmail(email)) {
      return jsonResponse({ success: false, message: 'A valid owner email is required.' }, 400);
    }

    if (password.length < 8) {
      return jsonResponse({ success: false, message: 'A password with at least 8 characters is required.' }, 400);
    }

    const env = getSupabaseEnv();
    await assertOwnerBootstrapAccess(request, env.url, env.serviceRoleKey);

    const result = env.hasRealServiceRole
      ? await repairWithServiceRole({
          email,
          password,
          firstName,
          lastName,
          url: env.url,
          serviceRoleKey: env.serviceRoleKey,
          serviceRoleStatus: env.serviceRoleStatus,
          serviceRoleJwtRole: env.serviceRoleJwtRole})
      : await bootstrapWithPublicSignup({
          email,
          password,
          firstName,
          lastName,
          serviceRoleStatus: env.serviceRoleStatus,
          serviceRoleJwtRole: env.serviceRoleJwtRole});

    const status = result.success ? 200 : result.blocker === 'existing_account_requires_real_service_role' ? 409 : 500;
    return jsonResponse(result as unknown as JsonRecord, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner bootstrap failed.';
    const status = message === 'Owner authorization is required.' || message === 'Invalid owner session.' ? 401 : message === 'Owner access is required.' || message === 'Owner bootstrap maintenance is unavailable.' ? 403 : 500;
    console.log('[OwnerBootstrapAPI] Fatal error:', message);
    return jsonResponse({
      success: false,
      message,
      blocker: 'owner_bootstrap_exception'}, status);
  }
}
