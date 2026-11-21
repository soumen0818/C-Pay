BEGIN;

SELECT plan(10);

INSERT INTO public.users (wallet_address, email, cpay_id)
VALUES ('test-cpay-id-wallet-1', 'Alice+tag@example.com', 'client-supplied@cpay000000');

SELECT matches(
  (SELECT cpay_id FROM public.users WHERE wallet_address = 'test-cpay-id-wallet-1'),
  '^user[0-9a-f]{6}@cpay[0-9a-f]{16}$',
  'new IDs are database-assigned with a random handle and suffix; client values are discarded'
);

SELECT unalike(
  (SELECT cpay_id FROM public.users WHERE wallet_address = 'test-cpay-id-wallet-1'),
  '%alice%',
  'the C-Pay ID does not leak the email local-part (#161)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.cpay_id_reservations r
    JOIN public.users u ON u.cpay_id = r.cpay_id
    WHERE u.wallet_address = 'test-cpay-id-wallet-1'
  ),
  'every assigned ID is reserved'
);

CREATE TEMP TABLE cpay_id_before_update AS
SELECT cpay_id
FROM public.users
WHERE wallet_address = 'test-cpay-id-wallet-1';

UPDATE public.users
SET email = 'new-address@example.com'
WHERE wallet_address = 'test-cpay-id-wallet-1';

SELECT is(
  (SELECT cpay_id FROM public.users WHERE wallet_address = 'test-cpay-id-wallet-1'),
  (SELECT cpay_id FROM cpay_id_before_update),
  'changing the email does not change the C-Pay ID'
);

SELECT throws_ok(
  $$ UPDATE public.users
     SET cpay_id = 'replacement@cpay000000'
     WHERE wallet_address = 'test-cpay-id-wallet-1' $$,
  'P0001',
  'A C-Pay ID cannot be changed once assigned',
  'an assigned C-Pay ID cannot be rewritten'
);

SELECT isnt(
  public.allocate_cpay_id(),
  public.allocate_cpay_id(),
  'new random IDs are reserved uniquely'
);

SELECT matches(
  public.allocate_cpay_id('bob@example.com'),
  '^user[0-9a-f]{6}@cpay[0-9a-f]{16}$',
  'the legacy allocate_cpay_id(TEXT) wrapper ignores the email'
);

SELECT throws_ok(
  $$ UPDATE public.users
     SET wallet_address = 'test-cpay-id-wallet-2'
     WHERE wallet_address = 'test-cpay-id-wallet-1' $$,
  'P0001',
  'A user wallet address cannot be changed',
  'a persisted C-Pay ID cannot be moved to another wallet'
);

SELECT col_not_null(
  'public',
  'users',
  'cpay_id',
  'every user row has a C-Pay ID'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.cpay_id_reservations', 'SELECT, INSERT, UPDATE, DELETE'),
  'clients cannot read or modify ID reservations'
);

SELECT * FROM finish();

ROLLBACK;
