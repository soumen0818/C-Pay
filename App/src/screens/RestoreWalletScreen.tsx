import { Logger } from '../utils/logger';
import React, { useEffect, useRef, useState } from 'react';

// Restore wallet screen: load a wallet from backup or secret recovery data.
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StellarSdk from '@stellar/stellar-base';
import { Buffer } from 'buffer';
import { Ionicons } from '@expo/vector-icons';
import { PINInput } from '../components/PINInput';
import { OnboardingProgress } from '../components/OnboardingProgress';
import { Screen } from '../components';
import {
  getCloudWalletBackup,
  restoreCloudWalletBackup,
  type CloudWalletBackupRow,
} from '../services/cloudWalletBackup';
import { cachePinForSession, hasWallet, recreateWalletFromSecret } from '../services/wallet';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';

const FONT_SIZES = TYPOGRAPHY.sizes;

// ─── Internal State Types ────────────────────────────────────────────────────

type CheckState =
  | 'checking'
  | 'existing_local_wallet'
  | 'network_error'
  | 'cloud_restore'
  | 'missing_backup'
  | 'key_restore'
  | 'pin'
  | 'confirm'
  | 'success';

// ─── Utilities ───────────────────────────────────────────────────────────────

const waitForUiPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

const normalizeRecoverySecret = (value: string): string | null => {
  const trimmed = value.trim();
  if (StellarSdk.StrKey.isValidEd25519SecretSeed(trimmed)) return trimmed;
  const hex = trimmed.replace(/^0x/i, '').replace(/[^a-fA-F0-9]/g, '');
  if (hex.length === 64) {
    try {
      return StellarSdk.StrKey.encodeEd25519SecretSeed(Buffer.from(hex, 'hex'));
    } catch {
      return null;
    }
  }
  return null;
};

const getSecretPublicKey = (secret: string): string | null => {
  try {
    return StellarSdk.Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
};

// ─── Route Params ────────────────────────────────────────────────────────────

type RestoreWalletRouteParams = {
  verifiedEmail?: string;
  walletAddress: string;
  displayName?: string | null;
  cpayId?: string | null;
  profilePhotoUrl?: string | null;
};

interface RestoreWalletScreenProps {
  navigation: any;
  route: {
    params: RestoreWalletRouteParams;
  };
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const RestoreWalletScreen: React.FC<RestoreWalletScreenProps> = ({ navigation, route }) => {
  useTheme();
  const {
    verifiedEmail,
    walletAddress,
    displayName,
    cpayId,
    profilePhotoUrl,
  } = route.params;

  const [state, setState] = useState<CheckState>('checking');
  const [cloudBackup, setCloudBackup] = useState<CloudWalletBackupRow | null>(null);
  const [cloudBackupAvailable, setCloudBackupAvailable] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [normalizedSecret, setNormalizedSecret] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [wrongPasswordAttempts, setWrongPasswordAttempts] = useState(0);
  const [restoreSource, setRestoreSource] = useState<'cloud' | 'key' | null>(null);
  const submittingRef = useRef(false);

  // ─── Success animation ────────────────────────────────────────────────────
  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkInitialState();
  }, []);

  useEffect(() => {
    if (state === 'success') {
      Animated.spring(successAnim, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }).start();
    }
  }, [state]);

  // ─── Initial Checks ───────────────────────────────────────────────────────

  const checkInitialState = async () => {
    // 1. Check if a local wallet already exists on this device
    try {
      const localWalletExists = await hasWallet();
      if (localWalletExists) {
        const localAddress = await AsyncStorage.getItem('wallet_address');
        if (localAddress && localAddress !== walletAddress) {
          setState('existing_local_wallet');
          return;
        }
      }
    } catch {
      // Ignore errors; proceed to cloud check
    }

    // 2. Try to find the cloud backup
    await refreshCloudBackup();
  };

  const refreshCloudBackup = async () => {
    setState('checking');
    try {
      const backup = await getCloudWalletBackup();
      setCloudBackup(backup);
      const available = !!backup;
      setCloudBackupAvailable(available);
      setState(available ? 'cloud_restore' : 'missing_backup');
    } catch {
      setCloudBackup(null);
      setCloudBackupAvailable(false);
      setState('network_error');
    }
  };

  // ─── Cloud backup restore ─────────────────────────────────────────────────

  const handleContinueWithCloudBackup = async () => {
    if (!recoveryPassword.trim()) {
      setError('Enter your cloud backup recovery password to continue.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const restoredBackup = await restoreCloudWalletBackup(
        recoveryPassword,
        cloudBackup || undefined
      );

      if (restoredBackup.walletAddress !== walletAddress) {
        setError('This cloud backup does not match your C-Pay profile. Try your secret key instead.');
        setLoading(false);
        return;
      }

      setNormalizedSecret(restoredBackup.secret);
      setRestoreSource('cloud');
      setPin('');
      setConfirmPin('');
      setState('pin');
    } catch (cloudError: any) {
      const msg: string = cloudError?.message || '';
      setWrongPasswordAttempts((prev) => prev + 1);

      if (/incorrect|wrong|invalid/i.test(msg)) {
        setError(
          'Incorrect recovery password. Check for typos — it\'s case-sensitive and must match what you set during backup.'
        );
      } else {
        setError(msg || 'Could not restore from cloud backup. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Secret key restore ───────────────────────────────────────────────────

  const handleContinueWithKey = () => {
    const secret = normalizeRecoverySecret(recoveryKey);
    const recoveredAddress = secret ? getSecretPublicKey(secret) : null;

    if (!secret || !recoveredAddress) {
      setError(
        'Enter a valid Stellar secret key (starts with "S") or a 64-character hex private key.'
      );
      return;
    }

    if (recoveredAddress !== walletAddress) {
      setError(
        'This recovery key belongs to a different wallet. Make sure you copied the right key from your backup.'
      );
      return;
    }

    setError('');
    setNormalizedSecret(secret);
    setRestoreSource('key');
    setPin('');
    setConfirmPin('');
    setState('pin');
  };

  // ─── PIN entry ────────────────────────────────────────────────────────────

  const handlePinChange = (value: string) => {
    setPin(value);
    setConfirmPin('');
    setError('');

    if (value.length === 6) {
      if (['123456', '000000', '111111', '654321', '999999', '112233'].includes(value)) {
        setError('Please choose a stronger PIN. Avoid predictable sequences.');
        setTimeout(() => setPin(''), 250);
        return;
      }
      setState('confirm');
    }
  };

  // ─── Wallet recreation ────────────────────────────────────────────────────

  const saveRestoredLocalProfile = async () => {
    const writes: [string, string][] = [
      ['wallet_address', walletAddress],
      ['profile_complete', 'true'],
      ['biometric_enabled', 'false'],
    ];

    if (verifiedEmail) writes.push(['email_verified', 'true'], ['user_email', verifiedEmail]);
    if (displayName) writes.push(['display_name', displayName]);
    if (cpayId) writes.push(['cpay_id', cpayId]);
    if (profilePhotoUrl) writes.push(['profile_photo', profilePhotoUrl]);

    await AsyncStorage.multiSet(writes);
  };

  const restoreWalletAndContinue = async (pinToConfirm: string) => {
    if (submittingRef.current) return;

    if (pinToConfirm.length !== 6) {
      setError('Please enter a 6-digit PIN.');
      return;
    }

    if (pinToConfirm !== pin) {
      setError('PINs do not match. Let\'s start again with a fresh PIN.');
      setTimeout(() => {
        setConfirmPin('');
        setPin('');
        setState('pin');
      }, 400);
      return;
    }

    submittingRef.current = true;
    setError('');
    setLoading(true);
    await waitForUiPaint();

    try {
      const derivedAddress = getSecretPublicKey(normalizedSecret);
      if (!derivedAddress || derivedAddress !== walletAddress) {
        throw new Error('Restored wallet does not match your profile wallet.');
      }

      const restoredAddress = await recreateWalletFromSecret(normalizedSecret, pinToConfirm);
      if (restoredAddress !== walletAddress) {
        throw new Error('Restored wallet does not match your profile wallet.');
      }

      await saveRestoredLocalProfile();
      const isCloudRestore = restoreSource === 'cloud';
      await AsyncStorage.multiSet([
        ['cloud_backup_complete', isCloudRestore ? 'true' : 'false'],
        ['cloud_backup_required', isCloudRestore ? 'false' : 'true'],
      ]);
      cachePinForSession(pinToConfirm);

      // Background syncs — non-blocking
      void supabase
        .from('users')
        .update({ biometric_enabled: false })
        .eq('wallet_address', walletAddress)
        .then(() => {});

      // Show success state
      setState('success');
    } catch (restoreError) {
      Logger.error('Wallet restore error:', restoreError);
      submittingRef.current = false;
      setLoading(false);
      AlertManager.alert(
        'Restore Failed',
        'Could not restore this wallet. This usually means the recovery key or cloud backup is for a different wallet. Please double-check and try again.',
        undefined,
        { type: 'error' }
      );
    }
  };

  const handleConfirmPin = (value: string) => {
    setConfirmPin(value);
    setError('');
    if (value.length === 6) {
      void restoreWalletAndContinue(value);
    }
  };

  // ─── Navigation after restore ─────────────────────────────────────────────

  const handleContinueAfterSuccess = () => {
    navigation.replace('BiometricSetup', { flowType: 'restore' });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const renderHeader = (icon: string, title: string, subtitle: string, iconColor = COLORS.primary) => (
    <View style={styles.sectionHeader}>
      <View style={[styles.iconCircle, { backgroundColor: iconColor + '18' }]}>
        <Ionicons name={icon as any} size={34} color={iconColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );

  const renderProfileBox = () => (
    <View style={styles.profileBox}>
      <View style={styles.profileAvatar}>
        <Ionicons name="wallet-outline" size={18} color={COLORS.primary} />
      </View>
      <View style={styles.profileText}>
        <Text style={styles.profileName}>{displayName || 'Your C-Pay Wallet'}</Text>
        <Text style={styles.profileWallet} numberOfLines={1}>
          {walletAddress}
        </Text>
      </View>
    </View>
  );

  // ─── State: checking ─────────────────────────────────────────────────────

  if (state === 'checking') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.checkingTitle}>Looking for your backup…</Text>
          <Text style={styles.checkingSubtitle}>
            Checking for an encrypted cloud backup linked to your email.
          </Text>
        </View>
      </Screen>
    );
  }

  // ─── State: existing_local_wallet ────────────────────────────────────────

  if (state === 'existing_local_wallet') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {renderHeader('warning-outline', 'Wallet Already on Device', 'A different wallet is already stored on this device.', COLORS.warning)}

          <View style={[styles.alertBox, { borderColor: COLORS.warningLight, backgroundColor: COLORS.warningBg }]}>
            <Ionicons name="information-circle-outline" size={20} color={COLORS.warning} />
            <Text style={[styles.alertText, { color: COLORS.warningDark }]}>
              Restoring will replace the current local wallet with the one linked to this email. Make sure you have a backup of the existing wallet first.
            </Text>
          </View>

          {renderProfileBox()}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: COLORS.warning }]}
            onPress={async () => {
              await refreshCloudBackup();
            }}
          >
            <Text style={styles.primaryButtonText}>Proceed & Restore This Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.replace('Login')}
          >
            <Text style={styles.secondaryButtonText}>Keep Current Wallet & Log In</Text>
          </TouchableOpacity>
        </ScrollView>
      </Screen>
    );
  }

  // ─── State: network_error ────────────────────────────────────────────────

  if (state === 'network_error') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {renderHeader('cloud-offline-outline', 'Connection Problem', 'We could not reach the backup server. Check your internet connection and try again.', COLORS.error)}

          <View style={[styles.alertBox, { borderColor: COLORS.errorLight, backgroundColor: COLORS.errorBg }]}>
            <Ionicons name="wifi-outline" size={20} color={COLORS.error} />
            <Text style={[styles.alertText, { color: COLORS.errorDark }]}>
              Your cloud backup could not be loaded. This is usually a temporary issue.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={refreshCloudBackup}
          >
            <Ionicons name="refresh-outline" size={18} color={COLORS.textInverse} style={{ marginRight: SPACING.xs }} />
            <Text style={styles.primaryButtonText}>Retry Connection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => { setError(''); setState('key_restore'); }}
          >
            <Text style={styles.secondaryButtonText}>Restore with Secret Key Instead</Text>
          </TouchableOpacity>
        </ScrollView>
      </Screen>
    );
  }

  // ─── State: missing_backup ───────────────────────────────────────────────

  if (state === 'missing_backup') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {renderHeader('cloud-outline', 'No Cloud Backup Found', 'We did not find an encrypted cloud backup linked to this email.', COLORS.warning)}

          {renderProfileBox()}

          <View style={[styles.alertBox, { borderColor: COLORS.warningLight, backgroundColor: COLORS.warningBg }]}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.warning} />
            <Text style={[styles.alertText, { color: COLORS.warningDark }]}>
              If you previously set up cloud backup, try the secret key option below. If you never set up a backup, unfortunately this wallet cannot be recovered.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => { setError(''); setState('key_restore'); }}
          >
            <Ionicons name="key-outline" size={18} color={COLORS.textInverse} style={{ marginRight: SPACING.xs }} />
            <Text style={styles.primaryButtonText}>Restore with Stellar Secret Key</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => AlertManager.alert(
              'Replace your wallet?',
              'Your current wallet cannot be recovered without its secret key or backup. Creating a new wallet will deactivate the old wallet binding and move your C-Pay ID to the new wallet. Any funds in the old wallet will remain inaccessible.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Replace Wallet',
                  style: 'destructive',
                  onPress: () => navigation.replace('CreatePIN', { walletReplacement: true, cpayId }),
                },
              ],
              { type: 'warning' },
            )}
          >
            <Text style={styles.secondaryButtonText}>Create a New Wallet Instead</Text>
          </TouchableOpacity>
        </ScrollView>
      </Screen>
    );
  }

  // ─── State: cloud_restore ────────────────────────────────────────────────

  if (state === 'cloud_restore') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {renderHeader('cloud-done-outline', 'Cloud Backup Found!', 'Enter your recovery password to decrypt and restore your wallet.')}

            {renderProfileBox()}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Recovery Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  value={recoveryPassword}
                  onChangeText={(v) => { setRecoveryPassword(v); setError(''); }}
                  placeholder="Enter your recovery password"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={22}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.alertBox, { borderColor: COLORS.infoLight, backgroundColor: COLORS.infoBg }]}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.info} />
              <Text style={[styles.alertText, { color: COLORS.infoDark }]}>
                This password was created when you set up cloud backup. C-Pay never stores it — only you know it.
              </Text>
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                <Text style={styles.errorBoxText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, (loading || !recoveryPassword.trim()) && styles.buttonDisabled]}
              onPress={handleContinueWithCloudBackup}
              disabled={loading || !recoveryPassword.trim()}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.textInverse} />
              ) : (
                <Text style={styles.primaryButtonText}>Decrypt & Restore Wallet</Text>
              )}
            </TouchableOpacity>

            {wrongPasswordAttempts >= 2 && (
              <View style={[styles.alertBox, { borderColor: COLORS.warningLight, backgroundColor: COLORS.warningBg, marginTop: SPACING.md }]}>
                <Ionicons name="help-circle-outline" size={18} color={COLORS.warning} />
                <Text style={[styles.alertText, { color: COLORS.warningDark }]}>
                  Having trouble? Make sure the password matches exactly — it's case-sensitive. You can also restore using your Stellar secret key below.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => { setError(''); setState('key_restore'); }}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Use Secret Key Instead</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ─── State: key_restore ──────────────────────────────────────────────────

  if (state === 'key_restore') {
    return (
      <Screen scroll={false} padded={false} keyboardAvoiding={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {renderHeader('key-outline', 'Restore with Secret Key', 'Paste your exported Stellar secret key to restore this wallet.')}

            {renderProfileBox()}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Stellar Secret Key</Text>
              <TextInput
                style={styles.singleLineInput}
                value={recoveryKey}
                onChangeText={(v) => { setRecoveryKey(v); setError(''); }}
                placeholder="Starts with S… (56 characters)"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                secureTextEntry
                editable={!loading}
              />
            </View>

            <View style={[styles.alertBox, { borderColor: COLORS.warningLight, backgroundColor: COLORS.warningBg }]}>
              <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
              <Text style={[styles.alertText, { color: COLORS.warningDark }]}>
                If you never exported your key or set up cloud backup before clearing your data, this wallet cannot be recovered.
              </Text>
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                <Text style={styles.errorBoxText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, (loading || !recoveryKey.trim()) && styles.buttonDisabled]}
              onPress={handleContinueWithKey}
              disabled={loading || !recoveryKey.trim()}
            >
              <Text style={styles.primaryButtonText}>Continue with This Key</Text>
            </TouchableOpacity>

            {cloudBackupAvailable && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => { setError(''); setState('cloud_restore'); }}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Back to Cloud Backup</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.replace('CreatePIN')}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Create a New Wallet Instead</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ─── State: pin ──────────────────────────────────────────────────────────

  if (state === 'pin') {
    return (
      <Screen scroll={false} padded={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <ScrollView contentContainerStyle={styles.pinContent} keyboardShouldPersistTaps="handled">
          <View style={styles.pinHeader}>
            <Image
              source={require('../../assets/cpay_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Create a New PIN</Text>
            <Text style={styles.subtitle}>
              Choose 6 digits to secure your restored wallet on this device.
            </Text>
          </View>

          <View style={[styles.alertBox, { borderColor: COLORS.infoLight, backgroundColor: COLORS.infoBg, marginBottom: SPACING.lg }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.info} />
            <Text style={[styles.alertText, { color: COLORS.infoDark }]}>
              Avoid simple patterns like 123456. You'll use this PIN every time you open C-Pay.
            </Text>
          </View>

          <View style={styles.pinSection}>
            <PINInput value={pin} onChange={handlePinChange} error={error} autoFocus disabled={loading} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // ─── State: confirm ──────────────────────────────────────────────────────

  if (state === 'confirm') {
    return (
      <Screen scroll={false} padded={false}>
        <OnboardingProgress currentStep={2} flowType="restore" />
        <View style={styles.pinContent}>
          <View style={styles.pinHeader}>
            <Image
              source={require('../../assets/cpay_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Confirm Your PIN</Text>
            <Text style={styles.subtitle}>
              Re-enter the same 6 digits to make sure you typed it correctly.
            </Text>
          </View>

          <View style={styles.pinSection}>
            <PINInput
              value={confirmPin}
              onChange={handleConfirmPin}
              error={error}
              autoFocus
              disabled={loading}
            />
          </View>

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Restoring your wallet securely…</Text>
            </View>
          )}
        </View>
      </Screen>
    );
  }

  // ─── State: success ──────────────────────────────────────────────────────

  return (
    <Screen scroll={false} padded={false} keyboardAvoiding={false}>
      <OnboardingProgress currentStep={2} flowType="restore" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Animated.View
          style={[
            styles.successIconWrap,
            { transform: [{ scale: successAnim }], opacity: successAnim },
          ]}
        >
          <Ionicons name="checkmark-circle" size={72} color={COLORS.success} />
        </Animated.View>

        <Text style={styles.successTitle}>Wallet Restored!</Text>
        <Text style={styles.successSubtitle}>
          Your wallet has been securely restored and re-encrypted on this device.
        </Text>

        <View style={styles.successProfileCard}>
          <View style={styles.successAvatar}>
            <Ionicons name="person-outline" size={28} color={COLORS.primary} />
          </View>
          <View style={styles.successProfileInfo}>
            <Text style={styles.successProfileName}>{displayName || 'Your Wallet'}</Text>
            <Text style={styles.successWalletAddress} numberOfLines={1}>
              {walletAddress}
            </Text>
            {verifiedEmail && (
              <Text style={styles.successEmail}>{verifiedEmail}</Text>
            )}
          </View>
        </View>

        <View style={[styles.alertBox, { borderColor: COLORS.successLight, backgroundColor: COLORS.successBg }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.success} />
          <Text style={[styles.alertText, { color: COLORS.successDark }]}>
            Your wallet secret is encrypted on this device. Next, you can enable biometric unlock for quick, secure access.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: COLORS.success }]}
          onPress={handleContinueAfterSuccess}
        >
          <Text style={styles.primaryButtonText}>Next: Security Setup →</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flexGrow: 1,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  pinContent: {
    flex: 1,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  checkingTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },
  checkingSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionHeader: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  profileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  profileWallet: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  singleLineInput: {
    minHeight: 52,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
  },
  passwordRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
  },
  eyeButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBox: {
    flexDirection: 'row',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'flex-start',
  },
  alertText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    lineHeight: 19,
  },
  errorBox: {
    flexDirection: 'row',
    gap: SPACING.sm,
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorLight,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'flex-start',
  },
  errorBoxText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.error,
    lineHeight: 19,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    ...SHADOWS.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  // PIN screens
  pinHeader: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: SPACING.md,
  },
  pinSection: {
    marginBottom: SPACING.xl,
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  // Success screen
  successIconWrap: {
    alignSelf: 'center',
    marginBottom: SPACING.md,
    marginTop: SPACING.xl,
  },
  successTitle: {
    fontSize: FONT_SIZES.xxxl,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  successSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  successProfileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  successAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successProfileInfo: {
    flex: 1,
  },
  successProfileName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  successWalletAddress: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
  successEmail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary,
    fontWeight: '500',
  },
}));
