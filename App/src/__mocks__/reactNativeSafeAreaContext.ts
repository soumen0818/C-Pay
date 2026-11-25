import React from 'react';

export const useSafeAreaInsets = jest.fn(() => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
}));

export const SafeAreaProvider = (props: any) => props.children ?? null;
export const SafeAreaView = (props: any) => props.children ?? null;
export const SafeAreaConsumer = (props: any) => props.children({ top: 0, bottom: 0, left: 0, right: 0 });

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
};

export default {
  useSafeAreaInsets,
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaConsumer,
  initialWindowMetrics,
};
