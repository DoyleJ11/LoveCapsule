export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  expo_push_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Couple {
  id: string;
  invite_code: string;
  anniversary_date: string | null;
  partner_1_id: string;
  partner_2_id: string | null;
  is_revealed: boolean;
  last_reveal_year: number | null;
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: string;
  couple_id: string;
  author_id: string;
  title: string;
  content_html: string;
  content_plain: string;
  word_count: number;
  mood: string | null;
  is_draft: boolean;
  is_favorite: boolean;
  entry_date: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface Media {
  id: string;
  entry_id: string;
  author_id: string;
  storage_path: string;
  media_type: 'image' | 'video';
  mime_type: string;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  created_at: string;
}

export interface RevealStats {
  partner_1_id: string;
  partner_2_id: string;
  partner_1_name: string;
  partner_2_name: string;
  partner_1_entries: number;
  partner_2_entries: number;
  partner_1_words: number;
  partner_2_words: number;
  total_media_images: number;
  total_media_videos: number;
  partner_1_avg_hour: number;
  partner_2_avg_hour: number;
  most_active_month: string;
  most_active_month_count: number;
  longest_entry_words: number;
  longest_entry_author_id: string;
  longest_entry_date: string;
  partner_1_longest_streak: number;
  partner_2_longest_streak: number;
  partner_1_top_mood: string | null;
  partner_2_top_mood: string | null;
  first_entry_date: string;
  last_entry_date: string;
  partner_1_favorite_dow: string;
  partner_2_favorite_dow: string;
  locations: Array<{
    lat: number;
    lng: number;
    location_name: string;
    author_id: string;
    entry_date: string;
  }>;
  unique_location_count: number;
}
