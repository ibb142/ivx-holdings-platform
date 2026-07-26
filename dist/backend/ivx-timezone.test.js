/**
 * =============================================================================
 * IVX TIMEZONE TEST SUITE
 * =============================================================================
 *
 * Tests that verify:
 *  - All 8 cities return correct timezone info
 *  - UTC timestamps are properly converted to each timezone
 *  - DST transitions are correctly detected
 *  - Same UTC timestamp shows different local times for different timezones
 *  - Offsets are correctly calculated
 *  - 12h/24h formatting works
 *  - Time service functions handle edge cases
 * =============================================================================
 */
import { describe, test, expect } from 'bun:test';
import { nowUtc, toUtc, assertUtc, getUtcOffsetMinutes, getOffsetString, isDst, formatTimestamp, formatChatTimestamp, formatAuditTimestamp, isValidTimezone, detectTimezoneFromHeaders, convertForDisplay, batchFormatTimestamps, detectedToProfile, getCityTimezone, SUPPORTED_TEST_CITIES, DEFAULT_TIMEZONE, } from './services/ivx-time-service';
// Test timestamp: 2026-07-12T17:00:00.000Z (a summer date — DST active in Northern hemisphere)
const TEST_SUMMER_UTC = '2026-07-12T17:00:00.000Z';
// Test timestamp: 2026-01-15T17:00:00.000Z (a winter date — DST inactive in Northern hemisphere)
const TEST_WINTER_UTC = '2026-01-15T17:00:00.000Z';
describe('IVX Enterprise Time Service', () => {
    // ================================================================
    // UTC OPERATIONS
    // ================================================================
    describe('UTC Operations', () => {
        test('nowUtc() returns a valid UTC ISO 8601 string ending with Z', () => {
            const now = nowUtc();
            expect(now).toBeTruthy();
            expect(now.endsWith('Z')).toBe(true);
            const parsed = new Date(now);
            expect(Number.isNaN(parsed.getTime())).toBe(false);
        });
        test('toUtc() converts timestamp with offset to UTC', () => {
            // 2026-07-12T12:00:00-05:00 = 2026-07-12T17:00:00.000Z
            const result = toUtc('2026-07-12T12:00:00-05:00');
            expect(result).toBe('2026-07-12T17:00:00.000Z');
        });
        test('toUtc() preserves already-UTC timestamps', () => {
            const result = toUtc('2026-07-12T17:00:00.000Z');
            expect(result).toBe('2026-07-12T17:00:00.000Z');
        });
        test('assertUtc() throws for non-UTC timestamps', () => {
            expect(() => assertUtc('2026-07-12T12:00:00-05:00')).toThrow();
            expect(() => assertUtc('2026-07-12T17:00:00.000Z')).not.toThrow();
            expect(() => assertUtc('2026-07-12T17:00:00+00:00')).not.toThrow();
        });
        test('toUtc() throws for invalid timestamps', () => {
            expect(() => toUtc('invalid-date')).toThrow();
        });
    });
    // ================================================================
    // 8 CITIES VALIDATION
    // ================================================================
    describe('8 Cities Validation', () => {
        test('All 8 test cities are defined', () => {
            expect(SUPPORTED_TEST_CITIES.length).toBe(8);
            const cities = SUPPORTED_TEST_CITIES.map(c => c.city);
            expect(cities).toContain('New York');
            expect(cities).toContain('Miami');
            expect(cities).toContain('California');
            expect(cities).toContain('London');
            expect(cities).toContain('Madrid');
            expect(cities).toContain('Dubai');
            expect(cities).toContain('Tokyo');
            expect(cities).toContain('Sydney');
        });
        test('New York: UTC-4 in summer (DST)', () => {
            const offset = getUtcOffsetMinutes('America/New_York', new Date(TEST_SUMMER_UTC));
            expect(offset).toBe(-240); // UTC-4 (EDT)
        });
        test('New York: UTC-5 in winter (no DST)', () => {
            const offset = getUtcOffsetMinutes('America/New_York', new Date(TEST_WINTER_UTC));
            expect(offset).toBe(-300); // UTC-5 (EST)
        });
        test('Miami: same as New York (Eastern Time)', () => {
            const miamiOffset = getUtcOffsetMinutes('America/New_York', new Date(TEST_SUMMER_UTC));
            const nyOffset = getUtcOffsetMinutes('America/New_York', new Date(TEST_SUMMER_UTC));
            expect(miamiOffset).toBe(nyOffset);
        });
        test('California: UTC-7 in summer (DST)', () => {
            const offset = getUtcOffsetMinutes('America/Los_Angeles', new Date(TEST_SUMMER_UTC));
            expect(offset).toBe(-420); // UTC-7 (PDT)
        });
        test('California: UTC-8 in winter (no DST)', () => {
            const offset = getUtcOffsetMinutes('America/Los_Angeles', new Date(TEST_WINTER_UTC));
            expect(offset).toBe(-480); // UTC-8 (PST)
        });
        test('London: UTC+1 in summer (BST)', () => {
            const offset = getUtcOffsetMinutes('Europe/London', new Date(TEST_SUMMER_UTC));
            expect(offset).toBe(60); // UTC+1 (BST)
        });
        test('London: UTC+0 in winter (GMT)', () => {
            const offset = getUtcOffsetMinutes('Europe/London', new Date(TEST_WINTER_UTC));
            expect(offset).toBe(0); // UTC+0 (GMT)
        });
        test('Madrid: UTC+2 in summer (CEST)', () => {
            const offset = getUtcOffsetMinutes('Europe/Madrid', new Date(TEST_SUMMER_UTC));
            expect(offset).toBe(120); // UTC+2 (CEST)
        });
        test('Madrid: UTC+1 in winter (CET)', () => {
            const offset = getUtcOffsetMinutes('Europe/Madrid', new Date(TEST_WINTER_UTC));
            expect(offset).toBe(60); // UTC+1 (CET)
        });
        test('Dubai: UTC+4 (no DST ever)', () => {
            const summerOffset = getUtcOffsetMinutes('Asia/Dubai', new Date(TEST_SUMMER_UTC));
            const winterOffset = getUtcOffsetMinutes('Asia/Dubai', new Date(TEST_WINTER_UTC));
            expect(summerOffset).toBe(240); // UTC+4
            expect(winterOffset).toBe(240); // UTC+4 — no DST
            expect(summerOffset).toBe(winterOffset);
        });
        test('Tokyo: UTC+9 (no DST ever)', () => {
            const summerOffset = getUtcOffsetMinutes('Asia/Tokyo', new Date(TEST_SUMMER_UTC));
            const winterOffset = getUtcOffsetMinutes('Asia/Tokyo', new Date(TEST_WINTER_UTC));
            expect(summerOffset).toBe(540); // UTC+9
            expect(winterOffset).toBe(540); // UTC+9 — no DST
            expect(summerOffset).toBe(winterOffset);
        });
        test('Sydney: UTC+10 in winter (Southern hemisphere)', () => {
            // July is winter in Sydney — no DST
            const offset = getUtcOffsetMinutes('Australia/Sydney', new Date(TEST_SUMMER_UTC));
            expect(offset).toBe(600); // UTC+10 (AEST)
        });
        test('Sydney: UTC+11 in summer (Southern hemisphere DST)', () => {
            // January is summer in Sydney — DST active
            const offset = getUtcOffsetMinutes('Australia/Sydney', new Date(TEST_WINTER_UTC));
            expect(offset).toBe(660); // UTC+11 (AEDT)
        });
    });
    // ================================================================
    // DST TRANSITIONS
    // ================================================================
    describe('DST Transitions', () => {
        test('New York DST is active in summer', () => {
            expect(isDst('America/New_York', new Date(TEST_SUMMER_UTC))).toBe(true);
        });
        test('New York DST is inactive in winter', () => {
            expect(isDst('America/New_York', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('California DST is active in summer', () => {
            expect(isDst('America/Los_Angeles', new Date(TEST_SUMMER_UTC))).toBe(true);
        });
        test('California DST is inactive in winter', () => {
            expect(isDst('America/Los_Angeles', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('London DST (BST) is active in summer', () => {
            expect(isDst('Europe/London', new Date(TEST_SUMMER_UTC))).toBe(true);
        });
        test('London DST (BST) is inactive in winter', () => {
            expect(isDst('Europe/London', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('Madrid DST (CEST) is active in summer', () => {
            expect(isDst('Europe/Madrid', new Date(TEST_SUMMER_UTC))).toBe(true);
        });
        test('Madrid DST (CET) is inactive in winter', () => {
            expect(isDst('Europe/Madrid', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('Dubai never has DST', () => {
            expect(isDst('Asia/Dubai', new Date(TEST_SUMMER_UTC))).toBe(false);
            expect(isDst('Asia/Dubai', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('Tokyo never has DST', () => {
            expect(isDst('Asia/Tokyo', new Date(TEST_SUMMER_UTC))).toBe(false);
            expect(isDst('Asia/Tokyo', new Date(TEST_WINTER_UTC))).toBe(false);
        });
        test('Sydney DST is inactive in July (winter)', () => {
            expect(isDst('Australia/Sydney', new Date(TEST_SUMMER_UTC))).toBe(false);
        });
        test('Sydney DST is active in January (summer)', () => {
            expect(isDst('Australia/Sydney', new Date(TEST_WINTER_UTC))).toBe(true);
        });
        test('DST transition: New York March 2026', () => {
            // US DST starts March 8, 2026 at 2:00 AM
            const beforeDst = new Date('2026-03-07T12:00:00.000Z'); // March 7 — no DST
            const afterDst = new Date('2026-03-09T12:00:00.000Z'); // March 9 — DST active
            expect(isDst('America/New_York', beforeDst)).toBe(false);
            expect(isDst('America/New_York', afterDst)).toBe(true);
            const offsetBefore = getUtcOffsetMinutes('America/New_York', beforeDst);
            const offsetAfter = getUtcOffsetMinutes('America/New_York', afterDst);
            expect(offsetBefore).toBe(-300); // EST
            expect(offsetAfter).toBe(-240); // EDT
        });
        test('DST transition: New York November 2026', () => {
            // US DST ends November 1, 2026 at 2:00 AM
            const beforeEnd = new Date('2026-10-31T12:00:00.000Z'); // Oct 31 — DST
            const afterEnd = new Date('2026-11-02T12:00:00.000Z'); // Nov 2 — no DST
            expect(isDst('America/New_York', beforeEnd)).toBe(true);
            expect(isDst('America/New_York', afterEnd)).toBe(false);
        });
        test('DST transition: London March 2026', () => {
            // EU DST starts March 29, 2026 at 1:00 AM UTC
            const beforeDst = new Date('2026-03-28T12:00:00.000Z'); // March 28 — no DST
            const afterDst = new Date('2026-03-30T12:00:00.000Z'); // March 30 — DST
            expect(isDst('Europe/London', beforeDst)).toBe(false);
            expect(isDst('Europe/London', afterDst)).toBe(true);
        });
        test('DST transition: Sydney October 2026 (Southern hemisphere)', () => {
            // Sydney DST starts first Sunday of October
            const beforeDst = new Date('2026-10-03T12:00:00.000Z'); // Oct 3 — no DST
            const afterDst = new Date('2026-10-05T12:00:00.000Z'); // Oct 5 — DST
            expect(isDst('Australia/Sydney', beforeDst)).toBe(false);
            expect(isDst('Australia/Sydney', afterDst)).toBe(true);
        });
    });
    // ================================================================
    // SAME UTC → DIFFERENT LOCAL TIMES
    // ================================================================
    describe('Same UTC timestamp → different local times', () => {
        test('Investor in California vs Owner in Florida see different times', () => {
            // Same UTC timestamp: 2026-07-12T17:00:00.000Z
            // California (PDT, UTC-7): 10:00 AM
            // Florida (EDT, UTC-4): 1:00 PM
            const californiaResult = formatTimestamp(TEST_SUMMER_UTC, 'America/Los_Angeles', 'en-US', '12h');
            const floridaResult = formatTimestamp(TEST_SUMMER_UTC, 'America/New_York', 'en-US', '12h');
            expect(californiaResult.utc).toBe(floridaResult.utc);
            expect(californiaResult.formatted_time).not.toBe(floridaResult.formatted_time);
            expect(californiaResult.offset).toBe('-07:00');
            expect(floridaResult.offset).toBe('-04:00');
            console.log('[Timezone Test] California:', californiaResult.formatted_time, 'Florida:', floridaResult.formatted_time);
        });
        test('London and Madrid have 1-hour difference in summer', () => {
            const londonResult = formatTimestamp(TEST_SUMMER_UTC, 'Europe/London', 'en-US', '12h');
            const madridResult = formatTimestamp(TEST_SUMMER_UTC, 'Europe/Madrid', 'es-ES', '24h');
            expect(londonResult.offset_minutes).toBe(60);
            expect(madridResult.offset_minutes).toBe(120);
            expect(madridResult.offset_minutes - londonResult.offset_minutes).toBe(60);
        });
        test('Dubai and Tokyo have 5-hour difference', () => {
            const dubaiResult = formatTimestamp(TEST_SUMMER_UTC, 'Asia/Dubai', 'en-US', '12h');
            const tokyoResult = formatTimestamp(TEST_SUMMER_UTC, 'Asia/Tokyo', 'ja-JP', '24h');
            expect(dubaiResult.offset_minutes).toBe(240);
            expect(tokyoResult.offset_minutes).toBe(540);
            expect(tokyoResult.offset_minutes - dubaiResult.offset_minutes).toBe(300);
        });
        test('All 8 cities return the same UTC timestamp', () => {
            const results = SUPPORTED_TEST_CITIES.map((c) => formatTimestamp(TEST_SUMMER_UTC, c.timezone, 'en-US', '12h'));
            const utcValues = results.map((r) => r.utc);
            const allSame = utcValues.every((v) => v === utcValues[0]);
            expect(allSame).toBe(true);
        });
    });
    // ================================================================
    // OFFSET FORMATTING
    // ================================================================
    describe('Offset Formatting', () => {
        test('getOffsetString formats positive offset correctly', () => {
            expect(getOffsetString(330)).toBe('+05:30'); // India
            expect(getOffsetString(540)).toBe('+09:00'); // Japan
            expect(getOffsetString(0)).toBe('+00:00'); // UTC
        });
        test('getOffsetString formats negative offset correctly', () => {
            expect(getOffsetString(-300)).toBe('-05:00'); // EST
            expect(getOffsetString(-240)).toBe('-04:00'); // EDT
            expect(getOffsetString(-420)).toBe('-07:00'); // PDT
        });
        test('getOffsetString formats half-hour offsets', () => {
            expect(getOffsetString(330)).toBe('+05:30'); // India
            expect(getOffsetString(-210)).toBe('-03:30'); // Newfoundland
        });
    });
    // ================================================================
    // FORMAT TIMESTAMP
    // ================================================================
    describe('Format Timestamp', () => {
        test('formatTimestamp returns all required fields', () => {
            const result = formatTimestamp(TEST_SUMMER_UTC, 'America/New_York', 'en-US', '12h');
            expect(result.utc).toBeTruthy();
            expect(result.local).toBeTruthy();
            expect(result.timezone).toBe('America/New_York');
            expect(result.offset).toBeTruthy();
            expect(result.offset_minutes).toBeDefined();
            expect(result.is_dst).toBeDefined();
            expect(result.formatted_date).toBeTruthy();
            expect(result.formatted_time).toBeTruthy();
            expect(result.formatted_full).toBeTruthy();
        });
        test('formatTimestamp throws for invalid timestamp', () => {
            expect(() => formatTimestamp('invalid', 'America/New_York')).toThrow();
        });
        test('formatChatTimestamp returns short time', () => {
            const result = formatChatTimestamp(TEST_SUMMER_UTC, 'America/New_York', '12h');
            expect(result).toBeTruthy();
            expect(result.length).toBeLessThan(20);
        });
        test('formatAuditTimestamp returns audit entry', () => {
            const result = formatAuditTimestamp(TEST_SUMMER_UTC, 'America/New_York', 'iOS-18.0');
            expect(result.utc).toBeTruthy();
            expect(result.local_time).toBeTruthy();
            expect(result.timezone).toBe('America/New_York');
            expect(result.offset).toBeTruthy();
            expect(result.device).toBe('iOS-18.0');
        });
    });
    // ================================================================
    // VALIDATION
    // ================================================================
    describe('Timezone Validation', () => {
        test('isValidTimezone returns true for valid timezones', () => {
            expect(isValidTimezone('America/New_York')).toBe(true);
            expect(isValidTimezone('Europe/London')).toBe(true);
            expect(isValidTimezone('Asia/Tokyo')).toBe(true);
            expect(isValidTimezone('UTC')).toBe(true);
        });
        test('isValidTimezone returns false for invalid timezones', () => {
            expect(isValidTimezone('Invalid/Timezone')).toBe(false);
            expect(isValidTimezone('')).toBe(false);
            expect(isValidTimezone('Foo')).toBe(false);
        });
    });
    // ================================================================
    // HEADER DETECTION
    // ================================================================
    describe('Header Detection', () => {
        test('detectTimezoneFromHeaders extracts timezone from X-Timezone header', () => {
            const detected = detectTimezoneFromHeaders({
                'x-timezone': 'America/New_York',
                'x-utc-offset': '-240',
                'x-country': 'US',
                'accept-language': 'en-US,en;q=0.9',
            });
            expect(detected.timezone).toBe('America/New_York');
            expect(detected.utc_offset).toBe(-240);
            expect(detected.country).toBe('US');
            expect(detected.locale).toBe('en-US');
            expect(detected.source).toBe('header');
        });
        test('detectTimezoneFromHeaders falls back to default when no headers', () => {
            const detected = detectTimezoneFromHeaders({});
            expect(detected.timezone).toBe(DEFAULT_TIMEZONE);
            expect(detected.source).toBe('default');
        });
        test('detectTimezoneFromHeaders ignores invalid timezone', () => {
            const detected = detectTimezoneFromHeaders({
                'x-timezone': 'Invalid/Zone',
            });
            expect(detected.timezone).toBe(DEFAULT_TIMEZONE);
            expect(detected.source).toBe('default');
        });
    });
    // ================================================================
    // DISPLAY MODE CONVERSION
    // ================================================================
    describe('Display Mode Conversion', () => {
        test('UTC mode returns UTC timezone', () => {
            const result = convertForDisplay(TEST_SUMMER_UTC, 'utc', 'America/New_York', 'America/New_York');
            expect(result.timezone).toBe('UTC');
            expect(result.offset).toBe('+00:00');
        });
        test('Local/User mode uses user timezone', () => {
            const result = convertForDisplay(TEST_SUMMER_UTC, 'user', 'America/Los_Angeles', 'America/New_York');
            expect(result.timezone).toBe('America/Los_Angeles');
            expect(result.offset).toBe('-07:00');
        });
        test('Owner mode uses owner timezone', () => {
            const result = convertForDisplay(TEST_SUMMER_UTC, 'owner', 'America/Los_Angeles', 'America/New_York');
            expect(result.timezone).toBe('America/New_York');
            expect(result.offset).toBe('-04:00');
        });
        test('Custom mode uses custom timezone', () => {
            const result = convertForDisplay(TEST_SUMMER_UTC, 'custom', 'America/Los_Angeles', 'America/New_York', null, 'Asia/Tokyo');
            expect(result.timezone).toBe('Asia/Tokyo');
            expect(result.offset).toBe('+09:00');
        });
        test('Server mode is same as UTC', () => {
            const result = convertForDisplay(TEST_SUMMER_UTC, 'server', 'America/New_York');
            expect(result.timezone).toBe('UTC');
        });
    });
    // ================================================================
    // BATCH FORMATTING
    // ================================================================
    describe('Batch Formatting', () => {
        test('batchFormatTimestamps converts multiple timestamps', () => {
            const timestamps = [
                '2026-07-12T17:00:00.000Z',
                '2026-07-12T18:00:00.000Z',
                '2026-07-12T19:00:00.000Z',
            ];
            const results = batchFormatTimestamps(timestamps, 'America/New_York', 'en-US', '12h');
            expect(results.length).toBe(3);
            expect(results[0].timezone).toBe('America/New_York');
            expect(results[1].timezone).toBe('America/New_York');
            expect(results[2].timezone).toBe('America/New_York');
        });
    });
    // ================================================================
    // CITY LOOKUP
    // ================================================================
    describe('City Lookup', () => {
        test('getCityTimezone returns timezone for known city', () => {
            expect(getCityTimezone('New York')).toBe('America/New_York');
            expect(getCityTimezone('London')).toBe('Europe/London');
            expect(getCityTimezone('Tokyo')).toBe('Asia/Tokyo');
        });
        test('getCityTimezone returns null for unknown city', () => {
            expect(getCityTimezone('Unknown City')).toBeNull();
        });
        test('getCityTimezone is case-insensitive', () => {
            expect(getCityTimezone('new york')).toBe('America/New_York');
            expect(getCityTimezone('TOKYO')).toBe('Asia/Tokyo');
        });
    });
    // ================================================================
    // DETECTED → PROFILE CONVERSION
    // ================================================================
    describe('Detected to Profile', () => {
        test('detectedToProfile converts detected to profile format', () => {
            const detected = detectTimezoneFromHeaders({
                'x-timezone': 'America/New_York',
                'x-utc-offset': '-240',
                'x-country': 'US',
                'accept-language': 'en-US',
            });
            const profile = detectedToProfile(detected);
            expect(profile.timezone).toBe('America/New_York');
            expect(profile.utc_offset).toBe(-240);
            expect(profile.country).toBe('US');
            expect(profile.last_timezone_update).toBeTruthy();
        });
    });
    // ================================================================
    // COMPREHENSIVE: All cities summer vs winter
    // ================================================================
    describe('Comprehensive: All cities summer vs winter', () => {
        SUPPORTED_TEST_CITIES.forEach((city) => {
            test(`${city.city} (${city.timezone}) — summer and winter offsets differ correctly`, () => {
                const summerOffset = getUtcOffsetMinutes(city.timezone, new Date(TEST_SUMMER_UTC));
                const winterOffset = getUtcOffsetMinutes(city.timezone, new Date(TEST_WINTER_UTC));
                // Cities that don't observe DST should have same offset
                if (city.city === 'Dubai' || city.city === 'Tokyo') {
                    expect(summerOffset).toBe(winterOffset);
                }
                else {
                    // Cities that observe DST should have different offsets (except Miami = NY which is same)
                    // Sydney is Southern hemisphere so summer/winter is reversed
                    if (city.city !== 'Miami') {
                        // For Northern hemisphere, summer offset should be greater (less negative or more positive)
                        // For Southern hemisphere, winter (January) should be greater
                        if (city.city === 'Sydney') {
                            expect(winterOffset).toBeGreaterThan(summerOffset); // Jan is summer in Sydney
                        }
                        else {
                            expect(summerOffset).toBeGreaterThan(winterOffset); // July is summer in Northern
                        }
                    }
                }
                // Both should be valid offsets
                expect(Number.isFinite(summerOffset)).toBe(true);
                expect(Number.isFinite(winterOffset)).toBe(true);
            });
        });
    });
});
