-- Rollback Migration: 20261120000002_profile_images_storage_rollback.sql
-- Description: Revert profile-images storage bucket and RLS policies.
--
-- NOTE: C-Pay follows a forward-fix migration policy. Rolling back schema migrations
-- is discouraged as it may cause inconsistent states across deployed environments.

BEGIN;

DROP POLICY IF EXISTS "profile_images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_update_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_delete_own" ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id = 'profile-images';
DELETE FROM storage.buckets WHERE id = 'profile-images';

COMMIT;
