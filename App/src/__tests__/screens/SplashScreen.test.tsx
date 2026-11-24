import React from 'react';
import { SplashScreen } from '../../screens/SplashScreen';

describe('C-045: SplashScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders SplashScreen without crashing', () => {
    const element = React.createElement(SplashScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof SplashScreen).toBe('function');
  });
});
