-- Rollback Migration: 20261121000001_users_immutable_identity_rollback.sql
-- Description: Restore pre-#160 client write access to users.
-- WARNING: this re-opens wallet_address / cpay_id spoofing (#160). C-Pay IDs
-- reassigned because of case collisions are not restored.

BEGIN;

DROP FUNCTION IF EXISTS public.upsert_own_profile(TEXT, TEXT, BOOLEAN);

GRANT INSERT, UPDATE ON public.users TO authenticated;

DROP POLICY IF EXISTS "users_insert_own" ON public.users;
CREATE POLICY "users_insert_own" ON public.users
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND (auth_user_id IS NULL OR auth_user_id = auth.uid()));

DROP INDEX IF EXISTS public.users_cpay_id_lower_unique;

CREATE OR REPLACE FUNCTION current_wallet_address()
RETURNS TEXT AS $$
  SELECT wallet_address
  FROM users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMIT;
