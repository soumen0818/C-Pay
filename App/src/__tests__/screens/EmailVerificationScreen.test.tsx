import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { EmailVerificationScreen } from '../../screens/EmailVerificationScreen';

describe('C-045: EmailVerificationScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('starts with the email verification step', () => {
    const screen = EmailVerificationScreen({ navigation });
    expect(getScreenText(screen)).toContain('Verify with Email');
    expect(findPressHandlerWithText(screen, 'Send Email Code')).not.toBeNull();
  });
});
