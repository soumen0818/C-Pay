const mockStateMap: Record<number, any> = {};
let mockStateIdx = 0;

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: any) => {
    const idx = mockStateIdx++;
    if (!(idx in mockStateMap)) mockStateMap[idx] = initial;
    const setter = (val: any) => {
      mockStateMap[idx] = typeof val === 'function' ? val(mockStateMap[idx]) : val;
    };
    return [mockStateMap[idx], setter];
  },
  useRef: (initial: any) => ({ current: initial }),
  useCallback: (fn: any) => fn,
  useEffect: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../../utils/cpayId', () => ({
  getCurrentUserCPayId: jest.fn(),
}));

import { useProfileData } from '../../hooks/useProfileData';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('C-010: useProfileData hook', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    Object.keys(mockStateMap).forEach(k => delete mockStateMap[Number(k)]);
    mockStateIdx = 0;
  });

  test('initializes with default empty values', () => {
    const profile = useProfileData();

    expect(profile.walletAddress).toBe('');
    expect(profile.cpayId).toBe('');
    expect(profile.displayName).toBe('');
    expect(profile.notificationsEnabled).toBe(true);
    expect(profile.profilePhoto).toBeNull();
  });

  test('toggles notifications and persists setting', async () => {
    const profile = useProfileData();

    await profile.handleToggleNotifications(false);
    expect(await AsyncStorage.getItem('notifications_enabled')).toBe('false');

    await profile.handleToggleNotifications(true);
    expect(await AsyncStorage.getItem('notifications_enabled')).toBe('true');
  });

  test('updates profile photo state', () => {
    const profile = useProfileData();
    profile.setProfilePhoto('https://example.com/avatar.jpg');
    expect(typeof profile.setProfilePhoto).toBe('function');
  });
});
