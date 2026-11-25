import { Logger } from './logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

/**
 * C-Pay ID System - User-friendly identifier instead of wallet addresses.
 * IDs are assigned and persisted by the database when a user row is created.
 *
 * This is ONLY for UI display. Payment operations still use actual Stellar accounts.
 */

const CPAY_SUFFIX_LENGTH = 6;

/**
 * Create a short deterministic wallet fingerprint for display IDs.
 * This is a UI identifier, not a security primitive.
 */
export function getWalletFingerprint(walletAddress: string, length: number = CPAY_SUFFIX_LENGTH): string {
  const normalized = walletAddress.trim().toLowerCase();
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36).padStart(length, '0').slice(-length);
}

export function formatWalletFingerprint(walletAddress: string): string {
  return `C-Pay wallet #${getWalletFingerprint(walletAddress).toUpperCase()}`;
}

/**
 * Return only the C-Pay ID persisted for the current wallet.
 * Local storage is a cache; it is never used as an authority or fallback.
 */
export async function getCurrentUserCPayId(): Promise<string | null> {
  const walletAddress = await AsyncStorage.getItem('wallet_address');

  if (!walletAddress) {
    await AsyncStorage.removeItem('cpay_id');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('cpay_id')
      .eq('wallet_address', walletAddress)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data?.cpay_id) {
      await AsyncStorage.removeItem('cpay_id');
      return null;
    }

    await AsyncStorage.setItem('cpay_id', data.cpay_id);
    return data.cpay_id;
  } catch (error) {
    await AsyncStorage.removeItem('cpay_id');
    Logger.error('Error getting current user C-Pay ID:', error);
    throw error;
  }
}

/**
 * Get C-Pay ID for any wallet address by fetching from database.
 * @param walletAddress - Wallet address to look up
 * @returns C-Pay ID or null if not found in database
 */
export async function getCPayIdByWallet(walletAddress: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_public_wallet_profile', {
      p_wallet_address: walletAddress,
    });

    if (!error && Array.isArray(data) && data[0]?.cpay_id) {
      return data[0].cpay_id;
    }

    const currentWallet = await AsyncStorage.getItem('wallet_address');
    if (currentWallet?.toLowerCase() === walletAddress.toLowerCase()) {
      return getCurrentUserCPayId();
    }

    return null;
  } catch (error) {
    Logger.error('Error fetching C-Pay ID:', error);
    return null;
  }
}

/**
 * Get display identifier for wallet address
 * Priority: C-Pay ID > Display Name > Wallet fingerprint
 * @param walletAddress - Wallet address
 * @param displayName - Optional display name
 * @returns User-friendly identifier
 */
export async function getDisplayIdentifier(
  walletAddress: string,
  displayName?: string | null
): Promise<string> {
  // Try to get C-Pay ID first
  const cpayId = await getCPayIdByWallet(walletAddress);
  if (cpayId) {
    return cpayId;
  }
  
  // Fallback to display name if available
  if (displayName) {
    return displayName;
  }
  
  // Final fallback: hashed wallet fingerprint
  return formatWalletFingerprint(walletAddress);
}

/**
 * Format C-Pay ID for display (optional - adds styling/formatting)
 * @param cpayId - C-Pay ID to format
 * @returns Formatted string
 */
export function formatCPayIdForDisplay(cpayId: string): string {
  return cpayId; // Currently returns as-is, but can be enhanced with formatting
}

/**
 * Validate if a string is a valid C-Pay ID format
 * @param id - String to validate
 * @returns true if valid C-Pay ID format
 */
export function isValidCPayId(id: string): boolean {
  const pattern = /^[a-z0-9._-]{3,20}@cpay[a-z0-9]{4,32}$/i;
  return pattern.test(id);
}

/**
 * Extract wallet hash suffix from C-Pay ID
 * @param cpayId - C-Pay ID
 * @returns Wallet hash suffix or null
 */
export function extractLast4FromCPayId(cpayId: string): string | null {
  const match = cpayId.match(/@cpay([a-z0-9]{4,32})$/i);
  return match ? match[1] : null;
}

/**
 * Get wallet address from C-Pay ID using the public user profile lookup.
 * @param cpayId - C-Pay ID to look up
 * @returns Wallet address or null if not found
 */
export async function getWalletAddressFromCPayId(cpayId: string): Promise<string | null> {
  try {
    const normalizedId = cpayId.trim().toLowerCase();

    const { data, error } = await supabase.rpc('resolve_cpay_id', {
      p_cpay_id: normalizedId,
    });

    if (!error && Array.isArray(data) && data[0]?.wallet_address) {
      return data[0].wallet_address;
    }

    return null;
  } catch (error) {
    Logger.error('Error getting wallet address from C-Pay ID:', error);
    return null;
  }
}
