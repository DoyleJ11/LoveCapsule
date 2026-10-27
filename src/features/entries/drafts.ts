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

const scopeQueues = new Map<string, Promise<unknown>>();
const revoked = new Set<string>();
const indexKey = (user: string) => `draft_index:v1:${user}`;
function scoped<T>(user: string, operation: () => Promise<T>): Promise<T> {
  const next = (scopeQueues.get(user) ?? Promise.resolve()).catch(() => {}).then(operation);
  scopeQueues.set(user, next);
  return next;
}
async function remember(storage: Storage, user: string, key: string) {
  return scoped(user, async () => {
    const keys: string[] = JSON.parse((await storage.getItem(indexKey(user))) ?? '[]');
    if (!keys.includes(key)) await storage.setItem(indexKey(user), JSON.stringify([...keys, key]));
  });
}
/** Explicit deletion removes indexed text and prevents late autosaves restoring it. */
export async function clearLocalDrafts(storage: Storage, user: string, couple?: string) {
  if (couple) revoked.add(`${user}:${couple}`);
  else revoked.add(user);
  await scoped(user, async () => {
    const keys: string[] = JSON.parse((await storage.getItem(indexKey(user))) ?? '[]');
    const keep: string[] = [];
    for (const key of keys) {
      if (!couple || key.startsWith(`entry_draft:v1:${user}:${couple}:`))
        await storage.removeItem(key);
      else keep.push(key);
    }
    await storage.setItem(indexKey(user), JSON.stringify(keep));
  });
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
      await remember(storage, userId, key);
      return draft;
    },
    save: (draft: EntryDraft) => {
      const serialized = JSON.stringify(draft);
      return enqueue(async () => {
        await remember(storage, draft.userId, key);
        if (revoked.has(draft.userId) || revoked.has(`${draft.userId}:${draft.coupleId}`))
          throw new Error('This diary has been deleted.');
        await storage.setItem(key, serialized);
      });
    },
    clear: () => enqueue(() => storage.removeItem(key)),
  };
}
