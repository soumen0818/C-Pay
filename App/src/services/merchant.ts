import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EventEmitter from 'eventemitter3';
import { generateCPayId } from '../utils/cpayId';
import { isValidTransactionHash, registerContractMerchant } from './blockchain';

// Event emitter for real-time merchant status updates
export const merchantEvents = new EventEmitter();

async function getCurrentAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id || null;
}

export interface Merchant {
  id?: string;
  business_name: string;
  wallet_address: string;
  cpay_id?: string;
  owner_name?: string;
  email?: string;
  phone_number?: string;
  business_address?: string;
  business_registration_number?: string;
  description?: string;
  category?: string;
  logo_url?: string;
  is_active?: boolean;
  total_transactions?: number;
  total_revenue?: string;
  created_at?: string;
  updated_at?: string;
}

const MERCHANT_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const merchantByAddressCache = new Map<string, {
  merchant: Merchant | null;
  expiresAt: number;
}>();
const merchantByAddressInFlight = new Map<string, Promise<Merchant | null>>();

const CONTRACT_SYNCED_KEY = 'merchant_contract_synced';

async function cacheMerchantLocalState(merchant: Merchant): Promise<void> {
  if (!merchant.id || merchant.is_active === false) {
    return;
  }

  await AsyncStorage.multiSet([
    ['is_merchant', 'true'],
    ['merchant_id', merchant.id],
  ]);
}

/**
 * Whether the merchant's on-chain contract record has been synced. Merchant QR
 * payments only work once this is true, so the dashboard surfaces it and offers
 * a retry when it is false.
 */
export async function getContractSyncState(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CONTRACT_SYNCED_KEY)) === 'true';
  } catch {
    return false;
  }
}

async function setContractSyncState(synced: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTRACT_SYNCED_KEY, synced ? 'true' : 'false');
  } catch {
    // Non-fatal — the dashboard can still retry.
  }
}

/**
 * Retry the on-chain contract registration for a merchant. Used by the
 * dashboard's "failed contract sync" recovery path.
 */
export async function syncMerchantContract(
  merchantId: string,
  walletAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await registerContractMerchant(merchantId, walletAddress);
    await setContractSyncState(true);
    merchantEvents.emit('merchantContractSynced');
    return { success: true };
  } catch (error: any) {
    await setContractSyncState(false);
    return { success: false, error: error?.message || 'Contract sync failed' };
  }
}

export interface MerchantQRCode {
  id?: string;
  merchant_id?: string;
  qr_name: string;
  amount?: string;
  is_active?: boolean;
  scan_count?: number;
  created_at?: string;
}

/**
 * Check if current user is a merchant
 */
export async function isMerchant(walletAddress: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id')
      .eq('wallet_address', walletAddress)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking merchant status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error checking merchant status:', error);
    return false;
  }
}

/**
 * Upload merchant logo to Supabase Storage
 */
export async function uploadMerchantLogo(
  logoUri: string,
  businessName: string
): Promise<string | null> {
  try {
    console.log('Starting merchant logo upload for:', logoUri);

    // Read file as base64 for React Native compatibility
    const base64 = await fetch(logoUri)
      .then(res => res.blob())
      .then(blob => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result as string;
            // Remove data:image/xxx;base64, prefix
            resolve(base64data.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      });

    // Create unique filename
    const fileExt = logoUri.split('.').pop()?.split('?')[0] || 'jpg';
    const sanitizedName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const fileName = `${sanitizedName}_${Date.now()}.${fileExt}`;
    const filePath = `merchant-logos/${fileName}`;

    console.log('Uploading merchant logo to path:', filePath);

    // Convert base64 to array buffer for upload
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('merchant-logos')
      .upload(filePath, bytes.buffer, {
        contentType: `image/${fileExt}`,
        upsert: true,
      });

    if (uploadError) {
      console.error('Merchant logo upload error:', uploadError);
      return null;
    }

    console.log('Merchant logo upload successful:', uploadData);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('merchant-logos')
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;
    console.log('Merchant logo public URL:', publicUrl);

    return publicUrl;
  } catch (error) {
    console.error('Error uploading merchant logo:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    return null;
  }
}

/**
 * Register as a merchant
 */
export async function registerAsMerchant(merchant: Merchant): Promise<{
  success: boolean;
  merchantId?: string;
  contractSynced?: boolean;
  contractStatus?: string;
  error?: string;
}> {
  try {
    // Generate C-Pay ID if phone number is provided
    const cpayId = merchant.wallet_address
      ? generateCPayId(merchant.phone_number || '', merchant.wallet_address)
      : undefined;
    const authUserId = await getCurrentAuthUserId();

    const { data, error } = await supabase
      .from('merchants')
      .insert({
        ...merchant,
        auth_user_id: authUserId,
        cpay_id: cpayId, // Save C-Pay ID to database
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    let contractSynced = false;
    let contractStatus = 'not_synced';
    let contractError = '';

    try {
      const contractResult = await registerContractMerchant(data.id, merchant.wallet_address);
      contractSynced = true;
      contractStatus = contractResult.contractStatus || contractResult.status || 'synced';
    } catch (contractSyncError: any) {
      contractError = contractSyncError?.message || 'Contract merchant registration failed';
      console.warn('Merchant saved but contract sync failed:', contractError);
    }

    // Cache merchant status locally
    await cacheMerchantLocalState(data);
    await setContractSyncState(contractSynced);

    // Emit event for real-time UI updates
    merchantEvents.emit('merchantRegistered', data);
    console.log('📡 Emitted merchantRegistered event');

    return {
      success: true,
      merchantId: data.id,
      contractSynced,
      contractStatus,
      ...(contractError ? { error: contractError } : {}),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get merchant profile
 */
export async function getMerchantProfile(
  walletAddress: string
): Promise<Merchant | null> {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error) {
      console.error('Error getting merchant profile:', error);
    }

    if (data) {
      await cacheMerchantLocalState(data);
      return data;
    }

    const { data: fallbackData, error: fallbackError } = await supabase.rpc('get_own_merchant_by_wallet', {
      p_wallet_address: walletAddress,
    });

    if (fallbackError) {
      console.error('Error getting own merchant profile:', fallbackError);
      return null;
    }

    const fallbackMerchant = Array.isArray(fallbackData) ? fallbackData[0] : null;
    if (fallbackMerchant) {
      await cacheMerchantLocalState(fallbackMerchant);
      return fallbackMerchant;
    }

    return null;
  } catch (error) {
    console.error('Error getting merchant profile:', error);
    return null;
  }
}

/**
 * Get merchant by ID (Invisible Rail)
 * Used when QR code contains merchant_id instead of wallet address
 */
export async function getMerchantById(
  merchantId: string
): Promise<Merchant | null> {
  try {
    const { data, error } = await supabase.rpc('get_public_merchant_by_id', {
      p_merchant_id: merchantId,
    });

    if (error) {
      console.error('Error getting merchant by ID:', error);
      return null;
    }

    return Array.isArray(data) ? data[0] || null : null;
  } catch (error) {
    console.error('Error getting merchant by ID:', error);
    return null;
  }
}

/**
 * Get merchant by wallet address (Invisible Rail)
 * Used for backward compatibility with old QR codes
 */
export async function getMerchantByAddress(
  walletAddress: string
): Promise<Merchant | null> {
  const normalizedAddress = walletAddress.trim();
  const cached = merchantByAddressCache.get(normalizedAddress);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.merchant;
  }

  const inFlight = merchantByAddressInFlight.get(normalizedAddress);
  if (inFlight) {
    return inFlight;
  }

  const lookup = fetchMerchantByAddress(normalizedAddress);
  merchantByAddressInFlight.set(normalizedAddress, lookup);

  try {
    const merchant = await lookup;
    merchantByAddressCache.set(normalizedAddress, {
      merchant,
      expiresAt: Date.now() + MERCHANT_LOOKUP_CACHE_TTL_MS,
    });
    return merchant;
  } finally {
    merchantByAddressInFlight.delete(normalizedAddress);
  }
}

async function fetchMerchantByAddress(
  walletAddress: string
): Promise<Merchant | null> {
  try {
    const { data, error } = await supabase.rpc('get_public_merchant_by_address', {
      p_wallet_address: walletAddress,
    });

    if (error) {
      console.error('Error getting merchant by address:', error);
      return null;
    }

    return Array.isArray(data) ? data[0] || null : null;
  } catch (error) {
    console.error('Error getting merchant by address:', error);
    return null;
  }
}

/**
 * Update merchant profile
 */
export async function updateMerchantProfile(
  walletAddress: string,
  updates: Partial<Merchant>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('merchants')
      .update(updates)
      .eq('wallet_address', walletAddress);

    if (error) {
      console.error('Error updating merchant profile:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating merchant profile:', error);
    return false;
  }
}

/**
 * @deprecated QR codes are now generated on-the-fly and not stored in database.
 * This function is kept for backward compatibility but should not be used.
 * Create a merchant QR code
 */
export async function createMerchantQRCode(
  qrCode: MerchantQRCode
): Promise<{ success: boolean; qrCodeId?: string; error?: string }> {
  // DEPRECATED: QR codes are generated on-the-fly now
  console.warn('createMerchantQRCode is deprecated. QR codes are generated on-the-fly.');
  return { success: false, error: 'QR code storage is deprecated' };
}

/**
 * @deprecated QR codes are now generated on-the-fly and not stored in database.
 * Get all QR codes for a merchant
 */
export async function getMerchantQRCodes(
  merchantId: string
): Promise<MerchantQRCode[]> {
  // DEPRECATED: QR codes are generated on-the-fly now
  console.warn('getMerchantQRCodes is deprecated. QR codes are generated on-the-fly.');
  return [];
}

/**
 * @deprecated QR codes are now generated on-the-fly and not stored in database.
 * Update QR code status
 */
export async function updateQRCodeStatus(
  qrCodeId: string,
  isActive: boolean
): Promise<void> {
  // DEPRECATED: QR codes are generated on-the-fly now
  console.warn('updateQRCodeStatus is deprecated. QR codes are generated on-the-fly.');
}

/**
 * @deprecated QR codes are now generated on-the-fly and not stored in database.
 * Increment QR code scan count
 */
export async function incrementQRScanCount(qrCodeId: string): Promise<void> {
  // DEPRECATED: QR codes are generated on-the-fly now
  console.warn('incrementQRScanCount is deprecated. QR codes are generated on-the-fly.');
}

/**
 * Get merchant analytics
 */
export async function getMerchantAnalytics(merchantId: string): Promise<{
  totalTransactions: number;
  totalRevenue: string;
  successTransactions: number;
  pendingTransactions: number;
}> {
  try {
    const merchant = await supabase
      .from('merchants')
      .select('wallet_address')
      .eq('id', merchantId)
      .single();

    if (!merchant.data) {
      return { 
        totalTransactions: 0, 
        totalRevenue: '0', 
        successTransactions: 0,
        pendingTransactions: 0 
      };
    }

    const { data: transactions } = await supabase
      .from('transactions')
      .select('amount, status, internal_status, transaction_type')
      .eq('to_address', merchant.data.wallet_address)
      .eq('transaction_type', 'merchant');  // Only count merchant QR payments

    if (!transactions) {
      return { 
        totalTransactions: 0, 
        totalRevenue: '0',
        successTransactions: 0, 
        pendingTransactions: 0 
      };
    }

    const serverReceiptTransactions = transactions.filter(
      (tx) => tx.status === 'success' || tx.status === 'failed'
    );
    const successfulReceipts = serverReceiptTransactions.filter(
      (tx) => tx.status === 'success' && tx.internal_status === 'confirmed'
    );
    const totalTransactions = serverReceiptTransactions.length;
    const successTransactions = successfulReceipts.length;
    const totalRevenue = successfulReceipts
      .reduce((sum, tx) => sum + parseFloat(tx.amount), 0)
      .toString();
    const pendingTransactions = 0;

    return { 
      totalTransactions, 
      totalRevenue, 
      successTransactions,
      pendingTransactions 
    };
  } catch (error) {
    console.error('Error getting merchant analytics:', error);
    return { 
      totalTransactions: 0, 
      totalRevenue: '0',
      successTransactions: 0, 
      pendingTransactions: 0 
    };
  }
}

/**
 * Get recent merchant transactions
 */
export interface MerchantTransaction {
  id: string;
  transaction_id?: string;
  tx_hash: string;
  from_address: string;
  to_address: string;
  amount: string;
  status: 'pending' | 'success' | 'failed';
  created_at: string;
  merchant_name?: string;
  sender_name?: string;
}

export async function getMerchantTransactions(
  merchantId: string, 
  limit: number = 10
): Promise<MerchantTransaction[]> {
  try {
    const merchant = await supabase
      .from('merchants')
      .select('wallet_address')
      .eq('id', merchantId)
      .single();

    if (!merchant.data) {
      return [];
    }

    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('id, transaction_id, tx_hash, from_address, to_address, amount, status, internal_status, created_at, merchant_name, sender_name, transaction_type')
      .eq('to_address', merchant.data.wallet_address)
      .eq('transaction_type', 'merchant')  // Only show payments via merchant QR
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching merchant transactions:', error);
      return [];
    }

    return (transactions || [])
      .filter((tx) => isValidTransactionHash(tx.tx_hash))
      .filter((tx) => tx.status !== 'pending');
  } catch (error) {
    console.error('Error getting merchant transactions:', error);
    return [];
  }
}
