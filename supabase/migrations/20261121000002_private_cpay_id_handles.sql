-- Migration: 20261121000002_private_cpay_id_handles.sql
-- Issue: #161 — C-Pay IDs must be assigned once, server-side, from a
-- collision-checked namespace, and must not leak the user's email.
--
-- 20261022000001_stable_cpay_ids.sql already moved assignment into the
-- database (allocate_cpay_id + reservation table + immutability trigger).
-- Remaining gaps closed here:
--
--   * New handles were derived from the email local-part, publishing it to
--     anyone who resolves or scans the ID. New IDs now use a random handle:
--       user<6 hex>@cpay<16 hex>
--     The full ID is reserved through cpay_id_reservations' primary key, and
--     a collision is retried with fresh randomness. It is never dropped.
--   * Existing IDs are frozen as they are, so saved contacts and printed QR
--     codes keep resolving. cpay_id becomes NOT NULL, and any attempt to
--     change an assigned ID now raises instead of being silently ignored.
--
-- allocate_cpay_id(TEXT) is kept as a compatibility wrapper. It ignores its
-- argument, so no caller can feed it identifying data.

BEGIN;

LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

-- 1. Random, non-identifying allocator ---------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_cpay_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  entropy TEXT;
  candidate TEXT;
  attempts INTEGER := 0;
BEGIN
  LOOP
    attempts := attempts + 1;
    IF attempts > 16 THEN
      -- ~84 random bits per attempt (24 in the handle, 60 in the suffix;
      -- UUIDv4 fixes one nibble in each slice used). Reaching this means the
      -- RNG or the reservation table is broken, not bad luck. Fail loudly.
      RAISE EXCEPTION 'Could not allocate a unique C-Pay ID after % attempts', attempts - 1
        USING ERRCODE = 'P0001';
    END IF;

    entropy := replace(gen_random_uuid()::TEXT, '-', '')
            || replace(gen_random_uuid()::TEXT, '-', '');
    candidate := 'user' || substr(entropy, 1, 6) || '@cpay' || substr(entropy, 33, 16);

    BEGIN
      INSERT INTO public.cpay_id_reservations (cpay_id)
      VALUES (candidate);
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      -- Collision: retry with fresh randomness, never drop.
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_cpay_id() FROM PUBLIC, anon, authenticated;

-- Compatibility wrapper: the email argument is deliberately ignored.
CREATE OR REPLACE FUNCTION public.allocate_cpay_id(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.allocate_cpay_id();
$$;

REVOKE ALL ON FUNCTION public.allocate_cpay_id(TEXT) FROM PUBLIC, anon, authenticated;

-- 2. Freeze existing IDs -------------------------------------------------------
-- Every existing ID is kept exactly as issued and stays reserved.
INSERT INTO public.cpay_id_reservations (cpay_id)
SELECT cpay_id
FROM public.users
WHERE cpay_id IS NOT NULL
ON CONFLICT (cpay_id) DO NOTHING;

-- Rows that somehow still lack an ID get one, then the column is NOT NULL.
ALTER TABLE public.users DISABLE TRIGGER assign_users_cpay_id;
UPDATE public.users
SET cpay_id = public.allocate_cpay_id()
WHERE cpay_id IS NULL;
ALTER TABLE public.users ENABLE TRIGGER assign_users_cpay_id;

ALTER TABLE public.users ALTER COLUMN cpay_id SET NOT NULL;

-- 3. Assignment trigger: assign once on insert; reject every change -----------
CREATE OR REPLACE FUNCTION public.assign_user_cpay_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
      RAISE EXCEPTION 'A user wallet address cannot be changed'
        USING ERRCODE = 'P0001';
    END IF;

    IF NEW.cpay_id IS DISTINCT FROM OLD.cpay_id THEN
      RAISE EXCEPTION 'A C-Pay ID cannot be changed once assigned'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Any client-supplied value is discarded; the database assigns the ID.
    NEW.cpay_id := public.allocate_cpay_id();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_user_cpay_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assign_users_cpay_id ON public.users;
CREATE TRIGGER assign_users_cpay_id
BEFORE INSERT OR UPDATE OF cpay_id, wallet_address ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_user_cpay_id();

COMMIT;
