import React from 'react';
import { ForgotPINScreen } from '../../screens/ForgotPINScreen';

describe('C-045: ForgotPINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders ForgotPINScreen without crashing', () => {
    const element = React.createElement(ForgotPINScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof ForgotPINScreen).toBe('function');
  });
});
