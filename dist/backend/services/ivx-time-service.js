/**
 * =============================================================================
 * IVX ENTERPRISE TIME SERVICE
 * =============================================================================
 *
 * Single source of truth for all timestamp operations across IVX Holdings.
 *
 * PRINCIPLES:
 *  - Store ALL timestamps in UTC (ISO 8601 with 'Z' suffix)
 *  - Never store local device times in the database
 *  - Convert UTC → local timezone only when displaying data
 *  - Automatically support Daylight Saving Time via IANA timezone database
 *
 * Used by: backend API routes, services, chat, transactions, audit logs,
 * reports, analytics, landing page events.
 * =============================================================================
 */
/** List of supported cities for testing and validation. */
export const SUPPORTED_TEST_CITIES = [
    { city: 'New York', timezone: 'America/New_York', country: 'US' },
    { city: 'Miami', timezone: 'America/New_York', country: 'US' },
    { city: 'California', timezone: 'America/Los_Angeles', country: 'US' },
    { city: 'London', timezone: 'Europe/London', country: 'GB' },
    { city: 'Madrid', timezone: 'Europe/Madrid', country: 'ES' },
    { city: 'Dubai', timezone: 'Asia/Dubai', country: 'AE' },
    { city: 'Tokyo', timezone: 'Asia/Tokyo', country: 'JP' },
    { city: 'Sydney', timezone: 'Australia/Sydney', country: 'AU' },
];
/** Default timezone when detection fails. */
export const DEFAULT_TIMEZONE = 'UTC';
/** Default locale. */
export const DEFAULT_LOCALE = 'en-US';
/**
 * Returns the current UTC timestamp as an ISO 8601 string.
 * This is the ONLY function that should be used when storing timestamps.
 */
export function nowUtc() {
    return new Date().toISOString();
}
/**
 * Validates that a timestamp string is in UTC (ends with 'Z' or '+00:00').
 * Throws if the timestamp is not UTC.
 */
export function assertUtc(timestamp) {
    if (!timestamp.endsWith('Z') && !timestamp.endsWith('+00:00')) {
        throw new Error(`Timestamp is not UTC: ${timestamp}`);
    }
}
/**
 * Converts any ISO 8601 timestamp to UTC.
 * If the timestamp already has an offset, it is converted.
 * If no offset is present, it is assumed to already be UTC.
 */
export function toUtc(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid timestamp: ${timestamp}`);
    }
    return date.toISOString();
}
/**
 * Returns the UTC offset in minutes for a given IANA timezone at a specific date.
 * Uses Intl.DateTimeFormat for DST-aware calculation.
 */
export function getUtcOffsetMinutes(timezone, date = new Date()) {
    try {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset',
        });
        const parts = dtf.formatToParts(date);
        const offsetPart = parts.find((p) => p.type === 'timeZoneName');
        if (offsetPart) {
            const match = offsetPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
            if (match) {
                const sign = match[1] === '+' ? 1 : -1;
                const hours = parseInt(match[2], 10);
                const minutes = parseInt(match[3] || '0', 10);
                return sign * (hours * 60 + minutes);
            }
            // Handle "GMT" with no offset (UTC)
            if (offsetPart.value === 'GMT' || offsetPart.value === 'UTC') {
                return 0;
            }
        }
    }
    catch {
        // Fall through to longOffset
    }
    // Fallback: use longOffset
    try {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'longOffset',
        });
        const parts = dtf.formatToParts(date);
        const offsetPart = parts.find((p) => p.type === 'timeZoneName');
        if (offsetPart) {
            const match = offsetPart.value.match(/UTC([+-])(\d{1,2}):?(\d{2})?/);
            if (match) {
                const sign = match[1] === '+' ? 1 : -1;
                const hours = parseInt(match[2], 10);
                const minutes = parseInt(match[3] || '0', 10);
                return sign * (hours * 60 + minutes);
            }
        }
    }
    catch {
        // Fall through
    }
    return 0;
}
/**
 * Returns a human-readable offset string like "+05:30" or "-04:00".
 */
export function getOffsetString(offsetMinutes) {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
/**
 * Checks if Daylight Saving Time is in effect for a given timezone at a specific date.
 */
export function isDst(timezone, date = new Date()) {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const janOffset = getUtcOffsetMinutes(timezone, jan);
    const julOffset = getUtcOffsetMinutes(timezone, jul);
    const currentOffset = getUtcOffsetMinutes(timezone, date);
    // If offsets differ between Jan and Jul, the zone observes DST.
    // If current offset matches the smaller (more negative or less positive) one, DST is active in summer.
    if (janOffset === julOffset)
        return false;
    // Northern hemisphere: DST when offset is the summer (Jul) offset
    // Southern hemisphere: DST when offset is the summer (Jan) offset
    return currentOffset !== Math.min(janOffset, julOffset) || currentOffset === Math.max(janOffset, julOffset) && currentOffset !== janOffset;
}
/**
 * Formats a UTC timestamp into a specific timezone for display.
 *
 * @param utcTimestamp - ISO 8601 UTC timestamp string
 * @param timezone - IANA timezone identifier
 * @param locale - BCP 47 locale string (e.g., "en-US", "es-ES")
 * @param hourPreference - 12h or 24h clock
 * @param device - Optional device identifier for audit logs
 * @returns FormattedTimestamp with UTC, local, offset, DST flag
 */
export function formatTimestamp(utcTimestamp, timezone = DEFAULT_TIMEZONE, locale = DEFAULT_LOCALE, hourPreference = '12h', device = null) {
    const date = new Date(utcTimestamp);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid UTC timestamp: ${utcTimestamp}`);
    }
    const offsetMinutes = getUtcOffsetMinutes(timezone, date);
    const offsetStr = getOffsetString(offsetMinutes);
    const dst = isDst(timezone, date);
    const hour12 = hourPreference === '12h';
    const dateFmt = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    const timeFmt = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12,
    });
    const fullFmt = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12,
        timeZoneName: 'short',
    });
    const formattedDate = dateFmt.format(date);
    const formattedTime = timeFmt.format(date);
    const formattedFull = fullFmt.format(date);
    return {
        utc: date.toISOString(),
        local: formattedFull,
        timezone,
        offset: offsetStr,
        offset_minutes: offsetMinutes,
        is_dst: dst,
        device,
        formatted_date: formattedDate,
        formatted_time: formattedTime,
        formatted_full: formattedFull,
    };
}
/**
 * Formats a timestamp for chat display (short time only, e.g., "9:00 AM").
 */
export function formatChatTimestamp(utcTimestamp, timezone = DEFAULT_TIMEZONE, hourPreference = '12h') {
    const result = formatTimestamp(utcTimestamp, timezone, DEFAULT_LOCALE, hourPreference);
    return result.formatted_time;
}
/**
 * Formats a timestamp for audit log display with full timezone metadata.
 */
export function formatAuditTimestamp(utcTimestamp, timezone = DEFAULT_TIMEZONE, device = null) {
    const result = formatTimestamp(utcTimestamp, timezone);
    return {
        utc: result.utc,
        local_time: result.formatted_full,
        timezone: result.timezone,
        offset: result.offset,
        device,
    };
}
/**
 * Detects timezone from HTTP request headers.
 * Looks at: X-Timezone, X-UTC-Offset, X-Country, Accept-Language, X-Device-Id
 */
export function detectTimezoneFromHeaders(headers) {
    const getHeader = (key) => {
        const val = headers[key] || headers[key.toLowerCase()];
        if (!val)
            return null;
        return Array.isArray(val) ? val[0] : val;
    };
    const tz = getHeader('X-Timezone') || getHeader('x-timezone');
    const offsetStr = getHeader('X-UTC-Offset') || getHeader('x-utc-offset');
    const country = getHeader('X-Country') || getHeader('x-country');
    const region = getHeader('X-Region') || getHeader('x-region');
    const locale = getHeader('Accept-Language')?.split(',')[0]?.split(';')[0] || DEFAULT_LOCALE;
    const hourPref = getHeader('X-Hour-Preference') || getHeader('x-hour-preference');
    let timezone = DEFAULT_TIMEZONE;
    let source = 'default';
    if (tz && isValidTimezone(tz)) {
        timezone = tz;
        source = 'header';
    }
    let utcOffset = 0;
    if (offsetStr) {
        const parsed = parseInt(offsetStr, 10);
        if (!Number.isNaN(parsed)) {
            utcOffset = parsed;
        }
    }
    if (source === 'default') {
        utcOffset = getUtcOffsetMinutes(timezone);
    }
    else if (utcOffset === 0 && source === 'header') {
        utcOffset = getUtcOffsetMinutes(timezone);
    }
    const hourPreference = hourPref === '24h' ? '24h' : '12h';
    return {
        timezone,
        utc_offset: utcOffset,
        country: country || null,
        region: region || null,
        locale,
        hour_preference: hourPreference,
        source,
        detected_at: nowUtc(),
    };
}
/**
 * Validates that a string is a valid IANA timezone.
 */
export function isValidTimezone(tz) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Returns a list of all supported IANA timezones.
 * Uses Intl.supportedValuesOf if available, otherwise falls back to a curated list.
 */
export function getSupportedTimezones() {
    try {
        const supported = Intl.supportedValuesOf?.('timeZone');
        if (Array.isArray(supported) && supported.length > 0) {
            return supported;
        }
    }
    catch {
        // Fall through
    }
    // Curated fallback list of common timezones
    return [
        'UTC',
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Anchorage', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
        'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin', 'Europe/Moscow',
        'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore',
        'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    ];
}
/**
 * Returns a list of common timezones grouped by region for UI selectors.
 */
export function getTimezonesByRegion() {
    return {
        'Universal': ['UTC'],
        'North America': [
            'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
            'America/Anchorage', 'America/Toronto', 'America/Mexico_City',
        ],
        'South America': [
            'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima',
        ],
        'Europe': [
            'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin',
            'Europe/Moscow', 'Europe/Athens', 'Europe/Amsterdam',
        ],
        'Middle East & Africa': [
            'Asia/Dubai', 'Asia/Jerusalem', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
        ],
        'Asia': [
            'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore',
            'Asia/Hong_Kong', 'Asia/Seoul', 'Asia/Bangkok',
        ],
        'Oceania': [
            'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Pacific/Honolulu',
        ],
    };
}
/**
 * Converts a UTC timestamp to a specific display mode.
 * Used by reports and dashboards.
 */
export function convertForDisplay(utcTimestamp, mode, userTimezone = DEFAULT_TIMEZONE, ownerTimezone = DEFAULT_TIMEZONE, propertyTimezone = null, customTimezone = null, locale = DEFAULT_LOCALE, hourPreference = '12h') {
    let targetTimezone;
    switch (mode) {
        case 'utc':
        case 'server':
            targetTimezone = 'UTC';
            break;
        case 'local':
        case 'user':
            targetTimezone = userTimezone;
            break;
        case 'owner':
            targetTimezone = ownerTimezone;
            break;
        case 'property':
            targetTimezone = propertyTimezone || DEFAULT_TIMEZONE;
            break;
        case 'custom':
            targetTimezone = customTimezone || DEFAULT_TIMEZONE;
            break;
        default:
            targetTimezone = userTimezone;
    }
    return formatTimestamp(utcTimestamp, targetTimezone, locale, hourPreference);
}
/**
 * Batch formats multiple UTC timestamps for the same timezone.
 * More efficient than calling formatTimestamp individually.
 */
export function batchFormatTimestamps(utcTimestamps, timezone = DEFAULT_TIMEZONE, locale = DEFAULT_LOCALE, hourPreference = '12h') {
    return utcTimestamps.map((ts) => formatTimestamp(ts, timezone, locale, hourPreference));
}
/**
 * Returns the IANA timezone for a test city.
 */
export function getCityTimezone(city) {
    const entry = SUPPORTED_TEST_CITIES.find((c) => c.city.toLowerCase() === city.toLowerCase());
    return entry ? entry.timezone : null;
}
/**
 * Creates a TimezoneProfile from a DetectedTimezone.
 */
export function detectedToProfile(detected) {
    return {
        timezone: detected.timezone,
        utc_offset: detected.utc_offset,
        country: detected.country,
        region: detected.region,
        locale: detected.locale,
        hour_preference: detected.hour_preference,
        last_timezone_update: nowUtc(),
    };
}
/**
 * SQL fragment for adding timezone columns to the profiles table.
 * Used by the database migration endpoint.
 */
export const PROFILES_TIMEZONE_MIGRATION_SQL = `
-- IVX Enterprise Time Zone System: Add timezone fields to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS utc_offset INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS hour_preference TEXT DEFAULT '12h',
  ADD COLUMN IF NOT EXISTS last_timezone_update TIMESTAMPTZ DEFAULT now();

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.timezone IS 'IANA timezone identifier (e.g., America/New_York)';
COMMENT ON COLUMN public.profiles.utc_offset IS 'UTC offset in minutes (e.g., -300 for UTC-5)';
COMMENT ON COLUMN public.profiles.last_timezone_update IS 'Last time timezone was auto-detected (UTC ISO 8601)';
`;
