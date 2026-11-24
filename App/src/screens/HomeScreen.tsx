import { Logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';

// Home screen: primary account overview for balances and payments.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { requestAddMoney, getBalance, getTimeUntilNextAddMoney, formatTimeRemaining, isValidAccountId } from '../services/blockchain';
import { startTransactionPolling, stopTransactionPolling } from '../services/transactionMonitor';
import { getAuthenticatedWallet } from '../utils/biometric';
import { getTransactions, saveTransaction, Transaction, storageEvents } from '../services/storage';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import {
  MONEY_BALANCE_LABEL,
  MONEY_SYMBOL,
  MONEY_UNIT_LABEL,
  formatMoneyAmount,
  formatMoneyBalance,
} from '../utils/currency';
import { PILOT_NOTICE_TEXT, PILOT_NOTICE_TITLE } from '../utils/pilot';
import { usePaymentIntent } from '../hooks/usePaymentIntent';
import {
  LoadingSpinner,
  TransactionItem,
  TransactionDetailModal,
  Screen,
  Section,
  InfoBanner,
  StatusSheet,
} from '../components';
import type { StatusSheetVariant, StatusSheetAction } from '../components';
import type { TransactionDetail } from '../components/TransactionDetailModal';

interface HomeScreenProps {
  navigation: any;
}

type AddMoneyPhase = 'idle' | 'checking' | 'confirm' | 'authenticating' | 'processing' | 'success' | 'cooldown' | 'error';

const ADD_MONEY_DISPLAY_AMOUNT = '100';

const waitForUiPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

type AddMoneyError = Error & {
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
};

const getNormalizedRetryAfterSeconds = (value: unknown): number => {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
};

const isAddMoneyCooldownError = (error: Partial<AddMoneyError>, message: string): boolean => {
  const code = error.code || '';
  const lowerMessage = message.toLowerCase();
  return code === 'ADD_MONEY_COOLDOWN' || error.status === 429 || lowerMessage.includes('cooling down');
};

const getRetryAfterSecondsFromError = (error: unknown): number => {
  const addMoneyError = error as Partial<AddMoneyError>;
  const message = typeof addMoneyError.message === 'string' ? addMoneyError.message : '';
  const retryAfterSeconds = getNormalizedRetryAfterSeconds(addMoneyError.retryAfterSeconds);

  if (retryAfterSeconds > 0) {
    return retryAfterSeconds;
  }

  return isAddMoneyCooldownError(addMoneyError, message) ? 24 * 60 * 60 : 0;
};

const getAddMoneyCooldownMessage = (retryAfterSeconds: number): string => {
  if (retryAfterSeconds > 0) {
    return `You can claim pilot credits again in ${formatTimeRemaining(retryAfterSeconds)}.`;
  }

  return 'Pilot credits are available now. You can claim again.';
};

const getAddMoneyErrorMessage = (error: unknown): string => {
  const addMoneyError = error as Partial<AddMoneyError>;
  const message = typeof addMoneyError.message === 'string'
    ? addMoneyError.message
    : 'Failed to claim pilot credits';
  const lowerMessage = message.toLowerCase();
  const code = addMoneyError.code || '';
  const retryAfterSeconds = getNormalizedRetryAfterSeconds(addMoneyError.retryAfterSeconds);

  if (isAddMoneyCooldownError(addMoneyError, message)) {
    if (retryAfterSeconds > 0) {
      return getAddMoneyCooldownMessage(retryAfterSeconds);
    }

    return 'Please wait 24 hours between pilot credit claims.';
  }

  if (code === 'DISTRIBUTION_LOW_ASSET' || (lowerMessage.includes('insufficient') && lowerMessage.includes('usdc'))) {
    return 'Pilot credit claims are temporarily unavailable because the relayer distribution account has no test asset balance.';
  }

  if (code === 'ACCOUNT_NOT_READY') {
    return 'Wallet setup could not finish yet. Please try again in a few seconds.';
  }

  if (code === 'ADD_MONEY_DISABLED') {
    return 'Pilot credit claims are disabled for this network.';
  }

  if (code === 'WALLET_OWNERSHIP_DENIED') {
    return 'Your wallet does not match your account. Sign out, sign back in, and try again.';
  }

  if (code === 'RELAYER_TIMEOUT' || lowerMessage.includes('taking too long')) {
    return 'Payment service is taking too long to respond. Please try again.';
  }

  if (code === 'RELAYER_UNREACHABLE' || lowerMessage.includes('not reachable')) {
    return 'Payment service is not reachable. Check your internet connection or relayer service.';
  }

  if (lowerMessage.includes('network') || lowerMessage.includes('connection') || lowerMessage.includes('fetch')) {
    return 'Please check your internet connection and try again.';
  }

  return message;
};

const getAddMoneyTitle = (phase: AddMoneyPhase): string => {
  switch (phase) {
    case 'checking':
      return 'Checking Claim';
    case 'confirm':
      return 'Claim Pilot Credits';
    case 'authenticating':
      return 'Authentication Required';
    case 'processing':
      return 'Claiming Credits';
    case 'success':
      return 'Credits Added';
    case 'cooldown':
      return 'Next Claim Available';
    case 'error':
      return 'Credit Claim Failed';
    default:
      return 'Claim Pilot Credits';
  }
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  useTheme();
  const [balance, setBalance] = useState<string>('0');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [addMoneyPhase, setAddMoneyPhase] = useState<AddMoneyPhase>('idle');
  const [addMoneyMessage, setAddMoneyMessage] = useState('');
  const [addMoneyTxHash, setAddMoneyTxHash] = useState('');
  const [addMoneyRetryAfterSeconds, setAddMoneyRetryAfterSeconds] = useState(0);
  const {
    idempotencyKey: addMoneyIntentKey,
    getOrCreateIntent: getOrCreateAddMoneyIntent,
    clearIntent: clearAddMoneyIntent,
  } = usePaymentIntent();
  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(50))[0];
  const isAddMoneyBusy = ['checking', 'authenticating', 'processing'].includes(addMoneyPhase);
  const visibleAddMoneyMessage = addMoneyPhase === 'cooldown'
    ? getAddMoneyCooldownMessage(addMoneyRetryAfterSeconds)
    : addMoneyMessage;

  useEffect(() => {
    if (addMoneyPhase !== 'cooldown' || addMoneyRetryAfterSeconds <= 0) {
      return;
    }

    const countdown = setInterval(() => {
      setAddMoneyRetryAfterSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => clearInterval(countdown);
  }, [addMoneyPhase, addMoneyRetryAfterSeconds]);

  useEffect(() => {
    loadWalletData();
    
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Start background polling for pending transactions
    startTransactionPolling(15000); // Poll every 15 seconds
    
    // Listen for new transactions (real-time updates within same app)
    const transactionListener = (transaction: Transaction) => {
      loadTransactions();
      // Also refresh balance
      if (walletAddress) {
        loadBalance(walletAddress);
      }
    };
    
    storageEvents.on('transactionSaved', transactionListener);
    
    // Setup Supabase real-time subscription for incoming transactions (for receivers)
    let supabaseSubscription: any = null;
    
    const setupRealtimeSubscription = async () => {
      if (!walletAddress) return;

      // Guard against filter-injection: validate the wallet address before
      // interpolating it into the PostgREST realtime filter string.
      // supabase-js realtime only accepts filter as a raw string, so strict
      // call-boundary validation is the correct mitigation here.
      // isValidAccountId uses the Stellar SDK's Ed25519 public-key checker,
      // which rejects anything that isn't a well-formed G-account address.
      if (!isValidAccountId(walletAddress)) {
        return;
      }
      
      Logger.info('🔔 Setting up Supabase real-time subscription');
      
      // walletAddress is a validated Stellar Ed25519 public key (56-char base32
      // starting with "G"), so interpolation here cannot carry filter syntax.
      supabaseSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'transactions',
            filter: `to_address=eq.${walletAddress}`,
          },
          (payload) => {
            loadTransactions();
            loadBalance(walletAddress);
          }
        )
        .subscribe();
    };
    
    if (walletAddress) {
      setupRealtimeSubscription();
    }
    
    // Cleanup on unmount
    return () => {
      stopTransactionPolling();
      storageEvents.off('transactionSaved', transactionListener);
      
      if (supabaseSubscription) {
        supabase.removeChannel(supabaseSubscription);
        Logger.info('🚫 Unsubscribed from Supabase real-time');
      }
    };
  }, [walletAddress]);

  // Refresh transactions when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadTransactions();
      if (walletAddress) {
        loadBalance(walletAddress);
      }
    }, [walletAddress])
  );

  const loadWalletData = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (address) {
        setWalletAddress(address);
        await loadBalance(address);
      }
    } catch (error) {
      Logger.error('Error loading wallet:', error);
    } finally {
      setLoading(false);
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

  const loadTransactions = async () => {
    try {
      const txs = await getTransactions();
      // Get last 5 transactions
      setTransactions(txs.slice(0, 10));
    } catch (error) {
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadBalance(walletAddress),
      loadTransactions(),
    ]);
    setRefreshing(false);
  };

  const handleSendMoney = () => {
    navigation.navigate('SendMoney');
  };

  const handleAddMoney = async () => {
    if (!walletAddress || addMoneyPhase !== 'idle') return;

    setAddMoneyTxHash('');
    setAddMoneyRetryAfterSeconds(0);
    setAddMoneyMessage('Checking when your next testnet USDC claim is available...');
    setAddMoneyPhase('checking');

    const retryAfterSeconds = await getTimeUntilNextAddMoney(walletAddress);

    if (retryAfterSeconds > 0) {
      setAddMoneyRetryAfterSeconds(retryAfterSeconds);
      setAddMoneyMessage('');
      setAddMoneyPhase('cooldown');
      clearAddMoneyIntent();
      return;
    }

    getOrCreateAddMoneyIntent();
    setAddMoneyMessage(`Claim ${formatMoneyAmount(ADD_MONEY_DISPLAY_AMOUNT)} for testnet use. One claim is available every 24 hours.`);
    setAddMoneyPhase('confirm');
  };

  const closeAddMoneyStatus = () => {
    if (!isAddMoneyBusy) {
      setAddMoneyPhase('idle');
      setAddMoneyMessage('');
      setAddMoneyTxHash('');
      setAddMoneyRetryAfterSeconds(0);
      clearAddMoneyIntent();
    }
  };

  const startAddMoney = async () => {
    if (!walletAddress || isAddMoneyBusy) return;

    try {
      const activeIntentKey = getOrCreateAddMoneyIntent();
      setAddMoneyTxHash('');
      setAddMoneyRetryAfterSeconds(0);
      setAddMoneyMessage('Confirm with PIN or biometrics to continue...');
      setAddMoneyPhase('authenticating');
      await waitForUiPaint();

      const wallet = await getAuthenticatedWallet(
        'Claim Testnet USDC',
        'Enter your 6-digit PIN to claim testnet USDC',
        'Unlock wallet to claim testnet USDC'
      );

      if (!wallet) {
        setAddMoneyMessage('Authentication was not completed. Please try again.');
        setAddMoneyPhase('error');
        return;
      }

      if (wallet.publicKey !== walletAddress) {
        setAddMoneyMessage('This device wallet does not match the active profile. Please sign in again before claiming testnet USDC.');
        setAddMoneyPhase('error');
        clearAddMoneyIntent();
        return;
      }

      setAddMoneyMessage('Preparing your wallet on Stellar testnet and adding USDC...');
      setAddMoneyPhase('processing');
      await waitForUiPaint();

      const txHash = await requestAddMoney(wallet, activeIntentKey);
      setAddMoneyTxHash(txHash);

      await saveTransaction({
        tx_hash: txHash,
        to_address: wallet.publicKey,
        amount: ADD_MONEY_DISPLAY_AMOUNT,
        status: 'success',
        internal_status: 'confirmed',
        user_visible_status: 'success',
        sender_name: 'C-Pay Testnet USDC',
        recipient_name: 'Your wallet',
        note: 'Testnet USDC added',
      });

      // Terminal state: clear intent
      clearAddMoneyIntent();

      void loadTransactions();
      void loadBalance(walletAddress);
      setTimeout(() => loadBalance(walletAddress), 5000);

      setAddMoneyMessage(`${formatMoneyAmount(ADD_MONEY_DISPLAY_AMOUNT)} has been added. Your balance will refresh automatically.`);
      setAddMoneyPhase('success');
    } catch (error: any) {
      Logger.error('Testnet USDC distribution error:', error);

      const retryAfterSeconds = getRetryAfterSecondsFromError(error);
      if (retryAfterSeconds > 0) {
        setAddMoneyRetryAfterSeconds(retryAfterSeconds);
        setAddMoneyMessage('');
        setAddMoneyPhase('cooldown');
        clearAddMoneyIntent();
        return;
      }

      setAddMoneyRetryAfterSeconds(0);
      setAddMoneyMessage(getAddMoneyErrorMessage(error));
      setAddMoneyPhase('error');
    }
  };

  if (loading && !walletAddress) {
    return (
      <LoadingSpinner fullScreen text="Loading your wallet..." />
    );
  }

  // Derive the add-money status sheet presentation from the current phase.
  const statusVariant: StatusSheetVariant = isAddMoneyBusy
    ? 'loading'
    : addMoneyPhase === 'success'
      ? 'success'
      : addMoneyPhase === 'cooldown'
        ? 'warning'
        : addMoneyPhase === 'error'
          ? 'error'
          : 'info';

  const statusMessage = addMoneyTxHash
    ? `${visibleAddMoneyMessage}\n\nTx ${addMoneyTxHash.slice(0, 10)}...${addMoneyTxHash.slice(-8)}`
    : visibleAddMoneyMessage;

  let statusActions: StatusSheetAction[] | undefined;
  if (addMoneyPhase === 'confirm') {
    statusActions = [
      { label: 'Claim', onPress: startAddMoney },
      { label: 'Cancel', onPress: closeAddMoneyStatus, variant: 'secondary' },
    ];
  } else if (addMoneyPhase === 'success') {
    statusActions = [
      { label: 'Done', onPress: closeAddMoneyStatus },
      {
        label: 'View History',
        onPress: () => {
          closeAddMoneyStatus();
          navigation.navigate('TransactionHistory');
        },
        variant: 'secondary',
      },
    ];
  } else if (addMoneyPhase === 'cooldown') {
    statusActions = addMoneyRetryAfterSeconds <= 0
      ? [
          { label: 'Claim Now', onPress: startAddMoney },
          { label: 'Close', onPress: closeAddMoneyStatus, variant: 'secondary' },
        ]
      : [{ label: 'Close', onPress: closeAddMoneyStatus }];
  } else if (addMoneyPhase === 'error') {
    statusActions = [
      { label: 'Try Again', onPress: startAddMoney },
      { label: 'Close', onPress: closeAddMoneyStatus, variant: 'secondary' },
    ];
  }

  return (
    <Screen
      topInset={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Balance Card with Gradient */}
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          <View style={styles.balanceHeader}>
            <View style={styles.balanceLabelContainer}>
              <Ionicons
                name="wallet-outline"
                size={18}
                color={COLORS.textInverse}
                style={styles.balanceIcon}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.balanceLabel}>{MONEY_BALANCE_LABEL}</Text>
            </View>
          </View>

          <View
            style={styles.balanceAmountContainer}
            accessible
            accessibilityLabel={`${MONEY_BALANCE_LABEL}: ${formatMoneyBalance(balance)} ${MONEY_UNIT_LABEL}. Testnet only.`}
          >
            <Text
              style={styles.balanceCurrency}
              importantForAccessibility="no"
              accessibilityElementsHidden
            >
              {MONEY_SYMBOL}
            </Text>
            <Text
              style={styles.balanceAmount}
              importantForAccessibility="no"
              // Cap font scaling so large-text mode doesn't break the card layout
              maxFontSizeMultiplier={1.2}
            >
              {formatMoneyBalance(balance)}
            </Text>
          </View>

          <Text
            style={styles.balanceUsd}
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            USD Coin on Stellar testnet
          </Text>
        </LinearGradient>
      </Animated.View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={handleSendMoney}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Send credits"
          accessibilityHint="Go to send money screen"
        >
          <View
            style={[styles.actionIconContainer, { backgroundColor: COLORS.primary + '20' }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Ionicons name="send-outline" size={23} color={COLORS.primary} />
          </View>
          <Text style={styles.actionTitle} importantForAccessibility="no-hide-descendants">
            Send Credits
          </Text>
        </TouchableOpacity>

        <View
          style={[styles.actionCard, styles.actionCardDisabled]}
          accessibilityRole="text"
          accessibilityLabel="Add money coming soon through a licensed partner"
        >
          <View
            style={[styles.actionIconContainer, { backgroundColor: COLORS.success + '20' }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Ionicons name="add-circle-outline" size={24} color={COLORS.textMuted} />
          </View>
          <Text style={styles.actionTitle} importantForAccessibility="no-hide-descendants">
            Add Money
          </Text>
          <Text style={styles.actionSubtitle}>Licensed partner coming soon</Text>
        </View>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('TransactionHistory')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="View transaction history"
        >
          <View
            style={[styles.actionIconContainer, { backgroundColor: COLORS.info + '20' }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Ionicons name="receipt-outline" size={23} color={COLORS.info} />
          </View>
          <Text style={styles.actionTitle} importantForAccessibility="no-hide-descendants">
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* Recent Transactions Section */}
      <Section
        title="Recent Transactions"
        actionLabel={transactions.length > 0 ? 'See All' : undefined}
        onActionPress={() => navigation.navigate('TransactionHistory')}
      >
        {transactions.length === 0 ? (
          <View style={styles.emptyTransactions}>
            <Ionicons name="card-outline" size={44} color={COLORS.textTertiary} style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>No Transactions Yet</Text>
            <Text style={styles.emptyDescription}>
              Your transaction history will appear here
            </Text>
          </View>
        ) : (
          <View style={styles.transactionsList}>
            {transactions.map((transaction, index) => (
              <TransactionItem
                key={transaction.tx_hash || index}
                transaction={{
                  ...transaction,
                  id: transaction.id || transaction.tx_hash,
                  created_at: transaction.created_at || new Date().toISOString(),
                }}
                currentWallet={walletAddress}
                onPress={() => {
                  setSelectedTransaction({
                    ...transaction,
                    id: transaction.id || transaction.tx_hash,
                    created_at: transaction.created_at || new Date().toISOString(),
                  });
                  setShowTransactionModal(true);
                }}
              />
            ))}
          </View>
        )}
      </Section>

      {/* Info Banner */}
      <InfoBanner
        variant="info"
        title={PILOT_NOTICE_TITLE}
        message={PILOT_NOTICE_TEXT}
      />

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        visible={showTransactionModal}
        transaction={selectedTransaction}
        onClose={() => {
          setShowTransactionModal(false);
          setSelectedTransaction(null);
        }}
        currentWallet={walletAddress}
      />

      {/* Add-money / claim credits status flow */}
      <StatusSheet
        visible={addMoneyPhase !== 'idle'}
        variant={statusVariant}
        title={getAddMoneyTitle(addMoneyPhase)}
        message={statusMessage}
        actions={statusActions}
        onRequestClose={isAddMoneyBusy ? undefined : closeAddMoneyStatus}
      />
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  balanceCard: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
    position: 'relative',
    ...SHADOWS.lg,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  balanceLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceIcon: {
    marginRight: SPACING.xs,
  },
  balanceLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    opacity: 0.9,
    fontWeight: '600',
  },
  balanceAmountContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceAmount: {
    marginRight: SPACING.sm,
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.textInverse,
    letterSpacing: -1,
  },
  balanceCurrency: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textInverse,
    opacity: 0.85,
    fontWeight: '700',
  },
  balanceUsd: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    opacity: 0.7,
    marginTop: SPACING.xs,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: -SPACING.xs,
    marginBottom: SPACING.xl,
  },
  actionCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.md,
    alignItems: 'center',
    marginHorizontal: SPACING.xs,
    ...SHADOWS.sm,
  },
  actionCardDisabled: {
    opacity: 0.65,
  },
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  actionTitle: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  actionSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  transactionsList: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  emptyTransactions: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  emptyIcon: {
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  emptyDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
}));
