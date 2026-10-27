import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { EntryReader } from '../EntryReader';
import { supabase } from '../../../lib/supabase';
import { getSignedUrl } from '../../../lib/storage';
import type { Entry } from '../../../types/database';
const mockPlay = jest.fn(),
  mockPause = jest.fn();
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: mockPlay, pause: mockPause, seekTo: jest.fn() }),
  useAudioPlayerStatus: () => ({ isLoaded: true, playing: false, currentTime: 0, duration: 12 }),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../lib/storage', () => ({ getSignedUrl: jest.fn() }));
const entry = {
  id: 'note',
  title: 'For you',
  content_plain: 'A quiet moment.',
  entry_date: '2026-01-01',
} as Entry;
const photo = {
  id: 'photo',
  entry_id: 'note',
  media_type: 'image',
  storage_path: 'author/note/photo.jpg',
};
const audio = {
  id: 'audio',
  entry_id: 'note',
  media_type: 'audio',
  storage_path: 'author/note/audio.m4a',
};
const metadata = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: metadata,
  });
  (getSignedUrl as jest.Mock).mockImplementation((path) =>
    Promise.resolve(`https://media.test/${path}`)
  );
});
it('renders recipient photos and playable audio alongside the note', async () => {
  metadata.mockResolvedValue({ data: [photo, audio], error: null });
  const screen = render(<EntryReader entry={entry} />);
  await screen.findByLabelText('Attached photo');
  fireEvent.press(await screen.findByText('Play voice memo'));
  await waitFor(() => expect(mockPlay).toHaveBeenCalled());
  expect(getSignedUrl).toHaveBeenCalledWith(photo.storage_path);
  expect(getSignedUrl).toHaveBeenCalledWith(audio.storage_path);
  expect(screen.getByText('A quiet moment.')).toBeTruthy();
});
it('shows failed metadata as an error with retry, not an empty attachment list', async () => {
  metadata
    .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    .mockResolvedValueOnce({ data: [photo], error: null });
  const screen = render(<EntryReader entry={entry} />);
  fireEvent.press(await screen.findByText('Retry attachments'));
  expect(await screen.findByLabelText('Attached photo')).toBeTruthy();
});
it('renews an expired photo link explicitly and ignores old responses after reader changes', async () => {
  metadata.mockResolvedValue({ data: [photo], error: null });
  const screen = render(<EntryReader entry={entry} />);
  const image = await screen.findByLabelText('Attached photo');
  fireEvent(image, 'error');
  fireEvent.press(await screen.findByText('Retry attachment'));
  await waitFor(() => expect(getSignedUrl).toHaveBeenCalledTimes(2));
  let resolve!: (value: unknown) => void;
  metadata.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  screen.rerender(
    <EntryReader key="other" entry={{ ...entry, id: 'other', title: 'Other note' }} />
  );
  screen.unmount();
  await act(async () => {
    resolve({ data: [photo], error: null });
  });
});
