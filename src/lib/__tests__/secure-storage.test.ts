import { encryptedStorage, splitSecureValue } from '../secure-storage';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
let mockCounter = 0;
jest.mock('expo-modules-core', () => ({ uuid: { v4: () => `part-${++mockCounter}` } }));
let values: Map<string, string>;
beforeEach(async () => {
  values = new Map();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(
    async (key) => values.get(key) ?? null
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key) => {
    values.delete(key);
  });
});
it('splits by UTF8 bytes and round-trips long Unicode without plaintext fallback', async () => {
  const text = '💖éA'.repeat(2000);
  expect(splitSecureValue(text).every((c) => Buffer.byteLength(c, 'utf8') <= 1800)).toBe(true);
  await encryptedStorage.setItem('session', text);
  expect(await encryptedStorage.getItem('session')).toBe(text);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('migrates old plaintext only after a durable encrypted commit', async () => {
  await AsyncStorage.setItem('old', 'private diary');
  await expect(encryptedStorage.getItem('old')).resolves.toBe('private diary');
  expect(await AsyncStorage.getItem('old')).toBeNull();
});
it('preserves the previous value if chunk publication fails', async () => {
  await encryptedStorage.setItem('key', 'old');
  (SecureStore.setItemAsync as jest.Mock)
    .mockImplementationOnce(async (k, v) => {
      values.set(k, v);
    })
    .mockRejectedValueOnce(new Error('disk full'));
  await expect(encryptedStorage.setItem('key', 'new'.repeat(2000))).rejects.toThrow();
  expect(await encryptedStorage.getItem('key')).toBe('old');
});
it('serializes save/remove so old writes cannot resurrect deleted data', async () => {
  await Promise.all([
    encryptedStorage.setItem('draft', 'one'),
    encryptedStorage.setItem('draft', 'two'),
    encryptedStorage.removeItem('draft'),
  ]);
  expect(await encryptedStorage.getItem('draft')).toBeNull();
});
it('never treats missing encrypted chunks as an empty diary', async () => {
  await encryptedStorage.setItem('draft', 'private');
  const chunk = [...values.keys()].find((k) => k.includes('part-'))!;
  values.delete(chunk);
  await expect(encryptedStorage.getItem('draft')).rejects.toThrow('incomplete');
});
