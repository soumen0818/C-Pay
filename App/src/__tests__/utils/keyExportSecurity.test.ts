/**
 * #162: secret-key export must always require fresh authentication, the
 * copied seed must be cleared from the clipboard automatically, and screen
 * capture must be blocked while the key is visible.
 */

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }), { virtual: true });
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(false),
  isEnrolledAsync: jest.fn().mockResolvedValue(false),
  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([]),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}), { virtual: true });
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }), { virtual: true });
jest.mock('../../services/wallet', () => ({
  cachePinForSession: jest.fn(),
  enableWalletBiometricBackup: jest.fn(),
  getWallet: jest.fn(),
  getWalletFromBiometricBackup: jest.fn(),
  getWalletFromSession: jest.fn(),
  unlockWithPin: jest.fn(),
}));

import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as walletService from '../../services/wallet';
import {
  getAuthenticatedWallet,
  getFreshlyAuthenticatedWallet,
  setPINDialogHandler,
} from '../../utils/biometric';
import {
  __isHoldingSensitiveClipboard,
  clearSensitiveClipboard,
  copySensitiveToClipboard,
  SENSITIVE_CLIPBOARD_CLEAR_SECONDS,
} from '../../utils/secureClipboard';
import {
  __resetScreenCaptureForTests,
  addScreenshotListener,
  allowScreenCapture,
  isScreenCaptureProtectionAvailable,
  preventScreenCapture,
} from '../../utils/screenCapture';

const wallet = walletService as jest.Mocked<typeof walletService>;
const SESSION_WALLET = { publicKey: 'GSESSION', secret: 'SSESSION' } as any;
const FRESH_WALLET = { publicKey: 'GFRESH', secret: 'SFRESH' } as any;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  wallet.getWalletFromSession.mockResolvedValue(SESSION_WALLET);
});

describe('getFreshlyAuthenticatedWallet', () => {
  test('prompts for the PIN even inside an active unlock session', async () => {
    const pinDialog = jest.fn().mockResolvedValue('123456');
    setPINDialogHandler(pinDialog);
    wallet.getWallet.mockResolvedValue({ success: true, wallet: FRESH_WALLET } as any);

    // Sanity: the ordinary helper reuses the session silently.
    await expect(getAuthenticatedWallet()).resolves.toBe(SESSION_WALLET);
    expect(pinDialog).not.toHaveBeenCalled();

    const result = await getFreshlyAuthenticatedWallet('Export Wallet Key', 'Enter PIN');
    expect(result).toBe(FRESH_WALLET);
    expect(pinDialog).toHaveBeenCalledTimes(1);
    expect(wallet.getWallet).toHaveBeenCalledWith('123456');
    // The export path never consults the session cache and never caches the PIN.
    expect(wallet.cachePinForSession).not.toHaveBeenCalled();
  });

  test('uses a biometric prompt (not the session) when biometrics are enabled', async () => {
    await AsyncStorage.setItem('biometric_enabled', 'true');
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValueOnce(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValueOnce(true);
    wallet.getWalletFromBiometricBackup.mockResolvedValue(FRESH_WALLET);
    const pinDialog = jest.fn();
    setPINDialogHandler(pinDialog);

    await expect(getFreshlyAuthenticatedWallet()).resolves.toBe(FRESH_WALLET);
    expect(wallet.getWalletFromBiometricBackup).toHaveBeenCalledTimes(1);
    expect(wallet.getWalletFromSession).not.toHaveBeenCalled();
    expect(pinDialog).not.toHaveBeenCalled();
  });

  test('returns null when the user cancels or enters a wrong PIN', async () => {
    setPINDialogHandler(jest.fn().mockResolvedValue(null));
    await expect(getFreshlyAuthenticatedWallet()).resolves.toBeNull();

    setPINDialogHandler(jest.fn().mockResolvedValue('000000'));
    wallet.getWallet.mockResolvedValue({ success: false, wallet: null } as any);
    await expect(getFreshlyAuthenticatedWallet()).resolves.toBeNull();
  });
});

describe('secure clipboard', () => {
  afterEach(async () => {
    await clearSensitiveClipboard();
    jest.useRealTimers();
  });

  test('clears the copied secret automatically after the timeout', async () => {
    jest.useFakeTimers();
    await copySensitiveToClipboard('SSECRET');
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('SSECRET');
    expect(__isHoldingSensitiveClipboard()).toBe(true);

    jest.advanceTimersByTime(SENSITIVE_CLIPBOARD_CLEAR_SECONDS * 1000 - 1);
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('');
    expect(__isHoldingSensitiveClipboard()).toBe(false);
  });

  test('clears the copied secret when the app goes to the background', async () => {
    await copySensitiveToClipboard('SSECRET');
    const calls = (AppState.addEventListener as jest.Mock).mock.calls;
    const listener = calls[calls.length - 1][1];

    listener('active');
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);

    listener('background');
    await Promise.resolve();
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('');
  });

  test('does not touch the clipboard when no secret is pending', async () => {
    await clearSensitiveClipboard();
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });
});

describe('screen capture protection', () => {
  beforeEach(() => __resetScreenCaptureForTests());

  test('blocks capture through expo-screen-capture while a secret is shown', async () => {
    const native = {
      preventScreenCapture: jest.fn().mockResolvedValue(undefined),
      allowScreenCapture: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
    };
    (requireOptionalNativeModule as jest.Mock).mockReturnValue(native);

    expect(isScreenCaptureProtectionAvailable()).toBe(true);
    await expect(preventScreenCapture('a')).resolves.toBe(true);
    await expect(preventScreenCapture('b')).resolves.toBe(true);
    expect(native.preventScreenCapture).toHaveBeenCalledTimes(1);

    const onShot = jest.fn();
    addScreenshotListener(onShot);
    expect(native.addListener).toHaveBeenCalledWith('onScreenshot', expect.any(Function));

    await allowScreenCapture('a');
    expect(native.allowScreenCapture).not.toHaveBeenCalled();
    await allowScreenCapture('b');
    expect(native.allowScreenCapture).toHaveBeenCalledTimes(1);
  });

  test('reports unavailable instead of crashing when the module is not linked', async () => {
    (requireOptionalNativeModule as jest.Mock).mockReturnValue(null);
    expect(isScreenCaptureProtectionAvailable()).toBe(false);
    await expect(preventScreenCapture('a')).resolves.toBe(false);
    expect(addScreenshotListener(jest.fn())).toBeNull();
  });
});
