import { Logger } from '../utils/logger';
import React, { useState } from 'react';

// Change PIN screen: secure account recovery and wallet verification.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PINInput } from '../components/PINInput';
import { Screen } from '../components';
import { cachePinForSession, unlockWithPin, changeWalletPin } from '../services/wallet';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';
import { isWeakPin } from '../utils/pin';

const FONT_SIZES = TYPOGRAPHY.sizes;

type Step = 'verify' | 'new' | 'confirm';

interface ChangePINScreenProps {
  navigation: any;
}

export const ChangePINScreen: React.FC<ChangePINScreenProps> = ({ navigation }) => {
  useTheme();
  const [step, setStep] = useState<Step>('verify');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const verifyCurrentPin = async (pin: string) => {
    setError('');
    
    try {
      const result = await unlockWithPin(pin);
      
      if (result.status === 'OK') {
        setCurrentPin(pin);
        setStep('new');
      } else if (result.status === 'STORAGE_ERROR') {
        setError("Couldn't access secure storage — try again.");
        setTimeout(() => setCurrentPin(''), 300);
      } else if (result.status === 'WIPED') {
        setError('Wallet erased after too many incorrect PIN attempts. Restore your wallet to continue.');
        setTimeout(() => navigation.replace('Onboarding'), 500);
      } else if (result.status === 'LOCKED') {
        const seconds = Math.ceil((result.until - Date.now()) / 1000);
        setError(`Too many incorrect attempts. Try again in ${seconds} seconds.`);
        setTimeout(() => setCurrentPin(''), 300);
      } else {
        setError(`Incorrect PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} remaining before wallet erasure.`);
        setTimeout(() => setCurrentPin(''), 300);
      }
    } catch (err) {
      setError('Error verifying PIN');
      setTimeout(() => setCurrentPin(''), 300);
    }
  };

  const handleNewPin = (pin: string) => {
    setError('');
    
    if (pin === currentPin) {
      setError('New PIN must be different from current PIN');
      setTimeout(() => setNewPin(''), 300);
      return;
    }
    
    // Check for weak PINs
    if (isWeakPin(pin)) {
      setError('Please choose a stronger PIN');
      setTimeout(() => setNewPin(''), 300);
      return;
    }
    
    setNewPin(pin);
    setStep('confirm');
  };

  const handleConfirmPin = async (pin: string) => {
    setError('');
    
    if (pin !== newPin) {
      setError('PINs do not match. Try again.');
      setTimeout(() => setConfirmPin(''), 300);
      return;
    }
    
    setLoading(true);
    
    try {
      // Re-encrypt the Stellar secret with the new PIN-derived key.
      await changeWalletPin(currentPin, newPin);
      cachePinForSession(newPin);
      
      AlertManager.alert(
        'PIN Changed',
        'Your wallet PIN has been updated successfully. Your wallet remains secure.',
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update PIN');
      setLoading(false);
      
      // Reset to verify step on critical failure
      setTimeout(() => {
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        setStep('verify');
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (pin: string, setter: (p: string) => void, handler: (p: string) => void) => {
    setter(pin);
    setError('');
    
    if (pin.length === 6) {
      setTimeout(() => handler(pin), 100);
    }
  };

  const getStepContent = () => {
    switch (step) {
      case 'verify':
        return {
          icon: 'lock-closed-outline',
          title: 'Enter Current PIN',
          subtitle: 'Verify your identity to change PIN',
          value: currentPin,
          onChange: (pin: string) => handlePinChange(pin, setCurrentPin, verifyCurrentPin),
        };
      case 'new':
        return {
          icon: 'keypad-outline',
          title: 'Create New PIN',
          subtitle: 'Choose a new 6-digit PIN',
          value: newPin,
          onChange: (pin: string) => handlePinChange(pin, setNewPin, handleNewPin),
        };
      case 'confirm':
        return {
          icon: 'checkmark-circle-outline',
          title: 'Confirm New PIN',
          subtitle: 'Re-enter your new PIN',
          value: confirmPin,
          onChange: (pin: string) => handlePinChange(pin, setConfirmPin, handleConfirmPin),
        };
    }
  };

  const content = getStepContent();

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.content}>
        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressDot, step === 'verify' && styles.progressDotActive]} />
          <View style={styles.progressLine} />
          <View style={[styles.progressDot, step === 'new' && styles.progressDotActive]} />
          <View style={styles.progressLine} />
          <View style={[styles.progressDot, step === 'confirm' && styles.progressDotActive]} />
        </View>

        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name={content.icon as any} size={34} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.subtitle}>{content.subtitle}</Text>
        </View>

        <View style={styles.pinSection}>
          <PINInput
            value={content.value}
            onChange={content.onChange}
            error={error}
            autoFocus
            disabled={loading}
          />
        </View>

        {step === 'new' && (
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>PIN Requirements:</Text>
            <Text style={styles.infoText}>• Use 6 unique digits</Text>
            <Text style={styles.infoText}>• Avoid sequential numbers (123456)</Text>
            <Text style={styles.infoText}>• Must be different from current PIN</Text>
          </View>
        )}

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
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xl,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.border,
  },
  progressDotActive: {
    backgroundColor: COLORS.primary,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  progressLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.xs,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl * 2,
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
  },
  pinSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  infoSection: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
  },
  infoTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  cancelButton: {
    alignItems: 'center',
    padding: SPACING.md,
  },
  cancelButtonText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
}));
