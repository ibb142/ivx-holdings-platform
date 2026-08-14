import '@supabase/auth-js';

declare module '@supabase/auth-js' {
  interface AuthError {
    /** Legacy/runtime alias returned by some auth responses. */
    msg?: string;
  }
}
