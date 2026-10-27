import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { uploadMedia, deleteMedia } from '../../lib/storage';
import { saveWithAttachments, type SavePlan, type SaveReceipt } from './save-workflow';
import type { Entry } from '../../types/database';

export async function loadEditableEntry(id: string, userId: string, coupleId: string) {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .eq('author_id', userId)
    .eq('couple_id', coupleId)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Entry could not be loaded. Retry before editing.');
  const { data: media, error: mediaError } = await supabase
    .from('media')
    .select('*')
    .eq('entry_id', id)
    .order('created_at', { ascending: true });
  if (mediaError) throw mediaError;
  return { entry: data as Entry, media: media ?? [] };
}

export async function saveEntry(
  plan: SavePlan,
  userId: string,
  persistPlan: (plan: SavePlan) => Promise<void>
) {
  return saveWithAttachments(plan, {
    persistPlan,
    recover: async (request) => {
      const { data, error } = await supabase
        .from('entry_save_operations')
        .select('result')
        .eq('operation_id', request.operationId)
        .eq('entry_id', request.entryId)
        .maybeSingle();
      if (error) throw error;
      return (data?.result as SaveReceipt) ?? null;
    },
    upload: async (attachment, entryId) => {
      const suffix = attachment.media_type === 'image' ? 'jpg' : 'm4a';
      const storage_path = await uploadMedia(
        attachment.uri,
        userId,
        entryId,
        `${attachment.id}.${suffix}`,
        attachment.mime_type,
        true
      );
      return {
        id: attachment.id,
        storage_path,
        media_type: attachment.media_type,
        mime_type: attachment.mime_type,
        width: attachment.width,
        height: attachment.height,
        duration_ms: attachment.duration_ms,
        file_size_bytes: new File(attachment.uri).size,
      };
    },
    commit: async (request, media) => {
      const { data, error } = await supabase.rpc('save_entry', {
        p_operation_id: request.operationId,
        p_entry_id: request.entryId,
        p_expected_updated_at: request.expectedUpdatedAt,
        p_entry: request.fields,
        p_media: media,
        p_remove_media: request.removeMediaIds,
      });
      if (error) throw error;
      if (!data?.entry) throw new Error('Save confirmation was not received. Retry this save.');
      return data as SaveReceipt;
    },
    remove: deleteMedia,
  });
}
