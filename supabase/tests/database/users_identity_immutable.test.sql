-- #160: an authenticated user cannot rewrite wallet_address or cpay_id, cannot
-- claim an unregistered address, and C-Pay IDs are unique case-insensitively.
BEGIN;

SELECT plan(15);

INSERT INTO auth.users (id, email)
VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'alice160@test.com'),
  ('b2b2b2b2-0000-0000-0000-000000000002', 'bob160@test.com');

-- Only Alice has a relayer-written wallet binding.
INSERT INTO public.wallet_bindings (auth_user_id, wallet_address)
VALUES ('a1a1a1a1-0000-0000-0000-000000000001', 'GA_ISSUE160_ALICE_WALLET');

-- Act as Alice -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1a1a1a1-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.email', 'alice160@test.com', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1a1a1a1-0000-0000-0000-000000000001","email":"alice160@test.com","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ INSERT INTO public.users (wallet_address, email)
     VALUES ('GA_ISSUE160_UNREGISTERED', 'alice160@test.com') $$,
  '42501',
  NULL,
  'a client cannot insert a users row (and so cannot claim an unregistered address)'
);

SELECT results_eq(
  $$ SELECT wallet_address FROM public.upsert_own_profile('Alice') $$,
  ARRAY['GA_ISSUE160_ALICE_WALLET'],
  'upsert_own_profile creates the row with the wallet from the relayer binding'
);

SELECT matches(
  (SELECT cpay_id FROM public.users WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001'),
  '^[a-z0-9._-]{3,20}@cpay[0-9a-f]{16}$',
  'the database assigns the C-Pay ID'
);

SELECT throws_ok(
  $$ UPDATE public.users SET wallet_address = 'GA_ISSUE160_OTHER_WALLET'
     WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  '42501',
  NULL,
  'an authenticated user cannot change wallet_address'
);

SELECT throws_ok(
  $$ UPDATE public.users SET cpay_id = 'support@cpayofficial'
     WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  '42501',
  NULL,
  'an authenticated user cannot change cpay_id'
);

SELECT throws_ok(
  $$ UPDATE public.users SET auth_user_id = 'b2b2b2b2-0000-0000-0000-000000000002'
     WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  '42501',
  NULL,
  'an authenticated user cannot reassign auth_user_id'
);

SELECT throws_ok(
  $$ UPDATE public.users SET email = 'victim@test.com'
     WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  '42501',
  NULL,
  'an authenticated user cannot overwrite the verified email'
);

SELECT lives_ok(
  $$ UPDATE public.users
     SET display_name = 'Alice B', profile_photo_url = 'https://example.com/a.png', biometric_enabled = TRUE
     WHERE auth_user_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  'profile fields remain editable'
);

SELECT results_eq(
  $$ SELECT wallet_address, display_name FROM public.upsert_own_profile('Alice C') $$,
  $$ VALUES ('GA_ISSUE160_ALICE_WALLET'::TEXT, 'Alice C'::TEXT) $$,
  'upsert_own_profile on an existing row updates only profile fields'
);

SELECT is(
  public.current_wallet_address(),
  'GA_ISSUE160_ALICE_WALLET',
  'current_wallet_address() returns the bound wallet'
);

-- Act as Bob (no binding) ---------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2b2b2b2-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.email', 'bob160@test.com', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b2b2b2b2-0000-0000-0000-000000000002","email":"bob160@test.com","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT * FROM public.upsert_own_profile('Bob') $$,
  'P0002',
  'No wallet is bound to this user',
  'a user without a relayer binding cannot create a profile'
);

SELECT is(
  public.current_wallet_address(),
  NULL,
  'current_wallet_address() is NULL without a binding'
);

RESET ROLE;

-- Case-insensitive uniqueness ------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexname = 'users_cpay_id_lower_unique'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%lower(cpay_id)%'
  ),
  'users has a unique index on lower(cpay_id)'
);

-- Bypass the assignment trigger to insert raw IDs, as a pre-#160 client could.
ALTER TABLE public.users DISABLE TRIGGER assign_users_cpay_id;

INSERT INTO public.users (wallet_address, cpay_id)
VALUES ('GA_ISSUE160_CASE_1', 'Bob@cpayabc123');

SELECT throws_ok(
  $$ INSERT INTO public.users (wallet_address, cpay_id)
     VALUES ('GA_ISSUE160_CASE_2', 'bob@cpayabc123') $$,
  '23505',
  NULL,
  'case-variant C-Pay IDs are rejected'
);

ALTER TABLE public.users ENABLE TRIGGER assign_users_cpay_id;

SELECT results_eq(
  $$ SELECT wallet_address FROM public.resolve_cpay_id('BOB@CPAYABC123') $$,
  ARRAY['GA_ISSUE160_CASE_1'],
  'resolve_cpay_id resolves an ID to exactly one wallet regardless of case'
);

SELECT * FROM finish();

ROLLBACK;
