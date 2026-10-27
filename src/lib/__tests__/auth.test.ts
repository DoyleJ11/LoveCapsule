import { signOut } from '../auth';
import { supabase } from '../supabase';
import { encryptedStorage } from '../secure-storage';
import { unregisterPushDevice } from '../notifications';
jest.mock('../secure-storage', () => ({
  encryptedStorage: { removeItem: jest.fn(async () => {}) },
}));
jest.mock('../notifications', () => ({ unregisterPushDevice: jest.fn(async () => {}) }));
it('removes local credentials and emits SDK sign-out even when the server is offline', async () => {
  (unregisterPushDevice as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  (supabase.auth.signOut as jest.Mock)
    .mockResolvedValueOnce({ error: { message: 'offline' } })
    .mockResolvedValue({ error: null });
  await signOut();
  expect(encryptedStorage.removeItem).toHaveBeenCalled();
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(2);
  expect(supabase.auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
});
