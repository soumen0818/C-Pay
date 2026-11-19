import { Logger } from '../utils/logger';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSessionPin } from './wallet';
import { stopTransactionPolling } from './transactionMonitor';

// Rate limiting constants
const MAX_OTP_ATTEMPTS_PER_DAY = 10;
const OTP_RATE_LIMIT_KEY = 'otp_rate_limit';
export const WALLET_AUTH_USER_ID_KEY = 'wallet_auth_user_id';

export async function clearCachedAccountData(): Promise<void> {
  await AsyncStorage.multiRemove([
    'transactions',
    'display_name',
    'cpay_id',
    'profile_photo',
    'profile_complete',
    'user_name',
    'notifications_enabled',
    'cloud_backup_required',
    'cloud_backup_complete',
  ]);
}

function getRetryHours(resetTime: Date): number {
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / (1000 * 60 * 60)));
}

function isRateLimitMessage(message?: string): boolean {
  if (!message) {
    return false;
  }

  return /rate|limit|too many|security purposes|wait|requested/i.test(message);
}

function getSupabaseEmailSendError(email: string, message?: string): string {
  if (isRateLimitMessage(message)) {
    return `Supabase temporarily blocked another verification email for ${email} or this project. This is not a full app-system block. Try again after 60 seconds. If this message still appears, wait up to 1 hour before requesting another code.`;
  }

  return message || 'Failed to send email OTP';
}

interface OTPRateLimit {
  attempts: number;
  lastAttempt: string; // ISO date string
  resetDate: string; // ISO date string
}

/**
 * Guard against silently destroying the user's only wallet recovery path (issue #2).
 *
 * `supabase.auth.signInWithOtp` / `verifyOtp` mint a session for the address
 * being verified, which changes `auth.uid()`. `wallet_backups` is
 * UNIQUE(auth_user_id) with RLS scoped to `auth.uid()`, so once the session
 * belongs to a different auth user, `getCloudWalletBackup()` returns nothing
 * and the encrypted seed is unreachable — silent, unrecoverable data loss.
 *
 * This resolves to a blocking error whenever a session already exists, that
 * session owns a wallet backup, and the address being verified is not the one
 * the session already belongs to. Re-verifying the *same* address is safe: the
 * resulting session is the same auth user, so the backup stays bound.
 *
 * Returns null when the OTP is safe to send, or an error message to surface.
 */
export async function getSessionSwapBlockReason(email: string): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;

    // No session to displace — onboarding / login. Nothing to lose.
    if (!session?.user) {
      return null;
    }

    const currentEmail = session.user.email?.trim().toLowerCase();
    const targetEmail = email.trim().toLowerCase();

    // Same address: verifying it again yields the same auth user.
    if (currentEmail && currentEmail === targetEmail) {
      return null;
    }

    // A different address would swap auth.uid(). Only block if this auth user
    // actually has a backup bound to it — otherwise there is nothing to lose.
    const { data: backup, error } = await supabase
      .from('wallet_backups')
      .select('id')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();

    if (error) {
      // Fail closed: we could not prove the backup is safe, so do not risk it.
      Logger.error('Wallet backup guard lookup failed:', error);
      return 'Could not confirm your wallet backup is safe, so this verification was stopped. Check your connection and try again.';
    }

    if (!backup) {
      return null;
    }

    return (
      `Verifying ${email} would sign you in as a different account and disconnect ` +
      `the encrypted wallet backup saved under ${currentEmail || 'your current email'}. ` +
      `That backup is the only way to recover this wallet. ` +
      `Sign out and restore your wallet first if you really want to use a different email.`
    );
  } catch (error: any) {
    Logger.error('Wallet backup guard error:', error);
    return 'Could not confirm your wallet backup is safe, so this verification was stopped. Please try again.';
  }
}

/**
 * Check if user has exceeded OTP rate limit
 */
async function checkRateLimit(): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  resetTime?: Date;
}> {
  try {
    const rateLimitData = await AsyncStorage.getItem(OTP_RATE_LIMIT_KEY);
    const now = new Date();

    if (!rateLimitData) {
      return { allowed: true, remainingAttempts: MAX_OTP_ATTEMPTS_PER_DAY };
    }

    const rateLimit: OTPRateLimit = JSON.parse(rateLimitData);
    const resetDate = new Date(rateLimit.resetDate);

    // Check if we need to reset (new day)
    if (now >= resetDate) {
      await AsyncStorage.removeItem(OTP_RATE_LIMIT_KEY);
      return { allowed: true, remainingAttempts: MAX_OTP_ATTEMPTS_PER_DAY };
    }

    // Check if limit exceeded
    if (rateLimit.attempts >= MAX_OTP_ATTEMPTS_PER_DAY) {
      return {
        allowed: false,
        remainingAttempts: 0,
        resetTime: resetDate,
      };
    }

    return {
      allowed: true,
      remainingAttempts: MAX_OTP_ATTEMPTS_PER_DAY - rateLimit.attempts,
    };
  } catch (error) {
    Logger.error('Error checking rate limit:', error);
    return { allowed: true, remainingAttempts: MAX_OTP_ATTEMPTS_PER_DAY };
  }
}

/**
 * Increment OTP attempt counter
 */
async function incrementAttempt(): Promise<void> {
  try {
    const rateLimitData = await AsyncStorage.getItem(OTP_RATE_LIMIT_KEY);
    const now = new Date();

    // Calculate reset time (midnight of next day)
    const resetDate = new Date(now);
    resetDate.setHours(24, 0, 0, 0);

    let rateLimit: OTPRateLimit;

    if (!rateLimitData) {
      rateLimit = {
        attempts: 1,
        lastAttempt: now.toISOString(),
        resetDate: resetDate.toISOString(),
      };
    } else {
      const existing: OTPRateLimit = JSON.parse(rateLimitData);
      rateLimit = {
        attempts: existing.attempts + 1,
        lastAttempt: now.toISOString(),
        resetDate: existing.resetDate,
      };
    }

    await AsyncStorage.setItem(OTP_RATE_LIMIT_KEY, JSON.stringify(rateLimit));
  } catch (error) {
    Logger.error('Error incrementing attempt:', error);
  }
}


/**
 * Send an email OTP for the current login/onboarding verification flow.
 * Email is the only sign-in method; this keeps the app-level OTP request limit.
 */
export async function sendLoginEmailOTP(email: string): Promise<{
  success: boolean;
  verificationId?: string;
  error?: string;
  remainingAttempts?: number;
  resetTime?: Date;
}> {
  try {
    // Never swap the auth session out from under a bound wallet backup.
    const blockReason = await getSessionSwapBlockReason(email);
    if (blockReason) {
      return { success: false, error: blockReason };
    }

    const rateLimitCheck = await checkRateLimit();

    if (!rateLimitCheck.allowed) {
      const resetTime = rateLimitCheck.resetTime!;
      const hours = getRetryHours(resetTime);
      return {
        success: false,
        error: `This device reached today's verification-code request limit across all email addresses. Try again in ${hours} hour${hours > 1 ? 's' : ''}.`,
        remainingAttempts: 0,
        resetTime,
      };
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      return {
        success: false,
        error: getSupabaseEmailSendError(email, error.message),
        remainingAttempts: rateLimitCheck.remainingAttempts,
      };
    }

    await incrementAttempt();

    return {
      success: true,
      verificationId: email,
      remainingAttempts: rateLimitCheck.remainingAttempts - 1,
    };
  } catch (error: any) {
    Logger.error('Send login email OTP error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email OTP',
    };
  }
}

/**
 * Verify the email OTP used for login/onboarding verification.
 */
export async function verifyLoginEmailOTP(
  verificationId: string,
  otpCode: string
): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  try {
    // verifyOtp is what actually mints the new session, so the guard is
    // enforced here too — not only on the send path.
    const blockReason = await getSessionSwapBlockReason(verificationId);
    if (blockReason) {
      return { success: false, error: blockReason };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: verificationId,
      token: otpCode,
      type: 'email',
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      email: data.user?.email || verificationId,
    };
  } catch (error: any) {
    Logger.error('Verify login email OTP error:', error);
    return {
      success: false,
      error: error.message || 'Invalid email OTP code',
    };
  }
}


/**
 * Get remaining OTP attempts for the day
 */
export async function getRemainingAttempts(): Promise<{
  remaining: number;
  resetTime?: Date;
}> {
  const rateLimitCheck = await checkRateLimit();
  return {
    remaining: rateLimitCheck.remainingAttempts,
    resetTime: rateLimitCheck.resetTime,
  };
}

/**
 * Sign out from Supabase
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  stopTransactionPolling();
  await supabase.removeAllChannels();
  await clearCachedAccountData();
  await AsyncStorage.multiRemove([
    'auth_token',
    // Legacy phone-OTP keys: no longer written, cleared from older installs.
    'phone_verified',
    'phone_number',
    'user_phone',
    'email_verified',
    'user_email',
  ]);
  clearSessionPin();
}

/**
 * Permanently delete current user account via delete_my_account RPC and wipe local data (#228)
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    Logger.error('Failed to execute delete_my_account RPC:', error);
    throw error;
  }
  await signOut();
  await AsyncStorage.multiRemove([
    'wallet_address',
    'wallet_auth_user_id',
    'wallet_pin',
    'biometric_enabled',
    'has_wallet',
  ]);
}

// Note on session swapping (issue #2 / #32):
//
// Calling supabase.auth.signInWithOtp / verifyOtp while a session already exists
// replaces the session and changes auth.uid(), orphaning the user's wallet_backups row
// (UNIQUE(auth_user_id), RLS scoped to auth.uid()) and silently destroying their only
// wallet recovery path.
//
// Never call signInWithOtp while a session exists without checking
// getSessionSwapBlockReason() above.
