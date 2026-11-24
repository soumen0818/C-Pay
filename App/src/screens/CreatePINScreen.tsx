import React, { useRef, useState } from 'react';

// Create PIN screen: first step in wallet security setup.
import {
  View,
  Text,
  StyleSheet,
  Image,
} from 'react-native';
import { PINInput } from '../components/PINInput';
import { OnboardingProgress } from '../components/OnboardingProgress';
import { Screen } from '../components';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { isWeakPin } from '../utils/pin';

const FONT_SIZES = TYPOGRAPHY.sizes;

interface CreatePINScreenProps {
  navigation: any;
  route: any;
}

export const CreatePINScreen: React.FC<CreatePINScreenProps> = ({ navigation }) => {
  useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const navigatingRef = useRef(false);

  const continueWithPin = (pinToConfirm: string) => {
    if (navigatingRef.current) {
      return;
    }

    if (pinToConfirm.length !== 6) {
      setError('Please enter a 6-digit PIN');
      return;
    }

    if (isWeakPin(pinToConfirm)) {
      setError('Please choose a stronger PIN');
      setTimeout(() => setPin(''), 300);
      return;
    }

    navigatingRef.current = true;
    navigation.navigate('ConfirmPIN', { pin: pinToConfirm });
  };

  const handlePINChange = (newPin: string) => {
    setPin(newPin);
    setError('');

    if (newPin.length === 6) {
      continueWithPin(newPin);
    }
  };

  return (
    <Screen padded={false}>
      <OnboardingProgress currentStep={2} flowType="setup" />
      <View style={styles.content}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/cpay_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Create Your PIN</Text>
          <Text style={styles.subtitle}>
            Choose 6 digits you can remember. You will use this to unlock C-Pay.
          </Text>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>Make it secure</Text>
          <Text style={styles.infoText}>Avoid obvious patterns like 123456 or repeated digits.</Text>
          <Text style={styles.infoText}>Your wallet remains encrypted on this device.</Text>
        </View>

        <View style={styles.pinSection}>
          <PINInput
            value={pin}
            onChange={handlePINChange}
            error={error}
            autoFocus
          />
        </View>
      </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
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
    marginBottom: SPACING.xl,
  },
  infoSection: {
    backgroundColor: COLORS.card,
    padding: SPACING.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: SPACING.xl,
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
    lineHeight: 19,
  },
}));
