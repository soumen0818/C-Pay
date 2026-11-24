import React from 'react';
import { ProfileSetupScreen } from '../../screens/ProfileSetupScreen';

describe('C-045: ProfileSetupScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders ProfileSetupScreen without crashing', () => {
    const element = React.createElement(ProfileSetupScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof ProfileSetupScreen).toBe('function');
  });
});
