import * as SecureStore from 'expo-secure-store';
import { supabase } from '../supabase';
import {
  Notifications,
  registerForPushNotifications,
  unregisterPushDevice,
  notificationDestination,
} from '../notifications';
let mockId = 0;
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => `device-${++mockId}` } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'project' } } } }));
let values: Map<string, string>;
beforeEach(() => {
  jest.clearAllMocks();
  values = new Map();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k) => values.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k, v) => {
    values.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k) => {
    values.delete(k);
  });
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { user: { id: 'a' } } },
    error: null,
  });
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
    data: 'ExpoPushToken[test]',
  });
});
it('does not register or request permissions without explicit device opt-in', async () => {
  expect(await registerForPushNotifications('a')).toBeNull();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('disabling survives foreground refresh and cannot re-enable itself', async () => {
  await registerForPushNotifications('a', true);
  await unregisterPushDevice();
  (supabase.rpc as jest.Mock).mockClear();
  await registerForPushNotifications('a');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('late registration cannot undo a concurrent disable', async () => {
  let done!: (v: unknown) => void;
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  const enable = registerForPushNotifications('a', true);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const disable = unregisterPushDevice();
  done({ data: 'ExpoPushToken[test]' });
  await Promise.all([enable, disable]);
  expect((supabase.rpc as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
    'register_push_device',
    'unregister_push_device',
  ]);
  await registerForPushNotifications('a');
  expect((supabase.rpc as jest.Mock).mock.calls.length).toBe(2);
});
it('refuses an obsolete account after token acquisition and validates destinations', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { user: { id: 'b' } } },
    error: null,
  });
  expect(await registerForPushNotifications('a', true)).toBeNull();
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(notificationDestination({ couple_id: 'old', type: 'reveal_ready' }, 'new')).toBeNull();
  expect(
    notificationDestination({ couple_id: 'new', type: 'reveal_ready', route: '/auth' }, 'new')
  ).toBe('/(tabs)/reveal');
});
