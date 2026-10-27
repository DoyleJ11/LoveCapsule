import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { uuid } from 'expo-modules-core';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
const OPT_IN_KEY = 'lc.push.opted-in-user';
export async function pushOptedIn(userId: string) {
  return (await SecureStore.getItemAsync(OPT_IN_KEY)) === userId;
}
let mutation = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutation.catch(() => {}).then(operation);
  mutation = result.then(
    () => {},
    () => {}
  );
  return result;
}
const DEVICE_KEY = 'lc.push.installation';
export async function installationId() {
  let id = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!id) {
    id = uuid.v4();
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  }
  return id;
}
async function register(userId: string, prompt = false): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (!prompt && !(await pushOptedIn(userId))) return null;
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('default', {
      name: 'LoveCapsule',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && prompt) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') {
    await unregister();
    return null;
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Notifications need an EAS project ID in this build.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  // Check identity after permission/token awaits; another account may now own the app.
  const session = await supabase.auth.getSession();
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== userId) return null;
  const { error } = await supabase.rpc('register_push_device', {
    p_id: await installationId(),
    p_token: token,
    p_enabled: true,
    p_expected_user: userId,
  });
  if (error) throw error;
  if (prompt) await SecureStore.setItemAsync(OPT_IN_KEY, userId);
  return token;
}
async function unregister() {
  // Clear intent before the network call: a failed disable must not re-enable on foreground.
  await SecureStore.deleteItemAsync(OPT_IN_KEY);
  const id = await SecureStore.getItemAsync(DEVICE_KEY);
  if (id) {
    const { error } = await supabase.rpc('unregister_push_device', { p_id: id });
    if (error) throw error;
  }
}
export function registerForPushNotifications(userId: string, prompt = false) {
  return serialize(() => register(userId, prompt));
}
export function unregisterPushDevice() {
  return serialize(unregister);
}
export function notificationDestination(
  data: Record<string, unknown>,
  coupleId: string | null
): '/(tabs)/entries' | '/(tabs)/reveal' | null {
  if (!coupleId || data.couple_id !== coupleId) return null;
  return data.type === 'new_entry'
    ? '/(tabs)/entries'
    : data.type === 'reveal_ready'
      ? '/(tabs)/reveal'
      : null;
}
export { Notifications };
