import { Logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';

// Send money screen: user-driven transfer flow and recipient validation.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getBalance, isValidAccountId } from '../services/blockchain';
import { formatWalletFingerprint } from '../utils/cpayId';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import {
  Button,
  Screen,
  Header,
  FormField,
  AmountInput,
  InfoBanner,
  BottomActionBar,
  PaymentReviewSheet,
} from '../components';
import { AlertManager } from '../utils/alert';
import { MONEY_SYMBOL, MONEY_UNIT_LABEL, formatMoneyAmount, formatMoneyBalance } from '../utils/currency';
import { PILOT_TESTNET_TEXT } from '../utils/pilot';
import { PAYMENT } from '../utils/strings';
import { usePaymentIntent } from '../hooks/usePaymentIntent';
import { usePaymentSubmission } from '../hooks/usePaymentSubmission';
import { useRecipientLookup } from '../hooks/useRecipientLookup';
import { checkTransactionLimit } from '../services/securityLimits';

interface SendMoneyScreenProps {
  navigation: any;
  route?: any;
}

export const SendMoneyScreen: React.FC<SendMoneyScreenProps> = ({ navigation, route }) => {
  useTheme();
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // User enters USDC, up to seven decimals.
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<string>('0');
  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [isFromQR, setIsFromQR] = useState<boolean>(false);
  const [hasPresetAmount, setHasPresetAmount] = useState<boolean>(false);
  const [showReview, setShowReview] = useState<boolean>(false);

  const {
    createIntent,
    getOrCreateIntent,
    clearIntent,
  } = usePaymentIntent(route?.params?.idempotencyKey || null);

  const {
    recipientInput,
    setRecipientInput,
    recipientAddress,
    setRecipientAddress,
    recipientName,
    setRecipientName,
    recipientCPayId,
    setRecipientCPayId,
    fetchingRecipient,
    recipientFetched,
    fetchRecipientName,
    handleAddressChange,
    resetRecipient,
  } = useRecipientLookup(walletAddress, isFromQR);

  const {
    submitting,
    paymentInProgress,
    executePayment,
  } = usePaymentSubmission({
    navigation,
    amount,
    recipientAddress,
    recipientName,
    recipientCPayId,
    walletAddress,
    note,
    getOrCreateIntent,
    clearIntent,
  });

  useEffect(() => {
    loadWalletData();
    const routeRecipientName = typeof route?.params?.recipientName === 'string'
      ? route.params.recipientName.trim()
      : '';

    // If coming from QR scan or deep link
    if (route?.params?.recipientAddress) {
      const address = route.params.recipientAddress;
      setRecipientAddress(address);
      setRecipientInput(address);
      if (isValidAccountId(address)) {
        void fetchRecipientName(address, {
          fallbackName: routeRecipientName,
        });
      }
    }
    if (routeRecipientName) {
      setRecipientName(routeRecipientName);
    }
    if (route?.params?.amount && parseFloat(route.params.amount) > 0) {
      // QR/deep-link amounts are already USDC strings validated to seven decimals.
      setAmount(String(route.params.amount).trim());
      setHasPresetAmount(true);
    }
    if (route?.params?.note) {
      setNote(route.params.note);
    }
    if (route?.params?.hideBalance === true) {
      setHideBalance(true);
    }
    if (route?.params?.isFromQR) {
      setIsFromQR(true);
    }
    if (route?.params?.idempotencyKey) {
      createIntent(route.params.idempotencyKey);
    }
  }, [route?.params]);

  const loadWalletData = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (address) {
        setWalletAddress(address);
        await loadBalance(address);
      }
    } catch (error) {
      Logger.error('Error loading wallet:', error);
    }
  };

  const loadBalance = async (address: string) => {
    try {
      const formatted = await getBalance(address);
      setBalance(formatted);
    } catch (error) {
      Logger.error('Error loading balance:', error);
      setBalance('0.00');
    }
  };

  const validateInputs = (): boolean => {
    if (!recipientInput.trim() && !recipientAddress.trim()) {
      AlertManager.alert('Invalid C-Pay ID', 'Please enter a recipient C-Pay ID');
      return false;
    }

    // If recipient address is not set yet (C-Pay ID lookup failed or in progress)
    if (!recipientAddress.trim()) {
      AlertManager.alert('Invalid C-Pay ID', 'Could not find an account for the entered C-Pay ID');
      return false;
    }

    if (!isValidAccountId(recipientAddress.trim())) {
      AlertManager.alert('Invalid C-Pay ID', 'Please enter a valid C-Pay ID');
      return false;
    }

    if (recipientAddress.trim() === walletAddress) {
      AlertManager.alert('Invalid Recipient', PAYMENT.CANNOT_SEND_TO_SELF);
      return false;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      AlertManager.alert('Invalid Amount', 'Please enter a valid amount');
      return false;
    }

    const balanceNum = parseFloat(balance);
    if (amountNum > balanceNum) {
      AlertManager.alert('Insufficient Balance', `You only have ${formatMoneyAmount(parseFloat(balance))}`);
      return false;
    }

    return true;
  };

  // Open the unified review sheet (shared by manual send and scan-to-pay).
  const handleSendMoney = async () => {
    if (submitting || paymentInProgress.current) return;
    if (!validateInputs()) return;

    // Instant UX feedback against server limits
    const limitCheck = await checkTransactionLimit(amount);
    if (!limitCheck.allowed) {
      AlertManager.alert('Transaction Limit', limitCheck.reason || 'Transaction limit exceeded');
      return;
    }

    getOrCreateIntent();
    setShowReview(true);
  };

  const handlePasteAddress = async () => {
    try {
      const { default: Clipboard } = await import('expo-clipboard');
      const text = await Clipboard.getStringAsync();
      if (text && isValidAccountId(text.trim())) {
        const address = text.trim();
        setRecipientAddress(address);
        setRecipientInput(address);
        fetchRecipientName(address);
      } else {
        AlertManager.alert('Invalid Address', 'Clipboard does not contain a valid address');
      }
    } catch (error) {
      AlertManager.alert('Error', 'Failed to paste from clipboard');
    }
  };

  const handleBackPress = () => {
    if (paymentInProgress.current) {
      AlertManager.alert(
        'Transaction Cancelled',
        'Payment was interrupted. If the transaction was submitted, it may still complete.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else {
      navigation.goBack();
    }
  };

  return (
    <Screen
      scroll
      loading={loading || submitting}
      loadingText="Processing payment..."
      header={<Header title="Send USDC" onBack={handleBackPress} />}
      footer={
        <BottomActionBar>
          <Button
            title={`Send ${amount ? formatMoneyAmount(parseFloat(amount)) : MONEY_UNIT_LABEL}`}
            onPress={handleSendMoney}
            variant="primary"
            size="lg"
            fullWidth
            disabled={
              loading ||
              submitting ||
              fetchingRecipient ||
              !recipientAddress.trim() ||
              !amount ||
              parseFloat(amount) <= 0
            }
          />
        </BottomActionBar>
      }
    >
      {/* Balance Card - Hidden when scanned from other places */}
      {!hideBalance && (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available USDC</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceCurrency}>{MONEY_SYMBOL}</Text>
            <Text style={styles.balanceAmount}>{formatMoneyBalance(balance)}</Text>
          </View>
        </View>
      )}

      {/* Recipient Info Card - Show when from QR scan OR when name is fetched */}
      {((isFromQR && recipientName) || recipientFetched) && (
        <View style={styles.recipientCard}>
          <View style={styles.recipientCardHeader}>
            <Ionicons
              name="person-outline"
              size={23}
              color={COLORS.primary}
              style={styles.recipientCardIcon}
            />
            <Text style={styles.recipientCardTitle}>
              Sending To
            </Text>
          </View>
          <View style={styles.recipientCardContent}>
            <Text style={styles.recipientCardName} numberOfLines={1}>{recipientName}</Text>
            <Text style={styles.recipientCardAddress} numberOfLines={1}>
              {recipientCPayId || formatWalletFingerprint(recipientAddress)}
            </Text>
          </View>
        </View>
      )}

      {/* Recipient Address Input - Hide when recipient is fetched or from QR */}
      {!isFromQR && !recipientFetched && (
        <FormField
          label="Recipient C-Pay ID"
          containerStyle={styles.field}
          placeholder={PAYMENT.RECIPIENT_PLACEHOLDER}
          value={recipientInput}
          onChangeText={handleAddressChange}
          autoCapitalize="none"
          autoCorrect={false}
          monospace
          leftIcon="person-outline"
          rightAction={{
            icon: 'clipboard-outline',
            onPress: handlePasteAddress,
            accessibilityLabel: 'Paste recipient address',
          }}
          helper={fetchingRecipient ? 'Looking up recipient...' : undefined}
        />
      )}

      {/* Change Recipient Button - Show when recipient is fetched (not from QR) */}
      {!isFromQR && recipientFetched && (
        <TouchableOpacity
          style={styles.changeRecipientButton}
          onPress={resetRecipient}
        >
          <Text style={styles.changeRecipientText}>Change Recipient</Text>
        </TouchableOpacity>
      )}

      {/* Amount Input */}
      <AmountInput
        label="Amount"
        containerStyle={styles.field}
        value={amount}
        onChangeText={setAmount}
        editable={!hasPresetAmount}
        quickAmounts={['10', '50', '100', '500']}
      />

      {/* Note Input (Optional) */}
      <FormField
        label="Add Note (Optional)"
        containerStyle={styles.field}
        placeholder="e.g., Lunch payment, Rent, etc."
        value={note}
        onChangeText={setNote}
        maxLength={50}
      />

      {/* Info */}
      <InfoBanner
        variant="info"
        message={`${PILOT_TESTNET_TEXT} Payments typically confirm in 5-10 seconds.`}
      />

      {/* Unified payment review (shared by manual send and scan-to-pay) */}
      <PaymentReviewSheet
        visible={showReview}
        recipientName={recipientName}
        cpayId={recipientCPayId || formatWalletFingerprint(recipientAddress)}
        amount={amount}
        note={note}
        submitting={submitting}
        onConfirm={() => executePayment(() => setShowReview(false))}
        onCancel={() => {
          if (!submitting) setShowReview(false);
        }}
      />
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  field: {
    marginBottom: SPACING.xl,
  },
  balanceCard: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    ...SHADOWS.md,
  },
  balanceLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    opacity: 0.8,
    marginBottom: SPACING.xs,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.textInverse,
    marginRight: SPACING.sm,
  },
  balanceCurrency: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textInverse,
    opacity: 0.9,
    fontWeight: '600',
    marginRight: SPACING.xs,
  },
  recipientCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 2,
    borderColor: COLORS.primary,
    ...SHADOWS.md,
  },
  recipientCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  recipientCardIcon: {
    marginRight: SPACING.sm,
  },
  recipientCardTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recipientCardContent: {
    marginLeft: 36,
  },
  recipientCardName: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  recipientCardAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  changeRecipientButton: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.lg,
  },
  changeRecipientText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
}));
