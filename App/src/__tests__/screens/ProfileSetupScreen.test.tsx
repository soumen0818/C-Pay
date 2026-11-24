import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { ProfileSetupScreen } from '../../screens/ProfileSetupScreen';

describe('C-045: ProfileSetupScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('shows the profile details and setup action', () => {
    const route = { params: { walletAddress: 'GABC123' } };
    const screen = ProfileSetupScreen({ navigation, route });
    expect(getScreenText(screen)).toContain('Complete Your Profile');
    expect(findPressHandlerWithText(screen, 'Complete Setup')).not.toBeNull();
  });
});
