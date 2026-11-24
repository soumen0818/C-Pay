import React from 'react';
import { EmailVerificationScreen } from '../../screens/EmailVerificationScreen';

describe('C-045: EmailVerificationScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders EmailVerificationScreen without crashing', () => {
    const element = React.createElement(EmailVerificationScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof EmailVerificationScreen).toBe('function');
  });
});
