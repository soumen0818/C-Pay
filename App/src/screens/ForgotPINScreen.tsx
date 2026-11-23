import { Logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';

// Forgot PIN screen: recovery path for users locked out of their wallet.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { 
  cachePinForSession,
  recoverWalletWithBiometric, 
  hasBiometricBackup,
  recreateWalletFromSecret
} from '../services/wallet';
import { isBiometricAvailable, getBiometricType } from '../utils/biometric';
import { PINInput } from '../components/PINInput';
import { Screen } from '../components';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';
import { formatWalletFingerprint, getCPayIdByWallet } from '../utils/cpayId';
import { FORGOT_PIN } from '../utils/strings';
import { supabase } from '../services/supabase';

const FONT_SIZES = TYPOGRAPHY.sizes;

interface ForgotPINScreenProps {
  navigation: any;
}

export const ForgotPINScreen: React.FC<ForgotPINScreenProps> = ({ navigation }) => {
  useTheme();
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometric');
  const [hasBackup, setHasBackup] = useState(false);
  const [step, setStep] = useState<'info' | 'new-pin' | 'confirm-pin'>('info');
  const [recoveredSecret, setRecoveredSecret] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    try {
      const available = await isBiometricAvailable();
      const type = await getBiometricType();
      const backup = await hasBiometricBackup();
      
      setBiometricAvailable(available);
      setBiometricType(type);
      setHasBackup(backup);
      
      if (!available) {
        AlertManager.alert(
          FORGOT_PIN.BIOMETRIC_UNAVAILABLE_TITLE,
          FORGOT_PIN.BIOMETRIC_UNAVAILABLE_DESC,
          [
            { text: FORGOT_PIN.RESTORE_CLOUD_BUTTON, onPress: handleCloudRestore },
            { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() },
          ]
        );
      } else if (!backup) {
        AlertManager.alert(
          FORGOT_PIN.NO_BACKUP_TITLE,
          FORGOT_PIN.NO_BACKUP_DESC,
          [
            { text: FORGOT_PIN.RESTORE_CLOUD_BUTTON, onPress: handleCloudRestore },
            { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() },
          ]
        );
      }
    } catch (error) {
      Logger.error('Error checking availability:', error);
    }
  };

  const handleCloudRestore = async () => {
    try {
      const walletAddress = (await AsyncStorage.getItem('wallet_address')) || '';
      const { data } = await supabase.auth.getUser();
      navigation.navigate('RestoreWallet', {
        walletAddress,
        verifiedEmail: data.user?.email || undefined,
        accountSwitch: true,
      });
    } catch {
      navigation.navigate('RestoreWallet', { walletAddress: '', accountSwitch: true });
    }
  };

  const handleRecovery = async () => {
    if (!biometricAvailable || !hasBackup) {
      AlertManager.alert('Error', 'Biometric recovery is not available');
      return;
    }

    setLoading(true);
    try {
      // This will trigger Face ID/Fingerprint prompt
      const secret = await recoverWalletWithBiometric();
      
      if (!secret) {
        throw new Error('Failed to recover wallet');
      }

      setRecoveredSecret(secret);
      setStep('new-pin');
      
      AlertManager.alert(
        'Wallet Recovered',
        'Your wallet has been recovered! Now create a new PIN to secure it.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Logger.error('Recovery error:', error);
      
      if (error.message?.includes('cancel')) {
        AlertManager.alert('Cancelled', 'Recovery was cancelled');
      } else {
        AlertManager.alert(
          'Recovery Failed',
          error.message || 'Failed to recover wallet. Please try again.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleNewPIN = (pin: string) => {
    setNewPin(pin);
    setError('');

    if (pin.length === 6) {
      // Check for weak PINs
      if (pin === '123456' || pin === '000000' || pin === '111111' || pin === '654321') {
        setError('Please choose a stronger PIN');
        setTimeout(() => setNewPin(''), 300);
        return;
      }

      setStep('confirm-pin');
    }
  };

  const handleConfirmPIN = async (pin: string) => {
    setConfirmPin(pin);
    setError('');

    if (pin.length === 6) {
      if (pin !== newPin) {
        setError('PINs do not match');
        setTimeout(() => {
          setConfirmPin('');
          setNewPin('');
          setStep('new-pin');
        }, 500);
        return;
      }

      // PINs match - recreate wallet
      setLoading(true);
      try {
        if (!recoveredSecret) {
          throw new Error('No recovered wallet backup');
        }

        const walletAddress = await recreateWalletFromSecret(recoveredSecret, newPin);
        cachePinForSession(newPin);

        const displayId =
          await getCPayIdByWallet(walletAddress) || formatWalletFingerprint(walletAddress);

        AlertManager.alert(
          'PIN Reset Successful',
          `Your new PIN has been set!\n\nC-Pay ID: ${displayId}`,
          [
            {
              text: 'Login',
              onPress: () => navigation.replace('Login'),
            },
          ]
        );
      } catch (error: any) {
        AlertManager.alert('Error', 'Failed to reset PIN. Please try again.');
        setStep('new-pin');
        setNewPin('');
        setConfirmPin('');
      } finally {
        setLoading(false);
      }
    }
  };

  const getBiometricIcon = () => {
    if (biometricType.includes('Face')) return 'scan-outline';
    if (biometricType.includes('Fingerprint') || biometricType.includes('Touch')) return 'finger-print-outline';
    return 'shield-checkmark-outline';
  };

  if (step === 'new-pin') {
    return (
      <Screen scroll={false} topInset={false} padded={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed-outline" size={34} color={COLORS.primary} />
            </View>
            <Text style={styles.title}>Create New PIN</Text>
            <Text style={styles.subtitle}>
              Choose a new 6-digit PIN
            </Text>
          </View>

          <View style={styles.pinSection}>
            <PINInput
              value={newPin}
              onChange={handleNewPIN}
              error={error}
              autoFocus
              disabled={loading}
            />
          </View>

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  if (step === 'confirm-pin') {
    return (
      <Screen scroll={false} topInset={false} padded={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-circle-outline" size={36} color={COLORS.success} />
            </View>
            <Text style={styles.title}>Confirm New PIN</Text>
            <Text style={styles.subtitle}>
              Re-enter your new PIN
            </Text>
          </View>

          <View style={styles.pinSection}>
            <PINInput
              value={confirmPin}
              onChange={handleConfirmPIN}
              error={error}
              autoFocus
              disabled={loading}
            />
          </View>

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Setting new PIN...</Text>
            </View>
          )}
        </View>
      </Screen>
    );
  }

  // Info step
  return (
    <Screen scroll={false} topInset={false} padded={false}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.largeIconCircle}>
            <Ionicons name={getBiometricIcon() as any} size={46} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>Reset PIN</Text>
          <Text style={styles.subtitle}>
            Use {biometricType} to recover your wallet
          </Text>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>How it works:</Text>
          <Text style={styles.infoText}>
            1. Authenticate with {biometricType}
          </Text>
          <Text style={styles.infoText}>
            2. Your wallet will be recovered
          </Text>
          <Text style={styles.infoText}>
            3. Create a new PIN
          </Text>
          <Text style={styles.infoText}>
            4. Login with your new PIN
          </Text>
        </View>

        <View style={styles.warningBox}>
          <Ionicons name="alert-circle-outline" size={20} color={COLORS.warning} style={styles.warningIcon} />
          <Text style={styles.warningText}>
            You'll need to authenticate with {biometricType} to continue.
            Make sure your biometric is enrolled on this device.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRecovery}
          disabled={loading || !biometricAvailable || !hasBackup}
        >
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textInverse} />
          ) : (
            <>
              <Ionicons name={getBiometricIcon() as any} size={22} color={COLORS.textInverse} style={styles.buttonIcon} />
              <Text style={styles.buttonText}>
                Recover with {biometricType}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cloudRestoreButton}
          onPress={handleCloudRestore}
          disabled={loading}
        >
          <Ionicons name="cloud-download-outline" size={20} color={COLORS.primary} style={styles.buttonIcon} />
          <Text style={styles.cloudRestoreButtonText}>
            {FORGOT_PIN.RESTORE_CLOUD_BUTTON}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  largeIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingHorizontal: SPACING.md,
  },
  infoBox: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: 12,
    marginBottom: SPACING.lg,
  },
  infoTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
    paddingLeft: SPACING.sm,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.warningBg,
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  warningIcon: {
    marginRight: SPACING.sm,
  },
  warningText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.warningDark,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonIcon: {
    marginRight: SPACING.sm,
  },
  buttonText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  cloudRestoreButton: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  cloudRestoreButtonText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    padding: SPACING.md,
  },
  cancelButtonText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
  pinSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
}));
