import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { ForgotPINScreen } from '../../screens/ForgotPINScreen';

describe('C-045: ForgotPINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('shows PIN recovery and returns when cancelled', () => {
    const screen = ForgotPINScreen({ navigation });
    expect(getScreenText(screen)).toContain('Reset PIN');

    const cancel = findPressHandlerWithText(screen, 'Cancel');
    expect(cancel).not.toBeNull();
    cancel?.();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
