import React from 'react';

export const useNavigation = jest.fn(() => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  reset: jest.fn(),
}));

export const useRoute = jest.fn(() => ({
  params: {},
}));

export const useFocusEffect = jest.fn((cb: any) => {
  React.useEffect(() => {
    const cleanup = cb();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);
});

export const useIsFocused = jest.fn(() => true);

export const NavigationContainer = (props: any) => props.children ?? null;

export default {
  useNavigation,
  useRoute,
  useFocusEffect,
  useIsFocused,
  NavigationContainer,
};
