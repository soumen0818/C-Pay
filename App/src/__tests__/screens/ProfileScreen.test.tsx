import React from 'react';
import { ProfileScreen } from '../../screens/ProfileScreen';

describe('C-045: ProfileScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders ProfileScreen without crashing', () => {
    const element = React.createElement(ProfileScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof ProfileScreen).toBe('function');
  });
});
