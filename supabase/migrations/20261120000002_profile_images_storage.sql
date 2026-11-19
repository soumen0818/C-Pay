-- Migration: 20261120000002_profile_images_storage.sql
-- Issue: #226 — profile-images storage bucket is used but never defined; uploads fail / are insecure
--
-- Fixes:
--   1. Ensures storage schema and helper function storage.foldername exist.
--   2. Defines 'profile-images' bucket with 5MB file_size_limit and image MIME type allow-list.
--   3. Sets up RLS policies on storage.objects:
--      - Public SELECT for profile-images objects.
--      - INSERT, UPDATE, DELETE strictly scoped to the owner's folder:
--        (storage.foldername(name))[1] = auth.uid()::text

BEGIN;

CREATE SCHEMA IF NOT EXISTS storage;

-- Ensure helper function storage.foldername exists for path token parsing
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : (array_length(_parts, 1) - 1)];
END
$$;

-- Create or update the profile-images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-images',
  'profile-images',
  true,
  5242880, -- 5 MB file size limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can view profile avatars (public bucket for peer discovery and payments)
DROP POLICY IF EXISTS "profile_images_select_public" ON storage.objects;
CREATE POLICY "profile_images_select_public" ON storage.objects
FOR SELECT
USING (bucket_id = 'profile-images');

-- 2. Authenticated users can insert avatars only into their own user folder: <auth.uid>/...
DROP POLICY IF EXISTS "profile_images_insert_own" ON storage.objects;
CREATE POLICY "profile_images_insert_own" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Authenticated users can update/overwrite avatars only in their own folder
DROP POLICY IF EXISTS "profile_images_update_own" ON storage.objects;
CREATE POLICY "profile_images_update_own" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Authenticated users can delete avatars only in their own folder
DROP POLICY IF EXISTS "profile_images_delete_own" ON storage.objects;
CREATE POLICY "profile_images_delete_own" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

COMMIT;
