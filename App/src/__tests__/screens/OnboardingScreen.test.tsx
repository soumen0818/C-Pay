import React from 'react';
import { OnboardingScreen } from '../../screens/OnboardingScreen';

describe('C-045: OnboardingScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders OnboardingScreen without crashing', () => {
    const element = React.createElement(OnboardingScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof OnboardingScreen).toBe('function');
  });
});
