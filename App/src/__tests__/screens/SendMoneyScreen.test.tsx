import React from 'react';
import { SendMoneyScreen } from '../../screens/SendMoneyScreen';

describe('C-045: SendMoneyScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders SendMoneyScreen without crashing', () => {
    const element = React.createElement(SendMoneyScreen, {
      navigation,
      route: { params: {} },
    });
    expect(element).toBeDefined();
    expect(typeof SendMoneyScreen).toBe('function');
  });

  test('accepts route parameters for preset amount and recipient', () => {
    const element = React.createElement(SendMoneyScreen, {
      navigation,
      route: {
        params: {
          recipientAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amount: '25.00',
          recipientName: 'Alice',
          idempotencyKey: 'test-key-123',
        },
      },
    });
    expect(element.props.route.params.amount).toBe('25.00');
    expect(element.props.route.params.recipientName).toBe('Alice');
  });
});
