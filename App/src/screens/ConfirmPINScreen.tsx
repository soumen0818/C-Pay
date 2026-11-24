import { Logger } from '../utils/logger';
import React, { useRef, useState } from 'react';

// Confirm PIN screen: final wallet confirmation before activation.
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PINInput } from '../components/PINInput';
import { OnboardingProgress } from '../components/OnboardingProgress';
import { Screen } from '../components';
import { cachePinForSession, createWallet } from '../services/wallet';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';
import { generateCPayId } from '../utils/cpayId';

const FONT_SIZES = TYPOGRAPHY.sizes;

const waitForUiPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

const saveInitialUserRecord = (
  walletAddress: string,
  cpayId: string
) => {
  void (async () => {
    try {
      const verifiedEmail = await AsyncStorage.getItem('user_email');
      const { error: dbError } = await supabase
        .from('users')
        .upsert(
          {
            wallet_address: walletAddress,
            email: verifiedEmail || null,
            cpay_id: cpayId,
            biometric_enabled: false,
          },
          { onConflict: 'wallet_address' }
        );

      if (dbError) {
        Logger.error('Database error:', dbError);
      }
    } catch (error) {
      Logger.error('Database save failed:', error);
    }
  })();
};

interface ConfirmPINScreenProps {
  navigation: any;
  route: any;
}

export const ConfirmPINScreen: React.FC<ConfirmPINScreenProps> = ({
  navigation,
  route,
}) => {
  useTheme();
  const { pin: originalPin, walletReplacement = false, cpayId: existingCPayId } = route.params;
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const createWalletAndContinue = async (pinToConfirm: string) => {
    if (submittingRef.current) {
      return;
    }

    if (pinToConfirm.length !== 6) {
      setError('Please enter a 6-digit PIN');
      return;
    }

    submittingRef.current = true;
    setError('');
    setLoading(true);
    await waitForUiPaint();

    if (pinToConfirm !== originalPin) {
      setError('PINs do not match');
      setLoading(false);
      submittingRef.current = false;
      setTimeout(() => setConfirmPin(''), 250);
      return;
    }

    try {
      // Create wallet with PIN
      const walletAddress = await createWallet(originalPin);

      // Save wallet address locally for profile and optional biometric setup.
      const verifiedEmail = await AsyncStorage.getItem('user_email');
      let cpayId = walletReplacement && existingCPayId
        ? existingCPayId
        : generateCPayId(verifiedEmail || '', walletAddress);
      if (walletReplacement) {
        const { data, error } = await supabase.rpc('replace_own_wallet_binding', {
          p_new_wallet_address: walletAddress,
        });
        if (error || !data?.[0]?.wallet_address) {
          throw new Error(error?.message || 'Could not securely replace the wallet binding.');
        }
        cpayId = data[0].cpay_id || cpayId;
      }
      await Promise.all([
        AsyncStorage.setItem('wallet_address', walletAddress),
        AsyncStorage.setItem('cpay_id', cpayId),
        AsyncStorage.setItem('biometric_enabled', 'false'),
      ]);
      cachePinForSession(originalPin);

      // Cloud save should not block local wallet creation or onboarding progress.
      saveInitialUserRecord(walletAddress, cpayId);

      navigation.replace('ProfileSetup', { walletAddress, walletReplacement, cpayId });
    } catch (err) {
      Logger.error('Wallet creation error:', err);
      AlertManager.alert('Error', 'Failed to create wallet. Please try again.');
      setConfirmPin('');
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handlePINChange = async (newPin: string) => {
    setConfirmPin(newPin);
    setError('');

    if (newPin.length === 6) {
      void createWalletAndContinue(newPin);
    }
  };

  return (
    <Screen scroll={false} padded={false}>
      <OnboardingProgress currentStep={2} flowType="setup" />
      <View style={[styles.content, { paddingTop: SPACING.md }]}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/cpay_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Confirm Your PIN</Text>
          <Text style={styles.subtitle}>
            Re-enter the same 6 digits so we know you typed it correctly.
          </Text>
        </View>

        <View style={styles.pinSection}>
          <PINInput
            value={confirmPin}
            onChange={handlePINChange}
            error={error}
            autoFocus
            disabled={loading}
          />
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Creating your secure wallet...</Text>
          </View>
        )}
      </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl * 2,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  pinSection: {
    marginBottom: SPACING.xl * 2,
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
}));
