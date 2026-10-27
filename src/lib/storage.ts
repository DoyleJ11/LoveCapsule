import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';

const BUCKET = 'entry-media';
const MAX_IMAGE_WIDTH = 1200;
const JPEG_QUALITY = 0.8;

export async function compressImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_IMAGE_WIDTH } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
}

export async function uploadMedia(
  localUri: string,
  userId: string,
  entryId: string,
  fileName: string,
  mimeType: string,
  retrySafe = false
): Promise<string> {
  const storagePath = `${userId}/${entryId}/${fileName}`;

  const file = new File(localUri);
  if (!file.exists) throw new Error('File does not exist');

  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an attachment smaller than 25 MiB.');
  const bytes = await file.bytes();

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: !retrySafe,
  });

  // A retry uses the same UUID path and immutable local file. An upload may
  // have succeeded even when its response was lost. It never overwrites a blob.
  const duplicate =
    error &&
    (['ResourceAlreadyExists', 'KeyAlreadyExists', 'Duplicate', 'already_exists'].includes(
      (error as { code?: string; error?: string }).code ?? (error as { error?: string }).error ?? ''
    ) ||
      (['400', '409'].includes(String(error.statusCode)) &&
        ['The resource already exists', 'Asset already exists'].includes(error.message)));
  if (error && !(retrySafe && duplicate)) throw error;

  return storagePath;
}

export function getMediaUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

export async function deleteMedia(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}
