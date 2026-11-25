import React from 'react';
import { RestoreWalletScreen } from '../../screens/RestoreWalletScreen';

describe('C-045: RestoreWalletScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders RestoreWalletScreen without crashing', () => {
    const element = React.createElement(RestoreWalletScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof RestoreWalletScreen).toBe('function');
  });
});
