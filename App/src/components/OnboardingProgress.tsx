import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';

export type OnboardingFlowType = 'setup' | 'restore';

interface OnboardingProgressProps {
  currentStep: number;
  flowType?: OnboardingFlowType;
}

export const OnboardingProgress: React.FC<OnboardingProgressProps> = ({
  currentStep,
  flowType = 'setup',
}) => {
  useTheme();
  const steps = flowType === 'setup'
    ? [
        { label: 'Email', number: 1 },
        { label: 'PIN', number: 2 },
        { label: 'Profile', number: 3 },
        { label: 'Backup', number: 4 },
        { label: 'Biometrics', number: 5 },
      ]
    : [
        { label: 'Email', number: 1 },
        { label: 'Restore', number: 2 },
        { label: 'Biometrics', number: 3 },
      ];

  return (
    <View style={styles.container}>
      <View style={styles.progressLineContainer}>
        <View style={styles.backgroundLine} />
        <View
          style={[
            styles.activeLine,
            {
              width: `${((currentStep - 1) / (steps.length - 1)) * 100}%`
            }
          ]}
        />
      </View>
      <View style={styles.stepsContainer}>
        {steps.map((step) => {
          const isCompleted = step.number < currentStep;
          const isActive = step.number === currentStep;

          return (
            <View key={step.number} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  isCompleted && styles.stepDotCompleted,
                  isActive && styles.stepDotActive,
                ]}
              >
                <Text
                  style={[
                    styles.stepNumberText,
                    isCompleted && styles.stepNumberTextCompleted,
                    isActive && styles.stepNumberTextActive,
                  ]}
                >
                  {step.number}
                </Text>
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  (isActive || isCompleted) && styles.stepLabelActive,
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    paddingHorizontal: SPACING.md,
    marginVertical: SPACING.md,
    alignItems: 'center',
    width: '100%',
  },
  progressLineContainer: {
    position: 'absolute',
    top: 14,
    left: '10%',
    right: '10%',
    height: 3,
    zIndex: 0,
  },
  backgroundLine: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.border,
    borderRadius: 2,
  },
  activeLine: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  stepsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    zIndex: 1,
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  stepDotActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  stepDotCompleted: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  stepNumberText: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: 'bold',
    color: COLORS.textTertiary,
  },
  stepNumberTextActive: {
    color: COLORS.primary,
  },
  stepNumberTextCompleted: {
    color: COLORS.textInverse,
  },
  stepLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontWeight: '500',
  },
  stepLabelActive: {
    color: COLORS.text,
    fontWeight: 'bold',
  },
}));
