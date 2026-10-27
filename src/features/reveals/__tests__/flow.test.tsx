import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RevealExperience } from '../../../../app/(tabs)/reveal';
import { supabase } from '../../../lib/supabase';
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockOverview = {
  annual: { year: 2027, ready_at: '2027-06-01T00:00:00Z', timezone: 'UTC', is_ready: false },
  annual_history: [
    { id: 'annual', year: 2026, opened_at: '2026-06-01T00:00:00Z', timezone: 'UTC' },
  ],
  checkpoints: [],
  checkpoint_history: [
    {
      id: 'past',
      occurrence_id: 'occ',
      label: 'Birthday',
      entry_id: 'photo-note',
      opened_at: '2026-04-01T00:00:00Z',
      timezone: 'UTC',
    },
  ],
};
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../../providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../../providers/CoupleProvider', () => ({
  useCouple: () => ({
    overview: mockOverview,
    partner: { display_name: 'Love' },
    refresh: mockRefresh,
    serverNow: Date.now,
  }),
}));
jest.mock('../AnnualRecap', () => {
  const { Button } = require('react-native');
  return {
    AnnualRecap: ({ onRead }: { onRead: () => void }) => (
      <Button title="Read Their Entries" onPress={onRead} />
    ),
  };
});
jest.mock('../EntryReader', () => {
  const { Text } = require('react-native');
  return { EntryReader: ({ entry }: { entry: { title: string } }) => <Text>{entry.title}</Text> };
});
beforeEach(() => jest.clearAllMocks());
it('opens annual history while the current year is locked, reads the cycle tail, and exits/replays', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: {
      id: 'annual',
      reveal_year: 2026,
      stats_snapshot: {},
      entries: [
        {
          id: 'december',
          author_id: 'partner',
          entry_date: '2025-12-20',
          title: 'December memory',
        },
        { id: 'own', author_id: 'me', entry_date: '2026-01-01', title: 'My note' },
      ],
    },
    error: null,
  });
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest
      .fn()
      .mockResolvedValue({ data: { id: 'december', title: 'December memory' }, error: null }),
  });
  const screen = render(<RevealExperience coupleId="couple" />);
  fireEvent.press(screen.getByText('Revisit 2026 anniversary'));
  fireEvent.press(await screen.findByText('Read Their Entries'));
  expect(screen.queryByText('My note · 2026-01-01')).toBeNull();
  fireEvent.press(screen.getByText('December memory · 2025-12-20'));
  expect(await screen.findByText('December memory')).toBeTruthy();
  fireEvent.press(screen.getByText('Back'));
  fireEvent.press(screen.getByText('Replay recap'));
  await screen.findByText('Read Their Entries');
  fireEvent.press(screen.getByText('Close capsule'));
  expect(screen.getByText('Your reveal history')).toBeTruthy();
  expect(supabase.rpc).toHaveBeenCalledTimes(1); // replay is read-only
});
it('opens checkpoint history on an ordinary day and leaves errors in a retryable home view', async () => {
  (supabase.rpc as jest.Mock)
    .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    .mockResolvedValueOnce({
      data: { occurrence_id: 'occ', entry: { id: 'photo-note', title: 'A birthday note' } },
      error: null,
    });
  const screen = render(<RevealExperience coupleId="couple" />);
  fireEvent.press(screen.getByText('Birthday'));
  expect(await screen.findByText('offline')).toBeTruthy();
  expect(screen.getByText('Your reveal history')).toBeTruthy();
  fireEvent.press(screen.getByText('Birthday'));
  await screen.findByText('A birthday note');
  fireEvent.press(screen.getByText('Close capsule'));
  await waitFor(() => expect(screen.getByText('Birthday')).toBeTruthy());
});
