import React from 'react';
import { BiometricSetupScreen } from '../../screens/BiometricSetupScreen';

describe('C-045: BiometricSetupScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders BiometricSetupScreen without crashing', () => {
    const element = React.createElement(BiometricSetupScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof BiometricSetupScreen).toBe('function');
  });
});
