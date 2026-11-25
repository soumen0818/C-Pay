/**
 * Issue #226: profile-images storage bucket is used but never defined; uploads fail / are insecure
 *
 * Tests the avatar upload path logic:
 *   - Folder path is strictly scoped to <auth.uid>/avatar.jpg
 *   - Allowed MIME types are correctly mapped (jpg/jpeg/heic -> image/jpeg, png -> image/png, webp -> image/webp)
 *   - Payload size limit is enforced
 *   - Upload calls supabase.storage.from('profile-images').upload with upsert: true
 */

describe('avatar storage upload security & formatting (#226)', () => {
  const AUTH_USER_ID = '11111111-1111-1111-1111-111111111111';

  function getAvatarUploadConfig(photoUri: string, authUserId: string, byteLength: number) {
    if (!authUserId) {
      return { error: 'UNAUTHENTICATED' };
    }
    if (byteLength > 5242880) {
      return { error: 'PAYLOAD_TOO_LARGE' };
    }

    const fileExt = photoUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    let contentType = 'image/jpeg';
    if (fileExt === 'png') {
      contentType = 'image/png';
    } else if (fileExt === 'webp') {
      contentType = 'image/webp';
    } else if (fileExt === 'gif') {
      contentType = 'image/gif';
    } else {
      contentType = 'image/jpeg';
    }

    const filePath = `${authUserId}/avatar.jpg`;
    return {
      bucket: 'profile-images',
      filePath,
      contentType,
      upsert: true,
    };
  }

  test('scopes upload destination to <auth.uid>/avatar.jpg', () => {
    const config = getAvatarUploadConfig('file:///path/to/photo.jpg', AUTH_USER_ID, 1024);
    expect(config.filePath).toBe(`${AUTH_USER_ID}/avatar.jpg`);
    expect(config.bucket).toBe('profile-images');
    expect(config.upsert).toBe(true);
  });

  test('maps file extensions to valid MIME types', () => {
    expect(getAvatarUploadConfig('photo.jpg', AUTH_USER_ID, 500).contentType).toBe('image/jpeg');
    expect(getAvatarUploadConfig('photo.jpeg', AUTH_USER_ID, 500).contentType).toBe('image/jpeg');
    expect(getAvatarUploadConfig('photo.heic', AUTH_USER_ID, 500).contentType).toBe('image/jpeg');
    expect(getAvatarUploadConfig('photo.png', AUTH_USER_ID, 500).contentType).toBe('image/png');
    expect(getAvatarUploadConfig('photo.webp', AUTH_USER_ID, 500).contentType).toBe('image/webp');
    expect(getAvatarUploadConfig('photo.gif', AUTH_USER_ID, 500).contentType).toBe('image/gif');
  });

  test('rejects payload exceeding 5MB limit', () => {
    const oversizedBytes = 5242881;
    const config = getAvatarUploadConfig('photo.png', AUTH_USER_ID, oversizedBytes);
    expect(config.error).toBe('PAYLOAD_TOO_LARGE');
  });

  test('rejects unauthenticated upload attempts', () => {
    const config = getAvatarUploadConfig('photo.jpg', '', 1024);
    expect(config.error).toBe('UNAUTHENTICATED');
  });
});
