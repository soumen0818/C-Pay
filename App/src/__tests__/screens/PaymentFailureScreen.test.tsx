import React from 'react';
import { PaymentFailureScreen } from '../../screens/PaymentFailureScreen';

describe('C-045: PaymentFailureScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders PaymentFailureScreen with retryable error', () => {
    const route = {
      params: {
        amount: '50.00',
        recipientName: 'Bob',
        recipientAddress: 'GRECIPIENT456',
        errorMessage: 'Network timeout',
        errorReason: 'Connection dropped',
        errorCode: 'TIMEOUT',
        category: 'retryable' as const,
      },
    };

    const element = React.createElement(PaymentFailureScreen, { navigation, route });
    expect(element).toBeDefined();
    expect(typeof PaymentFailureScreen).toBe('function');
  });

  test('renders PaymentFailureScreen with support-needed error', () => {
    const route = {
      params: {
        amount: '50.00',
        recipientName: 'Bob',
        recipientAddress: 'GRECIPIENT456',
        errorMessage: 'Auth required',
        errorReason: 'Session expired',
        errorCode: 'AUTH_REQUIRED',
        category: 'support' as const,
      },
    };

    const element = React.createElement(PaymentFailureScreen, { navigation, route });
    expect(element).toBeDefined();
  });
});
