import { Logger } from './logger';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cachePinForSession,
  enableWalletBiometricBackup,
  getWallet,
  getWalletFromBiometricBackup,
  getWalletFromSession,
  StellarWallet,
  unlockWithPin,
} from '../services/wallet';

// Store reference to PIN dialog functions (will be set by the component)
let showPINDialog: ((title: string, message: string) => Promise<string | null>) | null = null;

export function setPINDialogHandler(
  handler: (title: string, message: string) => Promise<string | null>
) {
  showPINDialog = handler;
}

/**
 * Authenticate user with their app PIN
 * Returns true if PIN matches, false otherwise
 */
export async function authenticateWithPIN(): Promise<boolean> {
  try {
    if (!showPINDialog) {
      return false;
    }

    const inputPin = await showPINDialog(
      'Enter PIN',
      'Enter your 6-digit PIN to confirm'
    );

    if (!inputPin || inputPin.length !== 6) {
      return false;
    }

    const result = await unlockWithPin(inputPin);
    if (result.status === 'OK') {
      cachePinForSession(inputPin);
    }

    return result.status === 'OK';
  } catch (error) {
    return false;
  }
}

/**
 * Unlock and return a wallet for a sensitive action without persisting the PIN.
 * Preference order:
 * 1. Short-lived in-memory PIN session
 * 2. Biometric-protected wallet backup
 * 3. PIN dialog fallback
 */
export async function getAuthenticatedWallet(
  title: string = 'Enter PIN',
  message: string = 'Enter your 6-digit PIN to confirm',
  biometricPrompt: string = 'Unlock wallet'
): Promise<StellarWallet | null> {
  const sessionWallet = await getWalletFromSession();
  if (sessionWallet) {
    return sessionWallet;
  }

  try {
    const biometricEnabled = await AsyncStorage.getItem('biometric_enabled');
    const available = await isBiometricAvailable();
    if (biometricEnabled === 'true' && available) {
      const biometricWallet = await getWalletFromBiometricBackup(biometricPrompt);
      if (biometricWallet) {
        return biometricWallet;
      }
    }
  } catch (error) {
  }

  if (!showPINDialog) {
    return null;
  }

  const inputPin = await showPINDialog(title, message);
  if (!inputPin || inputPin.length !== 6) {
    return null;
  }

  const res = await getWallet(inputPin);
  if (res.success && res.wallet) {
    cachePinForSession(inputPin);
    return res.wallet;
  }

  return null;
}

/**
 * Unlock the wallet for a high-risk action (secret-key export, #162).
 *
 * Unlike getAuthenticatedWallet, this NEVER reuses the in-memory session
 * wallet or cached PIN: the user must pass a biometric prompt or enter their
 * PIN right now, even if they unlocked moments ago. Anyone holding an
 * already-unlocked phone therefore cannot export the seed.
 *
 * A PIN entered here is not cached for the session.
 */
export async function getFreshlyAuthenticatedWallet(
  title: string = 'Enter PIN',
  message: string = 'Enter your 6-digit PIN to confirm',
  biometricPrompt: string = 'Confirm it\'s you'
): Promise<StellarWallet | null> {
  try {
    const biometricEnabled = await AsyncStorage.getItem('biometric_enabled');
    const available = await isBiometricAvailable();
    if (biometricEnabled === 'true' && available) {
      // Reading the biometric-protected backup always shows the OS prompt.
      const biometricWallet = await getWalletFromBiometricBackup(biometricPrompt);
      if (biometricWallet) {
        return biometricWallet;
      }
    }
  } catch (error) {
    Logger.info('Biometric re-authentication unavailable, falling back to PIN');
  }

  if (!showPINDialog) {
    return null;
  }

  const inputPin = await showPINDialog(title, message);
  if (!inputPin || inputPin.length !== 6) {
    return null;
  }

  const res = await getWallet(inputPin);
  return res.success && res.wallet ? res.wallet : null;
}

/**
 * Check if biometric authentication is available on the device
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

/**
 * Get the type of biometric authentication available
 * Returns the actual biometric type that is enrolled and ready to use
 */
export async function getBiometricType(): Promise<string> {
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    
    // If no biometric is enrolled, return generic "Biometric"
    if (!hasHardware || !isEnrolled) {
      return 'Biometric';
    }
    
    // On iOS, check for Face ID first (iPhone X and later)
    if (Platform.OS === 'ios') {
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return 'Face ID';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return 'Touch ID';
      }
    }
    
    // On Android, prioritize fingerprint (most common)
    if (Platform.OS === 'android') {
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return 'Fingerprint';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return 'Face Unlock';
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        return 'Iris';
      }
    }
    
    // Fallback for other types
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'Iris';
    }
    
    return 'Biometric';
  } catch (error) {
    Logger.error('Error getting biometric type:', error);
    return 'Biometric';
  }
}

/**
 * Authenticate user with biometric (for payment confirmation)
 * Returns false if biometrics not available (caller should use PIN fallback)
 */
export async function authenticateWithBiometric(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    
    // If no biometric available, return false (caller should use PIN)
    if (!hasHardware || !isEnrolled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm Payment',
      fallbackLabel: 'Use Device Credentials',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false, // Allow device PIN/pattern
    });

    return result.success;
  } catch (error) {
    return false;
  }
}

/**
 * Authenticate user for unlocking wallet
 * Falls back to device credentials (PIN/pattern) if biometric is not enrolled
 */
export async function authenticateForUnlock(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  
  // Allow device credentials even if no biometric hardware
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock your wallet',
    fallbackLabel: 'Use Device Credentials',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false, // Allow device PIN/pattern
  });

  return result.success;
}

/**
 * Enable biometric authentication (setup flow)
 * Falls back to device credentials if biometric is not available
 */
export async function enableBiometric(options: { skipAvailabilityCheck?: boolean } = {}): Promise<boolean> {
  try {
    const available = options.skipAvailabilityCheck || await isBiometricAvailable();
    if (!available) {
      return false;
    }

    let wallet = await getWalletFromSession();

    if (!wallet && showPINDialog) {
      const pin = await showPINDialog(
        'Confirm PIN',
        'Enter your C-Pay PIN to enable biometric unlock'
      );

      if (pin) {
        const res = await getWallet(pin);
        if (res.success) {
          wallet = res.wallet;
        }
      }
    }

    if (!wallet) {
      return false;
    }

    return enableWalletBiometricBackup('Secure biometric wallet access', wallet.secret);
  } catch (error) {
    Logger.error('Biometric enable error:', error);
    return false;
  }
}
