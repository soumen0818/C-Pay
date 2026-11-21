// Minimal react-native mock so utilities that import Alert do not crash in Node
export const Alert = {
  alert: jest.fn(),
};

export const Platform = {
  OS: 'android',
  select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
};

export const StyleSheet = {
  create: <T extends object>(styles: T) => styles,
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};
