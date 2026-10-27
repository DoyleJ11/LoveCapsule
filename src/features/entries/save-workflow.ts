import type { Entry } from '../../types/database';
import type { CreateEntryInput } from '../../hooks/useEntries';

export interface PendingAttachment {
  id: string;
  uri: string;
  media_type: 'image' | 'audio';
  mime_type: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}
export interface SavePlan {
  operationId: string;
  entryId: string;
  expectedUpdatedAt: string | null;
  fields: CreateEntryInput;
  attachments: PendingAttachment[];
  removeMediaIds: string[];
}
export interface SaveReceipt {
  entry: Pick<Entry, 'id'> & Partial<Entry> & { deleted?: boolean };
  removed_paths: string[];
}
export interface SaveDependencies {
  recover: (plan: SavePlan) => Promise<SaveReceipt | null>;
  persistPlan: (plan: SavePlan) => Promise<void>;
  upload: (attachment: PendingAttachment, entryId: string) => Promise<Record<string, unknown>>;
  commit: (plan: SavePlan, media: Record<string, unknown>[]) => Promise<SaveReceipt>;
  remove: (path: string) => Promise<void>;
}

/** Retain the plan on ANY failure, including a response lost after commit. */
export async function saveWithAttachments(plan: SavePlan, deps: SaveDependencies) {
  await deps.persistPlan(plan);
  let receipt = await deps.recover(plan);
  if (!receipt) {
    const media = [];
    for (const attachment of plan.attachments) {
      media.push(await deps.upload(attachment, plan.entryId));
    }
    receipt = await deps.commit(plan, media);
  }
  for (const path of receipt.removed_paths) await deps.remove(path);
  return receipt;
}
