import { relayerRequest } from './blockchain';
import { supabase } from './supabase';

/**
 * Profile writes (Issue #160).
 *
 * Clients can no longer INSERT into `users` or UPDATE wallet_address / cpay_id.
 * The profile row is created by the `upsert_own_profile` RPC, which takes the
 * wallet from the caller's relayer-written wallet binding and the email from
 * the verified session. Only display_name, profile_photo_url and
 * biometric_enabled are client-editable.
 */

export interface OwnProfile {
  wallet_address: string;
  cpayId: string | null;
  display_name: string | null;
  profile_photo_url: string | null;
}

export interface OwnProfileFields {
  displayName?: string | null;
  profilePhotoUrl?: string | null;
  biometricEnabled?: boolean | null;
}

/**
 * Ask the relayer to bind this wallet to the signed-in user. The relayer is
 * the only writer of wallet_bindings; /accounts/prepare binds the wallet
 * (subject to its ownership and sponsorship checks) before it builds the
 * sponsorship transaction. The returned transaction is not submitted here;
 * the account is activated later by ensureAccountReady.
 */
export async function registerWalletBinding(walletAddress: string): Promise<void> {
  await relayerRequest('/accounts/prepare', {
    method: 'POST',
    body: JSON.stringify({ accountId: walletAddress }),
  });
}

/**
 * Create or update the signed-in user's profile row. Fields left undefined are
 * not changed. The wallet address and C-Pay ID are assigned by the database.
 */
export async function upsertOwnProfile(fields: OwnProfileFields = {}): Promise<OwnProfile> {
  const { data, error } = await supabase.rpc('upsert_own_profile', {
    p_display_name: fields.displayName ?? null,
    p_profile_photo_url: fields.profilePhotoUrl ?? null,
    p_biometric_enabled: fields.biometricEnabled ?? null,
  });

  if (error) {
    throw error;
  }

  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile?.wallet_address) {
    throw new Error('The database did not return a profile for this user.');
  }

  return profile as OwnProfile;
}

/**
 * Bind the wallet with the relayer, then create/update the profile row.
 * Throws if the stored profile belongs to a different wallet.
 */
export async function registerWalletAndSaveProfile(
  walletAddress: string,
  fields: OwnProfileFields = {}
): Promise<OwnProfile> {
  await registerWalletBinding(walletAddress);
  const profile = await upsertOwnProfile(fields);

  if (profile.wallet_address !== walletAddress) {
    throw new Error('Your profile is linked to a different wallet.');
  }

  return profile;
}
