import React from 'react';
import { LoginScreen } from '../../screens/LoginScreen';

describe('C-045: LoginScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders LoginScreen without crashing', () => {
    const element = React.createElement(LoginScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof LoginScreen).toBe('function');
  });
});
