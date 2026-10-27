import type { Database as Generated } from './supabase.generated';
import type {
  AnnualEvent,
  EntrySummary,
  Entry,
  RevealOverview,
  CheckpointTodayResponse,
  CheckpointEntryResponse,
  CheckpointHistoryItem,
  Media,
  CheckpointConfig,
} from './database';
import type { DeletionReceipt } from '../features/account/deletion';
import type { SaveReceipt } from '../features/entries/save-workflow';
// PostgreSQL jsonb has no structural schema. These domain contracts are verified
// by the SQL integration suite; table columns/arguments remain generated.
type Results = {
  open_annual_event: AnnualEvent;
  read_annual_event: AnnualEvent;
  claim_reveal_occurrence: { occurrence_id: string; entry: Entry | null };
  get_reveal_overview: RevealOverview;
  list_diary_entries: EntrySummary[];
  list_annual_entries: EntrySummary[];
  diary_summary: { entries: number; words: number };
  request_deletion: DeletionReceipt;
  deletion_status: DeletionReceipt;
  save_entry: SaveReceipt;
  check_checkpoint_today: CheckpointTodayResponse;
  get_checkpoint_entry: CheckpointEntryResponse;
  get_checkpoint_history: CheckpointHistoryItem[];
};
type Functions = Generated['public']['Functions'];
type Tables = Generated['public']['Tables'];
type Narrow<T, Fields> = {
  [K in keyof T]: K extends 'Row' | 'Insert' | 'Update'
    ? { [P in keyof T[K]]: P extends keyof Fields ? Fields[P] : T[K][P] }
    : T[K];
};
export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Functions' | 'Tables'> & {
    Functions: {
      [K in keyof Functions]: Omit<Functions[K], 'Returns'> & {
        Returns: K extends keyof Results ? Results[K] : Functions[K]['Returns'];
      };
    };
    Tables: Omit<Tables, 'media' | 'checkpoint_configs'> & {
      media: Narrow<Tables['media'], Pick<Media, 'media_type'>>;
      checkpoint_configs: Narrow<Tables['checkpoint_configs'], Pick<CheckpointConfig, 'frequency'>>;
    };
  };
};
