import React from 'react';

const createComponent = (name: string) => {
  const Component = (props: any) => {
    return React.createElement(name, props, props.children);
  };
  Component.displayName = name;
  return Component;
};

export const View = createComponent('View');
export const Text = createComponent('Text');
export const TouchableOpacity = createComponent('TouchableOpacity');
export const ScrollView = createComponent('ScrollView');
export const TextInput = createComponent('TextInput');
export const Image = createComponent('Image');
export const ActivityIndicator = createComponent('ActivityIndicator');
export const Switch = createComponent('Switch');
export const Modal = createComponent('Modal');
export const RefreshControl = createComponent('RefreshControl');
export const SafeAreaView = createComponent('SafeAreaView');
export const FlatList = createComponent('FlatList');
export const SectionList = createComponent('SectionList');
export const Pressable = createComponent('Pressable');
export const KeyboardAvoidingView = createComponent('KeyboardAvoidingView');
export const StatusBar = createComponent('StatusBar');

export const Alert = {
  alert: jest.fn(),
};

export const Platform = {
  OS: 'android',
  select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
};

export const StyleSheet = {
  create: <T extends object>(styles: T) => styles,
  hairlineWidth: 1,
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const Dimensions = {
  get: jest.fn(() => ({ width: 375, height: 812, scale: 2, fontScale: 1 })),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const useWindowDimensions = jest.fn(() => ({ width: 375, height: 812, scale: 2, fontScale: 1 }));

export const Linking = {
  openURL: jest.fn(() => Promise.resolve()),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
};

export const Animated = {
  Value: jest.fn(function (val: any) {
    this._value = val;
    this.setValue = jest.fn((v) => { this._value = v; });
    this.interpolate = jest.fn(() => 0);
  }),
  timing: jest.fn(() => ({ start: (cb?: any) => cb && cb({ finished: true }) })),
  spring: jest.fn(() => ({ start: (cb?: any) => cb && cb({ finished: true }) })),
  sequence: jest.fn(() => ({ start: (cb?: any) => cb && cb({ finished: true }) })),
  parallel: jest.fn(() => ({ start: (cb?: any) => cb && cb({ finished: true }) })),
  loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  View: createComponent('Animated.View'),
  Text: createComponent('Animated.Text'),
  Image: createComponent('Animated.Image'),
};

export const Easing = {
  linear: jest.fn(),
  ease: jest.fn(),
  quad: jest.fn(),
  cubic: jest.fn(),
  poly: jest.fn(),
  sin: jest.fn(),
  circle: jest.fn(),
  exp: jest.fn(),
  elastic: jest.fn(),
  back: jest.fn(),
  bounce: jest.fn(),
  bezier: jest.fn(),
  in: jest.fn(),
  out: jest.fn(),
  inOut: jest.fn(),
};

export const BackHandler = {
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  removeEventListener: jest.fn(),
  exitApp: jest.fn(),
};

export const InteractionManager = {
  runAfterInteractions: jest.fn((cb: any) => {
    if (typeof cb === 'function') cb();
    return { cancel: jest.fn() };
  }),
};

export const I18nManager = {
  isRTL: false,
  allowRTL: jest.fn(),
  forceRTL: jest.fn(),
};
