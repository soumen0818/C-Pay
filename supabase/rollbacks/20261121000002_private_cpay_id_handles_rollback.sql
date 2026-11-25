-- Rollback Migration: 20261121000002_private_cpay_id_handles_rollback.sql
-- Description: Restore the 20261022000001 trigger behaviour (an attempted
-- cpay_id change is silently ignored instead of raising) and drop NOT NULL.
-- Allocation stays random: reverting to email-derived handles would re-leak
-- users' email local-parts (#161), so that part is deliberately not undone.
-- IDs issued while the migration was active are kept and stay reserved.

BEGIN;

ALTER TABLE public.users ALTER COLUMN cpay_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_user_cpay_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
      RAISE EXCEPTION 'A user wallet address cannot be changed';
    END IF;

    IF OLD.cpay_id IS NOT NULL THEN
      NEW.cpay_id := OLD.cpay_id;
    ELSE
      NEW.cpay_id := public.allocate_cpay_id(NEW.email);
    END IF;
  ELSE
    NEW.cpay_id := public.allocate_cpay_id(NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
