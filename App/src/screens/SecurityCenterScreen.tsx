import { Logger } from '../utils/logger';
import React, { useEffect, useState } from 'react';

// Security center screen: access protection and risk controls overview.
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Modal,
  Platform,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import {
  isBiometricAvailable,
  getBiometricType,
  enableBiometric,
  getFreshlyAuthenticatedWallet,
} from '../utils/biometric';
import {
  clearSensitiveClipboard,
  copySensitiveToClipboard,
  SENSITIVE_CLIPBOARD_CLEAR_SECONDS,
} from '../utils/secureClipboard';
import { useScreenCaptureProtection } from '../utils/screenCapture';
import {
  clearBiometricBackup,
  hasBiometricBackup,
  SESSION_TIMEOUT_MINUTES,
} from '../services/wallet';
import { getTransactionLimitsStatus } from '../services/securityLimits';
import { formatMoneyAmount } from '../utils/currency';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { Screen, Header, Section, ActionRow, InfoBanner } from '../components';
import { AlertManager } from '../utils/alert';
import { deleteAccount } from '../services/auth';

type ExportedKey = {
  title: string;
  description: string;
  value: string;
  valueLabel: string;
  warning: string;
};

interface SecurityCenterScreenProps {
  navigation: any;
}

export const SecurityCenterScreen: React.FC<SecurityCenterScreenProps> = ({ navigation }) => {
  useTheme();
  const [walletAddress, setWalletAddress] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricSaving, setBiometricSaving] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometric');
  const [backupComplete, setBackupComplete] = useState(false);
  const [dailyLimitLabel, setDailyLimitLabel] = useState('');
  const [exportedKey, setExportedKey] = useState<ExportedKey | null>(null);
  const [showExportedKey, setShowExportedKey] = useState(false);
  const biometricSavingRef = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      loadSecurity();
    }, [])
  );

  const loadSecurity = async () => {
    const [address, biometricSetting, available, type, backupAvailable, cloudComplete] = await Promise.all([
      AsyncStorage.getItem('wallet_address'),
      AsyncStorage.getItem('biometric_enabled'),
      isBiometricAvailable(),
      getBiometricType(),
      hasBiometricBackup(),
      AsyncStorage.getItem('cloud_backup_complete'),
    ]);

    if (address) setWalletAddress(address);
    setBiometricType(type);
    setBiometricAvailable(available);
    setBackupComplete(cloudComplete === 'true');

    if (!biometricSavingRef.current) {
      setBiometricEnabled(biometricSetting === 'true' && available && backupAvailable);
    }

    try {
      const limits = await getTransactionLimitsStatus();
      setDailyLimitLabel(
        `${formatMoneyAmount(limits.remaining.amount)} of ${formatMoneyAmount(limits.maxDailyAmount)} left today`
      );
    } catch {
      setDailyLimitLabel('');
    }
  };

  const syncBiometricPreference = (enabled: boolean) => {
    void (async () => {
      try {
        const address = await AsyncStorage.getItem('wallet_address');
        if (!address) return;
        await supabase.from('users').update({ biometric_enabled: enabled }).eq('wallet_address', address);
      } catch (error) {
        Logger.info('Failed to sync biometric preference:', error);
      }
    })();
  };

  const handleToggleBiometric = async (value: boolean) => {
    if (biometricSaving) return;

    biometricSavingRef.current = true;
    setBiometricSaving(true);
    setBiometricEnabled(value);

    try {
      if (value) {
        let available = biometricAvailable;
        let type = biometricType;

        if (!available) {
          [available, type] = await Promise.all([isBiometricAvailable(), getBiometricType()]);
          setBiometricAvailable(available);
          setBiometricType(type);
        }

        if (!available) {
          setBiometricEnabled(false);
          AlertManager.alert('Not Available', `${type} is not set up on this device. Please enable it in your device settings.`);
          return;
        }

        const enabled = await enableBiometric({ skipAvailabilityCheck: true });
        if (!enabled) {
          setBiometricEnabled(false);
          AlertManager.alert('Not Enabled', 'Biometric unlock was not enabled. Your PIN still works as usual.', undefined, { type: 'info' });
          return;
        }

        await AsyncStorage.setItem('biometric_enabled', 'true');
        syncBiometricPreference(true);
      } else {
        await clearBiometricBackup();
        await AsyncStorage.setItem('biometric_enabled', 'false');
        syncBiometricPreference(false);
      }
    } catch (error) {
      setBiometricEnabled(!value);
      Logger.error('Biometric setting update failed:', error);
      AlertManager.alert('Biometric Error', 'Could not update biometric unlock. Please try again.', undefined, { type: 'error' });
    } finally {
      biometricSavingRef.current = false;
      setBiometricSaving(false);
    }
  };

  const formatRawPrivateKey = (bytes: Uint8Array): string =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

  const maskKey = (value: string): string => {
    if (value.length <= 12) return '•'.repeat(value.length);
    return `${value.slice(0, 4)}${'•'.repeat(12)}${value.slice(-6)}`;
  };

  const handleShowWalletAddress = () => {
    if (!walletAddress) {
      AlertManager.alert('Not Available', 'Wallet address is not available yet.');
      return;
    }
    setExportedKey({
      title: 'Wallet Address',
      description: 'Your public Stellar account address. Safe to share with other Stellar apps or exchanges.',
      value: walletAddress,
      valueLabel: 'Address',
      warning: 'For normal C-Pay payments, share your C-Pay ID instead of this wallet address.',
    });
    setShowExportedKey(true);
  };

  // Private/secret key export requires an explicit confirmation BEFORE unlock.
  const handleExportWalletKey = (type: 'private' | 'stellar') => {
    const isPrivateKey = type === 'private';
    const label = isPrivateKey ? 'private key' : 'Stellar secret key';

    AlertManager.alert(
      `Reveal ${label}?`,
      `Anyone with your ${label} can move all of your funds. Never share it, screenshot it, or enter it on any website. Only continue if you are in a private place.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I understand, continue',
          style: 'destructive',
          onPress: () => revealWalletKey(type),
        },
      ]
    );
  };

  const revealWalletKey = async (type: 'private' | 'stellar') => {
    // Always re-authenticate: an active unlock session is NOT enough to export
    // the secret seed (#162).
    const wallet = await getFreshlyAuthenticatedWallet(
      'Export Wallet Key',
      'Enter your C-Pay PIN to export this key',
      'Confirm it\'s you to export your wallet key'
    );

    if (!wallet) {
      AlertManager.alert('Authentication Required', 'Confirm with your PIN or biometric to export keys.');
      return;
    }

    const isPrivateKey = type === 'private';
    const value = isPrivateKey ? formatRawPrivateKey(wallet.keypair.rawSecretKey()) : wallet.secret;

    setExportedKey({
      title: isPrivateKey ? 'Private Key' : 'Stellar Secret Key',
      description: isPrivateKey
        ? 'Raw Ed25519 private seed in hex format.'
        : 'Importable Stellar secret seed. This starts with S.',
      valueLabel: 'Key',
      value,
      warning: isPrivateKey
        ? 'Anyone with this private key can control your C-Pay wallet.'
        : 'Anyone with this Stellar secret key can control your C-Pay wallet.',
    });
    setShowExportedKey(false);
  };

  const handleCopyExportedKey = async () => {
    if (!exportedKey) return;
    if (exportedKey.valueLabel === 'Key') {
      await copySensitiveToClipboard(exportedKey.value);
      AlertManager.alert(
        'Copied',
        `${exportedKey.title} copied. For your safety the clipboard is cleared automatically in ${SENSITIVE_CLIPBOARD_CLEAR_SECONDS} seconds or as soon as you leave C-Pay.`,
        undefined,
        { type: 'success' }
      );
      return;
    }
    await Clipboard.setStringAsync(exportedKey.value);
    AlertManager.alert('Copied', `${exportedKey.title} copied to clipboard.`, undefined, { type: 'success' });
  };

  const handleCloseExportedKey = () => {
    setExportedKey(null);
    setShowExportedKey(false);
  };

  const isSecret = exportedKey?.valueLabel === 'Key';

  // Block screenshots / recording while a secret is on screen (#162).
  const screenCapture = useScreenCaptureProtection('security-center-key-export', isSecret, () => {
    AlertManager.alert(
      'Screenshot Detected',
      'A screenshot was taken while your secret key was visible. Delete it now. Anyone who gets that image can take all of your funds.',
      undefined,
      { type: 'warning' }
    );
  });

  // Hide the secret if C-Pay leaves the foreground while it is displayed.
  useEffect(() => {
    if (!isSecret) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setExportedKey(null);
        setShowExportedKey(false);
      }
    });
    return () => subscription.remove();
  }, [isSecret]);

  // Leaving the Security Center wipes any secret still on the clipboard.
  useEffect(() => () => {
    void clearSensitiveClipboard();
  }, []);

  const screenCaptureNotice = !isSecret
    ? null
    : Platform.OS === 'android' && screenCapture.available
      ? 'Screenshots and screen recording are blocked while this key is visible.'
      : Platform.OS === 'ios' && screenCapture.available
        ? 'iOS cannot block screenshots. Screen recording is blocked, and you will be warned if a screenshot is taken. Do not screenshot this key.'
        : 'Screenshot protection is unavailable on this device. Do not screenshot or screen-record this key.';

  const handleDeleteAccount = () => {
    AlertManager.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account? This action removes your profile, C-Pay ID, cloud backup, and all server data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              AlertManager.alert('Account Deleted', 'Your account has been deleted successfully.', [
                {
                  text: 'OK',
                  onPress: () =>
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'Splash' }],
                    }),
                },
              ]);
            } catch {
              AlertManager.alert('Delete Failed', 'Unable to delete account. Please try again.', undefined, {
                type: 'error',
              });
            }
          },
        },
      ]
    );
  };

  return (
    <Screen header={<Header title="Security Center" onBack={() => navigation.goBack()} />}>
      <InfoBanner
        variant="info"
        icon="shield-checkmark-outline"
        message="Manage how you sign in and protect your wallet. Keep your PIN and recovery keys private — C-Pay can never recover them for you."
        style={styles.gap}
      />

      {/* Sign in & unlock */}
      <Section title="Sign in & unlock">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="keypad-outline"
            title="Change PIN"
            subtitle="Update your 6-digit PIN"
            onPress={() => navigation.navigate('ChangePIN')}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="finger-print-outline"
            title={biometricType}
            subtitle={
              biometricSaving
                ? 'Updating biometric unlock…'
                : biometricAvailable
                  ? `Quick unlock with ${biometricType.toLowerCase()}`
                  : 'Set up biometrics in device settings to enable'
            }
            right={
              <Switch
                value={biometricEnabled}
                onValueChange={handleToggleBiometric}
                disabled={biometricSaving}
                trackColor={{ false: COLORS.border, true: COLORS.primary + '50' }}
                thumbColor={biometricEnabled ? COLORS.primary : COLORS.textMuted}
              />
            }
          />
        </View>
      </Section>

      {/* Backup & recovery */}
      <Section title="Backup & recovery">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="cloud-done-outline"
            iconColor={backupComplete ? COLORS.success : COLORS.warning}
            iconBackground={backupComplete ? COLORS.successBg : COLORS.warningBg}
            title="Cloud backup"
            subtitle={backupComplete ? 'Encrypted backup is up to date' : 'Not backed up yet — set up recovery'}
            value={backupComplete ? 'On' : 'Off'}
            onPress={() => navigation.navigate('CloudBackupSetup', { fromSettings: true })}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="qr-code-outline"
            title="Wallet address"
            subtitle="Show your public Stellar address"
            onPress={handleShowWalletAddress}
          />
        </View>
      </Section>

      {/* Export keys */}
      <Section title="Export keys">
        <InfoBanner
          variant="warning"
          message="These keys give full control of your wallet. Only export them to move your wallet to another app, and store them somewhere only you can access."
          style={styles.gap}
        />
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="key-outline"
            iconColor={COLORS.warning}
            iconBackground={COLORS.warningBg}
            title="Recovery key"
            subtitle="Export your Stellar secret key"
            onPress={() => handleExportWalletKey('stellar')}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="wallet-outline"
            iconColor={COLORS.warning}
            iconBackground={COLORS.warningBg}
            title="Private key"
            subtitle="Export raw Ed25519 private key"
            onPress={() => handleExportWalletKey('private')}
          />
        </View>
      </Section>

      {/* Limits & session */}
      <Section title="Limits & session">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="speedometer-outline"
            title="Daily limit"
            subtitle={dailyLimitLabel || 'Daily spending limit applies'}
            showChevron={false}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="time-outline"
            title="Auto-lock"
            subtitle={`Wallet locks after ${SESSION_TIMEOUT_MINUTES} minutes of inactivity`}
            showChevron={false}
          />
        </View>
      </Section>

      {/* Account & data */}
      <Section title="Account & data">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="trash-outline"
            iconColor={COLORS.error}
            iconBackground={COLORS.error + '15'}
            title="Delete my account"
            subtitle="Permanently erase your account, cloud backup, and data"
            onPress={handleDeleteAccount}
          />
        </View>
      </Section>

      {/* Reveal / copy modal */}
      <Modal
        visible={!!exportedKey}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={handleCloseExportedKey}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.exportModal}>
            <View style={styles.exportModalHeader}>
              <View style={[styles.exportIconCircle, isSecret && styles.exportIconCircleWarn]}>
                <Ionicons name="key-outline" size={24} color={isSecret ? COLORS.warning : COLORS.primary} />
              </View>
              <TouchableOpacity onPress={handleCloseExportedKey} style={styles.exportCloseButton}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.exportTitle}>{exportedKey?.title}</Text>
            <Text style={styles.exportDescription}>{exportedKey?.description}</Text>

            <View style={styles.exportWarning}>
              <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
              <Text style={styles.exportWarningText}>{exportedKey?.warning}</Text>
            </View>

            {isSecret && (
              <View style={styles.exportWarning}>
                <Ionicons name="eye-off-outline" size={18} color={COLORS.warning} />
                <Text style={styles.exportWarningText}>
                  {screenCaptureNotice} Copied keys are cleared from the clipboard after {SENSITIVE_CLIPBOARD_CLEAR_SECONDS} seconds or when you leave C-Pay.
                </Text>
              </View>
            )}

            <View style={styles.exportKeyBox}>
              <Text style={styles.exportKeyLabel}>{exportedKey?.valueLabel || 'Value'}</Text>
              <Text style={styles.exportKeyValue} selectable={showExportedKey}>
                {exportedKey ? (showExportedKey ? exportedKey.value : maskKey(exportedKey.value)) : ''}
              </Text>
            </View>

            <View style={styles.exportActions}>
              <TouchableOpacity
                style={styles.exportSecondaryButton}
                onPress={() => setShowExportedKey((current) => !current)}
              >
                <Ionicons name={showExportedKey ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.primary} />
                <Text style={styles.exportSecondaryButtonText}>{showExportedKey ? 'Hide' : 'Reveal'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.exportPrimaryButton} onPress={handleCopyExportedKey}>
                <Ionicons name="copy-outline" size={18} color={COLORS.textInverse} />
                <Text style={styles.exportPrimaryButtonText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  gap: {
    marginBottom: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
  },
  rowFlat: {
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  exportModal: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.lg,
  },
  exportModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  exportIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportIconCircleWarn: {
    backgroundColor: COLORS.warningBg,
  },
  exportCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  exportTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  exportDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  exportWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    backgroundColor: COLORS.warningBg,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  exportWarningText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.warningDark,
    lineHeight: 18,
  },
  exportKeyBox: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  exportKeyLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  exportKeyValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 20,
  },
  exportActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  exportSecondaryButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  exportSecondaryButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.primary,
  },
  exportPrimaryButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  exportPrimaryButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.textInverse,
  },
}));
