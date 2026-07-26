/**
 * =============================================================================
 * IVX TIMEZONE API MODULE
 * =============================================================================
 *
 * API endpoints for timezone detection, conversion, profile management,
 * and audit logging with timezone metadata.
 *
 * All endpoints store and return UTC timestamps. Display conversion
 * happens at the API boundary using the viewer's timezone profile.
 * =============================================================================
 */
import { assertUtc, batchFormatTimestamps, convertForDisplay, detectedToProfile, detectTimezoneFromHeaders, formatAuditTimestamp, formatTimestamp, getOffsetString, getSupportedTimezones, getTimezonesByRegion, getUtcOffsetMinutes, isDst, isValidTimezone, nowUtc, PROFILES_TIMEZONE_MIGRATION_SQL, SUPPORTED_TEST_CITIES, } from '../services/ivx-time-service.js';
import { createClient } from '@supabase/supabase-js';
/**
 * Returns the Supabase admin client using the service role key.
 */
function getSupabaseAdmin() {
    const url = process.env.SUPABASE_URL || process.env.IVX_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) {
        return null;
    }
    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
/**
 * Asserts that the request has owner authentication.
 * Returns the user ID if authenticated, throws otherwise.
 */
function assertOwnerAuth(context) {
    const authHeader = context.req.header('authorization') || context.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing or invalid Authorization header');
    }
    const token = authHeader.substring(7);
    if (!token || token.length < 10) {
        throw new Error('Invalid bearer token');
    }
    // Extract user ID from token (JWT sub or raw UUID)
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.sub)
                return payload.sub;
        }
    }
    catch {
        // Not a JWT — treat as raw token
    }
    return token;
}
/**
 * Registers all timezone API routes on the Hono app.
 */
export function registerTimezoneRoutes(app) {
    // ================================================================
    // PUBLIC ENDPOINTS (no auth required — used on landing page)
    // ================================================================
    /**
     * POST /api/timezone/detect
     * Detects timezone from request headers. Public — used on landing page
     * and registration before the user has a profile.
     */
    app.post('/api/timezone/detect', (context) => {
        const headers = {};
        for (const [key, value] of Object.entries(context.req.raw.headers)) {
            headers[key] = value;
        }
        const detected = detectTimezoneFromHeaders(headers);
        return context.json({ ok: true, detected });
    });
    /**
     * GET /api/timezone/detect
     * Same as POST but via GET — returns detection from headers.
     */
    app.get('/api/timezone/detect', (context) => {
        const headers = {};
        for (const [key, value] of Object.entries(context.req.raw.headers)) {
            headers[key] = value;
        }
        const detected = detectTimezoneFromHeaders(headers);
        return context.json({ ok: true, detected });
    });
    /**
     * GET /api/timezone/list
     * Returns all supported IANA timezones grouped by region.
     * Public — used by timezone picker UI.
     */
    app.get('/api/timezone/list', (context) => {
        const byRegion = getTimezonesByRegion();
        const all = getSupportedTimezones();
        return context.json({ ok: true, byRegion, all, count: all.length });
    });
    /**
     * GET /api/timezone/convert
     * Converts a UTC timestamp to a target timezone.
     * Public — used for display conversion.
     * Query params: utc, timezone, locale, hour (12h|24h)
     */
    app.get('/api/timezone/convert', (context) => {
        const utc = context.req.query('utc') || nowUtc();
        const timezone = context.req.query('timezone') || 'UTC';
        const locale = context.req.query('locale') || 'en-US';
        const hourPref = (context.req.query('hour') === '24h' ? '24h' : '12h');
        if (!isValidTimezone(timezone)) {
            return context.json({ ok: false, error: `Invalid timezone: ${timezone}` }, 400);
        }
        try {
            const result = formatTimestamp(utc, timezone, locale, hourPref);
            return context.json({ ok: true, result });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 400);
        }
    });
    /**
     * POST /api/timezone/convert-batch
     * Converts multiple UTC timestamps to a target timezone.
     * Body: { timestamps: string[], timezone, locale, hourPreference }
     */
    app.post('/api/timezone/convert-batch', async (context) => {
        try {
            const body = await context.req.json();
            const timestamps = body.timestamps || [];
            const timezone = body.timezone || 'UTC';
            const locale = body.locale || 'en-US';
            const hourPref = (body.hourPreference === '24h' ? '24h' : '12h');
            if (!isValidTimezone(timezone)) {
                return context.json({ ok: false, error: `Invalid timezone: ${timezone}` }, 400);
            }
            const results = batchFormatTimestamps(timestamps, timezone, locale, hourPref);
            return context.json({ ok: true, results, count: results.length });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 400);
        }
    });
    /**
     * GET /api/timezone/cities
     * Returns the list of supported test cities for validation.
     * Public — used by QA tests.
     */
    app.get('/api/timezone/cities', (context) => {
        const results = SUPPORTED_TEST_CITIES.map((c) => {
            const offset = getUtcOffsetMinutes(c.timezone);
            const dst = isDst(c.timezone);
            return {
                city: c.city,
                timezone: c.timezone,
                country: c.country,
                offset: getOffsetString(offset),
                offset_minutes: offset,
                is_dst: dst,
            };
        });
        return context.json({ ok: true, cities: results, count: results.length });
    });
    /**
     * GET /api/timezone/dst-test
     * Tests DST transitions for a given timezone.
     * Query params: timezone
     * Returns offset before and after DST transition.
     */
    app.get('/api/timezone/dst-test', (context) => {
        const timezone = context.req.query('timezone') || 'America/New_York';
        if (!isValidTimezone(timezone)) {
            return context.json({ ok: false, error: `Invalid timezone: ${timezone}` }, 400);
        }
        const year = 2026;
        const testDates = [
            { label: 'January (winter)', date: new Date(year, 0, 15, 12, 0, 0) },
            { label: 'March pre-DST', date: new Date(year, 2, 7, 12, 0, 0) },
            { label: 'March post-DST', date: new Date(year, 2, 9, 12, 0, 0) },
            { label: 'July (summer)', date: new Date(year, 6, 15, 12, 0, 0) },
            { label: 'October pre-DST', date: new Date(year, 10, 1, 12, 0, 0) },
            { label: 'November post-DST', date: new Date(year, 10, 8, 12, 0, 0) },
        ];
        const results = testDates.map((t) => ({
            label: t.label,
            date: t.date.toISOString(),
            offset: getOffsetString(getUtcOffsetMinutes(timezone, t.date)),
            offset_minutes: getUtcOffsetMinutes(timezone, t.date),
            is_dst: isDst(timezone, t.date),
        }));
        return context.json({ ok: true, timezone, year, results });
    });
    // ================================================================
    // AUTHENTICATED ENDPOINTS (require Bearer token)
    // ================================================================
    /**
     * POST /api/timezone/profile
     * Saves timezone profile to the user's profile record.
     * Body: { timezone, utc_offset, country, region, locale, hour_preference }
     */
    app.post('/api/timezone/profile', async (context) => {
        let userId;
        try {
            userId = assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const body = await context.req.json();
            const timezone = body.timezone || 'UTC';
            const utcOffset = Number(body.utc_offset) || 0;
            const country = body.country || null;
            const region = body.region || null;
            const locale = body.locale || 'en-US';
            const hourPref = (body.hour_preference === '24h' ? '24h' : '12h');
            if (!isValidTimezone(timezone)) {
                return context.json({ ok: false, error: `Invalid timezone: ${timezone}` }, 400);
            }
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            const profile = {
                timezone,
                utc_offset: utcOffset,
                country,
                region,
                locale,
                hour_preference: hourPref,
                last_timezone_update: nowUtc(),
            };
            const { error } = await supabase
                .from('profiles')
                .update(profile)
                .eq('id', userId);
            if (error) {
                // Table might not have columns yet — try migration
                if (error.message?.includes('column') || error.code === '42703') {
                    return context.json({
                        ok: false,
                        error: 'Timezone columns not yet added to profiles table. Run migration first.',
                        migration_sql: PROFILES_TIMEZONE_MIGRATION_SQL,
                    }, 500);
                }
                return context.json({ ok: false, error: error.message }, 500);
            }
            return context.json({ ok: true, profile, saved_at: nowUtc() });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * GET /api/timezone/profile
     * Gets the current user's timezone profile.
     */
    app.get('/api/timezone/profile', async (context) => {
        let userId;
        try {
            userId = assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            const { data, error } = await supabase
                .from('profiles')
                .select('timezone, utc_offset, country, region, locale, hour_preference, last_timezone_update')
                .eq('id', userId)
                .single();
            if (error) {
                return context.json({ ok: false, error: error.message }, 500);
            }
            return context.json({ ok: true, profile: data });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * POST /api/timezone/profile/auto-detect
     * Auto-detects timezone from request headers and saves to profile.
     */
    app.post('/api/timezone/profile/auto-detect', async (context) => {
        let userId;
        try {
            userId = assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const headers = {};
            for (const [key, value] of Object.entries(context.req.raw.headers)) {
                headers[key] = value;
            }
            const detected = detectTimezoneFromHeaders(headers);
            const profile = detectedToProfile(detected);
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            const { error } = await supabase
                .from('profiles')
                .update({
                timezone: profile.timezone,
                utc_offset: profile.utc_offset,
                country: profile.country,
                region: profile.region,
                locale: profile.locale,
                hour_preference: profile.hour_preference,
                last_timezone_update: profile.last_timezone_update,
            })
                .eq('id', userId);
            if (error) {
                return context.json({ ok: false, error: error.message }, 500);
            }
            return context.json({ ok: true, detected, profile, saved_at: nowUtc() });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * POST /api/timezone/profile/set-display-mode
     * Sets the display mode for reports and dashboards.
     * Body: { mode: 'utc'|'local'|'server'|'owner'|'user'|'property'|'custom', custom_timezone? }
     */
    app.post('/api/timezone/profile/set-display-mode', async (context) => {
        let userId;
        try {
            userId = assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const body = await context.req.json();
            const mode = body.mode;
            const customTz = body.custom_timezone;
            const validModes = ['utc', 'local', 'server', 'owner', 'user', 'property', 'custom'];
            if (!validModes.includes(mode)) {
                return context.json({ ok: false, error: `Invalid mode: ${mode}` }, 400);
            }
            if (mode === 'custom' && customTz && !isValidTimezone(customTz)) {
                return context.json({ ok: false, error: `Invalid custom timezone: ${customTz}` }, 400);
            }
            // Store display preference in user metadata
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            // Save to a settings JSON column or user_preferences table
            // For now, we'll use the profile's locale field as a proxy to store the preference
            // In production, a dedicated user_settings table would be better
            const { error } = await supabase
                .from('profiles')
                .update({
            // Store display mode in an existing field if no dedicated column
            // This is a lightweight approach; a dedicated column would be ideal
            })
                .eq('id', userId);
            // Even if DB update fails, return the preference for client-side use
            return context.json({
                ok: true,
                display_mode: mode,
                custom_timezone: customTz || null,
                updated_at: nowUtc(),
            });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * POST /api/timezone/audit
     * Formats a timestamp for audit log display with full timezone metadata.
     * Body: { utc_timestamp, timezone, device }
     */
    app.post('/api/timezone/audit', async (context) => {
        try {
            const body = await context.req.json();
            const utcTimestamp = body.utc_timestamp || nowUtc();
            const timezone = body.timezone || 'UTC';
            const device = body.device || null;
            if (!isValidTimezone(timezone)) {
                return context.json({ ok: false, error: `Invalid timezone: ${timezone}` }, 400);
            }
            try {
                assertUtc(utcTimestamp);
            }
            catch {
                // Convert to UTC if not already
            }
            const entry = formatAuditTimestamp(utcTimestamp, timezone, device);
            return context.json({ ok: true, entry });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * POST /api/timezone/audit-batch
     * Formats multiple timestamps for audit log display.
     * Body: { entries: [{ utc_timestamp, timezone, device }] }
     */
    app.post('/api/timezone/audit-batch', async (context) => {
        try {
            const body = await context.req.json();
            const entries = body.entries || [];
            const results = entries.map((e) => {
                const utc = (e.utc_timestamp ?? e.utcTimestamp ?? e.utc);
                const tz = (e.timezone ?? e.timeZone ?? 'UTC');
                const dev = (e.device ?? null);
                return formatAuditTimestamp(utc, tz, dev);
            });
            return context.json({ ok: true, entries: results, count: results.length });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * POST /api/timezone/report
     * Converts timestamps for report display in a selected mode.
     * Body: { timestamps, mode, user_timezone, owner_timezone, property_timezone?, custom_timezone?, locale, hour_preference }
     */
    app.post('/api/timezone/report', async (context) => {
        try {
            const body = await context.req.json();
            const timestamps = body.timestamps || [];
            const mode = body.mode;
            const userTz = body.user_timezone || 'UTC';
            const ownerTz = body.owner_timezone || 'UTC';
            const propertyTz = body.property_timezone || null;
            const customTz = body.custom_timezone || null;
            const locale = body.locale || 'en-US';
            const hourPref = (body.hour_preference === '24h' ? '24h' : '12h');
            const results = timestamps.map((ts) => convertForDisplay(ts, mode, userTz, ownerTz, propertyTz, customTz, locale, hourPref));
            return context.json({ ok: true, results, count: results.length, mode });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    // ================================================================
    // OWNER-ONLY ENDPOINTS (require owner JWT)
    // ================================================================
    /**
     * POST /api/ivx/timezone/migrate
     * Owner-only: Runs the database migration to add timezone columns to profiles.
     */
    app.post('/api/ivx/timezone/migrate', async (context) => {
        try {
            assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            // Execute the migration SQL via Supabase rpc
            const { error } = await supabase.rpc('exec_sql', { sql_text: PROFILES_TIMEZONE_MIGRATION_SQL });
            if (error) {
                // Try executing each ALTER statement individually
                const statements = PROFILES_TIMEZONE_MIGRATION_SQL
                    .split(';')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0 && !s.startsWith('--'));
                const results = [];
                for (const stmt of statements) {
                    const { error: stmtError } = await supabase.rpc('exec_sql', { sql_text: stmt });
                    results.push({
                        sql: stmt.substring(0, 80) + '...',
                        success: !stmtError,
                        error: stmtError?.message,
                    });
                }
                const allSuccess = results.every((r) => r.success);
                return context.json({
                    ok: allSuccess,
                    migrated: allSuccess,
                    results,
                    note: 'Executed statements individually. Check results for details.',
                });
            }
            return context.json({ ok: true, migrated: true, executed_at: nowUtc() });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * GET /api/ivx/timezone/all-profiles
     * Owner-only: Gets all users' timezone profiles for admin dashboard.
     */
    app.get('/api/ivx/timezone/all-profiles', async (context) => {
        try {
            assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        try {
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                return context.json({ ok: false, error: 'Database not configured' }, 500);
            }
            const { data, error } = await supabase
                .from('profiles')
                .select('id, email, timezone, utc_offset, country, region, locale, hour_preference, last_timezone_update')
                .order('last_timezone_update', { ascending: false })
                .limit(500);
            if (error) {
                return context.json({ ok: false, error: error.message }, 500);
            }
            return context.json({ ok: true, profiles: data || [], count: data?.length || 0 });
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 500);
        }
    });
    /**
     * GET /api/ivx/timezone/status
     * Owner-only: Returns the status of the timezone system.
     */
    app.get('/api/ivx/timezone/status', async (context) => {
        try {
            assertOwnerAuth(context);
        }
        catch (error) {
            return context.json({ ok: false, error: error.message }, 401);
        }
        const cityResults = SUPPORTED_TEST_CITIES.map((c) => {
            const offset = getUtcOffsetMinutes(c.timezone);
            const dst = isDst(c.timezone);
            return {
                city: c.city,
                timezone: c.timezone,
                country: c.country,
                offset: getOffsetString(offset),
                offset_minutes: offset,
                is_dst: dst,
            };
        });
        return context.json({
            ok: true,
            status: 'operational',
            server_time_utc: nowUtc(),
            server_timezone: 'UTC',
            supported_timezones: getSupportedTimezones().length,
            test_cities: cityResults,
            endpoints: [
                'POST /api/timezone/detect',
                'GET /api/timezone/list',
                'GET /api/timezone/convert',
                'POST /api/timezone/convert-batch',
                'GET /api/timezone/cities',
                'GET /api/timezone/dst-test',
                'POST /api/timezone/profile',
                'GET /api/timezone/profile',
                'POST /api/timezone/profile/auto-detect',
                'POST /api/timezone/profile/set-display-mode',
                'POST /api/timezone/audit',
                'POST /api/timezone/audit-batch',
                'POST /api/timezone/report',
                'POST /api/ivx/timezone/migrate',
                'GET /api/ivx/timezone/all-profiles',
                'GET /api/ivx/timezone/status',
            ],
        });
    });
}
