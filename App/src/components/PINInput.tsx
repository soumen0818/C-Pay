import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import type { TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';

const FONT_SIZES = TYPOGRAPHY.sizes;

const PIN_LENGTH = 6;

interface PINInputProps {
  value: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  error?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  length?: number;
  secure?: boolean;
  accessibilityLabel?: string;
  textContentType?: TextInputProps['textContentType'];
  autoComplete?: TextInputProps['autoComplete'];
}

export const PINInput: React.FC<PINInputProps> = memo(({
  value,
  onChange,
  onComplete,
  error,
  autoFocus = false,
  disabled = false,
  length = PIN_LENGTH,
  secure = true,
  accessibilityLabel = 'PIN input',
  textContentType = 'none',
  autoComplete = 'off',
}) => {
  useTheme();
  const inputRef = useRef<TextInput | null>(null);
  const lastCompletedPin = useRef('');
  const [isFocused, setIsFocused] = useState(false);
  const compact = length > PIN_LENGTH;

  useEffect(() => {
    if (autoFocus && !disabled) {
      const timeout = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timeout);
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (value.length === length && value !== lastCompletedPin.current) {
      lastCompletedPin.current = value;
      onComplete?.(value);
    }
    if (value.length < length) {
      lastCompletedPin.current = '';
    }
  }, [value, length, onComplete]);

  const handleChange = useCallback((text: string) => {
    onChange(text.replace(/\D/g, '').slice(0, length));
  }, [length, onChange]);

  return (
    <View style={styles.container}>
      <View style={[styles.pinContainer, compact && styles.pinContainerCompact]}>
        <View style={styles.pinVisualLayer} pointerEvents="none">
          {Array.from({ length }).map((_, index) => {
            const isActive =
              isFocused &&
              !disabled &&
              !error &&
              (value.length === index || (value.length === length && index === length - 1));
            const isFilled = Boolean(value[index]);

            return (
              <View
                key={index}
                style={[
                  styles.pinBox,
                  compact && styles.pinBoxCompact,
                  error && styles.pinBoxError,
                  isFilled && styles.pinBoxFilled,
                  isActive && styles.pinBoxFocused,
                  disabled && styles.pinBoxDisabled,
                ]}
              >
                {isFilled && (
                  secure ? (
                    <View style={[styles.pinDot, error && styles.pinDotError]} />
                  ) : (
                    <Text style={[
                      styles.pinDigit,
                      compact && styles.pinDigitCompact,
                      error && styles.pinDigitError,
                    ]}>
                      {value[index]}
                    </Text>
                  )
                )}
              </View>
            );
          })}
        </View>

        <TextInput
          ref={inputRef}
          style={styles.nativeInput}
          value={value}
          onChangeText={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          keyboardType="number-pad"
          textContentType={textContentType}
          autoComplete={autoComplete}
          importantForAutofill={autoComplete === 'off' ? 'no' : 'yes'}
          maxLength={length}
          secureTextEntry={secure}
          caretHidden
          showSoftInputOnFocus
          selectionColor="transparent"
          editable={!disabled}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={`Enter ${length} digits`}
          accessibilityValue={{ text: `${value.length} of ${length} digits entered` }}
          accessibilityState={{ disabled }}
        />
      </View>

      {error && (
        <View style={styles.messageContainer}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
});

const styles = createThemedStyles((COLORS) => ({
  container: {
    alignItems: 'center',
    width: '100%',
  },
  pinContainer: {
    width: '100%',
    maxWidth: 360,
    minHeight: 58,
    position: 'relative',
  },
  pinContainerCompact: {
    maxWidth: 420,
    minHeight: 52,
  },
  pinVisualLayer: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
  },
  pinBox: {
    flex: 1,
    maxWidth: 52,
    minWidth: 42,
    height: 58,
    marginHorizontal: 4,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    ...SHADOWS.sm,
  },
  pinBoxCompact: {
    maxWidth: 42,
    minWidth: 32,
    height: 52,
    marginHorizontal: 3,
  },
  pinBoxFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  pinBoxFilled: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  pinBoxError: {
    borderColor: COLORS.error,
    backgroundColor: COLORS.errorBg,
  },
  pinBoxDisabled: {
    opacity: 0.9,
  },
  nativeInput: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    color: 'transparent',
    backgroundColor: 'transparent',
    fontSize: 11,
    lineHeight: 11,
    padding: 0,
    textAlign: 'center',
  },
  pinDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: COLORS.primary,
  },
  pinDotError: {
    backgroundColor: COLORS.error,
  },
  pinDigit: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  pinDigitCompact: {
    fontSize: FONT_SIZES.lg,
  },
  pinDigitError: {
    color: COLORS.error,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    minHeight: 24,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  errorText: {
    flexShrink: 1,
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
}));
