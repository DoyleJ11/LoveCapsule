import { createDraftStore, clearLocalDrafts, draftKey, type EntryDraft } from '../drafts';
const draft = {
  version: 1,
  userId: 'a',
  coupleId: 'couple',
  entryId: 'entry',
  fields: { content_plain: 'Keep me' },
  attachments: [{ id: 'photo', uri: 'document/photo' }],
  pendingSave: { operationId: 'retry-me' },
} as EntryDraft;
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}
it('isolates account, couple and edit drafts', () => {
  expect(
    new Set([
      draftKey('a', 'x'),
      draftKey('b', 'x'),
      draftKey('a', 'y'),
      draftKey('a', 'x', 'entry'),
    ]).size
  ).toBe(4);
});
it('restores attachment paths and an interrupted operation after remount', async () => {
  const disk = storage();
  const key = draftKey('a', 'couple');
  await createDraftStore(disk, key).save(draft);
  expect(await createDraftStore(disk, key).load('a', 'couple')).toEqual(draft);
  await expect(createDraftStore(disk, key).load('b', 'couple')).rejects.toThrow('account');
});
it('cannot resurrect a draft when clear races older autosaves', async () => {
  const disk = storage();
  const store = createDraftStore(disk, 'key');
  const old = store.save(draft);
  const newer = store.save({ ...draft, pendingSave: null });
  const clear = store.clear();
  await Promise.all([old, newer, clear]);
  expect(await store.load('a', 'couple')).toBeNull();
});
it('surfaces persistence errors and permits a later retry', async () => {
  const disk = storage();
  disk.setItem.mockRejectedValueOnce(new Error('full'));
  const store = createDraftStore(disk, 'key');
  await expect(store.save(draft)).rejects.toThrow('full');
  await store.save(draft);
  expect(await store.load('a', 'couple')).toEqual(draft);
});

it('removes the deleted couple drafts, preserves another couple, and rejects late autosaves', async () => {
  const disk = storage();
  const own = { ...draft, userId: 'delete-user', coupleId: 'deleted' };
  const other = { ...own, coupleId: 'kept' };
  const store = createDraftStore(disk, draftKey(own.userId, own.coupleId));
  const keep = createDraftStore(disk, draftKey(other.userId, other.coupleId));
  await store.save(own);
  await keep.save(other);
  await clearLocalDrafts(disk, own.userId, own.coupleId);
  expect(await store.load(own.userId, own.coupleId)).toBeNull();
  expect(await keep.load(other.userId, other.coupleId)).toEqual(other);
  await expect(store.save(own)).rejects.toThrow('deleted');
});
