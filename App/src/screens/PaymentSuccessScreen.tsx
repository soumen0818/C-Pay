import { Logger } from '../utils/logger';
import React, { useEffect, useRef, useState } from 'react';

// Payment success screen: completion confirmation with receipt details.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { TransactionDetailModal, TransactionDetail } from '../components/TransactionDetailModal';
import { formatMoneyAmount } from '../utils/currency';
import { formatTransactionHash, getExplorerUrl } from '../services/blockchain';

const { width, height } = Dimensions.get('window');

interface PaymentSuccessScreenProps {
  navigation: any;
  route: {
    params: {
      transactionHash: string;
      fromAddress: string;
      amount: string;
      recipientName: string;
      recipientAddress: string;
      processingTime?: number; // in seconds
      timestamp?: string;
      note?: string;
    };
  };
}

export const PaymentSuccessScreen: React.FC<PaymentSuccessScreenProps> = ({
  navigation,
  route,
}) => {
  useTheme();
  const {
    transactionHash,
    fromAddress,
    amount,
    recipientName,
    recipientAddress,
    processingTime = 2,
    timestamp,
    note,
  } = route.params;

  const [currentTime] = useState(
    timestamp || new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  );

  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const receiptRef = useRef(null);

  // Animations
  const scaleValue = useRef(new Animated.Value(0)).current;
  const fadeValue = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleValue, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.spring(checkmarkScale, {
        toValue: 1,
        friction: 6,
        tension: 40,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeValue, {
        toValue: 1,
        duration: 500,
        delay: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleViewTransactionDetails = () => {
    setShowTransactionModal(true);
  };

  const handleDone = () => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  const handleShare = async () => {
    try {
      if (!receiptRef.current) return;

      // Capture the receipt as image
      const uri = await captureRef(receiptRef, {
        format: 'png',
        quality: 1,
      });

      // Share the image
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share Payment Receipt',
        });
      }
    } catch (error) {
      Logger.error('Error sharing receipt:', error);
    }
  };

  const handleOpenExplorer = () => {
    Linking.openURL(getExplorerUrl('tx', transactionHash));
  };

  // Transaction data for modal
  const transactionData: TransactionDetail = {
    tx_hash: transactionHash,
    from_address: fromAddress,
    to_address: recipientAddress,
    amount: amount,
    status: 'success',
    created_at: new Date().toISOString(),
    transaction_type: 'personal',
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={COLORS.successGradient}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.content}>
          {/* Success Icon & Title */}
          <Animated.View
            style={[
              styles.topSection,
              {
                opacity: fadeValue,
                transform: [{ scale: scaleValue }],
              },
            ]}
          >
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={46} color={COLORS.success} />
            </View>
            <Text style={styles.successTitle}>Payment Sent</Text>
            <Text style={styles.amountText}>{formatMoneyAmount(parseFloat(amount))}</Text>
            <View style={styles.statusChip}>
              <Ionicons name="paper-plane" size={13} color={COLORS.textInverse} />
              <Text style={styles.statusChipText}>Submitted · confirming on network</Text>
            </View>
          </Animated.View>

          {/* Receipt Card - Wrapped for receipt capture */}
          <Animated.View
            style={[
              {
                opacity: fadeValue,
              },
            ]}
          >
            <View ref={receiptRef} collapsable={false} style={styles.receiptCard}>
              {/* Receipt Header with App Name */}
              <View style={styles.receiptHeader}>
                <View style={styles.receiptBrand}>
                  <Ionicons name="card-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.receiptAppName}>C-Pay</Text>
                </View>
                <Text style={styles.receiptStatus}>Payment Successful</Text>
              </View>

              {/* Amount - Prominent Display */}
              <View style={styles.receiptAmountSection}>
                <Text style={styles.receiptAmountLabel}>AMOUNT PAID</Text>
                <Text style={styles.receiptAmountValue}>{formatMoneyAmount(parseFloat(amount))}</Text>
              </View>

              <View style={styles.receiptDivider} />

              {/* Transaction Details */}
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>To</Text>
                <Text style={styles.receiptValue} numberOfLines={1}>{recipientName}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Transaction Hash</Text>
                <TouchableOpacity
                  style={styles.receiptValueRow}
                  onPress={handleOpenExplorer}
                  activeOpacity={0.7}
                >
                  <Text style={styles.receiptHashText}>{formatTransactionHash(transactionHash)}</Text>
                  <Ionicons name="open-outline" size={14} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Date & Time</Text>
                <Text style={styles.receiptValue}>{currentTime}</Text>
              </View>
              {note && (
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Note</Text>
                  <Text style={styles.receiptValue} numberOfLines={1}>{note}</Text>
                </View>
              )}
            </View>
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
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleViewTransactionDetails}
              activeOpacity={0.8}
            >
              <View style={styles.actionButtonContent}>
                <Ionicons name="receipt-outline" size={18} color={COLORS.textInverse} />
                <Text style={styles.actionButtonText}>Details</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <View style={styles.actionButtonContent}>
                <Ionicons name="share-social-outline" size={18} color={COLORS.textInverse} />
                <Text style={styles.actionButtonText}>Share</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleDone}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Transaction Detail Modal */}
        <TransactionDetailModal
          visible={showTransactionModal}
          transaction={transactionData}
          onClose={() => setShowTransactionModal(false)}
        />
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
    paddingTop: Platform.OS === 'ios' ? SPACING.xxl + 30 : SPACING.xxl + 10,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'space-between',
  },
  // Top Section - Icon, Title, Amount
  topSection: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.textInverse,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textInverse,
    marginBottom: SPACING.sm,
    letterSpacing: 0.3,
  },
  amountText: {
    fontSize: 36,
    fontWeight: '900',
    color: COLORS.textInverse,
    letterSpacing: 0.5,
    textShadowColor: COLORS.textShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.whiteOverlay,
  },
  statusChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.textInverse,
  },
  // Receipt Card
  receiptCard: {
    backgroundColor: COLORS.textInverse,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  receiptHeader: {
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  receiptBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: 4,
  },
  receiptAppName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.primary,
  },
  receiptStatus: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.success,
  },
  receiptAmountSection: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  receiptAmountLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 1.2,
  },
  receiptAmountValue: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: SPACING.sm,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SPACING.xs + 2,
  },
  receiptLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    fontWeight: '600',
    flex: 1,
  },
  receiptValue: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text,
    fontWeight: '700',
    flex: 1.5,
    textAlign: 'right',
  },
  receiptValueRow: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  receiptHashText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Action Buttons
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingTop: SPACING.md,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.whiteOverlayQuarter,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    borderWidth: 1.5,
    borderColor: COLORS.whiteOverlayStrong,
  },
  actionButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textInverse,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: COLORS.textInverse,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.successDark,
    letterSpacing: 0.5,
  },
}));
