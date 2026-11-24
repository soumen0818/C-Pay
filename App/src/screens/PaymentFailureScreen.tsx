import React, { useEffect, useRef } from 'react';

// Payment failure screen: explains routing and retry steps after an error.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { formatMoneyAmount } from '../utils/currency';
import { PAYMENT_FAILURE } from '../utils/strings';

const { width } = Dimensions.get('window');

interface PaymentFailureScreenProps {
  navigation: any;
  route: {
    params: {
      amount: string;
      recipientName: string;
      recipientAddress: string;
      errorMessage?: string;
      errorReason?: string;
      errorCode?: string;
      category?: 'retryable' | 'support';
      timestamp?: string;
      note?: string;
      idempotencyKey?: string;
    };
  };
}

export const PaymentFailureScreen: React.FC<PaymentFailureScreenProps> = ({
  navigation,
  route,
}) => {
  useTheme();
  const {
    amount,
    recipientName,
    recipientAddress,
    errorMessage = 'Transaction failed',
    errorReason = 'Unable to complete the transaction. Please try again.',
    errorCode,
    category = 'retryable',
    timestamp,
    note,
    idempotencyKey,
  } = route.params;

  const needsSupport = category === 'support';

  const [currentTime] = React.useState(
    timestamp || new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  );

  // Animations
  const shakeValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(0)).current;
  const fadeValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Shake animation for error icon
    Animated.sequence([
      Animated.spring(scaleValue, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(shakeValue, {
          toValue: 10,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(shakeValue, {
          toValue: -10,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(shakeValue, {
          toValue: 10,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(shakeValue, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Fade in content
    Animated.timing(fadeValue, {
      toValue: 1,
      duration: 400,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleTryAgain = () => {
    navigation.replace('SendMoney', {
      recipientAddress,
      amount,
      recipientName,
      note,
      idempotencyKey,
    });
  };

  const handleGoHome = () => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  const handleContactSupport = () => {
    // Navigate to support or show contact options
    navigation.navigate('MainTabs', { screen: 'Profile' });
  };

  // Determine error type and suggestions
  const getErrorSuggestions = () => {
    const suggestions: string[] = [];
    
    if (errorReason.toLowerCase().includes('insufficient')) {
      suggestions.push('Check your account balance');
      suggestions.push(PAYMENT_FAILURE.SUGGESTION_CLAIM_USDC);
    } else if (errorReason.toLowerCase().includes('network')) {
      suggestions.push('Check your internet connection');
      suggestions.push('Try again in a few moments');
    } else if (errorReason.toLowerCase().includes('fee')) {
      suggestions.push('Payment network is temporarily busy');
      suggestions.push('Try again in a few moments');
    } else {
      suggestions.push('Check your internet connection');
      suggestions.push('Verify recipient details');
      suggestions.push('Try again in a few moments');
    }
    
    return suggestions;
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={COLORS.errorGradient}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.content}>
          {/* Compact Error Header */}
          <Animated.View
            style={[
              styles.headerSection,
              {
                opacity: fadeValue,
                transform: [
                  { scale: scaleValue },
                  { translateX: shakeValue },
                ],
              },
            ]}
          >
            <View style={styles.compactIconCircle}>
              <Text style={styles.compactErrorIcon}>✕</Text>
            </View>
            <Text style={styles.compactTitle}>Payment Failed</Text>
            <Text style={styles.compactSubtitle}>{errorMessage}</Text>
            <View style={styles.statusChip}>
              <Ionicons
                name={needsSupport ? 'help-buoy-outline' : 'refresh-outline'}
                size={13}
                color={COLORS.textInverse}
              />
              <Text style={styles.statusChipText}>
                {needsSupport ? 'Action needed' : 'You can retry this payment'}
              </Text>
            </View>
          </Animated.View>

          {/* Error Reason & Transaction Summary */}
          <Animated.View
            style={[
              styles.summarySection,
              {
                opacity: fadeValue,
              },
            ]}
          >
            {/* Error Reason */}
            <View style={styles.errorReasonBox}>
              <Ionicons name="alert-circle-outline" size={20} color={COLORS.textInverse} style={styles.errorReasonIcon} />
              <View style={styles.errorReasonContent}>
                <Text style={styles.errorReasonText}>{errorReason}</Text>
                {!!errorCode && <Text style={styles.errorCodeText}>Code: {errorCode}</Text>}
              </View>
            </View>

            {/* Transaction Details */}
            <LinearGradient
              colors={[COLORS.surfaceElevated, COLORS.background]}
              style={styles.summaryCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            >
              <Text style={styles.summaryTitle}>Transaction Details</Text>
              <View style={styles.summaryDivider} />
              
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Amount</Text>
                <Text style={styles.summaryValue}>{formatMoneyAmount(parseFloat(amount))}</Text>
              </View>
              <View style={styles.summaryDivider} />
              
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>To</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>{recipientName}</Text>
              </View>
              <View style={styles.summaryDivider} />
              
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Time</Text>
                <Text style={styles.summaryValueSmall}>{currentTime}</Text>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* Action Buttons */}
          <Animated.View
            style={[
              styles.actionButtons,
              {
                opacity: fadeValue,
              },
            ]}
          >
            {needsSupport ? (
              <>
                <TouchableOpacity
                  style={styles.tryAgainButton}
                  onPress={handleContactSupport}
                  activeOpacity={0.7}
                >
                  <Text style={styles.tryAgainButtonText}>Get Help</Text>
                </TouchableOpacity>

                <View style={styles.secondaryButtonsRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleTryAgain}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.secondaryButtonText}>Try Again</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleGoHome}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.secondaryButtonText}>Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.tryAgainButton}
                  onPress={handleTryAgain}
                  activeOpacity={0.7}
                >
                  <Text style={styles.tryAgainButtonText}>Try Again</Text>
                </TouchableOpacity>

                <View style={styles.secondaryButtonsRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleContactSupport}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.secondaryButtonText}>Support</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleGoHome}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.secondaryButtonText}>Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Animated.View>
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxxl + 20,
    paddingBottom: SPACING.xl,
    justifyContent: 'space-between',
  },
  headerSection: {
    alignItems: 'center',
  },
  compactIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.whiteOverlayMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  compactErrorIcon: {
    fontSize: 50,
    color: COLORS.textInverse,
    fontWeight: '700',
  },
  compactTitle: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.textInverse,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  compactSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textOnBrandStrong,
    fontWeight: '500',
    textAlign: 'center',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'center',
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.whiteOverlayFaint,
    borderWidth: 1,
    borderColor: COLORS.whiteOverlayMedium,
  },
  statusChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.textInverse,
  },
  summarySection: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: SPACING.lg,
  },
  errorReasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.whiteOverlay,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.whiteOverlayMedium,
  },
  errorReasonIcon: {
    marginRight: SPACING.sm,
  },
  errorReasonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    fontWeight: '500',
    lineHeight: 20,
  },
  errorReasonContent: {
    flex: 1,
  },
  errorCodeText: {
    color: COLORS.textOnBrandSubtle,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    marginTop: SPACING.xs,
  },
  summaryCard: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  summaryTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  summaryLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  summaryValue: {
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    fontWeight: '600',
    textAlign: 'right',
    flex: 2,
  },
  summaryValueSmall: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'right',
    flex: 2,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.xs,
  },
  actionButtons: {
    gap: SPACING.md,
  },
  tryAgainButton: {
    backgroundColor: COLORS.textInverse,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md + 2,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  tryAgainButtonText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.errorDark,
    textAlign: 'center',
  },
  secondaryButtonsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.whiteOverlayQuarter,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.whiteOverlayMedium,
  },
  secondaryButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textInverse,
    textAlign: 'center',
  },
}));
