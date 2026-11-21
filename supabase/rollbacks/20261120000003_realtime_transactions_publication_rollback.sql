-- Rollback Migration: 20261120000003_realtime_transactions_publication_rollback.sql
-- Description: Remove public.transactions from supabase_realtime publication.
--
-- NOTE: C-Pay follows a forward-fix migration policy. Rolling back schema migrations
-- is discouraged as it may cause inconsistent states across deployed environments.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.transactions;
  END IF;
END $$;

ALTER TABLE public.transactions REPLICA IDENTITY DEFAULT;

COMMIT;
