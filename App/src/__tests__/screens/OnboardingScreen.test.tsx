import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { OnboardingScreen } from '../../screens/OnboardingScreen';

describe('C-045: OnboardingScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('shows the welcome screen and opens email verification', () => {
    const screen = OnboardingScreen({ navigation });
    expect(getScreenText(screen)).toContain('C-Pay');

    const getStarted = findPressHandlerWithText(screen, 'Get Started');
    expect(getStarted).not.toBeNull();
    getStarted?.();
    expect(navigation.navigate).toHaveBeenCalledWith('EmailVerification');
  });
});
