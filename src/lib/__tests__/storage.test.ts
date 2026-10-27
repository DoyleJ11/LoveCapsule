import { uploadMedia } from '../storage';
import { File } from 'expo-file-system';
import { supabase } from '../supabase';
jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({ exists: true, bytes: async () => new Uint8Array([1]) })),
}));
jest.mock('expo-image-manipulator', () => ({}));
it.each([
  { statusCode: '400', message: 'Asset already exists' },
  { statusCode: '409', message: 'The resource already exists' },
  { statusCode: '409', code: 'ResourceAlreadyExists', message: 'duplicate' },
])('accepts only an immutable-path duplicate during a retry: %j', async (error) => {
  const upload = jest.fn(async () => ({ error }));
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
  await expect(
    uploadMedia('local', 'user', 'entry', 'stable.jpg', 'image/jpeg', true)
  ).resolves.toBe('user/entry/stable.jpg');
  expect(upload).toHaveBeenCalledWith('user/entry/stable.jpg', expect.any(Uint8Array), {
    contentType: 'image/jpeg',
    upsert: false,
  });
});
it.each([
  { statusCode: '403', message: 'Denied' },
  { statusCode: '409', message: 'Another conflict' },
])('surfaces real storage failures: %j', async (error) => {
  (supabase.storage.from as jest.Mock).mockReturnValue({
    upload: jest.fn(async () => ({ error })),
  });
  await expect(
    uploadMedia('local', 'user', 'entry', 'stable.jpg', 'image/jpeg', true)
  ).rejects.toEqual(error);
});

it('rejects oversized files before reading bytes or uploading', async () => {
  const bytes = jest.fn();
  (File as unknown as jest.Mock).mockImplementationOnce(() => ({
    exists: true,
    size: 25 * 1024 * 1024 + 1,
    bytes,
  }));
  await expect(uploadMedia('large', 'user', 'entry', 'large.m4a', 'audio/m4a')).rejects.toThrow(
    '25 MiB'
  );
  expect(bytes).not.toHaveBeenCalled();
});
