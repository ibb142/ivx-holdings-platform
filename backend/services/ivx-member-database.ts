/**
 * IVX Member Database Service
 *
 * Database operations for member registration, profile management,
 * and KYC status tracking. Uses Supabase with service_role.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

const DEPLOYMENT_MARKER = 'ivx-member-database-v2-ratelimit-fallback';

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  // Service-role key first; anon key as a working fallback (service key was rotated).
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
}

export interface MemberRegistrationInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Date of birth in ISO format (YYYY-MM-DD). */
  dateOfBirth?: string;
  /** Gender: 'male' | 'female' | 'prefer_not_to_say'. */
  gender?: string;
  phone: string;
  country: string;
  zipCode?: string;
  roles?: string[];
  acceptTerms: boolean;
  pictureUrl?: string;
}

export interface MemberRegistrationResult {
  success: boolean;
  message: string;
  userId?: string;
  email?: string;
  requiresVerification: boolean;
  deploymentMarker: string;
}

export async function registerMember(input: MemberRegistrationInput): Promise<MemberRegistrationResult> {
  const supabase = getSupabaseAdmin();

  const userMetadata = {
    first_name: input.firstName,
    last_name: input.lastName,
    date_of_birth: input.dateOfBirth ?? '',
    gender: input.gender ?? '',
    phone: input.phone,
    country: input.country,
    zip_code: input.zipCode ?? '',
    role_interests: input.roles ?? [],
    member_status: 'free_member',
    picture_url: input.pictureUrl ?? '',
  };

  try {
    // 1. Create Supabase Auth user — admin API when a service-role key exists,
    //    otherwise public signUp with the anon key (admin API requires service role).
    let authUserId: string | undefined;
    let authError: { message: string } | null = null;

    if (hasServiceRoleKey()) {
      const { data: authData, error } = await supabase.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true, // Auto-confirm: no SMTP configured, users get instant access
        user_metadata: userMetadata,
      });
      authUserId = authData.user?.id;
      authError = error ? { message: error.message } : null;
    } else {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: userMetadata },
      });
      authUserId = signUpData.user?.id;
      authError = error ? { message: error.message } : null;
      // Supabase returns an obfuscated user with empty identities for existing emails.
      if (!authError && signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        authError = { message: 'User already registered' };
      }
    }

    if (authError) {
      console.error('[MemberDB] Auth user creation failed:', authError.message);
      if (authError.message.toLowerCase().includes('already') || authError.message.toLowerCase().includes('duplicate')) {
        return {
          success: false,
          message: 'An account with this email already exists. Please sign in instead.',
          requiresVerification: false,
          deploymentMarker: DEPLOYMENT_MARKER,
        };
      }
      if (authError.message.toLowerCase().includes('rate limit')) {
        // Supabase's built-in email sender is rate-limited (anon signUp forces a
        // confirmation email). Registration must never fail for this reason:
        // fall back to the backend's own durable member store. The app runs its
        // own email/phone verification, so Supabase's email is not needed.
        console.warn('[MemberDB] Supabase email rate limit hit — using durable fallback store');
        return registerFallbackMember(input);
      }
      return {
        success: false,
        message: `Account creation failed: ${authError.message}`,
        requiresVerification: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    const userId = authUserId;
    if (!userId) {
      return {
        success: false,
        message: 'Account created but user ID not returned',
        requiresVerification: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    // 2. Create profile record
    const now = new Date().toISOString();
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: userId,
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone,
        country: input.country,
        // NOTE: production profiles table has no status/email_verified/phone_verified
        // columns — including them made every registration profile insert fail silently.
        role: 'investor',
        kyc_status: 'pending', // DB check constraint only allows: pending, in_review, approved, rejected
        total_invested: 0,
        total_returns: 0,
        picture_url: input.pictureUrl ?? '',
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      console.error('[MemberDB] Profile creation failed:', profileError.message);
    }

    // 3. Create wallet record
    try {
      const { error: walletError } = await supabase.from('wallets').insert({
        user_id: userId,
        available: 0,
        pending: 0,
        invested: 0,
        total: 0,
        currency: 'USD',
      });
      if (walletError && !walletError.message.toLowerCase().includes('duplicate')) {
        console.error('[MemberDB] Wallet creation failed:', walletError.message);
      }
    } catch (walletErr) {
      console.error('[MemberDB] Wallet creation exception:', walletErr);
    }

    // 4. Log audit
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'member_registered',
        details: JSON.stringify({
          email: input.email,
          country: input.country,
          acceptTerms: input.acceptTerms,
        }),
        created_at: now,
      });
    } catch {
      // non-critical
    }

    console.log('[MemberDB] Member registered:', userId, input.email);
    return {
      success: true,
      message: 'Account created successfully. You can now sign in.',
      userId,
      email: input.email,
      requiresVerification: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MemberDB] Registration exception:', message);
    return {
      success: false,
      message: 'Registration failed due to an internal error',
      requiresVerification: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }
}

// ---------------------------------------------------------------------------
// Durable fallback member store
// Used when Supabase auth signUp is blocked by its email-send rate limit
// (no service-role key configured). Passwords are scrypt-hashed with a
// per-user random salt; plaintext is never stored.
// ---------------------------------------------------------------------------

interface FallbackMemberRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  zipCode: string;
  roles: string[];
  memberStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  pictureUrl: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

type FallbackMemberStore = Record<string, FallbackMemberRecord>;

const MEMBERS_STORE_FILE = (): string =>
  path.join(process.cwd(), 'logs', 'audit', 'member-database', 'fallback-members.json');

async function readMemberStore(): Promise<FallbackMemberStore> {
  const file = MEMBERS_STORE_FILE();
  if (isDurableStoreConfigured()) {
    try {
      return await readDurableJson<FallbackMemberStore>(file, {});
    } catch {
      return {};
    }
  }
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as FallbackMemberStore;
  } catch {
    return {};
  }
}

async function writeMemberStore(store: FallbackMemberStore): Promise<void> {
  const file = MEMBERS_STORE_FILE();
  if (isDurableStoreConfigured()) {
    try {
      await writeDurableJson(file, store);
      return;
    } catch {
      // fall through to filesystem
    }
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

/** Verify a fallback member's credentials. Returns the member id on success. */
export async function verifyFallbackMemberPassword(email: string, password: string): Promise<string | null> {
  const store = await readMemberStore();
  const record = Object.values(store).find((m) => m.email === email.toLowerCase());
  if (!record) return null;
  const candidate = Buffer.from(hashPassword(password, record.passwordSalt), 'hex');
  const expected = Buffer.from(record.passwordHash, 'hex');
  if (candidate.length !== expected.length) return null;
  return timingSafeEqual(candidate, expected) ? record.id : null;
}

async function registerFallbackMember(input: MemberRegistrationInput): Promise<MemberRegistrationResult> {
  try {
    const store = await readMemberStore();
    const email = input.email.toLowerCase();
    const existing = Object.values(store).find((m) => m.email === email);
    if (existing) {
      return {
        success: false,
        message: 'An account with this email already exists. Please sign in instead.',
        requiresVerification: false,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    const userId = `member-${randomUUID()}`;
    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    store[userId] = {
      id: userId,
      email,
      passwordHash: hashPassword(input.password, salt),
      passwordSalt: salt,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      country: input.country,
      zipCode: input.zipCode ?? '',
      roles: input.roles ?? [],
      memberStatus: 'free_member',
      emailVerified: false,
      phoneVerified: false,
      pictureUrl: input.pictureUrl ?? '',
      source: 'fallback_supabase_email_rate_limit',
      createdAt: now,
      updatedAt: now,
    };
    await writeMemberStore(store);

    // Best-effort Supabase profile row so dashboards see the member too.
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('profiles').upsert(
        {
          id: userId,
          email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          country: input.country,
          role: 'investor',
          kyc_status: 'pending',
          picture_url: input.pictureUrl ?? '',
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'id' }
      );
    } catch {
      // non-critical — durable store is the source of truth for this member
    }

    console.log('[MemberDB] Fallback member registered:', userId, email);
    return {
      success: true,
      message: 'Account created successfully. Please verify your email and phone.',
      userId,
      email,
      requiresVerification: true,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MemberDB] Fallback registration failed:', message);
    return {
      success: false,
      message: 'Registration failed due to an internal error',
      requiresVerification: false,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }
}

/** Look up a member in the durable fallback store by id. */
export async function getFallbackMember(userId: string): Promise<FallbackMemberRecord | null> {
  const store = await readMemberStore();
  return store[userId] ?? null;
}

export interface MemberProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  role: string;
  status: string;
  kycStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  totalInvested: number;
  totalReturns: number;
  pictureUrl: string;
  createdAt: string;
  updatedAt: string;
}

export async function getMemberProfile(userId: string): Promise<MemberProfile | null> {
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      const fallback = await getFallbackMember(userId);
      if (fallback) {
        return {
          id: fallback.id,
          email: fallback.email,
          firstName: fallback.firstName,
          lastName: fallback.lastName,
          phone: fallback.phone,
          country: fallback.country,
          role: 'investor',
          status: 'active',
          kycStatus: 'not_started',
          emailVerified: fallback.emailVerified,
          phoneVerified: fallback.phoneVerified,
          totalInvested: 0,
          totalReturns: 0,
          pictureUrl: fallback.pictureUrl ?? '',
          createdAt: fallback.createdAt,
          updatedAt: fallback.updatedAt,
        };
      }
      return null;
    }

    const p = data as any;
    return {
      id: p.id,
      email: p.email ?? '',
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      phone: p.phone ?? '',
      country: p.country ?? '',
      role: p.role ?? 'investor',
      status: p.status ?? 'active',
      kycStatus: p.kyc_status ?? 'not_started',
      emailVerified: !!(p.email_verified),
      phoneVerified: !!(p.phone_verified),
      totalInvested: Number(p.total_invested ?? 0),
      totalReturns: Number(p.total_returns ?? 0),
      pictureUrl: p.picture_url ?? '',
      createdAt: p.created_at ?? '',
      updatedAt: p.updated_at ?? '',
    };
  } catch (err) {
    console.error('[MemberDB] Profile fetch error:', err);
    return null;
  }
}

export async function updateMemberKYCStatus(
  userId: string,
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'rejected'
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ kyc_status: status, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      console.error('[MemberDB] KYC status update failed:', error.message);
      return false;
    }

    // Audit log
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'kyc_status_changed',
        details: JSON.stringify({ newStatus: status }),
        created_at: new Date().toISOString(),
      });
    } catch {
      // non-critical
    }

    return true;
  } catch (err) {
    console.error('[MemberDB] KYC update exception:', err);
    return false;
  }
}

export async function updateMemberLastLogin(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  try {
    await supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Member login, password reset, profile update
// ---------------------------------------------------------------------------

export interface MemberLoginResult {
  success: boolean;
  message: string;
  userId?: string;
  email?: string;
  requiresVerification?: boolean;
  deploymentMarker: string;
}

/** Verify a member's email + password.
 *  - First checks the durable fallback store (scrypt-hashed passwords).
 *  - Falls back to Supabase Auth signInWithPassword when no fallback record exists.
 *  Records last_login_at on success. Never returns the password or session token. */
export async function loginMember(email: string, password: string): Promise<MemberLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { success: false, message: 'Email and password are required.', deploymentMarker: DEPLOYMENT_MARKER };
  }

  // 1. Durable fallback store first (covers members registered during Supabase email rate-limit).
  const fallbackUserId = await verifyFallbackMemberPassword(normalizedEmail, password);
  if (fallbackUserId) {
    await updateMemberLastLogin(fallbackUserId);
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('audit_logs').insert({
        user_id: fallbackUserId,
        action: 'member_login',
        details: JSON.stringify({ source: 'fallback_store', email: normalizedEmail }),
        created_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }
    return { success: true, message: 'Login successful.', userId: fallbackUserId, email: normalizedEmail, deploymentMarker: DEPLOYMENT_MARKER };
  }

  // 2. Supabase Auth path.
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
        return { success: false, message: 'Invalid email or password.', deploymentMarker: DEPLOYMENT_MARKER };
      }
      if (msg.includes('email not confirmed')) {
        return { success: false, message: 'Please verify your email before signing in.', requiresVerification: true, deploymentMarker: DEPLOYMENT_MARKER };
      }
      if (msg.includes('rate limit')) {
        return { success: false, message: 'Too many attempts. Please wait a minute and try again.', deploymentMarker: DEPLOYMENT_MARKER };
      }
      return { success: false, message: `Login failed: ${error.message}`, deploymentMarker: DEPLOYMENT_MARKER };
    }
    const userId = data.user?.id;
    if (!userId) {
      return { success: false, message: 'Login succeeded but no user id returned.', deploymentMarker: DEPLOYMENT_MARKER };
    }
    await updateMemberLastLogin(userId);
    // Best-effort audit log (does not block login).
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'member_login',
        details: JSON.stringify({ source: 'supabase_auth', email: normalizedEmail }),
        created_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }
    return { success: true, message: 'Login successful.', userId, email: normalizedEmail, deploymentMarker: DEPLOYMENT_MARKER };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed due to an internal error.';
    console.error('[MemberDB] Login exception:', message);
    return { success: false, message, deploymentMarker: DEPLOYMENT_MARKER };
  }
}

/** Request a member password reset.
 *  - For fallback-store members: verifies the member exists, then issues a
 *    single-use reset token (random) stored alongside the record. The token
 *    is returned once so the caller (owner/admin) can deliver it via the
 *    chosen channel. The password itself is never reset here.
 *  - For Supabase Auth members: triggers Supabase resetPasswordForEmail.
 *  Always returns success:true for unknown emails to avoid user enumeration. */
export interface MemberResetResult {
  success: boolean;
  message: string;
  resetToken?: string;
  channel?: 'fallback_store' | 'supabase_email';
  deploymentMarker: string;
}

export async function requestMemberPasswordReset(email: string): Promise<MemberResetResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { success: false, message: 'Email is required.', deploymentMarker: DEPLOYMENT_MARKER };
  }

  // 1. Fallback store member?
  const store = await readMemberStore();
  const fallbackRecord = Object.values(store).find((m) => m.email === normalizedEmail);
  if (fallbackRecord) {
    const token = randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
    (store[fallbackRecord.id] as FallbackMemberRecord & { resetToken?: string; resetTokenExpiresAt?: number }).resetToken = token;
    (store[fallbackRecord.id] as FallbackMemberRecord & { resetTokenExpiresAt?: number }).resetTokenExpiresAt = expiresAt;
    store[fallbackRecord.id].updatedAt = now;
    await writeMemberStore(store);
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('audit_logs').insert({
        user_id: fallbackRecord.id,
        action: 'member_password_reset_requested',
        details: JSON.stringify({ email: normalizedEmail, channel: 'fallback_store' }),
        created_at: now,
      });
    } catch { /* non-critical */ }
    return { success: true, message: 'Reset token issued. Deliver it to the member via a verified channel.', resetToken: token, channel: 'fallback_store', deploymentMarker: DEPLOYMENT_MARKER };
  }

  // 2. Supabase Auth member — trigger email reset.
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
    if (error) {
      // Avoid user enumeration: still return success for unknown emails.
      if (error.message.toLowerCase().includes('rate limit')) {
        return { success: false, message: 'Too many reset requests. Please wait a minute and try again.', deploymentMarker: DEPLOYMENT_MARKER };
      }
      // Most other errors are not user-facing.
      console.error('[MemberDB] Supabase reset error:', error.message);
    }
    return { success: true, message: 'If an account exists for that email, a reset link has been sent.', channel: 'supabase_email', deploymentMarker: DEPLOYMENT_MARKER };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reset request failed.';
    console.error('[MemberDB] Reset exception:', message);
    return { success: false, message, deploymentMarker: DEPLOYMENT_MARKER };
  }
}

/** Reset a fallback-store member's password using a single-use token. */
export async function resetMemberPasswordWithToken(email: string, token: string, newPassword: string): Promise<MemberResetResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !token || !newPassword) {
    return { success: false, message: 'Email, token, and new password are required.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return { success: false, message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  const store = await readMemberStore();
  const record = Object.values(store).find((m) => m.email === normalizedEmail) as (FallbackMemberRecord & { resetToken?: string; resetTokenExpiresAt?: number }) | undefined;
  if (!record || !record.resetToken || record.resetToken !== token) {
    return { success: false, message: 'Invalid or expired reset token.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (!record.resetTokenExpiresAt || record.resetTokenExpiresAt < Date.now()) {
    return { success: false, message: 'Reset token has expired. Please request a new one.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  const salt = randomBytes(16).toString('hex');
  record.passwordHash = hashPassword(newPassword, salt);
  record.passwordSalt = salt;
  record.resetToken = undefined;
  record.resetTokenExpiresAt = undefined;
  record.updatedAt = new Date().toISOString();
  store[record.id] = record;
  await writeMemberStore(store);
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('audit_logs').insert({
      user_id: record.id,
      action: 'member_password_reset_completed',
      details: JSON.stringify({ email: normalizedEmail, channel: 'fallback_store' }),
      created_at: record.updatedAt,
    });
  } catch { /* non-critical */ }
  return { success: true, message: 'Password has been reset. You can now sign in.', deploymentMarker: DEPLOYMENT_MARKER };
}

export interface UpdateMemberProfileInput {
  userId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  country?: string;
  zipCode?: string;
  pictureUrl?: string;
}

export interface UpdateMemberProfileResult {
  success: boolean;
  message: string;
  profile?: MemberProfile;
  deploymentMarker: string;
}

/** Update an existing member's profile. Only non-empty fields are written.
 *  Writes to the Supabase profiles table and, for fallback members, the durable
 *  store. Audit-logged. Never deletes or nulls fields the caller omits. */
export async function updateMemberProfile(input: UpdateMemberProfileInput): Promise<UpdateMemberProfileResult> {
  if (!input.userId) {
    return { success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  const updates: Record<string, string> = {};
  if (input.firstName !== undefined && input.firstName.trim()) updates.first_name = input.firstName.trim();
  if (input.lastName !== undefined && input.lastName.trim()) updates.last_name = input.lastName.trim();
  if (input.phone !== undefined && input.phone.trim()) updates.phone = input.phone.trim();
  if (input.country !== undefined && input.country.trim()) updates.country = input.country.trim();
  if (input.zipCode !== undefined) updates.zip_code = input.zipCode.trim();
  if (input.pictureUrl !== undefined && input.pictureUrl.trim()) updates.picture_url = input.pictureUrl.trim();
  if (Object.keys(updates).length === 0) {
    return { success: false, message: 'No profile fields to update.', deploymentMarker: DEPLOYMENT_MARKER };
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  let profileWritten = false;
  try {
    const { error } = await supabase.from('profiles').update(updates).eq('id', input.userId);
    if (!error) profileWritten = true;
    else console.error('[MemberDB] Profile update failed:', error.message);
  } catch (err) {
    console.error('[MemberDB] Profile update exception:', err);
  }

  // Mirror into fallback store if the member lives there.
  try {
    const store = await readMemberStore();
    if (store[input.userId]) {
      const rec = store[input.userId];
      if (updates.first_name) rec.firstName = updates.first_name;
      if (updates.last_name) rec.lastName = updates.last_name;
      if (updates.phone) rec.phone = updates.phone;
      if (updates.country) rec.country = updates.country;
      if (updates.zip_code !== undefined) rec.zipCode = updates.zip_code;
      if (updates.picture_url) rec.pictureUrl = updates.picture_url;
      rec.updatedAt = updates.updated_at;
      await writeMemberStore(store);
      profileWritten = true;
    }
  } catch (err) {
    console.error('[MemberDB] Fallback profile update exception:', err);
  }

  if (!profileWritten) {
    return { success: false, message: 'Profile update failed — member not found or database error.', deploymentMarker: DEPLOYMENT_MARKER };
  }

  // Audit log (best-effort).
  try {
    await supabase.from('audit_logs').insert({
      user_id: input.userId,
      action: 'member_profile_updated',
      details: JSON.stringify({ fields: Object.keys(updates) }),
      created_at: updates.updated_at,
    });
  } catch { /* non-critical */ }

  const profile = await getMemberProfile(input.userId);
  return { success: true, message: 'Profile updated.', profile: profile ?? undefined, deploymentMarker: DEPLOYMENT_MARKER };
}
