-- Migration: 20261120000003_realtime_transactions_publication.sql
-- Issue: #227 — Realtime "incoming payment" subscription can never fire
--
-- Enables Supabase Realtime replication on public.transactions so that
-- postgres_changes subscriptions for incoming payments receive events.

BEGIN;

-- Ensure supabase_realtime publication exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Set REPLICA IDENTITY FULL so RLS and change payloads work accurately
ALTER TABLE public.transactions REPLICA IDENTITY FULL;

-- Add public.transactions to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  END IF;
END $$;

COMMIT;
