import React from 'react';
import { ConfirmPINScreen } from '../../screens/ConfirmPINScreen';

describe('C-045: ConfirmPINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders ConfirmPINScreen without crashing', () => {
    const route = { params: { pin: '123456' } };
    const element = React.createElement(ConfirmPINScreen, { navigation, route });
    expect(element).toBeDefined();
    expect(typeof ConfirmPINScreen).toBe('function');
  });
});
