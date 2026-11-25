BEGIN;

SELECT plan(7);

-- 1. Ensure storage.buckets and profile-images bucket exist with required constraints
SELECT ok(
  EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'profile-images'
      AND public = TRUE
      AND file_size_limit = 5242880
  ),
  'profile-images bucket exists with public access and 5MB limit'
);

-- 2. Setup mock users in auth.users
INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user_a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'user_b@test.com')
ON CONFLICT (id) DO NOTHING;

-- 3. User A can upload an avatar to their own folder (11111111-1111-1111-1111-111111111111/avatar.jpg)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT lives_ok(
  $$ INSERT INTO storage.objects (id, bucket_id, name, owner)
     VALUES (
       gen_random_uuid(),
       'profile-images',
       '11111111-1111-1111-1111-111111111111/avatar.jpg',
       '11111111-1111-1111-1111-111111111111'::uuid
     ) $$,
  'User A can upload an avatar to their own folder'
);

-- 4. User A can update / overwrite their own avatar
SELECT lives_ok(
  $$ UPDATE storage.objects
     SET metadata = '{"updated": true}'::jsonb
     WHERE bucket_id = 'profile-images'
       AND name = '11111111-1111-1111-1111-111111111111/avatar.jpg' $$,
  'User A can update their own avatar'
);

-- 5. User B CANNOT insert into User A's folder (throws 42501 RLS error)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

SELECT throws_ok(
  $$ INSERT INTO storage.objects (id, bucket_id, name, owner)
     VALUES (
       gen_random_uuid(),
       'profile-images',
       '11111111-1111-1111-1111-111111111111/avatar.jpg',
       '22222222-2222-2222-2222-222222222222'::uuid
     ) $$,
  '42501',
  NULL,
  'User B cannot insert an avatar into User A folder'
);

-- 6. User B CANNOT overwrite or update User A's avatar (0 rows updated)
SELECT is_empty(
  $$ UPDATE storage.objects
     SET metadata = '{"malicious": true}'::jsonb
     WHERE bucket_id = 'profile-images'
       AND name = '11111111-1111-1111-1111-111111111111/avatar.jpg'
     RETURNING 1 $$,
  'User B cannot overwrite or update User A avatar'
);

-- 7. User B can upload an avatar to their own folder
SELECT lives_ok(
  $$ INSERT INTO storage.objects (id, bucket_id, name, owner)
     VALUES (
       gen_random_uuid(),
       'profile-images',
       '22222222-2222-2222-2222-222222222222/avatar.jpg',
       '22222222-2222-2222-2222-222222222222'::uuid
     ) $$,
  'User B can upload an avatar to their own folder'
);

SELECT * FROM finish();

ROLLBACK;
