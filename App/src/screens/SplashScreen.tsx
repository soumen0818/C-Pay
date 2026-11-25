import { Logger } from '../utils/logger';
import React, { useEffect } from 'react';

// Splash screen: startup state for wallet initialization and redirect.
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasWallet, recoverPendingPinChange } from '../services/wallet';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { PILOT_NOTICE_TITLE } from '../utils/pilot';

const FONT_SIZES = TYPOGRAPHY.sizes;

const { width } = Dimensions.get('window');

interface SplashScreenProps {
  navigation: any;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  useTheme();
  useEffect(() => {
    checkWalletAndNavigate();
  }, [navigation]);

  const checkWalletAndNavigate = async () => {
    try {
      // Keep the splash visible just long enough to avoid a hard flash.
      await new Promise(resolve => setTimeout(resolve, 500));

      // On startup, detect and recover from any half-finished PIN change
      await recoverPendingPinChange();

      // Check if user has already created wallet
      const walletExists = await hasWallet();
      Logger.info('Wallet exists:', walletExists);

      if (walletExists) {
        const emailVerified = await AsyncStorage.getItem('email_verified');

        if (emailVerified !== 'true') {
          // Existing wallet but no active verification - show verification
          navigation.replace('EmailVerification');
        } else {
          // User has wallet and verification complete, go to login
          navigation.replace('Login');
        }
      } else {
        // New user, show onboarding first
        navigation.replace('Onboarding');
      }
    } catch (error) {
      Logger.error('Error checking wallet:', error);
      // On error, assume new user
      navigation.replace('Onboarding');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../../assets/cpay_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>C-Pay</Text>
        <Text style={styles.subtitle}>{PILOT_NOTICE_TITLE} on Stellar testnet</Text>
      </View>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={COLORS.textInverse} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.textInverse,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textInverse,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 80,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    marginTop: SPACING.sm,
  },
}));
