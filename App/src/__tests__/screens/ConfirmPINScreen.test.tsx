import { getScreenText } from '../utils/screenTestHelpers';
import { ConfirmPINScreen } from '../../screens/ConfirmPINScreen';

describe('C-045: ConfirmPINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('asks the user to confirm the new PIN', () => {
    const route = { params: { pin: '123456' } };
    const screen = ConfirmPINScreen({ navigation, route });
    expect(getScreenText(screen)).toContain('Confirm Your PIN');
  });
});
