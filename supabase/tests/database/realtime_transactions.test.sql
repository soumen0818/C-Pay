BEGIN;

SELECT plan(3);

-- 1. Ensure supabase_realtime publication exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ),
  'supabase_realtime publication exists'
);

-- 2. Ensure public.transactions is in supabase_realtime publication
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'transactions'
  ),
  'public.transactions is included in supabase_realtime publication'
);

-- 3. Ensure public.transactions has REPLICA IDENTITY FULL
SELECT is(
  (SELECT relreplident FROM pg_class WHERE oid = 'public.transactions'::regclass),
  'f'::"char",
  'public.transactions has REPLICA IDENTITY FULL for realtime RLS delivery'
);

SELECT * FROM finish();

ROLLBACK;
