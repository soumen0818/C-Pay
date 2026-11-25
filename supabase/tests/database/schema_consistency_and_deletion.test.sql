BEGIN;

SELECT plan(8);

-- 1. Check add_money_claims.auth_user_id column type is UUID
SELECT col_type_is(
  'public',
  'add_money_claims',
  'auth_user_id',
  'uuid',
  'add_money_claims.auth_user_id is UUID'
);

-- 2. Check foreign keys to auth.users exist
SELECT has_fk(
  'public',
  'add_money_claims',
  'add_money_claims has a foreign key to auth.users'
);

SELECT has_fk(
  'public',
  'payment_records',
  'payment_records has a foreign key to auth.users'
);

SELECT has_fk(
  'public',
  'users',
  'users has a foreign key to auth.users'
);

-- 3. Setup mock user in auth.users and profile in public.users
INSERT INTO auth.users (id, email)
VALUES ('44444444-4444-4444-4444-444444444444', 'deleteme@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (auth_user_id, wallet_address, email, cpay_id, display_name)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'GDELETE_USER_WALLET_ADDRESS',
  'deleteme@example.com',
  'deleteme@cpay1234567890abcdef',
  'Delete Me'
)
ON CONFLICT (wallet_address) DO NOTHING;

-- 4. Verify C-Pay ID is initially resolvable
SELECT is(
  (SELECT wallet_address FROM resolve_cpay_id('deleteme@cpay1234567890abcdef')),
  'GDELETE_USER_WALLET_ADDRESS',
  'C-Pay ID is resolvable before user deletion'
);

-- 5. Delete the auth user via delete_my_account RPC
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';

SELECT lives_ok(
  $$ SELECT delete_my_account() $$,
  'authenticated user can call delete_my_account'
);

-- 6. Verify deleting an auth user leaves no resolvable C-Pay ID
SELECT is_empty(
  $$ SELECT * FROM resolve_cpay_id('deleteme@cpay1234567890abcdef') $$,
  'Deleting an auth user leaves no resolvable C-Pay ID'
);

-- 7. Anon cannot execute delete_my_account
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT delete_my_account() $$,
  '42501',
  NULL,
  'anon cannot execute delete_my_account'
);

SELECT * FROM finish();

ROLLBACK;
