import { requestDeletion } from '../deletion';
import { supabase } from '../../../lib/supabase';
import { encryptedStorage } from '../../../lib/secure-storage';
let mockId = 0;
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => `operation-${++mockId}` } }));
jest.mock('../../../lib/secure-storage', () => ({
  encryptedStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), Paths: { document: 'document/' } }));
beforeEach(() => {
  jest.clearAllMocks();
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { user: { id: 'user' } } },
    error: null,
  });
});
it('persists the operation before deleting and shares concurrent requests', async () => {
  let finish!: (v: unknown) => void;
  (supabase.rpc as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const first = requestDeletion('entry', 'one');
  const second = requestDeletion('entry', 'one');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(encryptedStorage.setItem).toHaveBeenCalled();
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  finish({ data: { records_deleted: true }, error: null });
  await Promise.all([first, second]);
});
it('retries an unknown response using the same durable operation id', async () => {
  (supabase.rpc as jest.Mock)
    .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
    .mockResolvedValue({ data: { records_deleted: true }, error: null });
  await expect(requestDeletion('entry', 'two')).rejects.toEqual({ message: 'response lost' });
  await requestDeletion('entry', 'two');
  const calls = (supabase.rpc as jest.Mock).mock.calls;
  expect(calls[0][1].p_id).toBe(calls[1][1].p_id);
});
