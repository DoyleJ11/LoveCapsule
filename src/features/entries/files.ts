import { Directory, File, Paths } from 'expo-file-system';
import type { EntryDraft } from './drafts';

export function keepDraftFile(
  uri: string,
  userId: string,
  coupleId: string,
  entryId: string,
  name: string
) {
  const directory = new Directory(Paths.document, 'entry-drafts', userId, coupleId, entryId);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, name);
  if (uri !== destination.uri && !destination.exists) new File(uri).copy(destination);
  if (!destination.exists)
    throw new Error('Could not keep the attachment on this device. Try again.');
  return destination.uri;
}

export function removeDraftFiles(draft: EntryDraft) {
  const directory = new Directory(
    Paths.document,
    'entry-drafts',
    draft.userId,
    draft.coupleId,
    draft.entryId
  );
  // Only remove files listed by this draft, never another in-progress edit's
  // staged attachments that happen to share the entry directory.
  for (const attachment of draft.attachments) {
    if (!attachment.uri.startsWith(directory.uri.replace(/\/+$/, '') + '/')) continue;
    const file = new File(attachment.uri);
    if (file.exists) file.delete();
  }
}
