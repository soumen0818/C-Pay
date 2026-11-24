import { useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthenticatedWallet } from '../utils/biometric';
import { formatWalletFingerprint } from '../utils/cpayId';
import { transferTokens } from '../services/blockchain';
import { saveTransaction } from '../services/storage';
import { AlertManager } from '../utils/alert';
import { getPaymentFailureCopy } from '../utils/paymentFailure';
import { Logger } from '../utils/logger';
import { PAYMENT } from '../utils/strings';

interface UsePaymentSubmissionProps {
  navigation: any;
  amount: string;
  recipientAddress: string;
  recipientName: string;
  recipientCPayId: string;
  walletAddress: string;
  note: string;
  getOrCreateIntent: () => string;
  clearIntent: () => void;
}

export const usePaymentSubmission = ({
  navigation,
  amount,
  recipientAddress,
  recipientName,
  recipientCPayId,
  walletAddress,
  note,
  getOrCreateIntent,
  clearIntent,
}: UsePaymentSubmissionProps) => {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const paymentInProgress = useRef<boolean>(false);
  const networkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const executePayment = async (onReviewClose: () => void) => {
    if (paymentInProgress.current) return;

    const displayId = recipientCPayId || formatWalletFingerprint(recipientAddress);
    const activeIntentKey = getOrCreateIntent();

    const timestamp = () =>
      new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    try {
      setSubmitting(true);
      onReviewClose();
      paymentInProgress.current = true;

      networkTimeoutRef.current = setTimeout(() => {
        if (paymentInProgress.current) {
          AlertManager.alert(
            'Slow Network Detected',
            'Your network connection is slow. The payment is still processing...',
            [{ text: 'OK' }]
          );
        }
      }, 10000);

      const wallet = await getAuthenticatedWallet(
        'Confirm Payment',
        PAYMENT.AUTH_PIN_PROMPT,
        PAYMENT.AUTH_BIOMETRIC_PROMPT
      );
      
      if (!wallet) {
        paymentInProgress.current = false;
        if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
        setSubmitting(false);
        AlertManager.alert('Authentication Failed', 'Transaction cancelled');
        return;
      }

      const startTime = Date.now();

      navigation.replace('PaymentProcessing', {
        amount,
        recipientName: recipientName || displayId,
        recipientAddress: recipientAddress.trim(),
      });

      const txHash = await transferTokens(
        wallet,
        recipientAddress.trim(),
        amount,
        {
          note,
          idempotencyKey: activeIntentKey,
        }
      );

      if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
      paymentInProgress.current = false;

      clearIntent();

      const processingTime = Math.round((Date.now() - startTime) / 1000);
      const senderName = await AsyncStorage.getItem('user_name');

      const transactionData = {
        tx_hash: txHash,
        to_address: recipientAddress.trim(),
        from_address: walletAddress,
        amount,
        status: 'pending' as const,
        internal_status: 'submitted' as const,
        recipient_name: recipientName || undefined,
        sender_name: senderName || undefined,
        note: note || undefined,
        created_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        transaction_type: 'personal' as const,
      };

      saveTransaction(transactionData)
        .catch(err => Logger.error('Transaction save/sync error:', err));

      navigation.replace('PaymentSuccess', {
        transactionHash: txHash,
        fromAddress: walletAddress,
        amount,
        recipientName: recipientName || displayId,
        recipientAddress: recipientAddress.trim(),
        processingTime: processingTime || 2,
        timestamp: timestamp(),
        note: note || undefined,
      });
    } catch (error: any) {
      if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
      paymentInProgress.current = false;
      setSubmitting(false);

      const copy = getPaymentFailureCopy(error);
      const isTerminalFailure = copy.category === 'support';
      if (isTerminalFailure) {
        clearIntent();
      }

      navigation.replace('PaymentFailure', {
        amount,
        recipientName: recipientName || displayId,
        recipientAddress: recipientAddress.trim(),
        errorMessage: copy.errorMessage,
        errorReason: copy.errorReason,
        errorCode: copy.errorCode,
        category: copy.category,
        timestamp: timestamp(),
        note: note || undefined,
        idempotencyKey: isTerminalFailure ? undefined : activeIntentKey,
      });
    }
  };

  return {
    submitting,
    paymentInProgress,
    networkTimeoutRef,
    executePayment,
  };
};
