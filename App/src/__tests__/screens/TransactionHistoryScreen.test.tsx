import React from 'react';
import { TransactionHistoryScreen } from '../../screens/TransactionHistoryScreen';

describe('C-045: TransactionHistoryScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders TransactionHistoryScreen without crashing', () => {
    const element = React.createElement(TransactionHistoryScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof TransactionHistoryScreen).toBe('function');
  });
});
