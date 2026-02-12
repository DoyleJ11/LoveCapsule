import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  useColorScheme,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/hooks/useCouple';
import { useEntries } from '../../../src/hooks/useEntries';
import { useVoiceMemo } from '../../../src/hooks/useVoiceMemo';
import { formatEntryDate, formatDuration } from '../../../src/lib/date-utils';
import { getSignedUrl } from '../../../src/lib/storage';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import type { Entry, Media } from '../../../src/types/database';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { couple } = useCouple();
  const { updateEntry, deleteEntry } = useEntries(couple?.id);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const voiceMemo = useVoiceMemo();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [media, setMedia] = useState<(Media & { signedUrl?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntry = useCallback(async () => {
    const { data, error } = await supabase.from('entries').select('*').eq('id', id).single();

    if (error) {
      Alert.alert('Error', 'Entry not found');
      router.back();
      return;
    }

    setEntry(data);
    setLoading(false);
    fetchMedia(data.id);
  }, [id]);

  const fetchMedia = async (entryId: string) => {
    const { data: mediaData } = await supabase
      .from('media')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: true });

    if (mediaData && mediaData.length > 0) {
      const withUrls = await Promise.all(
        mediaData.map(async (m) => {
          try {
            const signedUrl = await getSignedUrl(m.storage_path);
            return { ...m, signedUrl };
          } catch {
            return { ...m, signedUrl: undefined };
          }
        })
      );
      setMedia(withUrls);
    } else {
      setMedia([]);
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchEntry();
  }, [fetchEntry]);

  // Refetch when screen regains focus (e.g. returning from edit modal)
  useFocusEffect(
    useCallback(() => {
      fetchEntry();
    }, [fetchEntry])
  );

  const isOwner = entry?.author_id === user?.id;
  const mood = Moods.find((m) => m.key === entry?.mood);
  const imageMedia = media.filter((m) => m.media_type === 'image');
  const audioMedia = media.find((m) => m.media_type === 'audio');

  const handleDelete = () => {
    Alert.alert('Delete Entry', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEntry(entry!.id);
            router.back();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const handlePublish = async () => {
    if (!entry) return;
    try {
      await updateEntry(entry.id, { is_draft: false });
      await fetchEntry();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleEdit = () => {
    if (!entry) return;
    router.push({ pathname: '/(tabs)/entries/new', params: { entryId: entry.id } });
  };

  if (loading || !entry) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Meta info */}
      <View style={styles.metaRow}>
        <Text style={[styles.date, { color: colors.textMuted }]}>
          {formatEntryDate(entry.entry_date)}
        </Text>
        {entry.is_draft && (
          <View style={[styles.draftBadge, { backgroundColor: colors.warning + '20' }]}>
            <Text style={[styles.draftBadgeText, { color: colors.warning }]}>Draft</Text>
          </View>
        )}
        {mood && (
          <Text style={styles.moodEmoji}>
            {mood.emoji} {mood.label}
          </Text>
        )}
      </View>

      {/* Location */}
      {entry.location_name && (
        <View style={styles.locationRow}>
          <FontAwesome name="map-marker" size={14} color={colors.primary} />
          <Text style={[styles.locationText, { color: colors.textSecondary }]}>
            {entry.location_name}
          </Text>
        </View>
      )}

      {/* Title & Content */}
      <Text style={[styles.title, { color: colors.text }]}>{entry.title || 'Untitled Entry'}</Text>
      <Text style={[styles.body, { color: colors.text }]}>{entry.content_plain}</Text>

      {/* Entry Images */}
      {imageMedia.length > 0 && (
        <View style={styles.mediaGallery}>
          {imageMedia.map((m) =>
            m.signedUrl ? (
              <Image
                key={m.id}
                source={{ uri: m.signedUrl }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            ) : null
          )}
        </View>
      )}

      {/* Voice Memo Player */}
      {audioMedia && audioMedia.signedUrl && (
        <View
          style={[
            styles.audioPlayerCard,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <TouchableOpacity
            onPress={() =>
              voiceMemo.isPlaying
                ? voiceMemo.pauseAudio()
                : voiceMemo.playAudio(audioMedia.signedUrl)
            }
          >
            <FontAwesome
              name={voiceMemo.isPlaying ? 'pause-circle' : 'play-circle'}
              size={36}
              color={colors.primary}
            />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.audioPlayerLabel, { color: colors.text }]}>Voice Memo</Text>
            <Text style={[styles.audioPlayerDuration, { color: colors.textMuted }]}>
              {voiceMemo.isPlaying
                ? formatDuration(voiceMemo.playbackPositionSecs * 1000)
                : formatDuration(audioMedia.duration_ms || 0)}
              {audioMedia.duration_ms ? ` / ${formatDuration(audioMedia.duration_ms)}` : ''}
            </Text>
          </View>
        </View>
      )}

      <Text style={[styles.wordCount, { color: colors.textMuted }]}>
        {entry.word_count} {entry.word_count === 1 ? 'word' : 'words'}
      </Text>

      {/* Actions (only for owner) */}
      {isOwner && (
        <View style={styles.actions}>
          {entry.is_draft && (
            <TouchableOpacity
              style={[styles.publishButton, { backgroundColor: colors.accent }]}
              onPress={handlePublish}
            >
              <Text style={styles.publishButtonText}>Publish Entry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.editButton, { borderColor: colors.border }]}
            onPress={handleEdit}
          >
            <FontAwesome name="pencil" size={16} color={colors.textSecondary} />
            <Text style={[styles.editButtonText, { color: colors.textSecondary }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.deleteButton, { borderColor: colors.error }]}
            onPress={handleDelete}
          >
            <FontAwesome name="trash" size={16} color={colors.error} />
            <Text style={[styles.deleteButtonText, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  loadingText: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xxl,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  date: {
    fontSize: FontSize.sm,
  },
  draftBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  draftBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  moodEmoji: {
    fontSize: FontSize.sm,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  locationText: {
    fontSize: FontSize.sm,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  body: {
    fontSize: FontSize.md,
    lineHeight: 26,
    marginBottom: Spacing.lg,
  },
  wordCount: {
    fontSize: FontSize.xs,
    marginBottom: Spacing.lg,
  },
  mediaGallery: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  mediaImage: {
    width: '100%',
    height: 250,
    borderRadius: BorderRadius.md,
  },
  audioPlayerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  audioPlayerLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  audioPlayerDuration: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  actions: {
    gap: Spacing.sm,
  },
  publishButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  publishButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  editButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
  },
  editButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  deleteButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
  },
  deleteButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
});
