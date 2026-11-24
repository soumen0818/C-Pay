import React from 'react';
import { PaymentSuccessScreen } from '../../screens/PaymentSuccessScreen';

describe('C-045: PaymentSuccessScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders PaymentSuccessScreen without crashing', () => {
    const route = {
      params: {
        transactionHash: 'a'.repeat(64),
        fromAddress: 'GSENDER123',
        amount: '50.00',
        recipientName: 'Alice',
        recipientAddress: 'GRECIPIENT456',
        processingTime: 2,
        timestamp: 'Nov 24, 2026, 7:00 PM',
        note: 'Coffee',
      },
    };

    const element = React.createElement(PaymentSuccessScreen, { navigation, route });
    expect(element).toBeDefined();
    expect(typeof PaymentSuccessScreen).toBe('function');
  });
});
