import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { LoginScreen } from '../../screens/LoginScreen';

describe('C-045: LoginScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('shows the login prompt and opens PIN recovery', () => {
    const screen = LoginScreen({ navigation });
    expect(getScreenText(screen)).toContain('Welcome Back');

    const forgotPin = findPressHandlerWithText(screen, 'Forgot PIN?');
    expect(forgotPin).not.toBeNull();
    forgotPin?.();
    expect(navigation.navigate).toHaveBeenCalledWith('ForgotPIN');
  });
});
