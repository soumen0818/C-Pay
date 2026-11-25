import { getScreenText } from '../utils/screenTestHelpers';
import { SplashScreen } from '../../screens/SplashScreen';

describe('C-045: SplashScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('shows the startup state while the wallet is checked', () => {
    const screen = SplashScreen({ navigation });
    const text = getScreenText(screen);
    expect(text).toContain('C-Pay');
    expect(text).toContain('Loading...');
  });
});
