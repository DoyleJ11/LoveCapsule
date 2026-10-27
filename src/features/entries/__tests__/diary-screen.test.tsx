import { FlatList } from 'react-native';
import { act, render } from '@testing-library/react-native';
import EntriesListScreen from '../../../../app/(tabs)/entries';
const mockRefresh = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../providers/CoupleProvider', () => ({
  useCouple: () => ({ couple: { id: 'couple' }, loading: false }),
}));
jest.mock('../../../hooks/useEntries', () => ({
  useEntries: () => ({
    entries: [],
    loading: true,
    error: null,
    hasMore: false,
    refresh: mockRefresh,
  }),
}));
it('keeps the pull-to-refresh inset closed during initial loading and opens it only for a user refresh', async () => {
  let finish!: () => void;
  mockRefresh.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const screen = render(<EntriesListScreen />);
  expect(screen.UNSAFE_getByType(FlatList).props.refreshing).toBe(false);
  act(() => {
    screen.UNSAFE_getByType(FlatList).props.onRefresh();
  });
  expect(screen.UNSAFE_getByType(FlatList).props.refreshing).toBe(true);
  await act(async () => {
    finish();
  });
  expect(screen.UNSAFE_getByType(FlatList).props.refreshing).toBe(false);
});
