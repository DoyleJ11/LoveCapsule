import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../../../app/(tabs)/settings';
import { requestDeletion } from '../../account/deletion';
const mockCreate = jest.fn().mockResolvedValue(undefined);
const mockLoad = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => 'new-schedule' } }));
jest.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    profile: { display_name: 'Alex' },
    user: { id: 'me' },
    refreshProfile: jest.fn(),
  }),
}));
jest.mock('../../../providers/CoupleProvider', () => ({
  useCouple: () => ({
    couple: {
      id: 'couple',
      anniversary_date: '2020-06-01',
      reveal_time: '00:00',
      reveal_timezone: 'UTC',
      schedule_version: 1,
    },
    partner: { display_name: 'Sam' },
    refresh: mockRefresh,
  }),
}));
jest.mock('../../../lib/auth', () => ({ signOut: jest.fn() }));
jest.mock('../../../lib/notifications', () => ({
  registerForPushNotifications: jest.fn(),
  unregisterPushDevice: jest.fn(),
}));
jest.mock('../../../lib/storage', () => ({ compressImage: jest.fn(), uploadMedia: jest.fn() }));
jest.mock('../../../hooks/useCheckpoint', () => ({
  useCheckpoint: () => ({
    configs: [],
    loadConfigs: mockLoad,
    createConfig: mockCreate,
    loading: false,
  }),
}));
jest.mock('../time', () => ({
  ...jest.requireActual('../time'),
  deviceTimezone: () => 'America/Los_Angeles',
}));
jest.mock('../../account/deletion', () => ({ requestDeletion: jest.fn() }));
jest.mock('@expo/vector-icons/FontAwesome', () => 'Icon');
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
beforeEach(() => jest.clearAllMocks());

it('offers all 31 days, starts a new checkpoint in the device zone, and saves the selected day', async () => {
  const screen = render(<SettingsScreen />);
  fireEvent.press(screen.getByLabelText('Add reveal checkpoint'));
  expect(screen.getByLabelText('Reveal timezone').props.accessibilityValue.text).toBe(
    'America/Los_Angeles'
  );
  fireEvent.press(screen.getByLabelText('Day 31'));
  expect(screen.getByText('Shorter months use their last day.')).toBeTruthy();
  fireEvent.press(screen.getByText('Save'));
  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        day_of_month: 31,
        timezone: 'America/Los_Angeles',
        frequency: 'monthly',
      })
    )
  );
});
it('cancels a new checkpoint without saving', () => {
  const screen = render(<SettingsScreen />);
  fireEvent.press(screen.getByLabelText('Add reveal checkpoint'));
  fireEvent.press(screen.getByLabelText('Day 30'));
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockCreate).not.toHaveBeenCalled();
});
it('requires destructive confirmation and keeps notification controls separate from account deletion', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<SettingsScreen />);
  expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
  expect(screen.queryByText('Privacy on this phone')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Delete my account and diary' }));
  expect(alert).toHaveBeenCalledWith('Delete account?', expect.any(String), expect.any(Array));
  expect(requestDeletion).not.toHaveBeenCalled();
  const actions = alert.mock.calls.at(-1)![2]!;
  expect(actions.find((action) => action.text === 'Cancel')?.style).toBe('cancel');
  await act(async () => {
    await actions.find((action) => action.text === 'Delete account')?.onPress?.();
  });
  expect(requestDeletion).toHaveBeenCalledWith('account', 'me');
  alert.mockRestore();
});
