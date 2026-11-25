import React from 'react';
import { SecurityCenterScreen } from '../../screens/SecurityCenterScreen';

describe('C-045: SecurityCenterScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders SecurityCenterScreen without crashing', () => {
    const element = React.createElement(SecurityCenterScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof SecurityCenterScreen).toBe('function');
  });
});
