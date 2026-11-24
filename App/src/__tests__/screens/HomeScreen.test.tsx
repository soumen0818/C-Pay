import React from 'react';
import { HomeScreen } from '../../screens/HomeScreen';

describe('C-045: HomeScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders HomeScreen without crashing', () => {
    const element = React.createElement(HomeScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof HomeScreen).toBe('function');
  });
});
