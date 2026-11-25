-- Assign C-Pay IDs in the database, once per wallet, and keep them reserved
-- permanently. A 64-bit random suffix has an approximate birthday collision
-- probability of 2.7e-8 at 1 million IDs and 2.7e-6 at 10 million IDs.

BEGIN;

LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.cpay_id_reservations (
  cpay_id TEXT PRIMARY KEY,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cpay_id_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpay_id_reservations FROM PUBLIC, anon, authenticated;

INSERT INTO public.cpay_id_reservations (cpay_id)
SELECT cpay_id
FROM public.users
WHERE cpay_id IS NOT NULL
ON CONFLICT (cpay_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.allocate_cpay_id(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  email_handle TEXT;
  candidate TEXT;
BEGIN
  email_handle := split_part(lower(coalesce(p_email, '')), '@', 1);
  email_handle := split_part(email_handle, '+', 1);
  email_handle := regexp_replace(email_handle, '[^a-z0-9._-]', '', 'g');
  email_handle := regexp_replace(email_handle, '^[._-]+|[._-]+$', '', 'g');
  email_handle := left(email_handle, 20);

  IF length(email_handle) < 3 THEN
    email_handle := 'user';
  END IF;

  LOOP
    candidate := email_handle || '@cpay' ||
      substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 16);

    BEGIN
      INSERT INTO public.cpay_id_reservations (cpay_id)
      VALUES (candidate);
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      -- The reservation's primary key makes collision detection atomic.
      -- Retry with a fresh 64-bit random suffix.
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_cpay_id(TEXT) FROM PUBLIC, anon, authenticated;

-- Existing IDs are preserved to avoid breaking recipients' saved handles.
-- Rows without an ID receive one before the immutability trigger is installed.
UPDATE public.users
SET cpay_id = public.allocate_cpay_id(email)
WHERE cpay_id IS NULL;

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

REVOKE ALL ON FUNCTION public.assign_user_cpay_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assign_users_cpay_id ON public.users;
CREATE TRIGGER assign_users_cpay_id
BEFORE INSERT OR UPDATE OF cpay_id, wallet_address ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_user_cpay_id();

COMMIT;
