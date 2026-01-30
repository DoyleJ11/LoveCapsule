import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  useColorScheme,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/hooks/useCouple';
import { useEntries } from '../../../src/hooks/useEntries';
import { formatEntryDate } from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import type { Entry } from '../../../src/types/database';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { couple } = useCouple();
  const { updateEntry, deleteEntry } = useEntries(couple?.id);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    fetchEntry();
  }, [id]);

  const fetchEntry = async () => {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert('Error', 'Entry not found');
      router.back();
      return;
    }

    setEntry(data);
    setEditTitle(data.title);
    setEditContent(data.content_plain);
    setLoading(false);
  };

  const isOwner = entry?.author_id === user?.id;
  const mood = Moods.find((m) => m.key === entry?.mood);

  const handleSave = async () => {
    if (!entry) return;

    try {
      await updateEntry(entry.id, {
        title: editTitle.trim(),
        content_html: `<p>${editContent.replace(/\n/g, '</p><p>')}</p>`,
        content_plain: editContent,
        word_count: editContent.trim() ? editContent.trim().split(/\s+/).length : 0,
      });
      await fetchEntry();
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

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
        {mood && <Text style={styles.moodEmoji}>{mood.emoji} {mood.label}</Text>}
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
      {editing ? (
        <>
          <TextInput
            style={[styles.editTitle, { color: colors.text, borderBottomColor: colors.border }]}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Title..."
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={[styles.editContent, { color: colors.text }]}
            value={editContent}
            onChangeText={setEditContent}
            multiline
            textAlignVertical="top"
            placeholder="Write your thoughts..."
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={() => {
                setEditTitle(entry.title);
                setEditContent(entry.content_plain);
                setEditing(false);
              }}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.text }]}>
            {entry.title || 'Untitled Entry'}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>
            {entry.content_plain}
          </Text>

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
                onPress={() => setEditing(true)}
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
        </>
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
  editTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.md,
  },
  editContent: {
    fontSize: FontSize.md,
    lineHeight: 24,
    minHeight: 200,
    marginBottom: Spacing.md,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
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
