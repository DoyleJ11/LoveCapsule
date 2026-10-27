import { supabase } from '../../../lib/supabase';
import { loadEditableEntry } from '../api';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('../../../lib/storage', () => ({ uploadMedia: jest.fn(), deleteMedia: jest.fn() }));
it('refuses an edit when the entry cannot be loaded', async () => {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
  };
  (supabase.from as jest.Mock).mockReturnValue(query);
  await expect(loadEditableEntry('entry', 'user', 'couple')).rejects.toEqual({
    message: 'offline',
  });
  expect(query.eq.mock.calls).toEqual([
    ['id', 'entry'],
    ['author_id', 'user'],
    ['couple_id', 'couple'],
  ]);
});
it('refuses a partially loaded edit when media metadata fails', async () => {
  const entry = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { id: 'entry' }, error: null }),
  };
  const media = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: null, error: { message: 'media unavailable' } }),
  };
  (supabase.from as jest.Mock).mockReturnValueOnce(entry).mockReturnValueOnce(media);
  await expect(loadEditableEntry('entry', 'user', 'couple')).rejects.toEqual({
    message: 'media unavailable',
  });
});
