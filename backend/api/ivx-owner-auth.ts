/**
 * IVX Owner Authorization Endpoint
 *
 * Supabase answers WHO; IVX answers WHAT.
 * Accepts a valid Supabase access token and resolves owner authorization.
 */

import { createClient } from '@supabase/supabase-js';

const DEPLOYMENT_MARKER = 'ivx-owner-auth-v2-publishable-key-safe';
const PRODUCTION_SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const PRODUCTION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ