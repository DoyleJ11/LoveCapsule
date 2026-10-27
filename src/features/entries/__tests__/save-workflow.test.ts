import { saveWithAttachments, type SavePlan } from '../save-workflow';
import type { Entry } from '../../../types/database';

const plan: SavePlan = {
  operationId: 'operation',
  entryId: 'entry',
  expectedUpdatedAt: null,
  fields: {
    couple_id: 'couple',
    title: 'Memory',
    content_html: '',
    content_plain: 'Keep me',
    word_count: 2,
    is_draft: false,
    mood: null,
    entry_date: '2026-10-26',
    location_name: null,
    location_lat: null,
    location_lng: null,
  },
  attachments: [
    { id: 'photo', uri: 'document/photo', media_type: 'image', mime_type: 'image/jpeg' },
    { id: 'audio', uri: 'document/audio', media_type: 'audio', mime_type: 'audio/mp4' },
  ],
  removeMediaIds: ['removed'],
};
const receipt = { entry: { id: 'entry' } as Entry, removed_paths: ['old-photo'] };
function dependencies() {
  return {
    recover: jest.fn(async (): Promise<typeof receipt | null> => null),
    persistPlan: jest.fn(async (_plan: SavePlan) => {}),
    upload: jest.fn(async (attachment: { id: string }) => ({ id: attachment.id })),
    commit: jest.fn(async () => receipt),
    remove: jest.fn(async (_path: string) => {}),
  };
}
describe('durable atomic entry save', () => {
  it('persists recovery before upload and publishes only after every attachment', async () => {
    const deps = dependencies();
    await saveWithAttachments(plan, deps);
    expect(deps.persistPlan.mock.invocationCallOrder[0]).toBeLessThan(
      deps.upload.mock.invocationCallOrder[0]
    );
    expect(deps.commit.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.upload.mock.invocationCallOrder[1]
    );
    expect(deps.remove).toHaveBeenCalledWith('old-photo');
  });
  it('does not upload or publish if durable recovery cannot be written', async () => {
    const deps = dependencies();
    deps.persistPlan.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveWithAttachments(plan, deps)).rejects.toThrow('disk full');
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it('keeps the same entry, operation and attachment identities after a partial upload', async () => {
    const deps = dependencies();
    deps.upload.mockRejectedValueOnce(new Error('offline'));
    await expect(saveWithAttachments(plan, deps)).rejects.toThrow('offline');
    expect(deps.commit).not.toHaveBeenCalled();
    await saveWithAttachments(plan, deps);
    expect(deps.commit).toHaveBeenCalledWith(plan, [{ id: 'photo' }, { id: 'audio' }]);
    expect(deps.persistPlan).toHaveBeenNthCalledWith(2, plan);
  });
  it('retries a lost commit response with the original operation', async () => {
    const deps = dependencies();
    deps.commit.mockRejectedValueOnce(new Error('response lost'));
    await expect(saveWithAttachments(plan, deps)).rejects.toThrow('response lost');
    expect(deps.remove).not.toHaveBeenCalled();
    await expect(saveWithAttachments(plan, deps)).resolves.toEqual(receipt);
    expect(deps.commit.mock.calls[0]).toEqual(deps.commit.mock.calls[1]);
  });
  it('surfaces failed attachment deletion and retries it after the idempotent commit', async () => {
    const deps = dependencies();
    deps.remove.mockRejectedValueOnce(new Error('delete failed'));
    await expect(saveWithAttachments(plan, deps)).rejects.toThrow('delete failed');
    await saveWithAttachments(plan, deps);
    expect(deps.remove).toHaveBeenCalledTimes(2);
  });
  it('recovers a committed save before touching local files again', async () => {
    const deps = dependencies();
    deps.recover.mockResolvedValueOnce(receipt);
    await expect(saveWithAttachments(plan, deps)).resolves.toEqual(receipt);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.remove).toHaveBeenCalledWith('old-photo');
  });
});
