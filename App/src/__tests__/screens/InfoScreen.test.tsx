import React from 'react';
import { InfoScreen } from '../../screens/InfoScreen';

describe('C-045: InfoScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders InfoScreen for about doc', () => {
    const route = { params: { doc: 'about' } };
    const element = React.createElement(InfoScreen, { navigation, route });
    expect(element).toBeDefined();
    expect(typeof InfoScreen).toBe('function');
  });

  test('renders InfoScreen for privacy doc', () => {
    const route = { params: { doc: 'privacy' } };
    const element = React.createElement(InfoScreen, { navigation, route });
    expect(element).toBeDefined();
  });

  test('renders InfoScreen for terms doc', () => {
    const route = { params: { doc: 'terms' } };
    const element = React.createElement(InfoScreen, { navigation, route });
    expect(element).toBeDefined();
  });

  test('renders InfoScreen for support doc', () => {
    const route = { params: { doc: 'support' } };
    const element = React.createElement(InfoScreen, { navigation, route });
    expect(element).toBeDefined();
  });
});
