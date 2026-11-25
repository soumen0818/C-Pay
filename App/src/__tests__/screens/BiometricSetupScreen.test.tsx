import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { BiometricSetupScreen } from '../../screens/BiometricSetupScreen';

describe('C-045: BiometricSetupScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('offers PIN access when biometrics are not available', () => {
    const screen = BiometricSetupScreen({ navigation });
    expect(getScreenText(screen)).toContain('All Set!');

    const getStarted = findPressHandlerWithText(screen, 'Get Started');
    expect(getStarted).not.toBeNull();
    getStarted?.();
    expect(navigation.replace).toHaveBeenCalledWith('MainTabs');
  });
});
