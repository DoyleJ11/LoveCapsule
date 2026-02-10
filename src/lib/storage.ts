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
  mimeType: string
): Promise<string> {
  const storagePath = `${userId}/${entryId}/${fileName}`;

  const file = new File(localUri);
  if (!file.exists) throw new Error('File does not exist');

  const bytes = await file.bytes();

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: true,
  });

  if (error) throw error;

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
