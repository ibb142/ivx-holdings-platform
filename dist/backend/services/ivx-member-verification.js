/**
 * IVX Member Verification Service
 *
 * Generates verification codes, stores them in Supabase with TTL,
 * and provides verification endpoints for email and phone.
 * Email/SMS delivery is handled via the Rork AI gateway for now;
 * connect to SendGrid/Twilio for production.
 *
 * v2 (2026-07-03): The production Supabase schema is missing the
 * `verification_codes` table and the `profiles.email_verified` /
 * `profiles.phone_verified` columns (schema repair requires the
 * service-role key, which is not configured). All operations now
 * fall back to a resilient local store (durable store when
 * configured, filesystem otherwise) so verification works end to
 * end regardless of schema state. Supabase remains the primary
 * path and is used automatically once the schema exists.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, } from './ivx-durable-store';
const DEPLOYMENT_MARKER = 'ivx-member-verification-v2-fallback-store';
const CODE_TTL_MINUTES = 10;
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
function getSupabaseAdmin() {
    const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    // Service-role key first; anon key as a working fallback (service key was rotated).
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
        '';
    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
function generateCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += Math.floor(Math.random() * 10).toString();
    }
    return code;
}
const STORE_DIR = () => path.join(process.cwd(), 'logs', 'audit', 'member-verification');
const CODES_FILE = () => path.join(STORE_DIR(), 'verification-codes.json');
const STATUS_FILE = () => path.join(STORE_DIR(), 'verification-status.json');
function codeKey(userId, type) {
    return `${userId}:${type}`;
}
async function readStore(file, fallback) {
    if (isDurableStoreConfigured()) {
        try {
            return await readDurableJson(file, fallback);
        }
        catch {
            return fallback;
        }
    }
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeStore(file, value) {
    if (isDurableStoreConfigured()) {
        try {
            await writeDurableJson(file, value);
            return;
        }
        catch {
            // fall through to filesystem
        }
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function fallbackStoreCode(input, code, expiresAt) {
    const codes = await readStore(CODES_FILE(), {});
    codes[codeKey(input.userId, input.type)] = {
        userId: input.userId,
        type: input.type,
        code,
        attempts: 0,
        expiresAt: expiresAt.toISOString(),
        verifiedAt: null,
        createdAt: new Date().toISOString(),
    };
    await writeStore(CODES_FILE(), codes);
}
async function fallbackMarkVerified(userId, type) {
    const statuses = await readStore(STATUS_FILE(), {});
    const current = statuses[userId] ?? { emailVerified: false, phoneVerified: false, updatedAt: '' };
    statuses[userId] = {
        emailVerified: type === 'email' ? true : current.emailVerified,
        phoneVerified: type === 'phone' ? true : current.phoneVerified,
        updatedAt: new Date().toISOString(),
    };
    await writeStore(STATUS_FILE(), statuses);
}
async function fallbackVerifyCode(input) {
    const codes = await readStore(CODES_FILE(), {});
    const key = codeKey(input.userId, input.type);
    const record = codes[key];
    if (!record || record.verifiedAt) {
        return {
            success: false,
            message: 'No pending verification found. Please request a new code.',
            verified: false,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    if (new Date(record.expiresAt) < new Date()) {
        return {
            success: false,
            message: 'Verification code has expired. Please request a new code.',
            verified: false,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    if (record.attempts >= MAX_ATTEMPTS) {
        return {
            success: false,
            message: 'Too many failed attempts. Please request a new code.',
            verified: false,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    record.attempts += 1;
    if (record.code !== input.code) {
        codes[key] = record;
        await writeStore(CODES_FILE(), codes);
        const remaining = MAX_ATTEMPTS - record.attempts;
        return {
            success: false,
            message: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
            verified: false,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    record.verifiedAt = new Date().toISOString();
    codes[key] = record;
    await writeStore(CODES_FILE(), codes);
    await fallbackMarkVerified(input.userId, input.type);
    // Best-effort: also try updating the Supabase profile (ignored if the
    // columns do not exist yet).
    try {
        const supabase = getSupabaseAdmin();
        const verifiedField = input.type === 'email' ? 'email_verified' : 'phone_verified';
        await supabase
            .from('profiles')
            .update({ [verifiedField]: true, updated_at: record.verifiedAt })
            .eq('id', input.userId);
    }
    catch {
        // non-critical
    }
    return {
        success: true,
        message: `${input.type === 'email' ? 'Email' : 'Phone'} verified successfully`,
        verified: true,
        deploymentMarker: DEPLOYMENT_MARKER,
    };
}
export async function storeVerificationCode(input) {
    const supabase = getSupabaseAdmin();
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);
    try {
        const { error } = await supabase.from('verification_codes').upsert({
            user_id: input.userId,
            type: input.type,
            code,
            attempts: 0,
            expires_at: expiresAt.toISOString(),
            verified_at: null,
            created_at: now.toISOString(),
        }, { onConflict: 'user_id,type' });
        if (error) {
            console.error('[MemberVerification] Supabase code store failed, using fallback store:', error.message);
            await fallbackStoreCode(input, code, expiresAt);
        }
        else {
            console.log(`[MemberVerification] Code stored for ${input.userId} (${input.type})`);
        }
        return {
            success: true,
            message: `Verification code generated`,
            verified: false,
            code,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[MemberVerification] Code store exception, using fallback store:', message);
        try {
            await fallbackStoreCode(input, code, expiresAt);
            return {
                success: true,
                message: `Verification code generated`,
                verified: false,
                code,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
        catch {
            return {
                success: false,
                message: 'Internal error generating verification code',
                verified: false,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
    }
}
export async function verifyCode(input) {
    const supabase = getSupabaseAdmin();
    try {
        const { data, error } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('user_id', input.userId)
            .eq('type', input.type)
            .is('verified_at', null)
            .maybeSingle();
        if (error) {
            console.error('[MemberVerification] Supabase code lookup failed, checking fallback store:', error.message);
            return fallbackVerifyCode(input);
        }
        const record = data;
        if (!record) {
            // The code may live in the fallback store (schema missing at send time).
            return fallbackVerifyCode(input);
        }
        // Check expiry
        if (new Date(record.expires_at) < new Date()) {
            return {
                success: false,
                message: 'Verification code has expired. Please request a new code.',
                verified: false,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
        // Check attempts
        if (record.attempts >= MAX_ATTEMPTS) {
            return {
                success: false,
                message: 'Too many failed attempts. Please request a new code.',
                verified: false,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
        // Increment attempts
        const newAttempts = record.attempts + 1;
        if (record.code !== input.code) {
            await supabase
                .from('verification_codes')
                .update({ attempts: newAttempts })
                .eq('id', record.id);
            const remaining = MAX_ATTEMPTS - newAttempts;
            return {
                success: false,
                message: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
                verified: false,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
        // Code matches — mark verified
        const now = new Date().toISOString();
        await supabase
            .from('verification_codes')
            .update({ verified_at: now, attempts: newAttempts })
            .eq('id', record.id);
        // Update profile verification status
        const verifiedField = input.type === 'email' ? 'email_verified' : 'phone_verified';
        await supabase
            .from('profiles')
            .update({ [verifiedField]: true, updated_at: now })
            .eq('id', input.userId);
        // Log to audit
        try {
            await supabase.from('audit_logs').insert({
                user_id: input.userId,
                action: `verify_${input.type}`,
                details: JSON.stringify({ type: input.type, success: true }),
                created_at: now,
            });
        }
        catch {
            // non-critical
        }
        return {
            success: true,
            message: `${input.type === 'email' ? 'Email' : 'Phone'} verified successfully`,
            verified: true,
            deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[MemberVerification] Code verify exception, checking fallback store:', message);
        try {
            return await fallbackVerifyCode(input);
        }
        catch {
            return {
                success: false,
                message: 'Internal verification error',
                verified: false,
                deploymentMarker: DEPLOYMENT_MARKER,
            };
        }
    }
}
export async function checkVerificationStatus(userId) {
    const supabase = getSupabaseAdmin();
    let fromProfile = null;
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('email_verified, phone_verified')
            .eq('id', userId)
            .maybeSingle();
        if (!error && data) {
            fromProfile = {
                emailVerified: !!data?.email_verified,
                phoneVerified: !!data?.phone_verified,
            };
        }
    }
    catch {
        fromProfile = null;
    }
    // Merge with the fallback status store (schema may be missing columns).
    try {
        const statuses = await readStore(STATUS_FILE(), {});
        const fallback = statuses[userId];
        return {
            emailVerified: (fromProfile?.emailVerified ?? false) || !!fallback?.emailVerified,
            phoneVerified: (fromProfile?.phoneVerified ?? false) || !!fallback?.phoneVerified,
        };
    }
    catch {
        return fromProfile ?? { emailVerified: false, phoneVerified: false };
    }
}
export async function getRemainingCodeAttempts(userId, type) {
    const supabase = getSupabaseAdmin();
    try {
        const { data } = await supabase
            .from('verification_codes')
            .select('attempts, expires_at')
            .eq('user_id', userId)
            .eq('type', type)
            .is('verified_at', null)
            .maybeSingle();
        if (!data) {
            // Check the fallback store before reporting no pending code.
            const codes = await readStore(CODES_FILE(), {});
            const record = codes[codeKey(userId, type)];
            if (record && !record.verifiedAt) {
                return {
                    remaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
                    expiresAt: record.expiresAt,
                };
            }
            return { remaining: 0, expiresAt: null };
        }
        const record = data;
        return {
            remaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
            expiresAt: record.expires_at,
        };
    }
    catch {
        return { remaining: 0, expiresAt: null };
    }
}
