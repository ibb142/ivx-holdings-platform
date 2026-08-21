import { describe, expect, it } from 'bun:test';
import {
  extractSupabaseAnonKey,
  extractSupabaseUrl,
  PRODUCTION_SUPABASE_ANON_KEY,
  PRODUCTION_SUPABASE_URL,
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from '@/lib/supabase-env';

const OTHER_REF = 'otherprojectref';
const otherProjectUrl = `https://${OTHER_REF}.supabase.co`;
const publishableKey = 'sb_publishable_example123';

describe('supabase-env sanitizer', () => {
  it('extracts a hosted URL from polluted env text', () => {
    const raw = `Supabase URL ${PRODUCTION_SUPABASE_URL} extra text`;
    expect(extractSupabaseUrl(raw)).toBe(PRODUCTION_SUPABASE_URL);
  });

  it('returns null when no hosted URL is present', () => {
    expect(extractSupabaseUrl('just some random text')).toBeNull();
  });

  it('accepts modern publishable keys', () => {
    expect(extractSupabaseAnonKey(publishableKey)).toBe(publishableKey);
    expect(extractSupabaseAnonKey(`label ${publishableKey} suffix`)).toBe(publishableKey);
  });

  it('returns null when no supported auth key is present', () => {
    expect(extractSupabaseAnonKey('not-a-supabase-key')).toBeNull();
  });
});

describe('resolveSupabaseUrl', () => {
  it('uses the env URL when it points to production', () => {
    const prev = process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = PRODUCTION_SUPABASE_URL;
    try {
      expect(resolveSupabaseUrl()).toBe(PRODUCTION_SUPABASE_URL);
    } finally {
      if (prev === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = prev;
    }
  });

  it('fails closed to production when env points to another hosted project', () => {
    const prev = process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = otherProjectUrl;
    try {
      expect(resolveSupabaseUrl()).toBe(PRODUCTION_SUPABASE_URL);
    } finally {
      if (prev === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = prev;
    }
  });
});

describe('resolveSupabaseAnonKey', () => {
  it('keeps the production legacy anon key for the JWT-only mobile preflight', () => {
    const prevAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const prevPub = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
    try {
      expect(resolveSupabaseAnonKey()).toBe(PRODUCTION_SUPABASE_ANON_KEY);
    } finally {
      if (prevAnon === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = prevAnon;
      if (prevPub === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevPub;
    }
  });

  it('falls back to the production legacy anon key when env is absent', () => {
    const prevAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const prevPub = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      expect(resolveSupabaseAnonKey()).toBe(PRODUCTION_SUPABASE_ANON_KEY);
    } finally {
      if (prevAnon !== undefined) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = prevAnon;
      if (prevPub !== undefined) process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevPub;
    }
  });
});
