import { findPressHandlerWithText, getScreenText } from '../utils/screenTestHelpers';
import { ChangePINScreen } from '../../screens/ChangePINScreen';

describe('C-045: ChangePINScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('starts by verifying the current PIN and supports cancellation', () => {
    const screen = ChangePINScreen({ navigation });
    expect(getScreenText(screen)).toContain('Enter Current PIN');

    const cancel = findPressHandlerWithText(screen, 'Cancel');
    expect(cancel).not.toBeNull();
    cancel?.();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
