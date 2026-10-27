import type { CreateEntryInput } from '../../hooks/useEntries';
import type { PendingAttachment, SavePlan } from './save-workflow';

export interface EntryDraft {
  version: 1;
  userId: string;
  coupleId: string;
  entryId: string;
  expectedUpdatedAt: string | null;
  fields: CreateEntryInput;
  attachments: PendingAttachment[];
  removeMediaIds: string[];
  pendingSave: SavePlan | null;
}
interface Storage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}
export function draftKey(userId: string, coupleId: string, entryId?: string) {
  return `entry_draft:v1:${userId}:${coupleId}:${entryId ?? 'new'}`;
}

/** A clear must run AFTER older queued writes, never resurrecting a saved draft. */
export function createDraftStore(storage: Storage, key: string) {
  let queue = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const result = queue.catch(() => {}).then(operation);
    queue = result;
    return result;
  };
  return {
    async load(userId: string, coupleId: string): Promise<EntryDraft | null> {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      const draft = JSON.parse(raw) as EntryDraft;
      if (draft.version !== 1 || draft.userId !== userId || draft.coupleId !== coupleId) {
        throw new Error('This draft cannot be restored for this account.');
      }
      return draft;
    },
    save: (draft: EntryDraft) => {
      const serialized = JSON.stringify(draft);
      return enqueue(() => storage.setItem(key, serialized));
    },
    clear: () => enqueue(() => storage.removeItem(key)),
  };
}
