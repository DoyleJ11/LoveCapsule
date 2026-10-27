import { act, renderHook } from '@testing-library/react-native';
import { useLocationSearch } from '../useLocationSearch';
import { searchLocations, resolveLocation } from '../../lib/location-search';
jest.mock('../../lib/location-search', () => ({
  searchLocations: jest.fn(),
  resolveLocation: jest.fn(),
}));
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => 'session' } }));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
it('ignores obsolete search results and only resolves the selected place', async () => {
  let finish!: (v: unknown) => void;
  (searchLocations as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        })
    )
    .mockResolvedValue([{ id: 'new', name: 'New' }]);
  const hook = renderHook(() => useLocationSearch(true));
  await act(async () => {
    hook.result.current.setQuery('old');
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
    await flush();
  });
  await act(async () => {
    hook.result.current.setQuery('new');
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
    await flush();
    finish([{ id: 'old' }]);
    await flush();
  });
  expect(hook.result.current.results).toEqual([{ id: 'new', name: 'New' }]);
  expect(resolveLocation).not.toHaveBeenCalled();
  (resolveLocation as jest.Mock).mockResolvedValue({ id: 'new', latitude: 1, longitude: 2 });
  await act(() => hook.result.current.select(hook.result.current.results[0]));
  expect(resolveLocation).toHaveBeenCalledTimes(1);
});
it('distinguishes failures from empty results and stops loading when cleared', async () => {
  (searchLocations as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
  const hook = renderHook(() => useLocationSearch(true));
  await act(async () => {
    hook.result.current.setQuery('place');
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
    await flush();
  });
  expect(hook.result.current.error).toBe('Network unavailable');
  await act(async () => {
    hook.result.current.setQuery('');
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
    await flush();
  });
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.loading).toBe(false);
});
