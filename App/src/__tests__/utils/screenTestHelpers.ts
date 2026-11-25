jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initialValue: unknown) => [initialValue, jest.fn()],
    useRef: (initialValue: unknown) => ({ current: initialValue }),
    useEffect: jest.fn(),
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useContext: jest.fn(() => ({})),
  };
});

import React from 'react';

const textProps = ['children', 'footer', 'title', 'label', 'placeholder', 'accessibilityLabel'];

export function getScreenText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getScreenText).join(' ');
  }

  if (!React.isValidElement(node)) {
    return '';
  }

  const props = node.props as Record<string, unknown>;
  return textProps.map((key) => getScreenText(props[key])).join(' ');
}

export function findPressHandlerWithText(node: unknown, text: string): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findPressHandlerWithText(child, text);
      if (match) return match;
    }
    return null;
  }

  if (!React.isValidElement(node)) {
    return null;
  }

  const props = node.props as Record<string, unknown>;
  const onPress = props.onPress;
  if (typeof onPress === 'function' && getScreenText(node).includes(text)) {
    return () => onPress();
  }

  for (const key of textProps) {
    const match = findPressHandlerWithText(props[key], text);
    if (match) return match;
  }

  return null;
}
