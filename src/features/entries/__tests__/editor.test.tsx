import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NewEntryScreen from '../../../../app/(tabs)/entries/new';
import { loadEditableEntry, saveEntry } from '../api';
import { draftKey } from '../drafts';

// Native modules on the local macOS dependency tree can load slowly on a cold run.
jest.setTimeout(60000);

const mockParams: { entryId?: string } = {};
const mockNavigation = {
  getState: () => ({ routes: [{}, {}] }),
  dispatch: jest.fn(),
  setOptions: jest.fn(),
};
const mockRouter = { dismiss: jest.fn(), navigate: jest.fn() };
const mockUser = { id: 'user-a' };
const mockCouple = { id: 'couple-a' };
let mockNextId = 0;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => `id-${++mockNextId}` } }));
jest.mock('../../../providers/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../../providers/CoupleProvider', () => ({
  useCouple: () => ({ couple: mockCouple }),
}));
jest.mock('../../../hooks/useVoiceMemo', () => ({
  useVoiceMemo: () => ({
    isRecording: false,
    isFinalizing: false,
    stopRecording: jest.fn(),
    stopPlayback: jest.fn(),
    resetRecording: jest.fn(),
  }),
}));
jest.mock('../../../lib/secure-storage', () => {
  const storage = require('@react-native-async-storage/async-storage');
  return { encryptedStorage: storage.default ?? storage };
});
jest.mock('../api', () => ({ loadEditableEntry: jest.fn(), saveEntry: jest.fn() }));
jest.mock('../files', () => ({ keepDraftFile: jest.fn(), removeDraftFiles: jest.fn() }));
jest.mock('../../../lib/storage', () => ({ getSignedUrl: jest.fn(), compressImage: jest.fn() }));
jest.mock('../../../lib/location-search', () => ({ searchLocations: jest.fn() }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@expo/vector-icons/FontAwesome', () => 'Icon');

beforeEach(async () => {
  jest.clearAllMocks();
  delete mockParams.entryId;
  await AsyncStorage.clear();
});
it('shows Retry after an edit load failure and never exposes a saveable blank form', async () => {
  mockParams.entryId = 'existing';
  (loadEditableEntry as jest.Mock).mockRejectedValue(new Error('offline'));
  const screen = render(<NewEntryScreen />);
  await screen.findByText('offline', {}, { timeout: 20000 });
  expect(screen.queryByPlaceholderText('Entry title...')).toBeNull();
  expect(screen.queryByText('Save Changes')).toBeNull();
  fireEvent.press(screen.getByText('Retry loading entry'));
  await waitFor(() => expect(loadEditableEntry).toHaveBeenCalledTimes(2));
  expect(saveEntry).not.toHaveBeenCalled();
});
it('finishes draft restoration before accepting new typing', async () => {
  let release!: (raw: string | null) => void;
  const original = AsyncStorage.getItem;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const screen = render(<NewEntryScreen />);
  expect(screen.queryByPlaceholderText('Entry title...')).toBeNull();
  await act(async () => {
    release(
      JSON.stringify({
        version: 1,
        userId: mockUser.id,
        coupleId: mockCouple.id,
        entryId: 'stable-entry',
        expectedUpdatedAt: null,
        fields: {
          title: 'Recovered',
          content_plain: 'Recovered words',
          mood: null,
          entry_date: '2026-10-26',
          location_name: null,
          location_lat: null,
          location_lng: null,
        },
        attachments: [],
        removeMediaIds: [],
        pendingSave: null,
      })
    );
  });
  expect(screen.getByDisplayValue('Recovered words')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('Write your thoughts...'), 'New words');
  await waitFor(async () => {
    const raw = await original(draftKey(mockUser.id, mockCouple.id));
    expect(JSON.parse(raw!).fields.content_plain).toBe('New words');
  });
});
it('guards same-render double taps and retains a failed save for retry after remount', async () => {
  let reject!: (error: Error) => void;
  (saveEntry as jest.Mock).mockImplementationOnce(async (plan, _user, persist) => {
    await persist(plan);
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const screen = render(<NewEntryScreen />);
  const title = await screen.findByPlaceholderText('Entry title...');
  fireEvent.changeText(title, 'Memory');
  const button = screen.getByText('Publish').parent!;
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(1));
  await act(async () => {
    reject(new Error('offline'));
  });
  const original = (saveEntry as jest.Mock).mock.calls[0][0];
  screen.unmount();
  (saveEntry as jest.Mock).mockImplementationOnce(async (plan, _user, persist) => {
    await persist(plan);
    return { entry: { id: plan.entryId } };
  });
  const restored = render(<NewEntryScreen />);
  fireEvent.press(await restored.findByText('Retry Save'));
  await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(2));
  expect((saveEntry as jest.Mock).mock.calls[1][0]).toEqual(original);
  await waitFor(() => expect(mockRouter.dismiss).toHaveBeenCalled());
});
