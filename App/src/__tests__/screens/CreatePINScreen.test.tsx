import { getScreenText } from '../utils/screenTestHelpers';
import { CreatePINScreen } from '../../screens/CreatePINScreen';

describe('C-045: CreatePINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('explains PIN requirements before wallet setup', () => {
    const route = { params: {} };
    const screen = CreatePINScreen({ navigation, route });
    const text = getScreenText(screen);
    expect(text).toContain('Create Your PIN');
    expect(text).toContain('Avoid obvious patterns');
  });
});
