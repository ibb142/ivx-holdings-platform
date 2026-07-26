import { afterEach, describe, expect, it } from 'bun:test';
import { PRODUCTION_SUPABASE_ANON_KEY, PRODUCTION_SUPABASE_URL, resolveSupabaseAnonKey, resolveSupabaseUrl, } from '../expo/lib/supabase-env';
const OTHER_PROJECT_URL = 'https://biikwnqdhsdzyxecekht.supabase.co';
const PRODUCTION_PROJECT_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
// Fake anon JWT for a different project. The guard only decodes the payload,
// so the signature can be a dummy string.
const OTHER_PROJECT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaWt3bnFkaHNkenl4ZWNla2h0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.' +
    'dummy-signature';
describe('Supabase env guard — rejects wrong project in production build', () => {
    const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    afterEach(() => {
        process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    });
    it('falls back to production URL when env points to a different project', () => {
        process.env.EXPO_PUBLIC_SUPABASE_URL = OTHER_PROJECT_URL;
        expect(resolveSupabaseUrl()).toBe(PRODUCTION_SUPABASE_URL);
    });
    it('falls back to production anon key when env belongs to a different project', () => {
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = OTHER_PROJECT_ANON_KEY;
        expect(resolveSupabaseAnonKey()).toBe(PRODUCTION_SUPABASE_ANON_KEY);
    });
    it('accepts env values that match the production project', () => {
        process.env.EXPO_PUBLIC_SUPABASE_URL = PRODUCTION_PROJECT_URL;
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = PRODUCTION_SUPABASE_ANON_KEY;
        expect(resolveSupabaseUrl()).toBe(PRODUCTION_PROJECT_URL);
        expect(resolveSupabaseAnonKey()).toBe(PRODUCTION_SUPABASE_ANON_KEY);
    });
    it('falls back for a non-JWT anon key (placeholder string)', () => {
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_sh2PJsWH4bKXFzQFMzOzaQ_SJgwaCjV';
        expect(resolveSupabaseAnonKey()).toBe(PRODUCTION_SUPABASE_ANON_KEY);
    });
});
