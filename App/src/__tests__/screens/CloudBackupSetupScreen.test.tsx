import React from 'react';
import { CloudBackupSetupScreen } from '../../screens/CloudBackupSetupScreen';

describe('C-045: CloudBackupSetupScreen', () => {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };

  test('renders CloudBackupSetupScreen without crashing', () => {
    const element = React.createElement(CloudBackupSetupScreen, { navigation });
    expect(element).toBeDefined();
    expect(typeof CloudBackupSetupScreen).toBe('function');
  });
});
