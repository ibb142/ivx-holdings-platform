-- Search the literal audit token without reading every historical message body.
-- This partial index also supports exact-body checks for duplicate Owner rows.
-- Keep lock acquisition bounded; an unavailable DDL lock aborts the migration.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '20s';
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS idx_ivx_messages_owner_body_trgm
  ON public.ivx_messages USING gin (body extensions.gin_trgm_ops)
  WHERE sender_role = 'owner';
